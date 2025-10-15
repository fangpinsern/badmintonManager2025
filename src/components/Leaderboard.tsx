"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/layout";
import {
  resolveUsernames,
  getTopDoublesWins,
  getTopDoublesGames,
  getTopSinglesWins,
  getTopSinglesGames,
} from "@/lib/statsClient";

type Row = { uid: string; score: number };

export type LeaderboardProps = {
  limit?: number;
  showDoubles?: boolean;
  showSingles?: boolean;
  className?: string;
};

export default function Leaderboard({
  limit = 5,
  showDoubles = true,
  showSingles = true,
  className = "",
}: LeaderboardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boards, setBoards] = useState<{
    doublesWins: Row[];
    doublesGames: Row[];
    singlesWins: Row[];
    singlesGames: Row[];
  }>({
    doublesWins: [],
    doublesGames: [],
    singlesWins: [],
    singlesGames: [],
  });
  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [dw, dg, sw, sg] = await Promise.all([
          getTopDoublesWins(limit),
          getTopDoublesGames(limit),
          getTopSinglesWins(limit),
          getTopSinglesGames(limit),
        ]);
        if (cancelled) return;
        setBoards({
          doublesWins: dw,
          doublesGames: dg,
          singlesWins: sw,
          singlesGames: sg,
        });
        const uids = Array.from(
          new Set([
            ...dw.map((r) => r.uid),
            ...dg.map((r) => r.uid),
            ...sw.map((r) => r.uid),
            ...sg.map((r) => r.uid),
          ])
        );
        try {
          const names = await resolveUsernames(uids);
          if (!cancelled) setUsernameMap(names || {});
        } catch {}
      } catch (e: any) {
        if (!cancelled) setError("Failed to load leaderboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  function ProfileLink({ uid }: { uid: string }) {
    const username = usernameMap[uid];
    if (!username) {
      return <span className="text-gray-700">{uid}</span>;
    }
    return (
      <Link
        href={`/profile/${username}`}
        className="text-blue-700 hover:underline"
      >
        {username}
      </Link>
    );
  }

  function List({
    title,
    rows,
    formatter,
  }: {
    title: string;
    rows: Row[];
    formatter?: (n: number) => string;
  }) {
    return (
      <div className="rounded-xl border p-3">
        <div className="text-[11px] font-medium text-gray-500 mb-1">
          {title}
        </div>
        {loading ? (
          <div className="text-xs text-gray-500">Loading…</div>
        ) : error ? (
          <div className="text-xs text-red-600">{error}</div>
        ) : (
          <ol className="text-sm space-y-1">
            {rows.map((r, idx) => (
              <li
                key={`${title}-${r.uid}`}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 text-[11px] text-gray-400">
                    {idx + 1}.
                  </span>
                  <ProfileLink uid={r.uid} />
                </div>
                <div className="text-xs text-gray-600">
                  {formatter ? formatter(r.score) : r.score}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  const nonZero = (rows: Row[]) => rows.filter((r) => Number(r.score) > 0);

  const sections: {
    key: string;
    title: string;
    rows: Row[];
    fmt?: (n: number) => string;
    show: boolean;
  }[] = [
    {
      key: "dw",
      title: "Doubles · Top wins",
      rows: nonZero(boards.doublesWins),
      show: showDoubles,
    },
    {
      key: "dg",
      title: "Doubles · Games played",
      rows: nonZero(boards.doublesGames),
      show: showDoubles,
    },
    {
      key: "sw",
      title: "Singles · Top wins",
      rows: nonZero(boards.singlesWins),
      show: showSingles,
    },
    {
      key: "sg",
      title: "Singles · Games played",
      rows: nonZero(boards.singlesGames),
      show: showSingles,
    },
  ];

  const visible = sections.filter(
    (s) => s.show && (loading || s.rows.length > 0)
  );

  return (
    <Card className={className}>
      <h2 className="text-base font-semibold">Global Leaderboard</h2>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {visible.map((s) => (
          <List key={s.key} title={s.title} rows={s.rows} formatter={s.fmt} />
        ))}
        {!loading && visible.length === 0 && (
          <div className="text-xs text-gray-500">No leaderboard data yet</div>
        )}
      </div>
    </Card>
  );
}
