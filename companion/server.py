"""Loopback-only static console and authenticated local APIs."""
import json
import mimetypes
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .intents import Interpreter
from .navigation import Navigator, Rejected, validate_intent
from .vision import Detector, Tracker

ROOT = Path(__file__).resolve().parents[1]


class CompanionServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port=8765):
        super().__init__(("127.0.0.1", port), Handler)
        self.token = secrets.token_urlsafe(32)
        self.nav = Navigator()
        self.detector = Detector()
        self.tracker = Tracker()
        self.interpreter = Interpreter()
        self.lock = threading.RLock()
        self.frame_slot = threading.Lock()
        self.intent_slot = threading.Lock()

    @property
    def origins(self):
        return {f"http://127.0.0.1:{self.server_port}", f"http://localhost:{self.server_port}"}


class Handler(BaseHTTPRequestHandler):
    server_version = "LookoutCompanion/1"

    def log_message(self, *_):
        pass

    def respond(self, code, body, mime="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, allow_nan=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def local_request(self):
        host = self.headers.get("Host", "")
        if "http://" + host not in self.server.origins:
            return False
        origin = self.headers.get("Origin")
        return (not origin or origin in self.server.origins) and self.headers.get("Sec-Fetch-Site") != "cross-site"

    def authenticated(self):
        supplied = self.headers.get("X-Lookout-Token", "")
        return self.local_request() and secrets.compare_digest(supplied, self.server.token)

    def do_GET(self):
        if not self.local_request():
            return self.respond(403, {"error": "Local same-origin access required"})
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            if not self.authenticated():
                return self.respond(403, {"error":"Session token required"})
            if path == "/api/health":
                return self.respond(200, {"vision_ready":self.server.detector.ready,
                    "aws_configured":bool(self.server.interpreter.model),
                    "region_configured":bool(self.server.interpreter.region),
                    "labels":["person","chair","bottle","dog","cat","sofa","diningtable","pottedplant","tvmonitor",
                              "bicycle","car","bus","motorbike","bird","boat","aeroplane","cow","horse","sheep","train"]})
            return self.respond(404, {"error":"Unknown endpoint"})
        if path == "/":
            path = "/index.html"
        allowed = {"/index.html","/mascot.js","/theme.css","/phone-video.js","/phone-link.js","/rover-phone.html",
                   "/assisted/assist.js","/assisted/assist.css"}
        allowed.update("/assets/fonts/" + item.name for item in (ROOT / "assets/fonts").iterdir() if item.is_file())
        if path not in allowed:
            return self.respond(404, "Not found", "text/plain")
        file = (ROOT / path.lstrip("/")).resolve()
        if not file.is_relative_to(ROOT) or not file.is_file():
            return self.respond(404, "Not found", "text/plain")
        body = file.read_bytes()
        if path == "/index.html":
            config = json.dumps({"token":self.server.token,"api":"/api","phoneBase":"https://vharshb.github.io/lookout-rover/"}, ensure_ascii=True)
            body = body.replace(b"</head>", ('<script>window.LookoutService='+config+';</script></head>').encode(), 1)
        return self.respond(200, body, mimetypes.guess_type(str(file))[0] or "application/octet-stream")

    def do_POST(self):
        if not self.authenticated():
            return self.respond(403, {"error":"Local session token required"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1_600_000:
                return self.respond(413, {"error":"Request too large or empty"})
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise Rejected("Object body required")
            owner = self.headers.get("X-Lookout-Client", "")
            if not 8 <= len(owner) <= 100:
                raise Rejected("Console ID required")
            result = self.dispatch(urlsplit(self.path).path, owner, payload)
            return self.respond(200, result)
        except (Rejected, ValueError, TypeError, KeyError) as error:
            return self.respond(409, {"error":str(error)[:300]})
        except Exception:
            return self.respond(500, {"error":"Local service error. Check installed dependencies and model files."})

    def dispatch(self, path, owner, body):
        s = self.server
        if path == "/api/frame":
            if not s.frame_slot.acquire(blocking=False):
                raise Rejected("Vision busy; drop this frame")
            try:
                with s.lock:
                    s.nav.require_owner(owner)
                    epoch = s.nav.epoch
                received = time.monotonic()
                observation = s.detector.detect(body.get("image"))
                with s.lock:
                    s.nav.require_owner(owner)
                    # A frame may update perception after Stop, but never restores a goal.
                    tracks = s.tracker.update(observation.pop("detections"))
                    s.nav.observation = {**observation, "tracks":tracks, "at":received}
                    return {**observation, "tracks":tracks, "epoch":epoch,
                            "frame_id":str(body.get("frame_id",""))[:100]}
            finally:
                s.frame_slot.release()
        if path == "/api/interpret":
            if not s.intent_slot.acquire(blocking=False):
                raise Rejected("Another command is being interpreted")
            try:
                with s.lock:
                    s.nav.require_owner(owner)
                    s.nav.cancel("Understanding command")
                    epoch = s.nav.epoch
                    tracks = s.nav.observation["tracks"] if time.monotonic()-s.nav.observation["at"] <= .65 else []
                    selected = s.nav.selected
                    history = list(s.nav.dialogue)
                intent = s.interpreter.interpret(body.get("text"), tracks, selected, history)
                with s.lock:
                    s.nav.require_owner(owner)
                    if epoch != s.nav.epoch:
                        raise Rejected("Command cancelled while AWS was responding")
                    s.nav.dialogue = (s.nav.dialogue + [{"request":body.get("text"), "intent":intent}])[-4:]
                    if intent["action"] == "stop":
                        s.nav.cancel("Voice Stop")
                        return {"intent":intent}
                    if intent["action"] == "clarify":
                        return {"intent":intent,"message":intent["message"]}
                    if intent["action"] == "approach":
                        s.nav.track(intent["target_id"])
                    proposal = s.nav.propose(owner, validate_intent(intent, [t["id"] for t in tracks]))
                    return {"proposal":proposal, "intent":intent}
            finally:
                s.intent_slot.release()
        with s.lock:
            if path == "/api/session":
                if body.get("enabled") is True:
                    s.nav.claim(owner)
                else:
                    s.nav.require_owner(owner)
                    s.nav.cancel("Manual control", off=True)
                return {"state":s.nav.state}
            if path == "/api/cancel":
                if s.nav.owner == owner:
                    s.nav.cancel("Operator cancelled")
                return {"state":"stopped"}
            if path == "/api/tick":
                return s.nav.tick(owner, body.get("telemetry"))
            if path == "/api/select":
                s.nav.select(owner, body.get("target_id"))
                return {"selected":s.nav.selected}
            if path == "/api/confirm":
                s.nav.confirm(owner, body.get("proposal_id"), body.get("telemetry"), body.get("polarity"))
                return {"state":s.nav.state}
            if path == "/api/range":
                s.nav.validate_range(owner, body.get("measured_cm"), body.get("telemetry"))
                return {"state":s.nav.state}
        raise Rejected("Unknown endpoint")
