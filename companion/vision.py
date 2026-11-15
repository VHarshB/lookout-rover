"""Local OpenCV detector and conservative short-lived track IDs."""
import base64
import hashlib
import math
import time
from pathlib import Path
from .navigation import Rejected

LABELS = ("background", "aeroplane", "bicycle", "bird", "boat", "bottle", "bus",
          "car", "cat", "chair", "cow", "diningtable", "dog", "horse", "motorbike",
          "person", "pottedplant", "sheep", "sofa", "train", "tvmonitor")


def iou(a, b):
    left, top, right, bottom = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, right-left) * max(0, bottom-top)
    area = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - intersection
    return intersection / area if area > 0 else 0


class Tracker:
    def __init__(self, clock=time.monotonic):
        self.clock, self.items, self.counter = clock, [], 0

    def update(self, detections):
        now = self.clock()
        old = [v for v in self.items if now-v["at"] < .65]
        used, result = set(), []
        for d in sorted(detections, key=lambda v: -v["confidence"]):
            candidates = sorted([(iou(d["box"], v["box"]), v) for v in old
                                 if v["label"] == d["label"] and v["id"] not in used],
                                key=lambda pair: -pair[0])
            match = None
            if candidates and candidates[0][0] >= .45:
                # Ambiguous overlaps lose lock rather than silently switching ID.
                if len(candidates) == 1 or candidates[0][0] - candidates[1][0] > .15:
                    match = candidates[0][1]
            if match:
                identity = match["id"]
                used.add(identity)
            else:
                self.counter += 1
                identity = "target-" + str(self.counter)
            result.append({**d, "id": identity, "at": now, "fresh": True})
        self.items = result
        return result


class Detector:
    def __init__(self, directory=None, clock=time.monotonic):
        self.directory = Path(directory or Path(__file__).resolve().parents[1] / "models")
        self.clock = clock
        self.net = None
        self.digest = None
        self.changed_at = 0

    @property
    def ready(self):
        return all((self.directory / name).is_file() for name in ["deploy.prototxt", "mobilenet.caffemodel"])

    def detect(self, data_url):
        import cv2
        import numpy as np
        if not self.ready:
            raise Rejected("Vision model missing. Run python -m companion.setup_models")
        if not isinstance(data_url, str) or len(data_url) > 1_500_000 or not data_url.startswith("data:image/jpeg;base64,"):
            raise Rejected("Expected a bounded JPEG frame")
        try:
            data = base64.b64decode(data_url.split(",", 1)[1], validate=True)
            image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        except Exception:
            raise Rejected("Invalid image")
        if image is None or max(image.shape[:2]) > 1920:
            raise Rejected("Frame dimensions invalid")
        height, width = image.shape[:2]
        if width < height:
            raise Rejected("Frame bridge must normalize landscape before inference")
        now = self.clock()
        digest = hashlib.sha256(data).hexdigest()
        if digest != self.digest:
            self.changed_at, self.digest = now, digest
        progress = now-self.changed_at < 1.2
        if self.net is None:
            self.net = cv2.dnn.readNetFromCaffe(str(self.directory / "deploy.prototxt"), str(self.directory / "mobilenet.caffemodel"))
        start = time.perf_counter()
        blob = cv2.dnn.blobFromImage(image, 0.007843, (300, 300), 127.5, swapRB=False, crop=False)
        self.net.setInput(blob)
        output = self.net.forward()
        found = []
        for row in output[0, 0]:
            confidence, label = float(row[2]), int(row[1])
            if not math.isfinite(confidence) or confidence < .65 or not 0 < label < len(LABELS):
                continue
            box = [max(0, min(1, float(v))) for v in row[3:7]]
            if not all(math.isfinite(v) for v in box) or box[2]-box[0] < .02 or box[3]-box[1] < .02:
                continue
            found.append({"label": LABELS[label], "confidence": round(confidence, 3), "box": box})
        # SSD outputs are already suppressed by the trained detection head.
        return {"detections": found[:20], "progress": progress, "width": width, "height": height,
                "inference_ms": round((time.perf_counter()-start)*1000)}
