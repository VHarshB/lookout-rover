"""Download pinned model artifacts. No cloud calls and no robot connection."""
import hashlib
from pathlib import Path
from urllib.request import urlopen

BASE = "https://raw.githubusercontent.com/chuanqi305/MobileNet-SSD/master/"
FILES = {
 "deploy.prototxt": ("deploy.prototxt", "2d180f723b3109e21f8287f6b3c691390d07b60eed998327cd3259ffa0e50608"),
 "mobilenet.caffemodel": ("mobilenet_iter_73000.caffemodel", "52eed8be80522c152a17fb56740de705b79881bde1a167e0e747310523685fc7"),
 "LICENSE": ("LICENSE", "5de433821cfe672af2fca73c3005f48af16121c95f6a11e1031b07807ea59905"),
}


def main():
    directory = Path(__file__).resolve().parents[1] / "models"
    directory.mkdir(exist_ok=True)
    for name, (remote, expected) in FILES.items():
        path = directory / name
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
            print(name + " verified")
            continue
        data = urlopen(BASE + remote, timeout=60).read()
        if hashlib.sha256(data).hexdigest() != expected:
            raise SystemExit("Model checksum mismatch. Download refused.")
        path.write_bytes(data)
        print(name + " downloaded and verified")
    print("Model ready. Run python -m companion")


if __name__ == "__main__":
    main()
