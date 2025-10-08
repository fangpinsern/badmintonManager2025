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
import { subscribeClubSessions, saveSession } from "@/lib/firestoreSessions";
import { addAndLinkPlayerByUsername } from "@/lib/firestoreSessions";
import { useStore } from "@/lib/store";
import { formatSessionTitle } from "@/lib/helper";
import type { Session } from "@/types/player";
import { createClubSessionFeedMessage } from "@/lib/firestoreClubs";
import { SessionCard as UnifiedSessionCard } from "@/components/session/SessionCard";

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
  const [clubSessions, setClubSessions] = useState<Session[]>([]);
  const createSession = useStore((s) => s.createSession);
  const [creating, setCreating] = useState(false);
  const [date, setDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [time, setTime] = useState<string>("19:00");
  const [numCourts, setNumCourts] = useState<string>("3");
  const [error, setError] = useState<string | null>(null);
  const [selectedMemberUids, setSelectedMemberUids] = useState<Set<string>>(
    new Set()
  );
  const toggleSelectMember = (uid: string) => {
    setSelectedMemberUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  useEffect(() => {
    if (!id) return;
    return subscribeClub(id, setClub);
  }, [id]);
  useEffect(() => {
    if (!id) return;
    return subscribeClubFeed(id, 50, setFeed);
  }, [id]);
  useEffect(() => {
    if (!id) return;
    const unsub = subscribeClubSessions(id, (docs) => {
      const mapped: Session[] = docs.map((d: any) => {
        const payload = (d.doc as any)?.payload as Session;
        const sess = { ...payload, storage: "remote" } as Session;
        try {
          const w: any = window as any;
          w.__sessionOwners = w.__sessionOwners || new Map<string, string>();
          w.__sessionOwners.set(sess.id, d.organizerUid);
        } catch {}
        return sess;
      });
      // sort newest first by date/time
      const toTs = (s: Session) =>
        new Date(`${s.date}T${s.time ?? "00:00"}`).getTime();
      setClubSessions([...mapped].sort((a, b) => toTs(b) - toTs(a)));
    });
    return () => unsub();
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

      {/* Club sessions */}
      <section className="mb-4">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold">Sessions</h2>
            {!!user && isMember && (
              <button
                className="rounded border px-2 py-1 text-xs"
                onClick={() => setCreating(true)}
              >
                New session +
              </button>
            )}
          </div>
          {(() => {
            const upcoming = clubSessions.filter((s) => !s.ended);
            const closed = clubSessions.filter((s) => !!s.ended);
            return <ClubSessionTabs upcoming={upcoming} closed={closed} />;
          })()}
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
                  <div className="text-sm">
                    {f.type === "session" && f.sessionId ? (
                      <Link
                        href={`/session/${f.sessionId}`}
                        className="text-blue-600 hover:underline"
                      >
                        {f.message}
                      </Link>
                    ) : (
                      f.message
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      {/* Rename modal */}
      {/* Create session modal */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setCreating(false)}
          ></div>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg">
            <div className="mb-2 text-base font-semibold">Create session</div>
            <div className="grid grid-cols-1 gap-3">
              <Input
                type="date"
                label="Date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <Input
                type="time"
                label="Time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
              <Input
                type="number"
                label="# of courts"
                min={1}
                inputMode="numeric"
                value={numCourts}
                onChange={(e) => setNumCourts(e.target.value)}
              />
              <div className="mt-1">
                <div className="mb-1 text-xs text-gray-600">
                  Add specific members (optional)
                </div>
                <div className="max-h-40 overflow-auto rounded border p-2 text-sm">
                  {(club?.memberUids || []).map((uid) => (
                    <label key={uid} className="flex items-center gap-2 py-0.5">
                      <input
                        type="checkbox"
                        checked={selectedMemberUids.has(uid)}
                        onChange={() => toggleSelectMember(uid)}
                      />
                      <span className="truncate">
                        @{usernameMap[uid] || uid}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-1 text-[11px] text-gray-500">
                  Selected: {selectedMemberUids.size}
                </div>
              </div>
              {error && <div className="text-xs text-red-600">{error}</div>}
              <div className="mt-1 flex items-center justify-end gap-2">
                <button
                  className="rounded-xl border px-3 py-1.5 text-sm"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
                <button
                  className="rounded-xl bg-black px-3 py-1.5 text-sm text-white"
                  onClick={async () => {
                    const desired = Math.max(1, Number(numCourts || 1));
                    if (desired > 10) {
                      setError("Courts per session are limited to 10.");
                      return;
                    }
                    setError(null);
                    const idCreated = createSession({
                      date,
                      time,
                      numCourts: desired,
                      clubId: id,
                    });
                    try {
                      // Create a feed message and tag the session payload with the message id
                      if (user?.uid) {
                        const when = `${date} ${time}`;
                        const message = `Session created by @${
                          usernameMap[user.uid] || user.uid
                        } · ${when}`;
                        const ext = {
                          organizerUid: user.uid,
                          sessionId: idCreated,
                          date,
                          time,
                          numCourts: desired,
                          selectedMembers: Array.from(selectedMemberUids).map(
                            (u) => usernameMap[u] || u
                          ),
                        };
                        const msgId = await createClubSessionFeedMessage(
                          id,
                          user.uid,
                          idCreated,
                          { message, ext }
                        );
                        // tag session in Firestore with clubFeedMessageId
                        const current = (
                          useStore.getState().sessions || []
                        ).find((s) => s.id === idCreated);
                        if (current) {
                          const withTag = {
                            ...current,
                            clubFeedMessageId: msgId,
                          };
                          await saveSession(idCreated, withTag);
                        }
                        console.log("selectedMemberUids", selectedMemberUids);
                        // optionally add selected members and link them to accounts
                        if (selectedMemberUids.size) {
                          try {
                            const owner = user.uid;
                            for (const uidSel of Array.from(
                              selectedMemberUids
                            )) {
                              console.log("uidSel", uidSel, usernameMap);
                              const uname = (usernameMap[uidSel] || "")
                                .trim()
                                .toLowerCase();
                              if (!uname) {
                                console.log(
                                  "No uname",
                                  uname,
                                  usernameMap,
                                  uidSel
                                );
                                continue;
                              }
                              try {
                                console.log(
                                  "Adding user",
                                  owner,
                                  idCreated,
                                  uname
                                );
                                await addAndLinkPlayerByUsername(
                                  owner,
                                  idCreated,
                                  uname
                                );
                              } catch (e) {
                                console.error("Error creating user", e);
                              }
                            }
                            // const latest = (
                            //   useStore.getState().sessions || []
                            // ).find((s) => s.id === idCreated);
                            // if (latest) await saveSession(idCreated, latest);
                          } catch (e) {
                            console.error("Error creating session", e);
                          }
                        }
                      }
                    } catch (e) {
                      console.error("Error creating session", e);
                    }
                    setCreating(false);
                    router.push(`/session/${idCreated}`);
                  }}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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

function ClubSessionTabs({
  upcoming,
  closed,
}: {
  upcoming: Session[];
  closed: Session[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"upcoming" | "closed">("upcoming");
  const [upShown, setUpShown] = useState<number>(10);
  const [clShown, setClShown] = useState<number>(10);
  const me = auth.currentUser?.uid || null;
  const nowIsoDate = new Date().toISOString().slice(0, 10);
  const list = tab === "upcoming" ? upcoming : closed;
  const shown = tab === "upcoming" ? upShown : clShown;
  const canSeeMore = list.length > shown;
  const display = list.slice(0, shown);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => setTab("upcoming")}
          className={`rounded-xl border px-3 py-1.5 text-xs ${
            tab === "upcoming"
              ? "border-blue-300 bg-blue-50 text-blue-700"
              : "border-gray-300"
          }`}
        >
          Upcoming
        </button>
        <button
          onClick={() => setTab("closed")}
          className={`rounded-xl border px-3 py-1.5 text-xs ${
            tab === "closed"
              ? "border-gray-400 bg-gray-100 text-gray-700"
              : "border-gray-300"
          }`}
        >
          Closed
        </button>
      </div>
      {display.length === 0 ? (
        <div className="rounded border bg-gray-50 p-4 text-gray-600">
          No {tab} sessions.
        </div>
      ) : (
        display.map((ss) => (
          <div key={ss.id} className="mb-3 last:mb-0">
            <UnifiedSessionCard
              session={ss}
              onOpen={(id) => router.push(`/session/${id}`)}
            />
          </div>
        ))
      )}
      {canSeeMore && (
        <div className="mt-2 flex justify-center">
          <button
            className="rounded-xl border px-3 py-1.5 text-xs"
            onClick={() =>
              tab === "upcoming"
                ? setUpShown((n) => n + 10)
                : setClShown((n) => n + 10)
            }
          >
            See more
          </button>
        </div>
      )}
    </div>
  );
}
