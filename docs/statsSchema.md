# Badminton Stats Data Model (Worker-Generated)

This document describes every document the worker writes, where it lives, what each field means, and how to use the data to derive interesting stats. Examples are given in plain JSON (logical model, not Firestore’s wire format).

> Throughout, the root collection is **`userStats`** (or **`userStats_test`** in test mode). I’ll write it as `{root}`.

---

## 1) Per-user Summary

**Path**
`{root}/{uid}`

**Purpose**
User-level rollup across **all time**. Holds totals and a short recent form feed.

**Fields**

- `uid` _(string)_ – the user id (duplicate for convenience).
- `totals` _(object)_

  - `games`, `wins`, `durationMin` _(ints)_ – overall counts.
  - `singles`, `doubles` _(objects)_ – **nested under `totals`**:

    - `games`, `wins`, `durationMin` _(ints)_ – mode split.

- `recentForm` _(array of objects, newest-first if you chose overwrite mode)_

  - each: `{ endedAt: ISO8601, result: "W"|"L", mode: "singles"|"doubles" }`

- `updatedAt` _(ISO8601)_ – last mutation.

**Typical uses**

- Win rate: `totals.wins / totals.games`
- Court time: `totals.durationMin`
- Mode splits: `totals.singles.*`, `totals.doubles.*`
- “Form” pill: last N from `recentForm`

**Example**

```json
{
  "uid": "uA",
  "totals": {
    "games": 128,
    "wins": 73,
    "durationMin": 1260,
    "singles": { "games": 40, "wins": 24, "durationMin": 360 },
    "doubles": { "games": 88, "wins": 49, "durationMin": 900 }
  },
  "recentForm": [
    { "endedAt": "2025-09-22T12:34:56Z", "result": "W", "mode": "doubles" },
    { "endedAt": "2025-09-22T12:10:03Z", "result": "L", "mode": "singles" }
  ],
  "updatedAt": "2025-09-22T12:35:00Z"
}
```

---

## 2) Per-user Monthly Rollup

**Path**
`{root}/{uid}/monthly/{YYYY-MM}`

**Purpose**
User totals for a calendar month. Idempotency is protected via `appliedSessions`.

**Fields**

- `month` _(string)_ – `YYYY-MM`.
- `singles`, `doubles`, `totals` _(objects)_ – `games`, `wins`, `durationMin` _(ints)_.
- `appliedSessions` _(map\<string,bool>)_ – session keys processed for this month.
- `updatedAt` _(ISO8601)_.

**Typical uses**

- Monthly charts, trends, streaks.
- Guard against double counting.

**Example**

```json
{
  "month": "2025-09",
  "singles": { "games": 8, "wins": 5, "durationMin": 74 },
  "doubles": { "games": 14, "wins": 8, "durationMin": 145 },
  "totals": { "games": 22, "wins": 13, "durationMin": 219 },
  "appliedSessions": { "org1_sess99": true, "org1_sess100": true },
  "updatedAt": "2025-09-22T12:35:00Z"
}
```

---

## 3) Per-user Session Audit

**Path**
`{root}/{uid}/bySession/{sessionKey}`

**Purpose**
Immutable audit of what a session contributed to this user.

**Fields**

- `organizerUid`, `sessionId`, `month` _(strings)_.
- `singles`, `doubles`, `totals` _(objects)_ – `games`, `wins`, `durationMin`.
- `recentFormSlice` _(array)_ – the per-session recent entries that were applied.
- `computedAt` _(ISO8601)_.

**Example**

```json
{
  "organizerUid": "org1",
  "sessionId": "sess100",
  "month": "2025-09",
  "singles": { "games": 1, "wins": 1, "durationMin": 10 },
  "doubles": { "games": 2, "wins": 1, "durationMin": 24 },
  "totals": { "games": 3, "wins": 2, "durationMin": 34 },
  "recentFormSlice": [
    { "endedAt": "2025-09-22T12:34:56Z", "result": "W", "mode": "doubles" },
    { "endedAt": "2025-09-22T12:10:03Z", "result": "W", "mode": "singles" },
    { "endedAt": "2025-09-22T11:51:00Z", "result": "L", "mode": "doubles" }
  ],
  "computedAt": "2025-09-22T12:36:02Z"
}
```

---

## 4) Per-user **Friends** (teammates) Mirror

**Path**
`{root}/{uid}/friends/{otherUid}`

**Purpose**
Fast per-profile read of your teammate history with another user.
Authoritative counters are under `friendEdges` (see §6).

**Fields**

- `otherUid` _(string)_ – teammate.
- `edgeKey` _(string)_ – canonical `min(uid,other) + "__" + max(...)`.
- `together` _(object)_ – `games`, `wins`, `durationMin` _(ints)_.
- `lastPlayedAt`, `updatedAt` _(ISO8601)_.

**Typical uses**

- “Top partners” by win rate: `together.wins / together.games`
- Recently played partners: sort by `lastPlayedAt`

**Example**

```json
{
  "otherUid": "uB",
  "edgeKey": "uA__uB",
  "together": { "games": 37, "wins": 22, "durationMin": 410 },
  "lastPlayedAt": "2025-09-22T12:34:56Z",
  "updatedAt": "2025-09-22T12:35:00Z"
}
```

---

## 5) Per-user **Opponents** Mirror (Head-to-Head)

**Path**
`{root}/{uid}/opponents/{otherUid}`

**Purpose**
Fast per-profile read of head-to-head history.

**Fields**

- `otherUid`, `edgeKey` _(strings)_.
- `against` _(object)_

  - `singles` _(object)_ – `games`, `wins`, `losses`, `durationMin`.
  - `doubles` _(object)_ – same.
  - `totals` _(object)_ – same.

- `lastPlayedAt`, `updatedAt` _(ISO8601)_.

**Typical uses**

- H2H record cards: wins/losses overall and by mode.
- “Nemesis” (worst win rate against) or “Most beaten” (best win rate).

**Example**

```json
{
  "otherUid": "uB",
  "edgeKey": "uA__uB",
  "against": {
    "singles": { "games": 5, "wins": 2, "losses": 3, "durationMin": 55 },
    "doubles": { "games": 18, "wins": 11, "losses": 7, "durationMin": 185 },
    "totals": { "games": 23, "wins": 13, "losses": 10, "durationMin": 240 }
  },
  "lastPlayedAt": "2025-09-22T12:34:56Z",
  "updatedAt": "2025-09-22T12:35:00Z"
}
```

---

## 6) Global **Friend Edges** (authoritative teammates)

**Path**
`friendEdges/{edgeKey}`

**Purpose**
Authoritative teammate counters across all users.

**Fields**

- `participants` _(array<string>)_ – `[u1, u2]` canonical order.
- `together` _(object)_ – `games`, `wins`, `durationMin`.
- `lastPlayedAt`, `updatedAt` _(ISO8601)_.

**Subcollections**

- `monthly/{YYYY-MM}`

  - `month` _(string)_, `appliedSessions` _(map)_, `lastPlayedAt` _(ISO8601)_,
  - `together` _(object)_ – counters for that month,
  - `updatedAt`.

- `bySession/{sessionKey}` _(gate/audit)_ – created once per session to ensure idempotency.

**Typical uses**

- Global leaderboards: most games/wins with a partner.
- Social graph analysis (degree, clustering, etc).

**Example (root)**

```json
{
  "participants": ["uA", "uB"],
  "together": { "games": 73, "wins": 45, "durationMin": 820 },
  "lastPlayedAt": "2025-09-22T12:34:56Z",
  "updatedAt": "2025-09-22T12:35:00Z"
}
```

**Example (monthly)**

```json
{
  "month": "2025-09",
  "appliedSessions": { "org1_sess100": true },
  "together": { "games": 6, "wins": 4, "durationMin": 62 },
  "lastPlayedAt": "2025-09-22T12:34:56Z",
  "updatedAt": "2025-09-22T12:35:00Z"
}
```

**Example (bySession gate)**

```json
{
  "sessionKey": "org1_sess100",
  "month": "2025-09",
  "createdAt": "2025-09-22T12:36:02Z"
}
```

---

## 7) Global **Opponent Edges** (authoritative head-to-head)

**Path**
`opponentEdges/{pairKey}`

**Purpose**
Authoritative H2H counters across all users, split by mode.

**Fields**

- `participants` _(array<string>)_ – `[u1, u2]`.
- `head` _(object)_

  - `singles`: `games`, `winsU1`, `winsU2`, `durationMin`.
  - `doubles`: same.
  - `totals`: same.

- `lastPlayedAt`, `updatedAt` _(ISO8601)_.

**Subcollections**

- `monthly/{YYYY-MM}` – same `head.*` counters, `month`, `appliedSessions`, `lastPlayedAt`, `updatedAt`.
- `bySession/{sessionKey}` _(gate/audit)_ – created once per session to ensure idempotency.

**Typical uses**

- Global H2H boards.
- “Top rivalries” by games, “Most lopsided” by win delta.

**Example (root)**

```json
{
  "participants": ["uA", "uB"],
  "head": {
    "singles": { "games": 9, "winsU1": 4, "winsU2": 5, "durationMin": 100 },
    "doubles": { "games": 36, "winsU1": 20, "winsU2": 16, "durationMin": 360 },
    "totals": { "games": 45, "winsU1": 24, "winsU2": 21, "durationMin": 460 }
  },
  "lastPlayedAt": "2025-09-22T12:34:56Z",
  "updatedAt": "2025-09-22T12:35:00Z"
}
```

**Example (monthly)**

```json
{
  "month": "2025-09",
  "appliedSessions": { "org1_sess100": true },
  "head": {
    "singles": { "games": 1, "winsU1": 1, "winsU2": 0, "durationMin": 11 },
    "doubles": { "games": 4, "winsU1": 2, "winsU2": 2, "durationMin": 40 },
    "totals": { "games": 5, "winsU1": 3, "winsU2": 2, "durationMin": 51 }
  },
  "lastPlayedAt": "2025-09-22T12:34:56Z",
  "updatedAt": "2025-09-22T12:35:00Z"
}
```

**Example (bySession gate)**

```json
{
  "sessionKey": "org1_sess100",
  "month": "2025-09",
  "createdAt": "2025-09-22T12:36:02Z"
}
```

---

## 8) Idempotency Gates (per-task / per-session)

> Your worker uses **create-only** docs as gates to avoid double counting.

**Per-user tasks** _(recommended per-session keys)_

- Path: `{root}/{uid}/gates/stats:monthly:{YYYY-MM}:{uid}:{sessionKey}`

  - Fields: `{ taskKey, sessionKey, scope:{uid,month}, workerVersion, createdAt }`

- Path: `{root}/{uid}/gates/stats:summary:{uid}:{sessionKey}`

  - Fields: `{ taskKey, sessionKey, scope:{uid}, workerVersion, createdAt }`

**Per-edge tasks**

- Friends: `friendEdges/{edgeKey}/bySession/{sessionKey}` (see §6)
- Opponents: `opponentEdges/{pairKey}/bySession/{sessionKey}` (see §7)

**Example (user monthly gate)**

```json
{
  "taskKey": "stats:monthly:2025-09:uA:org1_sess100",
  "sessionKey": "org1_sess100",
  "scope": { "uid": "uA", "month": "2025-09" },
  "workerVersion": "2025-09-22.1",
  "createdAt": "2025-09-22T12:36:02Z"
}
```

---

## How to use these stats (ideas)

### Per-user views

- **Overall win rate**: `totals.wins / totals.games`
- **Mode preference**: compare `totals.singles.games` vs `totals.doubles.games`
- **Efficiency**: `wins per hour` → `wins / (durationMin/60)`
- **Recent form**: last 10 in `recentForm` → form chart / streaks

### Social / partners

- **Best partners**: sort `friends` mirror by `together.wins / together.games` (min N games)
- **Most-played partners**: sort by `together.games`
- **Recency**: sort by `lastPlayedAt` for “played with recently”

### Rivalries / opponents

- **H2H overall**: from `opponents` mirror → wins, losses, rate
- **Mode-specific H2H**: singles vs doubles split
- **Nemesis / Favorite opponent**: lowest/highest win rate (min N)
- **Lopsided rivalries**: max `|wins - losses|`

### Global boards

- **Top teammate pairs**: from `friendEdges` root or monthlies
- **Top rivalries**: from `opponentEdges` root or monthlies

---

## Notes / conventions

- **Canonical pair key**: `edgeKey = min(uid1,uid2) + "__" + max(uid1,uid2)`
  Ensures a single doc per unordered pair.
- **Timestamps** are stored as ISO strings (Firestore `REQUEST_TIME`).
- **Idempotency**:

  - Monthly docs carry `appliedSessions.{sessionKey}: true`.
  - Edge monthlies do the same.
  - Create-only **bySession** docs/gates ensure a session updates each target **once**.

---

## Quick index guidance

- Most reads are **by path** (no index needed).
- If you later add filtered, ordered queries (e.g., `friendEdges` ordered by `together.games` with a filter), Firestore may prompt you for a composite index. Create only what you actually need.

---

If you want, I can generate a small **TypeScript typings file** for these shapes so your frontend/services get autocomplete & type safety.
