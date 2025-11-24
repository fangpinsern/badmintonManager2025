"use client";

import { useMemo, useEffect } from "react";
import type { Session, Game, UmpireRally, ReasonCode } from "@/types/player";
import { REASONS } from "@/types/player";

function GameDetailsModal({
  session,
  gameId,
  onClose,
}: {
  session: Session;
  gameId: string | null;
  onClose: () => void;
}) {
  const game = useMemo(
    () => (gameId ? (session.games || []).find((g) => g.id === gameId) : null),
    [session.games, gameId]
  ) as Game | null;

  const playersById = useMemo(
    () => new Map(session.players.map((p) => [p.id, p] as const)),
    [session.players]
  );

  const reasonMeta = useMemo(() => {
    const map = new Map<
      ReasonCode,
      { label: string; attr: "WINNER" | "LOSER" | "NONE" }
    >();
    for (const r of REASONS) map.set(r.code, { label: r.label, attr: r.attr });
    return map;
  }, []);

  const insights = useMemo(() => {
    if (!game) return null;
    const hist: UmpireRally[] = Array.isArray(game.umpireHistory)
      ? (game.umpireHistory as UmpireRally[])
      : [];
    const playerIds = Array.from(
      new Set([...(game.sideA || []), ...(game.sideB || [])])
    );
    const byPlayer: Record<
      string,
      {
        name: string;
        winnersByCode: Record<string, number>;
        losersByCode: Record<string, number>;
        totalWinners: number;
        totalLosers: number;
      }
    > = {};
    for (const pid of playerIds) {
      byPlayer[pid] = {
        name: playersById.get(pid)?.name || "(deleted)",
        winnersByCode: {},
        losersByCode: {},
        totalWinners: 0,
        totalLosers: 0,
      };
    }
    for (const h of hist) {
      try {
        const r = (h as any)?.reason;
        const pid: string | undefined = r?.attributedTo?.playerId;
        if (!pid || !byPlayer[pid]) continue;
        const code: ReasonCode | undefined = r?.code;
        const attr = r?.attr;
        if (!code || !reasonMeta.has(code)) continue;
        if (attr === "WINNER") {
          byPlayer[pid].winnersByCode[code] =
            (byPlayer[pid].winnersByCode[code] || 0) + 1;
          byPlayer[pid].totalWinners += 1;
        } else if (attr === "LOSER") {
          byPlayer[pid].losersByCode[code] =
            (byPlayer[pid].losersByCode[code] || 0) + 1;
          byPlayer[pid].totalLosers += 1;
        }
      } catch {}
    }
    function topN(
      rec: Record<string, number>,
      n: number
    ): { code: string; label: string; count: number }[] {
      const arr = Object.entries(rec).map(([code, count]) => ({
        code,
        count,
        label: reasonMeta.get(code as ReasonCode)?.label || code,
      }));
      arr.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      return arr.slice(0, n);
    }
    const perPlayer = playerIds.map((pid) => {
      const data = byPlayer[pid];
      const strengths = topN(data.winnersByCode, 3);
      const improvements = topN(data.losersByCode, 3);
      return {
        playerId: pid,
        name: data.name,
        totalWinners: data.totalWinners,
        totalLosers: data.totalLosers,
        strengths,
        improvements,
      };
    });
    return {
      perPlayer,
      summary: game.umpireSummary || null,
    };
  }, [
    gameId,
    game?.umpireHistory,
    game?.sideA,
    game?.sideB,
    playersById,
    reasonMeta,
  ]);

  const open = !!gameId && !!game;

  // Lock background scroll while modal is open
  useEffect(() => {
    try {
      if (!open) return;
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    } catch {}
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose}></div>
      <div className="relative w-full max-w-md rounded-2xl bg-white p-4 shadow-lg mx-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-base font-semibold">Game details</div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
          >
            Close
          </button>
        </div>
        <div className="mb-2 text-xs text-gray-600">
          Court {game.courtIndex + 1} ·{" "}
          {new Date(game.endedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
        <div className="mb-2 text-sm">
          Score: {game.scoreA}–{game.scoreB} · Winner: {game.winner}
        </div>
        {(game.intensity || typeof game.caloriesEstimate === "number") && (
          <div className="mb-2 text-xs text-gray-700">
            {game.intensity ? `Intensity: ${game.intensity}` : null}
            {game.intensity && typeof game.caloriesEstimate === "number"
              ? " · "
              : ""}
            {typeof game.caloriesEstimate === "number"
              ? `Your est. calories: ${game.caloriesEstimate} kcal`
              : null}
          </div>
        )}
        {insights?.summary && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {typeof insights.summary.avgRallyDurationMs === "number" && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700">
                {(() => {
                  const secs =
                    (insights.summary!.avgRallyDurationMs as number) / 1000;
                  return `${secs.toFixed(1)}s avg rally`;
                })()}
              </span>
            )}
            {typeof insights.summary.longestRallyDurationMs === "number" && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700">
                {(() => {
                  const secs =
                    (insights.summary!.longestRallyDurationMs as number) / 1000;
                  return `Longest ${secs.toFixed(1)}s`;
                })()}
              </span>
            )}
            {!!(insights.summary.mvps && insights.summary.mvps.length) && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                {(() => {
                  const mvps = insights.summary!.mvps!;
                  const parts = mvps.map((mvp: any) => {
                    const p = playersById.get(mvp.playerId);
                    const name = p?.name || "(deleted)";
                    const w = typeof mvp.winners === "number" ? mvp.winners : 0;
                    const l = typeof mvp.losers === "number" ? mvp.losers : 0;
                    return `${name} (${w}W, ${l}E)`;
                  });
                  return `${mvps.length > 1 ? "MVPs" : "MVP"}: ${parts.join(
                    " & "
                  )}`;
                })()}
              </span>
            )}
          </div>
        )}
        {insights && (
          <div className="space-y-3">
            {insights.perPlayer.map((p) => (
              <div key={p.playerId} className="rounded-lg border p-2">
                <div className="mb-1 flex items-center justify-between">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-[11px] text-gray-600">
                    {p.totalWinners} winners · {p.totalLosers} errors
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-emerald-700">
                      Strengths
                    </div>
                    {p.strengths.length === 0 ? (
                      <div className="text-[11px] text-gray-500">
                        No winner-attributed points.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {p.strengths.map((s) => (
                          <span
                            key={`s-${p.playerId}-${s.code}`}
                            className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700"
                          >
                            {s.label} ×{s.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-rose-700">
                      Improve
                    </div>
                    {p.improvements.length === 0 ? (
                      <div className="text-[11px] text-gray-500">
                        No errors recorded.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {p.improvements.map((s) => (
                          <span
                            key={`i-${p.playerId}-${s.code}`}
                            className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700"
                          >
                            {s.label} ×{s.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { GameDetailsModal };
