"use client";

import React from "react";

type GameRecorderOverlayProps = {
  open: boolean;
  teamA: string[];
  teamB: string[];
  onRequestClose: () => void;
  onRequestEndGame: (scoreA: number, scoreB: number) => void;
};

function GameRecorderOverlay({
  open,
  teamA,
  teamB,
  onRequestClose: _onRequestClose,
  onRequestEndGame,
}: GameRecorderOverlayProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const [recording, setRecording] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [scoreA, setScoreA] = React.useState<number>(0);
  const [scoreB, setScoreB] = React.useState<number>(0);
  const [paused, setPaused] = React.useState(false);

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
        const isPortrait =
          typeof window !== "undefined"
            ? window.matchMedia &&
              window.matchMedia("(orientation: portrait)").matches
            : false;
        const targetAspect = isPortrait ? 9 / 16 : 16 / 9;
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
          mr = new MediaRecorder(stream, mrOptions);
        } catch {
          // Fallback: let browser pick defaults
          mr = new MediaRecorder(stream);
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
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-contain bg-black"
            playsInline
            muted
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

          {/* Overlay for team labels moved to top */}
          <div className="absolute left-0 right-0 top-10 p-3 grid grid-cols-2 gap-3 text-white">
            <div className="rounded-lg bg-black/40 p-2 border border-white/10">
              <div className="text-xs uppercase tracking-wide text-gray-200">
                Team A
              </div>
              <div className="mt-1 text-sm font-medium leading-tight">
                {teamA.length === 0 ? (
                  <span className="text-gray-300">TBD</span>
                ) : (
                  teamA.map((n, i) => <div key={`a-${i}`}>{n}</div>)
                )}
              </div>
            </div>
            <div className="rounded-lg bg-black/40 p-2 border border-white/10 text-right">
              <div className="text-xs uppercase tracking-wide text-gray-200">
                Team B
              </div>
              <div className="mt-1 text-sm font-medium leading-tight">
                {teamB.length === 0 ? (
                  <span className="text-gray-300">TBD</span>
                ) : (
                  teamB.map((n, i) => <div key={`b-${i}`}>{n}</div>)
                )}
              </div>
            </div>
          </div>

          {/* Score controls */}
          <div className="absolute left-0 right-0 bottom-20 px-3 text-white">
            <div className="mx-auto max-w-md rounded-xl bg-black/40 border border-white/10 p-3">
              <div className="grid grid-cols-3 items-center gap-2">
                <div className="flex items-center justify-start gap-2">
                  <button
                    onClick={() => setScoreA((s) => Math.max(0, s - 1))}
                    className="rounded-md border border-white/20 bg-white/10 px-2 py-1"
                  >
                    −
                  </button>
                  <button
                    onClick={() => setScoreA((s) => s + 1)}
                    className="rounded-md border border-white/20 bg-white/10 px-2 py-1"
                  >
                    +
                  </button>
                </div>
                <div className="text-center text-lg font-semibold tracking-wide">
                  {scoreA} : {scoreB}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setScoreB((s) => Math.max(0, s - 1))}
                    className="rounded-md border border-white/20 bg-white/10 px-2 py-1"
                  >
                    −
                  </button>
                  <button
                    onClick={() => setScoreB((s) => s + 1)}
                    className="rounded-md border border-white/20 bg-white/10 px-2 py-1"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom actions */}
          <div className="absolute left-0 right-0 bottom-0 p-3 flex items-center justify-center">
            <button
              onClick={() => {
                stopAndSave();
                onRequestEndGame(scoreA, scoreB);
              }}
              className="rounded-xl bg-red-600 text-white px-5 py-2 text-sm shadow-lg"
            >
              End game
            </button>
          </div>

          {error ? (
            <div className="absolute left-0 right-0 bottom-20 mx-3 rounded-md bg-red-500/90 text-white text-sm p-2 text-center">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { GameRecorderOverlay };
