"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { auth } from "@/lib/firebase";
import { organizerUnlinkPlayer } from "@/lib/firestoreSessions";
import { unlinkAccountInOrganizerSession } from "@/lib/firestoreSessions";

function LinkToMeButton({
  sessionId,
  playerId,
}: {
  sessionId: string;
  playerId: string;
}) {
  const [linking, setLinking] = useState(false);
  const linkPlayerToAccount = useStore((s) => s.linkPlayerToAccount);
  const sessions = useStore((s) => s.sessions);
  return (
    <button
      onClick={async () => {
        if (!auth.currentUser) return;
        // enforce one player per account per session
        const ss = sessions.find((s) => s.id === sessionId);
        if (
          ss &&
          ss.players.some((pp) => pp.accountUid === auth.currentUser!.uid)
        )
          return;
        setLinking(true);
        try {
          linkPlayerToAccount(sessionId, playerId, auth.currentUser.uid);
        } finally {
          setLinking(false);
        }
      }}
      disabled={linking || !auth.currentUser}
      className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 disabled:opacity-50"
    >
      {linking ? "Linking…" : "Link to me"}
    </button>
  );
}

function UnlinkMeButton({
  sessionId,
  playerId,
  onUnlinked,
}: {
  sessionId: string;
  playerId: string;
  onUnlinked?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const unlinkPlayerFromAccount = useStore((s) => s.unlinkPlayerFromAccount);
  const sessions = useStore((s) => s.sessions);
  return (
    <button
      onClick={async () => {
        if (!auth.currentUser) return;
        setBusy(true);
        try {
          // If current user owns this session, perform organizer unlink remotely; else perform claimer unlink remotely
          // Determine organizer uid via injected map in window (set elsewhere) or stored infer map
          const ownerUid =
            (window as any).__sessionOwners?.get?.(sessionId) || null;
          const inferredOwnerUid = ownerUid as string | null;
          const isOwner = inferredOwnerUid
            ? inferredOwnerUid === auth.currentUser.uid
            : false;
          if (isOwner) {
            await organizerUnlinkPlayer(
              auth.currentUser.uid,
              sessionId,
              playerId
            );
          } else {
            const organizerUid = inferredOwnerUid || undefined;
            if (organizerUid) {
              await unlinkAccountInOrganizerSession(
                organizerUid,
                sessionId,
                playerId,
                auth.currentUser.uid
              );
            }
          }
          unlinkPlayerFromAccount(sessionId, playerId);
          if (!isOwner && typeof onUnlinked === "function") onUnlinked();
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy || !auth.currentUser}
      className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs disabled:opacity-50"
    >
      {busy ? "Unlinking…" : "Unlink"}
    </button>
  );
}

function OrganizerUnlinkButton({
  organizerUid,
  sessionId,
  playerId,
}: {
  organizerUid: string;
  sessionId: string;
  playerId: string;
}) {
  const [busy, setBusy] = useState(false);
  const unlinkPlayerFromAccount = useStore((s) => s.unlinkPlayerFromAccount);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          await organizerUnlinkPlayer(organizerUid, sessionId, playerId);
          unlinkPlayerFromAccount(sessionId, playerId);
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      className="rounded-xl border px-2 py-1 text-xs"
    >
      {busy ? "Unlink…" : "Unlink"}
    </button>
  );
}

export { LinkToMeButton, UnlinkMeButton, OrganizerUnlinkButton };
