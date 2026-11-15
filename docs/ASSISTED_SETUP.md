# Assisted vision and voice: setup and operation

This branch implements the optional local companion. The public GitHub Pages
console remains the manual app. To use vision and natural-language commands,
run the local Python service and open its localhost console.

Implementation is complete for the scoped supervised prototype. Real AWS
inference and physical approach behavior require your account and bench test.
It is not a validated autonomous navigation product.

## 1. Start locally on Windows

Requirements: Python 3.10+, desktop Chrome/Edge, network access for VDO.Ninja and
AWS, and the existing READY_FACE_V2 controller on the XRP.

From the repository root in PowerShell:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\Start-Assisted.ps1
~~~

The script creates a project-local .venv, installs dependencies, downloads and
SHA-256-verifies the detector model, and starts http://127.0.0.1:8765.
It does not change system execution policy, upload firmware, create AWS
resources or enable robot movement. Leave the terminal open. Ctrl+C stops it.
Use -Port 8766 if another app owns 8765; do not stop unrelated processes.

Equivalent manual commands:

~~~powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r companion/requirements.txt
.\.venv\Scripts\python.exe -m companion.setup_models
.\.venv\Scripts\python.exe -m companion
~~~

Open the printed localhost URL. Vision and manual controls work without AWS
configuration; natural-language interpretation needs section 2. An exact Stop
never needs AWS. Assisted mode always starts off and is not persisted.

The model is MobileNet-SSD, trained on 20 VOC object classes, loaded with
OpenCV's DNN module. It detects people and supported classes such as chairs,
bottles, tables, plants, sofas, monitors, animals and vehicles. It is not an
open-vocabulary detector. Unknown objects or ambiguous instructions must be
clarified. Weights and upstream MIT license are downloaded into ignored models/.
Source: https://github.com/chuanqi305/MobileNet-SSD

OpenCV 4.x is required because this model uses the Caffe loader removed in
OpenCV 5. Model artifacts are checksum-pinned; dependency ranges are in
companion/requirements.txt.

## 2. Configure AWS without sharing secret keys

The app uses Amazon Bedrock through the Python AWS SDK. It does not ask for a
Bedrock API key. Do not paste AWS keys into chat, index.html, JavaScript,
local-config.json or Git.

At implementation time this checkout had no AWS CLI, configured profile,
region or Bedrock model. No real AWS inference request was made during tests.

1. Install AWS CLI v2 using the official Windows instructions:
   https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
2. For your **personal AWS account**, use AWS CLI v2.32.0 or newer and browser login:

~~~powershell
aws --version
aws login --profile lookout
aws sts get-caller-identity --profile lookout
~~~

Complete sign-in in your browser; the CLI creates temporary credentials. The
companion installs boto3[crt] >= 1.41, required for Python to consume this login
session. If you already installed the older requirements, update them:

~~~powershell
.\.venv\Scripts\python.exe -m pip install -r companion/requirements.txt
~~~

Your IAM user/role needs SignInLocalDevelopmentAccess for browser-based local
development sign-in and permission to invoke the selected Bedrock model. The
profile is named lookout; enter that when running companion.configure.
Sign in again with aws login when the session expires. Do not create or paste
a long-lived root access key.

Official personal-account instructions:
https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html
Python support requirements:
https://docs.aws.amazon.com/boto3/latest/guide/credentials.html

For an organization account with IAM Identity Center instead:

~~~powershell
aws configure sso --profile lookout
aws sso login --profile lookout
aws sts get-caller-identity --profile lookout
~~~

The SSO wizard needs your AWS access portal/issuer URL, SSO region, account and
role. These come from your AWS account or administrator; the SSO region can
differ from the Bedrock inference region. If SSO is not available, use your
account's supported AWS SDK credential method locally; do not create a root
access key for this app.

AWS instructions:
https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html

3. In the Bedrock console, choose a region and a model that supports Converse
   tool use. Verify your account can invoke it. Amazon Nova models with tool
   use are one option; use the exact available model or inference-profile ID,
   not its display name. Access and pricing depend on model, region and account.
   Some third-party models have activation requirements:
   https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html
4. The signed-in role needs bedrock:InvokeModel for the selected model, and any
   required inference-profile resources. Ask your account administrator for
   appropriately scoped access rather than adding broad administrator access.
5. In a second terminal, from the repo root, run:

~~~powershell
.\.venv\Scripts\python.exe -m companion.configure
~~~

Enter only the non-secret profile name, Bedrock region, and exact model/profile
ID. These are stored in ignored companion/local-config.json. Restart the local
service after changing configuration or renewing authentication if needed.

Alternatively set AWS_PROFILE, AWS_REGION and LOOKOUT_BEDROCK_MODEL_ID in the
service's shell. Environment values override local configuration. .env.example
is a reference only; dotenv files are not automatically loaded.

Only explicit command text, short recent command context, and visible target
IDs/classes/horizontal locations are sent to Bedrock. Camera images are
processed locally and are not sent to AWS by this code. Existing browser
speech recognition may still use the browser's speech service when on-device
recognition is unavailable. Bedrock usage can incur charges; calls occur for
explicit interpreted requests, not every video frame. Stop, confirmation,
range checks and the control loop run locally.

## 3. Keep the existing phone pairing

localhost and GitHub Pages have separate browser storage.

Before creating a new pairing, copy the saved private phone link from the
existing Pages console's Phone camera setup. In the localhost console, expand
Assisted vision & voice, paste it into Use existing phone link, and import it.
The local console reloads with the same pairing; it does not overwrite the
Pages browser's saved data.

Phone URLs generated locally still point to the public rover-phone.html entry
page. They must not point to 127.0.0.1 on the phone. The public phone entry page
redirects to the existing VDO sender. Close duplicate sender tabs to avoid the
stream-in-use error. Keep one sender open and allow the rear camera.

The receiver remains the original VDO.Ninja iframe. The new bridge requests
snapshots with the documented getVideoFrame API, validates origin/source and
correlation ID, normalizes portrait frames to the existing landscape view,
and sends bounded JPEG frames to the local detector. It never reads the
cross-origin iframe DOM.

## 4. First run: observation only

1. Connect the board and use the normal Enable steering/calibration sequence.
   Resolve POWER_OFF, WHEELS_STALLED and command-loss issues in manual mode first.
2. Select Phone camera and verify live video. Keep the laptop webcam running.
3. Expand Assisted vision & voice and enable Assisted mode. Existing manual
   translation is cancelled; head steering no longer produces heading commands
   until you return to manual. Head presence remains a safety requirement.
4. Detections appear as boxes and accessible target buttons. Select a target.
   Selection alone never moves the rover.
5. Enter a command. The app shows its interpretation and asks for confirmation.
   With several matching people, "that person" requires selection or clarification.

No AWS request is necessary to inspect detection boxes. Missing AWS setup gives
an actionable message without enabling movement.

## 5. Voice operation

The existing recognizer is reused. In Assisted mode, say Rover before a natural
request, or click Use next spoken phrase and speak once. This prevents ordinary
conversation from making repeated AWS calls.

Examples:
- Rover turn left a little.
- Rover move forward slowly for half a second.
- Rover approach the person on the right.
- Rover go to that person. (Select the person first if there are several.)
- Rover confirm.
- Stop.
- Rover manual mode.

The model supports bounded drive duration, not measured-distance driving.
"Drive two meters," complex routes or continuous following must be clarified.
Recent clarification context is kept in memory for the current assisted session.

Interim emergency Stop remains immediate and local. Final requests are sent for
interpretation. Confirm and Cancel are also available as buttons. Resume and
recenter use the existing guarded manual path and return control to manual mode.

## 6. Direction validation and supervised approach

First lift both wheels. Verify the existing left/right heading convention and
camera mounting with a small turn. In the Assisted panel select the normal
rear-camera axis or reversed axis to match physical behavior, then check the
direction-verification box. Repeat this after changing camera mounting.
The checkbox resets when Assisted mode is re-enabled.

For approach:
1. Select a stationary target in a clear floor area; ask to approach it.
2. Review the selected box and confirm. The rover only pivots to center it.
3. When centered, the app waits for a range check. Verify the selected target
   is actually in the front ultrasonic beam, the sensor is aimed appropriately,
   and no intervening surface or obstacle is being measured.
4. Measure the current target distance with a tape (70-300 cm). Enter it and
   check the sensor/clear-path confirmation. The current front reading must
   agree within 8 cm or 10%, whichever is larger.
5. Verify range and approach. It uses a bounded 0.18 forward effort, stops at
   60 cm, and cancels on uncertainty or after eight seconds.

For a voice range confirmation, after personally verifying those conditions,
say: Rover verify sensor target at 100 centimeters and clear path.
Replace 100 with the actual measured distance. This invokes the same range
checks as the button; the language model cannot invent or waive the measurement.

A generic person's detection box is not treated as metric depth. The front
sensor is only usable here under the explicit target/beam association check.
The target must stay within the validated central corridor; moving targets,
heading drift beyond six degrees, a large range jump, target loss, frozen
video, or missing range cancel the approach. No automatic target reacquisition,
obstacle bypass, global route planning or continued following is implemented.

## 7. Control and failure behavior

- One command producer owns motion: manual or Assisted, never both.
- All proposals require confirmation. Limits are validated locally, not trusted
  to the language model.
- V2 is required for assisted motion. Existing +/-55 degree protocol limits
  remain; Assisted mode stays within +/-50 degrees and +/-0.22 base effort.
- Drive duration is bounded to 200-1500 ms; turns to 3-25 degrees and 2.5 seconds.
- New commands cancel previous intent before AWS is called.
- Stop/Esc, manual return, disable/disconnect, inactive page, lost operator
  tracking, stale telemetry and motor faults still stop movement.
- Browser commands expire after 220 ms, local tick responses over 200 ms are
  withheld, and visual commands require observations under 650 ms old.
- Local session leases expire after two seconds without ticks. The board's
  independent existing watchdog still stops after 400 ms without AIM.
- Late AWS replies cannot restore cancelled proposals. AWS never gets direct
  motor access. A closed service does not fall back into manual steering while
  Assisted mode remains selected; the operator must explicitly return to manual.
- Byte-identical frames for 1.2 seconds are treated as possibly frozen.
  This can conservatively pause an unusually static scene; it is not proof of
  capture timestamps or physical scene motion.
- IoU target IDs are conservative short-term tracks, not person identity.
  Crossing/occlusion can lose a track; the system must stop and reconfirm.

The service listens only on 127.0.0.1. APIs require a per-process token injected
into the local page and a console ID; other origins/hosts are rejected. Only
allowlisted static files are served. Credentials, models and local configuration
are ignored by Git.

## 8. What was tested

- python -m unittest discover -s tests -v:
  intent validation, ambiguity, leases, confirmation, heading bounds, target
  loss/freeze, range checks, stand-off stop, motor faults, HTTP origin/token/path
  checks, and cancellation while a mocked AWS reply is in flight.
- python qa/steering_check.py:
  existing manual steering/transport/safety regression.
- python qa/assisted_browser_check.py:
  actual VDO.Ninja transport with a simulated phone camera, real OpenCV person
  detection, selection/confirmation, mocked XRP zero-base alignment, Esc stop,
  manual return, mobile overflow, and range-confirmation/arrival UI with a
  centered perception fixture. AWS and physical XRP are mocked.
- Screenshots were captured and inspected at desktop and narrow widths.
  Test camera material is the OpenCV basketball sample, not a physical rover.

Playwright is an optional QA dependency. Install it into the environment used
for tests; the browser checks currently use installed Windows Chrome.
Do not interpret mocked AWS success or write completion as live account
validation or proof of wheel response.

## 9. Physical acceptance still required

With wheels lifted: validate polarity, STOP/ZERO/ZEROED, bounded turn/drive,
Stop/Esc, closing the service, switching browser tabs, disconnecting the phone,
and motor-fault behavior. Then test a stationary object in a clear hard-floor
area with a spotter, measured starting distance and the 60 cm stand-off stop.
Test target occlusion, a person crossing, no echo and an intervening obstacle.
Resolve all intermittent power/stall reports before any person approach.

No firmware was uploaded or changed. No real AWS account request or physical
rover movement was performed by these automated checks.
