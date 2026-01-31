import { create } from "zustand";
import { nanoid } from "nanoid";
import { Session, PlatformPlayer, Player, Court, Game } from "@/types/player";
import { createSessionDoc, deleteSessionDoc } from "@/lib/firestoreSessions";
import { computeSessionStats } from "@/lib/helper";
import {
  computeCompetitiveAssignmentForCourt,
  computeCompetitiveNextQueue,
  applyEloAfterGame,
} from "@/lib/autoAssign";
import { logAnalyticsEvent } from "@/lib/analytics";

// Analytics tracking state for auto-assign (ephemeral, not persisted)
interface AutoAssignAnalyticsState {
  // Key: `${sessionId}:${courtIndex}`
  clickCounts: Record<string, number>;
  // Timestamp of first auto-assign click for this court (to calculate time-to-start)
  firstClickTimestamp: Record<string, number>;
  // Timestamp of last auto-assign click for this court
  lastClickTimestamp: Record<string, number>;
  // Track if manual adjustment happened after auto-assign
  manualAdjustments: Record<string, number>;
  // Session-level aggregation: total auto-assign clicks per session
  sessionTotalClicks: Record<string, number>;
  // Session-level: total games started per session (for ratio calculation)
  sessionGamesStarted: Record<string, number>;
}

interface StoreState {
  sessions: Session[];
  platformPlayers: PlatformPlayer[];
  // UI-only transient error for auto-assign, not persisted to Firestore
  lastAutoAssignError?: { msg: string; courtIndex?: number };
  // Ephemeral tracking for auto-assign analytics (not persisted)
  autoAssignAnalytics: AutoAssignAnalyticsState;
  // Legacy: kept for backwards compatibility during transition
  autoAssignClickCounts: Record<string, number>;
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
    clubId?: string;
    playerLimit?: number;
    venue?: Session["venue"];
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
    scoreB: number,
    endedByUid?: string | null,
    endedByRole?: "organizer" | "co-organizer",
    opts?: {
      umpireHistory?: {
        rallyNo: number;
        winnerSide: "A" | "B";
        rallyDurationMs?: number;
        reason?: {
          code: string;
          attr: "WINNER" | "LOSER" | "NONE";
          attributedTo?: { playerId?: string };
        };
      }[];
      intensity?: "low" | "mid" | "high";
      caloriesEstimate?: number;
    }
  ) => void;
  voidGame: (
    sessionId: string,
    courtIndex: number,
    endedByUid?: string | null,
    endedByRole?: "organizer" | "co-organizer"
  ) => void;
  addCoOrganizer: (sessionId: string, uid: string) => void;
  removeCoOrganizer: (sessionId: string, uid: string) => void;
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
  autoAssignAllCourts: (sessionId: string) => void;
  autoAssignNext: (sessionId: string, courtIndex: number) => void;
  clearCourtAssignments: (sessionId: string, courtIndex: number) => void;
  clearAllCourts: (sessionId: string) => void;
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
  updateSessionConfig: (
    sessionId: string,
    partial: Partial<NonNullable<Session["autoAssignConfig"]>>
  ) => void;
  updateSessionMeta: (sessionId: string, partial: Partial<Session>) => void;
  setPaymentRequest: (
    sessionId: string,
    info: {
      enabled?: boolean;
      courtCost?: number;
      shuttleCost?: number;
      recipientPlayerId?: string;
    }
  ) => void;
}

const useStore = create<StoreState>()((set, _get) => ({
  sessions: [],
  platformPlayers: [],
  autoAssignClickCounts: {},
  autoAssignAnalytics: {
    clickCounts: {},
    firstClickTimestamp: {},
    lastClickTimestamp: {},
    manualAdjustments: {},
    sessionTotalClicks: {},
    sessionGamesStarted: {},
  },
  linkPlayerToAccount: (sessionId, playerId, accountUid) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        // set accountUid, capture previous name for organizer-unlink, and optimistically set name to username if known later (left to server)
        // Enforce 1:1 mapping locally: if accountUid already linked to another player, do not link
        if (ss.players.some((p) => p.accountUid === accountUid)) return ss;
        const players = ss.players.map((p) => {
          if (p.id !== playerId) return p;
          // If this player is already linked to a different account, block
          if (p.accountUid && p.accountUid !== accountUid) return p;
          const nameBeforeLink = (p as any).nameBeforeLink || p.name;
          return { ...p, accountUid, nameBeforeLink } as Player & {
            nameBeforeLink?: string;
          };
        });
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
        // If the unlinked player was a co-organizer, remove their uid from coOrganizerUids
        const removed = ss.players.find((p) => p.id === playerId);
        const nextCo = removed?.accountUid
          ? (ss.coOrganizerUids || []).filter((u) => u !== removed!.accountUid)
          : ss.coOrganizerUids;
        return { ...ss, players, coOrganizerUids: nextCo };
      }),
    })),

  createSession: ({
    date,
    time,
    numCourts,
    playersPerCourt = 4,
    clubId,
    playerLimit,
    venue,
  }) => {
    const clampedCourts = Math.max(1, Math.min(10, numCourts));
    const id = nanoid(10);
    const courts: Court[] = Array.from({ length: clampedCourts }, (_, i) => ({
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
    }));
    const session: Session = {
      id,
      date,
      time,
      numCourts: clampedCourts,
      playersPerCourt: 4,
      players: [],
      attendees: [],
      courts,
      games: [],
      ended: false,
      storage: "remote",
      clubId: clubId || undefined,
      playerLimit:
        typeof playerLimit === "number" &&
        isFinite(playerLimit) &&
        playerLimit > 0
          ? Math.floor(playerLimit)
          : undefined,
      venue: (() => {
        if (!venue) return undefined;
        const name = (venue.name || "").trim();
        const id = (venue as any).id ? String((venue as any).id) : undefined;
        const loc = venue.location;
        if (!name && !loc && !id) return undefined;
        const out: NonNullable<Session["venue"]> = {} as any;
        if (id) (out as any).id = id;
        if (name) out.name = name;
        if (
          loc &&
          typeof loc.lat === "number" &&
          typeof loc.lng === "number" &&
          isFinite(loc.lat) &&
          isFinite(loc.lng)
        ) {
          out.location = {
            lat: loc.lat,
            lng: loc.lng,
            address: (loc.address || "").trim() || undefined,
            placeId: (loc.placeId || "").trim() || undefined,
          } as any;
        }
        return out;
      })(),
    };
    console.log("creating session", clubId, session);
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
        const nextPlatformPlayers = [...(_get().platformPlayers || [])];
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
          const existingPlat = nextPlatformPlayers.find(
            (pp) => (pp.name || "").trim().toLowerCase() === key
          );
          const platId = existingPlat ? existingPlat.id : id;
          if (!existingPlat)
            nextPlatformPlayers.push({
              id: platId,
              name: namePart,
              gender,
              createdAt: new Date().toISOString(),
            });
          newAttendees.push(platId);
        }
        if (invalid || !toAdd.length) return ss;
        set({ platformPlayers: nextPlatformPlayers });
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
        // Remove this player from attendees by id and best-effort by platform id (matched by name)
        let attendees = (ss.attendees || []).filter((id) => id !== playerId);
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
          // Also remove from existing team assignments on that court
          pairA: (c.pairA || []).filter((pid) => pid !== playerId),
          pairB: (c.pairB || []).filter((pid) => pid !== playerId),
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
    set((s) => {
      const clickKey = `${sessionId}:${courtIndex}`;
      const analytics = s.autoAssignAnalytics;
      
      // Track if this is a manual adjustment after auto-assign
      const hadAutoAssign = (analytics.clickCounts[clickKey] || 0) > 0;
      
      let nextAnalytics = analytics;
      if (hadAutoAssign) {
        const currentAdjustments = analytics.manualAdjustments[clickKey] || 0;
        nextAnalytics = {
          ...analytics,
          manualAdjustments: {
            ...analytics.manualAdjustments,
            [clickKey]: currentAdjustments + 1,
          },
        };

        // Log manual adjustment event (only if after auto-assign)
        void logAnalyticsEvent("auto_assign_manual_adjustment", {
          session_id: sessionId,
          court_index: courtIndex,
          adjustment_type: pair === null ? "remove_from_pair" : `add_to_pair_${pair}`,
          adjustment_count: currentAdjustments + 1,
          auto_assign_clicks: analytics.clickCounts[clickKey] || 0,
        });
      }

      return {
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
        autoAssignAnalytics: nextAnalytics,
      };
    }),

  endGame: (
    sessionId,
    courtIndex,
    scoreA,
    scoreB,
    endedByUid,
    endedByRole,
    opts
  ) =>
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
          intensity: opts?.intensity,
          caloriesEstimate: opts?.caloriesEstimate,
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
          endedByUid: endedByUid || undefined,
          endedByRole: endedByRole || undefined,
        };
        // Attach optional umpire insights if provided and valid
        try {
          const totalPoints = a + b;
          if (
            Array.isArray(opts?.umpireHistory) &&
            opts!.umpireHistory.length === totalPoints
          ) {
            (game as any).umpireHistory = opts!.umpireHistory.map((e) => ({
              rallyNo: e.rallyNo,
              winnerSide: e.winnerSide,
              rallyDurationMs:
                typeof e.rallyDurationMs === "number"
                  ? e.rallyDurationMs
                  : undefined,
              reason: e.reason
                ? {
                    code: e.reason.code,
                    attr: e.reason.attr,
                    attributedTo: e.reason.attributedTo
                      ? {
                          playerId: e.reason.attributedTo.playerId,
                        }
                      : undefined,
                  }
                : undefined,
            }));
            // Derive compact summary stats for quick display
            try {
              const hist = (game as any).umpireHistory || [];
              const durations: number[] = hist
                .map((h: any) =>
                  typeof h?.rallyDurationMs === "number"
                    ? h.rallyDurationMs
                    : null
                )
                .filter((v: any) => typeof v === "number") as number[];
              const avgRallyDurationMs =
                durations.length > 0
                  ? Math.floor(
                      durations.reduce((acc, cur) => acc + cur, 0) /
                        durations.length
                    )
                  : undefined;
              const longestRallyDurationMs =
                durations.length > 0 ? Math.max(...durations) : undefined;
              const winnersCount: Record<string, number> = {};
              const losersCount: Record<string, number> = {};
              for (const h of hist) {
                try {
                  const r = (h as any)?.reason;
                  const pid = r?.attributedTo?.playerId;
                  if (!pid) continue;
                  if (r?.attr === "WINNER") {
                    winnersCount[pid] = (winnersCount[pid] || 0) + 1;
                  } else if (r?.attr === "LOSER") {
                    losersCount[pid] = (losersCount[pid] || 0) + 1;
                  }
                } catch {}
              }
              let mvps:
                | { playerId: string; winners?: number; losers?: number }[]
                | undefined = undefined;
              if (winner !== "draw") {
                const teamIds = winner === "A" ? sideA : sideB;
                // Primary: most winners among winning team (allow ties)
                const winnerVals = teamIds.map((pid) => winnersCount[pid] || 0);
                const bestWinners =
                  winnerVals.length > 0 ? Math.max(...winnerVals) : -1;
                if (bestWinners > 0) {
                  mvps = teamIds
                    .filter((pid) => (winnersCount[pid] || 0) === bestWinners)
                    .map((pid) => ({
                      playerId: pid,
                      winners: winnersCount[pid] || 0,
                      losers: losersCount[pid] || 0,
                    }));
                } else {
                  // Fallback: fewest losers among winning team (allow ties)
                  const loserVals = teamIds.map((pid) => losersCount[pid] || 0);
                  const fewestLosers =
                    loserVals.length > 0 ? Math.min(...loserVals) : 0;
                  mvps = teamIds
                    .filter((pid) => (losersCount[pid] || 0) === fewestLosers)
                    .map((pid) => ({
                      playerId: pid,
                      winners: winnersCount[pid] || 0,
                      losers: losersCount[pid] || 0,
                    }));
                }
              }
              (game as any).umpireSummary = {
                totalRallies: hist.length,
                avgRallyDurationMs,
                longestRallyDurationMs,
                mvps,
              };
            } catch {}
          }
        } catch {}
        const courts = ss.courts.map((c) => ({ ...c }));
        const c = courts[courtIndex];
        // clear current court state
        c.playerIds = [];
        c.pairA = [];
        c.pairB = [];
        c.inProgress = false;
        c.startedAt = undefined;
        // clear any umpire lock
        (c as any).umpireUid = undefined;
        (c as any).umpireSince = undefined;
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
              const pairA: string[] = [];
              const pairB: string[] = [];
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

  voidGame: (sessionId, courtIndex, endedByUid, endedByRole) =>
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
          endedByUid: endedByUid || undefined,
          endedByRole: endedByRole || undefined,
        };
        const courts = ss.courts.map((c) => ({ ...c }));
        const c = courts[courtIndex];
        // clear current court state
        c.playerIds = [];
        c.pairA = [];
        c.pairB = [];
        c.inProgress = false;
        c.startedAt = undefined;
        // clear any umpire lock
        (c as any).umpireUid = undefined;
        (c as any).umpireSince = undefined;
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
              const pairA: string[] = [];
              const pairB: string[] = [];
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
    set((s) => {
      let gameStarted = false;
      let courtMode: "singles" | "doubles" = "doubles";

      const nextSessions = s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        if (ss.ended) return ss;
        const c = ss.courts[courtIndex];
        if (!c) return ss;
        if (c.inProgress) return ss;
        const isSingles = (c.mode || "doubles") === "singles";
        courtMode = isSingles ? "singles" : "doubles";
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
        gameStarted = true;
        const courts = ss.courts.map((cc, i) =>
          i === courtIndex
            ? { ...cc, inProgress: true, startedAt: new Date().toISOString() }
            : cc
        );
        return { ...ss, courts };
      });

      // If game started, log analytics with comprehensive auto-assign journey data
      if (gameStarted) {
        const clickKey = `${sessionId}:${courtIndex}`;
        const now = Date.now();
        const analytics = s.autoAssignAnalytics;
        
        const autoAssignClickCount = analytics.clickCounts[clickKey] || 0;
        const firstClickTime = analytics.firstClickTimestamp[clickKey];
        const lastClickTime = analytics.lastClickTimestamp[clickKey];
        const manualAdjustmentCount = analytics.manualAdjustments[clickKey] || 0;
        
        // Calculate time from first auto-assign to game start (in seconds)
        const timeFromFirstAutoAssign = firstClickTime 
          ? Math.round((now - firstClickTime) / 1000) 
          : undefined;
        // Calculate time from last auto-assign to game start (in seconds)
        const timeFromLastAutoAssign = lastClickTime 
          ? Math.round((now - lastClickTime) / 1000) 
          : undefined;

        // Get session config for analytics
        const session = s.sessions.find((ss) => ss.id === sessionId);
        const config = session?.autoAssignConfig;
        const totalPlayersInSession = session?.players.length || 0;
        const totalCourtsInSession = session?.courts.length || 0;
        const gamesPlayedInSession = session?.games.length || 0;

        // Log game start event with comprehensive auto-assign journey data
        void logAnalyticsEvent("game_started", {
          session_id: sessionId,
          court_index: courtIndex,
          court_mode: courtMode,
          // Core auto-assign metrics
          auto_assign_clicks_before_start: autoAssignClickCount,
          used_auto_assign: autoAssignClickCount > 0,
          // Time tracking (in seconds)
          seconds_from_first_auto_assign: timeFromFirstAutoAssign,
          seconds_from_last_auto_assign: timeFromLastAutoAssign,
          // Manual adjustment tracking
          manual_adjustments_after_auto_assign: manualAdjustmentCount,
          had_manual_adjustments: manualAdjustmentCount > 0,
          // Configuration
          priority: config?.priority || "default",
          respect_gender: config?.respectGender || "soft",
          blacklist_mode: config?.blacklistMode || "hard",
          // Session context
          total_players: totalPlayersInSession,
          total_courts: totalCourtsInSession,
          games_played_in_session: gamesPlayedInSession,
        });

        // Update session-level game counter
        const nextSessionGamesStarted = {
          ...analytics.sessionGamesStarted,
          [sessionId]: (analytics.sessionGamesStarted[sessionId] || 0) + 1,
        };

        // Reset tracking for this court
        const nextAnalytics: AutoAssignAnalyticsState = {
          ...analytics,
          clickCounts: { ...analytics.clickCounts },
          firstClickTimestamp: { ...analytics.firstClickTimestamp },
          lastClickTimestamp: { ...analytics.lastClickTimestamp },
          manualAdjustments: { ...analytics.manualAdjustments },
          sessionTotalClicks: analytics.sessionTotalClicks,
          sessionGamesStarted: nextSessionGamesStarted,
        };
        delete nextAnalytics.clickCounts[clickKey];
        delete nextAnalytics.firstClickTimestamp[clickKey];
        delete nextAnalytics.lastClickTimestamp[clickKey];
        delete nextAnalytics.manualAdjustments[clickKey];

        // Legacy support
        const nextClickCounts = { ...s.autoAssignClickCounts };
        delete nextClickCounts[clickKey];

        return {
          sessions: nextSessions,
          autoAssignClickCounts: nextClickCounts,
          autoAssignAnalytics: nextAnalytics,
        };
      }

      return { sessions: nextSessions };
    }),

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
        if (ss.courts.length >= 10) return ss; // enforce max 10 courts
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
    set((s) => {
      let errorMsg: string | undefined = undefined;
      let assignSuccess = false;
      let isReroll = false;
      let playersAssigned = 0;
      let courtMode: "singles" | "doubles" = "doubles";
      const nextSessions = s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        if (ss.ended) return ss;
        const courts = ss.courts.map((c) => ({
          ...c,
          playerIds: [...c.playerIds],
        }));
        const court = courts[courtIndex];
        if (!court || court.inProgress) return ss;
        courtMode = (court.mode || "doubles") as "singles" | "doubles";
        const result = computeCompetitiveAssignmentForCourt(
          { ...ss, courts },
          courtIndex
        );
        if (!result) {
          errorMsg =
            "Auto-assign could not find a valid assignment for this court.";
          return ss;
        }
        const { playerIdsToAdd, pairA, pairB } = result;
        const cap = courtMode === "singles" ? 2 : 4;
        if (playerIdsToAdd.length === 0 && court.playerIds.length >= cap) {
          // Reroll case: replace current players with proposed matchup
          isReroll = true;
          const proposedIds =
            courtMode === "singles"
              ? [pairA[0], pairB[0]].filter(Boolean)
              : [...(pairA || []), ...(pairB || [])];
          if (proposedIds.length === cap) {
            court.playerIds = proposedIds.slice(0, cap);
            court.pairA = pairA.slice(0);
            court.pairB = pairB.slice(0);
            errorMsg = undefined;
            assignSuccess = true;
            playersAssigned = cap;
          } else {
            // Fallback to preserving existing players if proposal invalid
            court.pairA = pairA.slice(0);
            court.pairB = pairB.slice(0);
            errorMsg = "Reroll proposed invalid players; kept current players.";
          }
        } else {
          // Gap-fill / initial assignment: only add missing players
          for (const pid of playerIdsToAdd) {
            if (court.playerIds.length >= cap) break;
            if (!court.playerIds.includes(pid)) {
              court.playerIds.push(pid);
              playersAssigned++;
            }
          }
          court.pairA = pairA.slice(0);
          court.pairB = pairB.slice(0);
          assignSuccess = playersAssigned > 0 || playerIdsToAdd.length === 0;
          errorMsg =
            playerIdsToAdd.length === 0
              ? "Auto-assign found no eligible players to add."
              : undefined;
        }
        return { ...ss, courts };
      });

      // Track auto-assign analytics with timestamps
      const clickKey = `${sessionId}:${courtIndex}`;
      const now = Date.now();
      const analytics = s.autoAssignAnalytics;
      
      const prevCount = analytics.clickCounts[clickKey] || 0;
      const nextCount = prevCount + 1;
      const isFirstClick = prevCount === 0;
      
      // Update analytics state
      const nextAnalytics: AutoAssignAnalyticsState = {
        ...analytics,
        clickCounts: { ...analytics.clickCounts, [clickKey]: nextCount },
        lastClickTimestamp: { ...analytics.lastClickTimestamp, [clickKey]: now },
        firstClickTimestamp: isFirstClick 
          ? { ...analytics.firstClickTimestamp, [clickKey]: now }
          : analytics.firstClickTimestamp,
        manualAdjustments: { ...analytics.manualAdjustments }, // reset manual adjustments on new auto-assign
        sessionTotalClicks: {
          ...analytics.sessionTotalClicks,
          [sessionId]: (analytics.sessionTotalClicks[sessionId] || 0) + 1,
        },
        sessionGamesStarted: analytics.sessionGamesStarted,
      };
      // Reset manual adjustments counter when auto-assign is clicked
      delete nextAnalytics.manualAdjustments[clickKey];

      // Legacy support
      const nextClickCounts = { ...s.autoAssignClickCounts, [clickKey]: nextCount };

      // Get session config for analytics
      const session = s.sessions.find((ss) => ss.id === sessionId);
      const config = session?.autoAssignConfig;
      const totalPlayersInSession = session?.players.length || 0;
      const totalCourtsInSession = session?.courts.length || 0;

      // Log analytics event with enhanced data
      void logAnalyticsEvent("auto_assign_court", {
        session_id: sessionId,
        court_index: courtIndex,
        court_mode: courtMode,
        success: assignSuccess,
        is_reroll: isReroll,
        players_assigned: playersAssigned,
        click_count: nextCount,
        is_first_click: isFirstClick,
        priority: config?.priority || "default",
        respect_gender: config?.respectGender || "soft",
        blacklist_mode: config?.blacklistMode || "hard",
        total_players: totalPlayersInSession,
        total_courts: totalCourtsInSession,
        error_msg: errorMsg || undefined,
      });

      const out: Partial<StoreState> = {
        sessions: nextSessions,
        autoAssignClickCounts: nextClickCounts,
        autoAssignAnalytics: nextAnalytics,
      };
      // Set transient error scoped to this court
      if (typeof errorMsg !== "undefined") {
        out.lastAutoAssignError = errorMsg
          ? { msg: errorMsg, courtIndex }
          : undefined;
        // Auto-clear after 3 seconds
        setTimeout(() => {
          try {
            set((st) => {
              if (
                st.lastAutoAssignError &&
                st.lastAutoAssignError.courtIndex === courtIndex &&
                st.lastAutoAssignError.msg === errorMsg
              ) {
                return { lastAutoAssignError: undefined } as any;
              }
              return {} as any;
            });
          } catch {}
        }, 3000);
      }
      return out as any;
    }),

  autoAssignAllCourts: (sessionId) =>
    set((s) => {
      let errorMsg: string | undefined = undefined;
      // Track analytics data outside the map
      let courtsFilledCount = 0;
      let skippedCourtsCount = 0;
      const eligibleCourtIndices: number[] = [];

      const nextSessions = s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        if (ss.ended) return ss;
        // Work on a cloned courts array so we can iteratively assign and keep state consistent
        const courts = ss.courts.map((c) => ({
          ...c,
          playerIds: [...c.playerIds],
          pairA: [...(c.pairA || [])],
          pairB: [...(c.pairB || [])],
        }));
        // Build eligible courts (not in progress, not full)
        const eligible: { index: number; need: number; cap: number }[] = [];
        for (let i = 0; i < courts.length; i++) {
          const c = courts[i];
          if (c.inProgress) continue;
          const cap = (c.mode || "doubles") === "singles" ? 2 : 4;
          const need = cap - c.playerIds.length;
          if (need > 0) {
            eligible.push({ index: i, need, cap });
            eligibleCourtIndices.push(i);
          }
        }
        if (!eligible.length) {
          errorMsg = "No courts with empty slots to auto-assign.";
          return ss;
        }
        // Build set of valid player IDs to filter out stale court references
        const validPlayerIds = new Set<string>(ss.players.map((p) => p.id));
        // Count currently unassigned players (only these are available)
        // Also exclude players in autoAssignExclude
        const excluded = new Set(ss.autoAssignExclude || []);
        const assigned = new Set<string>(
          courts.flatMap((c) => c.playerIds.filter((pid) => validPlayerIds.has(pid)))
        );
        const initialAvailable = ss.players.filter(
          (p) => !assigned.has(p.id) && !excluded.has(p.id)
        ).length;
        let remainingAvailable = initialAvailable;
        // To maximize fully filled courts, prioritize those needing fewer players first
        eligible.sort((a, b) => a.need - b.need);
        const skippedCourts: number[] = [];
        for (const e of eligible) {
          if (remainingAvailable < e.need) {
            // Skip courts we cannot fully fill; avoid partial fills
            skippedCourts.push(e.index + 1); // 1-indexed for user display
            continue;
          }
          const res = computeCompetitiveAssignmentForCourt(
            { ...ss, courts },
            e.index
          );
          if (!res) {
            skippedCourts.push(e.index + 1);
            continue;
          }
          const { playerIdsToAdd, pairA, pairB } = res;
          // Only accept if we can fully fill this court in one go
          if (
            !Array.isArray(playerIdsToAdd) ||
            playerIdsToAdd.length !== e.need
          ) {
            skippedCourts.push(e.index + 1);
            continue;
          }
          // Apply assignment (gap-fill only; do not change existing players)
          const c = courts[e.index];
          for (const pid of playerIdsToAdd) {
            if (c.playerIds.length >= e.cap) break;
            if (!c.playerIds.includes(pid)) {
              c.playerIds.push(pid);
              remainingAvailable--;
            }
          }
          // Update suggested pairs (these include existing players)
          c.pairA = pairA.slice(0);
          c.pairB = pairB.slice(0);
          courtsFilledCount++;
        }
        skippedCourtsCount = skippedCourts.length;
        // Build informative error message
        if (courtsFilledCount === 0) {
          const totalNeeded = eligible.reduce((sum, e) => sum + e.need, 0);
          const shortage = totalNeeded - initialAvailable;
          if (shortage > 0) {
            errorMsg = `Not enough players. Need ${shortage} more to fill any court.`;
          } else {
            errorMsg =
              "No eligible assignments found. Check gender/blacklist constraints.";
          }
        } else if (skippedCourts.length > 0) {
          // Some courts filled, some skipped
          const totalNeeded = skippedCourts.reduce((sum, courtNum) => {
            const e = eligible.find((x) => x.index + 1 === courtNum);
            return sum + (e?.need || 0);
          }, 0);
          errorMsg = `Filled ${courtsFilledCount} court(s). Court${skippedCourts.length > 1 ? "s" : ""} ${skippedCourts.join(", ")} skipped (need ${totalNeeded} more player${totalNeeded > 1 ? "s" : ""}).`;
        }
        return { ...ss, courts };
      });

      // Get session config for analytics
      const session = s.sessions.find((ss) => ss.id === sessionId);
      const config = session?.autoAssignConfig;
      const now = Date.now();
      const analytics = s.autoAssignAnalytics;

      // Log analytics event for auto-assign all
      void logAnalyticsEvent("auto_assign_all_courts", {
        session_id: sessionId,
        total_courts: session?.courts.length || 0,
        courts_filled: courtsFilledCount,
        courts_skipped: skippedCourtsCount,
        eligible_courts: eligibleCourtIndices.length,
        success: courtsFilledCount > 0,
        priority: config?.priority || "default",
        respect_gender: config?.respectGender || "soft",
        blacklist_mode: config?.blacklistMode || "hard",
        total_players: session?.players.length || 0,
        error_msg: errorMsg || undefined,
      });

      // Increment click counts for all eligible courts
      const nextClickCounts = { ...s.autoAssignClickCounts };
      const nextAnalytics: AutoAssignAnalyticsState = {
        ...analytics,
        clickCounts: { ...analytics.clickCounts },
        firstClickTimestamp: { ...analytics.firstClickTimestamp },
        lastClickTimestamp: { ...analytics.lastClickTimestamp },
        manualAdjustments: { ...analytics.manualAdjustments },
        sessionTotalClicks: {
          ...analytics.sessionTotalClicks,
          [sessionId]: (analytics.sessionTotalClicks[sessionId] || 0) + eligibleCourtIndices.length,
        },
        sessionGamesStarted: analytics.sessionGamesStarted,
      };
      
      for (const idx of eligibleCourtIndices) {
        const key = `${sessionId}:${idx}`;
        const prevCount = nextAnalytics.clickCounts[key] || 0;
        const isFirstClick = prevCount === 0;
        
        nextClickCounts[key] = (nextClickCounts[key] || 0) + 1;
        nextAnalytics.clickCounts[key] = prevCount + 1;
        nextAnalytics.lastClickTimestamp[key] = now;
        if (isFirstClick) {
          nextAnalytics.firstClickTimestamp[key] = now;
        }
        // Reset manual adjustments on new auto-assign
        delete nextAnalytics.manualAdjustments[key];
      }

      const out: Partial<StoreState> = {
        sessions: nextSessions,
        lastAutoAssignError: errorMsg ? { msg: errorMsg } : undefined,
        autoAssignClickCounts: nextClickCounts,
        autoAssignAnalytics: nextAnalytics,
      };
      if (errorMsg) {
        setTimeout(() => {
          try {
            set((st) => {
              if (
                st.lastAutoAssignError &&
                st.lastAutoAssignError.msg === errorMsg
              ) {
                return { lastAutoAssignError: undefined } as any;
              }
              return {} as any;
            });
          } catch {}
        }, 5000); // Extended to 5s for longer messages
      }
      return out as any;
    }),

  autoAssignNext: (sessionId, courtIndex) =>
    set((s) => {
      let errorMsg: string | undefined = undefined;
      let assignSuccess = false;
      let courtMode: "singles" | "doubles" = "doubles";

      const nextSessions = s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        if (ss.ended) return ss;
        const courts = ss.courts.map((c) => ({
          ...c,
          queue: [...(c.queue || [])],
          nextA: [...(c.nextA || [])],
          nextB: [...(c.nextB || [])],
        }));
        const court = courts[courtIndex];
        if (court) {
          courtMode = (court.mode || "doubles") as "singles" | "doubles";
        }
        const result = computeCompetitiveNextQueue(
          { ...ss, courts },
          courtIndex
        );
        if (!result) {
          errorMsg = "Not enough eligible players to auto-assign next teams.";
          return ss;
        }
        const { queue, nextA, nextB } = result;
        courts[courtIndex].queue = queue;
        courts[courtIndex].nextA = nextA;
        courts[courtIndex].nextB = nextB;
        assignSuccess = true;
        return { ...ss, courts };
      });

      // Get session config for analytics
      const session = s.sessions.find((ss) => ss.id === sessionId);
      const config = session?.autoAssignConfig;

      // Log analytics event
      void logAnalyticsEvent("auto_assign_next", {
        session_id: sessionId,
        court_index: courtIndex,
        court_mode: courtMode,
        success: assignSuccess,
        priority: config?.priority || "default",
        respect_gender: config?.respectGender || "soft",
        error_msg: errorMsg || undefined,
      });

      const out: Partial<StoreState> = {
        sessions: nextSessions,
        lastAutoAssignError: errorMsg
          ? { msg: errorMsg, courtIndex }
          : undefined,
      };
      if (errorMsg) {
        setTimeout(() => {
          try {
            set((st) => {
              if (
                st.lastAutoAssignError &&
                st.lastAutoAssignError.courtIndex === courtIndex &&
                st.lastAutoAssignError.msg === errorMsg
              ) {
                return { lastAutoAssignError: undefined } as any;
              }
              return {} as any;
            });
          } catch {}
        }, 3000);
      }
      return out as any;
    }),

  clearCourtAssignments: (sessionId, courtIndex) =>
    set((s) => {
      // Track if user had auto-assigned before clearing (signals dissatisfaction)
      const clickKey = `${sessionId}:${courtIndex}`;
      const now = Date.now();
      const analytics = s.autoAssignAnalytics;
      
      const autoAssignClickCount = analytics.clickCounts[clickKey] || 0;
      const firstClickTime = analytics.firstClickTimestamp[clickKey];
      const lastClickTime = analytics.lastClickTimestamp[clickKey];
      const manualAdjustmentCount = analytics.manualAdjustments[clickKey] || 0;

      // Log analytics for clear action with comprehensive data
      if (autoAssignClickCount > 0) {
        // Calculate time from auto-assign to clear (in seconds)
        const timeFromFirstAutoAssign = firstClickTime 
          ? Math.round((now - firstClickTime) / 1000) 
          : undefined;
        const timeFromLastAutoAssign = lastClickTime 
          ? Math.round((now - lastClickTime) / 1000) 
          : undefined;

        void logAnalyticsEvent("auto_assign_cleared", {
          session_id: sessionId,
          court_index: courtIndex,
          auto_assign_clicks_before_clear: autoAssignClickCount,
          seconds_from_first_auto_assign: timeFromFirstAutoAssign,
          seconds_from_last_auto_assign: timeFromLastAutoAssign,
          manual_adjustments_before_clear: manualAdjustmentCount,
          // Quick clear = likely immediate dissatisfaction
          was_quick_clear: timeFromLastAutoAssign !== undefined && timeFromLastAutoAssign < 10,
        });
      }

      // Reset all tracking for this court
      const nextAnalytics: AutoAssignAnalyticsState = {
        ...analytics,
        clickCounts: { ...analytics.clickCounts },
        firstClickTimestamp: { ...analytics.firstClickTimestamp },
        lastClickTimestamp: { ...analytics.lastClickTimestamp },
        manualAdjustments: { ...analytics.manualAdjustments },
        sessionTotalClicks: analytics.sessionTotalClicks,
        sessionGamesStarted: analytics.sessionGamesStarted,
      };
      delete nextAnalytics.clickCounts[clickKey];
      delete nextAnalytics.firstClickTimestamp[clickKey];
      delete nextAnalytics.lastClickTimestamp[clickKey];
      delete nextAnalytics.manualAdjustments[clickKey];

      // Legacy support
      const nextClickCounts = { ...s.autoAssignClickCounts };
      delete nextClickCounts[clickKey];

      return {
        sessions: s.sessions.map((ss) => {
          if (ss.id !== sessionId) return ss;
          const courts = ss.courts.map((c, i) => {
            if (i !== courtIndex) return c;
            if (c.inProgress) return c; // do not clear active court
            return {
              ...c,
              playerIds: [],
              pairA: [],
              pairB: [],
              // keep queue/nextA/nextB unchanged to preserve organizer planning if any
            };
          });
          return { ...ss, courts };
        }),
        autoAssignClickCounts: nextClickCounts,
        autoAssignAnalytics: nextAnalytics,
      };
    }),

  clearAllCourts: (sessionId) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        const courts = ss.courts.map((c) => {
          if (c.inProgress) return c; // skip active courts
          return {
            ...c,
            playerIds: [],
            pairA: [],
            pairB: [],
          };
        });
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

  updateSessionConfig: (sessionId, partial) =>
    set((s) => {
      // Get current config for comparison
      const session = s.sessions.find((ss) => ss.id === sessionId);
      const prevConfig = session?.autoAssignConfig || {};
      
      // Determine what changed
      const changedFields: string[] = [];
      for (const key of Object.keys(partial) as Array<keyof typeof partial>) {
        if (partial[key] !== prevConfig[key]) {
          changedFields.push(key);
        }
      }

      // Log config change analytics
      if (changedFields.length > 0) {
        void logAnalyticsEvent("auto_assign_config_changed", {
          session_id: sessionId,
          changed_fields: changedFields.join(","),
          new_priority: partial.priority || prevConfig.priority || "default",
          new_respect_gender: partial.respectGender || prevConfig.respectGender || "soft",
          new_blacklist_mode: partial.blacklistMode || prevConfig.blacklistMode || "hard",
          // Track session-level auto-assign usage at time of config change
          session_total_auto_assign_clicks: s.autoAssignAnalytics.sessionTotalClicks[sessionId] || 0,
          session_games_started: s.autoAssignAnalytics.sessionGamesStarted[sessionId] || 0,
        });
      }

      return {
        sessions: s.sessions.map((ss) => {
          if (ss.id !== sessionId) return ss;
          const prev = ss.autoAssignConfig || {};
          const next = { ...prev, ...partial } as Session["autoAssignConfig"];
          return { ...ss, autoAssignConfig: next };
        }),
      };
    }),

  updateSessionMeta: (sessionId, partial) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        const next: Partial<Session> = {};
        // Only handle explicitly whitelisted keys here to preserve existing behavior
        // Allow updating date (YYYY-MM-DD) when explicitly provided
        if (Object.prototype.hasOwnProperty.call(partial, "date")) {
          try {
            const raw = String((partial as any).date || "").trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
              next.date = raw as any;
            }
          } catch {}
        }
        // Allow updating time (HH:mm 24h) when explicitly provided
        if (Object.prototype.hasOwnProperty.call(partial, "time")) {
          try {
            const raw = String((partial as any).time || "").trim();
            if (/^\d{2}:\d{2}$/.test(raw)) {
              const [hh, mm] = raw.split(":");
              const h = Number(hh);
              const m = Number(mm);
              if (
                Number.isFinite(h) &&
                Number.isFinite(m) &&
                h >= 0 &&
                h <= 23 &&
                m >= 0 &&
                m <= 59
              ) {
                next.time = raw as any;
              }
            }
          } catch {}
        }
        if (Object.prototype.hasOwnProperty.call(partial, "playerLimit")) {
          const raw: any = (partial as any).playerLimit;
          next.playerLimit =
            typeof raw === "number" && isFinite(raw) && raw > 0
              ? Math.floor(raw)
              : undefined;
        }
        if (Object.prototype.hasOwnProperty.call(partial, "venue")) {
          const raw: any = (partial as any).venue;
          const name = (raw && raw.name ? String(raw.name) : "").trim();
          const id = raw && raw.id ? String(raw.id) : undefined;
          const loc = raw && raw.location ? (raw.location as any) : undefined;
          if (!name && !id && !loc) {
            next.venue = undefined; // clear when nothing provided
          } else if (!name) {
            // if id provided without name, keep previous name if any
            const prevName = (
              ss.venue && ss.venue.name ? ss.venue.name : ""
            ).trim();
            const out: any = {};
            if (id) out.id = id;
            if (prevName) out.name = prevName;
            if (
              loc &&
              typeof loc.lat === "number" &&
              typeof loc.lng === "number" &&
              isFinite(loc.lat) &&
              isFinite(loc.lng)
            ) {
              out.location = {
                lat: loc.lat,
                lng: loc.lng,
                address: (loc.address || "").trim() || undefined,
                placeId: (loc.placeId || "").trim() || undefined,
              };
            }
            next.venue = out as Session["venue"];
          } else {
            const out: any = { name };
            if (id) out.id = id;
            if (
              loc &&
              typeof loc.lat === "number" &&
              typeof loc.lng === "number" &&
              isFinite(loc.lat) &&
              isFinite(loc.lng)
            ) {
              out.location = {
                lat: loc.lat,
                lng: loc.lng,
                address: (loc.address || "").trim() || undefined,
                placeId: (loc.placeId || "").trim() || undefined,
              };
            }
            next.venue = out as Session["venue"];
          }
        }
        // Allow updating clubId when explicitly provided
        if (Object.prototype.hasOwnProperty.call(partial, "clubId")) {
          try {
            const raw = (partial as any).clubId;
            const val =
              typeof raw === "string" && raw.trim()
                ? String(raw).trim()
                : undefined;
            next.clubId = val as any;
          } catch {}
        }
        console.log("here", next);
        return { ...ss, ...next } as Session;
      }),
    })),
  // Minimal, explicit setter for paymentRequest to avoid altering updateSessionMeta semantics
  setPaymentRequest: (
    sessionId: string,
    info: {
      enabled?: boolean;
      courtCost?: number;
      shuttleCost?: number;
      recipientPlayerId?: string;
    }
  ) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        const enabled =
          typeof info?.enabled === "boolean" ? info.enabled : false;
        const court =
          typeof info?.courtCost === "number" && isFinite(info.courtCost)
            ? info.courtCost
            : undefined;
        const shuttle =
          typeof info?.shuttleCost === "number" && isFinite(info.shuttleCost)
            ? info.shuttleCost
            : undefined;
        const recipientPlayerId =
          typeof info?.recipientPlayerId === "string" &&
          (info.recipientPlayerId || "").trim()
            ? String(info.recipientPlayerId)
            : undefined;
        const paymentRequest = {
          enabled,
          courtCost: court,
          shuttleCost: shuttle,
          recipientPlayerId,
        };
        return { ...ss, paymentRequest } as Session;
      }),
    })),

  endSession: (sessionId, shuttlesUsed) =>
    set((s) => {
      const analytics = s.autoAssignAnalytics;
      const session = s.sessions.find((ss) => ss.id === sessionId);
      
      // Log session-level auto-assign analytics summary
      if (session && !session.ended) {
        const sessionTotalClicks = analytics.sessionTotalClicks[sessionId] || 0;
        const sessionGamesStarted = analytics.sessionGamesStarted[sessionId] || 0;
        const totalGamesInSession = session.games.length;
        
        void logAnalyticsEvent("session_ended_auto_assign_summary", {
          session_id: sessionId,
          total_players: session.players.length,
          total_courts: session.courts.length,
          total_games: totalGamesInSession,
          // Auto-assign usage metrics
          total_auto_assign_clicks: sessionTotalClicks,
          games_using_auto_assign: sessionGamesStarted,
          auto_assign_clicks_per_game: totalGamesInSession > 0 
            ? Math.round((sessionTotalClicks / totalGamesInSession) * 100) / 100 
            : 0,
          // Usage ratio: what percentage of games used auto-assign?
          auto_assign_usage_rate: totalGamesInSession > 0 
            ? Math.round((sessionGamesStarted / totalGamesInSession) * 100) 
            : 0,
          // Configuration used
          priority: session.autoAssignConfig?.priority || "default",
          respect_gender: session.autoAssignConfig?.respectGender || "soft",
          blacklist_mode: session.autoAssignConfig?.blacklistMode || "hard",
        });
      }

      // Clean up session-level tracking
      const nextAnalytics: AutoAssignAnalyticsState = {
        ...analytics,
        sessionTotalClicks: { ...analytics.sessionTotalClicks },
        sessionGamesStarted: { ...analytics.sessionGamesStarted },
        // Also clean up any court-level tracking for this session
        clickCounts: Object.fromEntries(
          Object.entries(analytics.clickCounts).filter(([k]) => !k.startsWith(`${sessionId}:`))
        ),
        firstClickTimestamp: Object.fromEntries(
          Object.entries(analytics.firstClickTimestamp).filter(([k]) => !k.startsWith(`${sessionId}:`))
        ),
        lastClickTimestamp: Object.fromEntries(
          Object.entries(analytics.lastClickTimestamp).filter(([k]) => !k.startsWith(`${sessionId}:`))
        ),
        manualAdjustments: Object.fromEntries(
          Object.entries(analytics.manualAdjustments).filter(([k]) => !k.startsWith(`${sessionId}:`))
        ),
      };
      delete nextAnalytics.sessionTotalClicks[sessionId];
      delete nextAnalytics.sessionGamesStarted[sessionId];

      return {
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
        autoAssignAnalytics: nextAnalytics,
      };
    }),

  addCoOrganizer: (sessionId, uid) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        if (!uid) return ss;
        const isLinked = ss.players.some((p) => p.accountUid === uid);
        if (!isLinked) return ss; // must be linked
        const setU = new Set([...(ss.coOrganizerUids || []), uid]);
        return { ...ss, coOrganizerUids: Array.from(setU) };
      }),
    })),

  removeCoOrganizer: (sessionId, uid) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => {
        if (ss.id !== sessionId) return ss;
        return {
          ...ss,
          coOrganizerUids: (ss.coOrganizerUids || []).filter((u) => u !== uid),
        };
      }),
    })),
}));

export { useStore };
