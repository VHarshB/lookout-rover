"""Actual VDO.Ninja -> frame bridge -> OpenCV -> browser authority test.
AWS response and XRP transport are mocked; no physical motors or cloud calls.
Run from repo root with Playwright, OpenCV and numpy installed.
"""
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
if (ROOT/".local-deps").is_dir():sys.path.insert(0,str(ROOT/".local-deps"))
import json,threading,time,uuid,tempfile
import cv2,numpy as np
from playwright.sync_api import sync_playwright
from companion.server import CompanionServer

class FakeBedrock:
 def converse(self,**request):
  body=json.loads(request["messages"][0]["content"][0]["text"])
  text=body["request"].lower()
  intent={"action":"drive","direction":"forward","speed":"slow","duration_ms":1500 if "network" in text else 500}
  if "approach" in text:
   intent={"action":"approach","target_id":body["selected_target"]}
  return {"output":{"message":{"content":[{"toolUse":{"name":"rover_intent","input":intent}}]}}}

server=CompanionServer(0)
server.interpreter.client=FakeBedrock();server.interpreter.model="test-only";server.interpreter.region="test-only"
threading.Thread(target=server.serve_forever,daemon=True).start()
out=Path(tempfile.gettempdir())/"lookout-assisted-qa";out.mkdir(exist_ok=True)
fixture=ROOT/"models/test-basketball.png"
if not fixture.exists():
 from urllib.request import urlopen
 fixture.write_bytes(urlopen("https://raw.githubusercontent.com/opencv/opencv/master/samples/data/basketball1.png").read())
frame=cv2.resize(cv2.imread(str(fixture)),(640,480))
video=ROOT/"models/qa-camera.y4m"
with video.open("wb") as f:
 f.write(b"YUV4MPEG2 W640 H480 F10:1 Ip A1:1 C420jpeg\n")
 for i in range(20):
  image=frame.copy();cv2.rectangle(image,(i*10,460),(i*10+5,470),(0,255,0),-1)
  f.write(b"FRAME\n");f.write(cv2.cvtColor(image,cv2.COLOR_BGR2YUV_I420).tobytes())
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",headless=True,args=[
   "--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream",
   "--use-file-for-fake-video-capture="+str(video),"--autoplay-policy=no-user-gesture-required"])
  context=browser.new_context(viewport={"width":1440,"height":1000})
  sender_context=browser.new_context(permissions=["camera","microphone"])
  saved={"id":"lookout-"+str(uuid.uuid4()),"token":str(uuid.uuid4())}
  context.add_init_script("if(location.hostname==='127.0.0.1')localStorage.setItem('lookout-rover.phone-pairing.v1',"+json.dumps(json.dumps(saved))+");")
  page=context.new_page();errors=[];page.on("pageerror",lambda e:errors.append(str(e)))
  page.goto("http://127.0.0.1:"+str(server.server_port),wait_until="domcontentloaded")
  assert page.locator("#assist-mode").get_attribute("aria-pressed")=="false"
  page.locator("#assist-panel summary").click();page.locator("#assist-mode").click()
  page.wait_for_function("LookoutAssist.active")
  page.locator("#phone-tab").click()
  link=page.locator("#phone-url").input_value()
  assert link.startswith("https://vharshb.github.io/lookout-rover/rover-phone.html"),link
  sender=sender_context.new_page();sender.goto(link,wait_until="domcontentloaded");sender.wait_for_url("https://vdo.ninja/**")
  page.wait_for_function("document.querySelectorAll('#assist-targets button').length>=1",timeout=60000)
  page.locator("#assist-targets button").first.click()
  page.locator("#assist-text").fill("approach that person");page.locator("#assist-send").click()
  page.wait_for_function("!document.getElementById('assist-confirm').disabled")
  page.locator("#assist-confirm").click()
  assert "Verify" in page.locator("#assist-status").inner_text()
  page.evaluate("""()=>{
   window.writes=[];
   const session={device:{gatt:{connected:true,disconnect(){}}},label:'Bluetooth',transport:'bluetooth',pending:0,closing:false,queue:Promise.resolve(),
    transmit:{properties:{writeWithoutResponse:false},async writeValueWithResponse(bytes){
     const text=new TextDecoder().decode(bytes);writes.push(text);
     if(text.startsWith('TELEMETRY'))setTimeout(()=>socket.process(session,'TELEMETRY 0 100 STOPPED'),0);
    }}};
   socket.session=session;socket.ready=true;socket.version=2;enabled=true;started=true;neutral=0;voiceStop=false;hidden=false;
   tracker={close(){}};stream={getTracks:()=>[]};face={at:performance.now()};
   latestStatus={heading:0,distance:100,reason:'STOPPED',at:performance.now()};
   byId('connection').textContent='Red Board connected - Bluetooth (simulated)';
   window.faceKeep=setInterval(()=>{face={at:performance.now()}},50);
  }""")
  page.locator("#assist-direction").check();page.locator("#assist-confirm").click()
  page.wait_for_function("writes.some(w=>w.startsWith('AIM '))",timeout=8000)
  assert page.evaluate("writes.filter(w=>w.startsWith('AIM ')).every(w=>Number(w.split(' ')[2])===0)")
  page.evaluate("window.scrollTo(0,0)");page.wait_for_timeout(300)
  page.screenshot(path=str(out/"desktop.png"),full_page=True)
  page.keyboard.press("Escape")
  page.wait_for_timeout(350)
  stop_count=page.evaluate("writes.length")
  page.wait_for_timeout(400)
  assert page.evaluate("voiceStop && LookoutAssist.command(performance.now())===null")
  assert not page.evaluate("writes.slice("+str(stop_count)+").some(w=>w.startsWith('AIM '))")
  page.locator("#assist-manual").click()
  assert page.evaluate("!LookoutAssist.active && LookoutAssist.command(performance.now())===undefined")
  # Exercise the range/approach UI separately with a centered observation fixture.
  # The actual VDO and OpenCV path was tested above.
  def centered(route):
   payload=route.request.post_data_json
   track={"id":"centered-target","label":"person","box":[.35,.1,.65,.9],"confidence":.99,"fresh":True}
   with server.lock:
    server.nav.observation={"at":time.monotonic(),"progress":True,"tracks":[track]}
   route.fulfill(json={"frame_id":payload["frame_id"],"tracks":[track],"progress":True,"width":640,"height":480,"inference_ms":0})
  page.route("**/api/frame",centered)
  page.evaluate("voiceStop=false")
  page.locator("#assist-mode").click();page.wait_for_function("LookoutAssist.active")
  page.wait_for_function("document.getElementById('assist-targets').textContent.includes('centered-target')")
  page.locator("#assist-targets button").first.click()
  page.locator("#assist-text").fill("approach that person");page.locator("#assist-send").click()
  page.wait_for_function("!document.getElementById('assist-confirm').disabled")
  page.locator("#assist-direction").check();page.locator("#assist-confirm").click()
  page.wait_for_function("!document.getElementById('assist-range-panel').hidden")
  page.locator("#assist-range-confirm").click()
  assert "Verify sensor" in page.locator("#assist-status").inner_text()
  page.locator("#assist-range-check").check()
  page.wait_for_timeout(250)
  assert page.locator("#assist-range-check").is_checked()
  page.locator("#assist-range").fill("100")
  page.evaluate("writes.length=0")
  page.locator("#assist-range-confirm").click()
  page.wait_for_function("writes.some(w=>w.startsWith('AIM ')&&Number(w.split(' ')[2])>0)")
  page.evaluate("roverDistance=55")
  # Replace the mocked telemetry reply to simulate arrival.
  page.evaluate("""()=>{socket.session.transmit.writeValueWithResponse=async bytes=>{
   const text=new TextDecoder().decode(bytes);writes.push(text);
   if(text.startsWith('TELEMETRY'))setTimeout(()=>socket.process(socket.session,'TELEMETRY 0 55 STOPPED'),0);
  };socket.process(socket.session,'TELEMETRY 0 55 STOPPED')}""")
  page.wait_for_function("document.getElementById('assist-status').textContent.includes('Arrived')")
  page.locator("#assist-text").fill("move forward network test");page.locator("#assist-send").click()
  page.wait_for_function("!document.getElementById('assist-confirm').disabled")
  page.evaluate("writes.length=0")
  page.locator("#assist-confirm").click()
  page.wait_for_function("writes.some(w=>w.startsWith('AIM ')&&Number(w.split(' ')[2])>0)")
  def unavailable(route):route.fulfill(status=503,json={"error":"simulated local interruption"})
  page.route("**/api/tick",unavailable)
  page.wait_for_timeout(350)
  assert page.evaluate("LookoutAssist.command(performance.now())===null")
  page.unroute("**/api/tick",unavailable)
  count=page.evaluate("writes.length")
  page.wait_for_timeout(400)
  assert not page.evaluate("writes.slice("+str(count)+").some(w=>w.startsWith('AIM '))")
  page.locator("#assist-manual").click()
  page.set_viewport_size({"width":390,"height":844})
  assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
  page.evaluate("window.scrollTo(0,0)");page.wait_for_timeout(300)
  page.screenshot(path=str(out/"mobile.png"),full_page=True)
  assert not errors,errors
  print(json.dumps({"real_vdo_frames":True,"real_opencv_detection":True,"target_proposal":True,"guarded_confirmation":True,
   "zero_base_aim":True,"escape_cancels":True,"manual_return":True,"range_confirmation_and_arrival":True,"no_restart_after_local_interruption":True,"no_mobile_overflow":True,"screenshots":str(out)},indent=2))
  browser.close()
finally:server.shutdown();server.server_close()
