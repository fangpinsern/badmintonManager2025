"use client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Input } from "@/components/layout";
import LoadingScreen from "@/components/LoadingScreen";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  subscribeClub,
  resolveUsernamesForUids,
  type FirestoreClub,
  kickMemberRemote,
} from "@/lib/firestoreClubs";
import { ConfirmModal } from "@/components/session/confirmModal";

export default function ClubMembersPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id || "");

  const [user, setUser] = useState<{
    uid: string;
    displayName?: string | null;
  } | null>(
    auth.currentUser
      ? { uid: auth.currentUser.uid, displayName: auth.currentUser.displayName }
      : null
  );
  const [authReady, setAuthReady] = useState(false);
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u ? { uid: u.uid, displayName: u.displayName } : null);
        setAuthReady(true);
      }),
    []
  );

  const [club, setClub] = useState<FirestoreClub | null>(null);
  const [clubReady, setClubReady] = useState(false);
  const [clubError, setClubError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    setClubReady(false);
    setClubError(null);
    let first = true;
    return subscribeClub(
      id,
      (doc) => {
        setClub(doc);
        if (first) {
          setClubReady(true);
          first = false;
        }
      },
      (err) => {
        try {
          const code = (err && (err.code || err?.name)) || "unknown";
          if (
            String(code).includes("permission") ||
            code === "permission-denied"
          ) {
            setClubError("You don't have permission to view this club.");
          } else {
            setClubError("Unable to load this club.");
          }
        } catch {
          setClubError("Unable to load this club.");
        }
        setClubReady(true);
      },
      user?.uid || undefined
    );
  }, [id, user]);

  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({});
  const [loadedCount, setLoadedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const pageSize = 20;

  const allMemberUids = useMemo(
    () =>
      club && Array.isArray(club.memberUids)
        ? club.memberUids.filter(Boolean)
        : [],
    [club?.memberUids?.join("|")]
  );

  useEffect(() => {
    // reset pagination when club changes
    setLoadedCount(0);
    setHasMore(true);
    setUsernameMap({});
  }, [allMemberUids.join("|")]);

  async function loadNextPage() {
    if (busy) return;
    if (!allMemberUids.length) return;
    if (!hasMore) return;
    setBusy(true);
    try {
      const nextSlice = allMemberUids.slice(
        loadedCount,
        loadedCount + pageSize
      );
      if (nextSlice.length === 0) {
        setHasMore(false);
        return;
      }
      const map = await resolveUsernamesForUids(nextSlice);
      setUsernameMap((prev) => ({ ...prev, ...map }));
      const nextCount = loadedCount + nextSlice.length;
      setLoadedCount(nextCount);
      setHasMore(nextCount < allMemberUids.length);
    } finally {
      setBusy(false);
    }
  }

  // Load the first page when members become available
  useEffect(() => {
    if (!allMemberUids.length) return;
    if (loadedCount > 0) return;
    if (busy) return;
    void loadNextPage();
  }, [allMemberUids.join("|"), loadedCount, busy]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const el = sentinelRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            void loadNextPage();
          }
        }
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => {
      try {
        obs.disconnect();
      } catch {}
    };
  }, [
    sentinelRef.current,
    busy,
    hasMore,
    loadedCount,
    allMemberUids.join("|"),
  ]);

  const [q, setQ] = useState("");
  const normalizedQ = (q || "").trim().toLowerCase();

  const displayUids = useMemo(() => {
    if (!normalizedQ) {
      return allMemberUids.slice(0, loadedCount);
    }
    // For search, include all members we already know usernames for; if not all resolved, do a best-effort client filter on known ones.
    const knownPairs = allMemberUids.map((uid) => ({
      uid,
      uname: usernameMap[uid] || "",
    }));
    return knownPairs
      .filter(
        (p) =>
          (p.uname || "").includes(normalizedQ) || p.uid.includes(normalizedQ)
      )
      .map((p) => p.uid);
  }, [
    normalizedQ,
    loadedCount,
    allMemberUids.join("|"),
    JSON.stringify(usernameMap),
  ]);

  // If searching and we haven't resolved all usernames yet, kick off a one-time resolve to improve results (max 30 members by design).
  useEffect(() => {
    let cancelled = false;
    async function ensureAllUsernames() {
      if (!normalizedQ) return;
      if (!allMemberUids.length) return;
      const missing = allMemberUids.filter((u) => !usernameMap[u]);
      if (!missing.length) return;
      try {
        const map = await resolveUsernamesForUids(missing);
        if (!cancelled) setUsernameMap((prev) => ({ ...prev, ...map }));
      } catch {}
    }
    void ensureAllUsernames();
    return () => {
      cancelled = true;
    };
  }, [normalizedQ, allMemberUids.join("|"), JSON.stringify(usernameMap)]);

  const isPrivate = ((club as any)?.visibility || "public") === "private";
  const isMember = useMemo(
    () => !!club && !!user && (club.memberUids || []).includes(user.uid),
    [club, user]
  );

  if (!authReady || !clubReady) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <LoadingScreen />
        </Card>
      </main>
    );
  }

  if (!club) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <div className="flex items-center justify-between">
            <div className="text-gray-600">
              {clubError ? clubError : "Club not found."}
            </div>
            <Link
              href={`/clubs/${id}`}
              className="rounded border px-2 py-1 text-xs"
            >
              Back
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  if (isPrivate && !isMember) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <div className="flex items-center justify-between">
            <div className="text-gray-600">
              This club is private. Only members can view the details.
            </div>
            <Link
              href={`/clubs/${id}`}
              className="rounded border px-2 py-1 text-xs"
            >
              Back
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md md:max-w-2xl p-4 text-sm">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Members</h1>
          <div className="text-gray-600">
            {(club.memberUids || []).length} total
          </div>
        </div>
        <Link
          href={`/clubs/${id}`}
          className="rounded border px-2 py-1 text-xs"
        >
          Back to club
        </Link>
      </header>

      <section className="mb-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Input
                label="Search"
                placeholder="Search by @username"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        </Card>
      </section>

      <section>
        <Card>
          {displayUids.length === 0 ? (
            <div className="rounded border bg-gray-50 p-4 text-gray-600">
              No members found.
            </div>
          ) : (
            <ul className="space-y-2">
              {displayUids.map((uid) => {
                const uname = usernameMap[uid];
                return (
                  <li key={uid} className="flex items-center justify-between">
                    <div className="font-medium">
                      {uname ? (
                        <Link
                          href={`/profile/${uname}`}
                          className="text-blue-600 hover:underline"
                        >
                          @{uname}
                        </Link>
                      ) : (
                        <span>@{uid}</span>
                      )}
                    </div>
                    {club &&
                      user &&
                      club.ownerUid === user.uid &&
                      uid !== club.ownerUid && (
                        <InlineKickButton clubId={id} targetUid={uid} />
                      )}
                  </li>
                );
              })}
            </ul>
          )}
          {!normalizedQ && hasMore && <div ref={sentinelRef} className="h-8" />}
        </Card>
      </section>
    </main>
  );
}

function InlineKickButton({
  clubId,
  targetUid,
}: {
  clubId: string;
  targetUid: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="rounded border px-2 py-1 text-xs"
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        Kick
      </button>
      <ConfirmModal
        open={open}
        title="Remove member?"
        body="This member will be removed from the club."
        confirmText="Remove"
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          if (busy) return;
          setBusy(true);
          try {
            const me = auth.currentUser?.uid;
            if (!me) return;
            await kickMemberRemote(clubId, me, targetUid);
          } finally {
            setBusy(false);
            setOpen(false);
          }
        }}
      />
    </>
  );
}
