"use client";
import { Input } from "@/components/layout";
import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  linkAccountInOrganizerSession,
  organizerUnlinkPlayer,
} from "@/lib/firestoreSessions";
import { QRCodeSVG } from "qrcode.react";
import { doc, onSnapshot } from "firebase/firestore";

function EndSessionModal({
  title,
  shuttles,
  onShuttlesChange,
  onCancel,
  onConfirm,
  organizerUid,
  sessionId,
  unlinkedPlayers = [],
  organizerLinked = false,
}: {
  title: string;
  shuttles: string;
  onShuttlesChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  organizerUid?: string | null;
  sessionId?: string;
  unlinkedPlayers?: { id: string; name: string }[];
  organizerLinked?: boolean;
}) {
  const showReminder =
    Array.isArray(unlinkedPlayers) && unlinkedPlayers.length > 0;
  const [ackUnlinked, setAckUnlinked] = useState(false);
  const [openQr, setOpenQr] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const [linkedIds, setLinkedIds] = useState<Record<string, boolean>>({});
  const [linkedToMe, setLinkedToMe] = useState(organizerLinked);
  const toggleQr = (pid: string) =>
    setOpenQr((m) => ({ ...m, [pid]: !m[pid] }));
  const baseOrigin = typeof location !== "undefined" ? location.origin : "";
  const links = useMemo(() => {
    if (!sessionId || !organizerUid) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const p of unlinkedPlayers) {
      const url = `${baseOrigin}/claim?claim=1&ouid=${encodeURIComponent(
        organizerUid
      )}&sid=${encodeURIComponent(sessionId)}&pid=${encodeURIComponent(p.id)}`;
      map.set(p.id, url);
    }
    return map;
  }, [unlinkedPlayers, sessionId, organizerUid, baseOrigin]);

  // Sync initial linked state from parent (covers the moment before snapshot arrives)
  useEffect(() => {
    setLinkedToMe(organizerLinked);
  }, [organizerLinked]);

  const orderedUnlinked = useMemo(() => {
    const arr = [...unlinkedPlayers];
    arr.sort((a, b) => {
      const al = !!linkedIds[a.id];
      const bl = !!linkedIds[b.id];
      if (al !== bl) return al ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }, [unlinkedPlayers, linkedIds]);

  useEffect(() => {
    if (!organizerUid || !sessionId) return;
    const ref = doc(db as any, "users", organizerUid, "sessions", sessionId);
    const unsub = onSnapshot(ref as any, (snap: any) => {
      try {
        const data: any = snap.data();
        const payload = data?.payload || {};
        const players: any[] = Array.isArray(payload.players)
          ? payload.players
          : [];
        const map: Record<string, boolean> = {};
        const myUid = auth.currentUser?.uid;
        let mine = false;
        for (const pl of players) {
          if (!pl) continue;
          const pid = pl.id as string | undefined;
          const au = pl.accountUid as string | undefined;
          if (pid && au) map[pid] = true;
          if (myUid && au === myUid) mine = true;
        }
        setLinkedIds(map);
        setLinkedToMe(mine);
      } catch {}
    });
    return () => unsub();
  }, [organizerUid, sessionId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel}></div>
      <div className="relative w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-lg sm:rounded-2xl max-h-[90vh] overflow-y-auto">
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
              <ul className="mt-1 max-h-[50vh] overflow-y-auto space-y-2">
                {orderedUnlinked.map((p) => (
                  <li key={p.id} className="rounded border bg-white/70 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-gray-900">
                        {linkedIds[p.id] && (
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
                            aria-label="linked"
                            title="Linked"
                          >
                            ✓
                          </span>
                        )}
                        {p.name}
                      </span>
                      <div className="flex items-center gap-2">
                        {!organizerLinked &&
                          !linkedToMe &&
                          !linkedIds[p.id] && (
                            <button
                              onClick={async () => {
                                if (
                                  !auth.currentUser ||
                                  !organizerUid ||
                                  !sessionId
                                )
                                  return;
                                try {
                                  setLinkedToMe(true);
                                  await linkAccountInOrganizerSession(
                                    organizerUid,
                                    sessionId,
                                    p.id,
                                    auth.currentUser.uid
                                  );
                                } catch {
                                  setLinkedToMe(false);
                                }
                              }}
                              className="rounded border px-2 py-0.5 text-[11px] text-gray-700 disabled:opacity-50"
                              disabled={
                                !auth.currentUser || !sessionId || !organizerUid
                              }
                            >
                              Link to me
                            </button>
                          )}
                        {linkedIds[p.id] && (
                          <button
                            onClick={async () => {
                              if (!organizerUid || !sessionId) return;
                              try {
                                await organizerUnlinkPlayer(
                                  organizerUid,
                                  sessionId,
                                  p.id
                                );
                              } catch {}
                            }}
                            className="rounded border px-2 py-0.5 text-[11px] text-gray-700 disabled:opacity-50"
                            disabled={!organizerUid || !sessionId}
                          >
                            Unlink
                          </button>
                        )}
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
