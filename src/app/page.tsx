/* eslint-disable */

"use client";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  saveSession,
  subscribeUserSessions,
  linkAccountInOrganizerSession,
} from "@/lib/firestoreSessions";
import { subscribeLinkedSessions } from "@/lib/firestoreSessions";
import { auth } from "@/lib/firebase";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { useSearchParams } from "next/navigation";
import { Session, Player } from "@/types/player";
import { useStore } from "@/lib/store";
import {
  downloadSessionJson,
  formatDuration,
  getPlayerCourtIndex,
  formatSessionTitle,
} from "@/lib/helper";
import { Card, Label, Input, Select } from "@/components/layout";
import { EndSessionModal } from "@/components/session/endSessionModal";
import { AutoAssignSettingsButton } from "@/components/session/autoAssignSettingsButton";
import { ShareClaimsButton } from "@/components/session/rowKebabMenu";
import { RowKebabMenu } from "@/components/session/rowKebabMenu";
import { AddCourtButton } from "@/components/session/addCourtButton";
import { CourtCard } from "@/components/session/courtCard";
import { GameEditModal } from "@/components/session/gameEditModal";

/**
 * Single-file Next.js page (drop into app/page.tsx)
 * Mobile-first UI for:
 *  - creating sessions (date, time, number of courts, players per court)
 *  - adding players to a session
 *  - assigning players to courts in that session
 *
 * Dependencies to install:
 *  npm i zustand nanoid @dnd-kit/core
 * (Tailwind is used for styling — run `npx tailwindcss init -p` and the usual Next/TW setup.)
 */

// -----------------------------
// Helpers
// -----------------------------

function useSession(sessionId: string | null) {
  const sessions = useStore((s) => s.sessions);
  return useMemo(
    () => sessions.find((s) => s.id === sessionId) || null,
    [sessions, sessionId]
  );
}

// -----------------------------
// UI
// -----------------------------

function Page() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const selected = useSession(selectedSessionId);
  const sessions = useStore((s) => s.sessions);
  const [user, setUser] = useState<{
    uid: string;
    displayName?: string | null;
  } | null>(null);
  const lastSaved = useRef<Map<string, string>>(new Map());
  const ownSessionIdsRef = useRef<Set<string>>(new Set());
  const sessionOwnerUidRef = useRef<Map<string, string>>(new Map());
  const linkPlayerToAccount = useStore((s) => s.linkPlayerToAccount);
  const searchParams = useSearchParams();
  const pendingClaimRef = useRef<{
    ouid: string;
    sid: string;
    pid: string;
  } | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid, displayName: u.displayName } : null);
    });
  }, []);

  // Capture claim params from URL, preselect session
  useEffect(() => {
    const claim = searchParams.get("claim");
    const ouid = searchParams.get("ouid");
    const sid = searchParams.get("sid");
    const pid = searchParams.get("pid");
    if (claim && ouid && sid && pid) {
      pendingClaimRef.current = { ouid, sid, pid };
      setSelectedSessionId(sid);
    }
  }, [searchParams]);

  // Replicate any remote session changes to Firestore (only for organizer-owned sessions)
  useEffect(() => {
    if (!user) return;
    const remote = sessions.filter(
      (s) => s.storage === "remote" && ownSessionIdsRef.current.has(s.id)
    );
    remote.forEach((ss) => {
      const key = ss.id;
      const serialized = JSON.stringify(ss);
      const prev = lastSaved.current.get(key);
      if (prev !== serialized) {
        lastSaved.current.set(key, serialized);
        void saveSession(ss.id, ss);
      }
    });
  }, [sessions, user]);

  // If a claim is present and user is available, link and clean URL.
  useEffect(() => {
    if (!user) return;
    const claim = pendingClaimRef.current;
    if (!claim) return;
    // Direct linking: claimer writes into organizer's session document.
    // Requires Firestore rules to permit: request.auth.uid == claimerUid, match player, and only set accountUid.
    void linkAccountInOrganizerSession(
      claim.ouid,
      claim.sid,
      claim.pid,
      user.uid
    );
    // clear claim and strip query params from URL
    pendingClaimRef.current = null;
    try {
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("claim");
        url.searchParams.delete("ouid");
        url.searchParams.delete("sid");
        url.searchParams.delete("pid");
        window.history.replaceState({}, "", url.toString());
      }
    } catch {}
  }, [user]);

  // Subscribe to sessions where current user is linked as a player and merge into store
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeLinkedSessions(user.uid, (docs) => {
      const linked: Session[] = docs.map((d: any) => {
        const payload = d.doc.payload as Session;
        const sess = { ...payload, storage: "remote" } as Session;
        sessionOwnerUidRef.current.set(sess.id, d.organizerUid);
        try {
          const w: any = window as any;
          w.__sessionOwners = w.__sessionOwners || new Map<string, string>();
          w.__sessionOwners.set(sess.id, d.organizerUid);
        } catch {}
        return sess;
      });
      // Keep only organizer-owned sessions from current, then add linked
      const current = useStore.getState().sessions;
      const owned = current.filter((s) => ownSessionIdsRef.current.has(s.id));
      const map = new Map<string, Session>();
      for (const s of owned) map.set(s.id, s);
      for (const s of linked) map.set(s.id, s);
      const merged = Array.from(map.values());
      useStore.setState({ sessions: merged });
      for (const ss of linked) {
        lastSaved.current.set(ss.id, JSON.stringify(ss));
      }
    });
    return () => unsub();
  }, [user]);

  // Subscribe to current user's sessions in Firestore and hydrate the store
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeUserSessions(user.uid, (docs) => {
      const remoteSessions: Session[] = docs.map((d) => {
        const payload = (d as any).payload as Session;
        return { ...payload, storage: "remote" };
      });
      useStore.setState({ sessions: remoteSessions });
      ownSessionIdsRef.current = new Set(remoteSessions.map((s) => s.id));
      for (const ss of remoteSessions)
        sessionOwnerUidRef.current.set(ss.id, user.uid);
      try {
        const w: any = window as any;
        w.__sessionOwners = w.__sessionOwners || new Map<string, string>();
        for (const ss of remoteSessions) w.__sessionOwners.set(ss.id, user.uid);
      } catch {}
      for (const ss of remoteSessions) {
        lastSaved.current.set(ss.id, JSON.stringify(ss));
      }
    });
    return () => unsub();
  }, [user]);

  return (
    <main className="mx-auto max-w-md md:max-w-3xl lg:max-w-5xl xl:max-w-6xl p-4 text-sm">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">🏸 Badminton Manager</h1>
        <p className="text-gray-500">
          Create sessions, add players, assign courts.
        </p>
      </header>

      {!user && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Sign in</h2>
              <p className="text-xs text-gray-500">
                Sign in to manage sessions.
              </p>
            </div>
            <button
              onClick={async () => {
                const provider = new GoogleAuthProvider();
                await signInWithPopup(auth, provider);
              }}
              className="rounded-xl bg-black px-4 py-2 text-white"
            >
              Continue with Google
            </button>
          </div>
        </Card>
      )}

      {user && !selected && (
        <div className="space-y-6">
          <SessionForm onCreated={setSelectedSessionId} />
          <SessionList onOpen={setSelectedSessionId} />
        </div>
      )}

      {user && selected && (
        <SessionManager
          session={selected}
          organizerUid={
            (sessionOwnerUidRef.current &&
              sessionOwnerUidRef.current.get(selected.id)) ||
            user.uid
          }
          isOrganizer={ownSessionIdsRef.current.has(selected.id)}
          onBack={() => setSelectedSessionId(null)}
        />
      )}

      <footer className="mt-12 text-center text-xs text-gray-400">
        <div className="flex items-center justify-center gap-3">
          <p>New sessions are saved to Firestore.</p>
          {user ? (
            <button
              onClick={() => signOut(auth)}
              className="rounded border px-2 py-1 text-xs"
            >
              Sign out
            </button>
          ) : null}
        </div>
      </footer>
    </main>
  );
}

export default function PageWithSearchParams() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}

// -----------------------------
// Session Creation & List
// -----------------------------

function SessionForm({
  onCreated,
}: {
  onCreated: (sessionId: string) => void;
}) {
  const createSession = useStore((s) => s.createSession);
  const [date, setDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [time, setTime] = useState<string>("19:00");
  const [numCourts, setNumCourts] = useState<string>("3");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = createSession({
      date,
      time,
      numCourts: Math.max(1, Number(numCourts || 1)),
      // playersPerCourt defaults to 4 in the store
    });
    onCreated(id);
  }

  return (
    <Card>
      <h2 className="mb-3 text-lg font-semibold">Create session</h2>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3">
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
        <button
          type="submit"
          className="mt-1 rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          Create
        </button>
      </form>
    </Card>
  );
}

function SessionList({ onOpen }: { onOpen: (id: string) => void }) {
  const sessions = useStore((s) => s.sessions);
  const deleteSession = useStore((s) => s.deleteSession);
  const endSession = useStore((s) => s.endSession);
  const [endFor, setEndFor] = useState<string | null>(null);
  const [shuttles, setShuttles] = useState<string>("0");
  const me = auth.currentUser?.uid || null;

  if (!sessions.length) {
    return (
      <Card>
        <p className="text-gray-500">No sessions yet. Create one above.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((ss) => (
        <Card key={ss.id}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium flex items-center gap-2">
                <span>{formatSessionTitle(ss)}</span>
                {(() => {
                  try {
                    const owner =
                      (window as any).__sessionOwners?.get?.(ss.id) || null;
                    const isOrganizer = owner && me ? owner === me : false;
                    return (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          isOrganizer
                            ? "bg-blue-50 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {isOrganizer ? "Organizer" : "Participant"}
                      </span>
                    );
                  } catch {
                    return null;
                  }
                })()}
              </div>
              <div className="text-xs text-gray-500">
                {ss.numCourts} court{ss.numCourts > 1 ? "s" : ""}
                {(() => {
                  const singles = (ss.courts || []).filter(
                    (c) => (c.mode || "doubles") === "singles"
                  ).length;
                  const doubles = (ss.courts || []).filter(
                    (c) => (c.mode || "doubles") === "doubles"
                  ).length;
                  const parts: string[] = [];
                  if (doubles) parts.push(`${doubles} doubles`);
                  if (singles) parts.push(`${singles} singles`);
                  return parts.length ? ` · ${parts.join(", ")}` : "";
                })()}
                · {ss.players.length} player{ss.players.length !== 1 ? "s" : ""}
              </div>
              {ss.ended && (
                <div className="mt-1 text-[11px] text-emerald-700">
                  Ended
                  {ss.endedAt
                    ? ` · ${new Date(ss.endedAt).toLocaleString()}`
                    : ""}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpen(ss.id)}
                className="rounded-xl border border-gray-300 px-3 py-1.5"
              >
                Open
              </button>
              {!ss.ended && (
                <button
                  onClick={() => {
                    if ((ss.courts || []).some((c) => c.inProgress)) return;
                    setEndFor(ss.id);
                    setShuttles("0");
                  }}
                  disabled={(ss.courts || []).some((c) => c.inProgress)}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700 disabled:opacity-50"
                >
                  End
                </button>
              )}
              <button
                onClick={() => {
                  if (confirm("Delete this session?")) deleteSession(ss.id);
                }}
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </Card>
      ))}
      <EndSessionModal
        open={!!endFor}
        title={
          endFor
            ? `End ${formatSessionTitle(
                sessions.find((s) => s.id === endFor)!
              )}?`
            : "End session?"
        }
        shuttles={shuttles}
        onShuttlesChange={setShuttles}
        onCancel={() => setEndFor(null)}
        onConfirm={() => {
          const num = Number(shuttles);
          if (endFor)
            endSession(
              endFor,
              Number.isFinite(num) && num >= 0 ? Math.floor(num) : undefined
            );
          setEndFor(null);
        }}
      />
    </div>
  );
}

// -----------------------------
// Session Manager (players + courts)
// -----------------------------

function SessionManager({
  session,
  onBack,
  isOrganizer,
  organizerUid,
}: {
  session: Session;
  onBack: () => void;
  isOrganizer?: boolean;
  organizerUid?: string;
}) {
  const addPlayer = useStore((s) => s.addPlayer);
  const addPlayersBulk = useStore((s) => s.addPlayersBulk);
  const removePlayer = useStore((s) => s.removePlayer);
  const linkPlayerToAccount = useStore((s) => s.linkPlayerToAccount);
  const platformPlayers = useStore((s) => s.platformPlayers);
  const assign = useStore((s) => s.assignPlayerToCourt);
  const endSession = useStore((s) => s.endSession);

  const [name, setName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [gender, setGender] = useState<"M" | "F" | "">("");
  const [bulkError, setBulkError] = useState<string>("");
  const [bulkText, setBulkText] = useState("");

  const occupancy = useMemo(
    () => session.courts.map((c) => c.playerIds.length),
    [session.courts]
  );

  const unassigned = useMemo(() => {
    const setAssigned = new Set(session.courts.flatMap((c) => c.playerIds));
    return session.players.filter((p) => !setAssigned.has(p.id));
  }, [session.players, session.courts]);

  const anyInProgress = useMemo(
    () => session.courts.some((c) => c.inProgress),
    [session.courts]
  );
  const [endOpen, setEndOpen] = useState(false);
  const [endShuttles, setEndShuttles] = useState<string>("0");
  const [editGameId, setEditGameId] = useState<string | null>(null);
  const [gamesFilter, setGamesFilter] = useState<string>("");

  // Drag-and-drop removed; assignments are via dropdowns only

  const inGameIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const c of session.courts) {
      if (!c.inProgress) continue;
      for (const pid of c.playerIds) set.add(pid);
    }
    return set;
  }, [session.courts]);

  const sortedPlayers = useMemo(() => {
    // Default: use attendees when present; fallback to legacy session.players
    const useAttendees =
      Array.isArray(session.attendees) && session.attendees.length > 0;
    let base: Player[] = session.players;
    if (
      useAttendees &&
      Array.isArray(session.attendees) &&
      session.attendees.length
    ) {
      const idToPlat = new Map(platformPlayers.map((p) => [p.id, p] as const));
      const nameToSess = new Map(
        session.players.map((p) => [p.name.trim().toLowerCase(), p] as const)
      );
      const mapped: Player[] = [];
      for (const pid of session.attendees!) {
        const plat = idToPlat.get(pid);
        if (!plat) continue;
        const ses = nameToSess.get((plat.name || "").trim().toLowerCase());
        if (ses) mapped.push(ses);
      }
      if (mapped.length) base = mapped;
    }
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
  }, [session.players, session.attendees, platformPlayers, inGameIdSet]);

  const filteredGames = useMemo(() => {
    const all = session.games || [];
    if (!gamesFilter) return all;
    return all.filter(
      (g) => g.sideA.includes(gamesFilter) || g.sideB.includes(gamesFilter)
    );
  }, [session.games, gamesFilter]);

  // When the signed-in user is already linked to a player in this session,
  // hide "Link to me" on other players.
  const myUid = auth.currentUser?.uid || null;
  const alreadyLinkedToMe = useMemo(() => {
    return !!myUid && session.players.some((p) => p.accountUid === myUid);
  }, [session.players, myUid]);

  function add(e: React.FormEvent) {
    e.preventDefault();
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
              <AutoAssignSettingsButton session={session} />
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
            </div>
          )}
        </div>
      </Card>

      <EndSessionModal
        open={endOpen}
        title={`End ${formatSessionTitle(session)}?`}
        shuttles={endShuttles}
        onShuttlesChange={setEndShuttles}
        onCancel={() => setEndOpen(false)}
        onConfirm={() => {
          const num = Number(endShuttles);
          endSession(
            session.id,
            Number.isFinite(num) && num >= 0 ? Math.floor(num) : undefined
          );
          setEndOpen(false);
        }}
      />

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
                    <div className="truncate">{p.name}</div>
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
          {bulkOpen && (
            <form onSubmit={addBulk} className="space-y-2">
              <div>
                <Label>Paste names (one per line, or comma-separated)</Label>
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
        </div>
      </Card>

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
                      <div className="col-span-3 flex items-center shrink-0">
                        {p.accountUid ? (
                          <span
                            className="inline-flex items-center"
                            title={
                              auth.currentUser?.uid === p.accountUid
                                ? "Account (Me)"
                                : "Account"
                            }
                            aria-label={
                              auth.currentUser?.uid === p.accountUid
                                ? "Account (Me)"
                                : "Account"
                            }
                          >
                            <svg
                              className={`h-4 w-4 ${
                                auth.currentUser?.uid === p.accountUid
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
                      <div className="col-span-6 min-w-0 truncate">
                        <span className="block truncate">{p.name}</span>
                      </div>
                      <div className="col-span-3 flex items-center gap-2 justify-start shrink-0">
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
                      <Select
                        value={currentIdx ?? ""}
                        disabled={!!session.ended || inGame}
                        onChange={(v) => {
                          if (v === "") assign(session.id, p.id, null);
                          else assign(session.id, p.id, Number(v));
                        }}
                      >
                        <option value="">Unassigned</option>
                        {Array.from({ length: session.numCourts }).map(
                          (_, i) => {
                            const court = session.courts[i];
                            const cap =
                              (court?.mode || "doubles") === "singles" ? 2 : 4;
                            const occ = occupancy[i];
                            const label =
                              (court?.mode || "doubles") === "singles"
                                ? "S"
                                : "D";
                            return (
                              <option
                                key={i}
                                value={i}
                                disabled={currentIdx !== i && occ >= cap}
                              >
                                Court {i + 1} ({label}) ({occ}/{cap})
                              </option>
                            );
                          }
                        )}
                      </Select>
                      {!session.ended && (
                        <RowKebabMenu
                          session={session}
                          player={p}
                          inGame={inGame}
                          isOrganizer={!!isOrganizer}
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
              {!session.ended && <AddCourtButton sessionId={session.id} />}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {session.courts.map((court, idx) => (
              <CourtCard
                key={court.id}
                session={session}
                court={court}
                idx={idx}
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
            {filteredGames.map((g) => {
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
                    {(g.sideAPlayers && g.sideAPlayers.length
                      ? g.sideAPlayers
                      : g.sideA.map((pid) => ({
                          id: pid,
                          name:
                            session.players.find((pp) => pp.id === pid)?.name ||
                            "(deleted)",
                        }))
                    )
                      .map((p) => (
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
                        (prev, cur) =>
                          prev === null ? [cur] : [...prev, " & ", cur],
                        null as any
                      )}
                    <br />
                    B:{" "}
                    {(g.sideBPlayers && g.sideBPlayers.length
                      ? g.sideBPlayers
                      : g.sideB.map((pid) => ({
                          id: pid,
                          name:
                            session.players.find((pp) => pp.id === pid)?.name ||
                            "(deleted)",
                        }))
                    )
                      .map((p) => (
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
                        (prev, cur) =>
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
