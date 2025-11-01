"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Select } from "@/components/layout";

type Period = "month" | "all";

export default function ClubStatsDemo({
  clubId,
  memberCount,
}: {
  clubId?: string;
  memberCount?: number;
}) {
  const [periodWinners, setPeriodWinners] = useState<Period>("month");
  const [periodActive, setPeriodActive] = useState<Period>("month");

  // Demo data only. Replace with real queries later.
  const demo = useMemo(() => {
    return {
      sessionsThisMonth: 8,
      participationRateThisMonth: 0.72, // 72%
      topWinners: {
        month: [
          { username: "alex", wins: 14 },
          { username: "may", wins: 12 },
          { username: "ken", wins: 10 },
          { username: "liang", wins: 9 },
          { username: "rachel", wins: 8 },
        ],
        all: [
          { username: "ken", wins: 210 },
          { username: "alex", wins: 198 },
          { username: "rachel", wins: 177 },
          { username: "may", wins: 165 },
          { username: "liang", wins: 159 },
        ],
      },
      topActive: {
        month: [
          { username: "liang", sessions: 7 },
          { username: "may", sessions: 7 },
          { username: "rachel", sessions: 6 },
          { username: "dave", sessions: 6 },
          { username: "alex", sessions: 5 },
        ],
        all: [
          { username: "rachel", sessions: 120 },
          { username: "liang", sessions: 118 },
          { username: "ken", sessions: 115 },
          { username: "alex", sessions: 112 },
          { username: "may", sessions: 110 },
        ],
      },
    };
  }, []);

  const memberCountDisplay = memberCount ?? 0;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold">Club stats</h2>
        <span className="rounded-full border px-2 py-0.5 text-[10px] text-gray-600">
          Demo
        </span>
      </div>
      <div className="mb-3 text-[11px] text-gray-600">
        Using sample data for preview. This will be replaced with real club
        stats.
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
        <StatTile
          label="Sessions this month"
          value={String(demo.sessionsThisMonth)}
        />
        <StatTile
          label="Participation rate"
          value={`${Math.round(demo.participationRateThisMonth * 100)}%`}
          hint={
            memberCountDisplay ? `${memberCountDisplay} members` : undefined
          }
        />
      </div>

      {/* Lists */}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-medium">Top winners</div>
            <PeriodSelect value={periodWinners} onChange={setPeriodWinners} />
          </div>
          <ol className="space-y-2">
            {(demo.topWinners[periodWinners] || []).map((p, idx) => (
              <li
                key={`${p.username}-${idx}`}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 text-[11px] text-gray-500">
                    {idx + 1}.
                  </span>
                  <span className="font-medium">
                    <Link
                      href={`/profile/${p.username}`}
                      className="text-blue-600 hover:underline"
                    >
                      @{p.username}
                    </Link>
                  </span>
                </div>
                <div className="text-gray-700">{p.wins} wins</div>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-xl border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-medium">Most active participants</div>
            <PeriodSelect value={periodActive} onChange={setPeriodActive} />
          </div>
          <ol className="space-y-2">
            {(demo.topActive[periodActive] || []).map((p, idx) => (
              <li
                key={`${p.username}-${idx}`}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 text-[11px] text-gray-500">
                    {idx + 1}.
                  </span>
                  <span className="font-medium">
                    <Link
                      href={`/profile/${p.username}`}
                      className="text-blue-600 hover:underline"
                    >
                      @{p.username}
                    </Link>
                  </span>
                </div>
                <div className="text-gray-700">{p.sessions} sessions</div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-[11px] text-gray-600">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {hint && <div className="text-[11px] text-gray-500">{hint}</div>}
    </div>
  );
}

function PeriodSelect({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="w-32">
      <Select
        value={value}
        onChange={(v) => onChange((v as Period) || "month")}
        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs"
      >
        <option value="month">This month</option>
        <option value="all">All time</option>
      </Select>
    </div>
  );
}
