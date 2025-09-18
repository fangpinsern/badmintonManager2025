"use client";
import React from "react";

export default function GamesPlayedTiles({
  singlesGames,
  doublesGames,
}: {
  singlesGames: number;
  doublesGames: number;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-gray-600">Games played</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border p-3">
          <div className="text-[11px] text-gray-500">Singles</div>
          <div className="mt-1 text-xl font-semibold">{singlesGames}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-[11px] text-gray-500">Doubles</div>
          <div className="mt-1 text-xl font-semibold">{doublesGames}</div>
        </div>
      </div>
    </div>
  );
}
