"use client";

import { Session } from "@/types/player";
import { useStore } from "@/lib/store";
import { Input } from "@/components/layout";
import { useMemo, useState, useEffect } from "react";

function GameEditModal({
  session,
  gameId,
  onClose,
}: {
  session: Session;
  gameId: string | null;
  onClose: () => void;
}) {
  const updateGame = useStore((s) => s.updateGame);
  const game = useMemo(
    () => (gameId ? (session.games || []).find((g) => g.id === gameId) : null),
    [session.games, gameId]
  );
  const [scoreA, setScoreA] = useState<string>(game ? String(game.scoreA) : "");
  const [scoreB, setScoreB] = useState<string>(game ? String(game.scoreB) : "");
  const [sideA, setSideA] = useState<string[]>(game ? [...game.sideA] : []);
  const [sideB, setSideB] = useState<string[]>(game ? [...game.sideB] : []);
  const [duration, setDuration] = useState<string>(
    game && typeof game.durationMs === "number"
      ? String(Math.floor(game.durationMs / 1000))
      : ""
  );

  useEffect(() => {
    if (game) {
      setScoreA(String(game.scoreA));
      setScoreB(String(game.scoreB));
      setSideA([...game.sideA]);
      setSideB([...game.sideB]);
      setDuration(
        typeof game.durationMs === "number"
          ? String(Math.floor(game.durationMs / 1000))
          : ""
      );
    }
  }, [gameId]);

  if (!gameId || !game) return null;

  const isSingles = game.sideA.length + game.sideB.length === 2;
  const reqTeam = isSingles ? 1 : 2;

  const playersById = new Map(session.players.map((p) => [p.id, p] as const));
  const nameOf = (id: string) => playersById.get(id)?.name || "(deleted)";
  const allIds = Array.from(new Set([...game.sideA, ...game.sideB]));

  const validSides =
    sideA.length === reqTeam &&
    sideB.length === reqTeam &&
    sideA.every((id) => allIds.includes(id)) &&
    sideB.every((id) => allIds.includes(id));
  const scoreValid =
    scoreA.trim() !== "" &&
    scoreB.trim() !== "" &&
    !Number.isNaN(Number(scoreA)) &&
    !Number.isNaN(Number(scoreB));

  const toggleIn = (team: "A" | "B", id: string) => {
    if (team === "A") {
      setSideA((cur) =>
        cur.includes(id)
          ? cur.filter((x) => x !== id)
          : cur.length < reqTeam
          ? [...cur, id]
          : cur
      );
      setSideB((cur) => cur.filter((x) => x !== id));
    } else {
      setSideB((cur) =>
        cur.includes(id)
          ? cur.filter((x) => x !== id)
          : cur.length < reqTeam
          ? [...cur, id]
          : cur
      );
      setSideA((cur) => cur.filter((x) => x !== id));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose}></div>
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg max-h-[90vh] overflow-auto">
        <div className="mb-2 text-base font-semibold">Edit game</div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Input
            label="Score A"
            type="number"
            inputMode="numeric"
            min={0}
            value={scoreA}
            onChange={(e) => setScoreA(e.target.value)}
          />
          <Input
            label="Score B"
            type="number"
            inputMode="numeric"
            min={0}
            value={scoreB}
            onChange={(e) => setScoreB(e.target.value)}
          />
        </div>
        <div className="mb-2 text-xs text-gray-500">
          Update sides (tap to toggle; need {reqTeam} per side)
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border p-2">
            <div className="mb-1 text-xs font-medium">Side A</div>
            <div className="flex flex-wrap gap-1">
              {allIds.map((id) => (
                <button
                  key={`A-${id}`}
                  onClick={() => toggleIn("A", id)}
                  className={`rounded border px-2 py-0.5 text-xs ${
                    sideA.includes(id) ? "bg-gray-200" : ""
                  }`}
                >
                  {nameOf(id)}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl border p-2">
            <div className="mb-1 text-xs font-medium">Side B</div>
            <div className="flex flex-wrap gap-1">
              {allIds.map((id) => (
                <button
                  key={`B-${id}`}
                  onClick={() => toggleIn("B", id)}
                  className={`rounded border px-2 py-0.5 text-xs ${
                    sideB.includes(id) ? "bg-gray-200" : ""
                  }`}
                >
                  {nameOf(id)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mb-3">
          <Input
            label="Duration (seconds)"
            type="number"
            inputMode="numeric"
            min={0}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (!scoreValid || !validSides) return;
              updateGame(session.id, game.id, {
                scoreA: Number(scoreA),
                scoreB: Number(scoreB),
                sideA,
                sideB,
                durationMs:
                  duration.trim() === ""
                    ? undefined
                    : Math.max(0, Math.floor(Number(duration) * 1000)),
              });
              onClose();
            }}
            disabled={!scoreValid || !validSides}
            className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

export { GameEditModal };
