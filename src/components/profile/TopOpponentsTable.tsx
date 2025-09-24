"use client";
import Link from "next/link";
import React, { useMemo } from "react";

type OppItem = {
  otherUid: string;
  data: {
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
    };
    lastPlayedAt?: string;
  };
};

export default function TopOpponentsTable({
  items,
  usernames,
  maxItems = 10,
  highlightUid,
  mode = "totals",
}: {
  items: OppItem[];
  usernames?: Record<string, string>;
  maxItems?: number;
  highlightUid?: string | null;
  mode?: "singles" | "doubles" | "totals";
}) {
  const rows = useMemo(() => {
    return items
      .map((it) => {
        const block = (it?.data?.against || {}) as any;
        const choose =
          mode === "singles"
            ? block.singles || {}
            : mode === "doubles"
            ? block.doubles || {}
            : block.totals || {};
        const games = Number(choose?.games || 0);
        const wins = Number(choose?.wins || 0);
        const losses = Number(choose?.losses || Math.max(0, games - wins));
        const winRate = games > 0 ? Math.round((wins / games) * 100) : 0;
        const name = usernames?.[it.otherUid] || it.otherUid;
        return { key: it.otherUid, name, games, wins, losses, winRate };
      })
      .sort((a, b) => b.games - a.games)
      .slice(0, maxItems);
  }, [items, usernames, maxItems]);

  if (!rows.length) {
    return (
      <div className="rounded-lg border bg-gray-50 p-4 text-center text-[12px] text-gray-600">
        No head-to-head stats yet.
      </div>
    );
  }

  return (
    <div className="overflow-scroll rounded-lg border">
      <table className="w-full text-left text-[12px]">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-3 py-1.5 font-medium">Opponent</th>
            <th className="px-3 py-1.5 font-medium text-right">Games</th>
            <th className="px-3 py-1.5 font-medium text-right">Wins</th>
            <th className="px-3 py-1.5 font-medium text-right">Losses</th>
            <th className="px-3 py-1.5 font-medium text-right">Win rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr
              key={r.key}
              className={`hover:bg-gray-50 ${
                highlightUid && r.key === highlightUid ? "bg-amber-50" : ""
              }`}
            >
              <td className="px-3 py-2">
                <Link className="underline" href={`/profile/${r.name}`}>
                  @{r.name}
                </Link>
              </td>
              <td className="px-3 py-2 text-right">{r.games}</td>
              <td className="px-3 py-2 text-right">{r.wins}</td>
              <td className="px-3 py-2 text-right">{r.losses}</td>
              <td className="px-3 py-2 text-right">{r.winRate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
