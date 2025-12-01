"use client";
import { useMemo, useState } from "react";
import type { Session } from "@/types/player";
import { Select } from "@/components/layout";
import { formatDuration } from "@/lib/helper";

type Props = {
  open: boolean;
  session: Session;
  onClose: () => void;
};

export function GamesComparisonModal({ open, session, onClose }: Props) {
  const [playerA, setPlayerA] = useState<string>("");
  const [playerB, setPlayerB] = useState<string>("");

  const bothSelected = !!playerA && !!playerB && playerA !== playerB;

  const matchedGames = useMemo(() => {
    if (!bothSelected) return [] as typeof session.games;
    const all = (session && session.games) || [];
    return all.filter((g) => {
      const ids = [...(g.sideA || []), ...(g.sideB || [])];
      return ids.includes(playerA) && ids.includes(playerB);
    });
  }, [bothSelected, playerA, playerB, session]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose}></div>
      <div className="relative w-full max-w-2xl rounded-2xl bg-white p-4 shadow-lg max-h-[90vh] overflow-auto mx-4">
        <div className="mb-2 flex items-start justify-between">
          <div>
            <div className="text-base font-semibold">Compare players</div>
            <div className="text-xs text-gray-600">
              Select two players to see games where both participated (as
              partners or opponents).
            </div>
          </div>
          <button onClick={onClose} className="text-sm text-gray-600 underline">
            Close
          </button>
        </div>
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <div className="text-xs text-gray-600">Player A</div>
            <Select value={playerA} onChange={setPlayerA}>
              <option value="">Select player</option>
              {session.players
                .filter((p) => p.id !== playerB)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-xs text-gray-600">Player B</div>
            <Select value={playerB} onChange={setPlayerB}>
              <option value="">Select player</option>
              {session.players
                .filter((p) => p.id !== playerA)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </div>
        </div>
        {!bothSelected ? (
          <div className="text-xs text-gray-500">
            Choose two different players to see their games.
          </div>
        ) : matchedGames.length === 0 ? (
          <div className="text-xs text-gray-500">
            No games found for this pair.
          </div>
        ) : (
          <div className="space-y-2">
            {matchedGames.map((g) => {
              const aTogether =
                g.sideA.includes(playerA) && g.sideA.includes(playerB);
              const bTogether =
                g.sideB.includes(playerA) && g.sideB.includes(playerB);
              const relation =
                aTogether || bTogether ? "Partners" : "Opponents";
              const highlight = (id: string) =>
                id === playerA || id === playerB
                  ? "font-semibold text-gray-800"
                  : "";
              const nameFor = (pid: string) =>
                session.players.find((pp) => pp.id === pid)?.name ||
                "(deleted)";
              return (
                <div
                  key={g.id}
                  className="rounded-xl border border-gray-200 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">
                      Court {g.courtIndex + 1}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(g.endedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {typeof g.durationMs !== "undefined" && (
                        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700">
                          {formatDuration(g.durationMs)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-sm">
                    {g.voided ? (
                      <span className="rounded bg-red-50 px-2 py-0.5 text-red-700">
                        Voided
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="whitespace-nowrap">
                          Score: {g.scoreA}–{g.scoreB} · Winner: {g.winner}
                        </span>
                        <span
                          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] ${
                            relation === "Partners"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-indigo-50 text-indigo-700"
                          }`}
                        >
                          {relation}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-500 truncate">
                    A:{" "}
                    {g.sideA
                      .map((pid: string) => ({ id: pid, name: nameFor(pid) }))
                      .map((p) => (
                        <span key={`A-${p.id}`} className={highlight(p.id)}>
                          {p.name}
                        </span>
                      ))
                      .reduce(
                        (prev: any[] | null, cur: any) =>
                          prev === null ? [cur] : [...prev, " & ", cur],
                        null as any
                      )}
                    <br />
                    B:{" "}
                    {g.sideB
                      .map((pid: string) => ({ id: pid, name: nameFor(pid) }))
                      .map((p) => (
                        <span key={`B-${p.id}`} className={highlight(p.id)}>
                          {p.name}
                        </span>
                      ))
                      .reduce(
                        (prev: any[] | null, cur: any) =>
                          prev === null ? [cur] : [...prev, " & ", cur],
                        null as any
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
