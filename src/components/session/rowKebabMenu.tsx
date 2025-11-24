"use client";
import { Session } from "@/types/player";
import { useRef, useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import {
  getProfileByUsername,
  organizerUnlinkPlayer,
  suggestUsernames,
  unlinkAccountInOrganizerSession,
  linkAccountInOrganizerSession,
} from "@/lib/firestoreSessions";
import { QRCodeSVG } from "qrcode.react";
import { Player } from "@/types/player";
import { ConfirmModal } from "@/components/session/confirmModal";
import { useStore } from "@/lib/store";
import { useRouter } from "next/navigation";
import { Input } from "@/components/layout";

function RowKebabMenu({
  session,
  player,
  inGame,
  isOrganizer,
  organizerUid,
  linkPlayerToAccount,
  removePlayer,
}: {
  session: Session;
  player: Player;
  inGame: boolean;
  isOrganizer: boolean;
  organizerUid?: string | null;
  linkPlayerToAccount: (sid: string, pid: string, uid: string) => void;
  removePlayer: (sid: string, pid: string) => void;
}) {
  const [showQr, setShowQr] = useState(false);
  const addCo = useStore((s) => s.addCoOrganizer);
  const removeCo = useStore((s) => s.removeCoOrganizer);
  const router = useRouter();
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const unlinkModeRef = useRef<"self" | "organizer" | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [busyCo, setBusyCo] = useState(false);
  const alreadyLinkedToMe =
    !!auth.currentUser?.uid &&
    session.players.some((pp) => pp.accountUid === auth.currentUser!.uid);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const closeMenu = () => {
    try {
      menuRef.current?.removeAttribute("open");
    } catch {}
  };
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const el = menuRef.current;
      if (!el || !el.open) return;
      if (!el.contains(e.target as Node)) {
        try {
          el.removeAttribute("open");
        } catch {}
      }
    }
    document.addEventListener("mousedown", onDocClick, true);
    return () => document.removeEventListener("mousedown", onDocClick, true);
  }, []);
  return (
    <>
      <details ref={menuRef} className="relative">
        <summary className="cursor-pointer list-none px-2 py-1 text-md font-bold appearance-none [&::-webkit-details-marker]:hidden">
          ⋮
        </summary>
        <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border bg-white p-1 text-sm shadow">
          {!player.accountUid && !alreadyLinkedToMe && (
            <button
              className="w-full rounded px-2 py-1 text-left hover:bg-gray-50"
              onClick={() => {
                const uid = auth.currentUser?.uid;
                if (!uid) return;
                // Enforce 1:1 mapping client-side: if this uid already linked anywhere, do not allow
                if (session.players.some((pp) => pp.accountUid === uid)) {
                  return;
                }
                if (isOrganizer && organizerUid) {
                  void linkAccountInOrganizerSession(
                    organizerUid,
                    session.id,
                    player.id,
                    uid
                  );
                } else {
                  linkPlayerToAccount(session.id, player.id, uid);
                }
                closeMenu();
              }}
            >
              Link to me
            </button>
          )}
          {!player.accountUid && (
            <button
              className="w-full rounded px-2 py-1 text-left hover:bg-gray-50"
              onClick={() => {
                setShowQr(true);
                closeMenu();
              }}
            >
              Show QR
            </button>
          )}
          {player.accountUid &&
            (auth.currentUser?.uid === player.accountUid ? (
              // Self unlink only if not locked
              !player.linkLocked ? (
                <button
                  className="w-full rounded px-2 py-1 text-left hover:bg-gray-50"
                  onClick={() => {
                    unlinkModeRef.current = "self";
                    setUnlinkOpen(true);
                    closeMenu();
                  }}
                >
                  Unlink
                </button>
              ) : null
            ) : isOrganizer && organizerUid ? (
              // Organizer can unlink regardless of lock state
              <button
                className="w-full rounded px-2 py-1 text-left hover:bg-gray-50"
                onClick={() => {
                  unlinkModeRef.current = "organizer";
                  setUnlinkOpen(true);
                  closeMenu();
                }}
              >
                Unlink
              </button>
            ) : null)}
          {isOrganizer && player.accountUid && (
            <>
              {Array.isArray(session.coOrganizerUids) &&
              session.coOrganizerUids.includes(player.accountUid) ? (
                <button
                  className="w-full rounded px-2 py-1 text-left hover:bg-gray-50 disabled:opacity-50"
                  disabled={busyCo}
                  onClick={() => {
                    setBusyCo(true);
                    try {
                      removeCo(session.id, player.accountUid!);
                    } finally {
                      setBusyCo(false);
                      closeMenu();
                    }
                  }}
                >
                  Remove co-organizer
                </button>
              ) : (
                <button
                  className="w-full rounded px-2 py-1 text-left hover:bg-gray-50 disabled:opacity-50"
                  disabled={busyCo}
                  onClick={() => {
                    setBusyCo(true);
                    try {
                      addCo(session.id, player.accountUid!);
                    } finally {
                      setBusyCo(false);
                      closeMenu();
                    }
                  }}
                >
                  Assign co-organizer
                </button>
              )}
            </>
          )}
          <button
            className="w-full rounded px-2 py-1 text-left hover:bg-gray-50 disabled:opacity-50"
            disabled={inGame}
            onClick={() => {
              setRemoveOpen(true);
              closeMenu();
            }}
          >
            Remove
          </button>
        </div>
      </details>
      <ConfirmModal
        open={removeOpen}
        title={"Remove player?"}
        body={
          "This will remove the player from the session. If linked, their session access will be revoked."
        }
        confirmText="Remove"
        onCancel={() => setRemoveOpen(false)}
        onConfirm={async () => {
          try {
            removePlayer(session.id, player.id);
          } finally {
            setRemoveOpen(false);
          }
        }}
      />
      {showQr && (
        <ClaimQrButton
          forceOpen
          sessionId={session.id}
          playerId={player.id}
          playerName={player.name}
          organizerUid={organizerUid || undefined}
          isOrganizer={!!isOrganizer}
          onClose={() => setShowQr(false)}
        />
      )}
      <ConfirmModal
        open={unlinkOpen}
        title={
          unlinkModeRef.current === "self"
            ? "Unlink from this player?"
            : "Unlink this player?"
        }
        body={
          unlinkModeRef.current === "self"
            ? "Your account will no longer be linked to this player for this session."
            : "This will remove the account link from this player."
        }
        confirmText="Unlink"
        onCancel={() => setUnlinkOpen(false)}
        onConfirm={async () => {
          try {
            const owner =
              organizerUid ||
              (window as any).__sessionOwners?.get?.(session.id);
            if (unlinkModeRef.current === "self") {
              if (owner && auth.currentUser?.uid !== owner) {
                await unlinkAccountInOrganizerSession(
                  owner,
                  session.id,
                  player.id,
                  auth.currentUser!.uid
                );
                try {
                  router.push("/");
                } catch {}
              } else if (auth.currentUser) {
                await organizerUnlinkPlayer(
                  auth.currentUser.uid,
                  session.id,
                  player.id
                );
              }
            } else if (unlinkModeRef.current === "organizer" && organizerUid) {
              await organizerUnlinkPlayer(organizerUid, session.id, player.id);
            }
          } finally {
            setUnlinkOpen(false);
          }
        }}
      />
    </>
  );
}

function ClaimQrButton({
  sessionId,
  playerId,
  playerName,
  organizerUid,
  isOrganizer,
  forceOpen,
  onClose,
}: {
  sessionId: string;
  playerId: string;
  playerName: string;
  organizerUid?: string;
  isOrganizer?: boolean;
  forceOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrSize, setQrSize] = useState(240);
  const resolvedOrganizerUid = organizerUid || auth.currentUser?.uid || "";
  const url = `${
    typeof location !== "undefined" ? location.origin : ""
  }/claim?claim=1&ouid=${encodeURIComponent(
    resolvedOrganizerUid
  )}&sid=${encodeURIComponent(sessionId)}&pid=${encodeURIComponent(playerId)}`;
  // Organizer: link by username (optional)
  const [uname, setUname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const suggestTimerRef = useRef<number | null>(null);
  return (
    <>
      {!forceOpen && (
        <button
          onClick={() => setOpen(true)}
          className="rounded-xl border px-2 py-1 text-xs"
        >
          QR
        </button>
      )}
      {(forceOpen || open) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[90vw] max-w-md md:max-w-lg lg:max-w-xl max-h-[85vh] overflow-auto rounded-2xl bg-white p-4 shadow">
            <div className="mb-1 text-sm font-semibold">
              Link your account to:
            </div>
            <div className="mb-2 text-base font-bold">{playerName}</div>
            <div className="mb-3 text-xs text-gray-600">
              By linking, your account will be attached to this player for this
              session.
            </div>
            <div className="mx-auto mb-2 flex items-center justify-center">
              <QRCodeSVG value={url} size={qrSize} includeMargin={true} />
            </div>
            <div className="rounded border bg-gray-50 p-2 text-xs break-all">
              {url}
            </div>
            {isOrganizer && resolvedOrganizerUid && (
              <div className="mt-3 rounded border bg-gray-50 p-2">
                <div className="mb-1 text-[11px] font-medium text-gray-700">
                  Organizer: link this player by username
                </div>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setError("");
                    const q = (uname || "").trim().toLowerCase();
                    if (!q) return;
                    setBusy(true);
                    try {
                      const prof = await getProfileByUsername(q);
                      if (!prof?.uid) throw new Error("Username not found");
                      await linkAccountInOrganizerSession(
                        resolvedOrganizerUid,
                        sessionId,
                        playerId,
                        prof.uid
                      );
                      setUname("");
                      setSuggestions([]);
                    } catch (err: any) {
                      setError(err?.message || "Failed to link by username");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Username (without @)"
                      value={uname}
                      onChange={(e) => {
                        const v = e.target.value;
                        setUname(v);
                        setError("");
                        if (suggestTimerRef.current)
                          window.clearTimeout(suggestTimerRef.current);
                        suggestTimerRef.current = window.setTimeout(
                          async () => {
                            try {
                              const q = v.trim().toLowerCase();
                              if (!q) {
                                setSuggestions([]);
                                return;
                              }
                              const list = await suggestUsernames(q, 5);
                              setSuggestions(list);
                            } catch {
                              setSuggestions([]);
                            }
                          },
                          200
                        );
                      }}
                      className="flex-1"
                      disabled={busy}
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded bg-black px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      {busy ? "Linking…" : "Link"}
                    </button>
                  </div>
                  {!!suggestions.length && (
                    <div className="rounded border bg-white">
                      {suggestions.map((s) => (
                        <button
                          type="button"
                          key={s}
                          onClick={async () => {
                            if (busy) return;
                            setUname(s);
                            setError("");
                            setBusy(true);
                            try {
                              const prof = await getProfileByUsername(s);
                              if (!prof?.uid)
                                throw new Error("Username not found");
                              await linkAccountInOrganizerSession(
                                resolvedOrganizerUid,
                                sessionId,
                                playerId,
                                prof.uid
                              );
                              setUname("");
                              setSuggestions([]);
                            } catch (err: any) {
                              setError(
                                err?.message || "Failed to link by username"
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="block w-full px-2 py-1 text-left text-[12px] hover:bg-gray-50"
                        >
                          @{s}
                        </button>
                      ))}
                    </div>
                  )}
                  {!!error && (
                    <div className="text-[11px] text-red-600">{error}</div>
                  )}
                </form>
              </div>
            )}
            <div className="mt-3 flex items-center justify-end gap-2">
              {copied && (
                <span className="mr-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                  Copied!
                </span>
              )}
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard?.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  } catch {}
                }}
                className="rounded bg-black px-2 py-1 text-xs text-white"
              >
                Copy
              </button>
              <button
                onClick={() => {
                  if (forceOpen) {
                    onClose && onClose();
                  } else {
                    setOpen(false);
                  }
                }}
                className="rounded border px-2 py-1 text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ShareClaimsButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen(true)}
      className="ml-2 rounded-lg border border-gray-300 px-2 py-1 text-xs"
    >
      Share claim QR
    </button>
  );
}

export { RowKebabMenu, ShareClaimsButton };
