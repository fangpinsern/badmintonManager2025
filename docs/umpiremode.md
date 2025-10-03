love this idea — “anyone idle becomes the umpire” is perfect for social badminton. here’s a concrete, MVP-friendly design for an Umpire Mode that fits your Next.js + Firebase stack (with optional Cloudflare Workers for background jobs).

# what the umpire sees (UX)

**Top bar**

- Court name + match type (Singles/Doubles), game number (G1/G2/G3), session name
- Connection state (online/offline), a “Claimed by You” pill (prevents double-umpiring), and a **QR** button to show a big spectator link

**Main scoreboard (big, glanceable)**

- Side A vs Side B: names (or team labels), avatars/initials, score in huge font
- A small **serve dot** next to the serving side; “L/R” indicator for service court
- Game clock (elapsed), last rally time

**Controls (thumb-friendly)**

- Two large **+1** buttons (“A scores”, “B scores”)

  - tap = award point immediately
  - optional 2-second “reason picker” pops up; if ignored → reason = `UNSPEC`

- **Undo** (one-tap revert last rally), **Redo**, **Edit score** (guarded by confirm)
- **Timeout / Injury / Pause** buttons (start/pause timers)
- **Interval helpers**

  - at 11 points (any game): start 60s interval
  - between games: start 120s interval
  - G3 at 11: prompt “Change Ends now”

- **Service order widget**

  - shows server & receiver (with mini portraits) and current service box (L/R)
  - one-tap **manual override** if players stood wrongly

- **Quick reasons** (one tap)

  - Out (long / wide), Net, Double hit, Service fault (short/high/foot/time), Body/net touch, Over-the-net, Carry/Lift, Receiver fault, Winner (smash/drop/drive), Forced error, Unforced error, Other
  - configurable per club/session

**Footer**

- Rally feed (live): `#27  A+ 21–19   reason: OUT_WIDE   9.2s`
- Haptics + short beep on score (PWA ok on mobile)

**Safety**

- **Hold-to-confirm** for End Game and Edit Score
- “Are you sure?” if attempt to end with non-terminal score

---

# core features (MVP first)

1. **Claim Umpire** per court

- Single active umpire lock with TTL; others view-only.
- Reclaim if stale (e.g., device offline > 30s).

2. **Scoring with reasons**

- Fast +1 workflow; reasons optional but encouraged via quick picker.
- Full **Undo/Redo** stack.

3. **Service order tracking**

- Auto compute server/receiver and L/R service box from score + starting positions.
- Singles: server’s score parity ⇒ service box; on rally loss, service switches.
- Doubles: fixed order from starting positions; the player in the **right** box serves when their side gains service; on rally won while serving, same server switches boxes.
- Always allow **manual override**.

4. **Intervals & ends change**

- 11-point interval timers; end-change prompts at game ends and G3@11.

5. **Timers**

- Game elapsed, rally duration, timeout/injury/interval timers.

6. **Spectator link**

- Read-only scoreboard view; show QR on umpire device.

7. **Resilience**

- Works offline with Firestore persistence; queues rally events and replays on reconnect.

---

# nice-to-haves (phase 2)

- Volume-button scoring (Android PWA) / keyboard hotkeys on desktop
- Shot-count (tap counter) per rally
- Shuttle usage counter
- Dispute flag per rally (“contested”)
- Voice cues (“Service over, 15–14”)
- Per-court dark/bright “stadium” display mode
- “Coach notes” tags

---

# data to record (Firestore schema)

> naming uses `{}` for dynamic segments.

### 1) game document (source of truth for a single game)

`/sessions/{sessionId}/games/{gameId}`

```json
{
  "sessionId": "s123",
  "courtId": "c2",
  "state": "in_progress", // waiting | in_progress | paused | ended | abandoned
  "mode": "doubles", // singles | doubles
  "bestOf": 3,
  "targetPoints": 21,
  "winBy": 2,
  "cap": 30, // max points
  "gameIndex": 1, // 1,2,3
  "players": {
    "A": [{ "playerId": "pA1", "linkedUid": "uX" }, { "playerId": "pA2" }],
    "B": [{ "playerId": "pB1" }, { "playerId": "pB2" }]
  },
  "startedAt": 1730541200000,
  "endedAt": null,
  "createdByUid": "uUmpire",
  "umpire": {
    // last/active umpire snapshot
    "uid": "uUmpire",
    "displayName": "Kai",
    "deviceId": "dev-abc"
  },

  // live state snapshot (derived from rallies but kept for fast reads)
  "stateSnap": {
    "scoreA": 18,
    "scoreB": 16,
    "rallyNo": 35,
    "servingSide": "A",
    "serverPid": "pA1",
    "receiverPid": "pB1",
    "serviceBox": "left", // left | right (from server perspective)
    "lastEventId": "evt_000035",
    "streak": { "A": 2, "B": 0 }
  }
}
```

**notes**

- `stateSnap` is redundant but speeds up UI; recompute from events if needed.
- If players aren’t registered users, store `playerId` from session roster; `linkedUid` optional.

---

### 2) rallies subcollection (append-only event log)

`/sessions/{sessionId}/games/{gameId}/rallies/{eventId}`

```json
{
  "eventId": "evt_000035", // client-generated, monotonic per device
  "ts": 1730541389123, // serverTimestamp preferred
  "rallyNo": 35,
  "winnerSide": "A", // A | B
  "scoreAfter": { "A": 18, "B": 16 },
  "reason": {
    "code": "OUT_WIDE", // enum (see taxonomy)
    "againstSide": "B", // side that lost point (optional if deducible)
    "detail": null // freeform note (optional)
  },
  "rallyDurationMs": 9200,
  "shotCount": 11, // optional
  "service": {
    "start": {
      "side": "A",
      "serverPid": "pA1",
      "receiverPid": "pB1",
      "box": "right"
    },
    "end": {
      "side": "A",
      "serverPid": "pA1",
      "receiverPid": "pB1",
      "box": "left"
    }
  },
  "flags": { "contested": false },
  "auth": { "byUid": "uUmpire", "deviceId": "dev-abc" }
}
```

**why event-sourced?**

- Perfect for undo/redo, audits, recomputation, stats (streaks, serve/receive win rates).

---

### 3) umpire claim (to prevent double scoring)

`/sessions/{sessionId}/courts/{courtId}/umpireClaim`

```json
{
  "status": "active", // active | stale | released
  "uid": "uUmpire",
  "displayName": "Kai",
  "deviceId": "dev-abc",
  "gameId": "g789",
  "lastHeartbeat": 1730541391000, // updated every ~10s
  "expiresAt": 1730541420000 // server-enforced TTL
}
```

Clients check/renew; if `now > expiresAt`, claim is stealable.

---

### 4) court live state (for spectator view)

`/sessions/{sessionId}/courts/{courtId}` (existing—extend safely)

```json
{
  "currentGameId": "g789",
  "display": {
    "scoreA": 18,
    "scoreB": 16,
    "servingSide": "A",
    "serviceBox": "left",
    "teamA": ["A. Tan", "B. Lim"],
    "teamB": ["C. Ng", "D. Foo"]
  },
  "spectatorUrl": "https://app/score/s123/c2",
  "qrPayload": "app://score?s=s123&c=c2"
}
```

---

### 5) timeouts/intervals (optional subcollection)

`/sessions/{sessionId}/games/{gameId}/stoppages/{stopId}`

```json
{
  "type": "interval_11", // interval_11 | between_games | timeout | injury | pause
  "side": null, // e.g. "A" for team timeout; null for neutral intervals
  "startedAt": 1730541300000,
  "endedAt": 1730541360000,
  "durationMs": 60000
}
```

---

# reason taxonomy (compact, extensible)

Use a flat enum with categories for analytics:

```json
[
  { "code": "UNSPEC", "label": "Unspecified", "cat": "OTHER" },
  { "code": "OUT_LONG", "label": "Out - Long", "cat": "OUT" },
  { "code": "OUT_WIDE", "label": "Out - Wide", "cat": "OUT" },
  { "code": "NET", "label": "Into Net", "cat": "ERROR" },
  { "code": "DOUBLE_HIT", "label": "Double Hit", "cat": "FAULT" },
  { "code": "CARRY", "label": "Carry/Lift", "cat": "FAULT" },
  { "code": "NET_TOUCH", "label": "Body/Net Touch", "cat": "FAULT" },
  { "code": "OVER_NET", "label": "Over the Net", "cat": "FAULT" },
  { "code": "SERVE_SHORT", "label": "Service - Short", "cat": "SERVE" },
  { "code": "SERVE_HIGH", "label": "Service - Too High", "cat": "SERVE" },
  { "code": "FOOT_FAULT", "label": "Service - Foot Fault", "cat": "SERVE" },
  { "code": "SERVE_TIME", "label": "Service - Time Fault", "cat": "SERVE" },
  { "code": "RECEIVER_FAULT", "label": "Receiver Fault", "cat": "RECEIVE" },
  { "code": "WINNER_SMASH", "label": "Winner - Smash", "cat": "WINNER" },
  { "code": "WINNER_DROP", "label": "Winner - Drop", "cat": "WINNER" },
  { "code": "WINNER_DRIVE", "label": "Winner - Drive", "cat": "WINNER" },
  { "code": "FORCED_ERR", "label": "Forced Error", "cat": "PRESSURE" },
  { "code": "UNFORCED_ERR", "label": "Unforced Error", "cat": "ERROR" },
  { "code": "OTHER", "label": "Other", "cat": "OTHER" }
]
```

Store centrally (e.g., `/config/reasons`) so sessions can customize.

---

# service order logic (practical)

**Singles**

- **Start**: choose server; server starts in **right** box.
- **If server wins** a rally: server keeps serving; service box toggles (L↔R).
- **If receiver wins**: service switches to that player; their **score parity** decides box (even ⇒ right, odd ⇒ left).

**Doubles (simplified & correct enough for clubs)**

- Fix player order per side at start: `A1,A2` and `B1,B2`.
- A side’s **even score ⇒ players in original right/left; odd score ⇒ swapped**.
- When a side **gains service**, the player **standing in the right box** serves.
- If the **server’s side wins**, the **same server** serves again but from the **other box**.
- If the **server’s side loses**, service passes to opponents; their **right-box** player serves.
- Always allow **manual override**.

Implement these as pure functions from `(mode, startingPositions, currentScore, lastServer)` → `{servingSide, serverPid, receiverPid, serviceBox}`.

---

# flows & state machine

**States**: `waiting → in_progress ↔ paused → ended/abandoned`
**Transitions**:

- Start game ⇒ create `game` + seed `stateSnap`
- Each rally ⇒ add `rallies/{event}`; recompute `stateSnap` in transaction
- Undo ⇒ soft-delete last event (or mark `reverted:true`) and recompute
- End game ⇒ set `state=ended`, finalize `endedAt`, write a final snapshot to `courts/{courtId}`

---

# realtime & offline (Firebase)

- Enable Firestore offline persistence.
- Client generates monotonically increasing `eventId` with `{deviceId}-{counter}`.
- Use batched writes or a transaction: append rally ⇒ update `stateSnap` atomically (with a server check on `lastEventId`).
- Conflict resolution: if `lastEventId` mismatches, refetch, recompute client-side, retry.

---

# background tasks (Cloudflare Workers — optional but handy)

- **Post-game aggregator**: on `game.state == ended`, compute:

  - serve/receive point % by side
  - reason breakdowns (unforced %, service faults)
  - streaks, clutch points after 18–18, average rally duration
  - publish to `/sessions/{sessionId}/games/{gameId}/stats`

- **Notifications**: push to Telegram/Discord when a final score lands.
- **Anti-abuse**: detect abnormal edit/undo spam, flag for organizer.

(Workers trigger by Firestore webhook via your existing relay pattern, or by polling if needed.)

---

# permissions (rules outline)

- Organizer or claimed umpire can write to the active court’s `game` + `rallies`.
- Viewers (any) can read spectator endpoints.
- Undo/edit limited to **current game** and **last K rallies** (e.g., K=5) unless organizer.

---

# indexes

- `rallies` composite: `gameId asc, rallyNo asc` (for feed)
- `games` where `sessionId==… && courtId==… && state in {waiting,in_progress}`

---

# MVP cut (ship this first)

1. Claim umpire (TTL lock)
2. Big scoreboard with +1, undo, auto service order (+ manual override)
3. Reason picker (5–8 most common), “Other” catch-all
4. Intervals + change ends prompts
5. Spectator link + QR
6. Event log + snapshot state; offline-first

---

# quick UI layout sketch

- **Header**: `Court 2 · Doubles · G1` — [Claimed by Kai] — [QR]
- **Scoreboard**:

  - **A** `Tan/Lim` **18** ● (L) vs **B** `Ng/Foo` **16** ( )

- **Controls**:

  - [ A +1 ] [ Undo ] [ Redo ] [ B +1 ]
  - [ Reason ⌄ ] [ Timeout ] [ Injury ] [ Pause ]

- **Rally Feed**:

  - `#35  A+ 18–16  OUT_WIDE  9.2s`

- **Footer**: `Rally 35 · 00:19:22 elapsed`

---

# implementation checklist (Next.js + Firebase)

- **Pages**:

  - `/session/[sid]/court/[cid]/umpire` (editor)
  - `/session/[sid]/court/[cid]/score` (spectator, read-only)

- **Hooks**:

  - `useUmpireClaim(sid,cid)` — heartbeat & TTL logic
  - `useGameState(gameId)` — subscribe to `game` + `rallies` (window last 10)

- **Functions**:

  - `appendRally({winnerSide, reason})` — transaction: write event, recompute `stateSnap`
  - `undoLast()` — mark last rally reverted or delete last doc; recompute
  - `computeNextService(state)` — pure rules function (unit-tested)

- **Offline**: enable persistence; maintain local counter for `eventId`
- **UI**: large buttons, haptics, confirm modals, toasts
- **Config**: `/config/reasons` with session-level overrides

---
