"use client";
import React, { useMemo, useState } from "react";
import InteractiveLineChart from "@/components/profile/InteractiveLineChart";

export default function DuoFriendshipCard({
  partnerUsername,
  together,
  monthly,
}: {
  partnerUsername: string;
  together?: { games?: number; wins?: number; durationMin?: number } | null;
  monthly?: { month: string; games: number; wins: number }[];
}) {
  const games = Number(together?.games || 0);
  const wins = Number(together?.wins || 0);
  const durationMin = Number(together?.durationMin || 0);
  const winPct = games > 0 ? Math.round((wins / games) * 100) : 0;
  const [expanded, setExpanded] = useState(false);
  const [sel, setSel] = useState<"singles" | "doubles">("singles");

  const { labels, series } = useMemo(() => {
    const items = Array.isArray(monthly) ? monthly : [];
    const labels = items.map((m) => m.month);
    const rates = items.map((m) => {
      const g = Number(m.games || 0);
      const w = Number(m.wins || 0);
      return g > 0 ? Math.round((w / g) * 100) : 0;
    });
    return { labels, series: rates };
  }, [monthly]);

  return (
    <div className="rounded-lg border p-2">
      <div className="text-sm font-semibold">Together</div>
      <div className="text-[11px] font-medium text-gray-600">
        Performance when paired together
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-gray-50 p-1.5">
          <div className="text-[10px] text-gray-500">Games</div>
          <div className="text-base font-semibold">{games}</div>
        </div>
        <div className="rounded-md bg-gray-50 p-1.5">
          <div className="text-[10px] text-gray-500">Wins</div>
          <div className="text-base font-semibold">{wins}</div>
        </div>
        <div className="rounded-md bg-gray-50 p-1.5">
          <div className="text-[10px] text-gray-500">Win rate</div>
          <div className="text-base font-semibold">{winPct}%</div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-1 text-center">
        <div className="rounded-md bg-gray-50 p-1.5">
          <div className="text-[10px] text-gray-500">Court time</div>
          <div className="text-base font-semibold">{durationMin}m</div>
        </div>
      </div>
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full rounded border px-2 py-1 text-[11px]"
        >
          {expanded ? "Hide monthly trend" : "Show monthly trend"}
        </button>
        {expanded && (
          <div className="mt-2">
            <InteractiveLineChart
              title="Win rate by month"
              labels={labels}
              singles={[]}
              doubles={series}
              selected={sel}
              onSelect={setSel}
              ySuffix="%"
              yMax={100}
              showSingles={false}
              showDoubles={true}
            />
          </div>
        )}
      </div>
    </div>
  );
}
