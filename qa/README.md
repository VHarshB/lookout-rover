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
