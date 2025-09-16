"use client";
import { Input } from "@/components/layout";

function EndSessionModal({
  open,
  title,
  shuttles,
  onShuttlesChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  shuttles: string;
  onShuttlesChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel}></div>
      <div className="relative w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-lg sm:rounded-2xl max-h-[90vh] overflow-auto">
        <div className="mb-2 text-base font-semibold">{title}</div>
        <div className="text-xs text-gray-600">
          This will lock further changes and compute session statistics.
        </div>
        <div className="mt-3">
          <Input
            type="number"
            label="Shuttlecocks used"
            inputMode="numeric"
            min={0}
            value={shuttles}
            onChange={(e) => onShuttlesChange(e.target.value)}
          />
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-xl border px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-xl bg-black px-3 py-1.5 text-sm text-white"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export { EndSessionModal };
