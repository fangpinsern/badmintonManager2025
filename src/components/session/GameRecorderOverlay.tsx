"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { ReasonCode, UmpireRally } from "@/types/player";
import { REASONS } from "@/types/player";
// Drag-and-drop removed
import {
  computeNextService,
  computeTargetPlan,
  sideZoneForServiceCourt,
} from "../../lib/rules/service";
import { logAnalyticsEvent } from "@/lib/analytics";

type GameRecorderOverlayProps = {
  open: boolean;
  teamA: string[];
  teamB: string[];
  teamAIds?: string[];
  teamBIds?: string[];
  onRequestClose: () => void;
  onRequestEndGame: (
    scoreA: number,
    scoreB: number,
    opts?: {
      umpireHistory?: UmpireRally[];
    }
  ) => void;
  gameLabel?: string;
};

function GameRecorderOverlay({
  open,
  teamA,
  teamB,
  teamAIds,
  teamBIds,
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
  // Drag-and-drop refs removed
  // Drag-and-drop removed
  // Service/rules state
  const [servingSide, setServingSide] = useState<"A" | "B" | null>(null);
  const [serverName, setServerName] = useState<string | null>(null);
  const [serviceCourt, setServiceCourt] = useState<"left" | "right">("right");
  const [serviceWarnings, setServiceWarnings] = useState<string[]>([]);
  const [showServiceSetup, setShowServiceSetup] = useState<boolean>(false);
  const [targetPositions, setTargetPositions] = useState<
    Record<string, { x: number; y: number; role: string }>
  >({});
  const [chipsLocked, setChipsLocked] = useState<boolean>(false);
  const [setupStep, setSetupStep] = useState<1 | 2>(1);
  const [selATop, setSelATop] = useState<string>("");
  const [selABottom, setSelABottom] = useState<string>("");
  const [selBTop, setSelBTop] = useState<string>("");
  const [selBBottom, setSelBBottom] = useState<string>("");
  // Which team is rendered on the left half (supports side switch)
  const [leftTeam, setLeftTeam] = useState<"A" | "B">("A");
  // Optional per-point annotations (recorded on history entries)
  const [reasonMenuOpen, setReasonMenuOpen] = useState<boolean>(false);
  const [pendingEventIndex, setPendingEventIndex] = useState<number | null>(
    null
  );
  const [reasonStage, setReasonStage] = useState<1 | 2>(1);
  const [reasonEnabled, setReasonEnabled] = useState<boolean>(true);
  // Timing: timestamp of last completed point (or lineup confirmation for the first point)
  const lastPointAtRef = useRef<number | null>(null);
  // Scroll lock refs
  const prevBodyOverflowRef = useRef<string>("");
  const prevHtmlOverscrollRef = useRef<string>("");
  const prevBodyTouchActionRef = useRef<string>("");
  const dupA = useMemo(
    () => Boolean(selATop) && Boolean(selABottom) && selATop === selABottom,
    [selATop, selABottom]
  );
  const dupB = useMemo(
    () => Boolean(selBTop) && Boolean(selBBottom) && selBTop === selBBottom,
    [selBTop, selBBottom]
  );
  const setupError = useMemo(() => {
    const msgs: string[] = [];
    if (dupA) msgs.push("Team A has duplicate players in starting positions.");
    if (dupB) msgs.push("Team B has duplicate players in starting positions.");
    return msgs.join(" ");
  }, [dupA, dupB]);
  // Drag-and-drop collision preference removed
  // Court assignments for drag-and-drop placement
  const [courtAssign, setCourtAssign] = useState<{
    A: { top: string[]; bottom: string[] };
    B: { top: string[]; bottom: string[] };
  }>({
    A: { top: [], bottom: [] },
    B: { top: [], bottom: [] },
  });
  // ---- Undo history (placed after courtAssign so it's in scope)
  type HistoryEntry = {
    scoreA: number;
    scoreB: number;
    servingSide: "A" | "B" | null;
    serverName: string | null;
    serviceCourt: "left" | "right";
    courtAssign: {
      A: { top: string[]; bottom: string[] };
      B: { top: string[]; bottom: string[] };
    };
    targetPositions: Record<string, { x: number; y: number; role: string }>;
    chipsLocked: boolean;
    showServiceSetup: boolean;
    setupStep: 1 | 2;
    serviceWarnings: string[];
    // Optional rally annotation (set when a point is recorded)
    rallyNo?: number;
    winnerSide?: "A" | "B";
    // Time between this rally and the previous point (ms). For first point, measured from lineup confirmation.
    rallyDurationMs?: number;
    reason?: {
      code: ReasonCode;
      attr: "WINNER" | "LOSER" | "NONE";
      attributedTo?: {
        side: "A" | "B";
        playerId?: string;
      };
    };
  };
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const cloneAssign = useCallback(
    (a: {
      A: { top: string[]; bottom: string[] };
      B: { top: string[]; bottom: string[] };
    }) => {
      return {
        A: { top: [...a.A.top], bottom: [...a.A.bottom] },
        B: { top: [...a.B.top], bottom: [...a.B.bottom] },
      };
    },
    []
  );
  const cloneTargets = useCallback(
    (t: Record<string, { x: number; y: number; role: string }>) => {
      const out: Record<string, { x: number; y: number; role: string }> = {};
      for (const k in t) out[k] = { ...t[k] };
      return out;
    },
    []
  );
  const pushHistory = useCallback(() => {
    try {
      const snapshot: HistoryEntry = {
        scoreA: scoreARef.current,
        scoreB: scoreBRef.current,
        servingSide,
        serverName,
        serviceCourt,
        courtAssign: cloneAssign(courtAssign),
        targetPositions: cloneTargets(targetPositions),
        chipsLocked,
        showServiceSetup,
        setupStep,
        serviceWarnings: [...(serviceWarnings || [])],
      };
      setHistory((h) => [...h, snapshot]);
    } catch {}
  }, [
    servingSide,
    serverName,
    serviceCourt,
    courtAssign,
    targetPositions,
    chipsLocked,
    showServiceSetup,
    setupStep,
    serviceWarnings,
    cloneAssign,
    cloneTargets,
  ]);
  const onUndo = useCallback(() => {
    try {
      setHistory((prev) => {
        if (!prev.length) return prev;
        const next = prev.slice(0, -1);
        const last = prev[prev.length - 1];
        setScoreA(last.scoreA);
        setScoreB(last.scoreB);
        setServingSide(last.servingSide);
        setServerName(last.serverName);
        setServiceCourt(last.serviceCourt);
        setCourtAssign(cloneAssign(last.courtAssign));
        setTargetPositions(cloneTargets(last.targetPositions));
        setChipsLocked(last.chipsLocked);
        setShowServiceSetup(last.showServiceSetup);
        setSetupStep(last.setupStep);
        setServiceWarnings(last.serviceWarnings);
        // Close reason menu after undo
        setReasonMenuOpen(false);
        setPendingEventIndex(null);
        return next;
      });
    } catch {}
  }, [cloneAssign, cloneTargets]);
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

  // Ensure reason panel is off while in gesture mode
  useEffect(() => {
    try {
      if (gestureEnabled) {
        setReasonEnabled(false);
        // If a reason panel is open, close it
        setReasonMenuOpen(false);
        setPendingEventIndex(null);
        setReasonStage(1);
      }
    } catch {}
  }, [gestureEnabled]);

  // ---- Reason/attribution helpers (pure; for readability; no behavior change)
  const findReasonMeta = useCallback(
    (code: ReasonCode) => REASONS.find((r) => r.code === code),
    []
  );
  const getAttrForReason = useCallback(
    (code: ReasonCode): "WINNER" | "LOSER" | "NONE" => {
      const meta = findReasonMeta(code);
      return (meta?.attr || "NONE") as "WINNER" | "LOSER" | "NONE";
    },
    [findReasonMeta]
  );
  const computeTargetSideForAttr = useCallback(
    (attr: "WINNER" | "LOSER" | "NONE", evt: any): "A" | "B" | null => {
      if (attr === "NONE") return null;
      const w = evt?.winnerSide as "A" | "B" | undefined;
      if (!w) return null;
      return attr === "WINNER" ? w : w === "A" ? "B" : "A";
    },
    []
  );
  const canSelectServiceFault = useCallback((evt: any) => {
    return (
      evt &&
      evt.servingSide &&
      evt.winnerSide &&
      evt.winnerSide !== evt.servingSide
    );
  }, []);

  const setReasonForPending = useCallback(
    (code: ReasonCode) => {
      try {
        if (pendingEventIndex === null) return;
        // SERVICE-FAULT: only when server lost; attribute to server immediately, then close
        if (code === "SERVICE-FAULT") {
          const idx = Math.min(pendingEventIndex, (history?.length || 1) - 1);
          const evt = (history[idx] || {}) as any;
          const servingSide = evt.servingSide as "A" | "B" | null;
          const winnerSide = evt.winnerSide as "A" | "B" | undefined;
          if (servingSide && winnerSide && winnerSide !== servingSide) {
            const targetSide: "A" | "B" = servingSide;
            const arr = targetSide === "A" ? teamA : teamB;
            const ids = targetSide === "A" ? teamAIds || [] : teamBIds || [];
            let pid: string | undefined;
            if (typeof evt.serverName === "string") {
              const nameIdx = (arr || []).findIndex(
                (n: string) => n === evt.serverName
              );
              pid = nameIdx >= 0 ? ids[nameIdx] : ids[0];
            } else {
              pid = ids[0];
            }
            setHistory((prev) => {
              if (!prev.length) return prev;
              const nidx = Math.min(pendingEventIndex, prev.length - 1);
              const next = [...prev];
              const cur = (next as any)[nidx];
              (next as any)[nidx] = {
                ...cur,
                reason: {
                  code,
                  attr: "LOSER",
                  attributedTo: { playerId: pid },
                },
              };
              return next;
            });
            setReasonMenuOpen(false);
            setPendingEventIndex(null);
          }
          return;
        }
        setHistory((prev) => {
          if (!prev.length) return prev;
          const idx = Math.min(pendingEventIndex, prev.length - 1);
          const next = [...prev];
          const attr = getAttrForReason(code);
          (next as any)[idx] = {
            ...(next as any)[idx],
            reason: { code, attr },
          };
          return next;
        });
        // Stage 2 attribution rules based on reason type
        try {
          const idx = pendingEventIndex;
          const evt = (history[idx] || {}) as any;
          const attr = getAttrForReason(code);
          if (attr === "NONE") {
            setReasonMenuOpen(false);
            setPendingEventIndex(null);
            return;
          }
          const targetSide = computeTargetSideForAttr(attr, evt) as "A" | "B";
          const targetNames = targetSide === "A" ? teamA : teamB;
          const targetIds =
            targetSide === "A" ? teamAIds || [] : teamBIds || [];
          const isDoubles = (targetNames || []).length === 2;
          if (!isDoubles) {
            const pid = targetIds[0];
            if (pid) {
              setHistory((prev) => {
                if (!prev.length) return prev;
                const i2 = Math.min(pendingEventIndex, prev.length - 1);
                const next2 = [...prev];
                const cur = (next2 as any)[i2];
                (next2 as any)[i2] = {
                  ...cur,
                  reason: {
                    ...(cur.reason || { code, attr }),
                    attributedTo: { playerId: pid },
                  },
                };
                return next2;
              });
            }
            setReasonMenuOpen(false);
            setPendingEventIndex(null);
          } else {
            // For doubles, proceed to Stage 2 (separate page for attribution)
            setReasonStage(2);
          }
        } catch {}
      } catch {}
    },
    [
      pendingEventIndex,
      history,
      teamA,
      teamB,
      teamAIds,
      teamBIds,
      getAttrForReason,
      computeTargetSideForAttr,
    ]
  );

  const setBlameForPending = useCallback(
    (playerId: string) => {
      try {
        if (pendingEventIndex === null) return;
        setHistory((prev) => {
          if (!prev.length) return prev;
          const idx = Math.min(pendingEventIndex, prev.length - 1);
          const next = [...prev];
          const cur = (next as any)[idx];
          const side =
            (cur &&
              cur.reason &&
              cur.reason.attributedTo &&
              cur.reason.attributedTo.side) ||
            (cur && cur.winnerSide) ||
            "A";
          (next as any)[idx] = {
            ...cur,
            reason: {
              ...(cur.reason || {}),
              attributedTo: { playerId },
            },
          };
          return next;
        });
      } catch {}
    },
    [pendingEventIndex]
  );

  // Player pools shown by side orientation (display-only)
  const poolLeft = (leftTeam === "A" ? teamA : teamB) || [];
  const poolRight = (leftTeam === "A" ? teamB : teamA) || [];

  // Drag-and-drop handlers removed

  function PlayerChip({ team, name }: { team: "A" | "B"; name: string }) {
    return (
      <div className="inline-flex items-center rounded-full bg-white/90 text-black text-[11px] md:text-xs px-2 py-1 m-1">
        {name}
      </div>
    );
  }

  function TeamPool({ children }: { children: any }) {
    return (
      <div className="inline-block rounded-md bg-black/35 border border-white/10 px-3 py-2">
        {children}
      </div>
    );
  }

  function CourtZone({
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
    const baseColor =
      team === "A"
        ? zone === "top"
          ? "bg-red-500"
          : "bg-orange-500"
        : zone === "top"
        ? "bg-blue-500"
        : "bg-green-500";
    const bgClass = `${baseColor}/20 border-white/30`;
    return (
      <div className="absolute" style={style}>
        <div className={`relative w-full h-full rounded-md border ${bgClass}`}>
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
      // Hard reset all umpire-mode state so each entry starts fresh
      setHistory([]);
      setCourtAssign({
        A: { top: [], bottom: [] },
        B: { top: [], bottom: [] },
      });
      setTargetPositions({});
      setChipsLocked(false);
      setSetupStep(1);
      setSelATop("");
      setSelABottom("");
      setSelBTop("");
      setSelBBottom("");
      setLeftTeam("A");
      setBubbleA(false);
      setBubbleB(false);
      setDebugRects([]);
      setReasonMenuOpen(false);
      setPendingEventIndex(null);
      setServingSide(null);
      setServerName(null);
      setServiceCourt("right");
      setServiceWarnings([]);
      setTargetPositions({});
      setShowServiceSetup(true);
      // Lock scroll while umpire mode open
      try {
        prevBodyOverflowRef.current = document.body.style.overflow || "";
        prevBodyTouchActionRef.current =
          (document.body.style as any).touchAction || "";
        prevHtmlOverscrollRef.current =
          (document.documentElement.style as any).overscrollBehavior || "";
        document.body.style.overflow = "hidden";
        (document.body.style as any).touchAction = "none";
        (document.documentElement.style as any).overscrollBehavior = "none";
      } catch {}
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
      // Restore scroll lock
      try {
        document.body.style.overflow = prevBodyOverflowRef.current || "";
        (document.body.style as any).touchAction =
          prevBodyTouchActionRef.current || "";
        (document.documentElement.style as any).overscrollBehavior =
          prevHtmlOverscrollRef.current || "";
      } catch {}
    };
  }, [open, facingMode]);

  // Helper: zone center in pixels within overlay container
  const zoneCenter = useCallback(
    (team: "A" | "B", zone: "top" | "bottom") => {
      const halfW = courtRect.width / 2;
      const halfH = courtRect.height / 2;
      const x =
        team === leftTeam
          ? courtRect.left + halfW / 2
          : courtRect.left + halfW + halfW / 2;
      const y =
        zone === "top"
          ? courtRect.top + halfH / 2
          : courtRect.top + halfH + halfH / 2;
      return { x, y };
    },
    [courtRect, leftTeam]
  );

  // Map service-court (left/right relative to serving side) to screen zone given current side orientation
  const effectiveZoneForServiceCourt = useCallback(
    (team: "A" | "B", court: "left" | "right"): "top" | "bottom" => {
      const teamIsLeft = team === leftTeam;
      if (teamIsLeft) return court === "right" ? "bottom" : "top";
      return court === "right" ? "top" : "bottom";
    },
    [leftTeam]
  );

  // Helper: recompute current target markers based on service state and assignments
  const recomputeTargets = useCallback(() => {
    try {
      if (!servingSide) {
        setTargetPositions({});
        return;
      }
      const countA =
        (courtAssign.A.top.length ? 1 : 0) +
        (courtAssign.A.bottom.length ? 1 : 0);
      const countB =
        (courtAssign.B.top.length ? 1 : 0) +
        (courtAssign.B.bottom.length ? 1 : 0);
      const isDoubles = countA === 2 && countB === 2;
      const service = {
        servingSide,
        serverName,
        serviceCourt,
        receivingSide: servingSide === "A" ? "B" : "A",
      } as any;
      const plan = computeTargetPlan(service, isDoubles, courtAssign);
      const servingZone = effectiveZoneForServiceCourt(
        service.servingSide,
        service.serviceCourt
      );
      const servingPartnerZone = servingZone === "top" ? "bottom" : "top";
      const recvSide = service.receivingSide as "A" | "B";
      const receiverZone = effectiveZoneForServiceCourt(
        recvSide,
        service.serviceCourt
      );
      const receiverPartnerZone = receiverZone === "top" ? "bottom" : "top";
      const pos: Record<string, { x: number; y: number; role: string }> = {};
      // Recompute zones per role with current orientation to place markers
      for (const t of plan.targets) {
        const z: "top" | "bottom" =
          t.team === service.servingSide
            ? t.role === "server"
              ? servingZone
              : servingPartnerZone
            : t.role === "receiver"
            ? receiverZone
            : receiverPartnerZone;
        const c = zoneCenter(t.team, z);
        pos[t.player] = { x: c.x, y: c.y, role: t.role };
      }
      setTargetPositions(pos);
      setServiceWarnings(plan.warnings || []);
    } catch {}
  }, [
    servingSide,
    serverName,
    serviceCourt,
    courtAssign,
    zoneCenter,
    effectiveZoneForServiceCourt,
  ]);

  useEffect(() => {
    recomputeTargets();
  }, [recomputeTargets]);

  // Point increment wrapper (applies rules and computes targets)
  const onPoint = useCallback(
    (winner: "A" | "B") => {
      try {
        const nowTs = Date.now();
        const durationMs =
          typeof lastPointAtRef.current === "number"
            ? Math.max(0, nowTs - lastPointAtRef.current)
            : undefined;
        // Snapshot current state for undo
        pushHistory();
        const countA =
          (courtAssign.A.top.length ? 1 : 0) +
          (courtAssign.A.bottom.length ? 1 : 0);
        const countB =
          (courtAssign.B.top.length ? 1 : 0) +
          (courtAssign.B.bottom.length ? 1 : 0);
        const isDoubles = countA === 2 && countB === 2;
        const next = computeNextService(
          {
            scores: { scoreA: scoreARef.current, scoreB: scoreBRef.current },
            service: {
              servingSide,
              serverName,
              serviceCourt,
            },
          },
          winner,
          isDoubles,
          courtAssign
        );
        setServingSide(next.servingSide);
        setServerName(next.serverName);
        setServiceCourt(next.serviceCourt);
        const plan = computeTargetPlan(next, isDoubles, courtAssign);
        // Compute zones per orientation
        const servingZone = effectiveZoneForServiceCourt(
          next.servingSide as "A" | "B",
          next.serviceCourt
        );
        const servingPartnerZone = servingZone === "top" ? "bottom" : "top";
        const recvSide = next.receivingSide as "A" | "B";
        const receiverZone = effectiveZoneForServiceCourt(
          recvSide,
          next.serviceCourt
        );
        const receiverPartnerZone = receiverZone === "top" ? "bottom" : "top";
        // Apply target plan to chip assignment using orientation-aware zones
        setCourtAssign(() => {
          const nextAssign = {
            A: { top: [] as string[], bottom: [] as string[] },
            B: { top: [] as string[], bottom: [] as string[] },
          };
          for (const t of plan.targets) {
            const z =
              t.team === next.servingSide
                ? t.role === "server"
                  ? servingZone
                  : servingPartnerZone
                : t.role === "receiver"
                ? receiverZone
                : receiverPartnerZone;
            nextAssign[t.team][z] = [t.player];
          }
          return nextAssign;
        });
        const pos: Record<string, { x: number; y: number; role: string }> = {};
        for (const t of plan.targets) {
          const z =
            t.team === next.servingSide
              ? t.role === "server"
                ? servingZone
                : servingPartnerZone
              : t.role === "receiver"
              ? receiverZone
              : receiverPartnerZone;
          const c = zoneCenter(t.team, z);
          pos[t.player] = { x: c.x, y: c.y, role: t.role };
        }
        setTargetPositions(pos);
        setServiceWarnings(plan.warnings || []);
        if (!chipsLocked) setChipsLocked(true);
        const nextA =
          winner === "A" ? scoreARef.current + 1 : scoreARef.current;
        const nextB =
          winner === "B" ? scoreBRef.current + 1 : scoreBRef.current;
        if (winner === "A") setScoreA((s) => s + 1);
        else setScoreB((s) => s + 1);
        // Annotate last history entry (this rally)
        setHistory((prev) => {
          if (!prev.length) return prev;
          const idx = prev.length - 1;
          const next = [...prev];
          (next as any)[idx] = {
            ...(next as any)[idx],
            rallyNo: (next as any)[idx]?.rallyNo || prev.length,
            winnerSide: winner,
            rallyDurationMs: durationMs,
          };
          return next;
        });
        // Set baseline for next rally duration
        lastPointAtRef.current = nowTs;
        if (reasonEnabled) {
          setPendingEventIndex(() => Math.max(0, history.length));
          setReasonMenuOpen(true);
          setReasonStage(1);
        } else {
          setPendingEventIndex(null);
          setReasonMenuOpen(false);
          setReasonStage(1);
        }
        speakScore(winner);
      } catch {}
    },
    [
      courtAssign,
      servingSide,
      serverName,
      serviceCourt,
      speakScore,
      zoneCenter,
      chipsLocked,
      pushHistory,
      reasonEnabled,
    ]
  );

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
          showBubble("A");
          onPoint("A");
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
          showBubble("B");
          onPoint("B");
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
            {/* Team pools (left/right follow orientation). Display only. */}
            <div className="absolute left-6 top-1/2 -translate-y-1/2 text-white text-xs md:text-sm z-10">
              <TeamPool>
                <div className="text-center font-semibold">
                  {leftTeam === "A" ? "Team A" : "Team B"}
                </div>
                {(poolLeft.length ? poolLeft : ["TBD"]).map((n, i) => (
                  <div key={`court-a-pool-${i}`} className="text-center">
                    {typeof n === "string" ? (
                      n === "TBD" ? (
                        "TBD"
                      ) : (
                        <PlayerChip team={leftTeam} name={n} />
                      )
                    ) : null}
                  </div>
                ))}
              </TeamPool>
            </div>
            <div className="absolute right-6 top-1/2 -translate-y-1/2 text-white text-xs md:text-sm z-10">
              <TeamPool>
                <div className="text-center font-semibold">
                  {leftTeam === "A" ? "Team B" : "Team A"}
                </div>
                {(poolRight.length ? poolRight : ["TBD"]).map((n, i) => (
                  <div key={`court-b-pool-${i}`} className="text-center">
                    {typeof n === "string" ? (
                      n === "TBD" ? (
                        "TBD"
                      ) : (
                        <PlayerChip
                          team={leftTeam === "A" ? "B" : "A"}
                          name={n}
                        />
                      )
                    ) : null}
                  </div>
                ))}
              </TeamPool>
            </div>
            {/* Zones: A top/bottom (left); B top/bottom (right) */}
            {/* <CourtZone
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
            </CourtZone>
            <CourtZone
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
            </CourtZone>
            <CourtZone
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
            </CourtZone>
            <CourtZone
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
            </CourtZone> */}
            {/* Suggested target markers */}
            {Object.entries(targetPositions).map(([name, pos]) => (
              <div
                key={`marker-${name}`}
                className="absolute pointer-events-none z-[6]"
                style={{
                  left: pos.x,
                  top: pos.y,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`h-3 w-3 rounded-full shadow ${
                      pos.role === "server" ? "bg-red-500" : "bg-yellow-300"
                    }`}
                  />
                  <div className="text-[10px] md:text-xs text-white/90 px-1 rounded bg-black/40 border border-white/10">
                    {pos.role}
                  </div>
                  <div className="text-[10px] md:text-xs text-white/90">
                    {name}
                  </div>
                </div>
              </div>
            ))}
          </div>

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
            <div className="pointer-events-auto">
              <button
                onClick={() => {
                  const next = !reasonEnabled;
                  setReasonEnabled(next);
                  try {
                    void logAnalyticsEvent("umpire_reasons_toggle", {
                      enabled: next,
                    });
                  } catch {}
                  if (!next) {
                    setReasonMenuOpen(false);
                    setPendingEventIndex(null);
                    setReasonStage(1);
                  }
                }}
                disabled={gestureEnabled}
                className={`rounded-md px-3 py-1 backdrop-blur border border-white/20 ${
                  reasonEnabled && !gestureEnabled
                    ? "bg-blue-600 text-white"
                    : "bg-white/10 text-white/80"
                } disabled:opacity-50`}
                title={
                  gestureEnabled
                    ? "Disabled while gesture mode is active"
                    : reasonEnabled
                    ? "Turn off reason panel"
                    : "Turn on reason panel"
                }
              >
                {reasonEnabled ? "Reasons: On" : "Reasons: Off"}
              </button>
            </div>
            <div className="pointer-events-auto mx-auto max-w-md w-full rounded-xl bg-black/40 border border-white/10 p-4 text-white">
              <div className="grid grid-cols-3 items-center gap-3">
                <div className="flex items-center justify-start gap-3">
                  <button
                    onClick={() => {
                      onPoint(leftTeam);
                    }}
                    className="rounded-md border border-white/20 bg-white/10 px-4 py-3 text-2xl"
                  >
                    +
                  </button>
                </div>
                <div className="flex flex-col items-center">
                  <div className="text-center text-2xl md:text-3xl font-semibold tracking-wide">
                    {leftTeam === "A" ? scoreA : scoreB} :{" "}
                    {leftTeam === "A" ? scoreB : scoreA}
                  </div>
                  <div className="mt-2 flex">
                    <button
                      onClick={onUndo}
                      disabled={history.length === 0}
                      title="Undo last point"
                      className={`px-2 py-1 rounded-full border border-white/20 ${
                        history.length === 0
                          ? "bg-white/5 text-white/50"
                          : "bg-white/10 text-white"
                      } flex items-center justify-center`}
                    >
                      ↺ undo
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => {
                      onPoint(leftTeam === "A" ? "B" : "A");
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
                  try {
                    // Debug: log full history including reason/blame annotations
                    // eslint-disable-next-line no-console
                    console.log("Umpire history entries:", history);
                  } catch {}
                  stopAndSave();
                  try {
                    // Build compact history and durations for persistence
                    const compact: UmpireRally[] = (history || [])
                      .filter(
                        (h) =>
                          typeof (h as any)?.rallyNo === "number" &&
                          ((h as any)?.winnerSide === "A" ||
                            (h as any)?.winnerSide === "B")
                      )
                      .map((h) => {
                        const r = (h as any)?.reason;
                        return {
                          rallyNo: (h as any).rallyNo as number,
                          winnerSide: ((h as any).winnerSide || "A") as
                            | "A"
                            | "B",
                          rallyDurationMs:
                            typeof (h as any)?.rallyDurationMs === "number"
                              ? ((h as any).rallyDurationMs as number)
                              : undefined,
                          reason: r
                            ? {
                                code: r.code,
                                attr: r.attr,
                                attributedTo: r.attributedTo
                                  ? {
                                      side: r.attributedTo.side,
                                      playerId: r.attributedTo.playerId,
                                    }
                                  : undefined,
                              }
                            : undefined,
                        } as UmpireRally;
                      });
                    const opts =
                      compact.length > 0
                        ? { umpireHistory: compact }
                        : undefined;
                    onRequestEndGame(scoreA, scoreB, opts);
                  } catch {
                    onRequestEndGame(scoreA, scoreB);
                  }
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

          {/* Optional reason/blame picker for last point (non-blocking) */}
          {reasonMenuOpen &&
          pendingEventIndex !== null &&
          history &&
          history[pendingEventIndex] ? (
            <div className="pointer-events-auto fixed left-0 right-0 bottom-[92px] z-[6] px-3">
              <div className="mx-auto max-w-md w-full rounded-xl bg-white text-black shadow-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {reasonStage === 2 ? (
                      <button
                        onClick={() => setReasonStage(1)}
                        className="rounded-md px-2 py-1 text-xs border border-gray-300"
                        title="Back"
                      >
                        Back
                      </button>
                    ) : null}
                    <div className="text-sm font-semibold">
                      {reasonStage === 1
                        ? "Why was the point lost?"
                        : "Attribute to player (optional)"}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setReasonMenuOpen(false);
                      setPendingEventIndex(null);
                      setReasonStage(1);
                    }}
                    className="rounded-md px-2 py-1 text-xs border border-gray-300"
                    title="Done"
                  >
                    Done
                  </button>
                </div>
                {reasonStage === 1
                  ? (() => {
                      const idx = pendingEventIndex as number;
                      const selectedCode = (history[idx] as any)?.reason
                        ?.code as ReasonCode | undefined;
                      const evt = history[idx] as any;
                      // Filter: SERVICE-FAULT appears only when server loses
                      const canShowServiceFault = canSelectServiceFault(evt);
                      const reasonsList = REASONS.filter(
                        (r) => r.code !== "SERVICE-FAULT" || canShowServiceFault
                      );
                      const btnCls = (code: ReasonCode) =>
                        `rounded-md border px-2 py-1 ${
                          selectedCode === code
                            ? "bg-black text-white border-black"
                            : ""
                        }`;
                      return (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                          {reasonsList.map((r) => (
                            <button
                              key={r.code}
                              onClick={() => setReasonForPending(r.code)}
                              className={btnCls(r.code)}
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                      );
                    })()
                  : (() => {
                      const evt = history[pendingEventIndex] as any;
                      const code =
                        (evt?.reason?.code as ReasonCode | undefined) ||
                        undefined;
                      const attr = getAttrForReason(code as ReasonCode);
                      const effAttr = (attr || "NONE") as
                        | "WINNER"
                        | "LOSER"
                        | "NONE";
                      if (effAttr === "NONE") return null;
                      const targetSide = computeTargetSideForAttr(
                        effAttr,
                        evt
                      ) as "A" | "B";
                      const targetNames = targetSide === "A" ? teamA : teamB;
                      const targetIds =
                        targetSide === "A" ? teamAIds || [] : teamBIds || [];
                      const isDoubles = (targetNames || []).length === 2;
                      if (!isDoubles) return null;
                      return (
                        <div className="mt-3">
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => {
                                const pid = targetIds[0];
                                if (pid) setBlameForPending(pid);
                                setReasonMenuOpen(false);
                                setPendingEventIndex(null);
                                setReasonStage(1);
                              }}
                              className={`rounded-md border px-2 py-1 text-sm ${
                                evt?.reason?.attributedTo?.playerId ===
                                targetIds[0]
                                  ? "border-black"
                                  : ""
                              }`}
                            >
                              {targetNames[0] || "Player 1"}
                            </button>
                            <button
                              onClick={() => {
                                const pid = targetIds[1];
                                if (pid) setBlameForPending(pid);
                                setReasonMenuOpen(false);
                                setPendingEventIndex(null);
                                setReasonStage(1);
                              }}
                              className={`rounded-md border px-2 py-1 text-sm ${
                                evt?.reason?.attributedTo?.playerId ===
                                targetIds[1]
                                  ? "border-black"
                                  : ""
                              }`}
                            >
                              {targetNames[1] || "Player 2"}
                            </button>
                          </div>
                        </div>
                      );
                    })()}
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="absolute left-0 right-0 top-16 mx-3 rounded-md bg-red-500/90 text-white text-sm p-2 text-center">
              {error}
            </div>
          ) : null}
          {/* Service info banner */}
          {(servingSide && (
            <div
              className={`absolute left-0 right-0 top-2 mx-auto w-max rounded-full bg-black/50 border border-white/10 text-white text-xs px-3 py-1`}
            >
              Serve: {servingSide} • {serviceCourt}
              {serverName ? ` • ${serverName}` : ""}
            </div>
          )) ||
            null}
          {/* Start-of-game service selection */}
          {showServiceSetup && (
            <div className="absolute inset-0 flex items-center justify-center z-[70]">
              <div className="rounded-xl bg-black/80 border border-white/20 text-white p-4 w-[min(90vw,320px)]">
                {setupStep === 1 ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">
                        Who serves first?
                      </div>
                      <button
                        onClick={() => {
                          try {
                            _onRequestClose();
                          } catch {}
                        }}
                        className="rounded-md bg-white/10 px-2 py-1 text-xs border border-white/20"
                      >
                        Exit
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <button
                        onClick={() => {
                          try {
                            const team: "A" | "B" = "A";
                            setServingSide(team);
                            setServiceCourt("right");
                            setServerName(null);
                            // Prefill lineup suggestion
                            setSelATop(teamA[0] || "");
                            setSelABottom(teamA[1] || "");
                            setSelBTop(teamB[0] || "");
                            setSelBBottom(teamB[1] || "");
                            setSetupStep(2);
                          } catch {}
                        }}
                        className="flex-1 rounded-md bg-white/10 px-3 py-2 border border-white/20"
                      >
                        Team A
                      </button>
                      <button
                        onClick={() => {
                          try {
                            const team: "A" | "B" = "B";
                            setServingSide(team);
                            setServiceCourt("right");
                            setServerName(null);
                            // Prefill lineup suggestion
                            setSelATop(teamA[0] || "");
                            setSelABottom(teamA[1] || "");
                            setSelBTop(teamB[0] || "");
                            setSelBBottom(teamB[1] || "");
                            setSetupStep(2);
                          } catch {}
                        }}
                        className="flex-1 rounded-md bg-white/10 px-3 py-2 border border-white/20"
                      >
                        Team B
                      </button>
                    </div>
                    <div className="text-[11px] text-white/80">
                      You can skip drag-and-drop; we’ll set starting positions
                      next.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">
                        Starting positions
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            try {
                              _onRequestClose();
                            } catch {}
                          }}
                          className="rounded-md bg-white/10 px-2 py-1 text-xs border border-white/20"
                        >
                          Exit
                        </button>
                        <button
                          onClick={() =>
                            setLeftTeam((lt) => (lt === "A" ? "B" : "A"))
                          }
                          className="rounded-md bg-white/10 px-2 py-1 text-xs border border-white/20"
                        >
                          Swap sides
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                      {/* Left column follows leftTeam */}
                      <div className="col-span-1">
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-semibold">
                            {leftTeam === "A" ? "Team A" : "Team B"}
                          </div>
                          <button
                            onClick={() => {
                              if (leftTeam === "A") {
                                const aTop = selATop;
                                setSelATop(selABottom);
                                setSelABottom(aTop);
                              } else {
                                const bTop = selBTop;
                                setSelBTop(selBBottom);
                                setSelBBottom(bTop);
                              }
                            }}
                            className="rounded-md bg-white/10 px-2 py-1 border border-white/20"
                            title="Swap positions"
                          >
                            ⇅
                          </button>
                        </div>
                        <div className="mb-1">Top</div>
                        <div className="w-full bg-white/10 border border-white/20 rounded px-2 py-1">
                          {leftTeam === "A"
                            ? selATop || "None"
                            : selBTop || "None"}
                        </div>
                        <div className="mt-2 mb-1">Bottom</div>
                        <div className="w-full bg-white/10 border border-white/20 rounded px-2 py-1">
                          {leftTeam === "A"
                            ? selABottom || "None"
                            : selBBottom || "None"}
                        </div>
                      </div>
                      {/* Right column is the other team */}
                      <div className="col-span-1">
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-semibold">
                            {leftTeam === "A" ? "Team B" : "Team A"}
                          </div>
                          <button
                            onClick={() => {
                              if (leftTeam === "A") {
                                const bTop = selBTop;
                                setSelBTop(selBBottom);
                                setSelBBottom(bTop);
                              } else {
                                const aTop = selATop;
                                setSelATop(selABottom);
                                setSelABottom(aTop);
                              }
                            }}
                            className="rounded-md bg-white/10 px-2 py-1 border border-white/20"
                            title="Swap positions"
                          >
                            ⇅
                          </button>
                        </div>
                        <div className="mb-1">Top</div>
                        <div className="w-full bg-white/10 border border-white/20 rounded px-2 py-1">
                          {leftTeam === "A"
                            ? selBTop || "None"
                            : selATop || "None"}
                        </div>
                        <div className="mt-2 mb-1">Bottom</div>
                        <div className="w-full bg-white/10 border border-white/20 rounded px-2 py-1">
                          {leftTeam === "A"
                            ? selBBottom || "None"
                            : selABottom || "None"}
                        </div>
                      </div>
                    </div>
                    {setupError && (
                      <div className="mb-2 text-xs text-red-400">
                        {setupError}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSetupStep(1)}
                        className="rounded-md bg-white/10 px-3 py-2 border border-white/20"
                      >
                        Back
                      </button>
                      <button
                        onClick={() => {
                          try {
                            if (dupA || dupB) return;
                            // Build initial assignment from selections, ensuring no duplicates
                            const used = new Set<string>();
                            const nextAssign = {
                              A: {
                                top: [] as string[],
                                bottom: [] as string[],
                              },
                              B: {
                                top: [] as string[],
                                bottom: [] as string[],
                              },
                            };
                            const pushUnique = (
                              team: "A" | "B",
                              zone: "top" | "bottom",
                              name: string
                            ) => {
                              if (!name) return;
                              if (used.has(name)) return;
                              used.add(name);
                              nextAssign[team][zone] = [name];
                            };
                            pushUnique("A", "top", selATop);
                            pushUnique("A", "bottom", selABottom);
                            pushUnique("B", "top", selBTop);
                            pushUnique("B", "bottom", selBBottom);
                            setCourtAssign(nextAssign);
                            // Compute initial plan from serving side and parity (0 -> right)
                            if (!servingSide) return;
                            // Determine initial server from selected positions (parity zone)
                            const parityZone = effectiveZoneForServiceCourt(
                              servingSide,
                              "right"
                            );
                            const initialServer =
                              nextAssign[servingSide][parityZone][0] ||
                              nextAssign[servingSide][
                                parityZone === "top" ? "bottom" : "top"
                              ][0] ||
                              null;
                            const countA =
                              (nextAssign.A.top.length ? 1 : 0) +
                              (nextAssign.A.bottom.length ? 1 : 0);
                            const countB =
                              (nextAssign.B.top.length ? 1 : 0) +
                              (nextAssign.B.bottom.length ? 1 : 0);
                            const isDoubles = countA === 2 && countB === 2;
                            const nextService = {
                              servingSide,
                              serverName: initialServer,
                              serviceCourt: "right" as const,
                              receivingSide:
                                servingSide === "A"
                                  ? ("B" as const)
                                  : ("A" as const),
                            };
                            const plan = computeTargetPlan(
                              nextService as any,
                              isDoubles,
                              nextAssign
                            );
                            setServerName(initialServer);
                            // Orientation-aware zones for initial layout
                            const servingZone = effectiveZoneForServiceCourt(
                              nextService.servingSide,
                              nextService.serviceCourt
                            );
                            const servingPartnerZone =
                              servingZone === "top" ? "bottom" : "top";
                            const recvSideInit = nextService.receivingSide as
                              | "A"
                              | "B";
                            const receiverZone = effectiveZoneForServiceCourt(
                              recvSideInit,
                              nextService.serviceCourt
                            );
                            const receiverPartnerZone =
                              receiverZone === "top" ? "bottom" : "top";
                            // Snap chips to plan targets using orientation-aware zones
                            setCourtAssign(() => {
                              const applied = {
                                A: {
                                  top: [] as string[],
                                  bottom: [] as string[],
                                },
                                B: {
                                  top: [] as string[],
                                  bottom: [] as string[],
                                },
                              };
                              for (const t of plan.targets) {
                                const z =
                                  t.team === nextService.servingSide
                                    ? t.role === "server"
                                      ? servingZone
                                      : servingPartnerZone
                                    : t.role === "receiver"
                                    ? receiverZone
                                    : receiverPartnerZone;
                                applied[t.team][z] = [t.player];
                              }
                              return applied;
                            });
                            // Compute marker positions (orientation-aware)
                            const pos: Record<
                              string,
                              { x: number; y: number; role: string }
                            > = {};
                            for (const t of plan.targets) {
                              const z =
                                t.team === nextService.servingSide
                                  ? t.role === "server"
                                    ? servingZone
                                    : servingPartnerZone
                                  : t.role === "receiver"
                                  ? receiverZone
                                  : receiverPartnerZone;
                              const c = zoneCenter(t.team, z);
                              pos[t.player] = { x: c.x, y: c.y, role: t.role };
                            }
                            setTargetPositions(pos);
                            setServiceWarnings(plan.warnings || []);
                            setShowServiceSetup(false);
                            // Initialize rally timer start: lineup confirmed now; measure first rally from here
                            try {
                              lastPointAtRef.current = Date.now();
                            } catch {}
                          } catch {}
                        }}
                        className={`flex-1 rounded-md px-3 py-2 border border-white/20 ${
                          dupA || dupB
                            ? "bg-green-600/40 text-white/60"
                            : "bg-green-600"
                        }`}
                        disabled={dupA || dupB}
                      >
                        Confirm lineup
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { GameRecorderOverlay };
