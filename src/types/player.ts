type Player = {
  id: string;
  name: string;
  gender?: "M" | "F";
  gamesPlayed?: number;
  accountUid?: string;
  // cached username for the linked account to avoid re-resolving on every view
  accountUsername?: string;
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
  // If set, this court is locked for Umpire mode by this uid
  umpireUid?: string;
  umpireSince?: string;
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
  // accountability: which user ended (submitted score for) this game
  endedByUid?: string;
  endedByRole?: "organizer" | "co-organizer";
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
  // co-organizer support: store linked account UIDs with elevated permissions
  coOrganizerUids?: string[];
  autoAssignBlacklist?: { pairs: { a: string; b: string }[] };
  autoAssignConfig?: {
    // legacy flag retained for backward compatibility (maps to respectGender="soft")
    balanceGender?: boolean;
    // v2 competitive config (all optional; sensible defaults applied)
    priority?: "competitiveness" | "variety" | "rest";
    weights?: Partial<{
      closeW: number;
      withinW: number;
      partnerRepeatW: number;
      oppRepeatW: number;
      restW: number;
      fairnessW: number;
      genderSoftPenalty: number;
      randomW: number;
    }>;
    maxKSingles?: number;
    maxKDoubles?: number;
    respectGender?: "hard" | "soft" | "off";
    blacklistMode?: "hard" | "soft";
  };
  autoAssignExclude?: string[]; // playerIds to exclude from auto-assign
  // Competitive ratings (session-local). Optional; defaults used when missing
  ratings?: Record<string, number>; // Elo-like rating per player (default 1200)
  synergy?: Record<string, Record<string, number>>; // optional team synergy adjustment (symmetric)
  ratingMeta?: Record<string, { gamesInSession?: number }>; // per-player session counters for K-schedule
  storage?: "remote" | "local";
  // If present, this session is sanctioned by a club with this id
  clubId?: string;
  // If club-sanctioned, the initial feed message ID associated with this session
  clubFeedMessageId?: string;
  // Optional maximum number of players allowed in the session
  playerLimit?: number;
  // Optional venue information. Keep minimal now; expandable for maps later
  venue?: {
    id?: string; // optional stable id for common club venues
    name?: string;
    location?: {
      lat: number;
      lng: number;
      address?: string;
      placeId?: string;
    };
  };
  // Optional payment request to be included in end-session message
  // Costs will be split equally among all players; used only if enabled
  paymentRequest?: {
    enabled?: boolean;
    courtCost?: number;
    shuttleCost?: number;
  };
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
