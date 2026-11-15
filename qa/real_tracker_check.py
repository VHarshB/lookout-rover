"""Optional real MediaPipe check; needs network, Playwright and installed Chrome.
Official portrait fixture + canvas video; BLE and telemetry mocked, no rover.
"""
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
import json
server=ThreadingHTTPServer(("127.0.0.1",0),SimpleHTTPRequestHandler)
Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",headless=True,args=["--autoplay-policy=no-user-gesture-required"])
  page=b.new_page()
  page.goto("http://127.0.0.1:"+str(server.server_port))
  page.evaluate("""async()=>{
   const im=new Image();im.crossOrigin='anonymous';im.src='https://storage.googleapis.com/mediapipe-assets/portrait.jpg';await im.decode();
   const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d');
   const paint=()=>{ctx.drawImage(im,0,0,640,480);ctx.fillStyle=String(Date.now()%2?'red':'blue');ctx.fillRect(0,0,2,2)};
   paint();window.painter=setInterval(paint,33);
   stream=c.captureStream(30);video.srcObject=stream;await video.play();canvas.width=640;canvas.height=480;
   window.aims=[];window.completions=[];
   const session={device:{gatt:{connected:true,disconnect(){}}},label:'Bluetooth',pending:0,closing:false,queue:Promise.resolve(),transmit:{properties:{writeWithoutResponse:false},async writeValueWithResponse(bytes){
    const text=new TextDecoder().decode(bytes);
    if(text.startsWith('AIM'))aims.push({at:performance.now(),text});
    if(text.includes('ZERO'))setTimeout(()=>socket.process(session,'ZEROED'),0);
    if(text.includes('TELEMETRY'))setTimeout(()=>socket.process(session,'TELEMETRY 0 NA STOPPED'),0);
   }}};
   socket.session=session;socket.ready=true;socket.version=2;enabled=true;voiceStop=false;hidden=false;generation++;
   const t=performance.now();await prepareTracker(generation);
   window.loadMs=Math.round(performance.now()-t);window.workerActive=!!tracker.workerBackend;
   scheduleTracking(generation);
  }""")
  page.wait_for_function("started && neutral!==null",timeout=20000)
  page.evaluate("steeringPauses.length=0;aims.length=0")
  page.wait_for_timeout(5000)
  result=page.evaluate("""()=>{
   const gaps=aims.slice(1).map((v,i)=>v.at-aims[i].at);
   return {workerActive,loadMs,calibrated:neutral!==null,armed:started,aimCount:aims.length,maxAimGapMs:Math.round(Math.max(...gaps)),pauses:steeringPauses,pose:steeringTrace.pose,lastAim:aims.at(-1)?.text}
  }""")
  assert result["workerActive"] and result["calibrated"] and result["armed"],result
  assert result["aimCount"]>20 and result["maxAimGapMs"]<400,result
  assert not result["pauses"],result

  page.evaluate("showCamera('phone');steeringPauses.length=0;aims.length=0")
  page.wait_for_timeout(5000)
  phone=page.evaluate("({aimCount:aims.length,maxAimGapMs:Math.round(Math.max(...aims.slice(1).map((v,i)=>v.at-aims[i].at))),pauses:steeringPauses,pose:steeringTrace.pose})")
  assert phone["aimCount"]>20 and phone["maxAimGapMs"]<400 and not phone["pauses"],phone
  print(json.dumps({"laptop":result,"phone":phone},indent=2));b.close()
finally:server.shutdown()
