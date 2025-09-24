"use client";
import React, { useMemo, useState } from "react";
import InteractiveLineChart from "@/components/profile/InteractiveLineChart";

export default function HeadToHeadCard({
  opponentUsername,
  against,
  monthly,
}: {
  opponentUsername: string;
  against?: {
    singles?: {
      games?: number;
      wins?: number;
      losses?: number;
      durationMin?: number;
    };
    doubles?: {
      games?: number;
      wins?: number;
      losses?: number;
      durationMin?: number;
    };
    totals?: {
      games?: number;
      wins?: number;
      losses?: number;
      durationMin?: number;
    };
  } | null;
  monthly?:
    | { month: string; games: number; wins: number; losses: number }[]
    | {
        singles: { month: string; games: number; wins: number }[];
        doubles: { month: string; games: number; wins: number }[];
      }
    | undefined;
}) {
  const totals = against?.totals || {};
  const games = Number(totals?.games || 0);
  const wins = Number(totals?.wins || 0);
  const losses = Number(totals?.losses || Math.max(0, games - wins));
  const winPct = games > 0 ? Math.round((wins / games) * 100) : 0;
  const [expanded, setExpanded] = useState(false);
  const [sel, setSel] = useState<"singles" | "doubles">("doubles");

  const { labels, singlesSeries, doublesSeries } = useMemo(() => {
    // Support both original totals-only array and new split object shape
    let singles: { month: string; games: number; wins: number }[] = [];
    let doubles: { month: string; games: number; wins: number }[] = [];
    if (monthly && !Array.isArray(monthly)) {
      singles = monthly.singles || [];
      doubles = monthly.doubles || [];
    } else if (Array.isArray(monthly)) {
      // Treat as combined totals; use same series for singles for visualization
      const arr = monthly;
      singles = arr.map((m) => ({
        month: m.month,
        games: m.games,
        wins: m.wins,
      }));
      doubles = [];
    }
    // const minLen = Math.max(singles.length, doubles.length);
    // if (minLen >= 3) {
    const labels = (singles.length >= doubles.length ? singles : doubles).map(
      (m) => m.month
    );
    console.log("singles", singles, doubles);
    const sRates = singles.map((m) =>
      m.games > 0 ? Math.round((m.wins / m.games) * 100) : 0
    );
    const dRates = doubles.map((m) =>
      m.games > 0 ? Math.round((m.wins / m.games) * 100) : 0
    );

    console.log("sRates", sRates, dRates);
    return {
      labels,
      singlesSeries: sRates,
      doublesSeries: dRates,
    };
    // }
    // return { labels: [], singlesSeries: [], doublesSeries: [] };
  }, [monthly]);

  return (
    <div className="rounded-lg border p-2">
      <div className="text-sm font-semibold">Against</div>
      <div className="text-xs font-medium text-gray-600">Head-to-head</div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-gray-50 p-1.5">
          <div className="text-[10px] text-gray-500">Games</div>
          <div className="text-base font-semibold">{games}</div>
        </div>
        <div className="rounded-md bg-gray-50 p-1.5">
          <div className="text-[10px] text-gray-500">You Won</div>
          <div className="text-base font-semibold">{wins}</div>
        </div>
        <div className="rounded-md bg-gray-50 p-1.5">
          <div className="text-[10px] text-gray-500">Win rate</div>
          <div className="text-base font-semibold">{winPct}%</div>
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
        {/* {expanded && labels.length >= 3 && ( */}
        {expanded && (
          <div className="mt-2">
            <InteractiveLineChart
              title="Win rate by month"
              labels={labels}
              singles={singlesSeries}
              doubles={doublesSeries}
              selected={sel}
              onSelect={setSel}
              ySuffix="%"
              yMax={100}
              showSingles={singlesSeries.length > 0}
              showDoubles={doublesSeries.length > 0}
            />
          </div>
        )}
      </div>
    </div>
  );
}
