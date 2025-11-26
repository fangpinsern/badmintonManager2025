# Player Ratings (Elo) as a Core Feature — Product & Technical Plan

This document defines how we will make player ratings a first‑class, transparent, and future‑proof feature. It integrates our current implementation (session-end worker computation with singles/doubles ladders and optional doubles chemistry) with product surfaces, governance, and long‑term extensibility.

Related technical spec: see `docs/elo.md` for math, parameters, safeguards, and worker flow. This plan focuses on productization, user rubrics, UI, APIs, and rollout.

---

## 1) Goals and Principles

- **Clarity and transparency**: Users should understand what the rating means, how it’s computed, and why it changed.
- **Trust and integrity**: Prevent rating farming; reflect only verifiable games; use conservative defaults.
- **Future-proof**: Versioned parameters and storage; compatible with enhancements (e.g., confidence/RD, priors, club modifiers).
- **Low friction**: Ratings automatically update at session end. No organizer chores beyond “End Session”.
- **Fairness**: Singles and doubles are separate. Doubles considers team chemistry where both partners are linked.

---

## 2) Current State Summary (what exists today)

- **Computation** (in worker):
  - Ratings are updated during “End Session” via a background worker that processes all matches in the session.
  - Singles and Doubles are separate ladders; doubles uses player-sum Elo + optional pair chemistry.
  - Trust weighting and verification multipliers reduce impact of guest-heavy or poorly confirmed matches.
  - Safeguards: session/day caps, MOV cap, repetition dampening, guest stabilization pass (see `docs/elo.md`).
- **Storage**:
  - Per-user ratings stored under `elo.singles` and `elo.doubles` (fields: `R`, `K`, `matches`), written by the worker.
  - Pair chemistry stored in friend-edge documents for linked–linked pairs.
- **UI**:
  - Ratings are not yet displayed to users.
  - A non‑Elo global leaderboard exists for wins/games (`src/components/Leaderboard.tsx`).
- **Session-local learning**:
  - We simulate Elo-like updates locally during games for competitiveness (`applyEloAfterGame`), but persistent ratings only update at session end by the worker.

---

## 3) Terminology and Rubrics

- **Rating**: A number around 1500 baseline; higher means stronger. Separate values for Singles and Doubles.
- **Match eligibility**:
  - Only **linked** accounts have persistent updates. Guests influence expected probabilities but don’t get stored ratings.
  - Matches with 0 linked players are ignored for ratings.
  - Trust weight depends on link composition and result verification; lower trust => smaller rating movement.
- **K‑factor schedule**: Higher early, lower after sufficient matches (see `docs/elo.md`). Display this policy to users.
- **Chemistry (doubles)**: When two linked players partner, a persistent pair adjustment may update slightly based on residual (predicted vs actual). Chemistry never applies for guest pairs.
- **Minimum to rank**:
  - Require ≥ N matches in mode (e.g., `N=10`) to appear on leaderboards for that mode.
  - Show “Provisional” label until threshold is reached.
- **Inactivity**:
  - No decay on rating by default. Show last played date and match count as the “confidence proxy” initially. (Future: RD/confidence score.)

---

## 4) User-Facing Surfaces

### 4.1 Profile

- Show a **Ratings** card with:
  - Doubles rating (primary), Singles rating.
  - Change since last session, season to date, and lifetime matches in each mode.
  - Confidence indicator: match count + opponent diversity as a simple bar initially.
  - Informational “How this works” link to a friendly explainer summarizing: expected win probability, K‑factor, trust weighting, chemistry.
- Add a **Recent Changes** table:
  - Date, session, delta, reason summary (e.g., “beat higher‑rated pair; both teams confirmed; MOV small”). Backed by audit entries the worker stores.

### 4.2 Club page

- Leaderboards scoped to club members with minimum match threshold in the last X months.
- Optional “Sanctioned” sessions can have slightly higher event weight (already in spec); reflect this in UI.

### 4.3 Global leaderboards

- Replace or complement existing wins/games lists with **Elo leaderboards** (Singles, Doubles).
- Filters: timeframe (all‑time, last 90 days), minimum matches, region/club filters, and provisional toggle off by default.

### 4.4 Session UI

- Optional: show pre‑match **win probability** (for organizer-only or everyone, configurable) to explain “balanced” assignments in competitive mode.
- Optional: surface small post‑game **rating preview** deltas (ephemeral) with disclaimer that final updates occur at session end.

---

## 5) Transparency & Education

- Short, friendly explainer with the essentials:
  - Expected win probability follows Elo’s logistic curve.
  - K‑factor depends on experience; provisional players move more.
  - Trust/verification weights reduce impact of guest-heavy or unconfirmed matches.
  - Doubles team strength = sum of player ratings + partner chemistry (linked–linked only).
  - Safeguards: per-session/day caps, MOV cap, anti-repetition dampening.
- Link to an advanced “Technical Details” that references `docs/elo.md`.
- On deltas: expose a simple breakdown (E, S, K_eff, trust, event weight, MOV multiplier) in audit rows.

---

## 6) Governance and Fairness

- **Abuse resistance** (already in spec):
  - Ignore games with 0 linked players; weight down low‑trust compositions.
  - Cap daily and per-session movement.
  - Damp repetition of same line‑ups.
  - MOV cap and validation of plausible scores.
- **Appeals**:
  - Provide a way to flag a session for recalculation or to void specific games (organizer only). Rating changes then recompute.
- **Visibility rules**:
  - Provisional badge under match threshold.
  - Hide from leaderboards if account flagged for abuse.
- **Naming**:
  - Use “Rating” as the primary label in UI; tooltip mentions “Elo‑style” model to reduce jargon.

---

## 7) Data Model and Versioning

- Extend user document:
  - `elo.version`: string (e.g., `"1.0"`) representing parameter set.
  - `elo.singles|doubles`: `{ R: number, K: number, matches: number, updatedAt?: ISO }`
- Chemistry (pair edge):
  - `chemistry.delta`, `chemistry.updatedAt`, `chemistry.lastPlayedAt` (present today). Add `chemistry.version` to track learning rules.
- Audit log (per match for linked players):
  - Inputs: pre‑ratings, teams, E, S, K_eff, weights (trust, verify, event), MOV factor, delta, post‑ratings.
  - Key by `sessionId + matchId` for replays and rollbacks.
- Version changes:
  - Use a feature flag per organizer to switch to new versions gradually.
  - Store version with each persisted update so rendering can explain differences historically.

---

## 8) APIs and Fetch Paths

- Public read APIs (via `statsClient.ts` additions):
  - `getUserRatings(uid) -> { singles, doubles, version, updatedAt }`
  - `getUserRecentRatingChanges(uid, limit?) -> Audit[]`
  - `getLeaderboard({ mode, scope, minMatches, timeframe }) -> Rows[]`
- Worker writes (already exist):
  - Persist user `elo` subtree and chemistry edges post-session.
  - Persist audit entries (new) under a per‑user collection (e.g., `userStats/.../eloAudit` or a compact global log keyed by user).

---

## 9) Migration and Backfill

- Existing worker fields (`elo.singles`, `elo.doubles`) become the source of truth for display.
- Add `elo.version = "1.0"` on next write; if absent, treat as `"1.0"`.
- No destructive changes to stored values; future parameter updates bump version.
- Optional backfill:
  - Re-run “End Session” for recent months to populate audit trails and updatedAt, guarded by idempotent gates.

---

## 10) Rollout Plan

1. Backend/worker
   - Ensure version field is written; add audit emission (compact rows).
   - Verify trust weighting and caps are surfaced in audit output.
2. Read APIs
   - Add rating read, leaderboard by Elo, and recent changes.
3. UI incremental
   - Profile: Ratings card + provisional/confidence indicators.
   - Global leaderboard (doubles first), with min‑matches gating.
   - Club leaderboard beta (if club feature enabled).
4. Education
   - Add “How ratings work” page with friendly copy and link to technical details.
5. Metrics
   - Track views of Ratings card, leaderboard interaction, and rating deltas per active user.
6. Guardrails
   - Monitor for extreme deltas; alert when caps frequently trigger (possible abuse).
7. General availability
   - Turn on by default; keep feature flag to hotfix hide if needed.

---

## 11) Future Enhancements (compatible with v1 storage)

- Confidence/RD (Glicko‑style) surface in UI; keep Elo core.
- Learned chemistry priors (partner uplift, L/R, role complement) offline.
- Organizer/venue reputation auto‑tuning of event weight.
- Collusion/anomaly detection to modulate trust dynamically.
- Per‑club ladders (display only) using the same global rating; optionally scoped weights for sanctioned leagues.

---

## 12) FAQ (user‑facing)

- “Why didn’t my rating change?”
  - The match may have had low trust (few linked accounts, limited verification), or you were already heavily favored; small expected gain. Also, updates finalize at session end.
- “Why am I provisional?”
  - You need at least N matches in this mode to be ranked publicly. Keep playing!
- “Do guests affect my rating?”
  - Yes, as opponents or partners, but guests don’t receive stored ratings. Guest-heavy matches have reduced impact.
- “Is Singles different from Doubles?”
  - Yes. Different ladders. Doubles includes a small partner chemistry effect for linked–linked pairs.

---

## 13) Appendix: Key Policies (displayed in UI help)

- Expected win probability: Elo logistic with base τ=400.
- K‑factor: higher when new, then settles lower.
- Trust weighting: more linked and verified players → higher weight.
- MOV factor: capped; blowouts don’t endlessly increase deltas.
- Caps: per‑session and per‑day movement limits.
- Chemistry: small adjustments for linked pairs that partner frequently; never for guest pairs.

---

### References

- Technical spec: `docs/elo.md`
- Worker implementation: `worker/worker.js` (end-session pipeline and Elo writes)
- Session-local learning: `src/lib/autoAssign.ts` (`applyEloAfterGame`) — UX aid only; persistent ratings update at session end.

---

## 14) Implementation verification (worker mapping and gaps)

This maps requirements to concrete code in `worker/worker.js` and lists gaps to close for full parity with `docs/elo.md`.

### 14.1 Implemented behaviors (with code evidence)

- Singles vs Doubles ladder detection and team strength:

  ```
  const mode = rawA === 1 && rawB === 1 ? "singles" : "doubles";
  ...
  if (mode === "singles") {
    TA = sumRatings(sideA, "singles");
    TB = sumRatings(sideB, "singles");
  } else {
    TA = sumRatings(sideA, "doubles");
    TB = sumRatings(sideB, "doubles");
    if (sideA.length >= 2) { /* add pair chemistry delta */ }
    if (sideB.length >= 2) { /* add pair chemistry delta */ }
  }
  ```

- Trust weighting by link composition (4=1.0, 2+=0.75, 1=0.25, 0=skip):

  ```
  let wTrust;
  if (teamALinked && teamBLinked && linkedCount === 4) wTrust = 1.0;
  else if (teamALinked && teamBLinked) wTrust = 0.75;
  else if (linkedCount === 1) wTrust = 0.25;
  else wTrust = 0;
  if (wTrust === 0) continue;
  ```

- MOV multiplier and expected score (τ = 400):

  ```
  const fMov =
    Number.isFinite(pointsA) && Number.isFinite(pointsB)
      ? Math.min(1.2, Math.log(1 + Math.abs(pointsA - pointsB) / 8))
      : 1.0;
  const EA = 1 / (1 + Math.pow(10, (TB - TA) / 400));
  ```

- Doubles chemistry read and residual-based update with monthly decay and caps:

  ```
  // add chemistry to team strengths
  TA += (await getChem(ek)).delta || 0;
  TB += (await getChem(ek)).delta || 0;
  ...
  const months = monthsSince(cur.lastPlayedAt, endedAt) || 0;
  const decay = 1 - 0.01 * months;
  const next = Math.max(-70, Math.min(70,
    (isFinite(decay) ? decay : 1) * (cur.delta || 0) + 6 * residual));
  ```

- K-schedule and demotion; delta formula; apply to linked players only:

  ```
  const K_A = avgK(sideA, mode);
  const K_B = avgK(sideB, mode);
  const K_eff = (K_A + K_B) / 2;
  const delta = K_eff * wTrust * eventWeight * fMov * (SA - EA);
  ...
  pr.matches = (pr.matches || 0) + 1;
  if (pr.matches >= 20) pr.K = 20;
  ```

- Persistence of Elo and chemistry (idempotent gates + masked updates):

  ```
  makeUpdateMaskWrite(`${userCol}/${uid}`, {
    elo: { singles: pr.singles, doubles: pr.doubles, updatedAt: { __ts: true } }
  }, ["elo"], env)
  ...
  makeUpdateMaskWrite(`${friendEdgeCol}/${edgeKey}`, {
    chemistry: { delta: Number(chem.delta || 0), updatedAt: { __ts: true } }
  }, ["chemistry"], env)
  ```

### 14.2 Gaps to address (not yet implemented)

- Verification multiplier absent:
  - Spec requires scaling trust by confirmations (both=1.0, one=0.8, organizer-only=0.6).
  - Code uses only link composition; confirmations are not consulted.
- Event weight fixed:
  - Spec allows configurable `w_event` (e.g., sanctioned sessions).
  - Code sets `const eventWeight = 1.0;` for all cases.
- Caps missing:
  - Spec: per-session and per-day caps on cumulative rating movement.
  - Code: no per-day or per-session Elo caps.
- Repetition dampening absent:
  - Spec: reduce effective K for repeated same lineups within a session.
- Guest stabilization pass (epochs) absent:
  - Spec: stabilize guest pool before applying persisted updates to linked users.
- Chemistry prior heuristics absent:
  - Spec: LR/role priors for unseen pairs; guests use ephemeral priors.
  - Code does not add LR/role bonuses; uses base 1500 when a partner slot is missing.
- Audit trail for transparency absent:
  - Spec: persist per-match audit entries (inputs/weights/delta) for review and rollback.
