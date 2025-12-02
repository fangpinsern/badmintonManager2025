"use client";
import { Card } from "@/components/layout";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import { downloadSessionJson, formatDuration } from "@/lib/helper";
import { Session } from "@/types/player";
import { ShareClaimsButton } from "@/components/session/rowKebabMenu";

type Props = {
  session: Session;
  usernameMap: Record<string, string>;
};

export function SessionStatsPanel({ session, usernameMap }: Props) {
  if (!session?.ended || !session?.stats) return null;

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold">Session statistics</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadSessionJson(session)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
          >
            Export JSON
          </button>
          {!session.ended && <ShareClaimsButton sessionId={session.id} />}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-gray-50 p-2">
          <div className="text-xs text-gray-500">Total games</div>
          <div className="font-medium">{session.stats.totalGames}</div>
        </div>
        {(() => {
          try {
            const uid = auth.currentUser?.uid || null;
            if (!uid) return null;
            const myIds = (session.players || [])
              .filter((p) => p.accountUid === uid)
              .map((p) => p.id);
            if (!myIds.length) return null;
            const nonVoided = (session.games || []).filter(
              (g) => !g.voided && typeof g.caloriesEstimate === "number"
            );
            const seen = new Set<string>();
            let sum = 0;
            for (const g of nonVoided) {
              const ids =
                (g.players && g.players.length
                  ? g.players
                  : [...(g.sideA || []), ...(g.sideB || [])]) || [];
              const participated = myIds.some((id) => ids.includes(id));
              if (participated && !seen.has(g.id)) {
                sum += Number(g.caloriesEstimate || 0);
                seen.add(g.id);
              }
            }
            return (
              <div className="rounded-lg bg-orange-50 p-2">
                <div className="text-xs text-orange-700 flex items-center">
                  <span>Your estimated calories</span>
                  <Link
                    href="/guide/calories"
                    aria-label="Learn how we estimate calories"
                    className="ml-1 text-orange-700 hover:text-orange-800"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <line x1="12" y1="10" x2="12" y2="16" />
                      <circle cx="12" cy="7.5" r="0.75" />
                    </svg>
                  </Link>
                </div>
                <div className="font-medium">{sum} kcal</div>
              </div>
            );
          } catch {
            return null;
          }
        })()}
        {typeof session.stats.shuttlesUsed !== "undefined" && (
          <div className="rounded-lg bg-lime-50 p-2">
            <div className="text-xs text-lime-700">Shuttlecocks used</div>
            <div className="font-medium">{session.stats.shuttlesUsed}</div>
          </div>
        )}
        {session.stats.topWinner && (
          <div className="rounded-lg bg-green-50 p-2">
            <div className="text-xs text-green-700">Top winner</div>
            <div className="font-medium">{session.stats.topWinner.name}</div>
            <div className="text-xs text-green-700">
              {session.stats.topWinner.wins} wins ·{" "}
              {Math.round(session.stats.topWinner.winRate * 100)}%
            </div>
          </div>
        )}
        {/* Removed Top loser tile as requested */}
        {session.stats.topScorer && (
          <div className="rounded-lg bg-indigo-50 p-2">
            <div className="text-xs text-indigo-700">Top scorer</div>
            <div className="font-medium">{session.stats.topScorer.name}</div>
            <div className="text-xs text-indigo-700">
              {session.stats.topScorer.points} pts
            </div>
          </div>
        )}
        {session.stats.mostActive && (
          <div className="rounded-lg bg-amber-50 p-2">
            <div className="text-xs text-amber-700">Most active</div>
            <div className="font-medium">{session.stats.mostActive.name}</div>
            <div className="text-xs text-amber-700">
              {session.stats.mostActive.games} games
            </div>
          </div>
        )}
        {session.stats.bestPair && (
          <div className="col-span-2 rounded-lg bg-teal-50 p-2">
            <div className="text-xs text-teal-700">Best pair</div>
            <div className="font-medium">
              {session.stats.bestPair.names.join(" & ")}
            </div>
            <div className="text-xs text-teal-700">
              {session.stats.bestPair.wins} wins together
            </div>
          </div>
        )}
        {session.stats.longestDuration && (
          <div className="col-span-2 rounded-lg bg-fuchsia-50 p-2">
            <div className="text-xs text-fuchsia-700">
              Longest duration on court
            </div>
            <div className="font-medium">
              {session.stats.longestDuration.names.join(" & ")}
            </div>
            <div className="text-xs text-fuchsia-700">
              {formatDuration(session.stats.longestDuration.durationMs)}
            </div>
          </div>
        )}
        {session.stats.mostIntenseGame && (
          <div className="col-span-2 rounded-lg bg-sky-50 p-2">
            <div className="text-xs text-sky-700">Most intense game</div>
            <div className="text-xs text-sky-700">
              Court {session.stats.mostIntenseGame.courtIndex + 1} ·{" "}
              {new Date(
                session.stats.mostIntenseGame.endedAt
              ).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <div className="font-medium">
              {session.stats.mostIntenseGame.namesA.join(" & ")} vs{" "}
              {session.stats.mostIntenseGame.namesB.join(" & ")}
            </div>
            <div className="text-xs text-sky-700">
              {session.stats.mostIntenseGame.scoreA}–
              {session.stats.mostIntenseGame.scoreB} ·{" "}
              {session.stats.mostIntenseGame.totalPoints} pts in{" "}
              {formatDuration(session.stats.mostIntenseGame.durationMs)} (
              {Math.round(session.stats.mostIntenseGame.secondsPerPoint)} s/pt)
            </div>
          </div>
        )}
      </div>
      {!!(session.stats.leaderboard && session.stats.leaderboard.length) && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-gray-600">
            Leaderboard
          </div>
          <ul className="divide-y rounded-lg border">
            {session.stats.leaderboard.map((p) => (
              <li
                key={p.playerId}
                className="flex items-center justify-between px-2 py-1 text-sm"
              >
                <div className="truncate">
                  {(() => {
                    const sp = session.players.find(
                      (pp) => pp.id === p.playerId
                    );
                    const uid = sp?.accountUid;
                    const uname = uid ? usernameMap[uid] : undefined;
                    const finalUname = uname || sp?.accountUsername;
                    return uid && finalUname ? (
                      <Link
                        href={`/profile/${finalUname}`}
                        className="text-sky-700 hover:underline"
                      >
                        {p.name}
                      </Link>
                    ) : (
                      <span>{p.name}</span>
                    );
                  })()}
                </div>
                <div className="ml-2 shrink-0 text-xs text-gray-600">
                  {p.wins}W {p.losses}L · {Math.round(p.winRate * 100)}% ·{" "}
                  {p.points}pts
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
