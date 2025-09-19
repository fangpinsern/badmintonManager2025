"use client";
import React from "react";

export default function WinRateTiles({
  singles: { games: sGames, wins: sWins },
  doubles: { games: dGames, wins: dWins },
  showSingles = true,
  showDoubles = true,
}: {
  singles: { games: number; wins: number };
  doubles: { games: number; wins: number };
  showSingles?: boolean;
  showDoubles?: boolean;
}) {
  const sPct = sGames ? Math.round((sWins / sGames) * 100) : 0;
  const dPct = dGames ? Math.round((dWins / dGames) * 100) : 0;
  const tiles: React.ReactNode[] = [];
  if (showSingles && sGames > 0)
    tiles.push(
      <div key="singles" className="rounded-lg border p-3">
        <div className="text-[11px] text-gray-500">Singles</div>
        <div className="mt-1 flex items-end gap-2">
          <div className="text-xl font-semibold">{sPct}%</div>
          <div className="text-[11px] text-gray-500">
            ({sWins}W/{sGames - sWins}L)
          </div>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
          <div
            className="h-1.5 rounded-full bg-emerald-500"
            style={{ width: `${sPct}%` }}
          />
        </div>
      </div>
    );
  if (showDoubles && dGames > 0)
    tiles.push(
      <div key="doubles" className="rounded-lg border p-3">
        <div className="text-[11px] text-gray-500">Doubles</div>
        <div className="mt-1 flex items-end gap-2">
          <div className="text-xl font-semibold">{dPct}%</div>
          <div className="text-[11px] text-gray-500">
            ({dWins}W/{dGames - dWins}L)
          </div>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
          <div
            className="h-1.5 rounded-full bg-emerald-500"
            style={{ width: `${dPct}%` }}
          />
        </div>
      </div>
    );
  if (!tiles.length) return null;
  const cols = tiles.length === 1 ? "grid-cols-1" : "grid-cols-2";
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-gray-600">Win rate</div>
      <div className={`grid ${cols} gap-2`}>{tiles}</div>
    </div>
  );
}
