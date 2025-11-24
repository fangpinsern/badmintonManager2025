## Person Tracking & Player Movement Analytics Plan

### Goals

- **Heat map per player**: 2D occupancy over the court surface (per game, per session).
- **Movement metrics**: time moving vs stationary, total distance, average/peak speed.
- **Zones/time split**: time spent in service boxes, fore/back court, left/right halves.
- **Output formats**: persisted features for fast rendering; raw tracks for recalculation.

### Constraints and Assumptions

- **Platform**: Next.js PWA, mobile-first; recordings produced via `GameRecorderOverlay`.
- **Ecosystem**: Firebase Auth, Firestore, Firebase Storage already in use.
- **Compute**: Client devices vary; on-device real-time ML is limited on iOS Safari. Cloud processing is acceptable for batch/offline.
- **Privacy**: Explicit user consent is required; only club/session admins can initiate processing.

### Architecture Options

1. **Client-only (Web ML)**

   - JS runtime: TensorFlow.js or onnxruntime-web (WebGL/WebGPU/WASM).
   - Pros: No backend cost, low-latency previews.
   - Cons: Battery-heavy, device variability; multi-person tracking and court calibration are non-trivial on-device.

2. **Server-only (Batch)**

   - Upload full recording → GPU-backed service processes offline → analytics available later.
   - Pros: Highest quality, consistent results, scalable.
   - Cons: Latency until results are ready; backend cost.

3. **Hybrid (Recommended MVP)**
   - Client extracts low-FPS frames and uploads video to Storage; Cloud Run job processes asynchronously.
   - Optional on-device “preview mode” renders a coarse heat map during recording at 2–5 FPS.

### Proposed MVP

- Implement the hybrid flow with batch cloud processing and optional lightweight client preview. Focus on robust tracking, reliable court calibration, and clean data outputs for heat maps and movement stats.

### End-to-End Pipeline

1. **Ingestion**

   - Source: Existing session video(s) or newly recorded clips.
   - Storage: Upload to `gs://<bucket>/sessions/{sessionId}/games/{gameId}/raw/{videoId}.mp4`.
   - Firestore doc: `sessions/{sessionId}/games/{gameId}/tracking` with status fields: `status: queued|processing|ready|error`, `videoRefs`, `createdAt`, `updatedAt`.

2. **Court Calibration**

   - Primary: Automatic court line detection (Hough on canny edges + geometric constraints) or a light model for badminton court keypoints.
   - Fallback: Manual 4-corner selection UI (homography computed from user clicks on frame + real-world court coordinates).
   - Output: Homography matrix H to map pixel coordinates → normalized court coordinates
     \( (x, y) \in [0,1] \times [0,1] \) where (0,0) is one back-left corner.

3. **Person Detection & Pose (per frame)**

   - Model: YOLOv8n/v8s person detector (Ultralytics) or YOLOv5s; optionally pose with YOLOv8-pose.
   - Sampling rate: 10 FPS for MVP; configurable per clip length.
   - Output per frame: list of detections {bbox, score}, optional keypoints.

4. **Multi-Object Tracking**

   - Tracker: ByteTrack (fast, robust) or OC-SORT; optional DeepSORT re-id for occlusion robustness.
   - Output: tracks {trackId → sequence of (t, bbox, score)}.

5. **Identity Assignment (Track → Player)**

   - Initial heuristic: side-of-court and serve/receive metadata; optional jersey color histogram.
   - UI mapping: Allow admins to map `trackId` to player profile at key timestamps; persist mapping, auto-propagate.

6. **Coordinate Transform**

   - Convert bbox centers (or feet keypoints) via H to normalized court coords, filter with Kalman/savitzky-golay.
   - Handle camera drift by segmenting the video if necessary or refreshing H on cuts.

7. **Feature Extraction**

   - Heat map: 2D histogram over court grid (e.g., 48x24 bins), per player and time window.
   - Movement: total distance, mean/peak speed, time moving vs stationary (speed threshold), per rally if rally segmentation available.
   - Zone dwell times: fraction of time in service boxes, mid, rear.

8. **Persistence**

   - Heavy data (tracks, per-frame coords): JSON in Storage `.../derived/tracks_{gameId}.json.gz`.
   - Aggregates (heat map matrix, metrics): Firestore `tracking` doc fields for quick reads, with pointer to blobs for raw.
   - Versioning: `tracking.version` and `tracking.pipeline` (model name, fps, params) for reproducibility.

9. **Frontend UI**
   - Recording overlay: optional low-FPS “preview heat map” toggle.
   - Session/game pages: new `HeatMap` component with canvas rendering, player selector, time scrubber.
   - Stats: show movement tiles (distance, speed, moving%) similar to existing tiles.
   - Admin mapping UI: modal to map trackIds to players with mini timeline previews.

### Data Model (Draft)

Firestore `sessions/{sessionId}/games/{gameId}/tracking`:

```json
{
  "status": "ready",
  "videoRefs": ["gs://.../raw/clip1.mp4"],
  "homography": { "rows": 3, "cols": 3, "data": [ ... ] },
  "players": {
    "<playerId>": {
      "trackIds": [3, 7],
      "heatmap": {
        "gridSize": [48, 24],
        "valuesGzipRef": "gs://.../derived/heatmap_<playerId>.json.gz"
      },
      "metrics": {
        "distanceMeters": 123.4,
        "avgSpeedMps": 1.25,
        "maxSpeedMps": 5.1,
        "movingPct": 0.62
      }
    }
  },
  "raw": {
    "tracksGzipRef": "gs://.../derived/tracks_<gameId>.json.gz"
  },
  "version": "tracking-v1",
  "updatedAt": 1234567890
}
```

### Backend Processing

- **Trigger**: Cloud Storage finalize on `raw/*.mp4` writes a Pub/Sub message with {sessionId, gameId, videoPath}.
- **Service**: Cloud Run container (Python 3.11 + Ultralytics + OpenCV + ByteTrack).
- **Flow**:
  1. Download video from Storage.
  2. Sample frames (10 FPS), run detector, track with ByteTrack.
  3. Court calibration (auto; if not confident, write `status: needs_calibration`, await manual input H; resume once provided).
  4. Transform to court coords, smooth.
  5. Compute heat maps + metrics; upload artifacts; update Firestore doc.
- **Config**: FPS, model variant, confidence/NMS thresholds, grid size, speed threshold.

### Client Preview (Optional)

- **Goal**: While recording, run a tiny person detector at 2–5 FPS and render an approximate heat map overlay.
- **Tech**: onnxruntime-web + YOLOv8n (quantized) or MediaPipe Tasks Vision Multi-Pose.
- **Safeguards**: Auto-disable on low battery or thermal throttling; user toggle.

### UI/UX

- Consent gate: explain processing and data usage; allow delete of analytics.
- Progress: show tracking job status and ETA on game page.
- Mapping: lightweight interface to attach tracks → players; save partial mappings.
- Visuals: court canvas with normalized coordinates, player heat map coloring, time scrubber and zone filters.

### Security & Privacy

- Minimize retention of raw video; configurable retention (e.g., 30 days).
- Access control: only admins of the club/session can initiate/process/view per-player analytics.
- Regional buckets per deployment region; encrypted at rest (GCS default).

### Performance Targets (MVP)

- Processing: 60-minute video at 10 FPS processed within 10–20 minutes on a T4/L4 GPU.
- Storage: Tracks JSON ≤ 50–100 MB per hour at 10 FPS (gzip); aggregates ≤ 1 MB.
- Client preview: ≤ 30% CPU on modern phones, dynamic FPS fallback.

### Milestones

1. Calibration + Tracking Backend (2–3 weeks)

   - Cloud Run service with YOLO + ByteTrack.
   - Homography from manual 4-corner UI; store H; reprocess.
   - Persist tracks + aggregates; Firestore status handling.

2. Heat Maps + Metrics UI (1–2 weeks)

   - `HeatMap` canvas component; stats tiles (distance, moving%).
   - Player selector and time range filter.

3. Auto Court Detection + Better Identity (2–3 weeks)

   - Automatic line-based court detection; confidence + fallback.
   - Track → player mapping UI with heuristics (side-of-court, color hist).

4. Client Preview (Optional, 1–2 weeks)
   - Low-FPS on-device preview with toggle; degrade gracefully.

### Risks & Mitigations

- Auto calibration fails → manual corner tool with assistive hints.
- Occlusions/camera cuts → segment video, tracker re-init, track stitching.
- Device constraints for preview → make preview optional, server-first pipeline.

### Testing & Validation

- Build a small suite of annotated sample clips for regression (tracks IOU, calibration reprojection error).
- Unit tests for homography, grid heat map accumulation, and metrics.
- Visual goldens for heat map rendering across devices.

### Implementation Notes (Code Integration)

- Backend repo/service separate; integrate via Firestore/Storage contracts.
- Frontend additions:
  - `lib/tracking.ts`: fetch tracking doc, parse aggregates, stream status.
  - `components/session/HeatMap.tsx`: canvas renderer (normalized coords → pixels using court aspect).
  - Extend `session/[id]/page.tsx` and game views to show analytics and status.
  - Optional: extend `GameRecorderOverlay.tsx` to expose preview toggle and display.

### Future Work

- Rally segmentation, shuttle trajectory, shot classification.
- Pose-based features (lunge counts, jump frequency).
- Competitive comparative dashboards and player timelines across sessions.

### Client-only Architecture (Selected) — Multi-Person Tracking

#### Summary

- We are selecting a client-only implementation to run all detection, tracking, calibration, and feature extraction fully in the browser without server-side ML. Data storage can still use Firestore/Storage for aggregates if desired, but no cloud inference is required.

#### Runtime and Models

- Runtime: `onnxruntime-web` with WebGL/WebGPU (where available) and WASM fallback. Consider TF.js if MoveNet MultiPose is preferred.
- Person detection: YOLOv8n or YOLOv8n-pose (quantized ONNX). Alternative: TF.js MoveNet MultiPose for efficient multi-person.
- Tracking: Browser implementation of SORT/OC-SORT/ByteTrack-like pipeline:
  - Kalman filter for motion model per track.
  - Hungarian assignment based on IOU and optional color histogram similarity.
  - Track birth/termination thresholds and age-based pruning.
- Pose (optional but recommended): Use feet/ankle keypoints when available for better ground position; fallback to bbox center.

#### Client-only Pipeline

1. Frame access: Use `HTMLVideoElement` with `requestVideoFrameCallback` to sample frames at 5–10 FPS. Render to `OffscreenCanvas` for preprocessing.
2. Detection: Run model on downscaled frames (e.g., 640 px max dimension). Tune confidence/NMS thresholds for 4-person scenes.
3. Tracking: Maintain active tracks with Kalman + Hungarian across frames; interpolate gaps; handle occlusions with track age.
4. Identity-to-player mapping: Use side-of-court after homography, jersey color histograms, and quick admin override UI.
5. Court calibration: Prefer manual 4-corner tool (opencv.js `findHomography`); optionally attempt auto line detection with opencv.js as a best-effort.
6. Coordinate transform: Apply homography to foot/keypoint or bbox center → normalized court coordinates. Smooth with low-pass or Savitzky–Golay.
7. Feature extraction: Accumulate heat map grid, distance, speeds, moving time in real time or post-run pass.
8. Persistence: Store results in IndexedDB for offline; optionally sync aggregates to Firestore for cross-device viewing.

#### Multi-Person Specifics (4 Players, 2 Sides)

- Detection target: exactly up to 4 players; filter non-player detections by region-of-interest (court polygon after homography) and minimum size.
- Side-of-court labeling: With H known, split normalized court by center line to get left/right; use dwell majority to label team A/B.
- Identity stability: Combine IOU with color histogram on torso region and side prior; decay color influence slowly to resist swaps.
- Occlusion handling: Allow short-term unassigned tracks to persist; re-associate by motion and color when reappearing; cap max occlusion age.

#### Performance Budgets and Tuning

- Target 5–10 FPS detection on modern phones; adaptively downscale video frame and reduce model size.
- Run inference in a Web Worker with `OffscreenCanvas` to keep UI responsive; use a second worker for tracking if needed.
- Use dynamic sampling: decrease FPS when thermal throttling/battery low; increase when device is idle and cool.
- Quantization: Prefer INT8/FP16 models to reduce compute and memory.

#### Persistence Modes

- Local-only: Keep tracks/heat maps in IndexedDB; export as JSON when needed.
- Synced aggregates: Write only aggregates (heat map array and metrics) to Firestore; never upload video.

#### UX/Integration

- Add a Calibration modal: pick 4 corners, preview homography overlay on the court.
- Add a Processing modal with progress (frame count) and the option to pause/resume.
- Heat map viewer reuses the same renderer; allow immediate preview as processing advances.
- Admin identity tool: small timeline to lock track→player when needed; show side and color hints.

#### Hard Constraints (Client-only)

- Performance variability: Older or mid-range devices may only sustain 2–5 FPS inference; results will be coarser.
- Thermal/battery: Long sessions can throttle CPU/GPU and drain battery; provide pause/resume and auto-throttle.
- Background execution limits (especially iOS PWA): Long processing pauses when app is backgrounded; users must keep app foregrounded and awake.
- Memory caps: Large ONNX models and long videos risk OOM; enforce downscale, chunked processing, and release tensors promptly.
- WebGPU availability: Not universally available (Safari versions); must run well on WebGL/WASM fallback.
- No heavy re-identification: Full re-id embeddings are expensive client-side; rely on motion, IOU, color hist, and side priors.
- Court detection accuracy: Automatic detection may fail in noisy lighting; manual calibration must be first-class.
- Multi-court scenes: If multiple courts visible, restrict ROI to one court or require user to draw the court polygon.

#### Mitigations

- Adaptive quality: Switch model size/resolution dynamically; let users set “Fast/ Balanced/ Accurate.”
- Chunked processing: Process N seconds at a time; commit results to IndexedDB; allow resume.
- Wake lock: Use Screen Wake Lock API when available to prevent sleep during processing.
- Graceful fallback: If pose model is too slow, use bbox centers; if detection FPS drops, increase track prediction window.
- Cached models: Cache weights via service worker to avoid repeated downloads.

#### Client-only Milestones

1. Minimum viable tracking: detection + SORT in worker, manual homography, heat map accumulation.
2. Identity stability: color hist + side priors + mapping UI.
3. Performance/UX: adaptive FPS, pause/resume, progress UI, IndexedDB persistence.
4. Optional pose: feet keypoints integration and improved distance/speed metrics.

### MediaPipe Edge AI (Client-only) Option

#### Why consider MediaPipe

- MediaPipe Tasks (JS) provide optimized on-device ML via WASM + SIMD/threads and optional WebGL, with simple static asset delivery and good mobile performance.

#### Two viable patterns

1. Pose-first (multi-pose if supported on target)

   - Use `PoseLandmarker` (Tasks Vision) in `video` mode with `numPoses` up to 4 and tuned score thresholds.
   - Extract ankle/foot keypoints for ground position; maintain IDs with a lightweight tracker across frames.
   - Caveat: Multi-person pose quality can degrade under occlusion; validate on badminton footage.

2. Detect-first (recommended for robustness)

   - Use `ObjectDetector` (person class) to detect all players per frame.
   - Track with SORT/OC-SORT/ByteTrack-like logic in JS for identity stability.
   - Optionally run `PoseLandmarker` on tracked crops at a lower cadence (e.g., every 3–5 frames) to refine feet position; otherwise use bbox centers.

#### Integration outline (web)

- Host MediaPipe WASM and `.task` model files; cache via the service worker for offline use.
- Run inference in a Web Worker; send frames via `OffscreenCanvas` using `requestVideoFrameCallback` timestamps.
- Keep tracker state in the worker; post normalized court coordinates and aggregates back to the UI.
- Persist partial results periodically to IndexedDB to support long sessions and resume.

#### Configuration tips

- `ObjectDetector`: tune confidence/NMS to prefer ≤4 persons; filter detections by court ROI after homography.
- `PoseLandmarker`: adjust `numPoses`, detection and tracking confidences; enable smoothing, but cap it to avoid lag.
- Downscale input frames (e.g., long edge 512–640 px) and adapt dynamically based on measured FPS/thermal state.

#### MediaPipe-specific constraints

- Primarily CPU/WASM-bound; performance varies by device and browser SIMD/threads support.
- iOS Safari: background execution is limited; thread/SIMD support depends on OS version; keep app foregrounded with wake lock.
- Model sizes: prefer quantized variants; preload on Wi‑Fi; rely on SW caching to avoid re-downloads.
- Multi-pose coverage: quality may vary with close-quarter play; detect-first tends to be more reliable for 4-player courts.
- No built-in re-identification: identity consistency requires IOU/motion + optional color histograms and side-of-court priors.

#### Pros vs onnxruntime-web

- Pros: Simpler distribution, strong mobile performance, ergonomic APIs.
- Cons: Less flexibility in custom model selection/tuning; still need custom tracking/ID logic for best results.
