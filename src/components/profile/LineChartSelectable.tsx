"use client";
import React from "react";

type SeriesKey = "singles" | "doubles";

export default function LineChartSelectable({
  title,
  labels,
  singles,
  doubles,
  selected,
  onSelect,
  ySuffix = "%",
  yMax,
}: {
  title: string;
  labels: string[];
  singles: number[];
  doubles: number[];
  selected: SeriesKey;
  onSelect: (s: SeriesKey) => void;
  ySuffix?: string;
  yMax?: number | null;
}) {
  const width = 560;
  const height = 160;
  const padL = 32;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = labels.length;
  const singlesColor = "#059669"; // emerald
  const doublesColor = "#f97316"; // orange
  const values = selected === "singles" ? singles : doubles;
  const color = selected === "singles" ? singlesColor : doublesColor;
  const x = (i: number) => padL + (innerW * i) / (n - 1);
  const inferYMax = () => {
    const maxVal = Math.max(...values);
    if (ySuffix === "%") return 100;
    const step = 60;
    return Math.ceil(maxVal / step) * step || step;
  };
  const yMaxEff = yMax ?? inferYMax();
  const y = (v: number) => padT + innerH * (1 - v / yMaxEff);
  const pathFor = (arr: number[]) =>
    arr.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  const gridY: number[] = [];
  if (ySuffix === "%") for (let t = 0; t <= 100; t += 25) gridY.push(t);
  else for (let t = 0; t <= yMaxEff; t += 60) gridY.push(t);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-gray-600">{title}</div>
        <div className="inline-flex items-center gap-0.5 rounded-lg border bg-white p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => onSelect("singles")}
            className={`rounded-md px-2 py-1 ${
              selected === "singles"
                ? "bg-emerald-600 text-white"
                : "text-gray-700"
            }`}
            aria-pressed={selected === "singles"}
          >
            Singles
          </button>
          <button
            type="button"
            onClick={() => onSelect("doubles")}
            className={`rounded-md px-2 py-1 ${
              selected === "doubles"
                ? "bg-orange-600 text-white"
                : "text-gray-700"
            }`}
            aria-pressed={selected === "doubles"}
          >
            Doubles
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block w-full h-auto"
          role="img"
          aria-label={`${title} chart`}
        >
          {gridY.map((gy) => (
            <g key={gy}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y(gy)}
                y2={y(gy)}
                stroke="#e5e7eb"
                strokeWidth="1"
              />
              <text
                x={padL - 6}
                y={y(gy)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="12"
                fill="#6b7280"
              >
                {gy}
                {ySuffix}
              </text>
            </g>
          ))}
          {labels.map((lab, i) =>
            i % 2 === 0 ? (
              <text
                key={lab}
                x={x(i)}
                y={height - 4}
                textAnchor="middle"
                fontSize="12"
                fill="#6b7280"
              >
                {lab}
              </text>
            ) : null
          )}
          <path
            d={pathFor(values)}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
          />
          <circle cx={x(n - 1)} cy={y(values[n - 1])} r="3" fill={color} />
        </svg>
        <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px]">
          <span
            className={`inline-flex items-center gap-1 ${
              selected === "singles" ? "text-gray-900" : "text-gray-500"
            }`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: singlesColor }}
            />
            Singles
          </span>
          <span
            className={`inline-flex items-center gap-1 ${
              selected === "doubles" ? "text-gray-900" : "text-gray-500"
            }`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: doublesColor }}
            />
            Doubles
          </span>
        </div>
      </div>
    </div>
  );
}
