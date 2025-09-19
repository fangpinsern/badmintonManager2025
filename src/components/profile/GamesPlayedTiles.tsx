"use client";
import React from "react";

export default function GamesPlayedTiles({
  singlesGames,
  doublesGames,
  showSingles = true,
  showDoubles = true,
}: {
  singlesGames: number;
  doublesGames: number;
  showSingles?: boolean;
  showDoubles?: boolean;
}) {
  const tiles: React.ReactNode[] = [
    showSingles && (
      <div key="singles" className="rounded-lg border p-3">
        <div className="text-[11px] text-gray-500">Singles</div>
        <div className="mt-1 text-xl font-semibold">{singlesGames}</div>
      </div>
    ),
    showDoubles && (
      <div key="doubles" className="rounded-lg border p-3">
        <div className="text-[11px] text-gray-500">Doubles</div>
        <div className="mt-1 text-xl font-semibold">{doublesGames}</div>
      </div>
    ),
  ].filter(Boolean);

  if (!tiles.length) return null;

  const cols = tiles.length === 1 ? "grid-cols-1" : "grid-cols-2";
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-gray-600">Games played</div>
      <div className={`grid ${cols} gap-2`}>{tiles}</div>
    </div>
  );
}
