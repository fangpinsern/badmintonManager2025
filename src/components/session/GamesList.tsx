"use client";
import { useMemo, useState } from "react";
import { Card, Select } from "@/components/layout";
import { formatDuration } from "@/lib/helper";
import type { Session } from "@/types/player";
import { GamesComparisonModal } from "./GamesComparisonModal";

type Props = {
  session: Session;
  isSessionEnded: boolean;
  onOpenEdit: (gameId: string) => void;
  onOpenDetails: (gameId: string) => void;
};

export function GamesList({
  session,
  isSessionEnded,
  onOpenEdit,
  onOpenDetails,
}: Props) {
  const [gamesFilter, setGamesFilter] = useState<string>("");
  const [gamesPage, setGamesPage] = useState<number>(1); // 10 per page
  const [compareOpen, setCompareOpen] = useState<boolean>(false);

  const filteredGames = useMemo(() => {
    const all = (session && session.games) || [];
    if (!gamesFilter) return all as any[];
    return (all as any[]).filter(
      (g) => g.sideA.includes(gamesFilter) || g.sideB.includes(gamesFilter)
    );
  }, [session, gamesFilter]);

  const pageSize = 10;
  const pagedGames = useMemo(() => {
    const start = 0;
    const end = gamesPage * pageSize;
    return filteredGames.slice(start, end);
  }, [filteredGames, gamesPage]);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold">Games</h3>
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end">
            <Select value={gamesFilter} onChange={setGamesFilter}>
              <option value="">All players</option>
              {session.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <button
              onClick={() => setCompareOpen(true)}
              className="mt-1 text-xs text-indigo-600 underline"
            >
              Advanced
            </button>
          </div>
        </div>
      </div>
      {!session.games || session.games.length === 0 ? (
        <p className="text-gray-500">No games recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {pagedGames.map((g) => {
            const selected = gamesFilter || "";
            const playedA = selected && g.sideA.includes(selected);
            const playedB = selected && g.sideB.includes(selected);
            const resultForSelected = selected
              ? g.voided
                ? "void"
                : g.winner === "draw"
                ? "draw"
                : playedA
                ? g.winner === "A"
                  ? "win"
                  : "loss"
                : playedB
                ? g.winner === "B"
                  ? "win"
                  : "loss"
                : ""
              : "";
            return (
              <div key={g.id} className="rounded-xl border border-gray-200 p-3">
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
                      {g.endedByRole && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700 whitespace-nowrap">
                          Ended By{" "}
                          {g.endedByRole === "organizer"
                            ? "Organizer"
                            : "Co-organizer"}
                        </span>
                      )}
                      {typeof g.caloriesEstimate === "number" && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700 whitespace-nowrap">
                          Est. {g.caloriesEstimate} kcal
                        </span>
                      )}
                      {selected && (playedA || playedB) && !g.voided && (
                        <span
                          className={`whitespace-nowrap rounded px-2 py-0.5 text-[10px] ${
                            resultForSelected === "win"
                              ? "bg-green-50 text-green-700"
                              : resultForSelected === "loss"
                              ? "bg-red-50 text-red-700"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {resultForSelected}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-500 truncate">
                  A:{" "}
                  {g.sideA
                    .map((pid: string) => ({
                      id: pid,
                      name:
                        session.players.find((pp) => pp.id === pid)?.name ||
                        "(deleted)",
                    }))
                    .map((p: { id: string; name: string }) => (
                      <span
                        key={`A-${p.id}`}
                        className={
                          gamesFilter && p.id === gamesFilter
                            ? "font-semibold text-gray-800"
                            : ""
                        }
                      >
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
                    .map((pid: string) => ({
                      id: pid,
                      name:
                        session.players.find((pp) => pp.id === pid)?.name ||
                        "(deleted)",
                    }))
                    .map((p: { id: string; name: string }) => (
                      <span
                        key={`B-${p.id}`}
                        className={
                          gamesFilter && p.id === gamesFilter
                            ? "font-semibold text-gray-800"
                            : ""
                        }
                      >
                        {p.name}
                      </span>
                    ))
                    .reduce(
                      (prev: any[] | null, cur: any) =>
                        prev === null ? [cur] : [...prev, " & ", cur],
                      null as any
                    )}
                </div>
                {g.umpireSummary && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {typeof g.umpireSummary.avgRallyDurationMs === "number" && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700">
                        {(() => {
                          const s = g.umpireSummary!;
                          const secs = (s.avgRallyDurationMs as number) / 1000;
                          return `${secs.toFixed(1)}s avg rally`;
                        })()}
                      </span>
                    )}
                    {typeof g.umpireSummary.longestRallyDurationMs ===
                      "number" && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700">
                        {(() => {
                          const s = g.umpireSummary!;
                          const secs =
                            (s.longestRallyDurationMs as number) / 1000;
                          return `Longest ${secs.toFixed(1)}s`;
                        })()}
                      </span>
                    )}
                    {!!(
                      g.umpireSummary.mvps && g.umpireSummary.mvps.length
                    ) && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                        {(() => {
                          const mvps = g.umpireSummary!.mvps!;
                          const parts = mvps.map((mvp: any) => {
                            const pl =
                              session.players.find(
                                (pp) => pp.id === mvp.playerId
                              ) || null;
                            const name = pl?.name || "(deleted)";
                            const w =
                              typeof mvp.winners === "number" ? mvp.winners : 0;
                            const l =
                              typeof mvp.losers === "number" ? mvp.losers : 0;
                            return `${name} (${w}W, ${l}E)`;
                          });
                          return `${
                            mvps.length > 1 ? "MVPs" : "MVP"
                          }: ${parts.join(" & ")}`;
                        })()}
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-2 flex justify-end gap-2">
                  {(g.umpireHistory && (g.umpireHistory as any[]).length > 0) ||
                  g.umpireSummary ? (
                    <button
                      onClick={() => onOpenDetails(g.id)}
                      className="rounded border px-2 py-0.5 text-xs"
                    >
                      Details
                    </button>
                  ) : null}
                  {!isSessionEnded && (
                    <button
                      onClick={() => onOpenEdit(g.id)}
                      className="rounded border px-2 py-0.5 text-xs"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {filteredGames.length > pagedGames.length ? (
            <div className="mt-2 flex justify-center">
              <button
                onClick={() => setGamesPage((p) => p + 1)}
                className="rounded border px-2 py-1 text-xs"
              >
                See more
              </button>
            </div>
          ) : (
            <div className="mt-2 text-center text-[11px] text-gray-500">
              End of list
            </div>
          )}
        </div>
      )}
      <GamesComparisonModal
        open={compareOpen}
        session={session}
        onClose={() => setCompareOpen(false)}
      />
    </Card>
  );
}
