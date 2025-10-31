"use client";

import React from "react";

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
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const [recording, setRecording] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [scoreA, setScoreA] = React.useState<number>(0);
  const [scoreB, setScoreB] = React.useState<number>(0);
  const [paused, setPaused] = React.useState(false);
  const drawReqRef = React.useRef<number | null>(null);
  const scoreARef = React.useRef<number>(0);
  const scoreBRef = React.useRef<number>(0);

  React.useEffect(() => {
    scoreARef.current = scoreA;
  }, [scoreA]);
  React.useEffect(() => {
    scoreBRef.current = scoreB;
  }, [scoreB]);

  const stopAndSave = React.useCallback(() => {
    try {
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
    } catch {}
  }, []);

  React.useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      if (!open) return;
      setError(null);
      setScoreA(0);
      setScoreB(0);
      try {
        // Match device orientation at start so recording matches preview
        // const isPortrait =
        //   typeof window !== "undefined"
        //     ? window.matchMedia &&
        //       window.matchMedia("(orientation: portrait)").matches
        //     : false;
        const isPortrait = false;
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
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        // Setup canvas composition to embed overlays into recording
        const canvas = (canvasRef.current ||= document.createElement("canvas"));
        const baseW = isPortrait ? 720 : 1280;
        const baseH = isPortrait ? 1280 : 720;
        canvas.width = baseW;
        canvas.height = baseH;
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

          // Top bar with teams and game label (larger fonts)
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          ctx.fillRect(0, 0, canvas.width, 100);
          ctx.fillStyle = "#fff";
          ctx.textBaseline = "top";
          // Team A (left)
          let y = 10;
          ctx.textAlign = "left";
          ctx.font = "20px system-ui, -apple-system, Segoe UI, Roboto";
          ctx.fillText("Team A", 16, y);
          y += 26;
          ctx.font = "18px system-ui, -apple-system, Segoe UI, Roboto";
          for (const n of teamA.length ? teamA : ["TBD"]) {
            ctx.fillText(n, 16, y);
            y += 22;
          }
          // Team B (right)
          y = 10;
          ctx.textAlign = "right";
          const rx = canvas.width - 16;
          ctx.font = "20px system-ui, -apple-system, Segoe UI, Roboto";
          ctx.fillText("Team B", rx, y);
          y += 26;
          ctx.font = "18px system-ui, -apple-system, Segoe UI, Roboto";
          for (const n of teamB.length ? teamB : ["TBD"]) {
            ctx.fillText(n, rx, y);
            y += 22;
          }
          // Game label center
          ctx.textAlign = "center";
          if (gameLabel) {
            ctx.font = "20px system-ui, -apple-system, Segoe UI, Roboto";
            ctx.fillText(gameLabel, canvas.width / 2, 12);
          }

          // Score box bottom center (larger)
          const boxW = 300;
          const boxH = 80;
          const bx = (canvas.width - boxW) / 2;
          const by = canvas.height - boxH - 16;
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          ctx.fillRect(bx, by, boxW, boxH);
          ctx.fillStyle = "#fff";
          ctx.font = "36px system-ui, -apple-system, Segoe UI, Roboto";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const aScore = scoreARef.current;
          const bScore = scoreBRef.current;
          ctx.fillText(
            `${aScore} : ${bScore}`,
            canvas.width / 2,
            by + boxH / 2
          );

          drawReqRef.current = requestAnimationFrame(draw);
        };
        drawReqRef.current = requestAnimationFrame(draw);

        const canvasStream = canvas.captureStream(30);
        const composedStream = new MediaStream();
        canvasStream
          .getVideoTracks()
          .forEach((t) => composedStream.addTrack(t));
        stream.getAudioTracks().forEach((t) => composedStream.addTrack(t));

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
          videoBitsPerSecond: 2_500_000, // ~2.5 Mbps for compact yet good quality
          audioBitsPerSecond: 128_000,
        };

        let mr: MediaRecorder;
        try {
          mr = new MediaRecorder(composedStream, mrOptions);
        } catch {
          // Fallback: let browser pick defaults
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
          // auto prompt save
          const a = document.createElement("a");
          a.href = url;
          const ext = outType.includes("mp4") ? "mp4" : "webm";
          const filename = `badminton-game-${new Date().toISOString()}.${ext}`;

          // Try system share sheet first (allows Save Video to Photos on iPhone)
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
      if (drawReqRef.current != null) {
        cancelAnimationFrame(drawReqRef.current);
        drawReqRef.current = null;
      }
      if (videoRef.current) {
        try {
          (videoRef.current as any).srcObject = null;
        } catch {}
      }
      setRecording(false);
      setPaused(false);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/90">
      <div className="absolute inset-0 flex flex-col">
        <div className="relative flex-1">
          {/* Hidden raw camera preview; we display the composed canvas so the user sees exactly what's recorded */}
          <video ref={videoRef} className="hidden" playsInline muted />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 m-auto max-h-full max-w-full bg-black"
          />

          <div className="absolute top-0 left-0 right-0 p-3 flex items-center justify-between text-white text-sm">
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
