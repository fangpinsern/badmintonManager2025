"use client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, Input } from "@/components/layout";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ConfirmModal } from "@/components/session/confirmModal";
import {
  subscribeClub,
  subscribeClubFeed,
  joinClubRemote,
  leaveClubRemote,
  addMemberByUsernameRemote,
  kickMemberRemote,
  renameClubRemote,
  suggestUsernames,
  resolveUsernamesForUids,
} from "@/lib/firestoreClubs";
import type { FirestoreClub, FirestoreClubFeed } from "@/lib/firestoreClubs";

export default function ClubDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id || "");
  const [club, setClub] = useState<FirestoreClub | null>(null);
  const [feed, setFeed] = useState<FirestoreClubFeed[]>([]);

  const [user, setUser] = useState<{
    uid: string;
    displayName?: string | null;
  } | null>(
    auth.currentUser
      ? { uid: auth.currentUser.uid, displayName: auth.currentUser.displayName }
      : null
  );
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) =>
        setUser(u ? { uid: u.uid, displayName: u.displayName } : null)
      ),
    []
  );

  const isMember = useMemo(
    () => !!club && !!user && (club.memberUids || []).includes(user.uid),
    [club, user]
  );
  const isOwner = useMemo(
    () => !!club && !!user && club.ownerUid === user.uid,
    [club, user]
  );

  const [inviteUsername, setInviteUsername] = useState("");
  const [unameQuery, setUnameQuery] = useState("");
  const [suggests, setSuggests] = useState<string[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmKickUid, setConfirmKickUid] = useState<string | null>(null);
  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;
    return subscribeClub(id, setClub);
  }, [id]);
  useEffect(() => {
    if (!id) return;
    return subscribeClubFeed(id, 50, setFeed);
  }, [id]);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const uids = (club?.memberUids || []).filter(Boolean);
      if (!uids.length) {
        setUsernameMap({});
        return;
      }
      const map = await resolveUsernamesForUids(uids);
      if (!cancelled) setUsernameMap(map);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [club?.memberUids?.join("|")]);
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      const q = (unameQuery || "").trim().toLowerCase();
      if (!q) {
        setSuggests([]);
        return;
      }
      const res = await suggestUsernames(q, 8);
      if (!cancelled) setSuggests(res);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [unameQuery]);

  if (!club) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <div className="flex items-center justify-between">
            <div className="text-gray-600">Club not found.</div>
            <Link href="/clubs" className="rounded border px-2 py-1 text-xs">
              Back
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md md:max-w-2xl lg:max-w-3xl p-4 text-sm">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{club.name}</h1>
          <div className="text-gray-600">
            {(club.memberUids || []).length} members
          </div>
        </div>
        <Link href="/clubs" className="rounded border px-2 py-1 text-xs">
          All clubs
        </Link>
      </header>

      <section className="mb-4">
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            {!user && (
              <div className="text-[11px] text-gray-600">
                Sign in to join this club.
              </div>
            )}
            {!!user && !isMember && (
              <button
                className="rounded bg-black px-3 py-2 text-xs text-white"
                onClick={async () => {
                  await joinClubRemote(club.id, user.uid);
                }}
              >
                Join club
              </button>
            )}
            {!!user && isMember && !isOwner && (
              <button
                className="rounded border px-3 py-2 text-xs"
                onClick={async () => {
                  await leaveClubRemote(club.id, user.uid);
                }}
              >
                Leave club
              </button>
            )}
            {isOwner && (
              <div className="ml-auto flex items-center gap-2">
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => {
                    setRenaming(true);
                    setNewName(club.name);
                  }}
                >
                  Rename
                </button>
                <div className="text-[11px] text-gray-600">
                  You are the owner
                </div>
              </div>
            )}
          </div>
        </Card>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Members</h2>
            {isOwner && (
              <span className="text-[11px] text-gray-500">
                owner can add/kick
              </span>
            )}
          </div>
          <ul className="mt-3 space-y-2">
            {(club.memberUids || []).map((uid) => (
              <li key={uid} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {usernameMap[uid] ? (
                      <Link
                        href={`/profile/${usernameMap[uid]}`}
                        className="text-blue-600 hover:underline"
                      >
                        @{usernameMap[uid]}
                      </Link>
                    ) : (
                      <span>@{uid}</span>
                    )}
                  </div>
                </div>
                {isOwner && uid !== club.ownerUid && (
                  <button
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => setConfirmKickUid(uid)}
                  >
                    Kick
                  </button>
                )}
              </li>
            ))}
          </ul>

          {isOwner && (
            <div className="mt-4">
              <div className="mt-2">
                <Input
                  label="Search usernames"
                  placeholder="type to search"
                  value={unameQuery}
                  onChange={(e) => setUnameQuery(e.target.value)}
                />
                {suggests.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggests.map((s) => (
                      <button
                        key={s}
                        className="rounded-full border px-2 py-0.5 text-xs"
                        onClick={async () => {
                          if (!user) return;
                          await addMemberByUsernameRemote(club.id, user.uid, s);
                          setUnameQuery("");
                          setSuggests([]);
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card className="md:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Club feed</h2>
          </div>
          <div className="mt-3 space-y-3">
            {feed.length === 0 ? (
              <div className="rounded border bg-gray-50 p-4 text-gray-600">
                No activity yet.
              </div>
            ) : (
              feed.map((f) => (
                <div key={f.id} className="rounded border p-3">
                  <div className="text-[11px] text-gray-500">
                    {(() => {
                      try {
                        const t: any = (f as any)?.createdAt;
                        const d = t?.toDate ? t.toDate() : new Date();
                        return d.toLocaleString();
                      } catch {
                        return "";
                      }
                    })()}
                  </div>
                  <div className="text-sm">{f.message}</div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      {/* Rename modal */}
      {renaming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setRenaming(false)}
          ></div>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg">
            <div className="mb-2 text-base font-semibold">Rename club</div>
            <Input
              label="New name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Saturday Smashers"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                className="rounded-xl border px-3 py-1.5 text-sm"
                onClick={() => setRenaming(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                disabled={!newName.trim() || !isOwner}
                onClick={async () => {
                  if (!user) return;
                  await renameClubRemote(club.id, user.uid, newName.trim());
                  setRenaming(false);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kick confirmation */}
      <ConfirmModal
        open={!!confirmKickUid}
        title="Remove member?"
        body="This member will be removed from the club."
        confirmText="Remove"
        onCancel={() => setConfirmKickUid(null)}
        onConfirm={async () => {
          if (!confirmKickUid || !user) return;
          await kickMemberRemote(club.id, user.uid, confirmKickUid);
          setConfirmKickUid(null);
        }}
      />
    </main>
  );
}
