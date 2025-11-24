"use client";
import { Label } from "@/components/layout";
import React from "react";

function ScoreModal({
  open,
  sideLabel,
  requiredPerTeam,
  ready,
  scoreA,
  scoreB,
  onChangeA,
  onChangeB,
  onCancel,
  onSave,
  onVoid,
  namesA,
  namesB,
}: {
  open: boolean;
  sideLabel: string;
  requiredPerTeam: number;
  ready: boolean;
  scoreA: string;
  scoreB: string;
  onChangeA: (v: string) => void;
  onChangeB: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onVoid?: () => void;
  namesA?: string[];
  namesB?: string[];
}) {
  const aRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (open) {
      setTimeout(() => aRef.current?.focus(), 0);
    }
  }, [open]);
  if (!open) return null;
  const scoreValid =
    scoreA.trim() !== "" &&
    scoreB.trim() !== "" &&
    !Number.isNaN(Number(scoreA)) &&
    !Number.isNaN(Number(scoreB));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel}></div>
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg max-h-[90vh] overflow-auto">
        <div className="mb-2 text-base font-semibold">
          Record score ({sideLabel} A vs {sideLabel} B)
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>{`${sideLabel} A`}</Label>
            {namesA && namesA.length > 0 && (
              <div className="mb-1 truncate text-[11px] text-gray-600">
                {namesA.join(" & ")}
              </div>
            )}
            <input
              ref={aRef}
              type="number"
              placeholder="21"
              inputMode="numeric"
              min={0}
              value={scoreA}
              onChange={(e) => onChangeA(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <Label>{`${sideLabel} B`}</Label>
            {namesB && namesB.length > 0 && (
              <div className="mb-1 truncate text-[11px] text-gray-600">
                {namesB.join(" & ")}
              </div>
            )}
            <input
              type="number"
              placeholder="18"
              inputMode="numeric"
              min={0}
              value={scoreB}
              onChange={(e) => onChangeB(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          {onVoid ? (
            <button
              onClick={onVoid}
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700"
            >
              Void game
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="rounded-xl border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={!ready || !scoreValid}
              className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Save & Clear
            </button>
          </div>
        </div>
        {!ready && (
          <div className="mt-2 text-[11px] text-amber-600">
            Need exactly {requiredPerTeam} in {sideLabel} A and {sideLabel} B.
          </div>
        )}
        {ready && !scoreValid && (
          <div className="mt-2 text-[11px] text-amber-600">
            Enter both scores.
          </div>
        )}
      </div>
    </div>
  );
}

export { ScoreModal };
