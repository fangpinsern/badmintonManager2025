# Calendar Invites for Club Sessions — Technical Spec & Implementation Guide

> Stack: Next.js (client), Firebase Auth + Firestore (data), Cloudflare Worker (backend tasks)

This doc specifies how to create a calendar invite per session and automatically add attendees when they join. Sending the invite is **optional per user** (they can join even if they disable invites). Invites must include **venue** and **correct date/time** with timezone awareness.

---

## 1) Goals & Non-Goals

**Goals**

- Create 1 calendar event **per session** at creation time.
- When a user joins, **optionally add** them to the invite depending on their personal setting.
- Keep the event up-to-date (time/venue changes propagate).
- Support cancellation updates.
- Ensure timezone correctness.

**Non-Goals**

- Per-user OAuth to write into **their** personal calendar (out of scope).
- Email delivery metrics or bounce handling (can be added later).

---

## 2) Architecture Overview

Two equally-valid delivery options. You can ship either first and add the other later:

- **Option A (recommended): Google Calendar API w/ a single “app calendar”**

  - Use one dedicated Google account + one calendar (e.g. `noreply@yourdomain.com` → “Badminton Sessions”).
  - On session creation: **events.insert** (no attendees yet).
  - On join (if user opted-in): **events.patch** to add attendee; Google sends the invite.
  - Pros: Best UX for Google users; automatic updates & RSVP; no email provider needed.

- **Option B: Email an ICS invite (no Google API)**

  - Worker composes `.ics` invite (`METHOD:REQUEST`) and sends via an email API free tier.
  - On updates: resend `.ics` with `SEQUENCE+1`. On cancel: `METHOD:CANCEL`.
  - Pros: No OAuth; works for Outlook/Apple too.

Both options are compatible and can be selected by a **global setting** or a **per-club** setting.

**Flow (common to both):**

1. Client creates/updates **Firestore** documents (session, attendees, user settings).
2. Client calls **Cloudflare Worker** HTTP endpoint after successful Firestore writes (idempotent).
3. Worker creates/updates the event or sends ICS, then marks invite status in Firestore.

---

## 3) Firestore Data Model

```text
users/{uid}
  email: string
  displayName: string
  timezone?: string            // IANA tz, e.g. "Asia/Singapore" (optional default)
  calendar:
    enabled: boolean           // user setting: send invites for joined sessions?
    method: "google" | "ics"   // optional; default inherited from app/club
    email?: string             // if different from auth email

clubs/{clubId}
  name: string
  defaultTimezone: string      // e.g. "Asia/Singapore"
  venueDefault?: string
  calendar:
    method: "google" | "ics"
    gcalCalendarId?: string    // if you move to per-club calendars later

sessions/{sessionId}
  clubId: string
  title: string                // e.g. "Friendly Doubles"
  venue: string                // e.g. "XYZ Sports Hall, Court 3"
  startAtUtc: string           // ISO UTC, e.g. "2025-11-02T11:00:00Z"
  endAtUtc: string             // ISO UTC
  timezone: string             // IANA tz used to compute UTC (source-of-truth for display)
  gcalEventId?: string         // set after create (Option A)
  inviteStatus: "created" | "updated" | "canceled" | "error" // optional

sessions/{sessionId}/attendees/{attendeeId}  // attendeeId can be uid or generated
  uid?: string
  email: string
  optedIn: boolean             // snapshot of user's setting at join time
  invited: boolean             // idempotency marker
  inviteMethod?: "google" | "ics"
  inviteSequence?: number      // for ICS updates (start at 0)
  rsvp?: "accepted" | "declined" | "tentative" | "needsAction"
  joinedAt: Timestamp
```

**Why store both `startAtUtc` and `timezone`?**

- UTC ensures consistent transport and comparisons.
- `timezone` preserves the intended local time semantics (e.g., for Google Calendar’s `timeZone` field, and for display).

---

## 4) Client UX & Flows

### 4.1 User Settings

- “Calendar invites for sessions I join”: **toggle** (default off/on as you prefer).
- “Invite email”: default to Firebase Auth email; editable if needed.
- (Optional) Let user choose **method**: “Google” (app calendar invite) or “Email ICS”.

### 4.2 Create Session

1. Organizer fills: title, venue, **local** date + start/end time, club timezone (pre-filled).
2. Client converts local time to **UTC** using `timezone`.
3. Create `sessions/{sessionId}` with `startAtUtc`, `endAtUtc`, `timezone`, `venue`.
4. After Firestore write succeeds, client calls Worker `POST /calendar/event.create { sessionId }`.

   - Worker creates event (Option A) or does nothing yet (for ICS you invite per-user only).

### 4.3 Join Session

1. Client writes `attendees/{attendeeId}` with `email`, `optedIn` (copied from `users/{uid}.calendar.enabled`) and `inviteMethod` (resolved).
2. If `optedIn === true`, client calls Worker `POST /calendar/event.invite { sessionId, attendeeId }`.

### 4.4 Edit Session

- On time/venue change: client updates session doc; then calls `POST /calendar/event.update { sessionId }`.
- Worker patches event (Option A) or sends ICS update (`SEQUENCE+1` to opted-in attendees).

### 4.5 Leave / Cancel

- On attendee delete: call `POST /calendar/event.uninvite { sessionId, attendeeId }` (optional).
- On session delete/cancel: call `POST /calendar/event.cancel { sessionId }`.

---

## 5) Cloudflare Worker — Endpoints & Behavior

> All endpoints require a **Firebase ID token** in `Authorization: Bearer <token>`; Worker verifies and authorizes (see §9 Security).

**Env variables (secrets)**

```
# For Option A (Google)
GCAL_CLIENT_ID
GCAL_CLIENT_SECRET
GCAL_REFRESH_TOKEN       # one-time minted for the dedicated Google account
GCAL_CALENDAR_ID         # the app calendar ID (or per-club later)

# For Option B (ICS email) — choose one provider
RESEND_API_KEY | SENDGRID_API_KEY | MAILGUN_API_KEY
MAIL_FROM="noreply@yourdomain.com"
```

**Endpoints**

- `POST /calendar/event.create` `{ sessionId }`

  - Loads session; if `gcalEventId` missing → create event; store `gcalEventId`.

- `POST /calendar/event.invite` `{ sessionId, attendeeId }`

  - Loads session + attendee.
  - If `attendee.invited === true` → no-op (idempotent).
  - If attendee opted-in:

    - **Option A**: patch event attendees; `sendUpdates=all`. Set `invited=true`.
    - **Option B**: send `.ics` (sequence 0); set `invited=true`, `inviteSequence=0`.

- `POST /calendar/event.update` `{ sessionId }`

  - **Option A**: patch event (time/venue); Google notifies all attendees.
  - **Option B**: send updated `.ics` with `SEQUENCE=prev+1` to all opted-in attendees; update their `inviteSequence`.

- `POST /calendar/event.uninvite` `{ sessionId, attendeeId }` (optional)

  - **Option A**: remove from attendees; `sendUpdates=all`.
  - **Option B**: send ICS `METHOD:CANCEL` only to that attendee.

- `POST /calendar/event.cancel` `{ sessionId }`

  - **Option A**: `events.delete?sendUpdates=all`.
  - **Option B**: send ICS `METHOD:CANCEL` with same `UID` to all opted-in attendees.

**Option A – minimal Worker functions**

```ts
// 1) Exchange refresh token → access token
async function getGoogleAccessToken(env: Env): Promise<string> {
  /* ... */
}

// 2) Create event for a session
async function createEvent(env: Env, session: Session): Promise<string> {
  const accessToken = await getGoogleAccessToken(env);
  const body = {
    summary: session.title,
    location: session.venue,
    start: { dateTime: session.startAtUtc, timeZone: session.timezone },
    end: { dateTime: session.endAtUtc, timeZone: session.timezone },
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: true,
    description: `Managed by Your App • Session ${session.id}`,
  };
  // POST /calendars/{CALENDAR_ID}/events?sendUpdates=none
  // return event.id
}

// 3) Add attendee (idempotent)
async function addAttendee(env: Env, gcalEventId: string, email: string) {
  const accessToken = await getGoogleAccessToken(env);
  // GET event → merge attendees → PATCH with ?sendUpdates=all
}
```

**Option B – ICS essentials**

```ts
function toICSDateZ(isoUtc: string) {
  const d = new Date(isoUtc);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(
    d.getUTCDate()
  )}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function buildInviteICS({
  uid,
  summary,
  description,
  location,
  startAtUtc,
  endAtUtc,
  organizerEmail,
  attendeeEmail,
  sequence,
}: {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startAtUtc: string;
  endAtUtc: string;
  organizerEmail: string;
  attendeeEmail: string;
  sequence: number;
}) {
  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//YourApp//Sessions//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`, // stable per (sessionId + attendeeEmail)
    `DTSTAMP:${toICSDateZ(new Date().toISOString())}`,
    `DTSTART:${toICSDateZ(startAtUtc)}`, // UTC Z times
    `DTEND:${toICSDateZ(endAtUtc)}`,
    `SUMMARY:${summary}`,
    location ? `LOCATION:${location}` : "",
    description ? `DESCRIPTION:${description.replace(/\n/g, "\\n")}` : "",
    `ORGANIZER:mailto:${organizerEmail}`,
    `ATTENDEE;CN=${attendeeEmail};PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendeeEmail}`,
    `SEQUENCE:${sequence}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}
```

> For **updates**, resend with `SEQUENCE` incremented.
> For **cancellations**, send a VCALENDAR with `METHOD:CANCEL` and the **same `UID`**.

---

## 6) Timezone Correctness

- **Input**: Organizer picks local date/time; app determines `timezone` (club default or explicit).
- **Storage**: Convert local times → **`startAtUtc`**, **`endAtUtc`** (ISO UTC). Keep `timezone` alongside.
- **Option A**: Send both `dateTime` (UTC string is fine) **and** `timeZone` (IANA TZ). Google will render in that zone and handle DST properly.
- **Option B (ICS)**: Use **UTC** (`Z`) for `DTSTART`/`DTEND`. Calendar clients convert for the attendee’s local zone.

  - This preserves the _moment in time_ accurately. If you must lock to a specific local wall time in a distant future across DST, you can embed `VTIMEZONE`, but UTC is sufficient for most sports sessions.

---

## 7) Idempotency, Retries & Consistency

- `attendees/{id}.invited === true` prevents double-sends.
- Use **stable `UID`** for ICS: `uid = ${sessionId}:${hash(email)}` so updates/cancels match the same calendar item.
- For Google, fetch and **merge** `attendees` to avoid overwrites.
- Mark per-attendee `inviteSequence` for ICS.
- All Worker actions should be **safe to re-run**.

---

## 8) Error Handling & UX

- Worker returns `{ ok: true }` or `{ ok: false, reason }`.
- On failure, keep `invited=false`, store a concise error string.
- Show a small non-blocking toast: “Joined. Calendar invite will be sent based on your settings.”

  - If error: “Invite couldn’t be sent now; you’re still joined.”

- Background **re-try** button (organizer) to re-send invites if needed (calls same endpoint).

---

## 9) Security & Auth

- Require **Firebase ID token** on all endpoints.
- In Worker, **verify** token using Google public keys and check:

  - The caller is the same `uid` when inviting themselves, or
  - The caller has organizer/admin rights for that session/club (optionally read from Firestore).

- Deny if the session is full or closed (optional extra guard).

---

## 10) Step-by-Step Implementation Checklist

### Phase 0 — Decide Delivery Option

- [ ] Choose **Option A (Google)** or **Option B (ICS)** initially (you can add the other later).

### Phase 1 — Data & Settings

- [ ] Add `users/{uid}.calendar.enabled` (toggle) and `users/{uid}.timezone` (optional).
- [ ] Ensure `clubs/{clubId}.defaultTimezone`.
- [ ] Update `sessions/{sessionId}` schema with `venue`, `startAtUtc`, `endAtUtc`, `timezone`, `gcalEventId?`.
- [ ] Create `attendees/{attendeeId}` schema with `email`, `optedIn`, `invited`, etc.
- [ ] Build **Settings UI** for the calendar toggle and email.

### Phase 2 — Worker Skeleton

- [ ] Set up Cloudflare Worker routes:

  - `POST /calendar/event.create`
  - `POST /calendar/event.invite`
  - `POST /calendar/event.update`
  - `POST /calendar/event.uninvite` (optional)
  - `POST /calendar/event.cancel`

- [ ] Implement Firebase ID token verification in Worker.
- [ ] Add Firestore client (Admin credentials via service account JSON or REST + App Check, depending on your setup).

### Phase 3A — Option A (Google Calendar)

- [ ] In Google Cloud Console:

  - [ ] Enable **Google Calendar API**.
  - [ ] Create **OAuth client (Web application)**.
  - [ ] Allow redirect: `https://<your-worker-domain>/oauth/callback`.
  - [ ] Scope: `https://www.googleapis.com/auth/calendar.events`.

- [ ] One-time OAuth:

  - [ ] Create a temporary admin route `/oauth/start` to redirect to Google.
  - [ ] Handle `/oauth/callback` → exchange **code** for **refresh token**.
  - [ ] Store `GCAL_CLIENT_ID`, `GCAL_CLIENT_SECRET`, `GCAL_REFRESH_TOKEN` in Worker secrets.

- [ ] Create or select the app calendar; store `GCAL_CALENDAR_ID`.
- [ ] Implement:

  - [ ] `createEvent()` → `events.insert` with `sendUpdates=none`; store `gcalEventId`.
  - [ ] `addAttendee()` → `events.get` → merge `attendees` → `events.patch?sendUpdates=all`.
  - [ ] `updateEvent()` → patch time/venue with `sendUpdates=all`.
  - [ ] `deleteEvent()` → `events.delete?sendUpdates=all`.

- [ ] Wire client:

  - [ ] After session create → call `/calendar/event.create`.
  - [ ] After attendee join (and optedIn) → call `/calendar/event.invite`.

### Phase 3B — Option B (ICS Email)

- [ ] Pick an email API (Resend/SendGrid/Mailgun) free tier; store API key in Worker secrets.
- [ ] Implement `.ics` builder with `UID`, `DTSTAMP`, `DTSTART/DTEND` (UTC), `SUMMARY`, `LOCATION`, `SEQUENCE`.
- [ ] Implement email send with attachment:

  - `Content-Type: text/calendar; method=REQUEST; name="invite.ics"`

- [ ] On updates:

  - [ ] Increment `SEQUENCE`, resend to opted-in attendees.

- [ ] On cancel:

  - [ ] Send `METHOD:CANCEL` with same `UID`.

### Phase 4 — Timezone Handling

- [ ] On session form submit: convert local picks → `startAtUtc`/`endAtUtc` using `timezone`.
- [ ] Show confirmation in UI with local formatted time for the club’s timezone.
- [ ] Option A: include `timeZone` in `start`/`end` body.
- [ ] Option B: keep UTC in ICS.

### Phase 5 — Idempotency & Errors

- [ ] Mark `attendees/{id}.invited=true` after success.
- [ ] Store last error on failure; allow manual “Retry invites” button for organizers.
- [ ] Ensure Worker operations are safe to repeat.

### Phase 6 — Tests

- [ ] Unit test timezone conversion edge cases (DST boundaries, if any).
- [ ] Create a session, invite a test user; verify:

  - [ ] Venue appears in event.
  - [ ] Time renders correctly for “Asia/Singapore”.
  - [ ] Update time → attendees receive an update.
  - [ ] Cancel → attendees receive cancellation.

- [ ] Test join with opt-out (no invite should be sent).

### Phase 7 — Rollout

- [ ] Feature flag per club or globally.
- [ ] Backfill: for future sessions without `gcalEventId`, run a one-time script to create events.

---

## 11) Example Client Hooks (pseudo-TS)

```ts
// When creating a session
await firestoreSet(`/sessions/${id}`, {
  title,
  venue,
  startAtUtc,
  endAtUtc,
  timezone,
  clubId,
});
await callWorker("/calendar/event.create", { sessionId: id });

// When a user joins
await firestoreSet(`/sessions/${id}/attendees/${attendeeId}`, {
  uid,
  email,
  optedIn: user.calendar.enabled,
  invited: false,
  inviteMethod: resolvedMethod,
  joinedAt: now(),
});
if (user.calendar.enabled) {
  await callWorker("/calendar/event.invite", { sessionId: id, attendeeId });
}
```

---

## 12) Edge Cases & Notes

- **No email**: If a user is opted-in but lacks an email, show a prompt to add one; skip invite until provided.
- **Change of preference**: If a user toggles off after joining, do not auto-remove them (avoid surprises). Offer a “Remove me from invite” action.
- **Organizer edits venue/time**: Make sure the Worker is called after Firestore update, not before.
- **Join duplicates**: Idempotent on the Worker; the Firestore `invited` flag also prevents repeat sends.
- **Per-club calendars** (later): Store `clubs/{clubId}.calendar.gcalCalendarId`, choose per session.

---

## 13) Future Enhancements

- Track RSVP statuses (Google event `attendees[].responseStatus`) and surface in app.
- Add “Add to Apple/Outlook” button with ICS download for opt-out users.
- Per-court subevents (if you schedule by court).
- Batch invites to reduce API calls (for big clubs).

---

### TL;DR Implementation Order

1. Add Firestore fields + Settings UI.
2. Build Worker endpoints + Firebase token verification.
3. Implement **Option A** (Google) or **Option B** (ICS) path.
4. Wire client calls on create/join/update/cancel.
5. Test timezone and venue rendering.
6. Roll out behind a feature flag.

If you tell me which option you’ll start with, I can drop in the exact Worker code for those endpoints next.
