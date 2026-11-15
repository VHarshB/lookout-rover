"""Run from repo root: python qa/steering_check.py. Requires Playwright and Chrome.
Camera is simulated; pose inference and BLE are mocked, control code is real.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
import json, subprocess, sys
server=ThreadingHTTPServer(("127.0.0.1",0),SimpleHTTPRequestHandler)
Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",headless=True,args=["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"])
  page=b.new_page();errors=[];page.on("pageerror",lambda e:errors.append(str(e)))
  page.route("https://**/*",lambda r:r.abort())
  if "--baseline" in sys.argv:
   baseline=subprocess.check_output(["git","show","652909c:index.html"])
   page.route("http://127.0.0.1:"+str(server.server_port)+"/",lambda r:r.fulfill(body=baseline,content_type="text/html"))
  page.goto("http://127.0.0.1:"+str(server.server_port))
  page.evaluate("""async()=>{
   window.commands=[];window.fallbacks=0;window.oldClosed=false;
   await openLaptopCamera();
   const session={device:{gatt:{connected:true,disconnect(){}}},label:'Bluetooth',pending:0,closing:false,queue:Promise.resolve(),transmit:{properties:{writeWithoutResponse:false},async writeValueWithResponse(bytes){
    const text=new TextDecoder().decode(bytes);commands.push(text);
    if(text.includes('ZERO'))setTimeout(()=>socket.process(session,'ZEROED'),0);
    if(text.includes('TELEMETRY'))setTimeout(()=>socket.process(session,'TELEMETRY 0 62 STOPPED'),0);
   }}};
   socket.session=session;socket.ready=true;socket.version=2;enabled=true;voiceStop=false;hidden=false;generation++;
   tracker={workerBackend:true,close(){oldClosed=true},async predict(){await new Promise(r=>setTimeout(r,265));return {yaw:0,box:[.2,.2,.7,.8]}}};
   prepareTracker=async()=>{fallbacks++;tracker={close(){},async predict(){return {yaw:0,box:[.2,.2,.7,.8]}}}};
   await track(generation);
  }""")
  assert page.evaluate("fallbacks===1 && oldClosed && neutral===null && !started")
  page.wait_for_function("started && neutral!==null",timeout=5000)
  checks=["Stale worker pose rejected; backend fallback restores calibration and ZEROED arming"]
  for view in ["laptop","phone"]:
   page.evaluate("v=>{showCamera(v);cancelTrackingFrame();tracker={close(){}}}",view)
   for yaw in [-25,25]:
    page.evaluate("""yaw=>{
     const a=yaw*Math.PI/180;
     const points=Array.from({length:455},()=>({x:.5,y:.5}));
     points[234]={x:.2,y:.5};points[454]={x:.8,y:.5};points[10]={x:.5,y:.2};points[152]={x:.5,y:.8};
     const matrix=[Math.cos(a),0,-Math.sin(a),0,0,1,0,0,Math.sin(a),0,Math.cos(a),0,0,0,-50,1];
     lastControlPose=performance.now()-80;
     acceptPose(poseOf({facialTransformationMatrixes:[{data:matrix}],faceLandmarks:[points]}),performance.now());
     latestStatus={heading:0,distance:62,reason:'STOPPED',at:performance.now()};lastMotionAt=0;lastPoll=performance.now();step();
    }""",yaw)
    page.wait_for_timeout(55)
    packet=page.evaluate("commands.filter(c=>c.startsWith('AIM')).at(-1)")
    assert float(packet.split()[1])*yaw>0 and float(packet.split()[2])==0,packet
   checks.append(view+": left/right matrix yaw produces completed zero-forward AIM BLE writes")
  page.evaluate("socket.onwritable=()=>{};window.setInterval=()=>0")
  for scenario in ["lost-face","hidden","stale","obstacle","no-echo","stop"]:
   result=page.evaluate("""s=>{voiceStop=false;hidden=false;face={at:performance.now()};lastMotion='moving';translation={base:.25,until:performance.now()+1000};latestStatus={heading:0,distance:62,reason:'OK',at:performance.now()};if(s==='lost-face')face=null;if(s==='hidden')hidden=true;if(s==='stale')latestStatus.at-=1000;if(s==='obstacle')latestStatus.distance=10;if(s==='no-echo')latestStatus.distance=null;if(s==='stop')latchStop();step();return {cancelled:translation===null,stopped:lastMotion==='stop'}}""",scenario)
   assert result["cancelled"] and result["stopped"],(scenario,result)
   page.wait_for_timeout(20)
  checks.append("Stop, lost face, hidden tab, stale data, obstacle and no echo stop motion")
  page.evaluate("""()=>{neutral=0;filteredYaw=faceAngle=25;faceRate=100;lastControlPose=performance.now()-16;acceptPose({yaw:-25,box:[.2,.2,.7,.8]},performance.now())}""")
  assert page.evaluate("faceAngle < -21 && faceRate < 0")
  checks.append("16 ms reversal follows over 92% of head-angle change and immediately reverses feed-forward")

  page.evaluate("""()=>{socket.session.transmit.writeValueWithResponse=async()=>{throw new Error("test write failure")};socket.send(JSON.stringify({kind:"aim",angle:20,base:0,rate:0}))}""")
  page.wait_for_function("socket.session===null")
  checks.append("BLE write rejection closes connection and disables steering")
  assert not errors,errors
  print(json.dumps(checks,indent=2));b.close()
finally:server.shutdown()
