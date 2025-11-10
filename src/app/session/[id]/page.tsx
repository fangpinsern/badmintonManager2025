"use client";
import { Session } from "@/types/player";
import { Player } from "@/types/player";
import { auth } from "@/lib/firebase";
import { useStore } from "@/lib/store";
import { useState, useMemo, useEffect, useRef } from "react";
import { Card } from "@/components/layout";
import { formatSessionTitle } from "@/lib/helper";
import { AutoAssignSettingsButton } from "@/components/session/autoAssignSettingsButton";
import { formatDuration } from "@/lib/helper";
import { ShareClaimsButton } from "@/components/session/rowKebabMenu";
import { EndSessionModal } from "@/components/session/endSessionModal";
import { AddCourtButton } from "@/components/session/addCourtButton";
import { CourtCard } from "@/components/session/courtCard";
import { GameEditModal } from "@/components/session/gameEditModal";
import { ConfirmModal } from "@/components/session/confirmModal";
import LoadingScreen from "@/components/LoadingScreen";
import Link from "next/link";
import { toUsernameSlug } from "@/lib/helper";
import UsernameModal from "@/components/UsernameModal";
import { Select } from "@/components/layout";
import { RowKebabMenu } from "@/components/session/rowKebabMenu";
import { Input } from "@/components/layout";
import { Label } from "@/components/layout";
import { downloadSessionJson, getPlayerCourtIndex } from "@/lib/helper";
import { triggerStatsRecalc, recordStatsRecalcFailure } from "@/lib/stats";
import { resolveUsernames } from "@/lib/statsClient";
import {
  saveSession,
  saveSessionOnBehalf,
  subscribeSessionById,
  subscribeUserProfile,
  claimUsername,
  addAndLinkPlayerByUsername,
} from "@/lib/firestoreSessions";
import { subscribeMyClubs } from "@/lib/firestoreClubs";
import {
  subscribeClubVenues,
  type ClubVenue,
  type FirestoreClub,
} from "@/lib/firestoreClubs";
import { subscribeClubSessions } from "@/lib/firestoreSessions";
import {
  useParams,
  useRouter,
  usePathname,
  useSearchParams,
} from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { Suspense } from "react";

function SessionManager({ onBack }: { onBack: () => void }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const addPlayer = useStore((s) => s.addPlayer);
  const addPlayersBulk = useStore((s) => s.addPlayersBulk);
  const removePlayer = useStore((s) => s.removePlayer);
  const linkPlayerToAccount = useStore((s) => s.linkPlayerToAccount);
  const assign = useStore((s) => s.assignPlayerToCourt);
  const endSession = useStore((s) => s.endSession);

  // Live Firestore session state
  const [session, setSession] = useState<Session | null>(null);
  const [organizerUid, setOrganizerUid] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [user, setUser] = useState<{
    uid: string;
    displayName?: string | null;
  } | null>(
    auth.currentUser
      ? { uid: auth.currentUser.uid, displayName: auth.currentUser.displayName }
      : null
  );
  const [authReady, setAuthReady] = useState<boolean>(!!auth.currentUser);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [myUsername, setMyUsername] = useState<string>("");
  const [myClubIds, setMyClubIds] = useState<string[]>([]);
  const [myClubs, setMyClubs] = useState<FirestoreClub[]>([]);
  const [clubIdForViewing, setClubIdForViewing] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const updateSessionMeta = useStore((s) => (s as any).updateSessionMeta);
  const [settingsPlayerLimit, setSettingsPlayerLimit] = useState<string>("");
  const [settingsVenueName, setSettingsVenueName] = useState<string>("");
  const [settingsDate, setSettingsDate] = useState<string>("");
  const [settingsTime, setSettingsTime] = useState<string>("");
  const [clubVenues, setClubVenues] = useState<ClubVenue[]>([]);
  const [clubLinkOpen, setClubLinkOpen] = useState(false);
  const [selectedClubId, setSelectedClubId] = useState<string>("");
  const [removeClubOpen, setRemoveClubOpen] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid, displayName: u.displayName } : null);
      //   u?.getIdToken().then((token) => {
      //     console.log("token", token);
      //   });
      setAuthReady(true);
    });
  }, []);

  // Subscribe to profile to check username
  useEffect(() => {
    if (!user) {
      setNeedsUsername(false);
      setMyUsername("");
      return;
    }
    const unsub = subscribeUserProfile(user.uid, (p) => {
      const has = p && typeof p.username === "string" && p.username.trim();
      setNeedsUsername(!has);
      setMyUsername(has ? String(p.username).trim().toLowerCase() : "");
    });
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    const currentUid = user?.uid || null;
    if (!id || !currentUid) return;
    const cleanup = subscribeSessionById(currentUid, id, (info) => {
      if (!info) {
        setNotFound(true);
        setSession(null);
        return;
      }
      setOrganizerUid(info.organizerUid);
      const payload = (info.doc.payload || {}) as Session;
      const live = { ...payload, storage: "remote" } as Session;
      setSession(live);
      try {
        lastSavedRef.current = JSON.stringify(live);
      } catch {}
      try {
        const current = useStore.getState().sessions || [];
        const map = new Map(current.map((s) => [s.id, s] as const));
        map.set(live.id, live);
        useStore.setState({ sessions: Array.from(map.values()) });
        const w: any = window as any;
        w.__sessionOwners = w.__sessionOwners || new Map<string, string>();
        w.__sessionOwners.set(live.id, info.organizerUid);
      } catch {}
    });
    return () => cleanup();
  }, [id, user?.uid]);

  // Fallback: if the session isn't accessible via own/linked sessions,
  // but the user is a member of a club that sanctioned this session,
  // allow read-only viewing by resolving via the club sessions index.
  useEffect(() => {
    if (!id || !user?.uid) return;
    // Track club membership
    const unsubClubs = subscribeMyClubs(user.uid, (clubs) => {
      setMyClubs(clubs || []);
      setMyClubIds((clubs || []).map((c) => c.id));
    });
    return () => {
      unsubClubs();
    };
  }, [id, user?.uid]);

  useEffect(() => {
    // Only attempt fallback if we don't yet have a session loaded
    if (!id || !user?.uid) return;
    if (session) return;
    if (!myClubIds.length) return;
    let cancelled = false;
    const unsubs: (() => void)[] = [];
    // Subscribe to each club's sessions and look for this session id
    for (const cid of myClubIds) {
      const unsub = subscribeClubSessions(cid, (entries) => {
        if (cancelled) return;
        const found = (entries || []).find((e) => {
          try {
            return (e?.doc as any)?.id === id;
          } catch {
            return false;
          }
        });
        if (found && (found as any).doc && (found as any).organizerUid) {
          try {
            const payload =
              (((found as any).doc.payload || {}) as Session) || null;
            if (!payload) return;
            const live = { ...payload, storage: "remote" } as Session;
            setSession(live);
            setOrganizerUid((found as any).organizerUid as string);
            setClubIdForViewing(cid);
            setNotFound(false);
            try {
              const w: any = window as any;
              w.__sessionOwners =
                w.__sessionOwners || new Map<string, string>();
              w.__sessionOwners.set(
                live.id,
                (found as any).organizerUid as string
              );
            } catch {}
          } catch {}
        }
      });
      unsubs.push(unsub);
    }
    return () => {
      cancelled = true;
      for (const u of unsubs)
        try {
          u();
        } catch {}
    };
  }, [id, user?.uid, myClubIds, session]);

  // Subscribe to venues when we know the club id of the session, for suggestions in settings modal
  useEffect(() => {
    const cid = (session && (session as any).clubId) || clubIdForViewing;
    if (!cid) return;
    const unsub = subscribeClubVenues(String(cid), (v) => setClubVenues(v));
    return () => {
      try {
        unsub && (unsub as any)();
      } catch {}
    };
  }, [session?.clubId, clubIdForViewing]);

  // Save organizer-owned session updates (from store) back to Firestore
  const storeSession = useStore((s) =>
    id ? s.sessions.find((ss) => ss.id === id) || null : null
  );
  const lastSavedRef = useRef<string | null>(null);
  const isOrganizer = !!(
    auth.currentUser?.uid &&
    organizerUid &&
    auth.currentUser.uid === organizerUid
  );
  const isCoOrganizer = useMemo(() => {
    const uid = auth.currentUser?.uid || null;
    if (!uid || !session) return false;
    return Array.isArray(session.coOrganizerUids)
      ? session.coOrganizerUids.includes(uid)
      : false;
  }, [session, auth.currentUser?.uid]);
  const canManage = isOrganizer || isCoOrganizer;

  useEffect(() => {
    if (!storeSession) return;
    try {
      const serialized = JSON.stringify(storeSession);
      if (lastSavedRef.current !== serialized) {
        lastSavedRef.current = serialized;
        if (isOrganizer) {
          void saveSession(storeSession.id, storeSession);
        } else if (isCoOrganizer && organizerUid) {
          void saveSessionOnBehalf(organizerUid, storeSession.id, storeSession);
        }
      }
    } catch {}
  }, [isOrganizer, isCoOrganizer, organizerUid, storeSession]);

  const [name, setName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [gender, setGender] = useState<"M" | "F" | "">("");
  const [bulkError, setBulkError] = useState<string>("");
  const [bulkText, setBulkText] = useState("");
  const [usernameToAdd, setUsernameToAdd] = useState("");
  const [usernameAddBusy, setUsernameAddBusy] = useState(false);
  const [usernameAddError, setUsernameAddError] = useState<string>("");
  const [showAddByUsername, setShowAddByUsername] = useState(false);
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const suggestTimerRef = useRef<number | null>(null);
  // Username flow removed

  const occupancy = useMemo(() => {
    if (!session) return [] as number[];
    return session.courts.map((c) => c.playerIds.length);
  }, [session]);

  const unassigned = useMemo(() => {
    if (!session) return [] as Player[];
    const setAssigned = new Set(session.courts.flatMap((c) => c.playerIds));
    return session.players.filter((p) => !setAssigned.has(p.id));
  }, [session]);

  const anyInProgress = useMemo(() => {
    if (!session) return false;
    return session.courts.some((c) => c.inProgress);
  }, [session]);
  const [endOpen, setEndOpen] = useState(false);
  const [endShuttles, setEndShuttles] = useState<string>("0");
  const [endCourtCost, setEndCourtCost] = useState<string>("0");
  const [endShuttleCostMoney, setEndShuttleCostMoney] = useState<string>("0");
  const [endRequestPayment, setEndRequestPayment] = useState<boolean>(false);
  const [editGameId, setEditGameId] = useState<string | null>(null);
  const [gamesFilter, setGamesFilter] = useState<string>("");
  const [gamesPage, setGamesPage] = useState<number>(1); // 10 per page
  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({});

  // Drag-and-drop removed; assignments are via dropdowns only

  const inGameIdSet = useMemo(() => {
    const set = new Set<string>();
    if (!session) return set;
    for (const c of session.courts) {
      if (!c.inProgress) continue;
      for (const pid of c.playerIds) set.add(pid);
    }
    return set;
  }, [session]);

  // Resolve usernames for linked players so we can link to profiles.
  // Prefer cached accountUsername on the player, and only resolve by UID for those missing.
  useEffect(() => {
    if (!session) {
      setUsernameMap({});
      return;
    }
    // prefill from cached usernames on players
    const prefilled: Record<string, string> = {};
    const missingUids: string[] = [];
    for (const pl of session.players || []) {
      if (pl && pl.accountUid) {
        if (pl.accountUsername) {
          prefilled[pl.accountUid] = pl.accountUsername;
        } else {
          missingUids.push(pl.accountUid);
        }
      }
    }
    if (!missingUids.length) {
      setUsernameMap(prefilled);
      setUsernameMap({});
      return;
    }
    (async () => {
      try {
        const map = await resolveUsernames(Array.from(new Set(missingUids)));
        setUsernameMap({ ...prefilled, ...(map || {}) });
      } catch {
        setUsernameMap(prefilled);
      }
    })();
  }, [session]);

  const sortedPlayers = useMemo(() => {
    if (!session) return [] as Player[];
    const base = session.players;
    const clone = [...base];
    clone.sort((a, b) => {
      const aIn = inGameIdSet.has(a.id);
      const bIn = inGameIdSet.has(b.id);
      if (aIn !== bIn) return aIn ? 1 : -1; // in-game at bottom
      const aGames = a.gamesPlayed ?? 0;
      const bGames = b.gamesPlayed ?? 0;
      if (aGames !== bGames) return aGames - bGames; // least to most
      return a.name.localeCompare(b.name);
    });
    return clone;
  }, [session, inGameIdSet]);

  const filteredGames = useMemo(() => {
    const all = (session && session.games) || [];
    if (!gamesFilter) return all as any[];
    return (all as any[]).filter(
      (g) => g.sideA.includes(gamesFilter) || g.sideB.includes(gamesFilter)
    );
  }, [session, gamesFilter]);
  const pageSize = 10;
  const pagedGames = useMemo(() => {
    const start = 0;
    const end = gamesPage * pageSize;
    return filteredGames.slice(start, end);
  }, [filteredGames, gamesPage]);

  // Username search/add removed

  // When the signed-in user is already linked to a player in this session,
  // hide "Link to me" on other players.
  const myUid = auth.currentUser?.uid || null;
  const alreadyLinkedToMe = useMemo(() => {
    return !!(
      myUid &&
      session &&
      session.players.some((p) => p.accountUid === myUid)
    );
  }, [session, myUid]);

  const isMemberOfSessionClub = useMemo(() => {
    const cid = (session && (session as any).clubId) || clubIdForViewing;
    if (!cid) return false;
    return myClubIds.includes(String(cid));
  }, [session, clubIdForViewing, myClubIds]);

  const canShowJoin = useMemo(() => {
    return (
      !!session &&
      !session.ended &&
      !alreadyLinkedToMe &&
      !canManage &&
      isMemberOfSessionClub &&
      !!myUsername
    );
  }, [
    session,
    alreadyLinkedToMe,
    canManage,
    isMemberOfSessionClub,
    myUsername,
  ]);

  if (notFound) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          aria-label="back-to-list"
          className="text-sm text-gray-600"
        >
          ← Back
        </button>
        <Card>
          <div className="text-sm text-gray-600">Session not found.</div>
        </Card>
      </div>
    );
  }
  if (!authReady) {
    return <LoadingScreen message="Loading…" />;
  }
  if (authReady && !user) {
    // Redirect to central auth page with returnTo set to the current URL
    const qs = sp?.toString() || "";
    const current = `${pathname}${qs ? `?${qs}` : ""}`;
    try {
      router.replace(`/auth?returnTo=${encodeURIComponent(current)}`);
    } catch {}
    return <LoadingScreen message="Loading…" />;
  }
  if (!session) {
    return <LoadingScreen message="Loading…" />;
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    if (!name.trim()) return;
    // Temporary: use bulk API to inject gender until single add supports signature change
    if (gender) {
      addPlayersBulk(session.id, [`${name.trim()}, ${gender}`]);
    } else {
      addPlayer(session.id, name.trim());
    }
    setName("");
    setGender("");
  }

  function addBulk(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    const raw = bulkText || "";
    const parts = raw
      .split(/\n/g)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    // Validate genders first
    for (const line of parts) {
      const tokens = line
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (tokens.length >= 2) {
        const g = tokens[1].toUpperCase();
        if (!(g === "M" || g === "F")) {
          setBulkError(
            `Invalid gender "${tokens[1]}" on line: "${line}". Use M or F.`
          );
          return;
        }
      }
    }
    addPlayersBulk(session.id, parts);
    setBulkText("");
    setBulkError("");
    setBulkOpen(false);
  }

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        aria-label="back-to-list"
        className="text-sm text-gray-600"
      >
        ← Back
      </button>
      <Card>
        {needsUsername && (
          <UsernameModal
            open={true}
            onClose={() => {}}
            onSubmit={async (uname) => {
              if (user) await claimUsername(user.uid, uname);
            }}
            canCancel={false}
          />
        )}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {formatSessionTitle(session)}
            </h2>
            <p className="text-xs text-gray-500">
              {(session.courts || []).length} court
              {(session.courts || []).length > 1 ? "s" : ""} ·{" "}
              {
                (session.courts || []).filter(
                  (c) => (c.mode || "doubles") === "doubles"
                ).length
              }{" "}
              doubles,{" "}
              {
                (session.courts || []).filter(
                  (c) => (c.mode || "doubles") === "singles"
                ).length
              }{" "}
              singles
            </p>
            {session.ended && (
              <div className="mt-1 text-[11px] text-emerald-700">
                Ended
                {session.endedAt
                  ? ` · ${new Date(session.endedAt).toLocaleString()}`
                  : ""}
              </div>
            )}
          </div>
          {!session.ended && (
            <div className="flex items-center gap-2">
              {canManage && <AutoAssignSettingsButton session={session} />}
              {canManage && (
                <button
                  onClick={() => {
                    setSettingsOpen(true);
                    // hydrate current values when opening modal
                    const v = session.playerLimit;
                    setSettingsPlayerLimit(
                      typeof v === "number" && v > 0 ? String(v) : ""
                    );
                    setSettingsDate(String(session.date || ""));
                    setSettingsTime(String(session.time || ""));
                  }}
                  title="Session settings"
                  aria-label="Session settings"
                  className="rounded-xl border px-2 py-1.5"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h0A1.65 1.65 0 0010 4.09V4a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0A1.65 1.65 0 0019.91 10H20a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                  </svg>
                </button>
              )}
              {isOrganizer && (
                <button
                  onClick={() => {
                    setEndOpen(true);
                    setEndShuttles("0");
                  }}
                  disabled={anyInProgress}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700 disabled:opacity-50"
                >
                  End session
                </button>
              )}
              {canShowJoin &&
                (() => {
                  const isFull =
                    typeof session.playerLimit === "number" &&
                    session.playerLimit > 0 &&
                    session.players.length >= session.playerLimit;
                  return (
                    <>
                      <button
                        onClick={async () => {
                          setJoinError("");
                          if (!myUsername) {
                            setJoinError("Please set a username first");
                            return;
                          }
                          // Enforce player limit if present
                          if (
                            typeof session.playerLimit === "number" &&
                            session.playerLimit > 0 &&
                            session.players.length >= session.playerLimit
                          ) {
                            setJoinError("Session is full");
                            return;
                          }
                          const owner =
                            organizerUid ||
                            (window as any).__sessionOwners?.get?.(
                              session.id
                            ) ||
                            auth.currentUser?.uid;
                          if (!owner) {
                            setJoinError("Organizer not resolved yet");
                            return;
                          }
                          setJoinBusy(true);
                          try {
                            await addAndLinkPlayerByUsername(
                              owner,
                              session.id,
                              myUsername
                            );
                            // Best-effort: trigger Telegram participant list update only for club sessions
                            try {
                              if (session && (session as any)?.clubId) {
                                const endpoint = process.env
                                  .NEXT_PUBLIC_WORKER_BASE_URL
                                  ? `${process.env.NEXT_PUBLIC_WORKER_BASE_URL}/telegram/send`
                                  : "/api/telegram/send";
                                await fetch(endpoint, {
                                  method: "POST",
                                  headers: {
                                    "content-type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    clubId: String((session as any).clubId),
                                    type: "session_joined",
                                    organizerUid: owner,
                                    sessionId: session.id,
                                  }),
                                });
                              }
                            } catch (e) {
                              console.error(
                                "Error sending Telegram session joined event",
                                e
                              );
                            }
                          } catch (e: any) {
                            setJoinError(
                              e?.message || "Failed to join session"
                            );
                          } finally {
                            setJoinBusy(false);
                          }
                        }}
                        disabled={joinBusy || isFull}
                        className="rounded-xl bg-black px-3 py-1.5 text-xs text-white disabled:opacity-50"
                      >
                        {joinBusy ? "Joining…" : "Join session"}
                      </button>
                      {isFull && (
                        <span className="text-[11px] text-gray-600">
                          Session is full
                        </span>
                      )}
                    </>
                  );
                })()}
            </div>
          )}
        </div>
      </Card>
      {settingsOpen && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSettingsOpen(false)}
          ></div>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg">
            <div className="mb-2 text-base font-semibold">Session settings</div>
            <div className="space-y-2">
              <Input
                type="date"
                label="Date"
                value={settingsDate}
                onChange={(e) => setSettingsDate(e.target.value)}
              />
              <Input
                type="time"
                label="Time"
                value={settingsTime}
                onChange={(e) => setSettingsTime(e.target.value)}
              />
              <Input
                type="number"
                label="Player limit"
                placeholder="leave empty for no limit"
                min={1}
                inputMode="numeric"
                value={settingsPlayerLimit}
                onChange={(e) => setSettingsPlayerLimit(e.target.value)}
              />
              <Input
                label="Venue"
                placeholder="e.g. ABC Sports Hall"
                value={settingsVenueName}
                onChange={(e) => setSettingsVenueName(e.target.value)}
              />
              {(() => {
                const q = (settingsVenueName || "").trim().toLowerCase();
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
                          onClick={() => setSettingsVenueName(v.name)}
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
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                className="rounded-xl border px-3 py-1.5 text-sm"
                onClick={() => setSettingsOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-black px-3 py-1.5 text-sm text-white"
                onClick={async () => {
                  const raw = (settingsPlayerLimit || "").trim();
                  const num = Number(raw);
                  const next =
                    raw && Number.isFinite(num) && num > 0
                      ? Math.floor(num)
                      : undefined;
                  const venueName = (settingsVenueName || "").trim();
                  // pass only valid date/time if provided
                  const dateStr = (settingsDate || "").trim();
                  const timeStr = (settingsTime || "").trim();
                  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
                  const timeValid = /^\d{2}:\d{2}$/.test(timeStr);
                  updateSessionMeta(session.id, {
                    playerLimit: next,
                    venue: venueName ? { name: venueName } : undefined,
                    ...(dateValid ? { date: dateStr } : {}),
                    ...(timeValid ? { time: timeStr } : {}),
                  } as any);
                  setSettingsOpen(false);
                  // Best-effort: notify worker to update Telegram header if club session
                  try {
                    const clubId = (session as any)?.clubId
                      ? String((session as any).clubId)
                      : "";
                    if (clubId) {
                      const endpoint = process.env.NEXT_PUBLIC_WORKER_BASE_URL
                        ? `${process.env.NEXT_PUBLIC_WORKER_BASE_URL}/telegram/send`
                        : "/api/telegram/send";
                      await fetch(endpoint, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          clubId,
                          type: "session_meta_updated",
                          organizerUid:
                            organizerUid || auth.currentUser?.uid || "",
                          sessionId: session.id,
                        }),
                      });
                    }
                  } catch {}
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {clubLinkOpen && isOrganizer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setClubLinkOpen(false)}
          ></div>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg">
            <div className="mb-2 text-base font-semibold">
              {session.clubId ? "Change club" : "Add session to club"}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              {(myClubs || []).length === 0 ? (
                <div className="p-3 text-sm text-gray-600">
                  You are not a member of any clubs.
                </div>
              ) : (
                <ul className="divide-y">
                  {myClubs.map((c) => {
                    const active = selectedClubId === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedClubId(c.id)}
                          className={`flex w-full items-center justify-between px-3 py-2 text-sm ${
                            active ? "bg-gray-100" : ""
                          }`}
                          aria-pressed={active}
                        >
                          <span className="truncate">{c.name || c.id}</span>
                          <span
                            className={`ml-2 inline-block h-4 w-4 rounded-full border ${
                              active ? "bg-black" : "bg-white"
                            }`}
                            aria-hidden="true"
                          ></span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                className="rounded-xl border px-3 py-1.5 text-sm"
                onClick={() => setClubLinkOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                disabled={
                  !selectedClubId || !myClubIds.includes(String(selectedClubId))
                }
                onClick={async () => {
                  if (!isOrganizer) return;
                  const cid = String(selectedClubId || "");
                  if (!cid || !myClubIds.includes(cid)) return;
                  updateSessionMeta(session.id, { clubId: cid } as any);
                  setClubLinkOpen(false);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {joinError && (
        <Card>
          <div className="text-[11px] text-red-600">{joinError}</div>
        </Card>
      )}
      {isOrganizer && !!endOpen && (
        <EndSessionModal
          title={`End ${formatSessionTitle(session)}?`}
          shuttles={endShuttles}
          onShuttlesChange={setEndShuttles}
          courtCost={endCourtCost}
          onCourtCostChange={setEndCourtCost}
          shuttleCost={endShuttleCostMoney}
          onShuttleCostChange={setEndShuttleCostMoney}
          requestPayment={endRequestPayment}
          onRequestPaymentChange={setEndRequestPayment}
          onCancel={() => setEndOpen(false)}
          onConfirm={() => {
            const num = Number(endShuttles);
            endSession(
              session.id,
              Number.isFinite(num) && num >= 0 ? Math.floor(num) : undefined
            );
            (async () => {
              try {
                // Persist optional payment request before saving
                try {
                  const enabled = !!endRequestPayment;
                  const court = Number(endCourtCost);
                  const shuttle = Number(endShuttleCostMoney);
                  (useStore.getState() as any).setPaymentRequest?.(session.id, {
                    enabled,
                    courtCost:
                      Number.isFinite(court) && court >= 0 ? court : undefined,
                    shuttleCost:
                      Number.isFinite(shuttle) && shuttle >= 0
                        ? shuttle
                        : undefined,
                  });
                } catch {}
                const latest = (useStore.getState().sessions || []).find(
                  (s) => s.id === session.id
                );
                if (latest) await saveSession(session.id, latest);
              } catch {}
              const res = await triggerStatsRecalc(organizerUid, session.id, {
                fireAndForget: false,
              });
              if (!res || !res.ok) {
                await recordStatsRecalcFailure(
                  organizerUid,
                  session.id,
                  res ? res.status : "fetch-error"
                );
              }
            })();
            setEndOpen(false);
          }}
          organizerUid={organizerUid}
          sessionId={session.id}
          unlinkedPlayers={session.players
            .filter((p) => !p.accountUid)
            .map((p) => ({ id: p.id, name: p.name }))}
          organizerLinked={(() => {
            const ss = session;
            const myUid = auth.currentUser?.uid;
            return !!(
              myUid &&
              ss &&
              ss.players.some((p) => p.accountUid === myUid)
            );
          })()}
        />
      )}
      {session.ended && session.stats && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-base font-semibold">Session statistics</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => downloadSessionJson(session)}
                className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
              >
                Export JSON
              </button>
              {!session.ended && <ShareClaimsButton sessionId={session.id} />}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-gray-50 p-2">
              <div className="text-xs text-gray-500">Total games</div>
              <div className="font-medium">{session.stats.totalGames}</div>
            </div>
            {typeof session.stats.shuttlesUsed !== "undefined" && (
              <div className="rounded-lg bg-lime-50 p-2">
                <div className="text-xs text-lime-700">Shuttlecocks used</div>
                <div className="font-medium">{session.stats.shuttlesUsed}</div>
              </div>
            )}
            {session.stats.topWinner && (
              <div className="rounded-lg bg-green-50 p-2">
                <div className="text-xs text-green-700">Top winner</div>
                <div className="font-medium">
                  {session.stats.topWinner.name}
                </div>
                <div className="text-xs text-green-700">
                  {session.stats.topWinner.wins} wins ·{" "}
                  {Math.round(session.stats.topWinner.winRate * 100)}%
                </div>
              </div>
            )}
            {session.stats.topLoser && (
              <div className="rounded-lg bg-red-50 p-2">
                <div className="text-xs text-red-700">Top loser</div>
                <div className="font-medium">{session.stats.topLoser.name}</div>
                <div className="text-xs text-red-700">
                  {session.stats.topLoser.wins} wins ·{" "}
                  {session.stats.topLoser.losses} losses
                </div>
              </div>
            )}
            {session.stats.topScorer && (
              <div className="rounded-lg bg-indigo-50 p-2">
                <div className="text-xs text-indigo-700">Top scorer</div>
                <div className="font-medium">
                  {session.stats.topScorer.name}
                </div>
                <div className="text-xs text-indigo-700">
                  {session.stats.topScorer.points} pts
                </div>
              </div>
            )}
            {session.stats.mostActive && (
              <div className="rounded-lg bg-amber-50 p-2">
                <div className="text-xs text-amber-700">Most active</div>
                <div className="font-medium">
                  {session.stats.mostActive.name}
                </div>
                <div className="text-xs text-amber-700">
                  {session.stats.mostActive.games} games
                </div>
              </div>
            )}
            {session.stats.bestPair && (
              <div className="col-span-2 rounded-lg bg-teal-50 p-2">
                <div className="text-xs text-teal-700">Best pair</div>
                <div className="font-medium">
                  {session.stats.bestPair.names.join(" & ")}
                </div>
                <div className="text-xs text-teal-700">
                  {session.stats.bestPair.wins} wins together
                </div>
              </div>
            )}
            {session.stats.longestDuration && (
              <div className="col-span-2 rounded-lg bg-fuchsia-50 p-2">
                <div className="text-xs text-fuchsia-700">
                  Longest duration on court
                </div>
                <div className="font-medium">
                  {session.stats.longestDuration.names.join(" & ")}
                </div>
                <div className="text-xs text-fuchsia-700">
                  {formatDuration(session.stats.longestDuration.durationMs)}
                </div>
              </div>
            )}
            {session.stats.mostIntenseGame && (
              <div className="col-span-2 rounded-lg bg-sky-50 p-2">
                <div className="text-xs text-sky-700">Most intense game</div>
                <div className="text-xs text-sky-700">
                  Court {session.stats.mostIntenseGame.courtIndex + 1} ·{" "}
                  {new Date(
                    session.stats.mostIntenseGame.endedAt
                  ).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                <div className="font-medium">
                  {session.stats.mostIntenseGame.namesA.join(" & ")} vs{" "}
                  {session.stats.mostIntenseGame.namesB.join(" & ")}
                </div>
                <div className="text-xs text-sky-700">
                  {session.stats.mostIntenseGame.scoreA}–
                  {session.stats.mostIntenseGame.scoreB} ·{" "}
                  {session.stats.mostIntenseGame.totalPoints} pts in{" "}
                  {formatDuration(session.stats.mostIntenseGame.durationMs)} (
                  {Math.round(session.stats.mostIntenseGame.secondsPerPoint)}{" "}
                  s/pt)
                </div>
              </div>
            )}
          </div>
          {!!(
            session.stats.leaderboard && session.stats.leaderboard.length
          ) && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-gray-600">
                Leaderboard
              </div>
              <ul className="divide-y rounded-lg border">
                {session.stats.leaderboard.map((p) => (
                  <li
                    key={p.playerId}
                    className="flex items-center justify-between px-2 py-1 text-sm"
                  >
                    <div className="truncate">
                      {(() => {
                        const sp = session.players.find(
                          (pp) => pp.id === p.playerId
                        );
                        console.log("sp", sp);
                        const uid = sp?.accountUid;
                        const uname = uid ? usernameMap[uid] : undefined;
                        const slug = uname ? toUsernameSlug(uname) : null;
                        const finalUname = uname || sp?.accountUsername;
                        return uid && finalUname ? (
                          <Link
                            href={`/profile/${finalUname}`}
                            className="text-sky-700 hover:underline"
                          >
                            {p.name}
                          </Link>
                        ) : (
                          <span>{p.name}</span>
                        );
                      })()}
                    </div>
                    <div className="ml-2 shrink-0 text-xs text-gray-600">
                      {p.wins}W {p.losses}L · {Math.round(p.winRate * 100)}% ·{" "}
                      {p.points}pts
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <Card>
        {isOrganizer && !session.ended && !session.clubId && (
          <button
            onClick={() => {
              setSelectedClubId(session.clubId || "");
              setClubLinkOpen(true);
            }}
            title="Add session to a club"
            aria-label="Add session to a club"
            className="rounded-xl border px-2 py-1.5"
          >
            Add to club
          </button>
        )}
        {session.clubId && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-gray-600">
              This is a club session
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/clubs/${session.clubId}`}
                className="rounded border px-2 py-1 text-xs"
              >
                Club
              </Link>
              {isOrganizer && !session.ended && (
                <>
                  <button
                    onClick={() => {
                      setSelectedClubId(session.clubId || "");
                      setClubLinkOpen(true);
                    }}
                    className="rounded border px-2 py-1 text-xs"
                  >
                    Change club
                  </button>
                  <button
                    onClick={() => {
                      setRemoveClubOpen(true);
                    }}
                    className="rounded border px-2 py-1 text-xs"
                  >
                    Remove from club
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </Card>

      {removeClubOpen && isOrganizer && (
        <ConfirmModal
          open={true}
          title="Remove session from club?"
          body="This session will no longer appear under the club."
          confirmText="Remove"
          onCancel={() => setRemoveClubOpen(false)}
          onConfirm={() => {
            updateSessionMeta(session.id, { clubId: undefined } as any);
            setRemoveClubOpen(false);
          }}
        />
      )}

      {canManage && (
        <Card>
          <h3 className="mb-3 text-base font-semibold">Add players</h3>
          <div className="space-y-2">
            <form onSubmit={add} className="flex gap-2">
              <Input
                placeholder="Player name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1"
                disabled={!!session.ended}
              />
              <Select value={gender} onChange={(v) => setGender(v as any)}>
                <option value="">Gender</option>
                <option value="M">M</option>
                <option value="F">F</option>
              </Select>
              <button
                type="submit"
                disabled={!!session.ended}
                className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
              >
                Add
              </button>
            </form>
            <button
              onClick={() => setBulkOpen((v) => !v)}
              disabled={!!session.ended}
              className="text-xs text-gray-600 underline disabled:opacity-50"
            >
              {bulkOpen ? "Hide bulk add" : "Add multiple players"}
            </button>
            <div className="space-y-2">
              {bulkOpen && (
                <form onSubmit={addBulk} className="space-y-2">
                  <div>
                    <Label>Paste names (one per line)</Label>
                    <Label>Add gender M/F with comma (optional)</Label>
                    <Label>Example: Alice, F</Label>
                    <textarea
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      rows={4}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none"
                      placeholder="Alice, F\nBob, M\nCharlie, F"
                      disabled={!!session.ended}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={!!session.ended}
                      className="rounded-xl bg-black px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    >
                      Add players
                    </button>
                    <button
                      type="button"
                      onClick={() => setBulkOpen(false)}
                      className="rounded-xl border px-3 py-1.5 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                  {bulkError && (
                    <div className="text-[11px] text-red-600">{bulkError}</div>
                  )}
                </form>
              )}
              {canManage && !session.ended && (
                <>
                  <button
                    onClick={() => setShowAddByUsername((v) => !v)}
                    disabled={!!session.ended}
                    className="text-xs text-gray-600 underline disabled:opacity-50"
                  >
                    {showAddByUsername
                      ? "Hide add by username"
                      : "Add by username"}
                  </button>
                  {showAddByUsername && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setUsernameAddError("");
                        const uname = (usernameToAdd || "").trim();
                        if (!uname) return;
                        setUsernameAddBusy(true);
                        try {
                          const linkedUids = new Set(
                            session.players
                              .map((p) => p.accountUsername?.toLowerCase())
                              .filter(Boolean) as string[]
                          );
                          if (linkedUids.has(uname.toLowerCase())) {
                            throw new Error(
                              "This user is already linked to a player in this session"
                            );
                          }
                          const owner =
                            organizerUid ||
                            (window as any).__sessionOwners?.get?.(
                              session.id
                            ) ||
                            auth.currentUser?.uid;
                          if (!owner)
                            throw new Error("Organizer not resolved yet");
                          await addAndLinkPlayerByUsername(
                            owner,
                            session.id,
                            uname
                          );
                          setUsernameToAdd("");
                        } catch (err: any) {
                          setUsernameAddError(
                            err?.message || "Failed to add by username"
                          );
                        } finally {
                          setUsernameAddBusy(false);
                        }
                      }}
                      className="mt-2 space-y-2"
                    >
                      <div className="flex gap-2">
                        <Input
                          placeholder="Add by username (without @)"
                          value={usernameToAdd}
                          onChange={(e) => {
                            const v = e.target.value;
                            setUsernameToAdd(v);
                            setUsernameAddError("");
                            if (suggestTimerRef.current)
                              window.clearTimeout(suggestTimerRef.current);
                            suggestTimerRef.current = window.setTimeout(
                              async () => {
                                try {
                                  const q = v.trim().toLowerCase();
                                  if (!q) {
                                    setUsernameSuggestions([]);
                                    return;
                                  }
                                  const { suggestUsernames } = await import(
                                    "@/lib/firestoreSessions"
                                  );
                                  const suggestions = await suggestUsernames(
                                    q,
                                    5
                                  );
                                  setUsernameSuggestions(suggestions);
                                } catch {
                                  setUsernameSuggestions([]);
                                }
                              },
                              200
                            );
                          }}
                          className="flex-1"
                          disabled={!!session.ended || usernameAddBusy}
                        />
                        <button
                          type="submit"
                          disabled={!!session.ended || usernameAddBusy}
                          className="rounded-xl bg-black px-3 py-1.5 text-xs text-white disabled:opacity-50"
                        >
                          {usernameAddBusy ? "Adding…" : "Add by username"}
                        </button>
                      </div>
                      {!!usernameSuggestions.length && (
                        <div className="rounded border bg-white">
                          {usernameSuggestions.map((s) => (
                            <button
                              type="button"
                              key={s}
                              onClick={async () => {
                                setUsernameToAdd(s);
                                setUsernameAddError("");
                                // auto-attempt add on click
                                if (usernameAddBusy) return;
                                setUsernameAddBusy(true);
                                try {
                                  const linkedUids = new Set(
                                    session.players
                                      .map((p) =>
                                        p.accountUsername?.toLowerCase()
                                      )
                                      .filter(Boolean) as string[]
                                  );
                                  if (linkedUids.has(s.toLowerCase())) {
                                    throw new Error(
                                      "This user is already linked to a player in this session"
                                    );
                                  }
                                  const owner =
                                    organizerUid ||
                                    (window as any).__sessionOwners?.get?.(
                                      session.id
                                    ) ||
                                    auth.currentUser?.uid;
                                  if (!owner)
                                    throw new Error(
                                      "Organizer not resolved yet"
                                    );
                                  await addAndLinkPlayerByUsername(
                                    owner,
                                    session.id,
                                    s
                                  );
                                  setUsernameToAdd("");
                                  setUsernameSuggestions([]);
                                } catch (err: any) {
                                  setUsernameAddError(
                                    err?.message || "Failed to add by username"
                                  );
                                } finally {
                                  setUsernameAddBusy(false);
                                }
                              }}
                              className="block w-full px-2 py-1 text-left hover:bg-gray-50"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                      {usernameAddError && (
                        <div className="text-[11px] text-red-600">
                          {usernameAddError}
                        </div>
                      )}
                      <div className="text-[10px] text-gray-500">
                        Users added by username are auto-linked and cannot
                        unlink themselves.
                      </div>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>
      )}
      {/* Auto-assign settings now in a modal, opened from header button */}
      {/* Players and Courts */}
      <div className="space-y-3 layout-grid">
        <Card>
          <h3 className="mb-2 text-base font-semibold">Players</h3>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
            <span
              className="inline-flex items-center gap-1"
              aria-label="Account"
            >
              <svg
                className="h-3.5 w-3.5 text-blue-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z" />
                <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" />
              </svg>
              <span>Account Linked</span>
            </span>
            <span className="inline-flex items-center gap-1" aria-label="Guest">
              <svg
                className="h-3.5 w-3.5 text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z" />
                <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" />
              </svg>
              <span>Guest</span>
            </span>
            <span className="inline-flex items-center gap-1" aria-label="Me">
              <svg
                className="h-3.5 w-3.5 text-emerald-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z" />
                <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" />
              </svg>
              <span>Me</span>
            </span>
            <span
              className="inline-flex items-center gap-1"
              aria-label="In game"
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500"
                aria-hidden="true"
              ></span>
              <span>In game</span>
            </span>
            <span
              className="inline-flex items-center gap-1"
              aria-label="Co-organizer"
            >
              <svg
                className="h-3.5 w-3.5 text-red-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z" />
                <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" />
              </svg>
              <span>Co-organizer</span>
            </span>
          </div>
          {session.players.length === 0 ? (
            <p className="text-gray-500">No players yet. Add some above.</p>
          ) : (
            <div className="space-y-2">
              {sortedPlayers.map((p) => {
                const currentIdx = getPlayerCourtIndex(session, p.id);
                const inGame = inGameIdSet.has(p.id);
                return (
                  <div
                    key={p.id}
                    id={`player-${p.id}`}
                    className="grid grid-cols-12 items-center gap-2"
                  >
                    <div className="col-span-4 grid grid-cols-12 items-center gap-2 min-w-0">
                      <div className="col-span-2 flex items-center shrink-0">
                        {p.accountUid ? (
                          <span
                            className="inline-flex items-center"
                            title={
                              (session.coOrganizerUids || []).includes(
                                p.accountUid
                              )
                                ? "Co-organizer"
                                : auth.currentUser?.uid === p.accountUid
                                ? "Account (Me)"
                                : "Account"
                            }
                            aria-label={
                              (session.coOrganizerUids || []).includes(
                                p.accountUid
                              )
                                ? "Co-organizer"
                                : auth.currentUser?.uid === p.accountUid
                                ? "Account (Me)"
                                : "Account"
                            }
                          >
                            <svg
                              className={`h-4 w-4 ${
                                (session.coOrganizerUids || []).includes(
                                  p.accountUid
                                )
                                  ? "text-red-600"
                                  : auth.currentUser?.uid === p.accountUid
                                  ? "text-emerald-600"
                                  : "text-blue-600"
                              }`}
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z" />
                              <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" />
                            </svg>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center"
                            title="Guest"
                            aria-label="Guest"
                          >
                            <svg
                              className="h-4 w-4 text-gray-400"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z" />
                              <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" />
                            </svg>
                          </span>
                        )}
                      </div>
                      <div className="col-span-8 min-w-0 truncate">
                        <span className="block truncate">{p.name}</span>
                      </div>
                      <div className="col-span-2 flex items-center gap-2 justify-start shrink-0">
                        {/* no separate dot; icon color indicates Me */}
                        {inGame && (
                          <span
                            className="inline-block h-2 w-2 rounded-full bg-rose-500"
                            title="In game"
                            aria-label="In game"
                          ></span>
                        )}
                      </div>
                    </div>
                    <div className="col-span-2 flex items-center justify-end">
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                        <svg
                          className="mr-1 h-3 w-3 text-gray-600"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <rect
                            x="3"
                            y="5"
                            width="18"
                            height="14"
                            rx="2"
                            ry="2"
                          />
                          <path d="M7 10h10M7 14h6" />
                        </svg>
                        {p.gamesPlayed ?? 0}
                      </span>
                    </div>
                    <div className="col-span-6 flex items-center justify-end gap-2">
                      {canManage && !session.ended && !inGame ? (
                        <div className="flex max-w-full flex-wrap items-center gap-1">
                          <button
                            onClick={() => assign(session.id, p.id, null)}
                            disabled={false}
                            className={`rounded border px-2 py-0.5 text-[10px] ${
                              currentIdx == null
                                ? "bg-gray-900 text-white"
                                : "text-gray-700"
                            }`}
                          >
                            U
                          </button>
                          {Array.from({ length: session.numCourts }).map(
                            (_, i) => {
                              const court = session.courts[i];
                              const isSingles =
                                (court?.mode || "doubles") === "singles";
                              const cap = isSingles ? 2 : 4;
                              const occ = occupancy[i];
                              const disabled =
                                inGame ||
                                !!session.ended ||
                                (currentIdx !== i && occ >= cap) ||
                                court?.inProgress;
                              const active = currentIdx === i;
                              return (
                                <button
                                  key={i}
                                  onClick={() => assign(session.id, p.id, i)}
                                  disabled={disabled}
                                  className={`rounded border px-2 py-0.5 text-[10px] ${
                                    active
                                      ? "bg-gray-900 text-white"
                                      : disabled
                                      ? "text-gray-400"
                                      : "text-gray-700"
                                  }`}
                                  title={`Court ${i + 1} (${
                                    isSingles ? "S" : "D"
                                  }) (${occ}/${cap})`}
                                  aria-label={`Assign to court ${i + 1}`}
                                >
                                  c{i + 1}
                                </button>
                              );
                            }
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700">
                          {currentIdx === null ||
                          typeof currentIdx === "undefined"
                            ? "Unassigned"
                            : `Court ${currentIdx + 1}`}
                        </span>
                      )}
                      {!session.ended &&
                        (canManage ||
                          p.accountUid === auth.currentUser?.uid) && (
                          <RowKebabMenu
                            session={session}
                            player={p}
                            inGame={inGame}
                            isOrganizer={!!canManage}
                            organizerUid={
                              organizerUid ||
                              (window as any).__sessionOwners?.get?.(session.id)
                            }
                            linkPlayerToAccount={linkPlayerToAccount}
                            removePlayer={removePlayer}
                          />
                        )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold">Courts</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                Unassigned: {unassigned.length}
              </span>
              {!session.ended && canManage && (
                <AddCourtButton sessionId={session.id} />
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {session.courts.map((court, idx) => (
              <CourtCard
                key={court.id}
                session={session}
                court={court}
                idx={idx}
                isOrganizer={canManage}
              />
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Games</h3>
          <div className="flex items-center gap-2">
            <Select value={gamesFilter} onChange={setGamesFilter}>
              <option value="">All players</option>
              {session.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {!session.games || session.games.length === 0 ? (
          <p className="text-gray-500">No games recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {pagedGames.map((g) => {
              const selected = gamesFilter || "";
              const playedA = selected && g.sideA.includes(selected);
              const playedB = selected && g.sideB.includes(selected);
              const resultForSelected = selected
                ? g.voided
                  ? "void"
                  : g.winner === "draw"
                  ? "draw"
                  : playedA
                  ? g.winner === "A"
                    ? "win"
                    : "loss"
                  : playedB
                  ? g.winner === "B"
                    ? "win"
                    : "loss"
                  : ""
                : "";
              return (
                <div
                  key={g.id}
                  className="rounded-xl border border-gray-200 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">
                      Court {g.courtIndex + 1}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(g.endedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {typeof g.durationMs !== "undefined" && (
                        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700">
                          {formatDuration(g.durationMs)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-sm">
                    {g.voided ? (
                      <span className="rounded bg-red-50 px-2 py-0.5 text-red-700">
                        Voided
                      </span>
                    ) : (
                      <>
                        Score: {g.scoreA}–{g.scoreB} · Winner: {g.winner}
                        {g.endedByRole && (
                          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700">
                            Ended By{" "}
                            {g.endedByRole === "organizer"
                              ? "Organizer"
                              : "Co-organizer"}
                          </span>
                        )}
                        {selected && (playedA || playedB) && !g.voided && (
                          <span
                            className={`ml-2 rounded px-2 py-0.5 text-[10px] ${
                              resultForSelected === "win"
                                ? "bg-green-50 text-green-700"
                                : resultForSelected === "loss"
                                ? "bg-red-50 text-red-700"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {resultForSelected}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-500 truncate">
                    A:{" "}
                    {g.sideA
                      .map((pid: string) => ({
                        id: pid,
                        name:
                          session.players.find((pp) => pp.id === pid)?.name ||
                          "(deleted)",
                      }))
                      .map((p: { id: string; name: string }) => (
                        <span
                          key={`A-${p.id}`}
                          className={
                            gamesFilter && p.id === gamesFilter
                              ? "font-semibold text-gray-800"
                              : ""
                          }
                        >
                          {p.name}
                        </span>
                      ))
                      .reduce(
                        (prev: any[] | null, cur: any) =>
                          prev === null ? [cur] : [...prev, " & ", cur],
                        null as any
                      )}
                    <br />
                    B:{" "}
                    {g.sideB
                      .map((pid: string) => ({
                        id: pid,
                        name:
                          session.players.find((pp) => pp.id === pid)?.name ||
                          "(deleted)",
                      }))
                      .map((p: { id: string; name: string }) => (
                        <span
                          key={`B-${p.id}`}
                          className={
                            gamesFilter && p.id === gamesFilter
                              ? "font-semibold text-gray-800"
                              : ""
                          }
                        >
                          {p.name}
                        </span>
                      ))
                      .reduce(
                        (prev: any[] | null, cur: any) =>
                          prev === null ? [cur] : [...prev, " & ", cur],
                        null as any
                      )}
                  </div>
                  {!session.ended && (
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => setEditGameId(g.id)}
                        className="rounded border px-2 py-0.5 text-xs"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredGames.length > pagedGames.length ? (
              <div className="mt-2 flex justify-center">
                <button
                  onClick={() => setGamesPage((p) => p + 1)}
                  className="rounded border px-2 py-1 text-xs"
                >
                  See more
                </button>
              </div>
            ) : (
              <div className="mt-2 text-center text-[11px] text-gray-500">
                End of list
              </div>
            )}
          </div>
        )}
      </Card>
      <GameEditModal
        session={session}
        gameId={editGameId}
        onClose={() => setEditGameId(null)}
      />
    </div>
  );
}

export default function SessionPage() {
  const router = useRouter();
  const onBack = () => {
    try {
      if (typeof window !== "undefined" && window.history.length > 1) {
        router.back();
      } else {
        router.push("/");
      }
    } catch {
      router.push("/");
    }
  };

  return (
    <main className="mx-auto max-w-md md:max-w-3xl lg:max-w-5xl xl:max-w-6xl p-4 text-sm">
      <Suspense fallback={<LoadingScreen message="Loading…" />}>
        <SessionManager onBack={onBack} />
      </Suspense>
    </main>
  );
}

export const runtime = "edge";
