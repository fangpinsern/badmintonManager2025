import { create } from "zustand";
import { nanoid } from "nanoid";
import { Session, PlatformPlayer, Player, Court, Game } from "@/types/player";
import { createSessionDoc, deleteSessionDoc } from "@/lib/firestoreSessions";
import { computeSessionStats } from "@/lib/helper";

interface StoreState {
  sessions: Session[];
  platformPlayers: PlatformPlayer[];
  linkPlayerToAccount: (
    sessionId: string,
    playerId: string,
    accountUid: string
  ) => void;
  unlinkPlayerFromAccount: (sessionId: string, playerId: string) => void;
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
    pair: "A" | "B" | null
  ) => void;
  endGame: (
    sessionId: string,
    courtIndex: number,
    scoreA: number,
    scoreB: number
  ) => void;
  voidGame: (sessionId: string, courtIndex: number) => void;
  updateGame: (
    sessionId: string,
    gameId: string,
    update: {
      scoreA: number;
      scoreB: number;
      sideA: string[];
      sideB: string[];
      durationMs?: number;
    }
  ) => void;
  endSession: (sessionId: string, shuttlesUsed?: number) => void;
  startGame: (sessionId: string, courtIndex: number) => void;
  setCourtMode: (
    sessionId: string,
    courtIndex: number,
    mode: "singles" | "doubles"
  ) => void;
  addCourt: (sessionId: string) => void;
  removeCourt: (sessionId: string, courtIndex: number) => void;
  autoAssignAvailable: (sessionId: string) => void;
  autoAssignCourt: (sessionId: string, courtIndex: number) => void;
  autoAssignNext: (sessionId: string, courtIndex: number) => void;
  enqueueToCourt: (
    sessionId: string,
    courtIndex: number,
    playerId: string
  ) => void;
  removeFromCourtQueue: (
    sessionId: string,
    courtIndex: number,
    playerId: string
  ) => void;
  clearCourtQueue: (sessionId: string, courtIndex: number) => void;
  setNextPair: (
    sessionId: string,
    courtIndex: number,
    playerId: string,
    pair: "A" | "B" | null
  ) => void;
  // updateAutoAssignConfig removed
  addBlacklistPair: (sessionId: string, a: string, b: string) => void;
  removeBlacklistPair: (sessionId: string, a: string, b: string) => void;
}

const useStore = create<StoreState>()((set, _get) => ({
  sessions: [],
  platformPlayers: [],
  linkPlayerToAccount: (sessionId, playerId, accountUid) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        const players = ss.players.map((p) =>
          p.id === playerId ? { ...p, accountUid } : p
        );
        // attempt to also link platform attendee if names match
        const platIdx = (_get().platformPlayers || []).findIndex(
          (pp) =>
            (pp.name || "").trim().toLowerCase() ===
            (players.find((p) => p.id === playerId)?.name || "")
              .trim()
              .toLowerCase()
        );
        if (platIdx !== -1) {
          const plats = [...(_get().platformPlayers || [])];
          plats[platIdx] = { ...plats[platIdx], accountUid };
          set({ platformPlayers: plats });
        }
        return { ...ss, players };
      }),
    })),
  unlinkPlayerFromAccount: (sessionId, playerId) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        const players = ss.players.map((p) => {
          if (p.id !== playerId) return p;
          const { accountUid, ...rest } = p as any;
          return { ...rest } as Player;
        });
        return { ...ss, players };
      }),
    })),

  createSession: ({ date, time, numCourts, playersPerCourt = 4 }) => {
    const id = nanoid(10);
    const courts: Court[] = Array.from(
      { length: Math.max(1, numCourts) },
      (_, i) => ({
        id: nanoid(8),
        index: i,
        playerIds: [],
        pairA: [],
        pairB: [],
        inProgress: false,
        mode: "doubles",
        queue: [],
        nextA: [],
        nextB: [],
      })
    );
    const session: Session = {
      id,
      date,
      time,
      numCourts: Math.max(1, numCourts),
      playersPerCourt: 4,
      players: [],
      attendees: [],
      courts,
      games: [],
      ended: false,
      storage: "remote",
    };
    set((s) => ({ sessions: [session, ...s.sessions] }));
    // Create remote doc for new sessions (no migration of legacy local sessions)
    void createSessionDoc(id, session);
    return id;
  },

  deleteSession: (sessionId) => {
    const found = _get().sessions.find((ss) => ss.id === sessionId);
    if (found?.storage === "remote") {
      void deleteSessionDoc(sessionId);
    }
    set((s) => ({ sessions: s.sessions.filter((ss) => ss.id !== sessionId) }));
  },

  addPlayer: (sessionId, name) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        if (ss.ended) return ss;
        const trimmed = name.trim();
        if (!trimmed) return ss;
        const newP: Player = { id: nanoid(8), name: trimmed };
        // Dual-write to platform players + attendees
        const norm = trimmed.toLowerCase();
        const allPlat = _get().platformPlayers || [];
        let plat = allPlat.find(
          (pp) => (pp.name || "").trim().toLowerCase() === norm
        );
        if (!plat) {
          plat = {
            id: newP.id,
            name: trimmed,
            createdAt: new Date().toISOString(),
          } as PlatformPlayer;
          set({ platformPlayers: [...allPlat, plat] });
        }
        const attendees = Array.from(
          new Set([...(ss.attendees || []), plat.id])
        );
        return { ...ss, players: [...ss.players, newP], attendees };
      }),
    })),

  addPlayersBulk: (sessionId, names) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        if (ss.ended) return ss;
        const existingNames = new Set(
          ss.players.map((p) => p.name.toLowerCase())
        );
        const toAdd: Player[] = [];
        let invalid = false;
        const newAttendees: string[] = [];
        let platformPlayers = _get().platformPlayers || [];
        for (const raw of names) {
          const n = (raw || "").trim();
          if (!n) continue;
          // Support formats: "Name" or "Name, M|F|O"
          let namePart = n;
          let gender: Player["gender"] | undefined = undefined;
          const parts = n
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (parts.length >= 2) {
            namePart = parts[0];
            const g = parts[1].toUpperCase();
            if (g === "M" || g === "F") gender = g as any;
            else {
              invalid = true;
              break;
            }
          }
          const key = namePart.toLowerCase();
          if (existingNames.has(key)) continue;
          existingNames.add(key);
          const id = nanoid(8);
          toAdd.push({ id, name: namePart, gender });
          const existingPlat = platformPlayers.find(
            (pp) => (pp.name || "").trim().toLowerCase() === key
          );
          const platId = existingPlat ? existingPlat.id : id;
          if (!existingPlat)
            platformPlayers.push({
              id: platId,
              name: namePart,
              gender,
              createdAt: new Date().toISOString(),
            });
          newAttendees.push(platId);
        }
        if (invalid || !toAdd.length) return ss;
        set({ platformPlayers });
        const attendees = Array.from(
          new Set([...(ss.attendees || []), ...newAttendees])
        );
        return { ...ss, players: [...ss.players, ...toAdd], attendees };
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
        // best-effort: also remove matching platform id from attendees by name
        let attendees = ss.attendees || [];
        const removed = ss.players.find((p) => p.id === playerId);
        if (removed) {
          const norm = removed.name.trim().toLowerCase();
          const plat = (_get().platformPlayers || []).find(
            (pp) => (pp.name || "").trim().toLowerCase() === norm
          );
          if (plat) attendees = attendees.filter((id) => id !== plat.id);
        }
        return { ...ss, courts, players, attendees };
      }),
    })),

  assignPlayerToCourt: (sessionId, playerId, courtIndex) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        if (ss.ended) return ss;
        const currentIdx = ss.courts.findIndex((c) =>
          c.playerIds.includes(playerId)
        );
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
        const mode = target.mode || "doubles";
        const cap = mode === "singles" ? 2 : 4;
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
          const isSingles = (c.mode || "doubles") === "singles";
          const req = isSingles ? 1 : 2;
          let nextA = (c.nextA || []).filter((id) => id !== playerId);
          let nextB = (c.nextB || []).filter((id) => id !== playerId);
          if (pair === "A" && nextA.length < req) nextA = [...nextA, playerId];
          if (pair === "B" && nextB.length < req) nextB = [...nextB, playerId];
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
          if (pair === "A" && pairA.length < 2) pairA = [...pairA, playerId];
          if (pair === "B" && pairB.length < 2) pairB = [...pairB, playerId];
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
        const a = Number.isFinite(scoreA)
          ? Math.max(0, Math.floor(scoreA))
          : NaN;
        const b = Number.isFinite(scoreB)
          ? Math.max(0, Math.floor(scoreB))
          : NaN;
        if (Number.isNaN(a) || Number.isNaN(b)) return ss;
        const winner = a > b ? "A" : b > a ? "B" : "draw";
        const endedAt = new Date();
        const startedAt = target.startedAt
          ? new Date(target.startedAt)
          : undefined;
        const durationMs = startedAt
          ? Math.max(0, endedAt.getTime() - startedAt.getTime())
          : undefined;
        const game: Game = {
          id: nanoid(8),
          courtIndex,
          endedAt: endedAt.toISOString(),
          startedAt: target.startedAt,
          durationMs,
          sideA,
          sideB,
          sideAPlayers: sideA.map((pid) => ({
            id: pid,
            name: ss.players.find((pp) => pp.id === pid)?.name || "(deleted)",
          })),
          sideBPlayers: sideB.map((pid) => ({
            id: pid,
            name: ss.players.find((pp) => pp.id === pid)?.name || "(deleted)",
          })),
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
        const isSingles = (c.mode || "doubles") === "singles";
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
            const initialA: string[] = (c.nextA || [])
              .filter((id) => c.playerIds.includes(id))
              .slice(0, reqTeam);
            const initialB: string[] = (c.nextB || [])
              .filter((id) => c.playerIds.includes(id))
              .slice(0, reqTeam);
            const remaining = c.playerIds.filter(
              (pid) => !initialA.includes(pid) && !initialB.includes(pid)
            );
            const blPairs = ss.autoAssignBlacklist?.pairs || [];
            const isBL = (x: string, y: string) =>
              blPairs.some(
                (p) => (p.a === x && p.b === y) || (p.a === y && p.b === x)
              );
            function canPlace(pid: string, team: string[]): boolean {
              for (const q of team) {
                if (isBL(pid, q)) return false;
              }
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
              if (a.length < reqTeam && canPlace(pid, a)) {
                a.push(pid);
                dfs(idx + 1, a, b);
                a.pop();
                if (bestAssign) return;
              }
              if (b.length < reqTeam && canPlace(pid, b)) {
                b.push(pid);
                dfs(idx + 1, a, b);
                b.pop();
                if (bestAssign) return;
              }
              dfs(idx + 1, a, b);
            }
            dfs(0, initialA, initialB);
            if (bestAssign) {
              c.pairA = bestAssign.a;
              c.pairB = bestAssign.b;
            } else {
              let pairA: string[] = [];
              let pairB: string[] = [];
              for (const pid of remaining) {
                if (pairA.length < reqTeam && canPlace(pid, pairA))
                  pairA.push(pid);
                else if (pairB.length < reqTeam && canPlace(pid, pairB))
                  pairB.push(pid);
                else if (pairA.length < reqTeam) pairA.push(pid);
                else if (pairB.length < reqTeam) pairB.push(pid);
                if (pairA.length >= reqTeam && pairB.length >= reqTeam) break;
              }
              c.pairA = pairA;
              c.pairB = pairB;
            }
            // clear nextA/nextB after consuming
            c.nextA = [];
            c.nextB = [];
          }
        }
        const games = [game, ...((ss as any).games || [])];
        const players = ss.players.map((p) =>
          snapshot.includes(p.id)
            ? { ...p, gamesPlayed: (p.gamesPlayed ?? 0) + 1 }
            : p
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
        const startedAt = target.startedAt
          ? new Date(target.startedAt)
          : undefined;
        const durationMs = startedAt
          ? Math.max(0, endedAt.getTime() - startedAt.getTime())
          : undefined;
        const game: Game = {
          id: nanoid(8),
          courtIndex,
          endedAt: endedAt.toISOString(),
          startedAt: target.startedAt,
          durationMs,
          sideA,
          sideB,
          sideAPlayers: sideA.map((pid) => ({
            id: pid,
            name: ss.players.find((pp) => pp.id === pid)?.name || "(deleted)",
          })),
          sideBPlayers: sideB.map((pid) => ({
            id: pid,
            name: ss.players.find((pp) => pp.id === pid)?.name || "(deleted)",
          })),
          scoreA: 0,
          scoreB: 0,
          winner: "draw",
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
        const isSingles = (c.mode || "doubles") === "singles";
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
            const initialA: string[] = (c.nextA || [])
              .filter((id) => c.playerIds.includes(id))
              .slice(0, reqTeam);
            const initialB: string[] = (c.nextB || [])
              .filter((id) => c.playerIds.includes(id))
              .slice(0, reqTeam);
            const remaining = c.playerIds.filter(
              (pid) => !initialA.includes(pid) && !initialB.includes(pid)
            );
            const blPairs = ss.autoAssignBlacklist?.pairs || [];
            const isBL = (x: string, y: string) =>
              blPairs.some(
                (p) => (p.a === x && p.b === y) || (p.a === y && p.b === x)
              );
            function canPlace(pid: string, team: string[]): boolean {
              for (const q of team) {
                if (isBL(pid, q)) return false;
              }
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
              if (a.length < reqTeam && canPlace(pid, a)) {
                a.push(pid);
                dfs(idx + 1, a, b);
                a.pop();
                if (bestAssign) return;
              }
              if (b.length < reqTeam && canPlace(pid, b)) {
                b.push(pid);
                dfs(idx + 1, a, b);
                b.pop();
                if (bestAssign) return;
              }
              dfs(idx + 1, a, b);
            }
            dfs(0, initialA, initialB);
            if (bestAssign) {
              c.pairA = bestAssign.a;
              c.pairB = bestAssign.b;
            } else {
              let pairA: string[] = [];
              let pairB: string[] = [];
              for (const pid of remaining) {
                if (pairA.length < reqTeam && canPlace(pid, pairA))
                  pairA.push(pid);
                else if (pairB.length < reqTeam && canPlace(pid, pairB))
                  pairB.push(pid);
                else if (pairA.length < reqTeam) pairA.push(pid);
                else if (pairB.length < reqTeam) pairB.push(pid);
                if (pairA.length >= reqTeam && pairB.length >= reqTeam) break;
              }
              c.pairA = pairA;
              c.pairB = pairB;
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
          const winner: Game["winner"] =
            scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "draw";
          const sideAPlayers = sideA.map((pid) => ({
            id: pid,
            name: ss.players.find((pp) => pp.id === pid)?.name || "(deleted)",
          }));
          const sideBPlayers = sideB.map((pid) => ({
            id: pid,
            name: ss.players.find((pp) => pp.id === pid)?.name || "(deleted)",
          }));
          const updated: Game = {
            ...g,
            scoreA,
            scoreB,
            sideA,
            sideB,
            sideAPlayers,
            sideBPlayers,
            winner,
            durationMs:
              typeof update.durationMs === "number"
                ? Math.max(0, Math.floor(update.durationMs))
                : g.durationMs,
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
        const isSingles = (c.mode || "doubles") === "singles";
        const requiredPerTeam = isSingles ? 1 : 2;
        const ready =
          (c.pairA?.length || 0) === requiredPerTeam &&
          (c.pairB?.length || 0) === requiredPerTeam;
        const filled = c.playerIds.length === requiredPerTeam * 2;
        if (!ready || !filled) return ss;
        // block start if any player is currently in another ongoing match
        const busyElsewhere = new Set<string>();
        ss.courts.forEach((cc, i) => {
          if (i !== courtIndex && cc.inProgress)
            cc.playerIds.forEach((pid) => busyElsewhere.add(pid));
        });
        const hasBusy = c.playerIds.some((pid) => busyElsewhere.has(pid));
        if (hasBusy) return ss;
        const courts = ss.courts.map((cc, i) =>
          i === courtIndex
            ? { ...cc, inProgress: true, startedAt: new Date().toISOString() }
            : cc
        );
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
          const cap = mode === "singles" ? 2 : 4;
          const kept = c.playerIds.slice(0, cap);
          // also clear nextA/nextB as capacities change
          return {
            ...c,
            mode,
            playerIds: kept,
            pairA: [],
            pairB: [],
            nextA: [],
            nextB: [],
          };
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
          mode: "doubles",
        };
        return {
          ...ss,
          courts: [...ss.courts, newCourt],
          numCourts: nextIndex + 1,
        };
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
        const newCourts = ss.courts
          .filter((_, i) => i !== courtIndex)
          .map((c, i) => ({ ...c, index: i }));
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
            const inOtherQueue = ss.courts.some(
              (cc, j) => j !== courtIndex && (cc.queue || []).includes(playerId)
            );
            if (inOtherQueue) return c;
            // do not allow if player is assigned to any court that is not yet started
            const onPendingCourt = ss.courts.some(
              (cc) => !cc.inProgress && cc.playerIds.includes(playerId)
            );
            if (onPendingCourt) return c;
            // limit queue to next-game only: max cap players
            const cap = (c.mode || "doubles") === "singles" ? 2 : 4;
            const q = [...(c.queue || [])];
            if (q.length >= cap) return c;
            const updated = { ...c, queue: [...q, playerId] };
            return updated;
          }
          // If not in-progress, prefer assigning directly if capacity allows
          const cap = (c.mode || "doubles") === "singles" ? 2 : 4;
          if (c.playerIds.length < cap && !c.playerIds.includes(playerId)) {
            return { ...c, playerIds: [...c.playerIds, playerId] };
          }
          const inQueue = (c.queue || []).includes(playerId);
          if (inQueue) return c;
          const inOtherQueue = ss.courts.some(
            (cc, j) => j !== courtIndex && (cc.queue || []).includes(playerId)
          );
          if (inOtherQueue) return c;
          const onPendingCourt = ss.courts.some(
            (cc) => !cc.inProgress && cc.playerIds.includes(playerId)
          );
          if (onPendingCourt) return c;
          const q = [...(c.queue || [])];
          if (q.length >= cap) return c;
          return { ...c, queue: [...q, playerId] };
        });
        return { ...ss, courts };
      }),
    })),

  removeFromCourtQueue: (sessionId, courtIndex, playerId) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        const courts = ss.courts.map((c, i) =>
          i === courtIndex
            ? {
                ...c,
                queue: (c.queue || []).filter((pid) => pid !== playerId),
                nextA: (c.nextA || []).filter((pid) => pid !== playerId),
                nextB: (c.nextB || []).filter((pid) => pid !== playerId),
              }
            : c
        );
        return { ...ss, courts };
      }),
    })),

  clearCourtQueue: (sessionId, courtIndex) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        const courts = ss.courts.map((c, i) =>
          i === courtIndex ? { ...c, queue: [], nextA: [], nextB: [] } : c
        );
        return { ...ss, courts };
      }),
    })),

  // toggleCourtQueueAutofill removed: auto-fill is always enabled

  autoAssignAvailable: (sessionId) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        if (ss.ended) return ss;
        // Build a working copy of courts
        const courts = ss.courts.map((c) => ({
          ...c,
          playerIds: [...c.playerIds],
        }));
        const assigned = new Set<string>(courts.flatMap((c) => c.playerIds));
        const unassignedPlayers = ss.players.filter((p) => !assigned.has(p.id));
        for (const p of unassignedPlayers) {
          // find first court with capacity and not in progress
          let placed = false;
          for (let i = 0; i < courts.length; i++) {
            const c = courts[i];
            if (c.inProgress) continue;
            const cap = (c.mode || "doubles") === "singles" ? 2 : 4;
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
        const courts = ss.courts.map((c) => ({
          ...c,
          playerIds: [...c.playerIds],
        }));
        const court = courts[courtIndex];
        if (!court || court.inProgress) return ss;
        const isSingles = (court.mode || "doubles") === "singles";
        const cap = isSingles ? 2 : 4;
        const need = cap - court.playerIds.length;
        if (need <= 0) return ss;

        // Build unassigned pool
        const assigned = new Set<string>(courts.flatMap((c) => c.playerIds));
        const allPlayers = ss.players.map((p) => ({
          id: p.id,
          name: p.name,
          games: p.gamesPlayed ?? 0,
        }));
        const excluded = new Set(ss.autoAssignExclude || []);
        const pool = allPlayers.filter(
          (p) => !assigned.has(p.id) && !excluded.has(p.id)
        );
        if (pool.length === 0) return ss;

        // Compute consecutive-game streaks (higher means more back-to-back games)
        const streak = new Map<string, number>();
        const gamesSorted = [...(ss.games || [])].sort(
          (a, b) =>
            new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
        );
        for (const p of ss.players) {
          let cst = 0;
          for (const g of gamesSorted) {
            const inG = (
              g.players && g.players.length
                ? g.players
                : [...g.sideA, ...g.sideB]
            ).includes(p.id);
            if (inG) cst += 1;
            else break;
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
        for (const g of ss.games || []) {
          const ps =
            g.players && g.players.length
              ? g.players
              : [...g.sideA, ...g.sideB];
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
          pool.sort(
            (a, b) => a.games - b.games || a.name.localeCompare(b.name)
          );
        }

        const chosen: string[] = [];
        const candidateIds = pool.map((p) => p.id);
        const fairnessW = 1;
        const repeatW = 1000;
        const restW = 2000; // strong penalty to avoid back-to-back
        const genderBalancePenalty = (ids: string[]) => {
          // Only applies to doubles; penalize if team A and B can't be balanced by gender (M/F)
          // We don't know team split here; approximate by penalizing odd counts of M or F in the chosen set
          const genders = new Map<string, Player["gender"]>();
          ss.players.forEach((p) => {
            if (p.gender) genders.set(p.id, p.gender);
          });
          let m = 0,
            f = 0;
          for (const id of ids) {
            const g = genders.get(id);
            if (g === "M") m++;
            else if (g === "F") f++;
          }
          // best-balanced doubles set has even counts of each (e.g., 0/4, 2/2, 4/0), otherwise add penalty
          const isBalanced = m % 2 === 0 && f % 2 === 0;
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
              const score =
                repeat * repeatW +
                fairnessW * (a.games + b.games) +
                restW * ((streak.get(a.id) || 0) + (streak.get(b.id) || 0));
              if (!best || score < best.score)
                best = { pair: [a.id, b.id], score };
            }
          }
          if (best) chosen.push(...best.pair);
          else
            chosen.push(
              ...candidateIds.slice(0, Math.min(need, candidateIds.length))
            );
        } else {
          // Doubles: choose 4 players minimizing co-appearance among the 4 and total games
          const K = Math.min(candidateIds.length, 8);
          let bestSet: string[] = [];
          let bestScore = Infinity;
          let bestHasBlacklist = true; // prefer non-blacklisted sets first
          const idxs: number[] = Array.from({ length: K }, (_, i) => i);
          // enumerate combinations of size (need) but at least up to 4; if need<4, still pick need
          const choose = (
            arr: number[],
            k: number,
            start: number,
            acc: number[]
          ) => {
            if (acc.length === k) {
              const ids = acc.map((ii) => pool[ii].id);
              // blacklist detection for doubles pairs (highest priority to avoid)
              let hasBlacklist = false;
              if ((ss.autoAssignBlacklist?.pairs || []).length) {
                const bl = ss.autoAssignBlacklist!.pairs;
                const hasPair = (x: string, y: string) =>
                  bl.some(
                    (p) => (p.a === x && p.b === y) || (p.a === y && p.b === x)
                  );
                outer: for (let i = 0; i < ids.length; i++) {
                  for (let j = i + 1; j < ids.length; j++) {
                    if (hasPair(ids[i], ids[j])) {
                      hasBlacklist = true;
                      break outer;
                    }
                  }
                }
              }
              // compute repeat score
              let repeat = 0;
              for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++)
                  repeat += getCo(ids[i], ids[j]);
              }
              let gamesSum = 0;
              for (const ii of acc) gamesSum += pool[ii].games;
              let restSum = 0;
              for (const id of ids) restSum += streak.get(id) || 0;
              const score =
                genderBalancePenalty(ids) +
                repeat * repeatW +
                fairnessW * gamesSum +
                restW * restSum;
              if (
                (!hasBlacklist && bestHasBlacklist) ||
                (hasBlacklist === bestHasBlacklist && score < bestScore)
              ) {
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
        const remaining = court.playerIds.filter(
          (pid) => !initialA.includes(pid) && !initialB.includes(pid)
        );
        const blPairs = ss.autoAssignBlacklist?.pairs || [];
        const isBL = (x: string, y: string) =>
          blPairs.some(
            (p) => (p.a === x && p.b === y) || (p.a === y && p.b === x)
          );

        function canPlace(pid: string, team: string[]): boolean {
          for (const q of team) {
            if (isBL(pid, q)) return false;
          }
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
            a.push(pid);
            dfs(idx + 1, a, b);
            a.pop();
            if (bestAssign) return; // found valid
          }
          // try B
          if (b.length < reqTeam && canPlace(pid, b)) {
            b.push(pid);
            dfs(idx + 1, a, b);
            b.pop();
            if (bestAssign) return;
          }
          // try skipping (if not required to fill completely)
          dfs(idx + 1, a, b);
        }

        // seed with initial members (ensure they don't violate blacklist among themselves)
        const initValid =
          initialA.every((x, i) =>
            initialA.slice(i + 1).every((y) => !isBL(x, y))
          ) &&
          initialB.every((x, i) =>
            initialB.slice(i + 1).every((y) => !isBL(x, y))
          );
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
            else if (pairB.length < reqTeam && canPlace(pid, pairB))
              pairB.push(pid);
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
        const courts = ss.courts.map((c) => ({
          ...c,
          queue: [...(c.queue || [])],
        }));
        const court = courts[courtIndex];
        if (!court) return ss;
        const isSingles = (court.mode || "doubles") === "singles";
        const cap = isSingles ? 2 : 4;

        // Build eligible pool: not on any court, not busy (in-progress), not excluded, not in any other queue
        const busy = new Set<string>();
        const queuedElsewhere = new Set<string>();
        courts.forEach((c, i) => {
          if (c.inProgress) c.playerIds.forEach((pid) => busy.add(pid));
          if (i !== courtIndex)
            (c.queue || []).forEach((pid) => queuedElsewhere.add(pid));
        });
        const excluded = new Set(ss.autoAssignExclude || []);
        const assigned = new Set<string>(courts.flatMap((c) => c.playerIds));
        const allPlayers = ss.players.map((p) => ({
          id: p.id,
          name: p.name,
          games: p.gamesPlayed ?? 0,
        }));
        // allow queuing busy players; only filter when starting the game, not for next selection
        const pool = allPlayers.filter(
          (p) =>
            !assigned.has(p.id) &&
            !excluded.has(p.id) &&
            !queuedElsewhere.has(p.id)
        );
        if (pool.length < cap) return ss;

        // Build co-appearance counts
        const coCount = new Map<string, Map<string, number>>();
        const inc = (a: string, b: string) => {
          if (a === b) return;
          if (!coCount.has(a)) coCount.set(a, new Map());
          const m = coCount.get(a)!;
          m.set(b, (m.get(b) || 0) + 1);
        };
        for (const g of ss.games || []) {
          const ps =
            g.players && g.players.length
              ? g.players
              : [...g.sideA, ...g.sideB];
          for (let i = 0; i < ps.length; i++) {
            for (let j = i + 1; j < ps.length; j++) {
              inc(ps[i], ps[j]);
              inc(ps[j], ps[i]);
            }
          }
        }
        const getCo = (a: string, b: string) => coCount.get(a)?.get(b) || 0;

        // gender balance penalty (like court auto-assign) + rest streak
        const genderBalancePenalty = (ids: string[]) => {
          const genders = new Map<string, Player["gender"]>();
          ss.players.forEach((p) => {
            if (p.gender) genders.set(p.id, p.gender);
          });
          let m = 0,
            f = 0;
          for (const id of ids) {
            const g = genders.get(id);
            if (g === "M") m++;
            else if (g === "F") f++;
          }
          const isBalanced = m % 2 === 0 && f % 2 === 0;
          if ((ss.autoAssignConfig?.balanceGender ?? true) === false) return 0;
          return isBalanced ? 0 : 500;
        };
        const streak = new Map<string, number>();
        const gamesSorted = [...(ss.games || [])].sort(
          (a, b) =>
            new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
        );
        for (const p of ss.players) {
          let cst = 0;
          for (const g of gamesSorted) {
            const inG = (
              g.players && g.players.length
                ? g.players
                : [...g.sideA, ...g.sideB]
            ).includes(p.id);
            if (inG) cst += 1;
            else break;
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
              const score =
                repeat * repeatW +
                fairnessW * (a.games + b.games) +
                2000 * ((streak.get(a.id) || 0) + (streak.get(b.id) || 0));
              if (!best || score < best.score)
                best = { pair: [a.id, b.id], score };
            }
          }
          if (best) chosen.push(...best.pair);
        } else {
          const K = Math.min(pool.length, 8);
          let bestSet: string[] = [];
          let bestScore = Infinity;
          let bestHasBlacklist = true;
          const idxs: number[] = Array.from({ length: K }, (_, i) => i);
          const choose = (
            arr: number[],
            k: number,
            start: number,
            acc: number[]
          ) => {
            if (acc.length === k) {
              const ids = acc.map((ii) => pool[ii].id);
              let hasBlacklist = false;
              const bl = ss.autoAssignBlacklist?.pairs || [];
              const hasPair = (x: string, y: string) =>
                bl.some(
                  (p) => (p.a === x && p.b === y) || (p.a === y && p.b === x)
                );
              outer: for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                  if (hasPair(ids[i], ids[j])) {
                    hasBlacklist = true;
                    break outer;
                  }
                }
              }
              let repeat = 0;
              for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++)
                  repeat += getCo(ids[i], ids[j]);
              }
              let gamesSum = 0;
              for (const ii of acc) gamesSum += pool[ii].games;
              let restSum = 0;
              for (const id of ids) restSum += streak.get(id) || 0;
              const score =
                genderBalancePenalty(ids) +
                repeat * repeatW +
                fairnessW * gamesSum +
                2000 * restSum;
              if (
                (!hasBlacklist && bestHasBlacklist) ||
                (hasBlacklist === bestHasBlacklist && score < bestScore)
              ) {
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
          choose(idxs, 4, 0, []);
          if (bestSet.length) chosen.push(...bestSet);
        }
        if (chosen.length < cap) return ss;

        // Set queue to chosen and compute nextA/nextB avoiding blacklists
        court.queue = chosen.slice(0, cap);
        court.nextA = [];
        court.nextB = [];
        const blPairs = ss.autoAssignBlacklist?.pairs || [];
        const isBL = (x: string, y: string) =>
          blPairs.some(
            (p) => (p.a === x && p.b === y) || (p.a === y && p.b === x)
          );
        function canPlace(pid: string, team: string[]): boolean {
          for (const q of team) {
            if (isBL(pid, q)) return false;
          }
          return true;
        }
        const reqTeam = isSingles ? 1 : 2;
        let bestAssign: { a: string[]; b: string[] } | null = null as any;
        function dfs(idx: number, a: string[], b: string[]) {
          if (a.length > reqTeam || b.length > reqTeam) return;
          if (idx === court.queue.length) {
            if (a.length === reqTeam && b.length === reqTeam)
              bestAssign = { a: [...a], b: [...b] };
            return;
          }
          const pid = court.queue[idx];
          if (a.length < reqTeam && canPlace(pid, a)) {
            a.push(pid);
            dfs(idx + 1, a, b);
            a.pop();
            if (bestAssign) return;
          }
          if (b.length < reqTeam && canPlace(pid, b)) {
            b.push(pid);
            dfs(idx + 1, a, b);
            b.pop();
            if (bestAssign) return;
          }
          dfs(idx + 1, a, b);
        }
        dfs(0, [], []);
        if (bestAssign) {
          court.nextA = bestAssign.a;
          court.nextB = bestAssign.b;
        }

        return { ...ss, courts };
      }),
    })),

  addBlacklistPair: (sessionId, a, b) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        const pairs = ss.autoAssignBlacklist?.pairs || [];
        const exists = pairs.some(
          (p) => (p.a === a && p.b === b) || (p.a === b && p.b === a)
        );
        if (exists) return ss;
        return { ...ss, autoAssignBlacklist: { pairs: [...pairs, { a, b }] } };
      }),
    })),

  removeBlacklistPair: (sessionId, a, b) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        const pairs = ss.autoAssignBlacklist?.pairs || [];
        const filtered = pairs.filter(
          (p) => !((p.a === a && p.b === b) || (p.a === b && p.b === a))
        );
        return { ...ss, autoAssignBlacklist: { pairs: filtered } };
      }),
    })),

  endSession: (sessionId, shuttlesUsed) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        if (ss.ended) return ss;
        if ((ss.courts || []).some((c) => c.inProgress)) return ss; // block if any game in progress
        const stats = {
          ...computeSessionStats(ss),
          shuttlesUsed:
            typeof shuttlesUsed === "number" &&
            isFinite(shuttlesUsed) &&
            shuttlesUsed >= 0
              ? Math.floor(shuttlesUsed)
              : undefined,
        };
        return { ...ss, ended: true, endedAt: new Date().toISOString(), stats };
      }),
    })),
}));

export { useStore };
