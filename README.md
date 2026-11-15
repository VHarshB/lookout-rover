# Lookout Rover

**Lookout Rover is a browser-controlled XRP robot that combines hands-free head steering, voice commands, and a live vehicle-mounted phone camera.**

The optional local companion adds **voice-directed visual approach**: detect people and supported objects in the rover camera, resolve natural-language requests through AWS Bedrock, and supervise a selected-target approach through a clear area. Code and mocked control tests are implemented; live AWS access and physical motion validation still require setup. General route planning is not implemented.

**Start here:** [Windows launch, AWS authentication, phone pairing and first-use guide](docs/ASSISTED_SETUP.md). The public Pages console remains the manual app; Assisted mode is only available when running the local Python service.

[Open the operator console](https://vharshb.github.io/lookout-rover/) · [Detailed architecture and diagrams](docs/ARCHITECTURE.md) · [Testing and physical bench checks](qa/README.md)

## What it does

| Capability | Current status |
| --- | --- |
| Connect an XRP Red Board over Bluetooth or USB | Implemented |
| Calibrate and steer by turning your head, including stationary pivots | Implemented; uses the laptop webcam |
| Speak forward, reverse, left, right, stop, resume and recenter commands | Implemented |
| View landscape video from a phone mounted on the rover | Implemented; VDO.Ninja / WebRTC |
| Stop/Esc, tracking and telemetry freshness checks, obstacle and motor-fault handling | Implemented; physical validation remains necessary |
| Detect and track supported people/objects with OpenCV | Implemented in optional local Python companion |
| Natural-language requests and visible target selection | Implemented Bedrock adapter; requires configured AWS access |
| Supervised approach to a stationary selected target | Implemented with explicit sensor/target range validation; physical verification pending |
| Find a route around obstacles to a target | Later phase; needs localization and adequate obstacle sensing |

## What connects to what

Solid arrows below describe the current system. The phone streams the surroundings; the laptop webcam watches the operator.

~~~mermaid
flowchart LR
    Operator["Operator"]
    Webcam["Laptop webcam"]
    Mic["Laptop microphone"]
    Browser["Laptop operator console<br/>HTML / CSS / JavaScript"]
    Phone["Phone on rover<br/>Rear camera"]
    VDO["VDO.Ninja<br/>WebRTC connection"]
    Board["XRP Red Board<br/>MicroPython controller"]
    Motors["Left and right motors"]
    Sensors["IMU · front rangefinder<br/>wheel encoders"]
    Pages["GitHub Pages<br/>Static app hosting"]

    Pages -->|"HTTPS: app files"| Browser
    Operator -->|"Head gestures"| Webcam
    Operator -->|"Voice"| Mic
    Webcam -->|"MediaPipe head pose"| Browser
    Mic -->|"Speech recognition"| Browser
    Phone -->|"Live video over network"| VDO
    VDO -->|"Embedded viewer"| Browser
    Browser -->|"Bluetooth BLE UART or USB serial<br/>STOP · ZERO · AIM · TELEMETRY"| Board
    Board -->|"Motor effort"| Motors
    Sensors -->|"Local feedback"| Board
    Board -->|"Heading · distance · state"| Browser
~~~

VDO.Ninja establishes the media connection; video can travel directly between peers or through TURN fallback. GitHub Pages serves the app files and does not carry motor commands or host a Python backend.

## How it works today

1. **Connect:** open the console in desktop Chrome/Edge over HTTPS and connect Bluetooth or USB. The app starts or attaches to the board controller and checks its replies.
2. **See the rover's view:** open Phone camera setup, scan the pairing QR code on the vehicle-mounted phone, allow the rear camera, and keep the sender open.
3. **Enable and center:** Enable steering starts laptop head tracking and voice recognition. Look straight for calibration; the console sends STOP/ZERO and waits for ZEROED.
4. **Steer:** left/right head yaw becomes a bounded heading target. The board uses IMU feedback to pivot toward it. Forward and reverse are separate voice commands.
5. **Monitor and stop:** heading, front distance, and accepted commands are shown live. Stop/Esc overrides motion. Losing valid tracking, fresh telemetry, or the active browser tab pauses control. Motor-power/stall faults latch a stop.

Selecting Phone camera inside the console keeps laptop head tracking active. Switching away from the browser tab pauses motion. The phone camera is not currently used to steer.

## What it is built with

| Layer | Technology and role |
| --- | --- |
| Console | Static HTML, CSS and JavaScript; no frontend build step |
| Operator head tracking | MediaPipe Tasks Vision Face Landmarker, running in a worker with GPU preference and fallback |
| Voice input | Browser speech recognition; on-device recognition where available, browser speech service fallback |
| Rover video | Phone rear camera, VDO.Ninja, WebRTC, saved private pairing link and QR code |
| Hardware transport | Web Bluetooth Nordic UART service, or Web Serial |
| Board control | External /lookout_face_control.py on the XRP; MicroPython and XRPLib |
| Feedback | IMU heading, front ultrasonic rangefinder, wheel encoder stall checks and motor-power reporting |
| Visual identity | theme.css, local fonts and the Hoot SVG companion in mascot.js |
| Hosting | GitHub Pages from main; third-party assets/model loaded where referenced |

The board controller is required on the XRP but is **not currently tracked in this repository**. This description also references the supplied READY_FACE_V2 controller. The variable named socket in index.html wraps hardware transport; it is not a WebSocket backend.

## OpenCV + "go to that person" — planned addition

The local companion processes the phone video **on the laptop**, while the phone remains the camera source. OpenCV supplies image-processing/tracking tools; a trained detection model supplies person/object recognition. The navigation controller is a separate component.

~~~mermaid
flowchart LR
    Video["Live vehicle phone video"] --> Frames["Frame bridge<br/>timestamps + orientation"]
    Frames --> Vision["Local Python OpenCV + model<br/>detect and track targets"]
    Voice["Voice: Go to that person"] --> Resolve["Resolve target<br/>highlight / select / confirm"]
    Vision --> Resolve
    Resolve --> Goal["Locked target ID"]
    Goal --> Navigate["Approach controller<br/>bearing + range + target tracking"]
    Vision --> Navigate
    Feedback["Rover telemetry<br/>range / heading / health"] --> Navigate
    Navigate --> Gate["Control authority + safety gate"]
    Manual["Head steering / manual commands"] --> Gate
    Stop["Stop / Esc"] --> Gate
    Gate --> Transport["Existing BLE / USB transport"]
    Transport --> XRP["XRP controller + local watchdog"]
    XRP --> Feedback
~~~

**Example:** select a highlighted stationary person, say "Rover approach that person," review the interpreted goal and confirm. The controller aligns, then waits for explicit validation that the front sensor measures the selected target at the operator's measured distance. It approaches only inside that validated corridor and stops at 60 cm, on uncertainty, or after eight seconds. Physical sensor alignment and motor behavior must be bench-tested first.

Use detection and target selection **without movement** first, then complete the supervised approach bench procedure in a clear area. Finding a route around arbitrary obstacles comes after reliable range, localization and obstacle coverage are available. A detection box and the existing single front sensor are not enough for general autonomous navigation.

The [architecture document](docs/ARCHITECTURE.md) explains the frame bridge, control ownership, missing components, navigation states and implementation order.

## Repository map

- index.html — console, head/voice control, Bluetooth/USB transport, telemetry, phone viewer integration and diagnostics.
- phone-video.js — active VDO.Ninja pairing and sender/viewer URL generation.
- rover-phone.html — phone entry page that opens the rear-camera sender.
- phone-link.js — older PeerJS phone/intercom implementation; not loaded by the current console.
- mascot.js — Hoot animation, state reactions and optional audio.
- theme.css and assets/fonts/ — theme and bundled typefaces.
- qa/ — browser regression scripts and physical bench procedures.
- docs/ARCHITECTURE.md — current system and proposed vision-navigation design.

For local preview, serve the repository with a static web server, for example python -m http.server 8765, then open http://localhost:8765. Camera and hardware access require a secure context, supported browser, user permissions and actual hardware.

## Validation status

Browser regression checks include mocked transport and real-model tests with a portrait fixture. They do not establish reliable physical motor response. Intermittent power/stall reports and loaded wheel behavior must be resolved and bench-tested before enabling autonomous movement. See [QA notes](qa/README.md).

Manual architecture baseline: bb89619. The optional companion is isolated on feature/assisted-vision-navigation, off by default. Firmware is unchanged; live AWS and physical rover acceptance are pending.
