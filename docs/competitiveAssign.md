# Auto-Assign v2 — Competitive Matchmaking Design (Badminton)

## 1) Goals & Non-Goals

**Goals**

- Create the _most competitive_ games possible **within a session**, while:

  - Avoiding back-to-backs (rest)
  - Reducing repeat partner/opponent combos (variety)
  - Respecting blacklist pairs and optional gender rules

- Work with _very little_ session data (few games).
- Be deterministic, fast, and easy to tune.

**Non-Goals**

- Full season/club-wide ranking governance (out of scope; we only need session-level behavior, but can optionally read global ratings when present).
- Complex Bayesian systems (Glicko/TrueSkill). We’ll use tuned Elo for simplicity.

---

## 2) High-Level Approach

1. **Ratings & Synergy**

   - Each player has a rating `R[id]` (default 1200, or from global history if available).
   - Optional synergy prior for doubles: `SY[a][b]` (symmetric, default 0). Use if/when data is available.

2. **Objective Function (minimize): “Competitive first”**

   - For singles pair `(A vs B)` or doubles split `((A,B) vs (C,D))`, minimize:

     ```
     TOTAL = closeW * |0.5 - P(winTeam1)|
           + withinW * (team internal imbalance)
           + partnerRepeatW * (#past partnerings)
           + oppRepeatW     * (#past across-net)
           + restW          * (sum of consecutive-game streaks)
           + fairnessW      * (sum gamesPlayed)
           + genderPenalty  (0 / 500 or hard-constraint)
     ```

   - Expected win probability `P` uses Elo logistic function.

3. **Exact Search over a small candidate set** (fast, deterministic):

   - Singles: enumerate all pairs among top `K_s` candidates (≤ C(12,2)=66).
   - Doubles: enumerate all 4-sets among top `K_d` (≤ C(12,4)=495) and evaluate **all 3 unique splits**.
   - **Partial courts**: constrain enumeration to include seeded players and only consider splits compatible with seeds.

4. **Immediate Learning**

   - Update Elo (and optional synergy) after each game; use higher **K** early within a session to adapt quickly.

---

## 3) Data Model & Persistence

Extend the session state `ss` (backward compatible):

```ts
type Session = {
  // existing...
  players: Array<{
    id: string;
    name: string;
    gender?: "M" | "F";
    gamesPlayed?: number;
  }>;
  games: Array<{
    id: string;
    endedAt: string; // ISO
    players?: string[]; // optional flat version
    sideA: string[];
    sideB: string[];
    score?: { a: number; b: number };
    voided?: boolean;
  }>;
  courts: Array<{
    playerIds: string[];
    pairA?: string[];
    pairB?: string[];
    inProgress?: boolean;
    mode?: "singles" | "doubles";
  }>;
  autoAssignExclude?: string[];
  autoAssignBlacklist?: { pairs: Array<{ a: string; b: string }> };
  autoAssignConfig?: {
    priority?: "competitiveness" | "variety" | "rest";
    weights?: Partial<Weights>;
    maxKSingles?: number; // default 12
    maxKDoubles?: number; // default 12
    respectGender?: "hard" | "soft" | "off"; // default "soft"
    blacklistMode?: "hard" | "soft"; // default "hard"
  };

  // NEW (session-local; may be omitted if you source from a global store):
  ratings?: Record<string, number>; // playerId -> rating
  synergy?: Record<string, Record<string, number>>; // symmetric; optional
  ratingMeta?: Record<string, { gamesInSession?: number }>;
};

type Weights = {
  closeW: number; // default 5000
  withinW: number; // default 500
  partnerRepeatW: number; // default 50
  oppRepeatW: number; // default 100
  restW: number; // default 150
  fairnessW: number; // default 1
  genderSoftPenalty: number; // default 500 (used when respectGender="soft")
};
```

> **Where to store “global” ratings?** Optional: a club-level store keyed by `playerId`. If present, seed `ss.ratings` from it at session start; session updates can be written back at session end.

---

## 4) Scoring Details

### 4.1 Elo Basics

- Rating difference `Δ = S1 - S2` (team strength difference).
- Expected win:

  ```
  P1 = 1 / (1 + 10^(-Δ / D)), with D=400
  ```

- Update after a result (`result=1` for win, `0` for loss):

  ```
  R' = R + K * (result - expected)
  ```

- **K schedule** (example): `K=48` for a player’s first 5 games this session, then 32 until 10 games, then 16.

### 4.2 Team Strength

- Singles team strength: `S = R[player]`.
- Doubles team strength: `S = R[A] + R[B] + SY[A][B]`.

  - If no synergy data, `SY`=0.

### 4.3 Objective Terms

- **Closeness**: `|0.5 - P1|` (lower is more even).
- **Within-team imbalance (doubles)**: `|R[A]-R[B]| + |R[C]-R[D]|`.
- **Partner repeats**: `coAppear(A,B) + coAppear(C,D)` (session history; voided included).
- **Opponent repeats**: sum over across-net pairs (A vs C, A vs D, B vs C, B vs D).
- **Rest**: sum of recent back-to-back streak counts for the players.
- **Fairness**: sum of `gamesPlayed` for players in the matchup.
- **Gender**:

  - `respectGender="off"` → 0.
  - `"soft"` → penalty if selected set cannot result in even M/F per team (we approximate at selection) → `genderSoftPenalty`.
  - `"hard"` → infeasible combinations are discarded.

---

## 5) Selection Algorithm

### 5.1 Candidate Pool

- Start from current pool (not on any court, not excluded).
- Sort by `(gamesPlayed asc, name asc)` to preserve fairness baseline and deterministic tiebreaking.

### 5.2 Singles

- Consider top `K_s = min(pool.length, config.maxKSingles|12)`.
- Enumerate all pairs `(i<j)`.
- Score each pair; choose min score.
- If court already has 1 player assigned, enumerate pairs that include that player and 1 new candidate only.

### 5.3 Doubles (Empty Court)

- Consider top `K_d = min(pool.length, config.maxKDoubles|12)`.
- Enumerate all 4-sets; for each, evaluate the 3 unique splits:

  - `(A,B) vs (C,D)`, `(A,C) vs (B,D)`, `(A,D) vs (B,C)`.

- Enforce **blacklist**:

  - `"hard"`: discard splits where a team contains a blacklisted pair.
  - `"soft"`: add a very large penalty (e.g., `+1e9`) so they lose unless nothing else exists.

- Apply gender rule per config.
- Pick split with the lowest score.

### 5.4 Doubles (Partial Court)

- Suppose `pairA` or `pairB` already has 1–2 seeded players:

  - Restrict enumeration to 4-sets that **include all seeded players**.
  - Only evaluate splits that keep seeded players on their respective teams.
  - If exactly 3 players are fixed (rare), enumerate the missing one.
  - If fixed team is already a blacklisted pair:

    - `"hard"` → no valid assignment; fall back strategy (see §7).
    - `"soft"` → allow with heavy penalty.

### 5.5 Determinism

- Break ties with a stable key:

  - Primary: _lowest_ `TOTAL`.
  - Secondary: lexicographic of `(team1 sorted ids, team2 sorted ids)`.

---

## 6) Updates After Each Game

### 6.1 Rating Update

- Compute team strengths and expectations at **match start** ratings (snapshot them to avoid reordering effects).
- Update players’ Elo:

  - Winning team’s players: `R += K * (1 - Pwin)`
  - Losing team’s players: `R += K * (0 - Pwin)`
  - For doubles, use the _team_ expected prob from `S_team = R[A]+R[B]+SY[A][B]`.

### 6.2 Optional Synergy Learning

- If `(A,B)` partnered and won/lost, adjust `SY[A][B]=SY[B][A]` with a small learning rate toward `(observed - expected)` signal.
- Cap `SY` within bounds (e.g., `[-60, +60]`) to avoid runaway effects.

### 6.3 Session-Local Booster

- Maintain `ratingMeta[id].gamesInSession++` and use K-schedule from §4.1.
- Optionally add a **temporary session delta** that decays across sessions, to make the assigner feel responsive today without long-term drift.

---

## 7) Fallbacks & Failure Modes

- **No feasible split due to blacklist/gender hard constraints**:

  - Try relaxing variety terms (partner/opp repeats) to zero and re-search.
  - If still impossible and `blacklistMode="soft"` or `respectGender="soft"`, allow with large penalty and proceed.
  - If still impossible and both are hard: **abort assignment** for this court and return the unmodified session.

- **Insufficient players** (`pool.length < need`):

  - Fill as many as possible; leave the rest for future assignment.

- **Existing seeded pairs conflict with blacklist (hard)**:

  - Clear the conflicting seed for this court (only the minimal change) and re-run; if seeds are user-locked, abort.

- **Streak info missing**:

  - Treat as 0.

- **Missing `endedAt` times** (for streak order):

  - Use game `id` insertion order as fallback.

- **Unknown genders / mixed rules active**:

  - For `"hard"`: if a player’s gender is unknown, treat as invalid → court cannot be balanced; abort or downgrade to `"soft"` via config.
  - For `"soft"`: ignore unknowns in penalty logic.

- **Players removed mid-session**:

  - Keep historical ratings as is; ignore them in candidate pool.

- **Partially filled courts with 3 players**:

  - Enumerate only candidates that complete to 4 and only splits retaining seeded positions.

- **Duplicate IDs / malformed data**:

  - De-duplicate candidate IDs and validate inputs; if anomalies remain, abort assignment for that court.

- **All splits tie on score**:

  - Use deterministic lexicographic tiebreaker.

---

## 8) Complexity

- Singles: `O(C(K_s,2))` score calls (≤ 66 @ K_s=12).
- Doubles: `O(3 * C(K_d,4))` (≤ 1485 score calls @ K_d=12).
- With light constant factors, this is well within a few milliseconds in JS.

---

## 9) Configuration & Tuning

Default weights (session-friendly):

```ts
(closeW = 5000),
  (withinW = 500),
  (partnerRepeatW = 50),
  (oppRepeatW = 100),
  (restW = 150),
  (fairnessW = 1),
  (genderSoftPenalty = 500);
(maxKSingles = 12), (maxKDoubles = 12);
(respectGender = "soft"), (blacklistMode = "hard");
```

Expose `autoAssignConfig.weights` for live tuning. Add presets via `priority`:

- `"competitiveness"` → as above
- `"variety"` → halve `closeW`, double repeat weights
- `"rest"` → double `restW`

---

## 10) Implementation Notes (TypeScript)

### 10.1 Helpers

```ts
const D = 400;
const expWin = (s1: number, s2: number) =>
  1 / (1 + Math.pow(10, -(s1 - s2) / D));
const ratingOf = (id: string) => ss.ratings?.[id] ?? 1200;
const synergyOf = (a: string, b: string) =>
  ss.synergy?.[a]?.[b] ?? ss.synergy?.[b]?.[a] ?? 0;

const teamStrengthSingles = (p: string) => ratingOf(p);
const teamStrengthDoubles = (a: string, b: string) =>
  ratingOf(a) + ratingOf(b) + synergyOf(a, b);
```

### 10.2 Scoring

```ts
function scoreSingles(a: string, b: string, w: Weights): number {
  const s1 = teamStrengthSingles(a),
    s2 = teamStrengthSingles(b);
  const P = expWin(s1, s2);
  const closeness = Math.abs(0.5 - P);
  const partnerRepeat = getCo(a, b);
  const oppRepeat = partnerRepeat; // same in singles
  const rest = (streak.get(a) || 0) + (streak.get(b) || 0);
  const fairness = (gamesPlayed[a] || 0) + (gamesPlayed[b] || 0);
  return (
    w.closeW * closeness +
    w.partnerRepeatW * partnerRepeat +
    w.oppRepeatW * oppRepeat +
    w.restW * rest +
    w.fairnessW * fairness
  );
}

function scoreDoublesSplit(
  A: string,
  B: string,
  C: string,
  Dp: string,
  w: Weights,
  cfg: Cfg
): number {
  // Hard constraints
  if (cfg.blacklistMode === "hard" && (isBL(A, B) || isBL(C, Dp)))
    return Number.POSITIVE_INFINITY;
  if (cfg.respectGender === "hard" && !isGenderSplittable([A, B, C, Dp]))
    return Number.POSITIVE_INFINITY;

  const s1 = teamStrengthDoubles(A, B),
    s2 = teamStrengthDoubles(C, Dp);
  const P = expWin(s1, s2);
  const closeness = Math.abs(0.5 - P);
  const within =
    Math.abs(ratingOf(A) - ratingOf(B)) + Math.abs(ratingOf(C) - ratingOf(Dp));
  const partnerRepeat = getCo(A, B) + getCo(C, Dp);
  const oppRepeat = getCo(A, C) + getCo(A, Dp) + getCo(B, C) + getCo(B, Dp);
  const rest =
    (streak.get(A) || 0) +
    (streak.get(B) || 0) +
    (streak.get(C) || 0) +
    (streak.get(Dp) || 0);
  const fairness =
    (gamesPlayed[A] || 0) +
    (gamesPlayed[B] || 0) +
    (gamesPlayed[C] || 0) +
    (gamesPlayed[Dp] || 0);

  const genderPenalty =
    cfg.respectGender === "soft" && !isGenderSplittable([A, B, C, Dp])
      ? w.genderSoftPenalty ?? 500
      : 0;

  const blSoftPenalty =
    cfg.blacklistMode === "soft" && (isBL(A, B) || isBL(C, Dp)) ? 1e9 : 0;

  return (
    genderPenalty +
    blSoftPenalty +
    w.closeW * closeness +
    w.withinW * within +
    w.partnerRepeatW * partnerRepeat +
    w.oppRepeatW * oppRepeat +
    w.restW * rest +
    w.fairnessW * fairness
  );
}
```

### 10.3 Enumeration

- **Singles**: enumerate pairs among top `K_s` (or constrained to include a seeded player).
- **Doubles**:

  - If empty court: enumerate 4-sets and 3 splits each.
  - If seeded: fix seeded players; only enumerate completions and compatible splits.

> Keep your existing blacklist+gender utilities. Replace the previous greedy selection with the above evaluation.

### 10.4 Rating Update Hook

When a game ends (on your existing “end game” path):

```ts
function onGameEnd(game: Game) {
  const { sideA, sideB, score } = game;
  const isDoubles = sideA.length===2 && sideB.length===2;

  const strengthA = isDoubles ? teamStrengthDoubles(sideA[0], sideA[1]) : teamStrengthSingles(sideA[0]);
  const strengthB = isDoubles ? teamStrengthDoubles(sideB[0], sideB[1]) : teamStrengthSingles(sideB[0]);

  const PA = expWin(strengthA, strengthB);
  const resultA = score && score.a > score.b ? 1 : 0;
  const resultB = 1 - resultA;

  const KA = kFor(sideA); const KB = kFor(sideB); // compute from players' session games
  updateRatings(sideA, resultA, PA, KA);
```
