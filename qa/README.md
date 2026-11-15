# Steering investigation and bench check

Starting point: main 652909c, matching origin/main.

Reproduced failure: the worker's successful but >=240 ms inference is discarded
forever, so calibration never completes. The regression injects 265 ms inference
and fails on 652909c. The patch stops, discards the stale pose, and switches once
from worker CPU inference to the main-thread GPU backend (existing CPU fallback).
All pose/telemetry freshness limits and controller watchdog remain unchanged.
This is a reproduced failure path, not a measured diagnosis of the actual laptop.

Steering diagnostics shows frame time/readiness, pose rejection/yaw/age,
calibration count, ZEROED state, telemetry age/reason, completed writes, last AIM
and last reply. A completed BLE write does not prove firmware parsed the command.

Run from repo root: python qa/steering_check.py (Playwright + Chrome).
Run with --baseline to reproduce the failing recovery assertion on 652909c.
Uses simulated camera and mocked inference/BLE, with real poseOf, calibration,
step, formatting, BLE write completion and notification parsing. Tests left/right
zero-base AIM in both views, ZEROED, stale-worker recovery, Stop, lost face,
hidden tab, stale telemetry, obstacle/no echo and write failure disconnect.
Actual MediaPipe inference and physical hardware are not tested.

The attached READY_FACE_V2 controller pure functions were separately checked:
AIM +/-25 0 0 yields opposing wheel effort even with no front echo; POWER_OFF
blocks motors. Firmware was not replaced.

## Physical bench check still required

1. Lift both wheels. Turn motor power on. Close XRPCode. Connect Bluetooth.
2. Open Steering diagnostics; Enable steering and look straight. Require
   calibration 7/7 and ZEROED received. Confirm STOP/ZERO completion, actual
   ZEROED reply and telemetry age below 650 ms. PONG alone is insufficient.
3. Turn left/right without speaking forward/reverse. Steering target and last
   AIM angle must change sign, with base 0. Observe opposing wheel rotation
   and Rover heading following the target.
4. Select Phone camera inside the console and repeat. Laptop frame time must
   keep advancing and the working phone video must remain connected.
5. Test Stop and Esc separately, leaving/covering webcam, and switching browser
   tabs. Each must halt wheels. Stale telemetry must halt motion too.
6. Repeat over USB. Then, on the floor in a clear area, test forward/reverse
   and forward blocking below 20 cm/no echo.

If target is fixed/blank, record frame, pose and calibration diagnostics.
If target changes but heading does not, record exact AIM/completion, telemetry,
POWER_OFF/WHEELS_STALLED/COMMAND_LOST and investigate actual receipt and motors.

Pending live verification: webcam/MediaPipe timing, Bluetooth/USB command
receipt, ZEROED/telemetry, power/encoders, wheel direction, Stop and watchdog.


## Response tuning

Tracking now prefers main-thread GPU at startup, retaining CPU fallback on
failure. Changed-target dispatch minimum is 16 ms (previously 31); heartbeat
is 80 ms (previously 115). BLE writes remain serialized and intermediate
unsent targets are not queued. Telemetry retains its 250 ms priority bound.
Angle smoothing time constants are 6/18 ms (previously 12/35); feed-forward
drops old directional momentum immediately on reversal. No predictive angle,
motor effort increase, or firmware gain change was introduced.

Mock test confirms a 16 ms reversal follows over 92% of the angle change and
reverses feed-forward immediately. This is software-filter response, not
measured end-to-end rover latency. Repeat the lifted-wheel bench check.


## Motor load and sensor investigation

Reported physical states: Turning, Motor power off, Wheels not moving.
These are actual controller telemetry, not proof of a tracking fault.
The supplied firmware's motor-power check and encoder-stall detection can
explain floor/no-load differences; actual battery voltage and wheel friction
remain unmeasured. No effort/firmware gain increases were made.

Browser feed-forward now caps at 60 degrees/s, tapers near the heading target,
and cannot push against heading correction. This reduces unnecessary saturation
and overshoot but cannot repair low battery voltage, loose wiring or friction.

POWER_OFF and WHEELS_STALLED now latch STOP, including stationary pivots.
Recovery does not automatically resume motor commands; say resume after the
fault clears with fresh telemetry. Stop/Esc and disable/re-enable do not bypass
the fault latch. Diagnostic text lists the active sensor roles.

Front distance <20 cm or no echo still blocks forward motion, not stationary
pivots/reverse. IMU drives heading control. Encoders detect stalls. The supplied
controller does not use reflectance/line sensors. No safeguards were removed.

Physical follow-up: fresh charged batteries, secure battery connector and motor
switch, power-off inspection for wheels rubbing chassis/hair/debris/caster
binding, then lifted-wheel test and a clear hard-floor test. Record voltage
under load if faults recur; do not mask POWER_OFF by increasing effort.
