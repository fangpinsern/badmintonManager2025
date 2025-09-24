"use client";
import Link from "next/link";
import React, { useMemo } from "react";

type FriendItem = {
  otherUid: string;
  data: {
    together?: { games?: number; wins?: number; durationMin?: number };
    lastPlayedAt?: string;
  };
};

export default function TopPartnersTable({
  items,
  usernames,
  maxItems = 10,
  highlightUid,
}: {
  items: FriendItem[];
  usernames?: Record<string, string>;
  maxItems?: number;
  highlightUid?: string | null;
}) {
  const rows = useMemo(() => {
    return items
      .map((it) => {
        const games = Number(it?.data?.together?.games || 0);
        const wins = Number(it?.data?.together?.wins || 0);
        const durationMin = Number(it?.data?.together?.durationMin || 0);
        const winRate = games > 0 ? Math.round((wins / games) * 100) : 0;
        const name = usernames?.[it.otherUid] || it.otherUid;
        return { key: it.otherUid, name, games, wins, winRate, durationMin };
      })
      .sort((a, b) => b.games - a.games)
      .slice(0, maxItems);
  }, [items, usernames, maxItems]);

  if (!rows.length) {
    return (
      <div className="rounded-lg border bg-gray-50 p-4 text-center text-[12px] text-gray-600">
        No partner stats yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-left text-[12px]">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-3 py-1.5 font-medium">Partner</th>
            <th className="px-3 py-1.5 font-medium text-right">Games</th>
            <th className="px-3 py-1.5 font-medium text-right">Wins</th>
            <th className="px-3 py-1.5 font-medium text-right">WR</th>
            <th className="px-3 py-1.5 font-medium text-right">Minutes</th>
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
              <td className="px-3 py-2 text-right">{r.winRate}%</td>
              <td className="px-3 py-2 text-right">{r.durationMin}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className="px-3 py-1 text-[11px] text-gray-500">
              Partners are for doubles games only.
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
