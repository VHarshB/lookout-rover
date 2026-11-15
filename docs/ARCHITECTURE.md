# Architecture: from hands-free control to visual navigation

**Implementation update:** the optional local companion is implemented on feature/assisted-vision-navigation. See [setup and operating limits](ASSISTED_SETUP.md). The manual baseline and the original broader design below remain reference material; general path planning and reliable autonomous obstacle routing are still future work.


Lookout Rover is a browser-controlled XRP with two independent vision paths: operator head tracking for manual steering, and a vehicle-mounted phone stream for seeing the surroundings. The proposed OpenCV extension adds perception and navigation to the vehicle stream.

**Current** in the manual baseline sections means present at bb89619. Later design sections describe the broader roadmap; the local prototype now implements detection, target selection, Bedrock intent interpretation, explicit authority and supervised range-validated approach. Board behavior is based on the supplied READY_FACE_V2 controller; that firmware is external to this repository.

## 1. Deployment and physical connections — current

~~~mermaid
flowchart TB
    subgraph Internet["Hosting and services"]
        GH["GitHub Pages<br/>index.html · scripts · styles · fonts"]
        Assets["MediaPipe bundle and model<br/>QR library"]
        Signal["VDO.Ninja signaling<br/>STUN / TURN fallback"]
        SpeechCloud["Browser speech service<br/>when local recognition unavailable"]
    end
    subgraph Laptop["Operator laptop"]
        Webcam["Webcam"]
        Mic["Microphone"]
        UI["Console<br/>render + state + command routing"]
        Worker["Tracking worker<br/>MediaPipe Face Landmarker"]
        Receiver["VDO.Ninja iframe viewer"]
        Transport["RedBoardConnection"]
    end
    subgraph Vehicle["XRP vehicle"]
        Phone["Mounted phone<br/>rear camera / VDO sender"]
        MCU["Red Board<br/>MicroPython + XRPLib controller"]
        Drive["Differential drive<br/>left / right wheel"]
        IMU["IMU heading"]
        Range["Front ultrasonic range"]
        Encoder["Wheel encoders"]
        Power["Motor power reporting"]
    end
    GH -->|"HTTPS files"| UI
    Assets -->|"Load libraries/model"| UI
    Webcam -->|"Video frames"| Worker
    Worker -->|"Head yaw + face bounds"| UI
    Mic -->|"SpeechRecognition"| UI
    UI -.->|"Fallback recognition"| SpeechCloud
    Phone -.->|"Connection setup"| Signal
    Receiver -.->|"Connection setup"| Signal
    Phone -->|"WebRTC media: direct or TURN-relayed"| Receiver
    Receiver -->|"Connection events and stats"| UI
    UI --> Transport
    Transport <-->|"BLE Nordic UART or USB serial"| MCU
    IMU --> MCU
    Range --> MCU
    Encoder --> MCU
    Power --> MCU
    MCU -->|"Bounded effort"| Drive
~~~

The phone is physically mounted on the rover, but its network stream is separate from the Bluetooth motor-control link. The laptop is the operator/control computer. The Red Board runs the motor loop locally. There is no application server or Python vision process in the current repo.

Hoot reads displayed state and telemetry to animate the companion. It does not drive the motors. theme.css changes presentation, not control authority.

## 2. Runtime control sequence — current

~~~mermaid
sequenceDiagram
    actor Operator
    participant App as Laptop console
    participant Tracker as Laptop tracking worker
    participant HardwareTransport as BLE / USB transport
    participant XRP as XRP controller
    participant Motors as Motors and sensors

    Operator->>App: Connect Bluetooth / USB
    App->>HardwareTransport: Open hardware channel
    HardwareTransport->>XRP: Start or attach controller, PING
    XRP-->>App: READY banner when started, PONG
    Note over App,XRP: Bluetooth also probes V2 TELEMETRY
    Operator->>App: Enable steering
    App->>Tracker: Load model, warm backend, process laptop frames
    Tracker-->>App: Valid head pose
    Operator->>Tracker: Look straight
    App->>App: Seven stable yaw samples establish neutral
    App->>XRP: STOP then ZERO
    XRP->>Motors: Stop, capture heading reference
    XRP-->>App: ZEROED
    loop While enabled, active, fresh and unblocked
        Tracker-->>App: Head yaw relative to neutral
        App->>App: Filter yaw, compute bounded target and rate assist
        App->>XRP: AIM angle base rate
        XRP->>Motors: Heading feedback control and sensor checks
        App->>XRP: TELEMETRY
        XRP-->>App: Heading, front distance, state
    end
    Operator->>App: Stop / Esc
    App->>XRP: STOP
    XRP->>Motors: Zero effort
~~~

The phone viewer runs alongside this loop. Choosing the Phone camera tab does not replace the laptop webcam as the head-tracking source.

## 3. Software responsibilities — current

| Component | Input | Output / responsibility |
| --- | --- | --- |
| openLaptopCamera | Camera permission, requested video constraints | Laptop MediaStream |
| Tracking worker / loadModel | Video frame, MediaPipe model | Facial transformation matrix and landmarks |
| poseOf | Matrix and landmarks | Validated yaw and face bounds, or rejection reason |
| acceptPose / calibration | Fresh valid yaw samples | Neutral orientation, filtered face angle, angular rate |
| Voice recognizer / spoken | Microphone transcript | Routed stop/resume/recenter/directional command |
| step | Target, voice state, health and telemetry | Poll, STOP, arm or bounded AIM |
| RedBoardConnection | Internal command objects | USB or BLE text writes and parsed replies |
| Board controller | STOP / ZERO / AIM / telemetry requests | Local motor effort, heading feedback and watchdog |
| Phone viewer integration | Pairing, VDO iframe events/stats | Live vehicle view and connection state |
| Diagnostics | Frame/pose/write/stop events | Operator-visible troubleshooting information |

Voice translates speech into a small command vocabulary. "Mic heard" is recognizer output; "Rover accepted" is command routing feedback. Current speech recognition does not identify objects or understand arbitrary navigation goals.

### Wire protocol

| Direction | Message | Meaning |
| --- | --- | --- |
| App to board | PING | Check controller responsiveness |
| Board to app | PONG | Controller responded; not proof of motor motion |
| App to board | STOP | Cancel motion |
| App to board | ZERO | Stop and zero the heading reference |
| Board to app | ZEROED | Arming heading reference acknowledged |
| App to board | AIM angle base rate | V2 heading goal, forward/reverse effort and angular-rate assist |
| App to board | TELEMETRY | Request V2 feedback |
| Board to app | TELEMETRY heading distance reason | Heading in degrees, distance in cm or NA, controller state |

Legacy V1 uses STATUS and AIM without the rate field. The current browser limits V2 angle to +/-55 degrees relative to the zero reference and base effort to +/-0.28. A head-only pivot uses base 0. Voice left/right adjusts heading; voice forward/reverse sets translation separately.

### Timing and safeguards

These are code limits, not guaranteed physical latency.

| Check | Current behavior |
| --- | --- |
| Tracking sampling gate | 16 ms minimum |
| Valid pose age | Less than 240 ms |
| Fresh telemetry required | At most 650 ms old for movement |
| Changed AIM minimum interval | Bluetooth 32 ms; USB 16 ms |
| Unchanged AIM heartbeat | Bluetooth 100 ms; USB 80 ms |
| Telemetry polling | Nominal 165 ms; priority when 250 ms due and a write slot is free |
| Board motion watchdog | 400 ms without a motion update in the supplied controller |
| Forward distance guard | Stop below 20 cm or without a valid echo |
| Motor power / wheel stall | Latch Stop; fresh non-fault telemetry and explicit resume needed |
| Stop/Esc / inactive browser tab | Cancel movement; hidden page pauses tracking/control |

Head tracking is required for current movement, including voice-driven forward/reverse. Stationary pivots and reverse are not blocked solely by front No echo. IMU heading, not phone vision, closes the current turning loop. No reflectance/line sensor is used in the supplied controller.

## 4. Visual navigation architecture — planned

**Goal:** the operator refers to a visible target, and the rover approaches that target using continuous perception and local safety feedback.

~~~mermaid
flowchart TB
    subgraph Existing["Existing components retained"]
        Phone["Vehicle phone camera"]
        Feed["VDO.Ninja live viewer"]
        Voice["Voice recognizer"]
        Manual["Manual head steering"]
        Link["BLE / USB transport"]
        Board["XRP controller<br/>local watchdog / sensors"]
        Stop["Stop / Esc"]
    end
    subgraph New["Planned laptop-side components"]
        Bridge["Frame bridge<br/>stream ID, orientation, timestamps"]
        CV["Vision worker<br/>OpenCV + trained detection model"]
        Tracks["Track store<br/>ID, label, box, confidence, freshness"]
        Intent["Goal parser and target resolver<br/>speech + click selection"]
        Goal["Confirmed navigation goal<br/>target ID and stand-off distance"]
        Range["Bearing / range estimator<br/>calibrated geometry or depth"]
        Nav["Approach controller<br/>later: localization and path planning"]
        Gate["Single motion authority<br/>manual / assisted / autonomy"]
    end

    Phone --> Feed
    Feed --> Bridge
    Bridge --> CV
    CV --> Tracks
    Voice --> Intent
    Tracks --> Intent
    Intent --> Goal
    Goal --> Nav
    Tracks --> Range
    Range --> Nav
    Board -->|"Heading, front range, motor health"| Nav
    Nav -->|"Bounded short-lived intent"| Gate
    Manual --> Gate
    Stop -->|"Always overrides"| Gate
    Gate --> Link
    Link --> Board
    Tracks -->|"Highlights and target lock"| Feed
~~~

All nodes inside New are design proposals, not existing modules.

### Frame access: the first integration step

The current video lives inside a cross-origin VDO.Ninja iframe. The parent app cannot simply query its video element or pass the iframe to cv.VideoCapture.

For a first prototype, preserve the working phone stream and request frames through VDO.Ninja's documented getVideoFrame or snapshot postMessage API. Validate response origin and source, correlate stream/frame IDs and timestamps, and normalize the forced-landscape orientation. These APIs and their performance must be verified against the deployed service. The repo currently uses stats/events, not frame extraction. See the [official frame API documentation](https://docs.vdo.ninja/guides/iframe-api-documentation/iframe-api-basics).

Start with a small measured frame rate, one outstanding frame/inference request, and a latest-frame-only buffer. Discard stale work rather than queueing seconds of video. Processing happens on the laptop; OpenCV does not need to run on the phone just because the video originates there.

Use a separate vision worker to avoid blocking head tracking, serial/BLE callbacks, Stop or UI rendering. OpenCV.js supplies image operations and supports DNN inference with a compatible model/build; detection requires model weights, class labels and validated preprocessing, not only loading OpenCV. See [OpenCV's detection example](https://docs.opencv.org/4.12.0/d0/d0f/tutorial_js_object_detection.html).

If encoded snapshot transfer is too expensive, evaluate a supported VDO SDK MediaStream receiver, or a dedicated WebRTC receiver rather than increasing the snapshot queue. A later Python OpenCV service would be a new deployment component; GitHub Pages cannot run it. A custom aiortc receiver needs compatible signaling and media integration, not merely a VDO viewer URL passed to cv2.VideoCapture. See [aiortc's receiver API](https://aiortc.readthedocs.io/en/latest/api.html).

### From speech to a specific target

"That person" is ambiguous if several people are visible. Start with click-to-select among highlighted detections, followed by explicit confirmation. A tracked target needs a stable ID; do not silently change to the nearest newly detected person when the original disappears.

The planned goal record contains target ID, class, selected frame ID, timestamp, allowed mode and stop distance. Transcripts do not become motor commands directly. First show what the mic heard, then the resolved target, then whether navigation was accepted.

Detection finds objects in a frame. Tracking maintains identity between frames. Range estimation establishes distance. Navigation decides how to approach. These are separate jobs.

### Approach versus full path planning

The first motion milestone is a slow supervised approach through a clear area:
align to the selected target's bearing, move forward only while observations and range are valid, continuously update, and stop at a stand-off distance.

A bounding-box size is not a reliable metric distance for arbitrary people or objects. Calibrated known-size markers can support an early controlled demonstration. A depth sensor, validated monocular geometry or another range source is needed for a stronger solution. The front ultrasonic reading measures its own beam, not necessarily the selected object, and can report an obstacle in front of it instead.

Driving around objects to a destination additionally requires localization/odometry, free-space or obstacle representation, route planning and a local controller. One forward rangefinder cannot establish a safe route around side obstacles or drop-offs. The OpenCV addition alone does not provide those capabilities.

The current +/-55 degree AIM protocol is suitable for bounded heading goals around a zero reference, not arbitrary global routes. Protocol/control changes for larger navigation maneuvers must be designed and tested explicitly. Do not bypass its limits with raw commands.

## 5. Navigation state machine — planned

~~~mermaid
stateDiagram-v2
    [*] --> Manual
    Manual --> Selecting: Request visual navigation
    Selecting --> Confirming: Choose visible target
    Confirming --> Aligning: Confirm target and authority
    Aligning --> Approaching: Bearing and range valid
    Approaching --> Aligning: Heading correction needed
    Approaching --> Arrived: Stand-off distance reached
    Arrived --> Manual: Acknowledge
    Selecting --> Manual: Cancel
    Confirming --> Manual: Cancel
    Aligning --> Paused: Target lost or stale / obstacle
    Approaching --> Paused: Target lost or stale / obstacle
    Aligning --> Stopped: Stop / fault / watchdog
    Approaching --> Stopped: Stop / fault / watchdog
    Paused --> Confirming: Operator confirms safe recovery
    Paused --> Stopped: Stop
    Stopped --> Manual: Fault cleared and explicit resume
~~~

One authority gate chooses the active command producer. Proposed rule: explicit mode selection hands control to autonomy; manual override cancels the autonomous goal; Stop/Esc wins in every mode. Do not blend head yaw and autonomous heading without a defined policy.

Current head-tracking freshness remains required until an explicit autonomous mode is implemented. A future change that allows movement without a visible operator face is a safety-policy change, not an incidental refactor.

## 6. Build order and acceptance criteria

| Phase | Deliverable | Evidence required before next phase |
| --- | --- | --- |
| 0 | Reliable manual rover | Stable power, encoders, steering and loaded movement; Stop and watchdog validated physically |
| 1 | Frame bridge and observation overlay | Correct orientation, measured frame age, stable updates, no degradation of head tracking or Stop |
| 2 | Detection, tracking and target selection | Repeatable classes/IDs; ambiguity resolved; occlusion/loss causes no identity jump; no movement yet |
| 3 | Validated range / bearing | Known test targets, calibrated camera mounting, measured range error; reject unknown geometry |
| 4 | Supervised target approach | Wheels-lifted checks followed by clear-area tests; bounded speed and stand-off stop; no autonomous obstacle bypass |
| 5 | Route planning | Validated localization and wider obstacle sensing; avoidance tests and recovery policy |

Measure capture-to-observation age, inference duration, dropped frames, control-write completion, telemetry age, target loss and physical stop distance. Values must be measured under the phone stream, tracking and voice running together. Browser mocks do not prove motor behavior or collision avoidance.

## 7. What changes, and what stays

The first OpenCV milestone adds perception and overlays; it does not change the active phone pairing, Bluetooth/USB transport or firmware. Navigation later adds a goal parser, tracker/range estimator, authority gate and a bounded command adapter. Board-side safety remains local.

The optional companion now includes OpenCV, a pinned detector download, frame bridge, deterministic approach controller and local Python service. A general autonomous path planner is not implemented. phone-link.js is a legacy PeerJS implementation, not the current video pipeline. There is no custom GitHub Actions workflow in this tree; Pages currently publishes main through its configured Pages deployment.

This document includes the original broader architecture roadmap. Start the optional prototype through the setup guide; reading this document or opening GitHub Pages does not activate assisted movement.
