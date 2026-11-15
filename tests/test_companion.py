import json
import math
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from companion.navigation import Navigator, Rejected, validate_intent
from companion.intents import Interpreter
from companion.vision import Tracker
from companion.server import CompanionServer


class Clock:
 def __init__(self):self.value=0
 def __call__(self):return self.value


def telemetry(**changes):
 return dict(dict(heading=0,distance=100,age_ms=10,ready=True,armed=True,face_fresh=True,
                  stopped=False,fault=None,hidden=False,version=2,reason="STOPPED"),**changes)


class NavigationTests(unittest.TestCase):
 def setUp(self):
  self.clock=Clock();self.nav=Navigator(self.clock);self.nav.claim("console-one")
  self.frame()
 def frame(self,box=None):
  self.nav.observation={"at":self.clock(),"progress":True,
   "tracks":[{"id":"target-1","label":"person","box":box or [.4,.1,.6,.9],"fresh":True}]}
 def confirm(self,intent):
  p=self.nav.propose("console-one",validate_intent(intent,["target-1"]))
  self.nav.confirm("console-one",p["id"],telemetry(),1)
 def test_validation(self):
  for value in [
   {"action":"drive","direction":"forward","duration_ms":math.nan},
   {"action":"drive","direction":"forward","duration_ms":True},
   {"action":"turn","direction":"left","angle_deg":180},
   {"action":"approach","target_id":"invented"},
   {"action":"drive","direction":"forward","raw":"AIM 999"},
   {"action":"follow"},{"action":"drive","direction":"sideways"}]:
   with self.subTest(value=value),self.assertRaises(Rejected):validate_intent(value,["target-1"])
 def test_left_right(self):
  for direction,sign in [("left",1),("right",-1)]:
   self.confirm({"action":"turn","direction":direction})
   command=self.nav.tick("console-one",telemetry())["command"]
   self.assertEqual(command["angle"],15*sign);self.assertEqual(command["base"],0)
 def test_no_automatic_execution(self):
  self.nav.propose("console-one",{"action":"drive","direction":"forward","duration_ms":500,"speed":"slow"})
  self.assertIsNone(self.nav.tick("console-one",telemetry())["command"])
 def test_expired_or_cancelled_confirm(self):
  p=self.nav.propose("console-one",{"action":"turn","direction":"left","angle_deg":15})
  self.nav.cancel()
  with self.assertRaises(Rejected):self.nav.confirm("console-one",p["id"],telemetry(),1)
 def test_drive_deadline_and_front_guard(self):
  self.confirm({"action":"drive","direction":"forward","duration_ms":500})
  self.assertEqual(self.nav.tick("console-one",telemetry())["command"]["base"],.18)
  self.clock.value=.6
  self.assertIsNone(self.nav.tick("console-one",telemetry())["command"])
  for distance in [None,19]:
   self.confirm({"action":"drive","direction":"forward"})
   self.assertIsNone(self.nav.tick("console-one",telemetry(distance=distance))["command"])
 def test_reverse_no_echo(self):
  self.confirm({"action":"drive","direction":"reverse"})
  self.assertLess(self.nav.tick("console-one",telemetry(distance=None))["command"]["base"],0)
 def test_no_echo_pivot_and_range_required(self):
  self.frame([.1,.1,.3,.9]);self.confirm({"action":"approach","target_id":"target-1"})
  c=self.nav.tick("console-one",telemetry(distance=None))["command"]
  self.assertGreater(c["angle"],0);self.assertEqual(c["base"],0)
  self.frame();self.assertIsNone(self.nav.tick("console-one",telemetry())["command"])
  self.assertEqual(self.nav.state,"awaiting_range")
  with self.assertRaises(Rejected):self.nav.validate_range("console-one",200,telemetry())
  self.nav.validate_range("console-one",100,telemetry())
  self.assertEqual(self.nav.tick("console-one",telemetry())["command"]["base"],.18)
  self.assertIsNone(self.nav.tick("console-one",telemetry(distance=59))["command"])
  self.assertEqual(self.nav.state,"arrived")
 def test_no_echo_during_approach(self):
  self.confirm({"action":"approach","target_id":"target-1"})
  self.nav.tick("console-one",telemetry());self.nav.validate_range("console-one",100,telemetry())
  self.assertIsNone(self.nav.tick("console-one",telemetry(distance=None))["command"])
  self.assertIsNone(self.nav.goal)
 def test_stale_frozen_or_lost_target(self):
  for condition in ["stale","frozen","lost"]:
   self.frame();self.confirm({"action":"approach","target_id":"target-1"})
   if condition=="stale":self.nav.observation["at"]=-1
   if condition=="frozen":self.nav.observation["progress"]=False
   if condition=="lost":self.nav.observation["tracks"]=[]
   self.assertIsNone(self.nav.tick("console-one",telemetry())["command"])
   self.assertIsNone(self.nav.goal)
 def test_safety_conditions_cancel(self):
  for changes in [{"face_fresh":False},{"stopped":True},{"age_ms":651},{"hidden":True},
                  {"fault":"Motor power off"},{"reason":"WHEELS_STALLED"},{"reason":"POWER_OFF"}]:
   self.confirm({"action":"turn","direction":"left"})
   self.assertIsNone(self.nav.tick("console-one",telemetry(**changes))["command"])
   self.assertIsNone(self.nav.goal)
 def test_lease_and_single_owner(self):
  with self.assertRaises(Rejected):self.nav.claim("console-two")
  with self.assertRaises(Rejected):self.nav.tick("console-two",telemetry())
  self.assertEqual(self.nav.owner,"console-one")
  self.confirm({"action":"drive","direction":"reverse"})
  self.clock.value=2.1
  with self.assertRaises(Rejected):self.nav.tick("console-one",telemetry())
  self.assertIsNone(self.nav.goal)
 def test_heading_bounds(self):
  p=self.nav.propose("console-one",{"action":"turn","direction":"left","angle_deg":25})
  with self.assertRaises(Rejected):self.nav.confirm("console-one",p["id"],telemetry(heading=40),1)


class ModelTests(unittest.TestCase):
 def test_fake_bedrock_and_no_raw_motor_fields(self):
  class Fake:
   def converse(self,**kwargs):
    self.kwargs=kwargs
    return {"output":{"message":{"content":[{"toolUse":{"name":"rover_intent","input":{"action":"approach","target_id":"target-1"}}}]}}}
  fake=Fake();model=Interpreter(fake,"test")
  result=model.interpret("approach that person",[{"id":"target-1","label":"person","box":[.1,0,.3,1],"fresh":True}],"target-1")
  self.assertEqual(result["target_id"],"target-1")
  self.assertNotIn("image",json.dumps(fake.kwargs))
 def test_stop_needs_no_cloud(self):
  self.assertEqual(Interpreter(model="").interpret("stop",[],None),{"action":"stop"})
 def test_ambiguous_deictic_never_guesses(self):
  tracks=[{"id":str(i),"label":"person","fresh":True,"box":[.1,0,.3,1]} for i in range(2)]
  self.assertEqual(Interpreter(model="").interpret("go to that person",tracks,None)["action"],"clarify")
 def test_tracker_loses_missing_and_ambiguous_ids(self):
  c=Clock();t=Tracker(c);d={"label":"person","box":[.1,.1,.5,.9],"confidence":.9}
  first=t.update([d])[0]["id"];c.value=.1
  self.assertEqual(t.update([d])[0]["id"],first)
  t.update([]);c.value=.2
  self.assertNotEqual(t.update([d])[0]["id"],first)


class HttpTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.server=CompanionServer(0);cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
  cls.base="http://127.0.0.1:"+str(cls.server.server_port)
 @classmethod
 def tearDownClass(cls):cls.server.shutdown();cls.server.server_close()
 def test_local_bootstrap_and_static_allowlist(self):
  page=urlopen(self.base).read().decode()
  self.assertIn("window.LookoutService=",page)
  for path in ["/.git/config","/assets/fonts/../../.git/config","/companion/local-config.json","/../.env","/api/health"]:
   with self.subTest(path=path),self.assertRaises(HTTPError):urlopen(self.base+path)
 def test_host_and_origin_and_token(self):
  for headers in [{"Host":"evil.example"},{"Origin":"https://evil.example","X-Lookout-Token":self.server.token},
                  {"X-Lookout-Token":"wrong"}]:
   with self.assertRaises(HTTPError):urlopen(Request(self.base+"/api/health",headers=headers))
 def test_cancel_while_cloud_is_replying(self):
  entered,finish=threading.Event(),threading.Event()
  class Slow:
   def converse(self,**kwargs):
    entered.set();finish.wait(3)
    return {"output":{"message":{"content":[{"toolUse":{"name":"rover_intent","input":{"action":"drive","direction":"forward"}}}]}}}
  with self.server.lock:
   self.server.nav.cancel(off=True)
   self.server.nav.claim("race-client")
   saved=self.server.interpreter
   self.server.interpreter=Interpreter(Slow(),"test")
  headers={"X-Lookout-Token":self.server.token,"X-Lookout-Client":"race-client","Content-Type":"application/json"}
  result=[]
  def request():
   try:
    urlopen(Request(self.base+"/api/interpret",data=b'{"text":"move forward"}',headers=headers))
   except HTTPError as error:result.append(error.code)
  thread=threading.Thread(target=request);thread.start()
  try:
   self.assertTrue(entered.wait(2))
   urlopen(Request(self.base+"/api/cancel",data=b'{}',headers=headers)).close()
   finish.set();thread.join(3)
   self.assertEqual(result,[409])
   self.assertIsNone(self.server.nav.proposal);self.assertIsNone(self.server.nav.goal)
  finally:
   finish.set()
   with self.server.lock:
    self.server.interpreter=saved;self.server.nav.cancel(off=True)
 def test_health_and_session(self):
  headers={"X-Lookout-Token":self.server.token,"X-Lookout-Client":"test-client","Content-Type":"application/json"}
  result=json.load(urlopen(Request(self.base+"/api/health",headers=headers)))
  self.assertIn("vision_ready",result)
  request=Request(self.base+"/api/session",data=b'{"enabled":true}',headers=headers)
  self.assertEqual(json.load(urlopen(request))["state"],"idle")
  request=Request(self.base+"/api/tick",data=json.dumps({"telemetry":telemetry()}).encode(),headers=headers)
  self.assertIsNone(json.load(urlopen(request))["command"])


if __name__=="__main__":unittest.main()
