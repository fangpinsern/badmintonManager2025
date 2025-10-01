# Badminton Elo (Doubles-First) — Technical Spec (JS Worker)

**Goal:** Accurate, abuse-resistant player ratings in sessions where not all players have accounts. Ratings are computed **at session end** and persisted only for **linked players** (accounts). Singles and doubles are maintained as **separate ladders**. Doubles uses **Player-Sum Elo + Chemistry**.

---

## 1) Core Concepts & Design Decisions

### 1.1 Include partial data, weight by trust

- **Decision:** Use matches even if some players are unlinked (guests).
  **Why:** Dropping them lets users hide losses with guests.
  **How:** Apply **trust weights** so guest-heavy matches move ratings less.

### 1.2 Store ratings only for accounts

- **Decision:** Persist ratings and chemistry only for **linked players**.
  **Why:** Auditable identity, reduces sockpuppet abuse.
  **Guests:** Created as **ephemeral players** within a session; not persisted.

### 1.3 Separate ladders

- **Decision:** Maintain **Singles** and **Doubles** ratings separately.
  **Why:** Skills/variance differ; improves predictive accuracy.
  **Warm start:** If only one mode exists, initialize the other using a **0.3** bleed-through (see §4.1).

### 1.4 Batch processing at “End Session”

- **Decision:** Compute a **batch pass** when organizer ends a session.
  **Why:** Reduces order effects; lets you stabilize ephemeral guests before applying persisted updates.

### 1.5 Chemistry

- **Decision:** Doubles team strength = sum of player doubles ratings + **pair chemistry** (\delta*{ij}).
  **Persist** (\delta*{ij}) **only** for pairs where **both players are linked**.
  **For any pair with a guest:** use a **cold-start prior** only; do not persist.

---

## 2) Mathematical Model

### 2.1 Team strength

For pair ((i,j)):
[
T_{ij} = D_i + D_j + \delta_{ij}
]

- (D_i): player (i)’s **doubles** rating.
- (\delta\_{ij}): chemistry (0 if unknown; see §4.2).

### 2.2 Expected score and update

For Team A vs Team B:
[
E_A = \frac{1}{1+10^{(T_B - T_A)/\tau}},\qquad \tau=400
]

After a match (no draws), with winner score (S*A\in{0,1}):
[
\Delta = K \cdot w*{\text{trust}} \cdot w\_{\text{event}} \cdot f(\text{MOV}) \cdot (S_A - E_A)
]
Apply the **same (\Delta)** to both teammates on each side (doubles only).

**Parameters (defaults):**

- (K): 32 (provisional, <20 matches in mode), else 20.
- (w\_{\text{event}}): 0.8 (informal) … 1.5 (sanctioned). Default 1.0.
- **MOV multiplier** (f):
  [
  f = \min\left(1.2,\ \ln!\bigl(1+\tfrac{|points_A - points_B|}{\alpha}\bigr)\right),\quad \alpha=8
  ]

### 2.3 Chemistry update (linked–linked pairs only)

Let residual (\varepsilon = (S*A - E_A)) for the pair that actually partnered:
[
\delta*{ij} \leftarrow \operatorname{clip}\Big((1-\lambda),\delta\_{ij} + \kappa \cdot \varepsilon,\ -70,\ 70\Big)
]

- (\kappa = 6) (learning rate), (\lambda = 0.01/\text{month}) (decay).

### 2.4 Trust weight table (w\_{\text{trust}})

| Linked players in match | Use?   | (w\_{\text{trust}}) | Chemistry update               |
| ----------------------- | ------ | ------------------: | ------------------------------ |
| All 4 linked            | Yes    |            **1.00** | Yes (both pairs if partnered)  |
| Each team has ≥1 linked | Yes    |            **0.75** | Only for linked–linked pair(s) |
| Exactly 1 linked total  | Yes    |            **0.25** | No                             |
| 0 linked                | Ignore |                   0 | No                             |

**Verification multiplier** (multiply into (w\_{\text{trust}})):

- Both teams confirmed: × **1.00**
- One team confirmed: × **0.80**
- Organizer only: × **0.60**

---

## 3) Data Model (storage-agnostic; JSON examples show Firestore-like)

### 3.1 Players

```json
{
  "playerId": "p_123", // session-scoped id; may map to accountId if linked
  "accountId": "acc_789", // null if guest
  "linked": true, // derived: accountId != null
  "hand": "R", // optional
  "role": "attacker|controller|...?", // optional tag
  "ratings": {
    "singles": { "R": 1500, "K": 32, "matches": 0, "lastPlayed": null },
    "doubles": { "R": 1500, "K": 32, "matches": 0, "lastPlayed": null }
  }
}
```

### 3.2 Pair chemistry (persisted for linked–linked only)

```json
{
  "pairKey": "acc_1|acc_2", // sorted by accountId
  "delta": 0.0,
  "updatedAt": "2025-09-30T12:34:56Z",
  "lastPlayed": "2025-09-30T12:34:56Z"
}
```

### 3.3 Session

```json
{
  "sessionId": "s_456",
  "organizerId": "acc_org",
  "eventWeight": 1.0,
  "matches": [
    {
      "matchId": "m_001",
      "teamA": ["p_1", "p_2"],
      "teamB": ["p_3", "p_4"],
      "winner": "A", // "A" | "B"
      "scores": [
        [21, 18],
        [17, 21],
        [21, 18]
      ],
      "totalPointsA": 59,
      "totalPointsB": 57,
      "confirmations": { "teamA": true, "teamB": true, "organizer": true },
      "timestamp": "2025-09-30T10:00:00Z"
    }
  ],
  "playerAccountLinks": { "p_1": "acc_A", "p_4": "acc_D" } // guests omit/absent
}
```

---

## 4) Cold Start Logic

### 4.1 Player initialization

- Default **Singles** (S_i = 1500), **Doubles** (D_i = 1500), (K=32).
- Warm-start across ladders:

  - First-time **doubles** with singles history:
    (D_i^{init} = 1500 + 0.3 \times (S_i - 1500))
  - First-time **singles** with doubles history:
    (S_i^{init} = 1500 + 0.3 \times (D_i - 1500))

### 4.2 Chemistry prior (used whenever the pair has never partnered)

[
\delta^{prior}*{ij} = b_i + b_j + \text{bonus}*{LR} + \text{bonus}_{role}
]

- Ship with **simple heuristic** (all zeros except):

  - **Left–Right** mix: (+12)
  - **Role complementarity** (“attacker+controller”): (+8)

- For guest pairs, (\delta^{prior}) is **in-session only** (not persisted).
- Future (offline) improvement: learn (b_i) (partner uplift) and feature weights.

---

## 5) Worker Flow (on “End Session”)

### 5.1 Input event

```json
{ "type": "END_SESSION", "sessionId": "s_456" }
```

### 5.2 Steps

1. **Load session** (matches, links, eventWeight).
2. **Build player set**:

   - For each session player:

     - If linked: load persisted ratings (S,D,K) and chemistry rows where applicable.
     - If guest: create **ephemeral** player with (D=1500), (K=40) (session-internal only).

3. **Precompute chemistry for all match pairs**:

   - For each pair in a match:

     - If linked–linked and pair exists: use persisted (\delta).
     - Else: compute (\delta^{prior}) (heuristic in §4.2); mark as **ephemeral**.

4. **Session stabilization pass** (guests only):

   - Iterate **M=3** epochs over session matches:

     - For each match, compute (E) using current (D) and chemistry (persisted or prior).
     - Update **only guest players’** (D) with (K=40), **no trust weights**, **no persistence**.

   - **Linked players remain fixed** in this pass.
     **Purpose:** Produce sane expectations for guest-heavy fixtures.

5. **Rating updates (persisted)**:

   - For each match:

     - Compute (w\_{\text{trust}}) using link composition + verification.
     - Compute MOV (f), expected (E), event weight (w\_{\text{event}}).
     - (\Delta = K \cdot w*{\text{trust}} \cdot w*{\text{event}} \cdot f \cdot (S - E))
     - Apply (\Delta) to **linked players only** (and update their per-mode `matches`, `lastPlayed`).

   - **Chemistry update**: for each **linked–linked** pair that partnered, update (\delta) with §2.3.

6. **Caps & safeguards**:

   - Per-session cap (|\Delta D_i|\le 40).
   - Per-day cap (|\Delta D_i|\le 60) (consider UTC day).
   - Repetition dampening: if same two teams met (n) times in this session, scale effective (K) by (1/\sqrt{1+n}).
   - Guest share penalty: if a player’s opponents this session are >60% guests, multiply all their (\Delta) by 0.7.

7. **Persist**:

   - Updated (D) (and (S) if you processed singles matches), `K` demotion if `matches>=20`.
   - Updated chemistry (\delta) rows (linked–linked only) + timestamps.
   - **Audit log** entry per match: inputs, weights, (\Delta), post-ratings.

8. **Emit results** for profile pages and leaderboards.

---

## 6) Abuse Resistance (shipped defaults)

- **Trust weighting** (link composition + verification) — §2.4.
- **Connectivity filter:** ignore matches where no linked player appears (pure guest bubble).
- **Session/day caps** — §5.2.6.
- **Repetition dampening**: (K \gets K/\sqrt{1+n\_{\text{recent}}}).
- **MOV cap** (f\le 1.2).
- **Organizer reputation:** multiply (w\_{\text{event}}) by ([0.9,1.2]) based on venue/organizer history.
- **Outlier guard:** reject impossible scores; auto-reduce weight for <5-minute “matches”.
- **Auditability:** store per-match calc facts for review and rollback.

---

## 7) JavaScript Reference (worker-friendly)

> JS with JSDoc types so you can paste into a Node/Workers runtime. Storage calls are abstracted as `db.*`.

### 7.1 Config

```js
export const CFG = {
  R_INIT: 1500,
  K_INIT: 32,
  K_PROVISIONAL_MATCHES: 20,
  K_GUEST: 40,
  TAU: 400,
  MOV_ALPHA: 8,
  MOV_CAP: 1.2,
  DELTA_SESSION_CAP: 40,
  DELTA_DAY_CAP: 60,
  CHEM_LEARN: 6, // kappa
  CHEM_DECAY_MONTHLY: 0.01,
  CHEM_CAP: 70,
  TRUST_WEIGHTS: {
    ALL_LINKED: 1.0, // per §2.4, multiplied by verification multiplier
    EACH_TEAM_HAS_LINKED: 0.75,
    ONE_LINKED_ONLY: 0.25,
    NONE: 0,
  },
  VERIFY_MULTIPLIER: { BOTH: 1.0, ONE: 0.8, ORG_ONLY: 0.6 },
  EVENT_WEIGHT_DEFAULT: 1.0,
  L_R_BONUS: 12,
  ROLE_BONUS: 8,
};
```

### 7.2 Core functions

```js
/** @returns {number} */
export function expectedScore(Ta, Tb, tau = CFG.TAU) {
  return 1 / (1 + Math.pow(10, (Tb - Ta) / tau));
}

/** @returns {number} */
export function movMultiplier(
  pointsA,
  pointsB,
  alpha = CFG.MOV_ALPHA,
  cap = CFG.MOV_CAP
) {
  const diff = Math.abs(pointsA - pointsB);
  return Math.min(cap, Math.log(1 + diff / alpha));
}

/** Determine trust weight from links+verification */
export function trustWeight(match, linkMap) {
  const A = match.teamA.map((pid) => !!linkMap[pid]);
  const B = match.teamB.map((pid) => !!linkMap[pid]);
  const linkedCount = [...A, ...B].filter(Boolean).length;
  const teamALinked = A.some(Boolean);
  const teamBLinked = B.some(Boolean);

  let w;
  if (teamALinked && teamBLinked && linkedCount === 4)
    w = CFG.TRUST_WEIGHTS.ALL_LINKED;
  else if (teamALinked && teamBLinked)
    w = CFG.TRUST_WEIGHTS.EACH_TEAM_HAS_LINKED;
  else if (linkedCount === 1) w = CFG.TRUST_WEIGHTS.ONE_LINKED_ONLY;
  else w = CFG.TRUST_WEIGHTS.NONE;

  const ver = match.confirmations;
  const vm =
    ver.teamA && ver.teamB
      ? CFG.VERIFY_MULTIPLIER.BOTH
      : ver.teamA || ver.teamB
      ? CFG.VERIFY_MULTIPLIER.ONE
      : CFG.VERIFY_MULTIPLIER.ORG_ONLY;

  return w * vm;
}

/** Cold-start chemistry prior */
export function chemistryPrior(p1, p2) {
  let bonus = 0;
  if (p1.hand && p2.hand && p1.hand !== p2.hand) bonus += CFG.L_R_BONUS;
  if (p1.role && p2.role && p1.role !== p2.role) bonus += CFG.ROLE_BONUS; // attacker+controller heuristic
  return bonus; // b_i + b_j are shipped as 0 initially
}

/** Chemistry update for linked–linked pair */
export function updateChem(delta, residual, monthsElapsed) {
  const decay = 1 - CFG.CHEM_DECAY_MONTHLY * monthsElapsed;
  const next = Math.max(
    -CFG.CHEM_CAP,
    Math.min(CFG.CHEM_CAP, decay * delta + CFG.CHEM_LEARN * residual)
  );
  return next;
}
```

### 7.3 Session algorithm (high-level)

```js
export async function processEndSession(sessionId) {
  const session = await db.loadSession(sessionId);
  const linkMap = session.playerAccountLinks || {};
  const eventWeight = session.eventWeight ?? CFG.EVENT_WEIGHT_DEFAULT;

  // 1) Build players (linked persisted, guests ephemeral)
  const players = await buildPlayers(session, linkMap);

  // 2) Chemistry map (persisted for linked–linked, else prior)
  const chem = await buildChemistry(session, players, linkMap);

  // 3) Stabilization pass for guests (M epochs)
  await stabilizeGuests(session, players, chem);

  // 4) Compute and apply deltas for linked players
  const audit = [];
  const dayCounter = new Map(); // key: accountId+date -> cumulative delta

  for (const match of session.matches) {
    const wTrust = trustWeight(match, linkMap);
    if (wTrust === 0) continue;

    const teams = [
      { ids: match.teamA, side: "A" },
      { ids: match.teamB, side: "B" },
    ];

    // Build team strengths
    const TA = teamStrength(teams[0].ids, players, chem);
    const TB = teamStrength(teams[1].ids, players, chem);

    const EA = expectedScore(TA, TB);
    const SA = match.winner === "A" ? 1 : 0;
    const fMov = movMultiplier(match.totalPointsA, match.totalPointsB);

    const K_A = avgK(teams[0].ids, players);
    const K_B = avgK(teams[1].ids, players);
    // Symmetric K: use average of both teams' K to avoid bias
    const K_eff = (K_A + K_B) / 2;

    const delta = K_eff * wTrust * eventWeight * fMov * (SA - EA);

    // Apply to linked players only
    applyDeltaToTeam(
      teams[0].ids,
      players,
      delta,
      linkMap,
      dayCounter,
      session
    );
    applyDeltaToTeam(
      teams[1].ids,
      players,
      -delta,
      linkMap,
      dayCounter,
      session
    );

    // Chemistry update for linked–linked pairs that partnered
    updatePairChemistryIfLinked(
      teams[0].ids,
      players,
      chem,
      SA - EA,
      match.timestamp
    );
    updatePairChemistryIfLinked(
      teams[1].ids,
      players,
      chem,
      1 - SA - (1 - EA),
      match.timestamp
    );

    audit.push({
      matchId: match.matchId,
      TA,
      TB,
      EA,
      SA,
      fMov,
      wTrust,
      eventWeight,
      K_eff,
      delta,
    });
  }

  // 5) Enforce session caps and persist
  enforceSessionCaps(players);
  await db.persistRatings(players);
  await db.persistChemistry(chem);
  await db.saveAudit(sessionId, audit);

  return {
    sessionId,
    updated: Object.values(players).filter((p) => p.accountId),
  };
}
```

### 7.4 Helpers

```js
function teamStrength(ids, players, chem) {
  const [a, b] = ids;
  const pa = players[a],
    pb = players[b];
  const key = pairKey(pa, pb);
  const delta = chem[key]?.delta ?? chemistryPrior(pa, pb);
  return pa.ratings.doubles.R + pb.ratings.doubles.R + delta;
}

function avgK(ids, players) {
  const [a, b] = ids;
  return (players[a].ratings.doubles.K + players[b].ratings.doubles.K) / 2;
}

function applyDeltaToTeam(ids, players, delta, linkMap, dayCounter, session) {
  for (const pid of ids) {
    const acc = linkMap[pid];
    if (!acc) continue; // guest
    const pr = players[pid].ratings.doubles;

    // repetition dampening handled implicitly if needed before this call

    // Update with provisional K consideration (K belongs to player)
    pr.R += delta;
    pr.matches += 1;
    if (pr.matches >= CFG.K_PROVISIONAL_MATCHES) pr.K = 20;

    // Per-day cap enforcement
    const dayKey = `${acc}|${session.sessionId.slice(0, 10)}`; // or use match date YYYY-MM-DD
    const soFar = dayCounter.get(dayKey) ?? 0;
    const next = clamp(soFar + Math.abs(delta), 0, CFG.DELTA_DAY_CAP);
    const scale =
      next === soFar
        ? 0
        : Math.min(1, (CFG.DELTA_DAY_CAP - soFar) / Math.abs(delta));
    pr.R -= delta * (1 - scale); // rollback overflow portion
    dayCounter.set(dayKey, soFar + Math.abs(delta) * scale);
  }
}

function updatePairChemistryIfLinked(ids, players, chem, residual, timestamp) {
  const [a, b] = ids;
  const pa = players[a],
    pb = players[b];
  if (!pa.accountId || !pb.accountId) return;
  const key = pairKey(pa, pb);
  const months = monthsSince(chem[key]?.lastPlayed, timestamp) || 0;
  const prev = chem[key]?.delta ?? 0;
  const next = updateChem(prev, residual, months);
  chem[key] = { delta: next, updatedAt: timestamp, lastPlayed: timestamp };
}

function enforceSessionCaps(players) {
  for (const p of Object.values(players)) {
    if (!p.accountId) continue;
    const pr = p.ratings.doubles;
    const change = pr.R - (p._R_start ?? pr.R);
    if (Math.abs(change) > CFG.DELTA_SESSION_CAP) {
      pr.R = (p._R_start ?? pr.R) + Math.sign(change) * CFG.DELTA_SESSION_CAP;
    }
  }
}

function pairKey(p1, p2) {
  const a = p1.accountId,
    b = p2.accountId;
  return [a, b].sort().join("|");
}

function monthsSince(prevISO, currISO) {
  if (!prevISO) return 0;
  const prev = new Date(prevISO),
    curr = new Date(currISO);
  return Math.max(
    0,
    (curr.getUTCFullYear() - prev.getUTCFullYear()) * 12 +
      (curr.getUTCMonth() - prev.getUTCMonth())
  );
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
```

### 7.5 Guest stabilization (epochs)

```js
async function stabilizeGuests(session, players, chem, epochs = 3) {
  for (let e = 0; e < epochs; e++) {
    for (const m of session.matches) {
      const A = m.teamA.map((id) => players[id]);
      const B = m.teamB.map((id) => players[id]);
      // Only proceed if at least one guest participates
      if ([...A, ...B].every((p) => p.accountId)) continue;

      const TA = teamStrength(m.teamA, players, chem);
      const TB = teamStrength(m.teamB, players, chem);
      const EA = expectedScore(TA, TB);
      const SA = m.winner === "A" ? 1 : 0;
      const fMov = movMultiplier(m.totalPointsA, m.totalPointsB);

      const delta = CFG.K_GUEST * fMov * (SA - EA);

      // Update guests only
      for (const pid of m.teamA)
        if (!players[pid].accountId) players[pid].ratings.doubles.R += delta;
      for (const pid of m.teamB)
        if (!players[pid].accountId) players[pid].ratings.doubles.R -= delta;
    }
  }
}
```

> **Note:** In stabilization, we **don’t** use trust weights; the goal is to get internal consistency for this session’s ephemeral pool. Persisted updates later already apply trust/verification weights.

---

## 8) Example Walkthrough

**Match:** A(1520, linked) + G1(1500 guest) vs B(1500, linked) + G2(1500 guest).
Both teams confirm; eventWeight=1.0; L–R on both teams; scores 21-18,17-21,21-18 → points 59–57.

1. **Stabilization:** guests may shift slightly after epoching.
2. **Chemistry priors:** +12 for both pairs (not persisted for guests).
   (T*{AG1}=1520+1500+12=3032), (T*{BG2}=1500+1500+12=3012).
   (E*A\approx 1/(1+10^{(3012-3032)/400})\approx 0.529).
   (f= \ln(1+2/8)=0.223).
   Trust weight: each team has ≥1 linked → 0.75; verification both → ×1.0 ⇒ **0.75**.
   (K*{\text{eff}}=(32+32)/2=32).
   (\Delta=32\times0.75\times1.0\times0.223\times(1-0.529)\approx +2.64).
   Persisted: A +2.64, B −2.64. Guests not persisted. Chemistry not persisted (involves guests).

---

## 9) Operational Notes

- **Durations:** do **not** affect Elo (too noisy). Optionally flag extreme short matches and down-weight via verification/quality heuristics.
- **Concurrency:** serialize `END_SESSION` per sessionId; use idempotent writes with version or etags.
- **Backfill:** when importing historical sessions, process in chronological order; obey the same caps/weights for consistency.
- **Leaderboards:** use **doubles** ladder by default for club scenes; show rating confidence (match count + opponent diversity).
- **Rollbacks:** audit entries enable recomputation. Store: pre-ratings, post-ratings, weights, E, S, delta.

---

## 10) Testing Checklist

- Mixed-link matches adjust only linked players.
- Trust weights: 4-linked (1.0), 2-linked (0.75), 1-linked (0.25), 0-linked ignored.
- Verification multipliers applied.
- Session/day caps engaged under synthetic abuse (farming guests).
- Chemistry updates only for linked–linked pairs that partnered; decay over time.
- Guest stabilization doesn’t change linked ratings.
- Warm-start across ladders produce expected inits.

---

## 11) Future Enhancements (backward-compatible)

- Learn **partner uplift (b_i)** and feature weights for (\delta^{prior}).
- Add **Glicko-RD** (rating deviation) to reflect confidence in new players.
- Switch stabilization to **Bradley–Terry** with linked anchors for stronger session inference.
- Organizer/venue reputation auto-tuning of (w\_{\text{event}}).
- Collusion detector: reduce (w) for anomalous fixtures.

---

## 12) Summary

- Use **all** available matches with **trust weighting**; never reward guest farming.
- Persist changes **only** for linked accounts (ratings & chem).
- Compute at **session end** with a **guest stabilization** pass.
- Keep **singles** and **doubles** separate; doubles uses **sum + chemistry**.
- Ship with conservative defaults; improve priors offline without breaking the API.
