"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import UPlot from "uplot";
import "uplot/dist/uPlot.min.css";

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  const data = useMemo(() => {
    const x = Float64Array.from(labels, (_v, i) => i);
    const src = selected === "singles" ? singles : doubles;
    const y = Float64Array.from(src);
    return [x, y];
  }, [labels, singles, doubles, selected]);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;

    const singlesColor = "#059669"; // emerald
    const doublesColor = "#f97316"; // orange
    const color = selected === "singles" ? singlesColor : doublesColor;

    const width = containerRef.current.clientWidth || 560;
    const height = 180;

    const maxVal = Math.max(...(selected === "singles" ? singles : doubles));
    const yMaxEff =
      yMax ?? (ySuffix === "%" ? 100 : Math.ceil(maxVal / 60) * 60 || 60);

    const opts: any = {
      width,
      height,
      tzDate: (ts: number) => new Date(ts),
      scales: {
        x: { time: false },
        y: { auto: yMax ? false : true },
      },
      axes: [
        {
          values: (u: any, ticks: number[]) =>
            ticks.map((t) => labels[Math.round(t)] ?? ""),
          grid: { stroke: "#e5e7eb" },
          size: 28,
          font: "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        },
        {
          values: (u: any, ticks: number[]) =>
            ticks.map((t) => `${Math.round(t)}${ySuffix}`),
          grid: { stroke: "#e5e7eb" },
          size: 40,
          font: "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        },
      ],
      series: [
        {},
        {
          label: title,
          stroke: color,
          width: 2.5,
        },
      ],
      hooks: {
        setSelect: [
          (u: any) => {
            const s = u.select;
            if (s.width > 0) {
              const min = u.posToVal(s.left, "x");
              const max = u.posToVal(s.left + s.width, "x");
              u.setScale("x", { min, max });
            }
          },
        ],
      },
      cursor: { drag: { x: true, y: false }, focus: { prox: 16 } },
      select: { show: true, over: true },
    };

    if (yMaxEff) {
      opts.scales.y = { auto: false, min: 0, max: yMaxEff };
    }

    chartRef.current = new UPlot(opts, data, containerRef.current);

    const onResize = () => {
      try {
        if (!containerRef.current || !chartRef.current) return;
        const w = containerRef.current.clientWidth || width;
        chartRef.current.setSize({ width: w, height });
      } catch {}
    };
    window.addEventListener("resize", onResize);

    const onDbl = () => {
      try {
        if (!chartRef.current) return;
        chartRef.current.setScale("x", { min: null, max: null });
      } catch {}
    };
    containerRef.current.addEventListener("dblclick", onDbl);

    setReady(true);

    return () => {
      try {
        containerRef.current?.removeEventListener("dblclick", onDbl);
        window.removeEventListener("resize", onResize);
        chartRef.current?.destroy();
        chartRef.current = null;
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels.join("|"), selected]);

  // Update data on selection change
  useEffect(() => {
    try {
      if (!chartRef.current) return;
      const x = Float64Array.from(labels, (_v, i) => i);
      const src = selected === "singles" ? singles : doubles;
      const y = Float64Array.from(src);
      chartRef.current.setData([x, y]);
    } catch {}
  }, [data, labels, singles, doubles, selected]);

  const singlesColor = "#059669";
  const doublesColor = "#f97316";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div
          className="text-xs font-medium text-gray-600 select-none cursor-default"
          aria-hidden
        >
          {title}
        </div>
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
      <div
        ref={containerRef}
        className="overflow-hidden rounded-lg border"
        style={{ minHeight: 180 }}
      />
      <div className="flex items-center justify-between border-t px-3 py-2 text-[11px]">
        <div
          className={`inline-flex items-center gap-1 ${
            selected === "singles" ? "text-gray-900" : "text-gray-500"
          }`}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: singlesColor }}
          />
          Singles
        </div>
        <div className="text-[11px] text-gray-500">
          Hint: drag to zoom · double‑click to reset
        </div>
        <div
          className={`inline-flex items-center gap-1 ${
            selected === "doubles" ? "text-gray-900" : "text-gray-500"
          }`}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: doublesColor }}
          />
          Doubles
        </div>
      </div>
    </div>
  );
}
