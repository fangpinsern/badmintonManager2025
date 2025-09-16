/* eslint-disable */

"use client";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createSessionDoc, saveSession, deleteSessionDoc, subscribeUserSessions, linkAccountInOrganizerSession, unlinkAccountInOrganizerSession, organizerUnlinkPlayer } from "@/lib/firestoreSessions";
import { subscribeLinkedSessions } from "@/lib/firestoreSessions";
import { auth } from "@/lib/firebase";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { QRCodeSVG } from "qrcode.react";
import { useSearchParams } from "next/navigation";
import { Session, PlatformPlayer, Player, Court, Game, PlayerAggregate, SessionStats } from "@/types/player";
import { useStore } from "@/lib/store";
import { downloadSessionJson, formatDuration, getPlayerCourtIndex } from "@/lib/helper";

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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selected = useSession(selectedSessionId);
  const sessions = useStore((s) => s.sessions);
  const [user, setUser] = useState<{ uid: string; displayName?: string | null } | null>(null);
  const lastSaved = useRef<Map<string, string>>(new Map());
  const ownSessionIdsRef = useRef<Set<string>>(new Set());
  const sessionOwnerUidRef = useRef<Map<string, string>>(new Map());
  const linkPlayerToAccount = useStore((s) => s.linkPlayerToAccount);
  const searchParams = useSearchParams();
  const pendingClaimRef = useRef<{ ouid: string; sid: string; pid: string } | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid, displayName: u.displayName } : null);
    });
  }, []);

  // Capture claim params from URL, preselect session
  useEffect(() => {
    const claim = searchParams.get('claim');
    const ouid = searchParams.get('ouid');
    const sid = searchParams.get('sid');
    const pid = searchParams.get('pid');
    if (claim && ouid && sid && pid) {
      pendingClaimRef.current = { ouid, sid, pid };
      setSelectedSessionId(sid);
    }
  }, [searchParams]);

  // Replicate any remote session changes to Firestore (only for organizer-owned sessions)
  useEffect(() => {
    if (!user) return;
    const remote = sessions.filter((s) => s.storage === 'remote' && ownSessionIdsRef.current.has(s.id));
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
    void linkAccountInOrganizerSession(claim.ouid, claim.sid, claim.pid, user.uid);
    // clear claim and strip query params from URL
    pendingClaimRef.current = null;
    try {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('claim');
        url.searchParams.delete('ouid');
        url.searchParams.delete('sid');
        url.searchParams.delete('pid');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {}
  }, [user]);

  // Subscribe to sessions where current user is linked as a player and merge into store
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeLinkedSessions(user.uid, (docs) => {
      const linked: Session[] = docs.map((d: any) => {
        const payload = d.doc.payload as Session;
        const sess = { ...payload, storage: 'remote' } as Session;
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
        return { ...payload, storage: 'remote' };
      });
      useStore.setState({ sessions: remoteSessions });
      ownSessionIdsRef.current = new Set(remoteSessions.map((s) => s.id));
      for (const ss of remoteSessions) sessionOwnerUidRef.current.set(ss.id, user.uid);
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
        <p className="text-gray-500">Create sessions, add players, assign courts.</p>
      </header>

      {!user && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Sign in</h2>
              <p className="text-xs text-gray-500">Sign in to manage sessions.</p>
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
          organizerUid={(sessionOwnerUidRef.current && sessionOwnerUidRef.current.get(selected.id)) || user.uid}
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

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-gray-600">{children}</label>;
}

function Input(
  props: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }
) {
  const { label, className, ...rest } = props;
  return (
    <div>
      {label && <Label>{label}</Label>}
      <input
        {...rest}
        className={`w-full rounded-xl border border-gray-300 px-3 py-2 outline-none ring-0 focus:border-gray-400 ${className || ""}`}
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
  disabled,
}: {
  label?: string;
  value: string | number | undefined;
  onChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <select
        value={value as any}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
      >
        {children}
      </select>
    </div>
  );
}

// -----------------------------
// Session Creation & List
// -----------------------------

function SessionForm({ onCreated }: { onCreated: (sessionId: string) => void }) {
  const createSession = useStore((s) => s.createSession);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
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
        <Input type="date" label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input type="time" label="Time" value={time} onChange={(e) => setTime(e.target.value)} />
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
                    const owner = (window as any).__sessionOwners?.get?.(ss.id) || null;
                    const isOrganizer = owner && me ? owner === me : false;
                    return (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${isOrganizer ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {isOrganizer ? 'Organizer' : 'Participant'}
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
                  const singles = (ss.courts || []).filter((c) => (c.mode || 'doubles') === 'singles').length;
                  const doubles = (ss.courts || []).filter((c) => (c.mode || 'doubles') === 'doubles').length;
                  const parts: string[] = [];
                  if (doubles) parts.push(`${doubles} doubles`);
                  if (singles) parts.push(`${singles} singles`);
                  return parts.length ? ` · ${parts.join(', ')}` : '';
                })()}
                · {ss.players.length} player{ss.players.length !== 1 ? "s" : ""}
              </div>
              {ss.ended && (
                <div className="mt-1 text-[11px] text-emerald-700">Ended{ss.endedAt ? ` · ${new Date(ss.endedAt).toLocaleString()}` : ''}</div>
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
        title={endFor ? `End ${formatSessionTitle(sessions.find((s) => s.id === endFor)!)}?` : 'End session?'}
        shuttles={shuttles}
        onShuttlesChange={setShuttles}
        onCancel={() => setEndFor(null)}
        onConfirm={() => {
          const num = Number(shuttles);
          if (endFor) endSession(endFor, Number.isFinite(num) && num >= 0 ? Math.floor(num) : undefined);
          setEndFor(null);
        }}
      />
    </div>
  );
}

function formatSessionTitle(ss: Session) {
  // Avoid date-fns to keep deps light; show raw YYYY-MM-DD HH:mm
  return `${ss.date} · ${ss.time}`;
}

// -----------------------------
// Session Manager (players + courts)
// -----------------------------

function SessionManager({ session, onBack, isOrganizer, organizerUid }: { session: Session; onBack: () => void; isOrganizer?: boolean; organizerUid?: string }) {
  const addPlayer = useStore((s) => s.addPlayer);
  const addPlayersBulk = useStore((s) => s.addPlayersBulk);
  const removePlayer = useStore((s) => s.removePlayer);
  const linkPlayerToAccount = useStore((s) => s.linkPlayerToAccount);
  const platformPlayers = useStore((s) => s.platformPlayers);
  const assign = useStore((s) => s.assignPlayerToCourt);
  const endSession = useStore((s) => s.endSession);

  const [name, setName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [gender, setGender] = useState<'M' | 'F' | ''>('');
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

  const anyInProgress = useMemo(() => session.courts.some((c) => c.inProgress), [session.courts]);
  const [endOpen, setEndOpen] = useState(false);
  const [endShuttles, setEndShuttles] = useState<string>('0');
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
    const useAttendees = Array.isArray(session.attendees) && session.attendees.length > 0;
    let base: Player[] = session.players;
    if (useAttendees && Array.isArray(session.attendees) && session.attendees.length) {
      const idToPlat = new Map(platformPlayers.map((p) => [p.id, p] as const));
      const nameToSess = new Map(session.players.map((p) => [p.name.trim().toLowerCase(), p] as const));
      const mapped: Player[] = [];
      for (const pid of session.attendees!) {
        const plat = idToPlat.get(pid);
        if (!plat) continue;
        const ses = nameToSess.get((plat.name || '').trim().toLowerCase());
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
    return all.filter((g) => g.sideA.includes(gamesFilter) || g.sideB.includes(gamesFilter));
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
    setGender('');
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
      const tokens = line.split(',').map((t) => t.trim()).filter(Boolean);
      if (tokens.length >= 2) {
        const g = tokens[1].toUpperCase();
        if (!(g === 'M' || g === 'F')) {
          setBulkError(`Invalid gender "${tokens[1]}" on line: "${line}". Use M or F.`);
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
      <button onClick={onBack} aria-label="back-to-list" className="text-sm text-gray-600">← Back</button>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{formatSessionTitle(session)}</h2>
            <p className="text-xs text-gray-500">
              {(session.courts || []).length} court{(session.courts || []).length > 1 ? "s" : ""} · {(session.courts || []).filter((c) => (c.mode || 'doubles') === 'doubles').length} doubles, {(session.courts || []).filter((c) => (c.mode || 'doubles') === 'singles').length} singles
            </p>
            {session.ended && (
              <div className="mt-1 text-[11px] text-emerald-700">Ended{session.endedAt ? ` · ${new Date(session.endedAt).toLocaleString()}` : ''}</div>
            )}
          </div>
          {!session.ended && (
            <div className="flex items-center gap-2">
              <AutoAssignSettingsButton session={session} />
              <button
                onClick={() => {
                  setEndOpen(true);
                  setEndShuttles('0');
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
          endSession(session.id, Number.isFinite(num) && num >= 0 ? Math.floor(num) : undefined);
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
              {!session.ended && (
                <ShareClaimsButton sessionId={session.id} />
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-gray-50 p-2">
              <div className="text-xs text-gray-500">Total games</div>
              <div className="font-medium">{session.stats.totalGames}</div>
            </div>
            {typeof session.stats.shuttlesUsed !== 'undefined' && (
              <div className="rounded-lg bg-lime-50 p-2">
                <div className="text-xs text-lime-700">Shuttlecocks used</div>
                <div className="font-medium">{session.stats.shuttlesUsed}</div>
              </div>
            )}
            {session.stats.topWinner && (
              <div className="rounded-lg bg-green-50 p-2">
                <div className="text-xs text-green-700">Top winner</div>
                <div className="font-medium">{session.stats.topWinner.name}</div>
                <div className="text-xs text-green-700">{session.stats.topWinner.wins} wins · {Math.round(session.stats.topWinner.winRate*100)}%</div>
              </div>
            )}
            {session.stats.topLoser && (
              <div className="rounded-lg bg-red-50 p-2">
                <div className="text-xs text-red-700">Top loser</div>
                <div className="font-medium">{session.stats.topLoser.name}</div>
                <div className="text-xs text-red-700">{session.stats.topLoser.wins} wins · {session.stats.topLoser.losses} losses</div>
              </div>
            )}
            {session.stats.topScorer && (
              <div className="rounded-lg bg-indigo-50 p-2">
                <div className="text-xs text-indigo-700">Top scorer</div>
                <div className="font-medium">{session.stats.topScorer.name}</div>
                <div className="text-xs text-indigo-700">{session.stats.topScorer.points} pts</div>
              </div>
            )}
            {session.stats.mostActive && (
              <div className="rounded-lg bg-amber-50 p-2">
                <div className="text-xs text-amber-700">Most active</div>
                <div className="font-medium">{session.stats.mostActive.name}</div>
                <div className="text-xs text-amber-700">{session.stats.mostActive.games} games</div>
              </div>
            )}
            {session.stats.bestPair && (
              <div className="col-span-2 rounded-lg bg-teal-50 p-2">
                <div className="text-xs text-teal-700">Best pair</div>
                <div className="font-medium">{session.stats.bestPair.names.join(' & ')}</div>
                <div className="text-xs text-teal-700">{session.stats.bestPair.wins} wins together</div>
              </div>
            )}
            {session.stats.longestDuration && (
              <div className="col-span-2 rounded-lg bg-fuchsia-50 p-2">
                <div className="text-xs text-fuchsia-700">Longest duration on court</div>
                <div className="font-medium">{session.stats.longestDuration.names.join(' & ')}</div>
                <div className="text-xs text-fuchsia-700">{formatDuration(session.stats.longestDuration.durationMs)}</div>
              </div>
            )}
            {session.stats.mostIntenseGame && (
              <div className="col-span-2 rounded-lg bg-sky-50 p-2">
                <div className="text-xs text-sky-700">Most intense game</div>
                <div className="text-xs text-sky-700">Court {session.stats.mostIntenseGame.courtIndex + 1} · {new Date(session.stats.mostIntenseGame.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                <div className="font-medium">{session.stats.mostIntenseGame.namesA.join(' & ')} vs {session.stats.mostIntenseGame.namesB.join(' & ')}</div>
                <div className="text-xs text-sky-700">{session.stats.mostIntenseGame.scoreA}–{session.stats.mostIntenseGame.scoreB} · {session.stats.mostIntenseGame.totalPoints} pts in {formatDuration(session.stats.mostIntenseGame.durationMs)} ({Math.round(session.stats.mostIntenseGame.secondsPerPoint)} s/pt)</div>
              </div>
            )}
          </div>
          {!!(session.stats.leaderboard && session.stats.leaderboard.length) && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-gray-600">Leaderboard</div>
              <ul className="divide-y rounded-lg border">
                {session.stats.leaderboard.map((p) => (
                  <li key={p.playerId} className="flex items-center justify-between px-2 py-1 text-sm">
                    <div className="truncate">{p.name}</div>
                    <div className="ml-2 shrink-0 text-xs text-gray-600">{p.wins}W {p.losses}L · {Math.round(p.winRate*100)}% · {p.points}pts</div>
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
            <button type="submit" disabled={!!session.ended} className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50">Add</button>
        </form>
          <button onClick={() => setBulkOpen((v) => !v)} disabled={!!session.ended} className="text-xs text-gray-600 underline disabled:opacity-50">
            {bulkOpen ? 'Hide bulk add' : 'Add multiple players'}
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
                <button type="submit" disabled={!!session.ended} className="rounded-xl bg-black px-3 py-1.5 text-xs text-white disabled:opacity-50">Add players</button>
                <button type="button" onClick={() => setBulkOpen(false)} className="rounded-xl border px-3 py-1.5 text-xs">Cancel</button>
              </div>
              {bulkError && <div className="text-[11px] text-red-600">{bulkError}</div>}
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
            <span className="inline-flex items-center gap-1" aria-label="Account">
              <svg className="h-3.5 w-3.5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z"/>
                <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z"/>
              </svg>
              <span>Account Linked</span>
            </span>
            <span className="inline-flex items-center gap-1" aria-label="Guest">
              <svg className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z"/>
                <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z"/>
              </svg>
              <span>Guest</span>
            </span>
            <span className="inline-flex items-center gap-1" aria-label="Me">
              <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z"/>
                <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z"/>
              </svg>
              <span>Me</span>
            </span>
            <span className="inline-flex items-center gap-1" aria-label="In game">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500" aria-hidden="true"></span>
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
                  <div key={p.id} id={`player-${p.id}`} className="grid grid-cols-12 items-center gap-2">
                    <div className="col-span-4 grid grid-cols-12 items-center gap-2 min-w-0">
                      <div className="col-span-3 flex items-center shrink-0">
                        {p.accountUid ? (
                          <span className="inline-flex items-center" title={auth.currentUser?.uid === p.accountUid ? 'Account (Me)' : 'Account'} aria-label={auth.currentUser?.uid === p.accountUid ? 'Account (Me)' : 'Account'}>
                            <svg className={`h-4 w-4 ${auth.currentUser?.uid === p.accountUid ? 'text-emerald-600' : 'text-blue-600'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z"/>
                              <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z"/>
                            </svg>
                          </span>
                        ) : (
                          <span className="inline-flex items-center" title="Guest" aria-label="Guest">
                            <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z"/>
                              <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z"/>
                            </svg>
                          </span>
                        )}
                      </div>
                      <div className="col-span-6 min-w-0 truncate">
                        <span className="block truncate">{p.name}</span>
                      </div>
                      <div className="col-span-3 flex items-center gap-2 justify-start shrink-0">
                        {/* no separate dot; icon color indicates Me */}
                        {inGame && <span className="inline-block h-2 w-2 rounded-full bg-rose-500" title="In game" aria-label="In game"></span>}
                      </div>
                    </div>
                    <div className="col-span-2 flex items-center justify-end">
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                        <svg className="mr-1 h-3 w-3 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="5" width="18" height="14" rx="2" ry="2"/>
                          <path d="M7 10h10M7 14h6"/>
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
                        {Array.from({ length: session.numCourts }).map((_, i) => {
                          const court = session.courts[i];
                          const cap = (court?.mode || 'doubles') === 'singles' ? 2 : 4;
                          const occ = occupancy[i];
                          const label = (court?.mode || 'doubles') === 'singles' ? 'S' : 'D';
                          return (
                          <option
                            key={i}
                            value={i}
                              disabled={currentIdx !== i && occ >= cap}
                          >
                              Court {i + 1} ({label}) ({occ}/{cap})
                          </option>
                          );
                        })}
                      </Select>
                      {!session.ended && (
                        <RowKebabMenu
                          session={session}
                          player={p}
                          inGame={inGame}
                          isOrganizer={!!isOrganizer}
                          organizerUid={organizerUid || (window as any).__sessionOwners?.get?.(session.id)}
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
            <span className="text-xs text-gray-500">Unassigned: {unassigned.length}</span>
              {!session.ended && (
                <AddCourtButton sessionId={session.id} />
              )}
          </div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {session.courts.map((court, idx) => (
              <CourtCard key={court.id} session={session} court={court} idx={idx} />
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
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
        </div>
        {(!session.games || session.games.length === 0) ? (
          <p className="text-gray-500">No games recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {filteredGames.map((g) => {
              const selected = gamesFilter || '';
              const playedA = selected && g.sideA.includes(selected);
              const playedB = selected && g.sideB.includes(selected);
              const resultForSelected = selected ? (g.voided ? 'void' : g.winner === 'draw' ? 'draw' : (playedA ? (g.winner === 'A' ? 'win' : 'loss') : (playedB ? (g.winner === 'B' ? 'win' : 'loss') : ''))) : '';
              return (
              <div key={g.id} className="rounded-xl border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Court {g.courtIndex + 1}</div>
                  <div className="text-xs text-gray-500">
                    {new Date(g.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {typeof g.durationMs !== 'undefined' && (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700">{formatDuration(g.durationMs)}</span>
                    )}
                  </div>
                </div>
                <div className="mt-1 text-sm">
                  {g.voided ? (
                    <span className="rounded bg-red-50 px-2 py-0.5 text-red-700">Voided</span>
                  ) : (
                    <>
                  Score: {g.scoreA}–{g.scoreB} · Winner: {g.winner}
                      {selected && (playedA || playedB) && !g.voided && (
                        <span className={`ml-2 rounded px-2 py-0.5 text-[10px] ${resultForSelected === 'win' ? 'bg-green-50 text-green-700' : resultForSelected === 'loss' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                          {resultForSelected}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-500 truncate">
                  A: {(g.sideAPlayers && g.sideAPlayers.length ? g.sideAPlayers : g.sideA.map((pid) => ({ id: pid, name: session.players.find((pp) => pp.id === pid)?.name || '(deleted)' })) ).map((p) => (
                    <span key={`A-${p.id}`} className={gamesFilter && p.id === gamesFilter ? 'font-semibold text-gray-800' : ''}>{p.name}</span>
                  )).reduce((prev, cur) => prev === null ? [cur] : [...prev, ' & ', cur], null as any)}<br/>
                  B: {(g.sideBPlayers && g.sideBPlayers.length ? g.sideBPlayers : g.sideB.map((pid) => ({ id: pid, name: session.players.find((pp) => pp.id === pid)?.name || '(deleted)' })) ).map((p) => (
                    <span key={`B-${p.id}`} className={gamesFilter && p.id === gamesFilter ? 'font-semibold text-gray-800' : ''}>{p.name}</span>
                  )).reduce((prev, cur) => prev === null ? [cur] : [...prev, ' & ', cur], null as any)}
                </div>
                {!session.ended && (
                  <div className="mt-2 flex justify-end">
                    <button onClick={() => setEditGameId(g.id)} className="rounded border px-2 py-0.5 text-xs">Edit</button>
              </div>
                )}
              </div>
            );})}
          </div>
        )}
      </Card>
      <GameEditModal session={session} gameId={editGameId} onClose={() => setEditGameId(null)} />
    </div>
  );
}

// ---------------------------------
// CourtCard (per-court UI + End Game with pair assignment + Drag & Drop)
// ---------------------------------
function CourtCard({ session, court, idx }: { session: Session; court: Court; idx: number }) {
  const endGame = useStore((s) => s.endGame);
  const voidGame = useStore((s) => s.voidGame);
  const setPair = useStore((s) => s.setPlayerPair);
  const assign = useStore((s) => s.assignPlayerToCourt);
  const startGame = useStore((s) => s.startGame);
  const setCourtMode = useStore((s) => s.setCourtMode);
  const removeCourt = useStore((s) => s.removeCourt);
  const enqueue = useStore((s) => s.enqueueToCourt);
  const dequeue = useStore((s) => s.removeFromCourtQueue);
  const clearQueue = useStore((s) => s.clearCourtQueue);
  // Auto-fill is now always enabled by default; toggle removed

  const canEndAny = court.playerIds.length > 0;
  const pairA = court.pairA || [];
  const pairB = court.pairB || [];
  const isSingles = (court.mode || 'doubles') === 'singles';
  const requiredPerTeam = isSingles ? 1 : 2;
  const ready = pairA.length === requiredPerTeam && pairB.length === requiredPerTeam;
  const available = court.playerIds.filter((pid) => !pairA.includes(pid) && !pairB.includes(pid));
  const isFull = court.playerIds.length === (requiredPerTeam * 2);
  const sideLabel = isSingles ? 'Player' : 'Pair';

  const [open, setOpen] = useState(false);
  const [scoreA, setScoreA] = useState<string>("");
  const [scoreB, setScoreB] = useState<string>("");
  const scoreValid = scoreA.trim() !== "" && scoreB.trim() !== "" && !Number.isNaN(Number(scoreA)) && !Number.isNaN(Number(scoreB));
  const [removeOpen, setRemoveOpen] = useState(false);
  const [queueAdds, setQueueAdds] = useState<string[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);

  // Detect if any player on this court is currently in another ongoing match (other courts)
  const busyElsewhere = useMemo(() => {
    const set = new Set<string>();
    session.courts.forEach((cc, i) => {
      if (i === idx) return;
      if (!cc.inProgress) return;
      cc.playerIds.forEach((pid) => set.add(pid));
    });
    return set;
  }, [session.courts, idx]);
  const blockingBusyIds = court.playerIds.filter((pid) => busyElsewhere.has(pid));
  const hasBusyElsewhere = blockingBusyIds.length > 0;

  // Compute how many times two players have previously been on the same side (pair) in past games
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const sameSideMap = useMemo(() => {
    const m: Map<string, number> = new Map();
    for (const g of (session.games || [])) {
      const sides: string[][] = [g.sideA || [], g.sideB || []];
      for (const side of sides) {
        for (let i = 0; i < side.length; i++) {
          for (let j = i + 1; j < side.length; j++) {
            const key = pairKey(side[i], side[j]);
            m.set(key, (m.get(key) || 0) + 1);
          }
        }
      }
    }
    return m;
  }, [session.games]);
  const getPairedCount = (a: string, b: string): number => (sameSideMap.get(pairKey(a, b)) || 0);

  const inProgressIds = useMemo(() => {
    const set = new Set<string>();
    for (const cc of session.courts) {
      if (!cc.inProgress) continue;
      for (const pid of cc.playerIds) set.add(pid);
    }
    return set;
  }, [session.courts]);

  const onSave = () => {
    const aStr = scoreA.trim();
    const bStr = scoreB.trim();
    const a = Number(aStr);
    const b = Number(bStr);
    if (!ready) return;
    if (aStr === "" || bStr === "") return;
    if (Number.isNaN(a) || Number.isNaN(b)) return;
    endGame(session.id, idx, a, b);
    setScoreA("");
    setScoreB("");
    setOpen(false);
  };

  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">Court {idx + 1}</div>
        {!session.ended && !court.inProgress && (
          <button
            onClick={() => setRemoveOpen(true)}
            aria-label="Remove court"
            className="rounded-md p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <path d="M9 3a1 1 0 0 0-1 1v1H5.5a.75.75 0 0 0 0 1.5h.59l.84 12.06A2.25 2.25 0 0 0 9.18 21h5.64a2.25 2.25 0 0 0 2.25-2.44L17.91 6.5h.59a.75.75 0 0 0 0-1.5H16V4a1 1 0 0 0-1-1H9Zm1 2h4V4H10v1Zm-.82 14a.75.75 0 0 1-.75-.68L7.62 6.5h8.76l-.81 11.82a.75.75 0 0 1-.75.68H9.18ZM10 9.25a.75.75 0 0 1 .75.75v7a.75.75 0 0 1-1.5 0v-7c0-.41.34-.75.75-.75Zm4 0c.41 0 .75.34.75.75v7a.75.75 0 0 1-1.5 0v-7c0-.41.34-.75.75-.75Z"/>
            </svg>
          </button>
        )}
      </div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs text-gray-500">
          {court.playerIds.length}/{(court.mode || 'doubles') === 'singles' ? 2 : 4}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-500">
            {court.playerIds.length}/{(court.mode || 'doubles') === 'singles' ? 2 : 4}
          </div>
          {court.inProgress && (
            <div className="text-[11px] text-gray-500">Queued: {(court.queue || []).length}</div>
          )}
          {!session.ended && !court.inProgress && (
          <button
              onClick={() => useStore.getState().autoAssignCourt(session.id, idx)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
            >
              Auto-assign
            </button>
          )}
          {/* Remove button moved to top-right icon */}
          {!court.inProgress && (
            <Select
              value={court.mode || 'doubles'}
              onChange={(v) => setCourtMode(session.id, idx, v as 'singles' | 'doubles')}
              disabled={!!session.ended}
            >
              <option value="singles">Singles</option>
              <option value="doubles">Doubles</option>
            </Select>
          )}
          {(!court.inProgress) ? (
            <button
              onClick={() => {
                startGame(session.id, idx);
                setOpen(false);
              }}
              disabled={!ready || !isFull || !!session.ended || hasBusyElsewhere}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 disabled:opacity-50"
              title={hasBusyElsewhere ? 'Players are still in another game' : undefined}
            >
              Start game
            </button>
          ) : (
            <button
              onClick={() => setOpen(true)}
              disabled={!!session.ended}
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
          >
            End game
          </button>
          )}
        </div>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-xs font-medium">{sideLabel} A ({pairA.length}/{requiredPerTeam}){!isSingles && pairA.length === 2 ? (
            <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-700">paired {getPairedCount(pairA[0], pairA[1])}×</span>
          ) : null}</div>
          <div className="space-y-1">
          {pairA.length === 0 && (
              <div className="text-xs text-gray-400">No players in A</div>
          )}
          {pairA.map((pid) => {
            const player = session.players.find((pp) => pp.id === pid);
            if (!player) return null;
            return (
                <div key={pid} className="flex items-center justify-between rounded-lg bg-gray-50 px-2 py-1 text-sm">
                  <span className="truncate">{player.name}</span>
                  {busyElsewhere.has(pid) && (
                    <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700">in other game</span>
                  )}
                  <button onClick={() => setPair(session.id, idx, pid, null)} className="text-[10px] text-gray-600">×</button>
                </div>
            );
          })}
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium">{sideLabel} B ({pairB.length}/{requiredPerTeam}){!isSingles && pairB.length === 2 ? (
            <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-700">paired {getPairedCount(pairB[0], pairB[1])}×</span>
          ) : null}</div>
          <div className="space-y-1">
          {pairB.length === 0 && (
              <div className="text-xs text-gray-400">No players in B</div>
          )}
          {pairB.map((pid) => {
            const player = session.players.find((pp) => pp.id === pid);
            if (!player) return null;
            return (
                <div key={pid} className="flex items-center justify-between rounded-lg bg-gray-50 px-2 py-1 text-sm">
                  <span className="truncate">{player.name}</span>
                  {busyElsewhere.has(pid) && (
                    <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700">in other game</span>
                  )}
                  <button onClick={() => setPair(session.id, idx, pid, null)} className="text-[10px] text-gray-600">×</button>
                </div>
            );
          })}
          </div>
        </div>
      </div>

      {(!court.inProgress) && hasBusyElsewhere && (
        <div className="-mt-1 mb-2 text-[11px] text-rose-700">
          Waiting for: {blockingBusyIds.map((pid) => session.players.find((pp) => pp.id === pid)?.name || '(deleted)').join(', ')}
        </div>
      )}

      <div>
        <div className="mb-1 text-xs font-medium">Available on court ({available.length})</div>
        {available.length === 0 ? (
          <div className="text-xs text-gray-400">No available players</div>
        ) : (
          <ul className="space-y-1">
            {available.map((pid) => {
              const player = session.players.find((pp) => pp.id === pid);
              if (!player) return null;
              const canAddA = pairA.length < requiredPerTeam && !session.ended && !court.inProgress;
              const canAddB = pairB.length < requiredPerTeam && !session.ended && !court.inProgress;
              return (
                <li key={pid} className="flex items-center justify-between gap-2">
                  <div className="truncate rounded-lg bg-gray-50 px-2 py-1 text-sm">{player.name}</div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPair(session.id, idx, pid, 'A')}
                      disabled={!canAddA}
                      className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                    >
                      A
                    </button>
                    {pairA.length === 1 && (
                      <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">{`paired ${getPairedCount(pairA[0], pid)}×`}</span>
                    )}
                    <button
                      onClick={() => setPair(session.id, idx, pid, 'B')}
                      disabled={!canAddB}
                      className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                    >
                      B
                    </button>
                    {pairB.length === 1 && (
                      <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">{`paired ${getPairedCount(pairB[0], pid)}×`}</span>
                    )}
                  <button
                    onClick={() => assign(session.id, pid, null)}
                      disabled={!!session.ended || !!court.inProgress}
                      className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                  >
                    Unassign
                  </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Queue management (only while a game is ongoing) */}
      {court.inProgress && (
      <div className="mt-3 rounded-lg border">
        <button type="button" onClick={() => setQueueOpen(!queueOpen)} className="flex w-full items-center justify-between px-2 py-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium">Next up queue</div>
            <span className="text-[11px] text-gray-500">({(court.queue || []).length})</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{queueOpen ? '▾' : '▸'}</span>
          </div>
        </button>
        {queueOpen && (
          <div className="border-t p-2">
            {(court.queue || []).length === 0 ? (
              <div className="text-[11px] text-gray-500">No one queued.</div>
            ) : (
              <ul className="space-y-1">
                {(court.queue || []).map((pid) => {
                  const p = session.players.find((pp) => pp.id === pid);
                  const name = p?.name || '(deleted)';
                  // show pair count hint vs any already selected in nextA/nextB
                  const nextAFirst = !isSingles && (court.nextA || []).length === 1 ? (court.nextA as string[])[0] : null;
                  const nextBFirst = !isSingles && (court.nextB || []).length === 1 ? (court.nextB as string[])[0] : null;
                  return (
                    <li key={`q-${pid}`} className="flex items-center justify-between gap-2">
                      <div className="truncate text-xs">{name}</div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => useStore.getState().setNextPair(session.id, idx, pid, 'A')} className={`rounded border px-2 py-0.5 text-[10px] ${((court.nextA||[]).includes(pid)) ? 'bg-gray-200' : ''}`}>A</button>
                        {nextAFirst && <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">paired {getPairedCount(nextAFirst, pid)}×</span>}
                        <button onClick={() => useStore.getState().setNextPair(session.id, idx, pid, 'B')} className={`rounded border px-2 py-0.5 text-[10px] ${((court.nextB||[]).includes(pid)) ? 'bg-gray-200' : ''}`}>B</button>
                        {nextBFirst && <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">paired {getPairedCount(nextBFirst, pid)}×</span>}
                      </div>
                      <button onClick={() => dequeue(session.id, idx, pid)} className="rounded border px-2 py-0.5 text-[10px]">Remove</button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1">
                {(() => {
                  const alreadyQueuedSet = new Set(court.queue || []);
                  const queuedElsewhere = new Set<string>();
                  session.courts.forEach((cc, j) => { if (j !== idx) (cc.queue || []).forEach((pid) => queuedElsewhere.add(pid)); });
                  const selectable = session.players.filter((p) => {
                    if (alreadyQueuedSet.has(p.id)) return false;
                    if (queuedElsewhere.has(p.id)) return false;
                    // block if player is assigned to any court not yet started
                    if (session.courts.some((cc) => !cc.inProgress && cc.playerIds.includes(p.id))) return false;
                    return true;
                  });
                  const avail = selectable.filter((p) => !inProgressIds.has(p.id));
                  const inGameAvail = selectable.filter((p) => inProgressIds.has(p.id));
                  if (selectable.length === 0) {
                    return <div className="text-[11px] text-gray-500">No available players to queue.</div>;
                  }
                  return (
                    <div className="max-h-48 overflow-auto space-y-2">
                      {avail.length > 0 && (
                        <div>
                          <div className="mb-1 text-[11px] font-medium text-gray-700">Available ({avail.length})</div>
                          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                            {avail.map((p) => {
                              const checked = queueAdds.includes(p.id);
                              return (
                                <label key={`qa-${p.id}`} className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      if (e.target.checked) setQueueAdds((prev) => prev.includes(p.id) ? prev : [...prev, p.id]);
                                      else setQueueAdds((prev) => prev.filter((id) => id !== p.id));
                                    }}
                                  />
                                  <span className="truncate">{p.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {inGameAvail.length > 0 && (
                        <div>
                          <div className="mb-1 text-[11px] font-medium text-gray-700">In game ({inGameAvail.length})</div>
                          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                            {inGameAvail.map((p) => {
                              const checked = queueAdds.includes(p.id);
                              return (
                                <label key={`qi-${p.id}`} className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      if (e.target.checked) setQueueAdds((prev) => prev.includes(p.id) ? prev : [...prev, p.id]);
                                      else setQueueAdds((prev) => prev.filter((id) => id !== p.id));
                                    }}
                                  />
                                  <span className="truncate">{p.name}</span>
                                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700">in game</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              <button
                onClick={() => {
                  if (!queueAdds.length) return;
                  for (const pid of queueAdds) enqueue(session.id, idx, pid);
                  setQueueAdds([]);
                }}
                className="rounded border px-2 py-1 text-xs"
              >
                Queue selected
              </button>
              {(court.queue || []).length > 0 && (
                <button onClick={() => clearQueue(session.id, idx)} className="rounded border px-2 py-1 text-xs">Clear</button>
              )}
            </div>
            {!isSingles && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 text-[11px] font-medium text-gray-700">Next A ({(court.nextA||[]).length}/2){(court.nextA||[]).length === 2 ? (
                    <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5">paired {getPairedCount((court.nextA as string[])[0], (court.nextA as string[])[1])}×</span>
                  ) : null}</div>
                  <div className="flex flex-wrap gap-1 text-[11px] text-gray-700">
                    {(court.nextA||[]).map((pid) => <span key={`na-${pid}`} className="rounded bg-gray-100 px-1.5 py-0.5">{session.players.find((pp)=>pp.id===pid)?.name || '(deleted)'}</span>)}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium text-gray-700">Next B ({(court.nextB||[]).length}/2){(court.nextB||[]).length === 2 ? (
                    <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5">paired {getPairedCount((court.nextB as string[])[0], (court.nextB as string[])[1])}×</span>
                  ) : null}</div>
                  <div className="flex flex-wrap gap-1 text-[11px] text-gray-700">
                    {(court.nextB||[]).map((pid) => <span key={`nb-${pid}`} className="rounded bg-gray-100 px-1.5 py-0.5">{session.players.find((pp)=>pp.id===pid)?.name || '(deleted)'}</span>)}
                  </div>
                </div>
              </div>
            )}
            <div className="mt-2">
              <button
                onClick={() => useStore.getState().autoAssignNext(session.id, idx)}
                className="rounded border px-2 py-1 text-xs"
              >
                Auto-assign next teams
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      <ScoreModal
        open={open}
        sideLabel={sideLabel}
        requiredPerTeam={requiredPerTeam}
        ready={ready}
        scoreA={scoreA}
        scoreB={scoreB}
        onChangeA={setScoreA}
        onChangeB={setScoreB}
        onCancel={() => setOpen(false)}
        onSave={onSave}
        onVoid={() => { voidGame(session.id, idx); setOpen(false); }}
        namesA={pairA.map((pid) => session.players.find((pp) => pp.id === pid)?.name || '(deleted)')}
        namesB={pairB.map((pid) => session.players.find((pp) => pp.id === pid)?.name || '(deleted)')}
      />

      <ConfirmModal
        open={removeOpen}
        title={`Remove Court ${idx + 1}?`}
        body="Players on this court will be unassigned. This cannot be undone."
        confirmText="Remove court"
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => { removeCourt(session.id, idx); setRemoveOpen(false); }}
      />
    </div>
  );
}

// Drag & Drop removed

function AddCourtButton({ sessionId }: { sessionId: string }) {
  const addCourt = useStore((s) => s.addCourt);
  return (
    <button
      onClick={() => addCourt(sessionId)}
      className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
    >
      + Add court
    </button>
  );
}

function EndSessionModal({ open, title, shuttles, onShuttlesChange, onCancel, onConfirm }: { open: boolean; title: string; shuttles: string; onShuttlesChange: (v: string) => void; onCancel: () => void; onConfirm: () => void; }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel}></div>
      <div className="relative w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-lg sm:rounded-2xl max-h-[90vh] overflow-auto">
        <div className="mb-2 text-base font-semibold">{title}</div>
        <div className="text-xs text-gray-600">This will lock further changes and compute session statistics.</div>
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
          <button onClick={onCancel} className="rounded-xl border px-3 py-1.5 text-sm">Cancel</button>
          <button onClick={onConfirm} className="rounded-xl bg-black px-3 py-1.5 text-sm text-white">Confirm</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ open, title, body, confirmText = 'Confirm', onCancel, onConfirm }: { open: boolean; title: string; body?: string; confirmText?: string; onCancel: () => void; onConfirm: () => void; }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel}></div>
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg max-h-[90vh] overflow-auto">
        <div className="mb-2 text-base font-semibold">{title}</div>
        {body && <div className="text-xs text-gray-600">{body}</div>}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="rounded-xl border px-3 py-1.5 text-sm">Cancel</button>
          <button onClick={onConfirm} className="rounded-xl bg-red-600 px-3 py-1.5 text-sm text-white">{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

function ScoreModal({ open, sideLabel, requiredPerTeam, ready, scoreA, scoreB, onChangeA, onChangeB, onCancel, onSave, onVoid, namesA, namesB }: { open: boolean; sideLabel: string; requiredPerTeam: number; ready: boolean; scoreA: string; scoreB: string; onChangeA: (v: string) => void; onChangeB: (v: string) => void; onCancel: () => void; onSave: () => void; onVoid?: () => void; namesA?: string[]; namesB?: string[]; }) {
  const aRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (open) {
      setTimeout(() => aRef.current?.focus(), 0);
    }
  }, [open]);
  if (!open) return null;
  const scoreValid = scoreA.trim() !== '' && scoreB.trim() !== '' && !Number.isNaN(Number(scoreA)) && !Number.isNaN(Number(scoreB));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel}></div>
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg max-h-[90vh] overflow-auto">
        <div className="mb-2 text-base font-semibold">Record score ({sideLabel} A vs {sideLabel} B)</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>{`${sideLabel} A`}</Label>
            {namesA && namesA.length > 0 && (
              <div className="mb-1 truncate text-[11px] text-gray-600">{namesA.join(' & ')}</div>
            )}
            <input
              ref={aRef}
              type="number"
              placeholder="21"
              inputMode="numeric"
              min={0}
              value={scoreA}
              onChange={(e) => onChangeA(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <Label>{`${sideLabel} B`}</Label>
            {namesB && namesB.length > 0 && (
              <div className="mb-1 truncate text-[11px] text-gray-600">{namesB.join(' & ')}</div>
            )}
            <input
              type="number"
              placeholder="18"
              inputMode="numeric"
              min={0}
              value={scoreB}
              onChange={(e) => onChangeB(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none"
            />
          </div>
          </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          {onVoid ? (
            <button onClick={onVoid} className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700">Void game</button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="rounded-xl border px-3 py-1.5 text-sm">Cancel</button>
            <button onClick={onSave} disabled={!ready || !scoreValid} className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50">Save & Clear</button>
          </div>
        </div>
        {!ready && <div className="mt-2 text-[11px] text-amber-600">Need exactly {requiredPerTeam} in {sideLabel} A and {sideLabel} B.</div>}
          {ready && !scoreValid && <div className="mt-2 text-[11px] text-amber-600">Enter both scores.</div>}
        </div>
    </div>
  );
}

function GameEditModal({ session, gameId, onClose }: { session: Session; gameId: string | null; onClose: () => void }) {
  const updateGame = useStore((s) => s.updateGame);
  const game = React.useMemo(() => (gameId ? (session.games || []).find((g) => g.id === gameId) : null), [session.games, gameId]);
  const [scoreA, setScoreA] = React.useState<string>(game ? String(game.scoreA) : '');
  const [scoreB, setScoreB] = React.useState<string>(game ? String(game.scoreB) : '');
  const [sideA, setSideA] = React.useState<string[]>(game ? [...game.sideA] : []);
  const [sideB, setSideB] = React.useState<string[]>(game ? [...game.sideB] : []);
  const [duration, setDuration] = React.useState<string>(game && typeof game.durationMs === 'number' ? String(Math.floor(game.durationMs / 1000)) : '');

  React.useEffect(() => {
    if (game) {
      setScoreA(String(game.scoreA));
      setScoreB(String(game.scoreB));
      setSideA([...game.sideA]);
      setSideB([...game.sideB]);
      setDuration(typeof game.durationMs === 'number' ? String(Math.floor(game.durationMs / 1000)) : '');
    }
  }, [gameId]);

  if (!gameId || !game) return null;

  const isSingles = (game.sideA.length + game.sideB.length) === 2;
  const reqTeam = isSingles ? 1 : 2;

  const playersById = new Map(session.players.map((p) => [p.id, p] as const));
  const nameOf = (id: string) => playersById.get(id)?.name || '(deleted)';
  const allIds = Array.from(new Set([...game.sideA, ...game.sideB]));

  const validSides = sideA.length === reqTeam && sideB.length === reqTeam && sideA.every((id) => allIds.includes(id)) && sideB.every((id) => allIds.includes(id));
  const scoreValid = scoreA.trim() !== '' && scoreB.trim() !== '' && !Number.isNaN(Number(scoreA)) && !Number.isNaN(Number(scoreB));

  const toggleIn = (team: 'A' | 'B', id: string) => {
    if (team === 'A') {
      setSideA((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : (cur.length < reqTeam ? [...cur, id] : cur));
      setSideB((cur) => cur.filter((x) => x !== id));
    } else {
      setSideB((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : (cur.length < reqTeam ? [...cur, id] : cur));
      setSideA((cur) => cur.filter((x) => x !== id));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose}></div>
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg max-h-[90vh] overflow-auto">
        <div className="mb-2 text-base font-semibold">Edit game</div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Input label="Score A" type="number" inputMode="numeric" min={0} value={scoreA} onChange={(e) => setScoreA(e.target.value)} />
          <Input label="Score B" type="number" inputMode="numeric" min={0} value={scoreB} onChange={(e) => setScoreB(e.target.value)} />
        </div>
        <div className="mb-2 text-xs text-gray-500">Update sides (tap to toggle; need {reqTeam} per side)</div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border p-2">
            <div className="mb-1 text-xs font-medium">Side A</div>
            <div className="flex flex-wrap gap-1">
              {allIds.map((id) => (
                <button key={`A-${id}`} onClick={() => toggleIn('A', id)} className={`rounded border px-2 py-0.5 text-xs ${sideA.includes(id) ? 'bg-gray-200' : ''}`}>{nameOf(id)}</button>
              ))}
            </div>
          </div>
          <div className="rounded-xl border p-2">
            <div className="mb-1 text-xs font-medium">Side B</div>
            <div className="flex flex-wrap gap-1">
              {allIds.map((id) => (
                <button key={`B-${id}`} onClick={() => toggleIn('B', id)} className={`rounded border px-2 py-0.5 text-xs ${sideB.includes(id) ? 'bg-gray-200' : ''}`}>{nameOf(id)}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="mb-3">
          <Input label="Duration (seconds)" type="number" inputMode="numeric" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border px-3 py-1.5 text-sm">Cancel</button>
          <button
            onClick={() => {
              if (!scoreValid || !validSides) return;
              updateGame(session.id, game.id, {
                scoreA: Number(scoreA),
                scoreB: Number(scoreB),
                sideA,
                sideB,
                durationMs: duration.trim() === '' ? undefined : Math.max(0, Math.floor(Number(duration) * 1000))
              });
              onClose();
            }}
            disabled={!scoreValid || !validSides}
            className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function BlacklistEditor({ session }: { session: Session }) {
  const addPair = useStore((s) => s.addBlacklistPair);
  const removePair = useStore((s) => s.removeBlacklistPair);
  const [a, setA] = React.useState<string>("");
  const [b, setB] = React.useState<string>("");
  const pairs = session.autoAssignBlacklist?.pairs || [];
  const players = session.players;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!a || !b || a === b) return;
    addPair(session.id, a, b);
    setA("");
    setB("");
  };
  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select value={a} onChange={setA}>
          <option value="">Select player A</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <Select value={b} onChange={setB}>
          <option value="">Select player B</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <button type="submit" className="rounded-xl bg-black px-3 py-2 text-sm text-white disabled:opacity-50" disabled={!a || !b || a === b}>Add blacklist</button>
      </form>
      {pairs.length === 0 ? (
        <div className="text-xs text-gray-500">No blacklisted pairs.
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {pairs.map((p, i) => {
            const na = players.find((x) => x.id === p.a)?.name || "(deleted)";
            const nb = players.find((x) => x.id === p.b)?.name || "(deleted)";
            return (
              <li key={`${p.a}-${p.b}-${i}`} className="flex items-center justify-between px-2 py-1.5 text-sm">
                <div className="truncate">{na} × {nb}</div>
                <button onClick={() => removePair(session.id, p.a, p.b)} className="rounded border px-2 py-0.5 text-xs">Remove</button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="text-[11px] text-gray-500">Blacklisted pairs will be strongly avoided in doubles auto-assign.</div>
    </div>
  );
}

function ExcludeEditor({ session }: { session: Session }) {
  const [sel, setSel] = React.useState<string>("");
  const players = session.players;
  const current = new Set(session.autoAssignExclude || []);
  const update = (ids: string[]) => {
    useStore.setState((state) => ({
      sessions: state.sessions.map((ss) => ss.id === session.id ? { ...ss, autoAssignExclude: ids } : ss)
    }));
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sel) return;
    if (current.has(sel)) return;
    update([...(session.autoAssignExclude || []), sel]);
    setSel("");
  };
  const remove = (id: string) => {
    update((session.autoAssignExclude || []).filter((x) => x !== id));
  };
  return (
    <div className="space-y-2">
      <form onSubmit={add} className="flex items-center gap-2">
        <Select value={sel} onChange={setSel}>
          <option value="">Select player</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <button type="submit" className="rounded-xl bg-black px-3 py-1.5 text-xs text-white">Exclude</button>
      </form>
      {current.size === 0 ? (
        <div className="text-xs text-gray-500">No excluded players.</div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {Array.from(current).map((id) => {
            const n = players.find((p) => p.id === id)?.name || '(deleted)';
            return (
              <li key={id} className="flex items-center justify-between px-2 py-1.5 text-sm">
                <div className="truncate">{n}</div>
                <button onClick={() => remove(id)} className="rounded border px-2 py-0.5 text-xs">Remove</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BalanceGenderToggle({ session }: { session: Session }) {
  const enabled = session.autoAssignConfig?.balanceGender ?? true;
  const update = (checked: boolean) => {
    useStore.setState((state) => ({
      sessions: state.sessions.map((ss) => ss.id === session.id ? { ...ss, autoAssignConfig: { ...(ss.autoAssignConfig || {}), balanceGender: checked } } : ss)
    }));
  };
  return (
    <label className="flex items-center justify-between rounded-xl border border-gray-200 p-2">
      <span className="text-sm">Balance gender on doubles</span>
      <input type="checkbox" className="h-4 w-4" checked={enabled} onChange={(e) => update(e.target.checked)} />
    </label>
  );
}

function AutoAssignSettingsButton({ session }: { session: Session }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">Auto-assign settings</button>
      <AutoAssignSettingsModal open={open} session={session} onClose={() => setOpen(false)} />
    </>
  );
}

function AutoAssignSettingsModal({ open, session, onClose }: { open: boolean; session: Session; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose}></div>
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg max-h-[90vh] overflow-auto">
        <div className="mb-2 text-base font-semibold">Auto-assign settings</div>
        <div className="mb-3 text-xs text-gray-500">Configure the rules used when auto-assigning players to courts.</div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-sm font-medium">Basic</div>
            <div className="mb-2 text-[11px] text-gray-500">Quick toggles to influence auto-assign behavior.</div>
            <BalanceGenderToggle session={session} />
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">Blacklist pairs (doubles)</div>
            <div className="mb-2 text-[11px] text-gray-500">Avoid specific pairings when forming doubles teams.</div>
            <BlacklistEditor session={session} />
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">Excluded players</div>
            <div className="mb-2 text-[11px] text-gray-500">Players in this list will be ignored by auto-assign.</div>
            <ExcludeEditor session={session} />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end">
          <button onClick={onClose} className="rounded-xl border px-3 py-1.5 text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}

function LinkToMeButton({ sessionId, playerId }: { sessionId: string; playerId: string }) {
  const [linking, setLinking] = useState(false);
  const linkPlayerToAccount = useStore((s) => s.linkPlayerToAccount);
  const sessions = useStore((s) => s.sessions);
  return (
    <button
      onClick={async () => {
        if (!auth.currentUser) return;
        // enforce one player per account per session
        const ss = sessions.find((s) => s.id === sessionId);
        if (ss && ss.players.some((pp) => pp.accountUid === auth.currentUser!.uid)) return;
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
      {linking ? 'Linking…' : 'Link to me'}
    </button>
  );
}

function UnlinkMeButton({ sessionId, playerId, onUnlinked }: { sessionId: string; playerId: string; onUnlinked?: () => void }) {
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
          const ownerUid = (window as any).__sessionOwners?.get?.(sessionId) || null;
          const inferredOwnerUid = ownerUid as (string | null);
          const isOwner = inferredOwnerUid ? inferredOwnerUid === auth.currentUser.uid : false;
          if (isOwner) {
            await organizerUnlinkPlayer(auth.currentUser.uid, sessionId, playerId);
          } else {
            const organizerUid = inferredOwnerUid || undefined;
            if (organizerUid) {
              await unlinkAccountInOrganizerSession(organizerUid, sessionId, playerId, auth.currentUser.uid);
            }
          }
          unlinkPlayerFromAccount(sessionId, playerId);
          if (!isOwner && typeof onUnlinked === 'function') onUnlinked();
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy || !auth.currentUser}
      className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs disabled:opacity-50"
    >
      {busy ? 'Unlinking…' : 'Unlink'}
    </button>
  );
}

function OrganizerUnlinkButton({ organizerUid, sessionId, playerId }: { organizerUid: string; sessionId: string; playerId: string }) {
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
      {busy ? 'Unlink…' : 'Unlink'}
    </button>
  );
}

function ShareClaimsButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button onClick={() => setOpen(true)} className="ml-2 rounded-lg border border-gray-300 px-2 py-1 text-xs">Share claim QR</button>
  );
}

function ClaimQrButton({ sessionId, playerId, playerName, forceOpen, onClose }: { sessionId: string; playerId: string; playerName: string; forceOpen?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrSize, setQrSize] = useState(240);
  const organizerUid = auth.currentUser?.uid || '';
  const url = `${typeof location !== 'undefined' ? location.origin : ''}?claim=1&ouid=${encodeURIComponent(organizerUid)}&sid=${encodeURIComponent(sessionId)}&pid=${encodeURIComponent(playerId)}`;
  return (
    <>
      {!forceOpen && (
        <button onClick={() => setOpen(true)} className="rounded-xl border px-2 py-1 text-xs">QR</button>
      )}
      {(forceOpen || open) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[90vw] max-w-md md:max-w-lg lg:max-w-xl max-h-[85vh] overflow-auto rounded-2xl bg-white p-4 shadow">
            <div className="mb-1 text-sm font-semibold">Link your account to:</div>
            <div className="mb-2 text-base font-bold">{playerName}</div>
            <div className="mb-3 text-xs text-gray-600">By linking, your account will be attached to this player for this session.</div>
            <div className="mx-auto mb-2 flex items-center justify-center">
              <QRCodeSVG value={url} size={qrSize} includeMargin={true} />
            </div>
            <div className="rounded border bg-gray-50 p-2 text-xs break-all">{url}</div>
            <div className="mt-3 flex items-center justify-end gap-2">
              {copied && <span className="mr-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">Copied!</span>}
              <button onClick={async () => { try { await navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {} }} className="rounded bg-black px-2 py-1 text-xs text-white" >Copy</button>
              <button onClick={() => { if (forceOpen) { onClose && onClose(); } else { setOpen(false); } }} className="rounded border px-2 py-1 text-xs">Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RowKebabMenu({ session, player, inGame, isOrganizer, organizerUid, linkPlayerToAccount, removePlayer }: { session: Session; player: Player; inGame: boolean; isOrganizer: boolean; organizerUid?: string | null; linkPlayerToAccount: (sid: string, pid: string, uid: string) => void; removePlayer: (sid: string, pid: string) => void }) {
  const [showQr, setShowQr] = useState(false);
  const alreadyLinkedToMe = !!auth.currentUser?.uid && session.players.some(pp => pp.accountUid === auth.currentUser!.uid);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const closeMenu = () => { try { menuRef.current?.removeAttribute('open'); } catch {} };
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const el = menuRef.current;
      if (!el || !el.open) return;
      if (!el.contains(e.target as Node)) {
        try { el.removeAttribute('open'); } catch {}
      }
    }
    document.addEventListener('mousedown', onDocClick, true);
    return () => document.removeEventListener('mousedown', onDocClick, true);
  }, []);
  return (
    <>
      <details ref={menuRef} className="relative">
        <summary className="cursor-pointer list-none px-2 py-1 text-md font-bold">⋮</summary>
        <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border bg-white p-1 text-sm shadow">
          {!player.accountUid && !alreadyLinkedToMe && (
            <button
              className="w-full rounded px-2 py-1 text-left hover:bg-gray-50"
              onClick={() => {
                const uid = auth.currentUser?.uid;
                if (!uid) return;
                if (!session.players.some(pp => pp.accountUid === uid)) linkPlayerToAccount(session.id, player.id, uid);
                closeMenu();
              }}
            >
              Link to me
            </button>
          )}
          {(!player.accountUid) && (
            <button
              className="w-full rounded px-2 py-1 text-left hover:bg-gray-50"
              onClick={() => { setShowQr(true); closeMenu(); }}
            >
              Show QR
            </button>
          )}
          {player.accountUid && (
            (auth.currentUser?.uid === player.accountUid) ? (
              <button
                className="w-full rounded px-2 py-1 text-left hover:bg-gray-50"
                onClick={async () => {
                  const owner = organizerUid || (window as any).__sessionOwners?.get?.(session.id);
                  if (owner && auth.currentUser?.uid !== owner) await unlinkAccountInOrganizerSession(owner, session.id, player.id, auth.currentUser!.uid);
                  else if (auth.currentUser) await organizerUnlinkPlayer(auth.currentUser.uid, session.id, player.id);
                  closeMenu();
                }}
              >
                Unlink
              </button>
            ) : (
              isOrganizer && organizerUid ? (
                <button
                  className="w-full rounded px-2 py-1 text-left hover:bg-gray-50"
                  onClick={async () => { await organizerUnlinkPlayer(organizerUid, session.id, player.id); closeMenu(); }}
                >
                  Unlink
                </button>
              ) : null
            )
          )}
          <button
            className="w-full rounded px-2 py-1 text-left hover:bg-gray-50 disabled:opacity-50"
            disabled={inGame}
            onClick={() => { removePlayer(session.id, player.id); closeMenu(); }}
          >
            Remove
          </button>
        </div>
      </details>
      {showQr && (
        <ClaimQrButton forceOpen sessionId={session.id} playerId={player.id} playerName={player.name} onClose={() => setShowQr(false)} />
      )}
    </>
  );
}
