/* eslint-disable */

"use client";
import React, { useMemo, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { DndContext, useDroppable, useDraggable, PointerSensor, TouchSensor, useSensors, useSensor } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";

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

type Court = { id: string; index: number; playerIds: string[]; pairA: string[]; pairB: string[] };

type Game = {
  id: string;
  courtIndex: number;
  endedAt: string; // ISO timestamp
  sideA: string[]; // player IDs on side A
  sideB: string[]; // player IDs on side B
  sideAPlayers: { id: string; name: string }[]; // snapshot of names at game end
  sideBPlayers: { id: string; name: string }[]; // snapshot of names at game end
  scoreA: number; // side A points
  scoreB: number; // side B points
  winner: 'A' | 'B' | 'draw';
  players: string[]; // snapshot A+B (ids)
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
        }));
        const session: Session = {
          id,
          date,
          time,
          numCourts: Math.max(1, numCourts),
          playersPerCourt: Math.max(1, playersPerCourt),
          players: [],
          courts,
          games: [],
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
            // remove from any court first
            const courts = ss.courts.map((c) => ({
              ...c,
              playerIds: c.playerIds.filter((pid) => pid !== playerId),
              pairA: (c.pairA || []).filter((pid) => pid !== playerId),
              pairB: (c.pairB || []).filter((pid) => pid !== playerId),
            }));
            const players = ss.players.filter((p) => p.id !== playerId);
            return { ...ss, courts, players };
          }),
        })),

      assignPlayerToCourt: (sessionId, playerId, courtIndex) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
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
            if (target.playerIds.length >= ss.playersPerCourt) {
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
            const courts = ss.courts.map((c, i) => {
              if (i !== courtIndex) return c;
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
            const target = ss.courts[courtIndex];
            if (!target) return ss;
            const sideA = [...(target.pairA || [])];
            const sideB = [...(target.pairB || [])];
            const snapshot = [...sideA, ...sideB];
            const a = Number.isFinite(scoreA) ? Math.max(0, Math.floor(scoreA)) : NaN;
            const b = Number.isFinite(scoreB) ? Math.max(0, Math.floor(scoreB)) : NaN;
            if (Number.isNaN(a) || Number.isNaN(b)) return ss;
            const winner = a > b ? 'A' : b > a ? 'B' : 'draw';
            const game: Game = {
              id: nanoid(8),
              courtIndex,
              endedAt: new Date().toISOString(),
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
              i === courtIndex ? { ...c, playerIds: [], pairA: [], pairB: [] } : c
            ));
            const games = [game, ...((ss as any).games || [])];
            const players = ss.players.map((p) =>
              snapshot.includes(p.id) ? { ...p, gamesPlayed: (p.gamesPlayed ?? 0) + 1 } : p
            );
            return { ...ss, courts, games, players };
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
  const [ppc, setPpc] = useState<string>("4");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = createSession({
      date,
      time,
      numCourts: Math.max(1, Number(numCourts || 1)),
      playersPerCourt: Math.max(1, Number(ppc || 4)),
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
        <Input
          type="number"
          label="Players per court"
          min={1}
          inputMode="numeric"
          value={ppc}
          onChange={(e) => setPpc(e.target.value)}
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
                {ss.numCourts} court{ss.numCourts > 1 ? "s" : ""} · {ss.playersPerCourt} per court · {ss.players.length} player{ss.players.length !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpen(ss.id)}
                className="rounded-xl border border-gray-300 px-3 py-1.5"
              >
                Open
              </button>
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

  const [name, setName] = useState("");

  const occupancy = useMemo(
    () => session.courts.map((c) => c.playerIds.length),
    [session.courts]
  );

  const unassigned = useMemo(() => {
    const setAssigned = new Set(session.courts.flatMap((c) => c.playerIds));
    return session.players.filter((p) => !setAssigned.has(p.id));
  }, [session.players, session.courts]);

  // Long-press + pointer sensors for drag on mobile/desktop
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,  { activationConstraint: { delay: 300, tolerance: 5 } })
  );

  // Global drag end handler to support dragging from Players list to Courts
  const onDragEnd = (event: DragEndEvent) => {
    const pid = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;

    const m = overId.match(/(pairA|pairB|avail)-(\d+)/);
    if (!m) return;

    const zone = m[1] as "pairA" | "pairB" | "avail";
    const courtIndex = Number(m[2]);
    const court = session.courts[courtIndex];
    if (!court) return;

    const isOnCourt = court.playerIds.includes(pid);

    if (zone === "avail") {
      if (!isOnCourt) assign(session.id, pid, courtIndex);
      useStore.getState().setPlayerPair(session.id, courtIndex, pid, null);
      return;
    }

    // Dropped onto Pair A or Pair B
    if (!isOnCourt) {
      if (court.playerIds.length >= session.playersPerCourt) return; // court full
      assign(session.id, pid, courtIndex);
    }
    useStore.getState().setPlayerPair(session.id, courtIndex, pid, zone === "pairA" ? "A" : "B");
  };

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
              {session.numCourts} court{session.numCourts > 1 ? "s" : ""} · {session.playersPerCourt} per court
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-base font-semibold">Add players</h3>
        <form onSubmit={add} className="flex gap-2">
          <Input
            placeholder="Player name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1"
          />
          <button type="submit" className="rounded-xl bg-black px-4 py-2 text-white">Add</button>
        </form>
      </Card>

      {/* Global DnD context wraps Players + Courts so you can drag between them */}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <Card>
          <h3 className="mb-3 text-base font-semibold">Players</h3>
          {session.players.length === 0 ? (
            <p className="text-gray-500">No players yet. Add some above.</p>
          ) : (
            <div className="space-y-2">
              {session.players.map((p) => {
                const currentIdx = getPlayerCourtIndex(session, p.id);
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2">
                    {/* Make the player chip draggable */}
                    {(getPlayerCourtIndex(session, p.id) === null) ? (
                      <DraggableChip id={p.id}>
                        <div className="truncate font-medium">{p.name}<span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
        {p.gamesPlayed ?? 0} games
      </span></div>
                      </DraggableChip>
                    ) : (
                      <div className="truncate font-medium">{p.name}<span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
        {p.gamesPlayed ?? 0} games
      </span></div>
                    )}
                    <div className="flex items-center gap-2">
                      <Select
                        value={currentIdx ?? ""}
                        onChange={(v) => {
                          if (v === "") assign(session.id, p.id, null);
                          else assign(session.id, p.id, Number(v));
                        }}
                      >
                        <option value="">Unassigned</option>
                        {Array.from({ length: session.numCourts }).map((_, i) => (
                          <option
                            key={i}
                            value={i}
                            disabled={currentIdx !== i && occupancy[i] >= session.playersPerCourt}
                          >
                            Court {i + 1} ({occupancy[i]}/{session.playersPerCourt})
                          </option>
                        ))}
                      </Select>
                      <button
                        onClick={() => removePlayer(session.id, p.id)}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600"
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {session.courts.map((court, idx) => (
              <CourtCard key={court.id} session={session} court={court} idx={idx} />
            ))}
          </div>
        </Card>
      </DndContext>

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

  const canEndAny = court.playerIds.length > 0;
  const pairA = court.pairA || [];
  const pairB = court.pairB || [];
  const ready = pairA.length === 2 && pairB.length === 2;
  const available = court.playerIds.filter((pid) => !pairA.includes(pid) && !pairB.includes(pid));

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
            {court.playerIds.length}/{session.playersPerCourt}
          </div>
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={!canEndAny}
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
          >
            End game
          </button>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <DroppableZone
          id={`pairA-${idx}`}
          label={`Pair A (${pairA.length}/2)`}
          disabled={pairA.length >= 2}
        >
          {pairA.length === 0 && (
            <div className="text-xs text-gray-400">Drag players here</div>
          )}
          {pairA.map((pid) => {
            const player = session.players.find((pp) => pp.id === pid);
            if (!player) return null;
            return (
              <DraggableChip key={pid} id={pid}>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-1">
                  <span className="truncate text-sm">{player.name}</span>
                  <button onClick={() => setPair(session.id, idx, pid, null)} className="text-[10px] text-gray-600">×</button>
                </div>
              </DraggableChip>
            );
          })}
        </DroppableZone>

        <DroppableZone
          id={`pairB-${idx}`}
          label={`Pair B (${pairB.length}/2)`}
          disabled={pairB.length >= 2}
        >
          {pairB.length === 0 && (
            <div className="text-xs text-gray-400">Drag players here</div>
          )}
          {pairB.map((pid) => {
            const player = session.players.find((pp) => pp.id === pid);
            if (!player) return null;
            return (
              <DraggableChip key={pid} id={pid}>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-1">
                  <span className="truncate text-sm">{player.name}</span>
                  <button onClick={() => setPair(session.id, idx, pid, null)} className="text-[10px] text-gray-600">×</button>
                </div>
              </DraggableChip>
            );
          })}
        </DroppableZone>
      </div>

      <DroppableZone id={`avail-${idx}`} label={`Available on court (${available.length})`}>
        {available.length === 0 ? (
          <div className="text-xs text-gray-400">No available players</div>
        ) : (
          <ul className="space-y-1">
            {available.map((pid) => {
              const player = session.players.find((pp) => pp.id === pid);
              if (!player) return null;
              return (
                <li key={pid} className="flex items-center justify-between">
                  <DraggableChip id={pid}>
                    <div className="rounded-lg bg-gray-50 px-2 py-1 text-sm">{player.name}</div>
                  </DraggableChip>
                  <button
                    onClick={() => assign(session.id, pid, null)}
                    className="rounded border px-2 py-0.5 text-xs"
                  >
                    Unassign
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DroppableZone>

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
            <button onClick={onSave} disabled={!ready || !scoreValid} className="rounded-xl bg-black px-3 py-1.5 text-xs text-white disabled:opacity-50">Save & Clear</button>
            <button onClick={() => setOpen(false)} className="rounded-xl border px-3 py-1.5 text-xs">Cancel</button>
          </div>
          {!ready && <div className="mt-2 text-[11px] text-amber-600">Need exactly 2 players in Pair A and Pair B.</div>}
          {ready && !scoreValid && <div className="mt-2 text-[11px] text-amber-600">Enter both scores.</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------
// Drag & Drop primitives
// ---------------------------------
function DraggableChip({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const style: React.CSSProperties | undefined = transform
    ? { transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className={`cursor-grab active:cursor-grabbing ${isDragging ? "opacity-70" : ""}`}
    >
      {children}
    </div>
  );
}

function DroppableZone({ id, label, children, disabled }: { id: string; label: string; children: React.ReactNode; disabled?: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id, disabled });
  return (
    <div ref={setNodeRef} className={`rounded-lg border p-2 ${isOver ? "border-black" : "border-gray-200"} ${disabled ? "opacity-60" : ""}`}>
      <div className="mb-1 text-xs font-medium">{label}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
