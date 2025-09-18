"use client";
import React from "react";

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export default function DurationTiles({
  totalSinglesMin,
  totalDoublesMin,
}: {
  totalSinglesMin: number;
  totalDoublesMin: number;
}) {
  const combined = totalSinglesMin + totalDoublesMin;
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-gray-600">
        Total duration played (preview)
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border p-3">
          <div className="text-[11px] text-gray-500">Combined</div>
          <div className="mt-1 text-xl font-semibold">
            {formatMinutes(combined)}
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-[11px] text-gray-500">Singles</div>
          <div className="mt-1 text-xl font-semibold">
            {formatMinutes(totalSinglesMin)}
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-[11px] text-gray-500">Doubles</div>
          <div className="mt-1 text-xl font-semibold">
            {formatMinutes(totalDoublesMin)}
          </div>
        </div>
      </div>
    </div>
  );
}
