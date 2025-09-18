"use client";
import React from "react";

export default function RecentForm({ results }: { results: ("W" | "L")[] }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-gray-600">
        Recent form (last 10)
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {results.map((r, i) => (
          <span
            key={`${r}-${i}`}
            className={`inline-flex h-6 w-6 items-center justify-center rounded ${
              r === "W"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-700 border border-red-200"
            } text-[11px] font-semibold`}
            title={r === "W" ? "Win" : "Loss"}
            aria-label={r === "W" ? "Win" : "Loss"}
          >
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}
