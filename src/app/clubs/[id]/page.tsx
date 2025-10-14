"use client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState, useRef } from "react";
import { Card, Input } from "@/components/layout";
import LoadingScreen from "@/components/LoadingScreen";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { ConfirmModal } from "@/components/session/confirmModal";
import {
  subscribeClub,
  subscribeClubFeed,
  joinClubRemote,
  leaveClubRemote,
  renameClubRemote,
  suggestUsernames,
  resolveUsernamesForUids,
  getClubFeedPage,
  updateClubVisibilityRemote,
  addMembersByUsernamesRemote,
} from "@/lib/firestoreClubs";
import type { FirestoreClub, FirestoreClubFeed } from "@/lib/firestoreClubs";
import {
  subscribeClubSessions,
  saveSession,
  setSessionTelegramMessageId,
} from "@/lib/firestoreSessions";
import { addAndLinkPlayerByUsername } from "@/lib/firestoreSessions";
import { useStore } from "@/lib/store";
import { formatSessionTitle } from "@/lib/helper";
import type { Session } from "@/types/player";
import { createClubSessionFeedMessage } from "@/lib/firestoreClubs";
import { subscribeClubVenues, type ClubVenue } from "@/lib/firestoreClubs";
import { SessionCard as UnifiedSessionCard } from "@/components/session/SessionCard";

export default function ClubDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id || "");
  const [club, setClub] = useState<FirestoreClub | null>(null);
  const [clubReady, setClubReady] = useState(false);
  const [feed, setFeed] = useState<FirestoreClubFeed[]>([]);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedCursor, setFeedCursor] = useState<any | null>(null);
  const [feedHasMore, setFeedHasMore] = useState(true);

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

  const isMember = useMemo(
    () => !!club && !!user && (club.memberUids || []).includes(user.uid),
    [club, user]
  );
  const isOwner = useMemo(
    () => !!club && !!user && club.ownerUid === user.uid,
    [club, user]
  );

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmVisibility, setConfirmVisibility] = useState<null | {
    desired: "public" | "private";
  }>(null);
  const [confirmLeaveMe, setConfirmLeaveMe] = useState(false);
  const [clubError, setClubError] = useState<string | null>(null);
  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({});
  const [clubSessions, setClubSessions] = useState<Session[]>([]);
  const createSession = useStore((s) => s.createSession);
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [date, setDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [time, setTime] = useState<string>("19:00");
  const [numCourts, setNumCourts] = useState<string>("3");
  const [playerLimit, setPlayerLimit] = useState<string>("");
  const [venueName, setVenueName] = useState<string>("");
  const [clubVenues, setClubVenues] = useState<ClubVenue[]>([]);
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
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sentinelRef.current) return;
    const el = sentinelRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            void loadMoreFeed();
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
  }, [sentinelRef.current, feedHasMore, feedBusy]);

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
        // Gracefully surface permission errors
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

  // Subscribe to club venues for suggestions
  useEffect(() => {
    if (!id) return;
    const unsub = subscribeClubVenues(id, (v) => setClubVenues(v));
    return () => {
      try {
        unsub && (unsub as any)();
      } catch {}
    };
  }, [id]);
  // Realtime head (first page) subscription: keep latest messages fresh
  useEffect(() => {
    if (!id) return;
    if (!authReady) return;
    return subscribeClubFeed(id, 20, (items) => {
      setFeed((prev) => {
        // merge new items with existing, de-dup by id, keep order by createdAt desc
        const map = new Map<string, FirestoreClubFeed>();
        for (const it of items) map.set(it.id, it);
        for (const it of prev) if (!map.has(it.id)) map.set(it.id, it);
        return Array.from(map.values());
      });
    });
  }, [id, user]);

  // Initial page load for infinite scroll
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    async function loadFirst() {
      if (!id) return;
      setFeedBusy(true);
      try {
        const res = await getClubFeedPage(id, 20);
        if (cancelled) return;
        setFeed(res.items);
        setFeedCursor(res.cursor);
        setFeedHasMore(res.hasMore);
      } finally {
        setFeedBusy(false);
      }
    }
    loadFirst();
    return () => {
      cancelled = true;
    };
  }, [id, authReady]);

  async function loadMoreFeed() {
    if (!id) return;
    if (feedBusy || !feedHasMore) return;
    setFeedBusy(true);
    try {
      const res = await getClubFeedPage(id, 20, feedCursor);
      setFeed((prev) => {
        const map = new Map<string, FirestoreClubFeed>();
        for (const it of prev) map.set(it.id, it);
        for (const it of res.items) map.set(it.id, it);
        return Array.from(map.values());
      });
      setFeedCursor(res.cursor);
      setFeedHasMore(res.hasMore);
    } finally {
      setFeedBusy(false);
    }
  }
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
  // removed old owner search UI in favor of AddMembersModal

  if (!clubReady || !authReady) {
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
            <Link href="/clubs" className="rounded border px-2 py-1 text-xs">
              Back
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  const isPrivate = ((club as any)?.visibility || "public") === "private";
  if (isPrivate && !isMember) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <div className="flex items-center justify-between">
            <div className="text-gray-600">
              This club is private. Only members can view the details.
            </div>
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
            {(club.memberUids || []).length} members{" "}
            <Link
              href={`/clubs/${id}/members`}
              className="ml-2 underline text-xs text-blue-600"
            >
              View all members
            </Link>
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
            {!!user && !isMember && !isPrivate && (
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
              <div className="flex items-center gap-2">
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => setAddModalOpen(true)}
                >
                  Add members
                </button>
              </div>
            )}
            {isOwner && (
              <div className="ml-auto flex items-center gap-2">
                <Link
                  href={`/clubs/${id}/settings`}
                  className="rounded border px-2 py-1 text-xs"
                >
                  Settings
                </Link>
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
            {feedHasMore && <div ref={sentinelRef} className="h-8" />}
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
              <Input
                label="Venue"
                placeholder="e.g. ABC Sports Hall"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
              />
              {(() => {
                const q = (venueName || "").trim().toLowerCase();
                const list = (clubVenues || [])
                  .filter((v) =>
                    q
                      ? String(v.name || "")
                          .toLowerCase()
                          .includes(q)
                      : true
                  )
                  .slice(0, 8);
                if (!list.length) return null;
                return (
                  <div className="flex flex-wrap gap-2">
                    {list.map((v) => {
                      const selected =
                        v.name.trim().toLowerCase() === q && q.length > 0;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setVenueName(v.name)}
                          className={`rounded-full border px-2 py-0.5 text-xs ${
                            selected ? "border-blue-300 bg-blue-50" : ""
                          }`}
                          title={selected ? "Selected" : "Use this venue"}
                          aria-pressed={selected}
                        >
                          {v.name}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
              <Input
                type="number"
                label="Player limit (optional)"
                min={1}
                inputMode="numeric"
                placeholder="e.g. 24"
                value={playerLimit}
                onChange={(e) => setPlayerLimit(e.target.value)}
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
                  className="rounded-xl border px-3 py-1.5 text-sm disabled:opacity-50"
                  disabled={creatingBusy}
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
                <button
                  className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  disabled={creatingBusy}
                  onClick={async () => {
                    if (creatingBusy) return;
                    setCreatingBusy(true);
                    const desired = Math.max(1, Number(numCourts || 1));
                    if (desired > 10) {
                      setError("Courts per session are limited to 10.");
                      setCreatingBusy(false);
                      return;
                    }
                    setError(null);
                    const idCreated = createSession({
                      date,
                      time,
                      numCourts: desired,
                      clubId: id,
                      venue: (() => {
                        const n = (venueName || "").trim();
                        if (!n) return undefined;
                        // Best-effort: attach venue id if an exact match exists in club venues
                        const match = (clubVenues || []).find(
                          (v) =>
                            (v.name || "").trim().toLowerCase() ===
                            n.toLowerCase()
                        );
                        return match
                          ? {
                              id: match.id,
                              name: match.name,
                              location:
                                match.location &&
                                typeof match.location.lat === "number" &&
                                typeof match.location.lng === "number"
                                  ? {
                                      lat: match.location.lat,
                                      lng: match.location.lng,
                                      address:
                                        (match.location.address || "").trim() ||
                                        undefined,
                                      placeId:
                                        (match.location.placeId || "").trim() ||
                                        undefined,
                                    }
                                  : undefined,
                            }
                          : { name: n };
                      })(),
                      playerLimit: (() => {
                        const num = Number(playerLimit);
                        return Number.isFinite(num) && num > 0
                          ? Math.floor(num)
                          : undefined;
                      })(),
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
                                // Do not trigger join update during creation; initial participants are included in original message
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
                        // Send minimal event for session_created; worker renders content securely
                        try {
                          const endpoint = process.env
                            .NEXT_PUBLIC_WORKER_BASE_URL
                            ? `${process.env.NEXT_PUBLIC_WORKER_BASE_URL}/telegram/send`
                            : "/api/telegram/send";
                          const resp = await fetch(endpoint, {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              clubId: id,
                              type: "session_created",
                              organizerUid: user.uid,
                              sessionId: idCreated,
                            }),
                          });
                          if (resp.ok) {
                            let mid: number | undefined;
                            try {
                              const j = await resp.json();
                              mid = j?.message_id;
                            } catch {}
                            if (mid) {
                              // attach telegramMessageId minimally to avoid dropping late-added players
                              try {
                                await setSessionTelegramMessageId(
                                  idCreated,
                                  mid
                                );
                              } catch (e) {
                                console.error("Error tagging telegram id", e);
                              }
                            }
                          }
                        } catch (e) {
                          console.log("telegram notify error", e);
                        }
                      }
                    } catch (e) {
                      console.error("Error creating session", e);
                    }
                    setCreating(false);
                    setCreatingBusy(false);
                    router.push(`/session/${idCreated}`);
                  }}
                >
                  {creatingBusy ? "Creating…" : "Create"}
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

      {/* Visibility confirm */}
      <ConfirmModal
        open={!!confirmVisibility}
        title="Change visibility?"
        body={
          confirmVisibility?.desired === "private"
            ? "Switch to private: only members can view details and join is disabled. Proceed?"
            : "Switch to public: anyone can view details and can join. Proceed?"
        }
        confirmText="Confirm"
        onCancel={() => setConfirmVisibility(null)}
        onConfirm={async () => {
          if (!confirmVisibility?.desired || !user) return;
          await updateClubVisibilityRemote(
            club.id,
            user.uid,
            confirmVisibility.desired
          );
          setConfirmVisibility(null);
        }}
      />

      {/* Add members modal */}
      <AddMembersModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onConfirm={async (selected) => {
          if (!user || !selected.length) return;
          try {
            await addMembersByUsernamesRemote(club.id, user.uid, selected);
          } finally {
            setAddModalOpen(false);
          }
        }}
        existingUsernames={Object.values(usernameMap).filter(Boolean)}
      />

      {/* Kick confirmation moved to Members page */}

      {/* Leave confirmation (self) */}
      <ConfirmModal
        open={confirmLeaveMe}
        title="Leave club?"
        body="You will be removed from this club."
        confirmText="Leave"
        onCancel={() => setConfirmLeaveMe(false)}
        onConfirm={async () => {
          if (!user) return;
          await leaveClubRemote(club.id, user.uid);
          setConfirmLeaveMe(false);
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
              variant="compact"
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

export const runtime = "edge";

function VisibilitySwitch({
  isPrivate,
  onSelect,
}: {
  isPrivate: boolean;
  onSelect: (desired: "public" | "private") => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-[11px] text-gray-600">Visibility</div>
      <div className="relative inline-flex h-8 items-center rounded-full border px-1">
        <button
          className={`rounded-full px-3 py-1 text-xs ${
            !isPrivate ? "bg-blue-600 text-white" : "text-gray-700"
          }`}
          onClick={() => {
            if (isPrivate) onSelect("public");
          }}
        >
          Public
        </button>
        <button
          className={`rounded-full px-3 py-1 text-xs ${
            isPrivate ? "bg-gray-900 text-white" : "text-gray-700"
          }`}
          onClick={() => {
            if (!isPrivate) onSelect("private");
          }}
        >
          Private
        </button>
      </div>
    </div>
  );
}

function AddMembersModal({
  open,
  onClose,
  onConfirm,
  existingUsernames,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (usernames: string[]) => void | Promise<void>;
  existingUsernames: string[];
}) {
  const [query, setQuery] = useState("");
  const [suggests, setSuggests] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const existing = useMemo(
    () => new Set(existingUsernames || []),
    [existingUsernames]
  );

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      const q = (query || "").trim().toLowerCase();
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
  }, [query]);

  function toggleSelect(uname: string) {
    const u = (uname || "").trim().toLowerCase();
    if (!u) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u);
      else next.add(u);
      return next;
    });
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose}></div>
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg">
        <div className="mb-2 text-base font-semibold">Add members</div>
        <Input
          label="Search usernames"
          placeholder="type to search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {suggests.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {suggests.map((s) => {
              const disabled = existing.has(s);
              const isSel = selected.has(s);
              return (
                <button
                  key={s}
                  disabled={disabled}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    disabled
                      ? "opacity-50"
                      : isSel
                      ? "border-blue-300 bg-blue-50"
                      : ""
                  }`}
                  onClick={() => toggleSelect(s)}
                >
                  {disabled ? `${s} (member)` : s}
                </button>
              );
            })}
          </div>
        )}
        {selected.size > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs text-gray-600">Selected</div>
            <div className="flex flex-wrap gap-2">
              {Array.from(selected).map((s) => (
                <button
                  key={s}
                  className="rounded-full border px-2 py-0.5 text-xs"
                  onClick={() => toggleSelect(s)}
                >
                  {s} ×
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            className="rounded-xl border px-3 py-1.5 text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
            disabled={busy || selected.size === 0}
            onClick={async () => {
              try {
                setBusy(true);
                await onConfirm(Array.from(selected));
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
