## Auto-Assign v2 — Implementation & Tuning Guide

This document explains the competitive auto-assign system implemented in this app. It covers the data model, algorithm, configuration, code structure, and how to extend the system with new parameters.

### Goals

- Create competitive matchups while balancing rest and variety
- Respect blacklist pairs and gender rules
- Deterministic selection with optional controlled randomness
- Session-local learning via Elo updates

## Code Structure

- `src/lib/autoAssign.ts`

  - Core helpers implementing the competitive algorithm:
    - Pool building (co-appearance, streaks)
    - Scoring functions (singles, doubles)
    - Enumeration and deterministic tiebreak
    - Queue computation
    - Elo updates

- `src/lib/store.ts`

  - Integrations used by UI actions:
    - `autoAssignCourt` → uses `computeCompetitiveAssignmentForCourt`
    - `autoAssignNext` → uses `computeCompetitiveNextQueue`
    - `endGame` → applies Elo via `applyEloAfterGame`
    - `updateSessionConfig` → persists organizer tuning

- `src/components/session/autoAssignSettingsButton.tsx`
  - Organizer UI to edit auto-assign settings (Basic + Advanced)

## Data Model & Configuration

- `Session.autoAssignConfig` (all optional)

  - `priority`: "competitiveness" | "variety" | "rest"
  - `weights`: partial weights override (see below)
  - `maxKSingles`: candidate cap for singles (default 12)
  - `maxKDoubles`: candidate cap for doubles (default 12)
  - `respectGender`: "hard" | "soft" | "off"
  - `blacklistMode`: "hard" | "soft"
  - `balanceGender`: legacy toggle; maps to `respectGender="soft"` when true

- `Session.ratings` (optional): `Record<playerId, number>` — Elo ratings (default 1200)
- `Session.synergy` (optional): team synergy adjustments for doubles
- `Session.ratingMeta`: session-local counters to compute K-schedule

- Weights (defaults):
  - `closeW = 5000`: Evenness of matchup (lower is better)
  - `withinW = 500`: Within-team imbalance for doubles
  - `partnerRepeatW = 50`: Partner repetition cost
  - `oppRepeatW = 100`: Opponent repetition cost
  - `restW = 150`: Back-to-back streak penalty
  - `fairnessW = 1`: Sum of games played by involved players
  - `genderSoftPenalty = 500`: Applied when `respectGender="soft"` and split can’t be balanced
  - `randomW = 0`: Adds small randomness to break repetitive rematches

Priority presets apply gentle transforms to defaults:

- "competitiveness" (default): base weights
- "variety": halves `closeW`, doubles repeat weights
- "rest": doubles `restW`

## Core Helpers

All helpers live in `src/lib/autoAssign.ts`.

### Rating & Probability

- `expWin(s1, s2)` — Elo logistic expected win probability with D=400
- `ratingOf(ss, id)` — returns per-player rating (default 1200)
- `synergyOf(ss, a, b)` — symmetric team synergy adjustment (default 0)
- `teamStrengthSingles(ss, p)` — `ratingOf(p)`
- `teamStrengthDoubles(ss, a, b)` — `ratingOf(a)+ratingOf(b)+synergyOf(a,b)`

### Session Features for Scoring

- `buildCoCounts(ss)` — co-appearance counts across session games (voided included)
- `buildStreaks(ss)` — consecutive back-to-back streak counts per player
- `gendersMap(ss)` — map of player genders
- `isGenderSplittable(ids, genders)` — true iff M and F counts among 4 are even (0,2,4); unknowns fail in "hard" mode
- `buildBlacklistCheck(ss)` — returns `isBL(x,y)` for team blacklist checks
- `lexKey(team1, team2)` — deterministic tiebreak key from sorted ids

### Scoring Functions

Both functions return a scalar score (lower is better). A large penalty or `+∞` represents hard infeasibility.

- `scoreSingles(ss, a, b, w, getCo, streak, gamesPlayed)`

  - Terms: closeness, partnerRepeat (same as opp in singles), rest, fairness, random

- `scoreDoublesSplit(ss, A, B, C, Dp, w, cfg, getCo, streak, gamesPlayed, isBL, genders)`
  - Hard constraints (return `+∞`):
    - `cfg.blacklistMode === "hard"` and team has a blacklisted pair
    - `cfg.respectGender === "hard"` and 4-set cannot be split evenly
  - Terms: closeness, within-team imbalance, partnerRepeat, oppRepeat, rest, fairness, gender soft penalty, blacklist soft penalty, random

Randomness: `randomW * Math.random()` is added to both scores to reduce repetitive rematches while preserving determinism for equal scores via tiebreak key.

### Enumeration & Selection

- Singles (empty or partially seeded):

  - Consider top `K = min(pool.length, maxKSingles)`
  - When exactly one player is seeded on the court, pair that player with one candidate
  - Else, enumerate pairs among top K
  - Pick min score; break ties via `lexKey`

- Doubles (empty or seeded):
  - Consider top `K = min(pool.length, maxKDoubles)`
  - Enumerate 4-sets; for each, evaluate 3 unique splits: `(A,B)-(C,D)`, `(A,C)-(B,D)`, `(A,D)-(B,C)`
  - If seeded sides exist, only retain splits that keep seeded players on their respective sides
  - Apply blacklist and gender constraints/penalties per config
  - Pick min score; break ties via `lexKey`

### Pools & Priorities

- `computeCompetitiveAssignmentForCourt(ss, courtIndex)`

  - Pool: players not assigned elsewhere and not excluded
  - Sorted by fairness baseline (games played asc, name asc)
  - Respects existing `pairA/pairB` as seeds (partial court)
  - Returns `{ playerIdsToAdd, pairA, pairB }`

- `computeCompetitiveNextQueue(ss, courtIndex)`
  - Base: players not excluded and not queued in other courts
  - Pool: prefer free players, but also include players currently on the same court (to allow back-to-backs if needed)
  - Sort priority: not currently on this court first, then fairness baseline
  - Returns `{ queue, nextA, nextB }`

## Store Integrations

- `autoAssignCourt(sessionId, courtIndex)`

  - Delegates to `computeCompetitiveAssignmentForCourt`
  - Fills `playerIds` and assigns `pairA/pairB`

- `autoAssignNext(sessionId, courtIndex)`

  - Delegates to `computeCompetitiveNextQueue`
  - Fills `queue`, `nextA`, `nextB`

- `endGame(sessionId, courtIndex, scoreA, scoreB)`
  - Clears the court
  - Optionally pulls the next queue into `playerIds`
  - Increments `gamesPlayed`
  - Applies Elo via `applyEloAfterGame`

## Elo Update

- `applyEloAfterGame(ss, sideA, sideB, winner)`
  - Computes expected probability from current ratings
  - K-schedule (per player, based on session games):
    - First 5 games: K=48
    - Games 6–10: K=32
    - Thereafter: K=16
  - Updates `Session.ratings` and `Session.ratingMeta`
  - Note: We use end-of-game ratings for expected value. If you require match-start snapshot, capture ratings at `startGame` and pass them to the updater.

## Organizer Controls (Advanced)

Accessible via the Auto-assign settings modal under the "Advanced" section:

- Presets: `priority` (competitiveness/variety/rest)
- Gender rule: `respectGender` (hard/soft/off)
- Blacklist rule: `blacklistMode` (hard/soft)
- Candidate caps: `maxKSingles`, `maxKDoubles`
- Weights: `closeW`, `withinW`, `partnerRepeatW`, `oppRepeatW`, `restW`, `fairnessW`, `genderSoftPenalty`, `randomW`

All changes apply immediately to the session’s `autoAssignConfig`.

## Adding a New Parameter or Weight

This section walks through adding a new scoring term (e.g., `courtBalanceW`).

1. Add type and default

   - In `src/lib/autoAssign.ts`:
     - Extend `type Weights` with the new field
     - Add a sensible default to `DEFAULT_WEIGHTS`

2. Thread through scoring functions

   - Update `scoreSingles`/`scoreDoublesSplit` to compute the term and multiply by the new weight
   - Keep calculations side-effect-free and fast

3. Update `Session.autoAssignConfig` type

   - In `src/types/player.ts` extend the `weights` object type with the new field

4. Expose control in the UI (optional)

   - In `src/components/session/autoAssignSettingsButton.tsx`:
     - Add to the `defaults` object
     - Add a labeled input under Advanced, wired to `updateSessionConfig`

5. Consider presets

   - Adjust how `priority` presets mutate weights if the new term should be emphasized/de-emphasized

6. Test
   - Validate that the new term influences selection in intended ways
   - Check that queue and court auto-assign both reflect the change

## Determinism & Randomness

- Determinism is enforced by lexicographic tie-breaking when scores are equal
- `randomW` injects small noise to discourage repeated rematches; default is 0 (fully deterministic)
- For reproducible behavior with `randomW>0`, you can seed `Math.random` via a PRNG adapter if needed

## Performance

- Singles: O(C(K,2)) score evaluations (≤ 66 at K=12)
- Doubles: O(3 \* C(K,4)) (≤ 1485 at K=12)
- The constants are light; selection runs in a few milliseconds in typical sessions

## Fallbacks & Failure Modes

- No feasible split under hard constraints → selection is skipped for that court
- Insufficient players → return `null` (UI shows message)
- Unknown genders + `respectGender="hard"` → treat as invalid (skip or relax to soft rule)
- Blacklist conflicts under hard mode → set is discarded

## Quick Reference: Primary APIs

- `computeCompetitiveAssignmentForCourt(ss, courtIndex)`

  - Returns: `{ playerIdsToAdd, pairA, pairB } | null`

- `computeCompetitiveNextQueue(ss, courtIndex)`

  - Returns: `{ queue, nextA, nextB } | null`

- `applyEloAfterGame(ss, sideA, sideB, winner)`
  - Returns: updated `Session` with `ratings` and `ratingMeta`
