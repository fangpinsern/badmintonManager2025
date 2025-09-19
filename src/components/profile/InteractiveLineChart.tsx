"use client";
import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

type SeriesKey = "singles" | "doubles";

export default function InteractiveLineChart({
  title,
  labels,
  singles,
  doubles,
  selected,
  onSelect,
  ySuffix = "%",
  yMax,
  showSingles = true,
  showDoubles = true,
}: {
  title: string;
  labels: string[];
  singles: number[];
  doubles: number[];
  selected: SeriesKey;
  onSelect: (s: SeriesKey) => void;
  ySuffix?: string;
  yMax?: number | null;
  showSingles?: boolean;
  showDoubles?: boolean;
}) {
  const data = useMemo(
    () =>
      labels.map((label, i) => ({
        label,
        singles: typeof singles[i] === "number" ? singles[i] : null,
        doubles: typeof doubles[i] === "number" ? doubles[i] : null,
      })),
    [labels, singles, doubles]
  );

  const singlesColor = "#059669"; // emerald
  const doublesColor = "#f97316"; // orange
  const enabledKeys = [
    showSingles ? ("singles" as const) : null,
    showDoubles ? ("doubles" as const) : null,
  ].filter(Boolean) as SeriesKey[];

  const effectiveSelected: SeriesKey | null = enabledKeys.includes(selected)
    ? selected
    : enabledKeys[0] ?? null;
  const stroke = effectiveSelected === "singles" ? singlesColor : doublesColor;
  const dataKey = effectiveSelected ?? "singles";
  const domain = useMemo(() => {
    if (typeof yMax === "number") return [0, yMax];
    if (ySuffix === "%") return [0, 100];
    const arr = (selected === "singles" ? singles : doubles).filter(
      (v) => typeof v === "number"
    ) as number[];
    const max = arr.length ? Math.max(...arr) : 0;
    const step = 10;
    return [0, Math.ceil(max / step) * step];
  }, [yMax, ySuffix, selected, singles, doubles]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div
          className="text-xs font-medium text-gray-600 select-none cursor-default"
          aria-hidden
        >
          {title}
        </div>
        {enabledKeys.length >= 2 ? (
          <div className="inline-flex items-center gap-0.5 rounded-lg border bg-white p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => onSelect("singles")}
              className={`rounded-md px-2 py-1 focus:outline-none outline-none ${
                effectiveSelected === "singles"
                  ? "bg-emerald-600 text-white"
                  : "text-gray-700"
              }`}
              aria-pressed={effectiveSelected === "singles"}
              disabled={!showSingles}
            >
              Singles
            </button>
            <button
              type="button"
              onClick={() => onSelect("doubles")}
              className={`rounded-md px-2 py-1 focus:outline-none outline-none ${
                effectiveSelected === "doubles"
                  ? "bg-orange-600 text-white"
                  : "text-gray-700"
              }`}
              aria-pressed={effectiveSelected === "doubles"}
              disabled={!showDoubles}
            >
              Doubles
            </button>
          </div>
        ) : enabledKeys.length === 1 ? (
          <div className="inline-flex items-center gap-1 rounded-lg border bg-white px-2 py-1 text-[11px] text-gray-700">
            {enabledKeys[0] === "singles" ? "Singles" : "Doubles"}
          </div>
        ) : null}
      </div>
      {enabledKeys.length === 0 ? (
        <div className="overflow-hidden rounded-lg border bg-gray-50 p-6 text-center text-[12px] text-gray-600">
          No data to display.
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-lg border focus:outline-none outline-none"
          style={{ minHeight: 200 }}
          tabIndex={-1}
        >
          <div
            className="mx-auto focus:outline-none outline-none"
            style={{ width: "100%", maxWidth: 840 }}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
          >
            <ResponsiveContainer width="100%" height={200}>
              <LineChart
                data={data}
                margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
              >
                <CartesianGrid stroke="#e5e7eb" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: "#6b7280" }}
                  interval={0}
                  minTickGap={10}
                  tickMargin={6}
                  padding={{ left: 10, right: 10 }}
                />
                <YAxis
                  domain={domain as any}
                  tick={{ fontSize: 12, fill: "#6b7280" }}
                  tickFormatter={(v) => `${v}${ySuffix}`}
                />
                <Tooltip
                  formatter={(value: any) => [
                    `${value}${ySuffix}`,
                    effectiveSelected === "singles" ? "Singles" : "Doubles",
                  ]}
                />
                {effectiveSelected && (
                  <Line
                    type="monotone"
                    dataKey={dataKey}
                    stroke={stroke}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 3 }}
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between px-3 py-2 text-[11px]">
        {showSingles && (
          <span
            className={`inline-flex items-center gap-1 ${
              effectiveSelected === "singles"
                ? "text-gray-900"
                : "text-gray-500"
            }`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: singlesColor }}
            />
            Singles
          </span>
        )}
        <span className="text-[11px] text-gray-500">&nbsp;</span>
        {showDoubles && (
          <span
            className={`inline-flex items-center gap-1 ${
              effectiveSelected === "doubles"
                ? "text-gray-900"
                : "text-gray-500"
            }`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: doublesColor }}
            />
            Doubles
          </span>
        )}
      </div>
    </div>
  );
}
