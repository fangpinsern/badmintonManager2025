/* eslint-disable */

"use client";
import React, { useMemo, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
 

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
// Types
// -----------------------------

type Player = { id: string; name: string; gamesPlayed?: number };

type Court = { id: string; index: number; playerIds: string[]; pairA: string[]; pairB: string[]; inProgress?: boolean; startedAt?: string; mode?: 'singles' | 'doubles' };

type Game = {
  id: string;
  courtIndex: number;
  endedAt: string; // ISO timestamp
  startedAt?: string; // ISO timestamp
  durationMs?: number; // derived when known
  sideA: string[]; // player IDs on side A
  sideB: string[]; // player IDs on side B
  sideAPlayers: { id: string; name: string }[]; // snapshot of names at game end
  sideBPlayers: { id: string; name: string }[]; // snapshot of names at game end
  scoreA: number; // side A points
  scoreB: number; // side B points
  winner: 'A' | 'B' | 'draw';
  players: string[]; // snapshot A+B (ids)
};

type PlayerAggregate = {
  playerId: string;
  name: string;
  wins: number;
  losses: number;
  games: number;
  points: number;
  winRate: number;
};

type SessionStats = {
  totalGames: number;
  leaderboard: PlayerAggregate[]; // sorted by wins desc, then winRate desc
  topWinner?: PlayerAggregate;
  topLoser?: PlayerAggregate; // fewest wins among players who played >= 1
  topScorer?: { playerId: string; name: string; points: number };
  mostActive?: { playerId: string; name: string; games: number };
  bestPair?: { pair: string[]; names: string[]; wins: number };
  longestDuration?: { playerIds: string[]; names: string[]; durationMs: number };
  mostIntenseGame?: {
    gameId: string;
    courtIndex: number;
    endedAt: string;
    totalPoints: number;
    durationMs: number;
    secondsPerPoint: number;
    scoreA: number;
    scoreB: number;
    namesA: string[];
    namesB: string[];
  };
  shuttlesUsed?: number;
};

type Session = {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  numCourts: number;
  playersPerCourt: number; // default 4
  players: Player[];
  courts: Court[];
  games: Game[];
  ended?: boolean;
  endedAt?: string;
  stats?: SessionStats;
};

// -----------------------------
// Store
// -----------------------------

interface StoreState {
  sessions: Session[];
  createSession: (args: {
    date: string;
    time: string;
    numCourts: number;
    playersPerCourt?: number;
  }) => string; // returns new sessionId
  deleteSession: (sessionId: string) => void;
  addPlayer: (sessionId: string, name: string) => void;
  removePlayer: (sessionId: string, playerId: string) => void;
  assignPlayerToCourt: (
    sessionId: string,
    playerId: string,
    courtIndex: number | null
  ) => void; // null => unassign
  setPlayerPair: (
    sessionId: string,
    courtIndex: number,
    playerId: string,
    pair: 'A' | 'B' | null
  ) => void;
  endGame: (sessionId: string, courtIndex: number, scoreA: number, scoreB: number) => void;
  endSession: (sessionId: string, shuttlesUsed?: number) => void;
  startGame: (sessionId: string, courtIndex: number) => void;
  setCourtMode: (sessionId: string, courtIndex: number, mode: 'singles' | 'doubles') => void;
}

const useStore = create<StoreState>()(
  persist(
    (set, _get) => ({
      sessions: [],

      createSession: ({ date, time, numCourts, playersPerCourt = 4 }) => {
        const id = nanoid(10);
        const courts: Court[] = Array.from({ length: Math.max(1, numCourts) }, (_, i) => ({
          id: nanoid(8),
          index: i,
          playerIds: [],
          pairA: [],
          pairB: [],
          inProgress: false,
          mode: 'doubles',
        }));
        const session: Session = {
          id,
          date,
          time,
          numCourts: Math.max(1, numCourts),
          playersPerCourt: 4,
          players: [],
          courts,
          games: [],
          ended: false,
        };
        set((s) => ({ sessions: [session, ...s.sessions] }));
        return id;
      },

      deleteSession: (sessionId) =>
        set((s) => ({ sessions: s.sessions.filter((ss) => ss.id !== sessionId) })),

      addPlayer: (sessionId, name) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const trimmed = name.trim();
            if (!trimmed) return ss;
            const newP: Player = { id: nanoid(8), name: trimmed };
            return { ...ss, players: [...ss.players, newP] };
          }),
        })),

      removePlayer: (sessionId, playerId) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            // remove from any court first
            const courts = ss.courts.map((c) => {
              if (c.inProgress && c.playerIds.includes(playerId)) return c; // lock while in progress
              return {
                ...c,
                playerIds: c.playerIds.filter((pid) => pid !== playerId),
                pairA: (c.pairA || []).filter((pid) => pid !== playerId),
                pairB: (c.pairB || []).filter((pid) => pid !== playerId),
              };
            });
            const players = ss.players.filter((p) => p.id !== playerId);
            return { ...ss, courts, players };
          }),
        })),

      assignPlayerToCourt: (sessionId, playerId, courtIndex) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const currentIdx = ss.courts.findIndex((c) => c.playerIds.includes(playerId));
            if (currentIdx !== -1 && ss.courts[currentIdx]?.inProgress) return ss; // can't move out of active court
            // remove from any previous court
            let courts = ss.courts.map((c) => ({
              ...c,
              playerIds: c.playerIds.filter((pid) => pid !== playerId),
            }));
            if (courtIndex === null) {
              return { ...ss, courts };
            }
            // place into target court if capacity allows
            const target = courts[courtIndex];
            if (!target) return ss; // invalid index; ignore
            if (target.inProgress) return ss; // lock target while active
            const mode = (target.mode || 'doubles');
            const cap = mode === 'singles' ? 2 : 4;
            if (target.playerIds.length >= cap) {
              // court full, do nothing
              return { ...ss, courts };
            }
            const updated = {
              ...target,
              playerIds: [...target.playerIds, playerId],
            };
            courts = courts.map((c, i) => (i === courtIndex ? updated : c));
            return { ...ss, courts };
          }),
        })),

      setPlayerPair: (sessionId, courtIndex, playerId, pair) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const courts = ss.courts.map((c, i) => {
              if (i !== courtIndex) return c;
              if (c.inProgress) return c; // lock while in progress
              if (!c.playerIds.includes(playerId)) return c; // must be on this court
              let pairA = (c.pairA || []).filter((pid) => pid !== playerId);
              let pairB = (c.pairB || []).filter((pid) => pid !== playerId);
              if (pair === 'A' && pairA.length < 2) pairA = [...pairA, playerId];
              if (pair === 'B' && pairB.length < 2) pairB = [...pairB, playerId];
              return { ...c, pairA, pairB };
            });
            return { ...ss, courts };
          }),
        })),

      endGame: (sessionId, courtIndex, scoreA, scoreB) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const target = ss.courts[courtIndex];
            if (!target) return ss;
            if (!target.inProgress) return ss; // must be started
            const sideA = [...(target.pairA || [])];
            const sideB = [...(target.pairB || [])];
            const snapshot = [...sideA, ...sideB];
            const a = Number.isFinite(scoreA) ? Math.max(0, Math.floor(scoreA)) : NaN;
            const b = Number.isFinite(scoreB) ? Math.max(0, Math.floor(scoreB)) : NaN;
            if (Number.isNaN(a) || Number.isNaN(b)) return ss;
            const winner = a > b ? 'A' : b > a ? 'B' : 'draw';
            const endedAt = new Date();
            const startedAt = target.startedAt ? new Date(target.startedAt) : undefined;
            const durationMs = startedAt ? Math.max(0, endedAt.getTime() - startedAt.getTime()) : undefined;
            const game: Game = {
              id: nanoid(8),
              courtIndex,
              endedAt: endedAt.toISOString(),
              startedAt: target.startedAt,
              durationMs,
              sideA,
              sideB,
              sideAPlayers: sideA.map((pid) => ({ id: pid, name: (ss.players.find((pp) => pp.id === pid)?.name || '(deleted)') })),
              sideBPlayers: sideB.map((pid) => ({ id: pid, name: (ss.players.find((pp) => pp.id === pid)?.name || '(deleted)') })),
              scoreA: a,
              scoreB: b,
              winner,
              players: snapshot,
            };
            const courts = ss.courts.map((c, i) => (
              i === courtIndex ? { ...c, playerIds: [], pairA: [], pairB: [], inProgress: false, startedAt: undefined } : c
            ));
            const games = [game, ...((ss as any).games || [])];
            const players = ss.players.map((p) =>
              snapshot.includes(p.id) ? { ...p, gamesPlayed: (p.gamesPlayed ?? 0) + 1 } : p
            );
            return { ...ss, courts, games, players };
          }),
        })),

      startGame: (sessionId, courtIndex) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const c = ss.courts[courtIndex];
            if (!c) return ss;
            if (c.inProgress) return ss;
            const isSingles = (c.mode || 'doubles') === 'singles';
            const requiredPerTeam = isSingles ? 1 : 2;
            const ready = (c.pairA?.length || 0) === requiredPerTeam && (c.pairB?.length || 0) === requiredPerTeam;
            const filled = c.playerIds.length === (requiredPerTeam * 2);
            if (!ready || !filled) return ss;
            const courts = ss.courts.map((cc, i) => (i === courtIndex ? { ...cc, inProgress: true, startedAt: new Date().toISOString() } : cc));
            return { ...ss, courts };
          }),
        })),

      setCourtMode: (sessionId, courtIndex, mode) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            const courts = ss.courts.map((c, i) => {
              if (i !== courtIndex) return c;
              if (c.inProgress) return c;
              // when switching modes, trim playerIds to capacity and clear pairs to avoid invalid sizes
              const cap = mode === 'singles' ? 2 : 4;
              const kept = c.playerIds.slice(0, cap);
              return { ...c, mode, playerIds: kept, pairA: [], pairB: [] };
            });
            return { ...ss, courts };
          }),
        })),

      endSession: (sessionId, shuttlesUsed) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            if ((ss.courts || []).some((c) => c.inProgress)) return ss; // block if any game in progress
            const stats = { ...computeSessionStats(ss), shuttlesUsed: typeof shuttlesUsed === 'number' && isFinite(shuttlesUsed) && shuttlesUsed >= 0 ? Math.floor(shuttlesUsed) : undefined };
            return { ...ss, ended: true, endedAt: new Date().toISOString(), stats };
          }),
        })),

    }),
    { name: "badminton-manager" }
  )
);

// -----------------------------
// Helpers
// -----------------------------

function useSession(sessionId: string | null) {
  const sessions = useStore((s) => s.sessions);
  return useMemo(() => sessions.find((s) => s.id === sessionId) || null, [sessions, sessionId]);
}

function getPlayerCourtIndex(session: Session, playerId: string): number | null {
  const idx = session.courts.findIndex((c) => c.playerIds.includes(playerId));
  return idx === -1 ? null : idx;
}

function formatDuration(ms?: number): string {
  if (!ms && ms !== 0) return '';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function computeSessionStats(ss: Session): SessionStats {
  const playerById = new Map<string, Player>();
  ss.players.forEach((p) => playerById.set(p.id, p));

  const aggregates = new Map<string, PlayerAggregate>();
  const ensure = (pid: string) => {
    if (!aggregates.has(pid)) {
      const name = playerById.get(pid)?.name || '(deleted)';
      aggregates.set(pid, { playerId: pid, name, wins: 0, losses: 0, games: 0, points: 0, winRate: 0 });
    }
    return aggregates.get(pid)!;
  };

  const pairWins = new Map<string, { pair: string[]; wins: number }>();
  const keyForPair = (pair: string[]) => [...pair].sort().join('|');

  for (const g of ss.games) {
    const a = g.sideA;
    const b = g.sideB;
    const winner = g.winner;
    // increment games for participants
    for (const pid of [...a, ...b]) ensure(pid).games += 1;
    // add scored points to each player on that side
    for (const pid of a) ensure(pid).points += g.scoreA;
    for (const pid of b) ensure(pid).points += g.scoreB;
    if (winner === 'A') {
      for (const pid of a) ensure(pid).wins += 1;
      for (const pid of b) ensure(pid).losses += 1;
      if (a.length === 2) {
        const k = keyForPair(a);
        const prev = pairWins.get(k) || { pair: [...a].sort(), wins: 0 };
        prev.wins += 1;
        pairWins.set(k, prev);
      }
    } else if (winner === 'B') {
      for (const pid of b) ensure(pid).wins += 1;
      for (const pid of a) ensure(pid).losses += 1;
      if (b.length === 2) {
        const k = keyForPair(b);
        const prev = pairWins.get(k) || { pair: [...b].sort(), wins: 0 };
        prev.wins += 1;
        pairWins.set(k, prev);
      }
    }
  }

  // finalize winRate
  for (const agg of aggregates.values()) {
    agg.winRate = agg.games > 0 ? agg.wins / agg.games : 0;
  }

  const leaderboard = Array.from(aggregates.values()).sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    if (y.winRate !== x.winRate) return y.winRate - x.winRate;
    if (y.points !== x.points) return y.points - x.points;
    return (y.games - x.games);
  });

  const played = leaderboard.filter((p) => p.games > 0);
  const topWinner = played[0];
  let topLoser: PlayerAggregate | undefined = undefined;
  if (played.length) {
    const minWins = Math.min(...played.map((p) => p.wins));
    const losers = played.filter((p) => p.wins === minWins);
    losers.sort((x, y) => {
      if (y.losses !== x.losses) return y.losses - x.losses; // more losses is "worse"
      if (x.winRate !== y.winRate) return x.winRate - y.winRate; // lower winRate first
      return x.points - y.points; // fewer points first
    });
    topLoser = losers[0];
  }

  const topScorer = played.length
    ? played.reduce((acc, cur) => (cur.points > acc.points ? cur : acc))
    : undefined;
  const mostActive = played.length
    ? played.reduce((acc, cur) => (cur.games > acc.games ? cur : acc))
    : undefined;

  let bestPair: SessionStats['bestPair'] = undefined;
  if (pairWins.size) {
    const best = Array.from(pairWins.values()).sort((a, b) => b.wins - a.wins)[0];
    const names = best.pair.map((pid) => playerById.get(pid)?.name || '(deleted)');
    bestPair = { pair: best.pair, names, wins: best.wins };
  }

  // Longest duration game (by durationMs)
  let longestDuration: SessionStats['longestDuration'] = undefined;
  const gamesWithDuration = ss.games.filter((g) => typeof g.durationMs === 'number' && (g.durationMs as number) > 0);
  if (gamesWithDuration.length) {
    const longest = gamesWithDuration.reduce((acc, cur) => (cur.durationMs! > (acc.durationMs || 0) ? cur : acc));
    const names = [...(longest.sideAPlayers?.map((p) => p.name) || longest.sideA.map((pid) => playerById.get(pid)?.name || '(deleted)')),
                   ...(longest.sideBPlayers?.map((p) => p.name) || longest.sideB.map((pid) => playerById.get(pid)?.name || '(deleted)'))];
    longestDuration = { playerIds: longest.players || [...longest.sideA, ...longest.sideB], names, durationMs: longest.durationMs! };
  }

  // Most intense game = highest (total points / minutes)
  let mostIntenseGame: SessionStats['mostIntenseGame'] = undefined;
  if (gamesWithDuration.length) {
    const enriched = gamesWithDuration.map((g) => {
      const secs = Math.max(1, (g.durationMs as number) / 1000); // avoid divide by zero
      const totalPoints = Math.max(1, (g.scoreA || 0) + (g.scoreB || 0)); // avoid divide by zero
      const sp = secs / totalPoints; // seconds per point (lower is more intense)
      return { g, sp, totalPoints };
    });
    const top = enriched.sort((a, b) => b.sp - a.sp)[0];
    mostIntenseGame = {
      gameId: top.g.id,
      courtIndex: top.g.courtIndex,
      endedAt: top.g.endedAt,
      totalPoints: top.totalPoints,
      durationMs: top.g.durationMs!,
      secondsPerPoint: top.sp,
      scoreA: top.g.scoreA,
      scoreB: top.g.scoreB,
      namesA: (top.g.sideAPlayers?.map((p) => p.name) || top.g.sideA.map((pid) => playerById.get(pid)?.name || '(deleted)')),
      namesB: (top.g.sideBPlayers?.map((p) => p.name) || top.g.sideB.map((pid) => playerById.get(pid)?.name || '(deleted)')),
    };
  }

  return {
    totalGames: ss.games.length,
    leaderboard,
    topWinner,
    topLoser,
    topScorer: topScorer ? { playerId: topScorer.playerId, name: topScorer.name, points: topScorer.points } : undefined,
    mostActive: mostActive ? { playerId: mostActive.playerId, name: mostActive.name, games: mostActive.games } : undefined,
    bestPair,
    longestDuration,
    mostIntenseGame,
  };
}

// -----------------------------
// UI
// -----------------------------

export default function Page() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selected = useSession(selectedSessionId);

  return (
    <main className="mx-auto max-w-md p-4 text-sm">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">🏸 Badminton Manager</h1>
        <p className="text-gray-500">Create sessions, add players, assign courts.</p>
      </header>

      {!selected && (
        <div className="space-y-6">
          <SessionForm onCreated={setSelectedSessionId} />
          <SessionList onOpen={setSelectedSessionId} />
        </div>
      )}

      {selected && (
        <SessionManager session={selected} onBack={() => setSelectedSessionId(null)} />
      )}

      <footer className="mt-12 text-center text-xs text-gray-400">
        <p>Data is saved locally in your browser.</p>
      </footer>
    </main>
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
              <div className="font-medium">{formatSessionTitle(ss)}</div>
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

function SessionManager({ session, onBack }: { session: Session; onBack: () => void }) {
  const addPlayer = useStore((s) => s.addPlayer);
  const removePlayer = useStore((s) => s.removePlayer);
  const assign = useStore((s) => s.assignPlayerToCourt);
  const endSession = useStore((s) => s.endSession);

  const [name, setName] = useState("");

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
    const clone = [...session.players];
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
  }, [session.players, inGameIdSet]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    addPlayer(session.id, name.trim());
    setName("");
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-gray-600">← Back</button>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{formatSessionTitle(session)}</h2>
            <p className="text-xs text-gray-500">
              {session.numCourts} court{session.numCourts > 1 ? "s" : ""} · {(session.courts || []).filter((c) => (c.mode || 'doubles') === 'doubles').length} doubles, {(session.courts || []).filter((c) => (c.mode || 'doubles') === 'singles').length} singles
            </p>
            {session.ended && (
              <div className="mt-1 text-[11px] text-emerald-700">Ended{session.endedAt ? ` · ${new Date(session.endedAt).toLocaleString()}` : ''}</div>
            )}
          </div>
          {!session.ended && (
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
          <h3 className="mb-2 text-base font-semibold">Session statistics</h3>
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
        <form onSubmit={add} className="flex gap-2">
          <Input
            placeholder="Player name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1"
            disabled={!!session.ended}
          />
          <button type="submit" disabled={!!session.ended} className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50">Add</button>
        </form>
      </Card>

      {/* Players and Courts */}
        <Card>
          <h3 className="mb-3 text-base font-semibold">Players</h3>
          {session.players.length === 0 ? (
            <p className="text-gray-500">No players yet. Add some above.</p>
          ) : (
            <div className="space-y-2">
              {sortedPlayers.map((p) => {
                const currentIdx = getPlayerCourtIndex(session, p.id);
                const inGame = inGameIdSet.has(p.id);
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2">
                    <div className="truncate font-medium">{p.name}<span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{p.gamesPlayed ?? 0} games</span>{inGame && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700">in game</span>}</div>
                    <div className="flex items-center gap-2">
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
                          const label = (court?.mode || 'doubles') === 'singles' ? 'Singles' : 'Doubles';
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
                      <button
                        onClick={() => removePlayer(session.id, p.id)}
                        disabled={!!session.ended || inGame}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 disabled:opacity-50"
                      >
                        Remove
                      </button>
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
            <span className="text-xs text-gray-500">Unassigned: {unassigned.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {session.courts.map((court, idx) => (
              <CourtCard key={court.id} session={session} court={court} idx={idx} />
            ))}
          </div>
        </Card>


      <Card>
        <h3 className="mb-3 text-base font-semibold">Games</h3>
        {(!session.games || session.games.length === 0) ? (
          <p className="text-gray-500">No games recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {session.games.map((g) => (
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
                  Score: {g.scoreA}–{g.scoreB} · Winner: {g.winner}
                </div>
                <div className="mt-1 text-xs text-gray-500 truncate">
                  A: {(g.sideAPlayers && g.sideAPlayers.length ? g.sideAPlayers.map((p) => p.name) : g.sideA.map((pid) => session.players.find((pp) => pp.id === pid)?.name || '(deleted)')).join(' & ')}<br/>
                  B: {(g.sideBPlayers && g.sideBPlayers.length ? g.sideBPlayers.map((p) => p.name) : g.sideB.map((pid) => session.players.find((pp) => pp.id === pid)?.name || '(deleted)')).join(' & ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------
// CourtCard (per-court UI + End Game with pair assignment + Drag & Drop)
// ---------------------------------
function CourtCard({ session, court, idx }: { session: Session; court: Court; idx: number }) {
  const endGame = useStore((s) => s.endGame);
  const setPair = useStore((s) => s.setPlayerPair);
  const assign = useStore((s) => s.assignPlayerToCourt);
  const startGame = useStore((s) => s.startGame);
  const setCourtMode = useStore((s) => s.setCourtMode);

  const canEndAny = court.playerIds.length > 0;
  const pairA = court.pairA || [];
  const pairB = court.pairB || [];
  const isSingles = (court.mode || 'doubles') === 'singles';
  const requiredPerTeam = isSingles ? 1 : 2;
  const ready = pairA.length === requiredPerTeam && pairB.length === requiredPerTeam;
  const available = court.playerIds.filter((pid) => !pairA.includes(pid) && !pairB.includes(pid));
  const isFull = court.playerIds.length === (requiredPerTeam * 2);

  const [open, setOpen] = useState(false);
  const [scoreA, setScoreA] = useState<string>("");
  const [scoreB, setScoreB] = useState<string>("");
  const scoreValid = scoreA.trim() !== "" && scoreB.trim() !== "" && !Number.isNaN(Number(scoreA)) && !Number.isNaN(Number(scoreB));

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
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-semibold">Court {idx + 1}</div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-500">
            {court.playerIds.length}/{(court.mode || 'doubles') === 'singles' ? 2 : 4}
          </div>
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
              disabled={!ready || !isFull || !!session.ended}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 disabled:opacity-50"
            >
              Start game
            </button>
          ) : (
            <button
              onClick={() => setOpen((v) => !v)}
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
          <div className="mb-1 text-xs font-medium">Pair A ({pairA.length}/{requiredPerTeam})</div>
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
                  <button onClick={() => setPair(session.id, idx, pid, null)} className="text-[10px] text-gray-600">×</button>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium">Pair B ({pairB.length}/{requiredPerTeam})</div>
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
                  <button onClick={() => setPair(session.id, idx, pid, null)} className="text-[10px] text-gray-600">×</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

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
                    <button
                      onClick={() => setPair(session.id, idx, pid, 'B')}
                      disabled={!canAddB}
                      className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                    >
                      B
                    </button>
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

      {open && (
        <div className="mt-3 border-t pt-3">
          <div className="mb-2 text-xs text-gray-500">Record score (Pair A vs Pair B)</div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              label="Pair A"
              placeholder="21"
              inputMode="numeric"
              min={0}
              value={scoreA}
              onChange={(e) => setScoreA(e.target.value)}
            />
            <Input
              type="number"
              label="Pair B"
              placeholder="18"
              inputMode="numeric"
              min={0}
              value={scoreB}
              onChange={(e) => setScoreB(e.target.value)}
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={onSave} disabled={!ready || !scoreValid || !!session.ended} className="rounded-xl bg-black px-3 py-1.5 text-xs text-white disabled:opacity-50">Save & Clear</button>
            <button onClick={() => setOpen(false)} className="rounded-xl border px-3 py-1.5 text-xs">Cancel</button>
          </div>
          {!ready && <div className="mt-2 text-[11px] text-amber-600">Need exactly 2 players in Pair A and Pair B.</div>}
          {ready && !scoreValid && <div className="mt-2 text-[11px] text-amber-600">Enter both scores.</div>}
        </div>
      )}
    </div>
  );
}

// Drag & Drop removed

function EndSessionModal({ open, title, shuttles, onShuttlesChange, onCancel, onConfirm }: { open: boolean; title: string; shuttles: string; onShuttlesChange: (v: string) => void; onCancel: () => void; onConfirm: () => void; }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel}></div>
      <div className="relative w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-lg sm:rounded-2xl">
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
