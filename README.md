# ⚡ Speed Battle AI

A web-based camera game for two players. The webcam tracks both fighters in real time with
**MoveNet MultiPose Lightning**; fast, wide movements (jabs, dodges, footwork) fill each
player's progress bar. **First to 100% wins.**

## Quick start

```bash
npm install
npm run dev        # local play: http://localhost:5173
npm run dev:lan    # phone/TV play: self-signed https on your LAN IP
```

> The camera API requires a secure context. `localhost` works over plain http; opening the
> game from a phone on your network needs the `dev:lan` https variant (accept the
> self-signed certificate warning once).

The pose model (~7 MB) is fetched on first START — an internet connection is needed once.

## How to play

1. **SETUP** — enter names, pick round length, toggle TV mirror / sound, press START.
2. **CALIBRATION** — both fighters step into frame. When two people are detected for
   3 continuous seconds, the countdown (3-2-1) begins and the gong sounds.
3. **PLAYING** — move! Punch, slip, bounce. The AI measures the speed of your wrists and
   shoulders each frame; sustained fast movement fills your bar.
4. **GAME OVER** — winner, match time, peak speed and average activity are shown.
   Rematch keeps the camera running.

Left side of the screen = Player 1 (blue), right side = Player 2 (red). Roles follow
screen position, so in mirror mode you are the color you see around yourself on the TV.

## Architecture

```
src/
├── types.ts                  # GameSettings, PlayerStats, MatchResults, phases
├── App.tsx                   # Orchestration: game loop callbacks, countdown, win check
├── hooks/
│   ├── useGameState.ts       # Reducer FSM: SETUP → CALIBRATION → PLAYING → GAME_OVER
│   └── usePoseDetection.ts   # React lifecycle wrapper around the CV engine
├── cv/
│   ├── engine.ts             # Webcam + WebGL backend + MoveNet + inference/render loops
│   ├── tracking.ts           # Filtering, role assignment, EMA smoothing, persistence,
│   │                         #   keypoint-delta motion scoring (all pure + tunable)
│   └── draw.ts               # Neon bracket + label canvas rendering
├── audio/sfx.ts              # Oscillator-synthesized gong / beeps / victory fanfare
└── components/               # SetupScreen, Hud, CalibrationOverlay, GameOverScreen, …
```

### Computer-vision pipeline (per inference frame)

1. `estimatePoses` (MoveNet MultiPose Lightning, WebGL backend, built-in keypoint smoothing).
2. **Strict filtering** — poses with score < 0.3 dropped; the rest sorted by bounding-box
   area, only the **top 2 largest** kept (background people ignored).
3. **Role assignment** — the two fighters sorted by on-screen nose X: left → P1 (blue),
   right → P2 (red).
4. **Smoothing** — EMA on bounding boxes and on the speed value.
5. **Persistence** — a lost player's track survives 12 frames before expiring, so brackets
   never flicker.
6. **Scoring** — Pythagorean distance traveled by wrists + shoulders between consecutive
   frames, normalized by body diagonal (camera-distance invariant) and by Δt. A deadzone
   swallows idle jitter; a teleport guard swallows tracking glitches. The normalized speed
   (0..1) fills the bar at a difficulty-dependent rate.

Rendering is decoupled: the canvas redraws video + overlays at full display refresh rate
while inference runs at whatever rate the device manages.

All tuning knobs (deadzone, max speed, EMA factors, persistence window) are named
constants at the top of `src/cv/tracking.ts`.

## Android app (Capacitor)

The project doubles as a native Android app: the web build runs inside a Capacitor
WebView served from `https://localhost` (secure context → camera works). The MoveNet
model and the Orbitron font are bundled in `public/`, so the app is **fully offline**.

```bash
npm run build          # build the web bundle
npx cap sync android   # copy it into the native project
cd android
.\gradlew.bat assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```

Toolchain expected by the build (portable installs, no admin needed):

| Tool        | Location                          | Env var        |
| ----------- | --------------------------------- | -------------- |
| Node 24     | `D:\programming\tools\node`       | on user PATH   |
| JDK 21      | `D:\programming\tools\jdk-21`     | `JAVA_HOME`    |
| Android SDK | `D:\programming\tools\android-sdk`| `ANDROID_HOME` (also in `android/local.properties`) |

Camera permission is declared in `android/app/src/main/AndroidManifest.xml`; Capacitor's
bridge forwards the WebView's getUserMedia request to the native runtime permission
dialog automatically. A screen wake-lock keeps the display on during matches.

To install on a phone: copy `SpeedBattleAI.apk`, open it, and allow
"install unknown apps" when prompted. For a Play-Store release you'd need
`assembleRelease` plus a signing keystore.

## Tech stack

React 19 + TypeScript (Vite 8) · Tailwind CSS 4 · @tensorflow/tfjs (WebGL backend) ·
@tensorflow-models/pose-detection · HTML5 Canvas · Web Audio API · lucide-react ·
Capacitor 8 (Android)
