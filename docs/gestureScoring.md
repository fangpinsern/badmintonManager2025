# Gesture-based Scoring Plan

This document outlines how to add hand-gesture scoring while recording a badminton session. The focus is on reliable increments for either team, with clear user feedback (audio and visual). No decrements are needed.

## Goals

- Increment Team A or Team B score using simple, robust hand gestures captured by the camera during video recording.
- Give immediate feedback on successful increments: voice readout, brief flash/vibration, and on-screen confirmation.
- Run fully on-device, performant on common mobile devices, and resilient against false positives.

## Scope (V1)

- Supported actions: increment Team A, increment Team B.
- Gestures: finger count — show 1 finger → Team A, show 2 fingers → Team B.
- Feedback: SpeechSynthesis readout of score, on-screen text bubble. Optional torch flash/haptics when supported.
- Runtime: processes a downscaled camera feed and works whether or not video recording is active.

## User Flow

1. User may start recording from the Game Recorder overlay (optional).
2. User enables "Gesture scoring" (toggle) in the overlay.
3. During play, the user shows 1 finger to increment Team A, or 2 fingers to increment Team B.
4. On detection, the app increments the score, announces the new score, and shows a text bubble indicating the incremented team.
5. Gesture cooldown prevents accidental double-increments.

## Gesture Design

- Base gesture: finger count using landmarks — detect extended fingers.
- Mapping:
  - Show 1 extended finger (index) → increment Team A
  - Show 2 extended fingers (index + middle) → increment Team B
- Detection event: transition from "not-recognized" → "recognized" for the target finger count and held for ≥ 150–250 ms triggers an increment; release does not trigger anything.
- Cooldown: 1.0–1.5 s per team after a successful increment to avoid rapid repeats.
- False-positive mitigation:
  - Require the target finger count to be stable for N consecutive frames (configurable; default ~4 frames at 15 FPS).
  - Enforce a minimum bounding box size and overall landmarks confidence for the detected hand.
  - Optionally restrict to central region of interest to avoid distant players; configurable in V2.

## Technical Approach

### Hand detection

- Use MediaPipe Hands (via @mediapipe/tasks-vision or classic MediaPipe Hands JS) for robust skeletal landmarks. Handedness is not required.
- Alternative: TensorFlow.js handpose as fallback (lower priority).

### Processing pipeline

- Capture the video stream for recording as usual.
- Create a secondary analysis pipeline that:
  - Taps the same camera track or a parallel getUserMedia stream.
  - Downscales frames to ~224–320 px width to reduce CPU/GPU load.
  - Runs inference at ~12–18 FPS (adaptive to keep main UI smooth).
- Run the detector inside a Web Worker using OffscreenCanvas when available; fallback to main thread with requestIdleCallback throttling.

### Gesture recognition logic

- For each frame with landmarks:
  - For each detected hand, compute the number of extended fingers using landmark geometry (e.g., fingertip–PIP orientation relative to palm normal). Count 1 when only index is extended; count 2 when index and middle are extended; ignore thumb unless needed for stability.
  - Map finger count to team: 1 → Team A, 2 → Team B; other counts → ignore.
  - Maintain a small per-team state machine: {notRecognized, recognizing, recognizedConfirmed, cooldown} with timestamps and stable-frame counters.
  - When entering recognizedConfirmed for a team and cooldown is not active for that team, emit IncrementTeam event.
- Mirror awareness: not required for finger count; keep UI preview mirrored independently if desired.

### Threading and messaging

- Worker emits high-level events back to UI thread:
  - gesture: { team: 'A' | 'B', confidence: number, ts }
  - diagnostics (optional): fps, fingerCount, stability frames.
- UI thread debounces per-team and triggers score updates and feedback.

## Integration Points

- Game recorder: `src/components/session/GameRecorderOverlay.tsx`
  - Add a toggle to enable Gesture Scoring.
  - Start/stop the worker based on the toggle (and session UI visibility), independent of recording lifecycle.
  - Visual: show a transient text bubble over the team panel that was incremented.
- Score update: reuse existing score increment path used by manual input (centralized store or action).
  - Ensure increments triggered by gestures go through the same logic so analytics, syncing, and UI remain consistent.
- Optional settings modal: allow enabling voice readout, torch flash, haptics; tweak cooldown/hold thresholds.

## Feedback Mechanisms

- Visual: transient text bubble labeling the incremented team, e.g., "Team A +1".
- Audio (primary): `speechSynthesis.speak` of the current score, e.g., "A five, B three".
- Torch flash (optional): when supported via `ImageCapture` or `applyConstraints({ advanced: [{ torch: true }] })`; 100–200 ms pulse.
- Haptics (optional): `navigator.vibrate(60)` on supported devices.
- Graceful fallback order: voice → beep AudioContext → visual only.

## Configuration & Permissions

- Toggle: Enable Gesture Scoring (default off for V1).
- Sub-toggles (persisted per device): Voice readout, Torch, Haptics.
- Thresholds: finger count confidence/consistency, hold duration, cooldown.
- Capability checks:
  - Torch support: Android Chrome typically supports; iOS Safari support varies.
  - SpeechSynthesis: broad support; iOS may require user interaction first.
  - Vibrate: mostly Android.

## Pseudocode (reference)

```ts
type Team = "A" | "B";

interface GestureEvent {
  team: Team;
  confidence: number;
  timestamp: number;
}

// Worker loop (simplified)
onFrame((imageBitmap) => {
  const hands = detectHands(imageBitmap);
  const now = performance.now();
  for (const hand of hands) {
    const count = countExtendedFingers(hand.landmarks);
    const team = teamForCount(count); // 1 → "A", 2 → "B", else null
    updateStateMachine(team, count, now);
  }
  const evt = maybeEmitIncrement(); // returns { team, confidence, timestamp }
  if (evt) postMessage({ type: "gesture", payload: evt });
});

// UI thread
worker.onmessage = ({ data }) => {
  if (data.type === "gesture") {
    const { team } = data.payload as GestureEvent;
    if (!cooldownActiveFor(team)) {
      incrementScore(team);
      feedback(team, currentScore());
      startCooldown(team);
    }
  }
};

function feedback(team: Team, score: { A: number; B: number }) {
  showTeamTextBubble(team, "+1");
  if (speechEnabled && "speechSynthesis" in window) {
    speak(`A ${score.A}, B ${score.B}`);
  } else if (beepEnabled) {
    beep(100);
  }
  if (torchEnabled) pulseTorch(150);
  if (vibrateEnabled && "vibrate" in navigator) navigator.vibrate(60);
}
```

## Performance Targets

- Detector FPS: adaptive 12–18 on mobile; cap CPU/GPU usage to keep UI responsive.
- Latency budget: < 250 ms from gesture to increment.
- Memory: avoid large tensors; reuse buffers.

## Analytics & Logging

- Event: `gesture_detected` with team, fingerCount, confidence, device info (no PII).
- Event: `score_incremented` origin=gesture vs manual.
- Errors: detector init failed, permission denied, feature unavailable.

## Milestones

- V1 (MVP): show 1 finger → Team A, 2 fingers → Team B; voice readout; text bubble; cooldown.
- V2: optional torch/haptics, ROI restriction, settings UI refinements, analytics.
- V3: configurable gestures, better multi-person filtering, confidence visualization, offline test harness with sample clips.

## Risks & Mitigations

- Finger count ambiguity or partial occlusion → require stable frames, minimum hand size, and show onboarding hint (index only vs index+middle).
- False positives from players on court → ROI restriction and hold+cooldown; optionally require hand proximity (large bounding box).
- Device constraints (iOS torch, background throttling) → capability checks and graceful fallbacks.
- Power usage → downscale frames, adaptive FPS, pause detector when overlay minimized.

## Implementation Notes (files)

- UI: `src/components/session/GameRecorderOverlay.tsx` (toggle, text bubble feedback, lifecycle independent of recording)
- Worker: `worker/worker.js` or a new `worker/gestureWorker.js` (preferred to isolate dependencies)
- Lib: `src/lib/gestureScoring.ts` (state machine, thresholds, integration helpers)
- Settings (optional V2): integrate into existing session settings UI
