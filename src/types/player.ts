type Player = {
  id: string;
  name: string;
  gender?: "M" | "F";
  gamesPlayed?: number;
  accountUid?: string;
  // when linked, capture prior display name to allow revert on unlink
  nameBeforeLink?: string;
  // if true, participant (self) cannot unlink (organizer-added by username)
  linkLocked?: boolean;
};

// Platform-level player profile (Phase A - added; not yet used by UI)
type PlatformPlayer = {
  id: string;
  name: string;
  gender?: "M" | "F";
  createdAt: string;
  accountUid?: string;
};

type Court = {
  id: string;
  index: number;
  playerIds: string[];
  pairA: string[];
  pairB: string[];
  inProgress?: boolean;
  startedAt?: string;
  mode?: "singles" | "doubles";
  queue?: string[];
  nextA?: string[];
  nextB?: string[];
};

type Game = {
  id: string;
  courtIndex: number;
  endedAt: string; // ISO timestamp
  startedAt?: string; // ISO timestamp
  durationMs?: number; // derived when known
  sideA: string[]; // player IDs on side A
  sideB: string[]; // player IDs on side B
  sideAPlayers?: { id: string; name: string }[]; // legacy snapshot of names at game end
  sideBPlayers?: { id: string; name: string }[]; // legacy snapshot of names at game end
  scoreA: number; // side A points
  scoreB: number; // side B points
  winner: "A" | "B" | "draw";
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
  longestDuration?: {
    playerIds: string[];
    names: string[];
    durationMs: number;
  };
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
  attendees?: string[];
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
  storage?: "remote" | "local";
};

export type {
  Player,
  PlatformPlayer,
  Court,
  Game,
  PlayerAggregate,
  SessionStats,
  Session,
};
