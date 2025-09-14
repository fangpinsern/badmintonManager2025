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

type Player = { id: string; name: string; gender?: 'M' | 'F'; gamesPlayed?: number };

type Court = { id: string; index: number; playerIds: string[]; pairA: string[]; pairB: string[]; inProgress?: boolean; startedAt?: string; mode?: 'singles' | 'doubles'; queue?: string[]; nextA?: string[]; nextB?: string[] };

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
  voided?: boolean;
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
  autoAssignBlacklist?: { pairs: { a: string; b: string }[] };
  autoAssignConfig?: {
    balanceGender?: boolean;
  };
  autoAssignExclude?: string[]; // playerIds to exclude from auto-assign
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
  addPlayersBulk: (sessionId: string, names: string[]) => void;
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
  voidGame: (sessionId: string, courtIndex: number) => void;
  updateGame: (
    sessionId: string,
    gameId: string,
    update: { scoreA: number; scoreB: number; sideA: string[]; sideB: string[]; durationMs?: number }
  ) => void;
  endSession: (sessionId: string, shuttlesUsed?: number) => void;
  startGame: (sessionId: string, courtIndex: number) => void;
  setCourtMode: (sessionId: string, courtIndex: number, mode: 'singles' | 'doubles') => void;
  addCourt: (sessionId: string) => void;
  removeCourt: (sessionId: string, courtIndex: number) => void;
  autoAssignAvailable: (sessionId: string) => void;
  autoAssignCourt: (sessionId: string, courtIndex: number) => void;
  autoAssignNext: (sessionId: string, courtIndex: number) => void;
  enqueueToCourt: (sessionId: string, courtIndex: number, playerId: string) => void;
  removeFromCourtQueue: (sessionId: string, courtIndex: number, playerId: string) => void;
  clearCourtQueue: (sessionId: string, courtIndex: number) => void;
  setNextPair: (sessionId: string, courtIndex: number, playerId: string, pair: 'A' | 'B' | null) => void;
  // updateAutoAssignConfig removed
  addBlacklistPair: (sessionId: string, a: string, b: string) => void;
  removeBlacklistPair: (sessionId: string, a: string, b: string) => void;
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
          queue: [],
          nextA: [],
          nextB: [],
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


      addPlayersBulk: (sessionId, names) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const existingNames = new Set(ss.players.map((p) => p.name.toLowerCase()));
            const toAdd: Player[] = [];
            let invalid = false;
            for (const raw of names) {
              const n = (raw || "").trim();
              if (!n) continue;
              // Support formats: "Name" or "Name, M|F|O"
              let namePart = n;
              let gender: Player['gender'] | undefined = undefined;
              const parts = n.split(',').map((s) => s.trim()).filter(Boolean);
              if (parts.length >= 2) {
                namePart = parts[0];
                const g = parts[1].toUpperCase();
                if (g === 'M' || g === 'F') gender = g as any;
                else { invalid = true; break; }
              }
              const key = namePart.toLowerCase();
              if (existingNames.has(key)) continue;
              existingNames.add(key);
              toAdd.push({ id: nanoid(8), name: namePart, gender });
            }
            if (invalid || !toAdd.length) return ss;
            return { ...ss, players: [...ss.players, ...toAdd] };
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
              queue: (c.queue || []).filter((pid) => pid !== playerId),
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

      setNextPair: (sessionId, courtIndex, playerId, pair) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const courts = ss.courts.map((c, i) => {
              if (i !== courtIndex) return c;
              const isSingles = (c.mode || 'doubles') === 'singles';
              const req = isSingles ? 1 : 2;
              let nextA = (c.nextA || []).filter((id) => id !== playerId);
              let nextB = (c.nextB || []).filter((id) => id !== playerId);
              if (pair === 'A' && nextA.length < req) nextA = [...nextA, playerId];
              if (pair === 'B' && nextB.length < req) nextB = [...nextB, playerId];
              return { ...c, nextA, nextB };
            });
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
            let courts = ss.courts.map((c) => ({ ...c }));
            const c = courts[courtIndex];
            // clear current court state
            c.playerIds = [];
            c.pairA = [];
            c.pairB = [];
            c.inProgress = false;
            c.startedAt = undefined;
            // Auto-populate next game from queue, preferring nextA/nextB if valid
            const isSingles = (c.mode || 'doubles') === 'singles';
            const cap = isSingles ? 2 : 4;
            if ((c.queue || []).length) {
              const pull: string[] = [];
              const queued = c.queue || [];
              for (const pid of queued) {
                if (pull.length >= cap) break;
                pull.push(pid);
              }
              if (pull.length > 0) {
                c.playerIds = pull.slice(0, cap);
                // remove pulled players from queue
                c.queue = queued.filter((pid) => !c.playerIds.includes(pid));
                // try assign pairs using same logic as auto-assign team formation
                const reqTeam = isSingles ? 1 : 2;
                const initialA: string[] = (c.nextA || []).filter((id) => c.playerIds.includes(id)).slice(0, reqTeam);
                const initialB: string[] = (c.nextB || []).filter((id) => c.playerIds.includes(id)).slice(0, reqTeam);
                const remaining = c.playerIds.filter((pid) => !initialA.includes(pid) && !initialB.includes(pid));
                const blPairs = (ss.autoAssignBlacklist?.pairs || []);
                const isBL = (x: string, y: string) => blPairs.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
                function canPlace(pid: string, team: string[]): boolean {
                  for (const q of team) { if (isBL(pid, q)) return false; }
                  return true;
                }
                let bestAssign: { a: string[]; b: string[] } | null = null as any;
                function dfs(idx: number, a: string[], b: string[]) {
                  if (a.length > reqTeam || b.length > reqTeam) return;
                  if (idx === remaining.length) {
                    if (a.length === reqTeam && b.length === reqTeam) {
                      bestAssign = { a: [...a], b: [...b] };
                    }
                    return;
                  }
                  const pid = remaining[idx];
                  if (a.length < reqTeam && canPlace(pid, a)) { a.push(pid); dfs(idx + 1, a, b); a.pop(); if (bestAssign) return; }
                  if (b.length < reqTeam && canPlace(pid, b)) { b.push(pid); dfs(idx + 1, a, b); b.pop(); if (bestAssign) return; }
                  dfs(idx + 1, a, b);
                }
                dfs(0, initialA, initialB);
                if (bestAssign) { c.pairA = bestAssign.a; c.pairB = bestAssign.b; }
                else {
                  let pairA: string[] = [];
                  let pairB: string[] = [];
                  for (const pid of remaining) {
                    if (pairA.length < reqTeam && canPlace(pid, pairA)) pairA.push(pid);
                    else if (pairB.length < reqTeam && canPlace(pid, pairB)) pairB.push(pid);
                    else if (pairA.length < reqTeam) pairA.push(pid);
                    else if (pairB.length < reqTeam) pairB.push(pid);
                    if (pairA.length >= reqTeam && pairB.length >= reqTeam) break;
                  }
                  c.pairA = pairA; c.pairB = pairB;
                }
                // clear nextA/nextB after consuming
                c.nextA = [];
                c.nextB = [];
              }
            }
            const games = [game, ...((ss as any).games || [])];
            const players = ss.players.map((p) =>
              snapshot.includes(p.id) ? { ...p, gamesPlayed: (p.gamesPlayed ?? 0) + 1 } : p
            );
            return { ...ss, courts, games, players };
          }),
        })),

      voidGame: (sessionId, courtIndex) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const target = ss.courts[courtIndex];
            if (!target) return ss;
            if (!target.inProgress) return ss;
            const sideA = [...(target.pairA || [])];
            const sideB = [...(target.pairB || [])];
            const snapshot = [...sideA, ...sideB];
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
              scoreA: 0,
              scoreB: 0,
              winner: 'draw',
              players: snapshot,
              voided: true,
            };
            let courts = ss.courts.map((c) => ({ ...c }));
            const c = courts[courtIndex];
            // clear current court state
            c.playerIds = [];
            c.pairA = [];
            c.pairB = [];
            c.inProgress = false;
            c.startedAt = undefined;
            // Auto-populate next game from queue, preferring nextA/nextB if valid
            const isSingles = (c.mode || 'doubles') === 'singles';
            const cap = isSingles ? 2 : 4;
            if ((c.queue || []).length) {
              const pull: string[] = [];
              const queued = c.queue || [];
              for (const pid of queued) {
                if (pull.length >= cap) break;
                pull.push(pid);
              }
              if (pull.length > 0) {
                c.playerIds = pull.slice(0, cap);
                // remove pulled players from queue
                c.queue = queued.filter((pid) => !c.playerIds.includes(pid));
                // try assign pairs using same logic as auto-assign team formation
                const reqTeam = isSingles ? 1 : 2;
                const initialA: string[] = (c.nextA || []).filter((id) => c.playerIds.includes(id)).slice(0, reqTeam);
                const initialB: string[] = (c.nextB || []).filter((id) => c.playerIds.includes(id)).slice(0, reqTeam);
                const remaining = c.playerIds.filter((pid) => !initialA.includes(pid) && !initialB.includes(pid));
                const blPairs = (ss.autoAssignBlacklist?.pairs || []);
                const isBL = (x: string, y: string) => blPairs.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
                function canPlace(pid: string, team: string[]): boolean {
                  for (const q of team) { if (isBL(pid, q)) return false; }
                  return true;
                }
                let bestAssign: { a: string[]; b: string[] } | null = null as any;
                function dfs(idx: number, a: string[], b: string[]) {
                  if (a.length > reqTeam || b.length > reqTeam) return;
                  if (idx === remaining.length) {
                    if (a.length === reqTeam && b.length === reqTeam) {
                      bestAssign = { a: [...a], b: [...b] };
                    }
                    return;
                  }
                  const pid = remaining[idx];
                  if (a.length < reqTeam && canPlace(pid, a)) { a.push(pid); dfs(idx + 1, a, b); a.pop(); if (bestAssign) return; }
                  if (b.length < reqTeam && canPlace(pid, b)) { b.push(pid); dfs(idx + 1, a, b); b.pop(); if (bestAssign) return; }
                  dfs(idx + 1, a, b);
                }
                dfs(0, initialA, initialB);
                if (bestAssign) { c.pairA = bestAssign.a; c.pairB = bestAssign.b; }
                else {
                  let pairA: string[] = [];
                  let pairB: string[] = [];
                  for (const pid of remaining) {
                    if (pairA.length < reqTeam && canPlace(pid, pairA)) pairA.push(pid);
                    else if (pairB.length < reqTeam && canPlace(pid, pairB)) pairB.push(pid);
                    else if (pairA.length < reqTeam) pairA.push(pid);
                    else if (pairB.length < reqTeam) pairB.push(pid);
                    if (pairA.length >= reqTeam && pairB.length >= reqTeam) break;
                  }
                  c.pairA = pairA; c.pairB = pairB;
                }
                // clear nextA/nextB after consuming
                c.nextA = [];
                c.nextB = [];
              }
            }
            const games = [game, ...((ss as any).games || [])];
            return { ...ss, courts, games };
          }),
        })),

      updateGame: (sessionId, gameId, update) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const games = (ss.games || []).map((g) => {
              if (g.id !== gameId) return g;
              const scoreA = Math.max(0, Math.floor(update.scoreA));
              const scoreB = Math.max(0, Math.floor(update.scoreB));
              const sideA = [...update.sideA];
              const sideB = [...update.sideB];
              const winner: Game['winner'] = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw';
              const sideAPlayers = sideA.map((pid) => ({ id: pid, name: (ss.players.find((pp) => pp.id === pid)?.name || '(deleted)') }));
              const sideBPlayers = sideB.map((pid) => ({ id: pid, name: (ss.players.find((pp) => pp.id === pid)?.name || '(deleted)') }));
              const updated: Game = {
                ...g,
                scoreA,
                scoreB,
                sideA,
                sideB,
                sideAPlayers,
                sideBPlayers,
                winner,
                durationMs: typeof update.durationMs === 'number' ? Math.max(0, Math.floor(update.durationMs)) : g.durationMs,
              };
              return updated;
            });
            return { ...ss, games };
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
            // block start if any player is currently in another ongoing match
            const busyElsewhere = new Set<string>();
            ss.courts.forEach((cc, i) => { if (i !== courtIndex && cc.inProgress) cc.playerIds.forEach((pid) => busyElsewhere.add(pid)); });
            const hasBusy = c.playerIds.some((pid) => busyElsewhere.has(pid));
            if (hasBusy) return ss;
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
              // also clear nextA/nextB as capacities change
              return { ...c, mode, playerIds: kept, pairA: [], pairB: [], nextA: [], nextB: [] };
            });
            return { ...ss, courts };
          }),
        })),

      addCourt: (sessionId) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const nextIndex = ss.courts.length;
            const newCourt: Court = {
              id: nanoid(8),
              index: nextIndex,
              playerIds: [],
              pairA: [],
              pairB: [],
              inProgress: false,
              mode: 'doubles',
            };
            return { ...ss, courts: [...ss.courts, newCourt], numCourts: nextIndex + 1 };
          }),
        })),

      removeCourt: (sessionId, courtIndex) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const target = ss.courts[courtIndex];
            if (!target) return ss;
            if (target.inProgress) return ss; // do not remove active court
            // Unassign players from this court by simply removing the court
            const newCourts = ss.courts.filter((_, i) => i !== courtIndex).map((c, i) => ({ ...c, index: i }));
            return { ...ss, courts: newCourts, numCourts: newCourts.length };
          }),
        })),

      enqueueToCourt: (sessionId, courtIndex, playerId) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const courts = ss.courts.map((c, i) => {
              if (i !== courtIndex) return c;
              if (c.inProgress) {
                const inQueue = (c.queue || []).includes(playerId);
                if (inQueue) return c;
                // do not allow if queued in other courts
                const inOtherQueue = ss.courts.some((cc, j) => j !== courtIndex && (cc.queue || []).includes(playerId));
                if (inOtherQueue) return c;
                // do not allow if player is assigned to any court that is not yet started
                const onPendingCourt = ss.courts.some((cc) => !cc.inProgress && cc.playerIds.includes(playerId));
                if (onPendingCourt) return c;
                // limit queue to next-game only: max cap players
                const cap = (c.mode || 'doubles') === 'singles' ? 2 : 4;
                const q = [...(c.queue || [])];
                if (q.length >= cap) return c;
                const updated = { ...c, queue: [...q, playerId] };
                return updated;
              }
              // If not in-progress, prefer assigning directly if capacity allows
              const cap = (c.mode || 'doubles') === 'singles' ? 2 : 4;
              if (c.playerIds.length < cap && !c.playerIds.includes(playerId)) {
                return { ...c, playerIds: [...c.playerIds, playerId] };
              }
              const inQueue = (c.queue || []).includes(playerId);
              if (inQueue) return c;
              const inOtherQueue = ss.courts.some((cc, j) => j !== courtIndex && (cc.queue || []).includes(playerId));
              if (inOtherQueue) return c;
              const onPendingCourt = ss.courts.some((cc) => !cc.inProgress && cc.playerIds.includes(playerId));
              if (onPendingCourt) return c;
              const q = [...(c.queue || [])];
              if (q.length >= cap) return c;
              return { ...c, queue: [...q, playerId] };
            });
            return { ...ss, courts };
          })
        })),

      removeFromCourtQueue: (sessionId, courtIndex, playerId) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            const courts = ss.courts.map((c, i) => i === courtIndex ? {
              ...c,
              queue: (c.queue || []).filter((pid) => pid !== playerId),
              nextA: (c.nextA || []).filter((pid) => pid !== playerId),
              nextB: (c.nextB || []).filter((pid) => pid !== playerId),
            } : c);
            return { ...ss, courts };
          })
        })),

      clearCourtQueue: (sessionId, courtIndex) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            const courts = ss.courts.map((c, i) => i === courtIndex ? { ...c, queue: [], nextA: [], nextB: [] } : c);
            return { ...ss, courts };
          })
        })),

      // toggleCourtQueueAutofill removed: auto-fill is always enabled

      autoAssignAvailable: (sessionId) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            // Build a working copy of courts
            const courts = ss.courts.map((c) => ({ ...c, playerIds: [...c.playerIds] }));
            const assigned = new Set<string>(courts.flatMap((c) => c.playerIds));
            const unassignedPlayers = ss.players.filter((p) => !assigned.has(p.id));
            for (const p of unassignedPlayers) {
              // find first court with capacity and not in progress
              let placed = false;
              for (let i = 0; i < courts.length; i++) {
                const c = courts[i];
                if (c.inProgress) continue;
                const cap = (c.mode || 'doubles') === 'singles' ? 2 : 4;
                if (c.playerIds.length < cap) {
                  c.playerIds.push(p.id);
                  placed = true;
                  break;
                }
              }
              if (!placed) break; // no more capacity anywhere
            }
            return { ...ss, courts };
          }),
        })),

      autoAssignCourt: (sessionId, courtIndex) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const courts = ss.courts.map((c) => ({ ...c, playerIds: [...c.playerIds] }));
            const court = courts[courtIndex];
            if (!court || court.inProgress) return ss;
            const isSingles = (court.mode || 'doubles') === 'singles';
            const cap = isSingles ? 2 : 4;
            const need = cap - court.playerIds.length;
            if (need <= 0) return ss;

            // Build unassigned pool
            const assigned = new Set<string>(courts.flatMap((c) => c.playerIds));
            const allPlayers = ss.players.map((p) => ({ id: p.id, name: p.name, games: p.gamesPlayed ?? 0 }));
            const excluded = new Set(ss.autoAssignExclude || []);
            const pool = allPlayers.filter((p) => !assigned.has(p.id) && !excluded.has(p.id));
            if (pool.length === 0) return ss;

            // Compute consecutive-game streaks (higher means more back-to-back games)
            const streak = new Map<string, number>();
            const gamesSorted = [...(ss.games || [])].sort((a, b) => (new Date(b.endedAt).getTime()) - (new Date(a.endedAt).getTime()));
            for (const p of ss.players) {
              let cst = 0;
              for (const g of gamesSorted) {
                const inG = (g.players && g.players.length ? g.players : [...g.sideA, ...g.sideB]).includes(p.id);
                if (inG) cst += 1; else break;
              }
              streak.set(p.id, cst);
            }

            // Pairwise co-appearance counts from session games (voided included)
            const coCount = new Map<string, Map<string, number>>();
            const inc = (a: string, b: string) => {
              if (a === b) return;
              if (!coCount.has(a)) coCount.set(a, new Map());
              const m = coCount.get(a)!;
              m.set(b, (m.get(b) || 0) + 1);
            };
            for (const g of (ss.games || [])) {
              const ps = (g.players && g.players.length ? g.players : [...g.sideA, ...g.sideB]);
              for (let i = 0; i < ps.length; i++) {
                for (let j = i + 1; j < ps.length; j++) {
                  inc(ps[i], ps[j]);
                  inc(ps[j], ps[i]);
                }
              }
            }
            const getCo = (a: string, b: string) => coCount.get(a)?.get(b) || 0;

            // Sort pool by games asc, then name
            {
              pool.sort((a, b) => (a.games - b.games) || a.name.localeCompare(b.name));
            }

            const chosen: string[] = [];
            const candidateIds = pool.map((p) => p.id);
            const fairnessW = 1;
            const repeatW = 1000;
            const restW = 2000; // strong penalty to avoid back-to-back
            const genderBalancePenalty = (ids: string[]) => {
              // Only applies to doubles; penalize if team A and B can't be balanced by gender (M/F)
              // We don't know team split here; approximate by penalizing odd counts of M or F in the chosen set
              const genders = new Map<string, Player['gender']>();
              ss.players.forEach((p) => { if (p.gender) genders.set(p.id, p.gender); });
              let m = 0, f = 0;
              for (const id of ids) {
                const g = genders.get(id);
                if (g === 'M') m++; else if (g === 'F') f++;
              }
              // best-balanced doubles set has even counts of each (e.g., 0/4, 2/2, 4/0), otherwise add penalty
              const isBalanced = (m % 2 === 0) && (f % 2 === 0);
              if ((ss.autoAssignConfig?.balanceGender ?? true) === false) return 0;
              return isBalanced ? 0 : 500; // moderate penalty
            };

            if (isSingles) {
              // Choose best pair among top K candidates (limit for perf)
              const K = Math.min(candidateIds.length, 10);
              let best: { pair: [string, string]; score: number } | null = null;
              for (let i = 0; i < K; i++) {
                for (let j = i + 1; j < K; j++) {
                  const a = pool[i];
                  const b = pool[j];
                  const repeat = getCo(a.id, b.id);
                  const score = (repeat * repeatW) + fairnessW * (a.games + b.games) + restW * ((streak.get(a.id) || 0) + (streak.get(b.id) || 0));
                  if (!best || score < best.score) best = { pair: [a.id, b.id], score };
                }
              }
              if (best) chosen.push(...best.pair);
              else chosen.push(...candidateIds.slice(0, Math.min(need, candidateIds.length)));
            } else {
              // Doubles: choose 4 players minimizing co-appearance among the 4 and total games
              const K = Math.min(candidateIds.length, 8);
              let bestSet: string[] = [];
              let bestScore = Infinity;
              let bestHasBlacklist = true; // prefer non-blacklisted sets first
              const idxs: number[] = Array.from({ length: K }, (_, i) => i);
              // enumerate combinations of size (need) but at least up to 4; if need<4, still pick need
              const choose = (arr: number[], k: number, start: number, acc: number[]) => {
                if (acc.length === k) {
                  const ids = acc.map((ii) => pool[ii].id);
                  // blacklist detection for doubles pairs (highest priority to avoid)
                  let hasBlacklist = false;
                  if ((ss.autoAssignBlacklist?.pairs || []).length) {
                    const bl = ss.autoAssignBlacklist!.pairs;
                    const hasPair = (x: string, y: string) => bl.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
                    outer: for (let i = 0; i < ids.length; i++) {
                      for (let j = i + 1; j < ids.length; j++) {
                        if (hasPair(ids[i], ids[j])) { hasBlacklist = true; break outer; }
                      }
                    }
                  }
                  // compute repeat score
                  let repeat = 0;
                  for (let i = 0; i < ids.length; i++) {
                    for (let j = i + 1; j < ids.length; j++) repeat += getCo(ids[i], ids[j]);
                  }
                  let gamesSum = 0;
                  for (const ii of acc) gamesSum += pool[ii].games;
                  let restSum = 0; for (const id of ids) restSum += (streak.get(id) || 0);
                  const score = genderBalancePenalty(ids) + (repeat * repeatW) + fairnessW * gamesSum + restW * restSum;
                  if ((!hasBlacklist && bestHasBlacklist) || (hasBlacklist === bestHasBlacklist && score < bestScore)) {
                    bestHasBlacklist = hasBlacklist;
                    bestScore = score;
                    bestSet = ids;
                  }
                  return;
                }
                for (let i = start; i < arr.length; i++) {
                  acc.push(arr[i]);
                  choose(arr, k, i + 1, acc);
                  acc.pop();
                }
              };
              choose(idxs, Math.min(need, 4), 0, []);
              if (bestSet.length) bestSet.forEach((id) => chosen.push(id));
            }

            // Fill the court
            for (const pid of chosen) {
              if (court.playerIds.length >= cap) break;
              if (!court.playerIds.includes(pid)) court.playerIds.push(pid);
            }

            // Also assign teams (Pair A / Pair B) up to required sizes, avoiding blacklisted pairs in the same team
            const reqTeam = isSingles ? 1 : 2;
            const initialA = [...(court.pairA || [])];
            const initialB = [...(court.pairB || [])];
            const remaining = court.playerIds.filter((pid) => !initialA.includes(pid) && !initialB.includes(pid));
            const blPairs = (ss.autoAssignBlacklist?.pairs || []);
            const isBL = (x: string, y: string) => blPairs.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));

            function canPlace(pid: string, team: string[]): boolean {
              for (const q of team) { if (isBL(pid, q)) return false; }
              return true;
            }

            let bestAssign: { a: string[]; b: string[] } | null = null as any;
            function dfs(idx: number, a: string[], b: string[]) {
              if (a.length > reqTeam || b.length > reqTeam) return;
              if (idx === remaining.length) {
                if (a.length === reqTeam && b.length === reqTeam) {
                  bestAssign = { a: [...a], b: [...b] };
                }
                return;
              }
              const pid = remaining[idx];
              // try A
              if (a.length < reqTeam && canPlace(pid, a)) {
                a.push(pid); dfs(idx + 1, a, b); a.pop();
                if (bestAssign) return; // found valid
              }
              // try B
              if (b.length < reqTeam && canPlace(pid, b)) {
                b.push(pid); dfs(idx + 1, a, b); b.pop();
                if (bestAssign) return;
              }
              // try skipping (if not required to fill completely)
              dfs(idx + 1, a, b);
            }

            // seed with initial members (ensure they don't violate blacklist among themselves)
            const initValid = initialA.every((x, i) => initialA.slice(i + 1).every((y) => !isBL(x, y))) &&
                              initialB.every((x, i) => initialB.slice(i + 1).every((y) => !isBL(x, y)));
            if (initValid) {
              dfs(0, [...initialA], [...initialB]);
            }
            if (bestAssign) {
              court.pairA = bestAssign.a;
              court.pairB = bestAssign.b;
            } else {
              // fallback to naive fill if constraints impossible
              let pairA = [...initialA];
              let pairB = [...initialB];
              for (const pid of remaining) {
                if (pairA.length < reqTeam && canPlace(pid, pairA)) pairA.push(pid);
                else if (pairB.length < reqTeam && canPlace(pid, pairB)) pairB.push(pid);
                else if (pairA.length < reqTeam) pairA.push(pid);
                else if (pairB.length < reqTeam) pairB.push(pid);
                if (pairA.length >= reqTeam && pairB.length >= reqTeam) break;
              }
              court.pairA = pairA;
              court.pairB = pairB;
            }
            return { ...ss, courts };
          }),
        })),

      autoAssignNext: (sessionId, courtIndex) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            if (ss.ended) return ss;
            const courts = ss.courts.map((c) => ({ ...c, queue: [...(c.queue || [])] }));
            const court = courts[courtIndex];
            if (!court) return ss;
            const isSingles = (court.mode || 'doubles') === 'singles';
            const cap = isSingles ? 2 : 4;

            // Build eligible pool: not on any court, not busy (in-progress), not excluded, not in any other queue
            const busy = new Set<string>();
            const queuedElsewhere = new Set<string>();
            courts.forEach((c, i) => {
              if (c.inProgress) c.playerIds.forEach((pid) => busy.add(pid));
              if (i !== courtIndex) (c.queue || []).forEach((pid) => queuedElsewhere.add(pid));
            });
            const excluded = new Set(ss.autoAssignExclude || []);
            const assigned = new Set<string>(courts.flatMap((c) => c.playerIds));
            const allPlayers = ss.players.map((p) => ({ id: p.id, name: p.name, games: p.gamesPlayed ?? 0 }));
            // allow queuing busy players; only filter when starting the game, not for next selection
            const pool = allPlayers.filter((p) => !assigned.has(p.id) && !excluded.has(p.id) && !queuedElsewhere.has(p.id));
            if (pool.length < cap) return ss;

            // Build co-appearance counts
            const coCount = new Map<string, Map<string, number>>();
            const inc = (a: string, b: string) => {
              if (a === b) return;
              if (!coCount.has(a)) coCount.set(a, new Map());
              const m = coCount.get(a)!;
              m.set(b, (m.get(b) || 0) + 1);
            };
            for (const g of (ss.games || [])) {
              const ps = (g.players && g.players.length ? g.players : [...g.sideA, ...g.sideB]);
              for (let i = 0; i < ps.length; i++) {
                for (let j = i + 1; j < ps.length; j++) { inc(ps[i], ps[j]); inc(ps[j], ps[i]); }
              }
            }
            const getCo = (a: string, b: string) => coCount.get(a)?.get(b) || 0;

            // gender balance penalty (like court auto-assign) + rest streak
            const genderBalancePenalty = (ids: string[]) => {
              const genders = new Map<string, Player['gender']>();
              ss.players.forEach((p) => { if (p.gender) genders.set(p.id, p.gender); });
              let m = 0, f = 0;
              for (const id of ids) { const g = genders.get(id); if (g === 'M') m++; else if (g === 'F') f++; }
              const isBalanced = (m % 2 === 0) && (f % 2 === 0);
              if ((ss.autoAssignConfig?.balanceGender ?? true) === false) return 0;
              return isBalanced ? 0 : 500;
            };
            const streak = new Map<string, number>();
            const gamesSorted = [...(ss.games || [])].sort((a, b) => (new Date(b.endedAt).getTime()) - (new Date(a.endedAt).getTime()));
            for (const p of ss.players) {
              let cst = 0;
              for (const g of gamesSorted) {
                const inG = (g.players && g.players.length ? g.players : [...g.sideA, ...g.sideB]).includes(p.id);
                if (inG) cst += 1; else break;
              }
              streak.set(p.id, cst);
            }

            const fairnessW = 1;
            const repeatW = 1000;

            let chosen: string[] = [];
            if (isSingles) {
              const K = Math.min(pool.length, 10);
              let best: { pair: [string, string]; score: number } | null = null;
              for (let i = 0; i < K; i++) {
                for (let j = i + 1; j < K; j++) {
                  const a = pool[i];
                  const b = pool[j];
                  const repeat = getCo(a.id, b.id);
                  const score = (repeat * repeatW) + fairnessW * (a.games + b.games) + 2000 * ((streak.get(a.id) || 0) + (streak.get(b.id) || 0));
                  if (!best || score < best.score) best = { pair: [a.id, b.id], score };
                }
              }
              if (best) chosen.push(...best.pair);
            } else {
              const K = Math.min(pool.length, 8);
              let bestSet: string[] = [];
              let bestScore = Infinity;
              let bestHasBlacklist = true;
              const idxs: number[] = Array.from({ length: K }, (_, i) => i);
              const choose = (arr: number[], k: number, start: number, acc: number[]) => {
                if (acc.length === k) {
                  const ids = acc.map((ii) => pool[ii].id);
                  let hasBlacklist = false;
                  const bl = ss.autoAssignBlacklist?.pairs || [];
                  const hasPair = (x: string, y: string) => bl.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
                  outer: for (let i = 0; i < ids.length; i++) {
                    for (let j = i + 1; j < ids.length; j++) { if (hasPair(ids[i], ids[j])) { hasBlacklist = true; break outer; } }
                  }
                  let repeat = 0; for (let i = 0; i < ids.length; i++) { for (let j = i + 1; j < ids.length; j++) repeat += getCo(ids[i], ids[j]); }
                  let gamesSum = 0; for (const ii of acc) gamesSum += pool[ii].games;
                  let restSum = 0; for (const id of ids) restSum += (streak.get(id) || 0);
                  const score = genderBalancePenalty(ids) + (repeat * repeatW) + fairnessW * gamesSum + 2000 * restSum;
                  if ((!hasBlacklist && bestHasBlacklist) || (hasBlacklist === bestHasBlacklist && score < bestScore)) { bestHasBlacklist = hasBlacklist; bestScore = score; bestSet = ids; }
                  return;
                }
                for (let i = start; i < arr.length; i++) { acc.push(arr[i]); choose(arr, k, i + 1, acc); acc.pop(); }
              };
              choose(idxs, 4, 0, []);
              if (bestSet.length) chosen.push(...bestSet);
            }
            if (chosen.length < cap) return ss;

            // Set queue to chosen and compute nextA/nextB avoiding blacklists
            court.queue = chosen.slice(0, cap);
            court.nextA = [];
            court.nextB = [];
            const blPairs = (ss.autoAssignBlacklist?.pairs || []);
            const isBL = (x: string, y: string) => blPairs.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
            function canPlace(pid: string, team: string[]): boolean { for (const q of team) { if (isBL(pid, q)) return false; } return true; }
            const reqTeam = isSingles ? 1 : 2;
            let bestAssign: { a: string[]; b: string[] } | null = null as any;
            function dfs(idx: number, a: string[], b: string[]) {
              if (a.length > reqTeam || b.length > reqTeam) return;
              if (idx === court.queue.length) { if (a.length === reqTeam && b.length === reqTeam) bestAssign = { a: [...a], b: [...b] }; return; }
              const pid = court.queue[idx];
              if (a.length < reqTeam && canPlace(pid, a)) { a.push(pid); dfs(idx + 1, a, b); a.pop(); if (bestAssign) return; }
              if (b.length < reqTeam && canPlace(pid, b)) { b.push(pid); dfs(idx + 1, a, b); b.pop(); if (bestAssign) return; }
              dfs(idx + 1, a, b);
            }
            dfs(0, [], []);
            if (bestAssign) { court.nextA = bestAssign.a; court.nextB = bestAssign.b; }

            return { ...ss, courts };
          }),
        })),

      addBlacklistPair: (sessionId, a, b) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            const pairs = ss.autoAssignBlacklist?.pairs || [];
            const exists = pairs.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
            if (exists) return ss;
            return { ...ss, autoAssignBlacklist: { pairs: [...pairs, { a, b }] } };
          }),
        })),

      removeBlacklistPair: (sessionId, a, b) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => {
            if (ss.id !== sessionId) return ss;
            const pairs = ss.autoAssignBlacklist?.pairs || [];
            const filtered = pairs.filter((p) => !((p.a === a && p.b === b) || (p.a === b && p.b === a)));
            return { ...ss, autoAssignBlacklist: { pairs: filtered } };
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

function downloadSessionJson(session: Session) {
  try {
    const data = JSON.stringify(session, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeTitle = `${session.date}_${session.time}`.replace(/[^a-zA-Z0-9_-]+/g, '-');
    a.href = url;
    a.download = `badminton-session-${safeTitle}-${session.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Failed to export session JSON', e);
    alert('Failed to export session JSON.');
  }
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
    <main className="mx-auto max-w-md md:max-w-3xl lg:max-w-5xl xl:max-w-6xl p-4 text-sm">
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
  const addPlayersBulk = useStore((s) => s.addPlayersBulk);
  const removePlayer = useStore((s) => s.removePlayer);
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

  const filteredGames = useMemo(() => {
    const all = session.games || [];
    if (!gamesFilter) return all;
    return all.filter((g) => g.sideA.includes(gamesFilter) || g.sideB.includes(gamesFilter));
  }, [session.games, gamesFilter]);

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
      <button onClick={onBack} className="text-sm text-gray-600">← Back</button>

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
            <button
              onClick={() => downloadSessionJson(session)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
            >
              Export JSON
            </button>
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
                    <div className="truncate font-medium">{p.name}{p.gender ? <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{p.gender}</span> : null}<span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{p.gamesPlayed ?? 0} games</span>{inGame && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700">in game</span>}</div>
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
