"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type GameRecorderOverlayProps = {
  open: boolean;
  teamA: string[];
  teamB: string[];
  onRequestClose: () => void;
  onRequestEndGame: (scoreA: number, scoreB: number) => void;
  gameLabel?: string;
};

function GameRecorderOverlay({
  open,
  teamA,
  teamB,
  onRequestClose: _onRequestClose,
  onRequestEndGame,
  gameLabel,
}: GameRecorderOverlayProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoreA, setScoreA] = useState<number>(0);
  const [scoreB, setScoreB] = useState<number>(0);
  const [paused, setPaused] = useState(false);
  const drawReqRef = useRef<number | null>(null);
  const scoreARef = useRef<number>(0);
  const scoreBRef = useRef<number>(0);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const composedStreamRef = useRef<MediaStream | null>(null);

  // Gesture scoring
  const [gestureEnabled, setGestureEnabled] = useState(true);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [bubbleA, setBubbleA] = useState(false);
  const [bubbleB, setBubbleB] = useState(false);
  const bubbleTimerARef = useRef<number | null>(null);
  const bubbleTimerBRef = useRef<number | null>(null);
  const lastIncAtARef = useRef<number>(0);
  const lastIncAtBRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const speechUnlockedRef = useRef<boolean>(false);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenRafRef = useRef<number | null>(null);

  useEffect(() => {
    scoreARef.current = scoreA;
  }, [scoreA]);
  useEffect(() => {
    scoreBRef.current = scoreB;
  }, [scoreB]);

  const stopAndSave = useCallback(() => {
    try {
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
    } catch {}
  }, []);

  // Attempt to unlock audio/speech on a user gesture (needed on iOS)
  const unlockAudioAndSpeech = useCallback(() => {
    try {
      if (typeof window === "undefined") return;
      // WebAudio unlock
      if (!audioCtxRef.current) {
        const AC =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AC) audioCtxRef.current = new AC();
      }
      if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
        void audioCtxRef.current.resume().catch(() => {});
      }
      // Speech unlock: speak a zero-length utterance once
      if (!speechUnlockedRef.current && "speechSynthesis" in window) {
        try {
          const u = new SpeechSynthesisUtterance(" ");
          u.volume = 0; // attempt to be inaudible
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
          speechUnlockedRef.current = true;
        } catch {}
      }
    } catch {}
  }, []);

  const testSpeak = useCallback(() => {
    try {
      unlockAudioAndSpeech();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        const utter = new SpeechSynthesisUtterance(
          `${scoreARef.current}, ${scoreBRef.current}`
        );
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
      }
    } catch {}
  }, [unlockAudioAndSpeech]);

  // Hidden keep-awake video helpers (fallback for iOS when wake lock unavailable)
  function ensureHiddenKeepAwakeVideo() {
    try {
      if (!recording || paused) return;
      const hv = (hiddenVideoRef.current ||= document.createElement("video"));
      hv.muted = true;
      (hv as any).playsInline = true;
      hv.setAttribute("playsinline", "true");
      hv.width = 1;
      hv.height = 1;
      hv.style.position = "fixed";
      hv.style.width = "1px";
      hv.style.height = "1px";
      hv.style.opacity = "0";
      hv.style.pointerEvents = "none";
      hv.style.top = "-100px";
      if (!hv.parentElement) document.body.appendChild(hv);

      const canvas = (hiddenCanvasRef.current ||=
        document.createElement("canvas"));
      if (!canvas.width) {
        canvas.width = 2;
        canvas.height = 2;
      }
      const ctx = canvas.getContext("2d");
      const stream = (canvas as any).captureStream?.(1);
      if (stream && hv.srcObject !== stream) {
        hv.srcObject = stream as any;
      }
      const tick = () => {
        if (ctx) {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, 2, 2);
        }
        hiddenRafRef.current = requestAnimationFrame(tick);
      };
      if (hiddenRafRef.current == null)
        hiddenRafRef.current = requestAnimationFrame(tick);
      void hv.play().catch(() => {});
    } catch {}
  }

  function teardownHiddenKeepAwakeVideo() {
    try {
      if (hiddenRafRef.current != null)
        cancelAnimationFrame(hiddenRafRef.current);
      hiddenRafRef.current = null;
    } catch {}
    try {
      const hv = hiddenVideoRef.current;
      if (hv) {
        const so = hv.srcObject as MediaStream | null;
        if (so) so.getTracks().forEach((t) => t.stop());
        hv.pause();
        (hv as any).srcObject = null;
        if (hv.parentElement) hv.parentElement.removeChild(hv);
      }
      hiddenVideoRef.current = null;
    } catch {}
    try {
      hiddenCanvasRef.current = null;
    } catch {}
  }

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    let resizeHandler: ((this: Window, ev: Event) => any) | null = null;

    async function start() {
      if (!open) return;
      setError(null);
      setScoreA(0);
      setScoreB(0);
      try {
        // Match device orientation at start so recording matches preview
        const isPortrait =
          typeof window !== "undefined" &&
          window.matchMedia &&
          window.matchMedia("(orientation: portrait)").matches;
        const targetAspect = 16 / 9;
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            // Hint the camera to capture in 16:9 (or 9:16 for portrait). Browsers may ignore if unsupported.
            aspectRatio: { ideal: targetAspect },
          },
          audio: true,
        });
        if (cancelled) return;
        rawStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        // Setup canvas composition to embed overlays into recording
        const canvas = (canvasRef.current ||= document.createElement("canvas"));
        const setCanvasSizeToOrientation = () => {
          const portrait =
            typeof window !== "undefined" &&
            window.matchMedia &&
            window.matchMedia("(orientation: portrait)").matches;
          const bw = portrait ? 720 : 1280;
          const bh = portrait ? 1280 : 720;
          if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
          }
        };
        setCanvasSizeToOrientation();
        const ctx = canvas.getContext("2d");

        const draw = () => {
          if (!ctx) return;
          const vid = videoRef.current;
          if (vid && vid.videoWidth && vid.videoHeight) {
            // cover
            const vw = vid.videoWidth;
            const vh = vid.videoHeight;
            const cw = canvas.width;
            const ch = canvas.height;
            const vr = vw / vh;
            const cr = cw / ch;
            let dw = cw;
            let dh = cw / vr;
            if (dh < ch) {
              dh = ch;
              dw = ch * vr;
            }
            const dx = (cw - dw) / 2;
            const dy = (ch - dh) / 2;
            ctx.drawImage(vid, dx, dy, dw, dh);
          } else {
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          // No canvas overlays for now; only raw video drawn

          drawReqRef.current = requestAnimationFrame(draw);
        };
        drawReqRef.current = requestAnimationFrame(draw);

        // Update canvas resolution on rotate/resize to avoid perceived zoom/crop jumps
        const onResize = () => {
          setCanvasSizeToOrientation();
        };
        window.addEventListener("orientationchange", onResize);
        window.addEventListener("resize", onResize);
        resizeHandler = onResize;

        const canvasStream = canvas.captureStream(30);
        const composedStream = new MediaStream();
        canvasStream
          .getVideoTracks()
          .forEach((t) => composedStream.addTrack(t));
        stream.getAudioTracks().forEach((t) => composedStream.addTrack(t));
        composedStreamRef.current = composedStream;
        setRecording(false);
        setPaused(false);
      } catch (err: any) {
        console.error(err);
        setError(
          `${err}, Camera or microphone not available. You can still continue without recording.`
        );
      }
    }

    start();

    return () => {
      cancelled = true;
      try {
        const rec = mediaRecorderRef.current;
        if (rec && rec.state !== "inactive") rec.stop();
      } catch {}
      mediaRecorderRef.current = null;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      rawStreamRef.current = null;
      composedStreamRef.current = null;
      if (drawReqRef.current != null) {
        cancelAnimationFrame(drawReqRef.current);
        drawReqRef.current = null;
      }
      if (videoRef.current) {
        try {
          (videoRef.current as any).srcObject = null;
        } catch {}
      }
      try {
        if (resizeHandler) {
          window.removeEventListener("orientationchange", resizeHandler);
          window.removeEventListener("resize", resizeHandler);
        }
      } catch {}
      setRecording(false);
      setPaused(false);
    };
  }, [open]);

  const startRecording = useCallback(() => {
    try {
      const composedStream = composedStreamRef.current;
      if (!composedStream) return;
      // Prefer MP4 (H.264/AAC) on Safari/iOS; fall back to WebM where supported
      let chosenMime = "";
      if (typeof MediaRecorder !== "undefined") {
        if (MediaRecorder.isTypeSupported("video/mp4;codecs=h264,aac")) {
          chosenMime = "video/mp4;codecs=h264,aac";
        } else if (MediaRecorder.isTypeSupported("video/mp4")) {
          chosenMime = "video/mp4";
        } else if (
          MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ) {
          chosenMime = "video/webm;codecs=vp9,opus";
        } else if (
          MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ) {
          chosenMime = "video/webm;codecs=vp8,opus";
        } else if (MediaRecorder.isTypeSupported("video/webm")) {
          chosenMime = "video/webm";
        } else {
          chosenMime = ""; // let browser decide
        }
      }
      const mrOptions: MediaRecorderOptions = {
        mimeType: chosenMime || undefined,
        videoBitsPerSecond: 2_500_000,
        audioBitsPerSecond: 128_000,
      };
      let mr: MediaRecorder;
      try {
        mr = new MediaRecorder(composedStream, mrOptions);
      } catch {
        mr = new MediaRecorder(composedStream);
      }
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const outType = mr.mimeType || "video/webm";
        const blob = new Blob(chunksRef.current, { type: outType });
        chunksRef.current = [];
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const ext = outType.includes("mp4") ? "mp4" : "webm";
        const filename = `badminton-game-${new Date().toISOString()}.${ext}`;
        const tryShare = async () => {
          try {
            const file = new File([blob], filename, { type: outType });
            const canShare =
              typeof (navigator as any).canShare === "function" &&
              (navigator as any).canShare({ files: [file] });
            if ((navigator as any).share && canShare) {
              await (navigator as any).share({
                files: [file],
                title: "Badminton game",
              });
              return true;
            }
          } catch {}
          return false;
        };
        (async () => {
          const shared = await tryShare();
          if (!shared) {
            document.body.appendChild(a);
            a.download = filename;
            a.click();
            a.remove();
          }
        })();
        setRecording(false);
        setPaused(false);
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      };
      mr.start();
      setRecording(true);
      setPaused(false);
    } catch {}
  }, []);

  // Keep screen awake while recording (if supported)
  useEffect(() => {
    let wakeLock: any = null;
    let cancelled = false;

    const requestWakeLock = async () => {
      try {
        if (!("wakeLock" in navigator)) return;
        wakeLock = await (navigator as any).wakeLock.request("screen");
        if (wakeLock && typeof wakeLock.addEventListener === "function") {
          wakeLock.addEventListener("release", () => {
            // released
          });
        }
      } catch (e) {
        // Ignore if not allowed/available
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && recording && !paused) {
        void requestWakeLock();
        ensureHiddenKeepAwakeVideo();
      }
    };

    if (recording && !paused) {
      void requestWakeLock();
      ensureHiddenKeepAwakeVideo();
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      cancelled = true;
      try {
        document.removeEventListener("visibilitychange", handleVisibility);
      } catch {}
      try {
        if (wakeLock && typeof wakeLock.release === "function") {
          void wakeLock.release();
        }
      } catch {}
      teardownHiddenKeepAwakeVideo();
    };
  }, [recording, paused]);

  // Gesture detection loop (finger count: 1 -> Team A, 2 -> Team B)
  useEffect(() => {
    if (!open || !gestureEnabled) return;
    let cancelled = false;
    let rafId: number | null = null;
    let handLandmarker: any = null;
    // Stability counters for consecutive frames
    let stableOneCount = 0;
    let stableTwoCount = 0;
    const REQUIRED_STABLE_FRAMES = 4; // longer hold to avoid quick false triggers
    const COOLDOWN_MS = 1200;
    const MIN_HAND_BOX_DIAGONAL = 0.08; // normalized diagonal threshold to ensure sufficient hand size
    // Latching: require release (gesture not seen) before next increment
    let armedOne = true; // for 1-finger → Team A
    let armedTwo = true; // for 2-fingers → Team B
    let releaseOneFrames = 0;
    let releaseTwoFrames = 0;
    const RELEASE_REQUIRED_FRAMES = 6;

    function angleDeg(
      ax: number,
      ay: number,
      az: number | undefined,
      bx: number,
      by: number,
      bz: number | undefined
    ) {
      // angle between vectors a and b
      const azv = typeof az === "number" ? az : 0;
      const bzv = typeof bz === "number" ? bz : 0;
      const dot = ax * bx + ay * by + azv * bzv;
      const ma = Math.hypot(ax, ay, azv);
      const mb = Math.hypot(bx, by, bzv);
      if (ma === 0 || mb === 0) return 0;
      const c = Math.max(-1, Math.min(1, dot / (ma * mb)));
      return (Math.acos(c) * 180) / Math.PI;
    }

    function pipAngle(landmarks: any[], tip: number, pip: number, mcp: number) {
      const t = landmarks[tip];
      const p = landmarks[pip];
      const m = landmarks[mcp];
      if (!t || !p || !m) return 0;
      const v1 = { x: t.x - p.x, y: t.y - p.y, z: (t.z ?? 0) - (p.z ?? 0) };
      const v2 = { x: m.x - p.x, y: m.y - p.y, z: (m.z ?? 0) - (p.z ?? 0) };
      return angleDeg(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
    }

    function isExtended(
      landmarks: any[],
      tip: number,
      pip: number,
      mcp: number
    ) {
      // Rotation-invariant: extended if PIP joint angle is large (nearly straight)
      const ang = pipAngle(landmarks, tip, pip, mcp);
      return ang >= 160; // threshold tunable
    }

    function countExtendedFingers(landmarks: any[]) {
      const INDEX_TIP = 8,
        INDEX_PIP = 6,
        INDEX_MCP = 5;
      const MIDDLE_TIP = 12,
        MIDDLE_PIP = 10,
        MIDDLE_MCP = 9;
      const indexExt = isExtended(landmarks, INDEX_TIP, INDEX_PIP, INDEX_MCP);
      const middleExt = isExtended(
        landmarks,
        MIDDLE_TIP,
        MIDDLE_PIP,
        MIDDLE_MCP
      );
      return (indexExt ? 1 : 0) + (middleExt ? 1 : 0);
    }

    function boundingBoxDiagonal(landmarks: any[]) {
      let minX = 1,
        maxX = 0,
        minY = 1,
        maxY = 0;
      for (const p of landmarks) {
        if (!p) continue;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const dx = Math.max(0, maxX - minX);
      const dy = Math.max(0, maxY - minY);
      return Math.hypot(dx, dy);
    }

    function areNonTargetFingersCurled(landmarks: any[]) {
      // Ring and pinky must NOT be extended to avoid 5-finger being seen as 2
      const RING_TIP = 16,
        RING_PIP = 14,
        RING_MCP = 13;
      const PINKY_TIP = 20,
        PINKY_PIP = 18,
        PINKY_MCP = 17;
      const ringAng = pipAngle(landmarks, RING_TIP, RING_PIP, RING_MCP);
      const pinkyAng = pipAngle(landmarks, PINKY_TIP, PINKY_PIP, PINKY_MCP);
      // Consider curled if angle is small-ish
      return ringAng <= 150 && pinkyAng <= 150;
    }

    function isThumbExtended(landmarks: any[]) {
      // Use rotation-invariant angle at IP joint (tip-IP vs MCP-IP)
      const TIP = 4,
        IP = 3,
        MCP = 2;
      const t = landmarks[TIP];
      const i = landmarks[IP];
      const m = landmarks[MCP];
      if (!t || !i || !m) return false;
      const v1 = { x: t.x - i.x, y: t.y - i.y, z: (t.z ?? 0) - (i.z ?? 0) };
      const v2 = { x: m.x - i.x, y: m.y - i.y, z: (m.z ?? 0) - (i.z ?? 0) };
      const ang = angleDeg(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
      return ang >= 160; // extended if nearly straight
    }

    function matchesOne(landmarks: any[]) {
      if (boundingBoxDiagonal(landmarks) < MIN_HAND_BOX_DIAGONAL) return false;
      const INDEX_TIP = 8,
        INDEX_PIP = 6,
        INDEX_MCP = 5;
      const MIDDLE_TIP = 12,
        MIDDLE_PIP = 10,
        MIDDLE_MCP = 9;
      const indexExt = isExtended(landmarks, INDEX_TIP, INDEX_PIP, INDEX_MCP);
      const middleExt = isExtended(
        landmarks,
        MIDDLE_TIP,
        MIDDLE_PIP,
        MIDDLE_MCP
      );
      const thumbExt = isThumbExtended(landmarks);
      return (
        indexExt &&
        !middleExt &&
        areNonTargetFingersCurled(landmarks) &&
        !thumbExt
      );
    }

    function matchesTwo(landmarks: any[]) {
      if (boundingBoxDiagonal(landmarks) < MIN_HAND_BOX_DIAGONAL) return false;
      const INDEX_TIP = 8,
        INDEX_PIP = 6,
        INDEX_MCP = 5;
      const MIDDLE_TIP = 12,
        MIDDLE_PIP = 10,
        MIDDLE_MCP = 9;
      const indexExt = isExtended(landmarks, INDEX_TIP, INDEX_PIP, INDEX_MCP);
      const middleExt = isExtended(
        landmarks,
        MIDDLE_TIP,
        MIDDLE_PIP,
        MIDDLE_MCP
      );
      const thumbExt = isThumbExtended(landmarks);
      return (
        indexExt &&
        middleExt &&
        areNonTargetFingersCurled(landmarks) &&
        !thumbExt
      );
    }

    function teamForCount(count: number): "A" | "B" | null {
      if (count === 1) return "A";
      if (count === 2) return "B";
      return null;
    }

    const speak = (text: string) => {
      try {
        if (!speechEnabled) return;
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          const utter = new SpeechSynthesisUtterance(text);
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utter);
        }
      } catch {}
    };

    const showBubble = (team: "A" | "B") => {
      if (team === "A") {
        setBubbleA(true);
        if (bubbleTimerARef.current)
          window.clearTimeout(bubbleTimerARef.current);
        bubbleTimerARef.current = window.setTimeout(
          () => setBubbleA(false),
          900
        );
      } else {
        setBubbleB(true);
        if (bubbleTimerBRef.current)
          window.clearTimeout(bubbleTimerBRef.current);
        bubbleTimerBRef.current = window.setTimeout(
          () => setBubbleB(false),
          900
        );
      }
    };

    const processResults = (
      landmarksList: any[][] | undefined,
      handednesses?: any[]
    ) => {
      if (!landmarksList || landmarksList.length === 0) {
        // No hands seen: advance release for both
        releaseOneFrames++;
        releaseTwoFrames++;
        if (releaseOneFrames >= RELEASE_REQUIRED_FRAMES) armedOne = true;
        if (releaseTwoFrames >= RELEASE_REQUIRED_FRAMES) armedTwo = true;
        stableOneCount = 0;
        stableTwoCount = 0;
        return;
      }

      let sawOne = false;
      let sawTwo = false;
      for (let i = 0; i < landmarksList.length; i++) {
        const lm = landmarksList[i];
        if (matchesOne(lm)) sawOne = true;
        else if (matchesTwo(lm)) sawTwo = true;
      }

      // If both present simultaneously, treat as none this frame
      const detOne = sawOne && !sawTwo;
      const detTwo = sawTwo && !sawOne;

      // Update stability and release counters with latching
      if (detOne && armedOne) {
        stableOneCount++;
      } else {
        stableOneCount = 0;
      }
      if (!detOne) {
        releaseOneFrames++;
        if (releaseOneFrames >= RELEASE_REQUIRED_FRAMES) armedOne = true;
      } else {
        releaseOneFrames = 0;
      }

      if (detTwo && armedTwo) {
        stableTwoCount++;
      } else {
        stableTwoCount = 0;
      }
      if (!detTwo) {
        releaseTwoFrames++;
        if (releaseTwoFrames >= RELEASE_REQUIRED_FRAMES) armedTwo = true;
      } else {
        releaseTwoFrames = 0;
      }

      const now = performance.now();

      if (detOne && armedOne && stableOneCount >= REQUIRED_STABLE_FRAMES) {
        if (now - lastIncAtARef.current >= COOLDOWN_MS) {
          lastIncAtARef.current = now;
          setScoreA((s) => s + 1);
          showBubble("A");
          const a = scoreARef.current + 1;
          const b = scoreBRef.current;
          speak(`${a}, ${b}`);
        }
        armedOne = false; // require release before next increment
        stableOneCount = 0;
        releaseOneFrames = 0;
      } else if (
        detTwo &&
        armedTwo &&
        stableTwoCount >= REQUIRED_STABLE_FRAMES
      ) {
        if (now - lastIncAtBRef.current >= COOLDOWN_MS) {
          lastIncAtBRef.current = now;
          setScoreB((s) => s + 1);
          showBubble("B");
          const a = scoreARef.current;
          const b = scoreBRef.current + 1;
          speak(`${b}, ${a}`);
        }
        armedTwo = false; // require release before next increment
        stableTwoCount = 0;
        releaseTwoFrames = 0;
      }
    };

    (async () => {
      try {
        const visionMod = await import("@mediapipe/tasks-vision");
        const FilesetResolver = (visionMod as any).FilesetResolver;
        const HandLandmarker = (visionMod as any).HandLandmarker;

        const fileset = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-tasks/hand_landmarker/hand_landmarker.task",
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });

        const loop = () => {
          if (cancelled) return;
          const vid = videoRef.current;
          if (vid && vid.readyState >= 2 && handLandmarker) {
            const res = handLandmarker.detectForVideo(vid, performance.now());
            const anyRes: any = res as any;
            processResults(anyRes?.landmarks, anyRes?.handednesses);
          }
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      } catch (e) {
        // If model fails to load, silently disable gesture loop for this session
        console.warn("Gesture model init failed (tasks-vision)", e);
      }
    })();

    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      try {
        if (handLandmarker && typeof handLandmarker.close === "function")
          handLandmarker.close();
      } catch {}
    };
  }, [open, gestureEnabled, speechEnabled]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/90">
      <div className="absolute inset-0 flex flex-col">
        <div className="relative flex-1">
          {/* Hidden raw camera preview; we display the composed canvas so the user sees exactly what's recorded */}
          <video
            ref={videoRef}
            className="absolute inset-0 m-auto max-h-full max-w-full bg-black"
            playsInline
            muted
          />
          <canvas ref={canvasRef} className="hidden" />

          <div className="absolute top-0 left-0 right-0 p-3 flex flex-col gap-4 items-center justify-between text-white text-sm">
            <div className="w-full flex justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    recording && !paused
                      ? "bg-red-500"
                      : recording && paused
                      ? "bg-yellow-400"
                      : "bg-gray-400"
                  }`}
                ></span>
                <span>
                  {recording
                    ? paused
                      ? "Paused"
                      : "Recording"
                    : "Not recording"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* {!recording && (
                <button
                  onClick={startRecording}
                  className="rounded-md bg-white/10 px-3 py-1 backdrop-blur border border-white/20"
                >
                  Start
                </button>
              )} */}
                <div className="flex flex-col items-start gap-2">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={gestureEnabled}
                      onChange={(e) => {
                        setGestureEnabled(e.target.checked);
                        if (e.target.checked && speechEnabled) {
                          // User gesture present here; safe to unlock
                          unlockAudioAndSpeech();
                        }
                      }}
                    />
                    <span>Gesture scoring</span>
                  </label>
                  {gestureEnabled && (
                    <div className="flex items-center gap-2">
                      <label className="items-center gap-1">
                        <input
                          type="checkbox"
                          checked={speechEnabled}
                          onChange={(e) => {
                            setSpeechEnabled(e.target.checked);
                            if (e.target.checked) {
                              // Toggle click counts as user gesture on iOS
                              unlockAudioAndSpeech();
                            }
                          }}
                        />
                        <span>Voice</span>
                      </label>
                      <button
                        onClick={testSpeak}
                        className="rounded-md bg-white/10 px-3 py-1 backdrop-blur border border-white/20"
                      >
                        Test voice
                      </button>
                    </div>
                  )}
                </div>
                {recording && !paused && (
                  <button
                    onClick={() => {
                      try {
                        const rec = mediaRecorderRef.current;
                        if (rec && rec.state === "recording") {
                          rec.pause();
                          setPaused(true);
                        }
                      } catch {}
                    }}
                    className="rounded-md bg-white/10 px-3 py-1 backdrop-blur border border-white/20"
                  >
                    Pause
                  </button>
                )}
                {recording && paused && (
                  <button
                    onClick={() => {
                      try {
                        const rec = mediaRecorderRef.current;
                        if (rec && rec.state === "paused") {
                          rec.resume();
                          setPaused(false);
                        }
                      } catch {}
                    }}
                    className="rounded-md bg-white/10 px-3 py-1 backdrop-blur border border-white/20"
                  >
                    Resume
                  </button>
                )}
              </div>
            </div>
            {gestureEnabled && (
              <div className="rounded-full bg-black/40 border border-white/10 text-white text-xs px-3 py-1">
                Gestures: show 1 finger → +1 Team A, 2 fingers → +1 Team B. Keep
                hands around 1 racket away for best results. Toggle Voice for
                readout.
              </div>
            )}
            {/* Team labels below help text */}
            <div className="w-full flex items-start justify-center">
              <div className="w-full mt-2 rounded-lg bg-black/40 border border-white/10 text-white text-xs px-3 py-2">
                <div className="flex justify-between items-start gap-6">
                  <div>
                    <div className="font-semibold mb-1 text-lg">Team A</div>
                    {(teamA.length ? teamA : ["TBD"]).map((n, i) => (
                      <div key={`ta-${i}`} className="text-sm font-semibold">
                        {n}
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="font-semibold mb-1 text-lg">Team B</div>
                    {(teamB.length ? teamB : ["TBD"]).map((n, i) => (
                      <div key={`tb-${i}`} className="text-sm font-semibold">
                        {n}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Help text for gestures
          {gestureEnabled && (
            <div className="absolute left-0 right-0 top-12 z-[6] flex justify-center pointer-events-none">
              <div className="rounded-full bg-black/40 border border-white/10 text-white text-xs px-3 py-1">
                Gestures: show 1 finger → +1 Team A, 2 fingers → +1 Team B.
                Toggle Voice for readout.
              </div>
            </div>
          )} */}

          {/* Bottom controls container (score controls + end button) */}
          <div className="pointer-events-none fixed left-0 right-0 bottom-0 z-[5] p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] flex flex-col items-center gap-2">
            <div className="pointer-events-auto mx-auto max-w-md w-full rounded-xl bg-black/40 border border-white/10 p-4 text-white">
              <div className="grid grid-cols-3 items-center gap-3">
                <div className="flex items-center justify-start gap-3">
                  <button
                    onClick={() => setScoreA((s) => Math.max(0, s - 1))}
                    className="rounded-md border border-white/20 bg-white/10 px-4 py-3 text-2xl"
                  >
                    −
                  </button>
                  <button
                    onClick={() => setScoreA((s) => s + 1)}
                    className="rounded-md border border-white/20 bg-white/10 px-4 py-3 text-2xl"
                  >
                    +
                  </button>
                </div>
                <div className="text-center text-2xl md:text-3xl font-semibold tracking-wide">
                  {scoreA} : {scoreB}
                </div>
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => setScoreB((s) => Math.max(0, s - 1))}
                    className="rounded-md border border-white/20 bg-white/10 px-4 py-3 text-2xl"
                  >
                    −
                  </button>
                  <button
                    onClick={() => setScoreB((s) => s + 1)}
                    className="rounded-md border border-white/20 bg-white/10 px-4 py-3 text-2xl"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
            <div className="pointer-events-auto">
              <button
                onClick={() => {
                  stopAndSave();
                  onRequestEndGame(scoreA, scoreB);
                }}
                className="rounded-xl bg-red-600 text-white px-6 py-3 text-base font-semibold shadow-lg"
              >
                End game
              </button>
            </div>
            {/* Text bubble feedback */}
            {bubbleA && (
              <div className="pointer-events-none absolute left-6 bottom-28 rounded-full bg-white/90 text-black px-3 py-2 text-sm shadow">
                Team A +1
              </div>
            )}
            {bubbleB && (
              <div className="pointer-events-none absolute right-6 bottom-28 rounded-full bg-white/90 text-black px-3 py-2 text-sm shadow">
                Team B +1
              </div>
            )}
          </div>

          {error ? (
            <div className="absolute left-0 right-0 top-16 mx-3 rounded-md bg-red-500/90 text-white text-sm p-2 text-center">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { GameRecorderOverlay };
