"use client";
import { Session } from "@/types/player";
import { useState } from "react";
import { auth } from "@/lib/firebase";
import { organizerUnlinkPlayer } from "@/lib/firestoreSessions";
import { unlinkAccountInOrganizerSession } from "@/lib/firestoreSessions";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useEffect } from "react";
import { Player } from "@/types/player";
import { ConfirmModal } from "@/components/session/confirmModal";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const unlinkModeRef = useRef<"self" | "organizer" | null>(null);
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
        <summary className="cursor-pointer list-none px-2 py-1 text-md font-bold">
          ⋮
        </summary>
        <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border bg-white p-1 text-sm shadow">
          {!player.accountUid && !alreadyLinkedToMe && (
            <button
              className="w-full rounded px-2 py-1 text-left hover:bg-gray-50"
              onClick={() => {
                const uid = auth.currentUser?.uid;
                if (!uid) return;
                if (!session.players.some((pp) => pp.accountUid === uid))
                  linkPlayerToAccount(session.id, player.id, uid);
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
            !player.linkLocked &&
            (auth.currentUser?.uid === player.accountUid ? (
              <button
                className="w-full rounded px-2 py-1 text-left hover:bg-gray-50"
                onClick={() => {
                  unlinkModeRef.current = "self";
                  setUnlinkOpen(true);
                  closeMenu();
                }}
                disabled={player.linkLocked}
              >
                Unlink
              </button>
            ) : isOrganizer && organizerUid ? (
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
          <button
            className="w-full rounded px-2 py-1 text-left hover:bg-gray-50 disabled:opacity-50"
            disabled={inGame}
            onClick={() => {
              removePlayer(session.id, player.id);
              closeMenu();
            }}
          >
            Remove
          </button>
        </div>
      </details>
      {showQr && (
        <ClaimQrButton
          forceOpen
          sessionId={session.id}
          playerId={player.id}
          playerName={player.name}
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
  forceOpen,
  onClose,
}: {
  sessionId: string;
  playerId: string;
  playerName: string;
  forceOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrSize, setQrSize] = useState(240);
  const organizerUid = auth.currentUser?.uid || "";
  const url = `${
    typeof location !== "undefined" ? location.origin : ""
  }?claim=1&ouid=${encodeURIComponent(organizerUid)}&sid=${encodeURIComponent(
    sessionId
  )}&pid=${encodeURIComponent(playerId)}`;
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
