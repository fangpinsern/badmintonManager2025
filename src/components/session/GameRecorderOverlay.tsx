"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  rectIntersection,
  DragEndEvent,
} from "@dnd-kit/core";

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
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment"
  );
  const drawReqRef = useRef<number | null>(null);
  const scoreARef = useRef<number>(0);
  const scoreBRef = useRef<number>(0);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const composedStreamRef = useRef<MediaStream | null>(null);

  // Gesture scoring
  const [gestureEnabled, setGestureEnabled] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [bubbleA, setBubbleA] = useState(false);
  const [bubbleB, setBubbleB] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugRects, setDebugRects] = useState<
    { x0: number; y0: number; x1: number; y1: number; label: string }[]
  >([]);
  const [requirePalmFront, setRequirePalmFront] = useState(true);
  const [invertPalmFrontTest, setInvertPalmFrontTest] = useState(false);
  const [requireFistSideOn, setRequireFistSideOn] = useState(true);
  const bubbleTimerARef = useRef<number | null>(null);
  const bubbleTimerBRef = useRef<number | null>(null);
  const lastIncAtARef = useRef<number>(0);
  const lastIncAtBRef = useRef<number>(0);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [courtRect, setCourtRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>({ left: 0, top: 0, width: 0, height: 0 });
  const [svgBoxRect, setSvgBoxRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>({ left: 0, top: 0, width: 0, height: 0 });
  const [overlayOffset, setOverlayOffset] = useState<{
    left: number;
    top: number;
  }>({ left: 0, top: 0 });
  const poolARef = useRef<HTMLDivElement | null>(null);
  const poolBRef = useRef<HTMLDivElement | null>(null);
  const [draggingItem, setDraggingItem] = useState<{
    team: "A" | "B";
    name: string;
    from: "pool" | "zone";
    zone?: "top" | "bottom";
  } | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const bodyOverflowRef = useRef<string>("");
  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 4 },
    })
  );
  // Prefer pools over court zones when both intersect during a drop (so drag-over pool returns to pool)
  const zonesFirst = useCallback((args: any) => {
    try {
      const collisions = rectIntersection(args) || [];
      return collisions.sort((a: any, b: any) => {
        const aPool = String(a.id || "").startsWith("pool:") ? 1 : 0;
        const bPool = String(b.id || "").startsWith("pool:") ? 1 : 0;
        if (aPool !== bPool) return bPool - aPool; // pools first
        return 0;
      });
    } catch {
      return rectIntersection(args) || [];
    }
  }, []);
  // Court assignments for drag-and-drop placement
  const [courtAssign, setCourtAssign] = useState<{
    A: { top: string[]; bottom: string[] };
    B: { top: string[]; bottom: string[] };
  }>({
    A: { top: [], bottom: [] },
    B: { top: [], bottom: [] },
  });
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

  // Compute rendered court rectangle (letterboxed) so zones align in both orientations
  useEffect(() => {
    try {
      const compute = () => {
        try {
          const el = overlayRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const containerW = rect.width;
          const containerH = rect.height;
          setOverlayOffset({ left: rect.left, top: rect.top });
          // SVG viewBox is 2000x1000; court is x=200..1800, y=100..900
          const vbW = 2000;
          const vbH = 1000;
          const baseScale = Math.min(containerW / vbW, containerH / vbH);
          // Only scale down in landscape
          const isLandscape =
            (window.matchMedia &&
              window.matchMedia("(orientation: landscape)").matches) ||
            containerW >= containerH;
          const overlayScale = isLandscape ? 0.8 : 1;
          const scale = baseScale * overlayScale;
          const renderedW = vbW * scale;
          const renderedH = vbH * scale;
          const marginLeft = (containerW - renderedW) / 2;
          const marginTop = (containerH - renderedH) / 2;
          setSvgBoxRect({
            left: marginLeft,
            top: marginTop,
            width: renderedW,
            height: renderedH,
          });
          const courtLeft = marginLeft + 200 * scale;
          const courtTop = marginTop + 100 * scale;
          const courtWidth = 1600 * scale;
          const courtHeight = 800 * scale;
          setCourtRect({
            left: courtLeft,
            top: courtTop,
            width: courtWidth,
            height: courtHeight,
          });
        } catch {}
      };
      // Initial compute, then run again next frame to ensure layout is stable
      compute();
      const raf = window.requestAnimationFrame(() => compute());
      // Observe size changes of the overlay container
      let ro: ResizeObserver | null = null;
      try {
        if (typeof ResizeObserver !== "undefined" && overlayRef.current) {
          ro = new ResizeObserver(() => compute());
          ro.observe(overlayRef.current);
        }
      } catch {}
      window.addEventListener("resize", compute);
      window.addEventListener("orientationchange", compute);
      return () => {
        try {
          window.removeEventListener("resize", compute);
          window.removeEventListener("orientationchange", compute);
          window.cancelAnimationFrame(raf);
          if (ro) ro.disconnect();
        } catch {}
      };
    } catch {}
  }, [open]);

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

  // Speak helper for manual button increments, following the same order as gestures:
  // - If Team A increments, read "A, B" (A first)
  // - If Team B increments, read "B, A" (B first)
  const speakScore = useCallback(
    (incremented: "A" | "B") => {
      try {
        if (!speechEnabled) return;
        unlockAudioAndSpeech();
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          const nextA =
            incremented === "A" ? scoreARef.current + 1 : scoreARef.current;
          const nextB =
            incremented === "B" ? scoreBRef.current + 1 : scoreBRef.current;
          const text =
            incremented === "A" ? `${nextA}, ${nextB}` : `${nextB}, ${nextA}`;
          const utter = new SpeechSynthesisUtterance(text);
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utter);
        }
      } catch {}
    },
    [speechEnabled, unlockAudioAndSpeech]
  );

  // ----- Drag & Drop helpers for court placement -----
  const assignedSetA = new Set<string>([
    ...courtAssign.A.top,
    ...courtAssign.A.bottom,
  ]);
  const assignedSetB = new Set<string>([
    ...courtAssign.B.top,
    ...courtAssign.B.bottom,
  ]);
  const availableA = (teamA || []).filter((n) => !assignedSetA.has(n));
  const availableB = (teamB || []).filter((n) => !assignedSetB.has(n));

  function startDrag(
    team: "A" | "B",
    name: string,
    from: "pool" | "zone",
    zone?: "top" | "bottom"
  ) {
    return (e: any) => {
      try {
        const payload = JSON.stringify({ team, name, from, zone });
        e.dataTransfer.setData("application/json", payload);
        e.dataTransfer.effectAllowed = "move";
      } catch {}
    };
  }

  function onDragOverAllow(e: any) {
    try {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    } catch {}
  }

  function dropToZone(team: "A" | "B", zone: "top" | "bottom") {
    return (e: any) => {
      try {
        e.preventDefault();
        const data = e.dataTransfer.getData("application/json");
        if (!data) return;
        const parsed: {
          team: "A" | "B";
          name: string;
          from: "pool" | "zone";
          zone?: "top" | "bottom";
        } = JSON.parse(data);
        if (parsed.team !== team) return; // enforce team-side constraint
        const name = parsed.name;
        setCourtAssign((prev) => {
          const next = {
            A: { top: [...prev.A.top], bottom: [...prev.A.bottom] },
            B: { top: [...prev.B.top], bottom: [...prev.B.bottom] },
          };
          // Remove from all zones first (avoid duplicates)
          next.A.top = next.A.top.filter((n) => n !== name);
          next.A.bottom = next.A.bottom.filter((n) => n !== name);
          next.B.top = next.B.top.filter((n) => n !== name);
          next.B.bottom = next.B.bottom.filter((n) => n !== name);
          // Add to target (single player per zone)
          next[team][zone] = [name];
          return next;
        });
      } catch {}
    };
  }

  function dropToPool(team: "A" | "B") {
    return (e: any) => {
      try {
        e.preventDefault();
        const data = e.dataTransfer.getData("application/json");
        if (!data) return;
        const parsed: { team: "A" | "B"; name: string } = JSON.parse(data);
        if (parsed.team !== team) return; // enforce team-side constraint
        const name = parsed.name;
        setCourtAssign((prev) => {
          const next = {
            A: { top: [...prev.A.top], bottom: [...prev.A.bottom] },
            B: { top: [...prev.B.top], bottom: [...prev.B.bottom] },
          };
          next.A.top = next.A.top.filter((n) => n !== name);
          next.A.bottom = next.A.bottom.filter((n) => n !== name);
          next.B.top = next.B.top.filter((n) => n !== name);
          next.B.bottom = next.B.bottom.filter((n) => n !== name);
          return next;
        });
      } catch {}
    };
  }

  // Touch-friendly drag support for PWAs/iOS
  function onChipTouchStart(
    team: "A" | "B",
    name: string,
    from: "pool" | "zone",
    zone?: "top" | "bottom"
  ) {
    return (e: any) => {
      try {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation?.();
        const touches = e.touches ? e.touches.length : 0;
        if (touches > 1) return; // ignore multi-touch
        const t = (e.touches && e.touches[0]) || null;
        if (!t) return;
        try {
          bodyOverflowRef.current = document.body.style.overflow || "";
          document.body.style.overflow = "hidden";
        } catch {}
        setDraggingItem({ team, name, from, zone });
        setDragPos({ x: t.clientX, y: t.clientY });
        const onMove = (ev: any) => {
          try {
            const touch = (ev.touches && ev.touches[0]) || null;
            if (!touch) return;
            setDragPos({ x: touch.clientX, y: touch.clientY });
            if (ev.cancelable) ev.preventDefault();
          } catch {}
        };
        const onEnd = (ev: any) => {
          try {
            const touch =
              (ev.changedTouches && ev.changedTouches[0]) ||
              (ev.touches && ev.touches[0]) ||
              null;
            const clientX = touch ? touch.clientX : dragPos?.x || 0;
            const clientY = touch ? touch.clientY : dragPos?.y || 0;
            const item = { team, name, from, zone };
            const over = (el: HTMLDivElement | null) => {
              if (!el) return false;
              const r = el.getBoundingClientRect();
              return (
                clientX >= r.left &&
                clientX <= r.right &&
                clientY >= r.top &&
                clientY <= r.bottom
              );
            };
            const inCourt =
              clientX >= courtRect.left &&
              clientX <= courtRect.left + courtRect.width &&
              clientY >= courtRect.top &&
              clientY <= courtRect.top + courtRect.height;
            if (inCourt) {
              const midX = courtRect.left + courtRect.width / 2;
              const midY = courtRect.top + courtRect.height / 2;
              const tgtTeam: "A" | "B" = clientX < midX ? "A" : "B";
              const tgtZone: "top" | "bottom" =
                clientY < midY ? "top" : "bottom";
              if (tgtTeam === item.team) {
                setCourtAssign((prev) => {
                  const next = {
                    A: { top: [...prev.A.top], bottom: [...prev.A.bottom] },
                    B: { top: [...prev.B.top], bottom: [...prev.B.bottom] },
                  };
                  next.A.top = next.A.top.filter((n) => n !== name);
                  next.A.bottom = next.A.bottom.filter((n) => n !== name);
                  next.B.top = next.B.top.filter((n) => n !== name);
                  next.B.bottom = next.B.bottom.filter((n) => n !== name);
                  next[tgtTeam][tgtZone] = [name];
                  return next;
                });
              }
            } else if (
              over(item.team === "A" ? poolARef.current : poolBRef.current)
            ) {
              setCourtAssign((prev) => {
                const next = {
                  A: { top: [...prev.A.top], bottom: [...prev.A.bottom] },
                  B: { top: [...prev.B.top], bottom: [...prev.B.bottom] },
                };
                next.A.top = next.A.top.filter((n) => n !== name);
                next.A.bottom = next.A.bottom.filter((n) => n !== name);
                next.B.top = next.B.top.filter((n) => n !== name);
                next.B.bottom = next.B.bottom.filter((n) => n !== name);
                return next;
              });
            }
          } catch {}
          try {
            window.removeEventListener("touchmove", onMove as any);
            window.removeEventListener("touchend", onEnd as any);
          } catch {}
          try {
            document.body.style.overflow = bodyOverflowRef.current || "";
          } catch {}
          setDraggingItem(null);
          setDragPos(null);
        };
        window.addEventListener("touchmove", onMove as any, { passive: false });
        window.addEventListener("touchend", onEnd as any);
      } catch {}
    };
  }

  function PlayerChip({ team, name }: { team: "A" | "B"; name: string }) {
    const id = `chip:${team}:${name}`;
    const { attributes, listeners, setNodeRef, transform, isDragging } =
      useDraggable({ id });
    const style: any = {
      transform: transform
        ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
        : undefined,
      opacity: isDragging ? 0.8 : 1,
      cursor: "grab",
    };
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        className="pointer-events-auto touch-none inline-flex items-center rounded-full bg-white/90 text-black text-[11px] md:text-xs px-2 py-1 m-1"
      >
        {name}
      </div>
    );
  }

  function TeamPool({ team, children }: { team: "A" | "B"; children: any }) {
    const { setNodeRef, isOver } = useDroppable({ id: `pool:${team}` });
    return (
      <div
        ref={setNodeRef}
        className={`pointer-events-auto inline-block rounded-md bg-black/35 border ${
          isOver ? "border-white/40" : "border-white/10"
        } px-3 py-2`}
      >
        {children}
      </div>
    );
  }

  function CourtDropZone({
    team,
    zone,
    style,
    children,
  }: {
    team: "A" | "B";
    zone: "top" | "bottom";
    style: any;
    children: any;
  }) {
    const id = `zone:${team}:${zone}`;
    const { setNodeRef, isOver } = useDroppable({ id });
    const baseColor =
      team === "A"
        ? zone === "top"
          ? "bg-red-500"
          : "bg-orange-500"
        : zone === "top"
        ? "bg-blue-500"
        : "bg-green-500";
    const bgClass = isOver
      ? `${baseColor}/40 border-white/50`
      : `${baseColor}/20 border-white/30`;
    return (
      <div className="absolute" style={style}>
        <div
          ref={setNodeRef}
          className={`pointer-events-auto relative w-full h-full rounded-md border ${bgClass}`}
        >
          <div className="h-full w-full p-2 flex items-center justify-center">
            {children}
          </div>
        </div>
      </div>
    );
  }

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
            facingMode,
            // Hint the camera to capture in 16:9 (or 9:16 for portrait). Browsers may ignore if unsupported.
            aspectRatio: { ideal: targetAspect },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
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
  }, [open, facingMode]);

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

  // Gesture detection loop (1 finger -> Team A, 2 fingers -> Team B)
  useEffect(() => {
    if (!open || !gestureEnabled) return;
    let cancelled = false;
    let rafId: number | null = null;
    let handLandmarker: any = null;
    // Stability counters for consecutive frames
    let stableOneCount = 0; // 1 finger (index)
    let stableTwoCount = 0; // 2 fingers (index + middle)
    const REQUIRED_STABLE_FRAMES = 4; // hold to avoid quick false triggers
    const COOLDOWN_MS = 1200;
    const MIN_HAND_BOX_DIAGONAL = 0.08; // normalized diagonal threshold to ensure sufficient hand size
    // Latching: require release (gesture not seen) before next increment
    let armedOne = true; // for 1 finger → Team A
    let armedTwo = true; // for 2 fingers → Team B
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

    function isPalmFacingCamera(landmarks: any[]) {
      // Use palm normal from wrist (0), index MCP (5), pinky MCP (17)
      const w = landmarks[0];
      const i = landmarks[5];
      const p = landmarks[17];
      if (!w || !i || !p) return true;
      const v1 = { x: i.x - w.x, y: i.y - w.y, z: (i.z ?? 0) - (w.z ?? 0) };
      const v2 = { x: p.x - w.x, y: p.y - w.y, z: (p.z ?? 0) - (w.z ?? 0) };
      const nx = v1.y * v2.z - v1.z * v2.y;
      const ny = v1.z * v2.x - v1.x * v2.z;
      const nz = v1.x * v2.y - v1.y * v2.x;
      // Heuristic: treat nz < 0 as palm facing camera (depends on coordinate convention)
      const facing = nz < 0;
      return invertPalmFrontTest ? !facing : facing;
    }

    function isPalmSideOn(landmarks: any[]) {
      // Side-on if palm normal is approximately perpendicular to camera axis (small |nz| component)
      const w = landmarks[0];
      const i = landmarks[5];
      const p = landmarks[17];
      if (!w || !i || !p) return false;
      const v1 = { x: i.x - w.x, y: i.y - w.y, z: (i.z ?? 0) - (w.z ?? 0) };
      const v2 = { x: p.x - w.x, y: p.y - w.y, z: (p.z ?? 0) - (w.z ?? 0) };
      const nx = v1.y * v2.z - v1.z * v2.y;
      const ny = v1.z * v2.x - v1.x * v2.z;
      const nz = v1.x * v2.y - v1.y * v2.x;
      const mag = Math.hypot(nx, ny, nz) || 1;
      const zRatio = Math.abs(nz) / mag; // 0 → perfectly side-on; 1 → fully facing/away
      return zRatio <= 0.35; // threshold tunable
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
      // For closed fist, ring and pinky should be curled (small angle)
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

    function matchesOneFinger(landmarks: any[]) {
      // Robust 1-finger (index) gesture:
      // - Hand must be large enough
      // - Index extended, middle NOT extended
      // - Ring and pinky NOT extended (curled); thumb state ignored
      if (boundingBoxDiagonal(landmarks) < MIN_HAND_BOX_DIAGONAL) return false;
      const extIndex = isExtended(landmarks, 8, 6, 5);
      const extMiddle = isExtended(landmarks, 12, 10, 9);
      const extRing = isExtended(landmarks, 16, 14, 13);
      const extPinky = isExtended(landmarks, 20, 18, 17);
      if (!extIndex) return false;
      if (extMiddle) return false;
      if (extRing) return false;
      if (extPinky) return false;
      return true;
    }

    function matchesTwoFingers(landmarks: any[]) {
      // Robust 2-fingers (index + middle) gesture:
      // - Hand must be large enough
      // - Index and middle extended
      // - Ring and pinky NOT extended; thumb state ignored
      if (boundingBoxDiagonal(landmarks) < MIN_HAND_BOX_DIAGONAL) return false;
      const extIndex = isExtended(landmarks, 8, 6, 5);
      const extMiddle = isExtended(landmarks, 12, 10, 9);
      const extRing = isExtended(landmarks, 16, 14, 13);
      const extPinky = isExtended(landmarks, 20, 18, 17);
      if (!(extIndex && extMiddle)) return false;
      if (extRing) return false;
      if (extPinky) return false;
      return true;
    }

    function teamForCount(count: number): "A" | "B" | null {
      if (count === 1) return "A";
      if (count === 2) return "B";
      return null;
    }

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
        if (debugEnabled) setDebugRects([]);
        return;
      }

      let sawOne = false; // 1 finger
      let sawTwo = false; // 2 fingers
      const rects: {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
        label: string;
      }[] = [];
      for (let i = 0; i < landmarksList.length; i++) {
        const lm = landmarksList[i];
        const one = matchesOneFinger(lm);
        const two = !one && matchesTwoFingers(lm);
        if (one) sawOne = true;
        else if (two) sawTwo = true;
        if (debugEnabled) {
          let minX = 1,
            maxX = 0,
            minY = 1,
            maxY = 0;
          for (const p of lm) {
            if (!p) continue;
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
          const label = one ? "one" : two ? "two" : "other";
          rects.push({ x0: minX, y0: minY, x1: maxX, y1: maxY, label });
        }
      }
      if (debugEnabled) setDebugRects(rects);

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
          speakScore("A");
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
          speakScore("B");
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
  }, [open, gestureEnabled, speechEnabled, speakScore]);

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
          {debugEnabled && debugRects.length > 0 && (
            <div className="absolute inset-0 pointer-events-none">
              {debugRects.map((r, i) => {
                const left = `${Math.max(0, Math.min(1, r.x0)) * 100}%`;
                const top = `${Math.max(0, Math.min(1, r.y0)) * 100}%`;
                const width = `${Math.max(0, Math.min(1, r.x1 - r.x0)) * 100}%`;
                const height = `${
                  Math.max(0, Math.min(1, r.y1 - r.y0)) * 100
                }%`;
                const color =
                  r.label === "open"
                    ? "#22c55e"
                    : r.label === "closed"
                    ? "#3b82f6"
                    : "#9ca3af";
                return (
                  <div
                    key={i}
                    style={{ left, top, width, height, borderColor: color }}
                    className="absolute border-2"
                  >
                    <div
                      style={{ backgroundColor: color }}
                      className="absolute -top-5 left-0 text-[10px] text-white px-1 rounded"
                    >
                      {r.label}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Badminton court overlay (visual only; not embedded in recording) */}
          <DndContext
            sensors={sensors}
            collisionDetection={zonesFirst}
            onDragEnd={(e: DragEndEvent) => {
              try {
                const activeId = String(e.active?.id ?? "");
                const overId = String(e.over?.id ?? "");
                if (!activeId || !overId) return;
                const activeParts = activeId.split(":");
                const overParts = overId.split(":");
                const aTeam = activeParts[1] as "A" | "B";
                const name = activeParts.slice(2).join(":");
                const overType = overParts[0];
                const bTeam = overParts[1] as "A" | "B" | undefined;
                const zone = overParts[2] as "top" | "bottom" | undefined;
                if (overType === "pool") {
                  setCourtAssign((prev) => {
                    const next = {
                      A: { top: [...prev.A.top], bottom: [...prev.A.bottom] },
                      B: { top: [...prev.B.top], bottom: [...prev.B.bottom] },
                    };
                    next.A.top = next.A.top.filter((n) => n !== name);
                    next.A.bottom = next.A.bottom.filter((n) => n !== name);
                    next.B.top = next.B.top.filter((n) => n !== name);
                    next.B.bottom = next.B.bottom.filter((n) => n !== name);
                    return next;
                  });
                  return;
                }
                if (overType === "zone") {
                  if (!bTeam || !zone) return;
                  if (aTeam !== bTeam) return;
                  const z = zone === "top" ? "top" : "bottom";
                  setCourtAssign((prev) => {
                    const next = {
                      A: { top: [...prev.A.top], bottom: [...prev.A.bottom] },
                      B: { top: [...prev.B.top], bottom: [...prev.B.bottom] },
                    };
                    next.A.top = next.A.top.filter((n) => n !== name);
                    next.A.bottom = next.A.bottom.filter((n) => n !== name);
                    next.B.top = next.B.top.filter((n) => n !== name);
                    next.B.bottom = next.B.bottom.filter((n) => n !== name);
                    next[bTeam as "A" | "B"][z] = [name];
                    return next;
                  });
                }
              } catch {}
            }}
          >
            <div
              ref={overlayRef}
              className="absolute inset-0 pointer-events-auto select-none"
              style={
                {
                  touchAction: "none",
                  WebkitUserSelect: "none",
                  WebkitTouchCallout: "none",
                } as any
              }
            >
              <div
                className="absolute"
                style={{
                  left: svgBoxRect.left,
                  top: svgBoxRect.top,
                  width: svgBoxRect.width,
                  height: svgBoxRect.height,
                }}
              >
                <svg
                  viewBox="0 0 2000 1000"
                  preserveAspectRatio="xMidYMid meet"
                  className="w-full h-full"
                >
                  {/* Court outer boundary */}
                  <rect
                    x="200"
                    y="100"
                    width="1600"
                    height="800"
                    fill="none"
                    stroke="rgba(255,255,255,0.5)"
                    strokeWidth="8"
                  />
                  {/* Net line (mid-court, vertical) */}
                  <line
                    x1="1000"
                    y1="100"
                    x2="1000"
                    y2="900"
                    stroke="rgba(255,255,255,0.5)"
                    strokeWidth="6"
                  />
                  {/* Short service lines (approximate, vertical) */}
                  <line
                    x1="780"
                    y1="120"
                    x2="780"
                    y2="880"
                    stroke="rgba(255,255,255,0.35)"
                    strokeDasharray="18 14"
                    strokeWidth="5"
                  />
                  <line
                    x1="300"
                    y1="120"
                    x2="300"
                    y2="880"
                    stroke="rgba(255,255,255,0.35)"
                    strokeDasharray="18 14"
                    strokeWidth="5"
                  />
                  <line
                    x1="1220"
                    y1="120"
                    x2="1220"
                    y2="880"
                    stroke="rgba(255,255,255,0.35)"
                    strokeDasharray="18 14"
                    strokeWidth="5"
                  />
                  <line
                    x1="1700"
                    y1="120"
                    x2="1700"
                    y2="880"
                    stroke="rgba(255,255,255,0.35)"
                    strokeDasharray="18 14"
                    strokeWidth="5"
                  />
                  {/* Center line (service courts, horizontal) */}
                  <line
                    x1="200"
                    y1="500"
                    x2="1800"
                    y2="500"
                    stroke="rgba(255,255,255,0.35)"
                    strokeDasharray="18 14"
                    strokeWidth="5"
                  />
                  <line
                    x1="200"
                    y1="175"
                    x2="1800"
                    y2="175"
                    stroke="rgba(255,255,255,0.35)"
                    strokeDasharray="18 14"
                    strokeWidth="5"
                  />
                  <line
                    x1="200"
                    y1="825"
                    x2="1800"
                    y2="825"
                    stroke="rgba(255,255,255,0.35)"
                    strokeDasharray="18 14"
                    strokeWidth="5"
                  />
                </svg>
              </div>
              {/* Team pools (left = Team A, right = Team B). Drop here to return to pool. */}
              <div className="absolute left-6 top-1/2 -translate-y-1/2 text-white text-xs md:text-sm z-10">
                <TeamPool team="A">
                  <div className="text-center font-semibold">Team A</div>
                  {(availableA.length ? availableA : ["TBD"]).map((n, i) => (
                    <div key={`court-a-pool-${i}`} className="text-center">
                      {typeof n === "string" ? (
                        n === "TBD" ? (
                          "TBD"
                        ) : (
                          <PlayerChip team="A" name={n} />
                        )
                      ) : null}
                    </div>
                  ))}
                </TeamPool>
              </div>
              <div className="absolute right-6 top-1/2 -translate-y-1/2 text-white text-xs md:text-sm z-10">
                <TeamPool team="B">
                  <div className="text-center font-semibold">Team B</div>
                  {(availableB.length ? availableB : ["TBD"]).map((n, i) => (
                    <div key={`court-b-pool-${i}`} className="text-center">
                      {typeof n === "string" ? (
                        n === "TBD" ? (
                          "TBD"
                        ) : (
                          <PlayerChip team="B" name={n} />
                        )
                      ) : null}
                    </div>
                  ))}
                </TeamPool>
              </div>
              {/* Droppable zones: A top/bottom (left); B top/bottom (right) */}
              <CourtDropZone
                team="A"
                zone="top"
                style={{
                  left: courtRect.left,
                  top: courtRect.top,
                  width: courtRect.width / 2,
                  height: courtRect.height / 2,
                }}
              >
                {courtAssign.A.top.length > 0 ? (
                  <PlayerChip team="A" name={courtAssign.A.top[0]} />
                ) : null}
              </CourtDropZone>
              <CourtDropZone
                team="A"
                zone="bottom"
                style={{
                  left: courtRect.left,
                  top: courtRect.top + courtRect.height / 2,
                  width: courtRect.width / 2,
                  height: courtRect.height / 2,
                }}
              >
                {courtAssign.A.bottom.length > 0 ? (
                  <PlayerChip team="A" name={courtAssign.A.bottom[0]} />
                ) : null}
              </CourtDropZone>
              <CourtDropZone
                team="B"
                zone="top"
                style={{
                  left: courtRect.left + courtRect.width / 2,
                  top: courtRect.top,
                  width: courtRect.width / 2,
                  height: courtRect.height / 2,
                }}
              >
                {courtAssign.B.top.length > 0 ? (
                  <PlayerChip team="B" name={courtAssign.B.top[0]} />
                ) : null}
              </CourtDropZone>
              <CourtDropZone
                team="B"
                zone="bottom"
                style={{
                  left: courtRect.left + courtRect.width / 2,
                  top: courtRect.top + courtRect.height / 2,
                  width: courtRect.width / 2,
                  height: courtRect.height / 2,
                }}
              >
                {courtAssign.B.bottom.length > 0 ? (
                  <PlayerChip team="B" name={courtAssign.B.bottom[0]} />
                ) : null}
              </CourtDropZone>
              {/* Ghost chip for touch dragging */}
              {draggingItem && dragPos && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: dragPos.x - overlayOffset.left,
                    top: dragPos.y - overlayOffset.top,
                    transform: "translate(-50%, -50%)",
                    zIndex: 5,
                  }}
                >
                  <div className="inline-flex items-center rounded-full bg-white/90 text-black text-[11px] md:text-xs px-2 py-1">
                    {draggingItem.name}
                  </div>
                </div>
              )}
            </div>
          </DndContext>
          <canvas ref={canvasRef} className="hidden" />

          <div className="absolute top-0 left-0 right-0 p-3 flex flex-col gap-4 items-center justify-between text-white text-sm">
            <div className="w-full flex justify-between gap-2">
              <div className="flex flex-col items-start gap-2">
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
                <button
                  onClick={() =>
                    setFacingMode((m) =>
                      m === "environment" ? "user" : "environment"
                    )
                  }
                  className="rounded-md bg-white/10 px-3 py-1 backdrop-blur border border-white/20"
                >
                  Switch camera
                </button>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={debugEnabled}
                    onChange={(e) => setDebugEnabled(e.target.checked)}
                  />
                  <span>Debug overlay</span>
                </label>
                {debugEnabled && (
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={requirePalmFront}
                      onChange={(e) => setRequirePalmFront(e.target.checked)}
                    />
                    <span>Open palm: front only</span>
                  </label>
                )}
                {debugEnabled && (
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={requireFistSideOn}
                      onChange={(e) => setRequireFistSideOn(e.target.checked)}
                    />
                    <span>Fist: side-on only</span>
                  </label>
                )}
                {debugEnabled && (
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={invertPalmFrontTest}
                      onChange={(e) => setInvertPalmFrontTest(e.target.checked)}
                    />
                    <span>Invert palm test</span>
                  </label>
                )}
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
                  {!gestureEnabled ? (
                    <button
                      onClick={() => {
                        setGestureEnabled(true);
                        if (speechEnabled) {
                          // Button click is a user gesture; safe to unlock
                          unlockAudioAndSpeech();
                        }
                      }}
                      className="rounded-md bg-white/10 px-3 py-1 backdrop-blur border border-white/20"
                    >
                      Activate Gesture
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setGestureEnabled(false);
                      }}
                      className="rounded-md bg-white/10 px-3 py-1 backdrop-blur border border-white/20"
                    >
                      Deactivate Gesture
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const next = !speechEnabled;
                        setSpeechEnabled(next);
                        if (next) {
                          // Enabling voice: unlock on user gesture
                          unlockAudioAndSpeech();
                        }
                      }}
                      className={`rounded-md px-3 py-1 backdrop-blur border border-white/20 ${
                        speechEnabled
                          ? "bg-red-600 text-white"
                          : "bg-green-600 text-white"
                      }`}
                    >
                      {speechEnabled ? "Off voice" : "On voice"}
                    </button>
                    <button
                      onClick={testSpeak}
                      className="rounded-md bg-white/10 px-3 py-1 backdrop-blur border border-white/20"
                    >
                      Test voice
                    </button>
                  </div>
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
                    onClick={() => {
                      setScoreA((s) => s + 1);
                      speakScore("A");
                    }}
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
                    onClick={() => {
                      setScoreB((s) => s + 1);
                      speakScore("B");
                    }}
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
                className="rounded-xl bg-red-600 text-white px-4 py-2 text-sm font-semibold shadow-lg"
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
