"use client";
import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

type OppItem = {
  otherUid: string;
  data: {
    otherUid?: string;
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

export default function TopOpponentsChart({
  items,
  usernames,
  maxItems = 8,
  title = "Top opponents (wins vs losses)",
}: {
  items: OppItem[];
  usernames?: Record<string, string>;
  maxItems?: number;
  title?: string;
}) {
  const data = useMemo(() => {
    const enriched = items
      .map((it) => {
        const wins = Number(it?.data?.against?.totals?.wins || 0);
        const losses = Number(it?.data?.against?.totals?.losses || 0);
        const games = Number(it?.data?.against?.totals?.games || wins + losses);
        const name = usernames?.[it.otherUid] || it.otherUid;
        return {
          key: it.otherUid,
          name,
          games,
          wins,
          losses,
        };
      })
      .sort((a, b) => b.games - a.games)
      .slice(0, maxItems);
    return enriched.reverse();
  }, [items, usernames, maxItems]);

  if (!data.length) {
    return (
      <div className="overflow-hidden rounded-lg border bg-gray-50 p-6 text-center text-[12px] text-gray-600">
        No head-to-head stats yet.
      </div>
    );
  }

  const winColor = "#3b82f6"; // blue-500
  const lossColor = "#ef4444"; // red-500

  return (
    <div>
      <div className="mb-2 text-xs font-medium text-gray-600 select-none cursor-default">
        {title}
      </div>
      <div
        className="overflow-hidden rounded-lg border"
        style={{ minHeight: 240 }}
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 16, bottom: 8, left: 16 }}
          >
            <CartesianGrid stroke="#e5e7eb" />
            <XAxis type="number" tick={{ fontSize: 12, fill: "#6b7280" }} />
            <YAxis
              dataKey="name"
              type="category"
              tick={{ fontSize: 12, fill: "#6b7280" }}
              width={100}
            />
            <Tooltip
              formatter={(value: any, name: any) => [
                value,
                name === "wins" ? "Wins" : "Losses",
              ]}
            />
            <Bar
              dataKey="losses"
              stackId="a"
              fill={lossColor}
              isAnimationActive={false}
            />
            <Bar
              dataKey="wins"
              stackId="a"
              fill={winColor}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-between px-3 py-2 text-[11px] text-gray-600">
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: winColor }}
          />{" "}
          Wins
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: lossColor }}
          />{" "}
          Losses
        </span>
      </div>
    </div>
  );
}
