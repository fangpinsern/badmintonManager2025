## Per-point Duration Tracking (Compact Storage)

### Goal

- **Record the duration of each rally/point** when scoring via gestures.
- **Keep storage tiny** so large sessions (many games) don’t bloat Firestore or slow reads/writes.
- Be **backward-compatible** and optional for older games.

### Constraints

- Sessions can contain many games; each game can have up to ~41 points (21–20) but competitive sets may go higher.
- Firestore document size limit ~1 MiB; session payload already stores players, courts, and games.
- Avoid frequent writes during play; prefer local accumulation and a single write on game end.

### Data Model (Minimal Additions)

- Extend `Game` with an optional compact field:
  - `rallyDurationsDs_b64?: string` – base64 of a `Uint16Array`, where each element is a rally duration in deciseconds (0.1s).
  - Deciseconds keep precision high enough while capping values at 6553.5s per rally (more than enough).
  - Example per game: 40 rallies × 2 bytes ≈ 80 bytes raw → ~108 base64 bytes.

### Encoding Format

- Unit: deciseconds (ds). Store as unsigned 16-bit integers.
- Clamp and sanitize:
  - Negative or NaN → skip (do not include).
  - > 65535 ds → clamp to 65535.
- Serialize: `Uint16Array` → base64 string. No arrays in Firestore to avoid per-element overhead.
- Decode reverses to `number[]` in milliseconds for UI/analytics.

### Lifecycle in UI

- At game start: set `rallyStartMs = now`, clear `rallyDurationsMs: number[]` (local only).
- On each point (gesture-detected):
  - `durMs = now - rallyStartMs` → push to `rallyDurationsMs`.
  - `rallyStartMs = now` (next rally begins immediately after scoring).
- Undo last point: pop from `rallyDurationsMs`; set `rallyStartMs = now`.
- Pause/no-score intervals (timeouts, shuttle pickup): naturally included in the next rally unless you explicitly add a pause toggle (not required for v1).
- End game: encode `rallyDurationsMs` → `rallyDurationsDs_b64` and include it in the saved `Game` object.

### API/Type Changes (Backward-Compatible)

- `src/types/player.ts → type Game` add:

```ts
// optional, present when recorded via gestures
/** base64-encoded Uint16Array of rally durations in deciseconds (0.1s) */
rallyDurationsDs_b64?: string;
```

- `store.endGame` add optional `opts` param:

```ts
// before
endGame(
  sessionId: string,
  courtIndex: number,
  scoreA: number,
  scoreB: number,
  endedByUid?: string | null,
  endedByRole?: "organizer" | "co-organizer"
): void

// after (non-breaking: new trailing arg)
endGame(
  sessionId: string,
  courtIndex: number,
  scoreA: number,
  scoreB: number,
  endedByUid?: string | null,
  endedByRole?: "organizer" | "co-organizer",
  opts?: { rallyDurationsDs_b64?: string }
): void
```

- When constructing the `Game` object, attach:
  - `game.rallyDurationsDs_b64 = opts?.rallyDurationsDs_b64` only if valid and length matches total points.

### Helper Utilities

- Add to `src/lib/helper.ts` (or new `src/lib/rallyDurations.ts`):

```ts
export function encodeRallyDurationsMsToB64Ds(durationsMs: number[]): string {
  const ds = durationsMs
    .map((ms) => Math.max(0, Math.round(ms / 100)))
    .filter((v) => Number.isFinite(v))
    .map((v) => (v > 65535 ? 65535 : v));
  const arr = new Uint16Array(ds);
  const buf = new Uint8Array(arr.buffer);
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return typeof btoa === "function"
    ? btoa(bin)
    : Buffer.from(buf).toString("base64");
}

export function decodeRallyDurationsB64DsToMs(b64: string): number[] {
  if (!b64) return [];
  const bin =
    typeof atob === "function"
      ? atob(b64)
      : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new Uint16Array(bytes.buffer);
  const out: number[] = new Array(view.length);
  for (let i = 0; i < view.length; i++) out[i] = view[i] * 100; // back to ms
  return out;
}
```

### Validation Rules

- Only persist if `rallyDurations.length === scoreA + scoreB`.
- On manual game edit causing point-count mismatch: drop `rallyDurationsDs_b64` to avoid stale alignment.
- Voided games: do not persist the field.

### Storage/Perf Estimate

- Typical 40-point game → ~108 chars per game.
- 30 games per session → ~3.2 KB added per session payload.
- Single write on game end; no extra per-point writes. Negligible read overhead (string field).

### Implementation Steps

- **1. Types**: Add `rallyDurationsDs_b64?: string` to `Game` in `src/types/player.ts`.
- **2. Helpers**: Add encode/decode functions.
- **3. Store**: Update `endGame` to accept `opts` and attach the field if valid.
- **4. Gesture Overlay** (`GameRecorderOverlay.tsx`):
  - Track `rallyStartMs` and local `rallyDurationsMs`.
  - On point, push duration; on undo, pop.
  - On end-game, encode and pass `opts` to `endGame`.
- **5. Court UI** (`courtCard.tsx`): Leave `opts` undefined for manual scoring; no change in behavior.
- **6. Edit Modal** (`gameEditModal.tsx`): If score changes and no longer matches stored length, display a hint and drop the field upon save.
- **7. Stats Worker**: No change required; existing `durationMin` continues to use `Game.durationMs`. Future analytics can optionally decode and compute median/longest rally, etc.

### Rollout

- Ship client changes (types, helpers, store, overlay wiring).
- No migrations; old games have no field. Reads of `Game` must treat field as optional.
- Add light analytics log on save: count, median, p95 (derived client-side) to validate ranges in the wild.

### Future Enhancements (optional)

- Per-rally winner flags compacted into a bitset (1 bit each) if needed later.
- Pause handling: explicit pause/resume to exclude downtime from rally timing.
- UI: charts for rally length distribution; highlight longest rallies.
