"""Deterministic navigation. All output is a short-lived intent, never a BLE write."""
import math
import time
import uuid

FAULTS = {"POWER_OFF", "WHEELS_STALLED", "COMMAND_LOST"}
STOP_DISTANCE = 60.0
MAX_OBSERVATION_AGE = .65
LEASE_SECONDS = 2.0


class Rejected(ValueError):
    pass


def finite(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise Rejected("Invalid number")
    return float(value)


def validate_intent(value, visible_ids=()):
    if not isinstance(value, dict):
        raise Rejected("Command must be an object")
    if set(value) - {"action", "direction", "speed", "duration_ms", "angle_deg", "target_id", "message"}:
        raise Rejected("Unexpected command fields")
    action = value.get("action")
    if action not in {"stop", "drive", "turn", "approach", "clarify"}:
        raise Rejected("Unsupported action")
    result = {"action": action}
    if action == "drive":
        if value.get("direction") not in {"forward", "reverse"}:
            raise Rejected("Choose forward or reverse")
        if value.get("speed", "slow") not in {"slow", "normal"}:
            raise Rejected("Unsupported speed")
        result.update(direction=value["direction"], speed=value.get("speed", "slow"),
                      duration_ms=int(finite(value.get("duration_ms", 700), 200, 1500)))
    elif action == "turn":
        if value.get("direction") not in {"left", "right"}:
            raise Rejected("Choose left or right")
        result.update(direction=value["direction"], angle_deg=finite(value.get("angle_deg", 15), 3, 25))
    elif action == "approach":
        target = value.get("target_id")
        if not isinstance(target, str) or target not in visible_ids:
            raise Rejected("Select a currently visible target")
        result["target_id"] = target
    elif action == "clarify":
        result["message"] = str(value.get("message", "Please clarify the action or select a target."))[:240]
    return result


def angle_delta(value):
    return (value + 180) % 360 - 180


class Navigator:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.owner = None
        self.lease_at = 0
        self.epoch = 0
        self.observation = {"tracks": [], "at": -1e9, "progress": False}
        self.selected = None
        self.dialogue = []
        self.proposal = None
        self.goal = None
        self.state = "off"
        self.message = "Assisted mode off"
        self.last_range = None
        self.range_validated = False
        self.turn_polarity = None

    def claim(self, owner):
        now = self.clock()
        if self.owner and self.owner != owner and now - self.lease_at < LEASE_SECONDS:
            raise Rejected("Another console owns Assisted mode")
        self.cancel("Ready. Select a target or enter a command.")
        self.owner, self.lease_at, self.state = owner, now, "idle"
        # Physical direction check is session-specific, not a stored default.
        self.turn_polarity = None
        self.selected = None
        self.dialogue = []

    def require_owner(self, owner):
        if self.owner != owner:
            raise Rejected("This console does not own Assisted mode")
        if self.clock() - self.lease_at >= LEASE_SECONDS:
            self.cancel("Assisted session expired. Enable it again.")
            self.owner = None
            raise Rejected("Assisted session expired")

    def renew(self, owner):
        self.require_owner(owner)
        self.lease_at = self.clock()

    def cancel(self, message="Stopped", off=False):
        self.epoch += 1
        self.goal = self.proposal = None
        self.range_validated = False
        self.last_range = None
        self.state, self.message = ("off" if off else "stopped"), message
        if off:
            self.owner = None

    def track(self, target_id):
        now = self.clock()
        if now - self.observation["at"] > MAX_OBSERVATION_AGE or not self.observation.get("progress"):
            raise Rejected("Phone observations are stale or frozen")
        item = next((t for t in self.observation["tracks"] if t["id"] == target_id and t.get("fresh")), None)
        if item is None:
            raise Rejected("Target lost. Select and confirm again.")
        return item

    def select(self, owner, target_id):
        self.require_owner(owner)
        self.track(target_id)
        self.cancel("Target selected. Ask to approach it.")
        self.selected = target_id

    def propose(self, owner, intent):
        self.require_owner(owner)
        self.cancel("Review the interpreted command before confirming.")
        self.proposal = {"id": uuid.uuid4().hex, "intent": intent, "at": self.clock()}
        self.state = "confirming"
        return self.proposal

    def confirm(self, owner, proposal_id, telemetry, polarity):
        self.require_owner(owner)
        p = self.proposal
        if not p or p["id"] != proposal_id or self.clock() - p["at"] > 15:
            raise Rejected("Command expired. Repeat it.")
        if polarity not in {-1, 1} or isinstance(polarity, bool):
            raise Rejected("Verify camera/turn direction with wheels lifted first")
        self.check_telemetry(telemetry)
        self.turn_polarity = polarity
        intent = p["intent"]
        if intent["action"] == "approach":
            self.track(intent["target_id"])
            self.selected = intent["target_id"]
        heading = telemetry["heading"]
        if abs(heading) > 50:
            raise Rejected("Heading limit reached. Recenter in manual mode.")
        self.goal = {**intent, "at": self.clock(), "heading": heading}
        self.proposal = None
        self.range_validated = False
        if intent["action"] == "turn":
            sign = 1 if intent["direction"] == "left" else -1
            target = heading + sign * intent["angle_deg"]
            if abs(target) > 50:
                self.cancel("Heading limit reached. Return to manual mode and recenter.")
                raise Rejected(self.message)
            self.goal["target"] = target
        self.state, self.message = "aligning" if intent["action"] == "approach" else "executing", "Command confirmed"

    def check_telemetry(self, telemetry):
        if not isinstance(telemetry, dict):
            raise Rejected("Telemetry missing")
        for name in ("ready", "armed", "face_fresh", "stopped", "hidden"):
            if type(telemetry.get(name)) is not bool:
                raise Rejected("Invalid telemetry flags")
        if telemetry.get("version") != 2:
            raise Rejected("Assisted motion requires the V2 controller")
        finite(telemetry.get("heading"), -180, 180)
        finite(telemetry.get("age_ms"), 0, 650)
        if not telemetry.get("ready") or not telemetry.get("armed") or not telemetry.get("face_fresh"):
            raise Rejected("Connect, enable steering, center and keep your face visible")
        if telemetry.get("stopped") or telemetry.get("fault") or telemetry.get("hidden"):
            raise Rejected("Stopped or blocked. Return to manual control and resume first.")
        if telemetry.get("reason") in FAULTS:
            raise Rejected("Motor or command fault")
        if telemetry.get("distance") is not None:
            finite(telemetry["distance"], 2, 400)

    def validate_range(self, owner, measured_cm, telemetry):
        self.require_owner(owner)
        self.check_telemetry(telemetry)
        if not self.goal or self.goal["action"] != "approach" or self.state != "awaiting_range":
            raise Rejected("Align with the target first")
        target = self.track(self.goal["target_id"])
        if abs((target["box"][0] + target["box"][2]) / 2 - .5) > .07:
            raise Rejected("Target must remain centered")
        distance = telemetry.get("distance")
        measured = finite(measured_cm, STOP_DISTANCE + 10, 300)
        if distance is None or abs(distance - measured) > max(8, measured * .10):
            raise Rejected("Front sensor must agree with the measured target distance")
        self.range_validated = True
        self.goal["range_heading"] = telemetry["heading"]
        self.goal["range_at"] = self.clock()
        self.goal["drive_at"] = self.clock()
        self.last_range = distance
        self.state, self.message = "approaching", "Approaching confirmed target"

    def tick(self, owner, telemetry):
        self.renew(owner)
        output = {"state": self.state, "message": self.message, "command": None, "epoch": self.epoch}
        if not self.goal:
            return output
        try:
            self.check_telemetry(telemetry)
            now = self.clock()
            action = self.goal["action"]
            heading = telemetry["heading"]
            if action in {"drive", "turn"}:
                if now - self.goal["at"] > (self.goal.get("duration_ms", 2500) / 1000):
                    self.cancel("Command completed")
                elif action == "turn" and abs(angle_delta(self.goal["target"] - heading)) < 2.5:
                    self.cancel("Turn completed")
                else:
                    base = (0.18 if self.goal.get("speed") == "slow" else 0.22) if action == "drive" else 0
                    if action == "drive" and self.goal["direction"] == "reverse":
                        base *= -1
                    distance = telemetry.get("distance")
                    if base > 0 and (distance is None or distance < 30):
                        raise Rejected("Forward blocked by front range")
                    output["command"] = {"angle": self.goal.get("target", self.goal["heading"]), "base": base, "rate": 0}
            elif action == "approach":
                target = self.track(self.goal["target_id"])
                error = (target["box"][0] + target["box"][2]) / 2 - .5
                correction = -self.turn_polarity * math.degrees(math.atan(error * 2 * math.tan(math.radians(35))))
                aim = heading + max(-15, min(15, correction))
                if abs(aim) > 50:
                    raise Rejected("Heading limit reached. Recenter in manual mode.")
                if self.state == "aligning":
                    if abs(error) <= .07:
                        self.state, self.message = "awaiting_range", "Centered. Verify the front sensor measures this target and enter its measured distance."
                    else:
                        output["command"] = {"angle": aim, "base": 0, "rate": 0}
                elif self.state == "approaching":
                    distance = telemetry.get("distance")
                    if not self.range_validated or distance is None:
                        raise Rejected("No validated target range")
                    if abs(angle_delta(heading - self.goal["range_heading"])) > 6 or abs(error) > .10:
                        raise Rejected("Target left the validated sensor corridor")
                    if now - self.goal["drive_at"] > 8:
                        raise Rejected("Approach time limit reached. Verify range again.")
                    if distance <= STOP_DISTANCE:
                        self.cancel("Arrived at stand-off distance")
                        self.state = "arrived"
                    elif distance > self.last_range + 15:
                        raise Rejected("Range jumped; target association uncertain")
                    else:
                        self.last_range = distance
                        # No acceleration to compensate for low power or stalled wheels.
                        output["command"] = {"angle": aim, "base": 0.18, "rate": 0}
        except Rejected as error:
            self.cancel(str(error))
            self.state = "paused"
        output.update(state=self.state, message=self.message, epoch=self.epoch)
        if not self.goal:
            output["command"] = None
        return output
