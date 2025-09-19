"use client";
import { Input } from "@/components/layout";
import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

function EndSessionModal({
  title,
  shuttles,
  onShuttlesChange,
  onCancel,
  onConfirm,
  organizerUid,
  sessionId,
  unlinkedPlayers = [],
}: {
  title: string;
  shuttles: string;
  onShuttlesChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  organizerUid?: string | null;
  sessionId?: string;
  unlinkedPlayers?: { id: string; name: string }[];
}) {
  const showReminder =
    Array.isArray(unlinkedPlayers) && unlinkedPlayers.length > 0;
  const [ackUnlinked, setAckUnlinked] = useState(false);
  const [openQr, setOpenQr] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const toggleQr = (pid: string) =>
    setOpenQr((m) => ({ ...m, [pid]: !m[pid] }));
  const baseOrigin = typeof location !== "undefined" ? location.origin : "";
  const links = useMemo(() => {
    if (!sessionId || !organizerUid) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const p of unlinkedPlayers) {
      const url = `${baseOrigin}?claim=1&ouid=${encodeURIComponent(
        organizerUid
      )}&sid=${encodeURIComponent(sessionId)}&pid=${encodeURIComponent(p.id)}`;
      map.set(p.id, url);
    }
    return map;
  }, [unlinkedPlayers, sessionId, organizerUid, baseOrigin]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel}></div>
      <div className="relative w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-lg sm:rounded-2xl max-h=[90vh] overflow-auto">
        <div className="mb-2 text-base font-semibold">{title}</div>
        <div className="text-xs text-gray-600">
          This will lock further changes and compute session statistics.
        </div>
        {showReminder && (
          <div className="mt-3 rounded-lg border bg-amber-50 p-2 text-[11px] text-amber-800">
            <div className="font-medium">
              Reminder: ask players to link their accounts
            </div>
            <div className="mt-1">
              The following players are not linked yet:
              <ul className="mt-1 space-y-2">
                {unlinkedPlayers.map((p) => (
                  <li key={p.id} className="rounded border bg-white/70 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-900">{p.name}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleQr(p.id)}
                          className="rounded border px-2 py-0.5 text-[11px] text-gray-700"
                          disabled={!sessionId || !organizerUid}
                        >
                          {openQr[p.id] ? "Hide QR" : "Show QR"}
                        </button>
                        <button
                          onClick={async () => {
                            const url = links.get(p.id);
                            if (!url) return;
                            try {
                              await navigator.clipboard?.writeText(url);
                            } catch {}
                            setCopied((m) => ({ ...m, [p.id]: true }));
                            setTimeout(() => {
                              setCopied((m) => {
                                const n = { ...m } as Record<string, boolean>;
                                delete n[p.id];
                                return n;
                              });
                            }, 1200);
                          }}
                          className="rounded border px-2 py-0.5 text-[11px] text-gray-700 disabled:opacity-50"
                          disabled={
                            !sessionId || !organizerUid || !!copied[p.id]
                          }
                        >
                          {copied[p.id] ? "Copied!" : "Copy link"}
                        </button>
                      </div>
                    </div>
                    {openQr[p.id] && (
                      <div className="mt-2 flex flex-col items-center gap-2">
                        <QRCodeSVG
                          value={links.get(p.id) || ""}
                          size={180}
                          includeMargin={true}
                        />
                        <div className="w-full truncate rounded border bg-gray-50 p-1 text-[10px] text-gray-700">
                          {links.get(p.id)}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-2 flex items-start gap-2 rounded bg-amber-100 p-2">
              <input
                id="ack-unlinked"
                type="checkbox"
                className="mt-0.5"
                checked={ackUnlinked}
                onChange={(e) => setAckUnlinked(e.target.checked)}
              />
              <label
                htmlFor="ack-unlinked"
                className="text-[11px] leading-snug"
              >
                I understand any remaining unlinked players cannot be linked to
                profiles after ending this session.
              </label>
            </div>
          </div>
        )}
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
            className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
            disabled={showReminder && !ackUnlinked}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export { EndSessionModal };
