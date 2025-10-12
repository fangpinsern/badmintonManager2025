Awesome idea — this will make your clubs feel “alive” in Telegram. Here’s a compact but concrete plan you can run with, from onboarding to ops, tuned for Next.js + Firebase + Cloudflare Workers.

# What we’re building (at a glance)

- **One shared Telegram Bot** for all clubs (simplest, cheapest), mapped to each club’s group.
- **Seamless onboarding** via a single “Add to Telegram” button in the Club Settings page that:

  1. Adds your bot to the club’s group
  2. Securely links that group to the club (no manual chat ID hunting)

- **Background delivery** via a Cloudflare Worker:

  - Receives events from your webapp (e.g., “session_created”)
  - Sends messages to the linked Telegram group
  - Runs scheduled jobs (monthly summaries, reminders)

- **Club-level controls** in Settings (toggles, timing, templates, test message, pause/unlink)

---

## 1) Onboarding flow (smooth + secure)

**In Club Settings → “Connect Telegram” card**

- Show a single CTA: **Add to Telegram**
- When clicked, open `https://t.me/<YourBot>?startgroup=<oneTimeToken>`

  - Generate `<oneTimeToken>` (e.g., 128-bit random) and store in club doc: `telegram.linkToken` with a short TTL (e.g., 15 min).
  - Also store `telegram.linkState = "pending"`.

**What happens in Telegram**

- The user adds your bot to their group using that link.
- Telegram delivers a `/start <oneTimeToken>` **in the group** (the `startgroup` payload).
- Your **Worker webhook** receives the update:

  - Validates token (exists, not expired, matches clubId).
  - Stores mapping: `club.telegram.chatId = update.message.chat.id`, plus `title`, `username` (if any).
  - Marks `linkState = "linked"`, clears `linkToken`.
  - Replies in-group: “✅ Linked to _<Club Name>_.”

**Why this is painless**

- No “find the chat_id” steps.
- The mapping is cryptographically bound to your generated token so random groups can’t hijack a club.

**Edge cases handled**

- **Group upgraded to supergroup**: Telegram sends `migrate_to_chat_id` — update the stored chatId.
- **Bot removed**: mark `linkState = "disconnected"`, show a warning in Settings.
- **Multiple attempts**: last valid token wins; previous pending tokens are invalidated.

---

## 2) Data model (Firestore — suggested fields)

In `/clubs/{clubId}`:

```ts
telegram: {
  linkState: "unlinked" | "pending" | "linked" | "disconnected",
  chatId?: number,
  groupTitle?: string,
  groupUsername?: string, // if public
  linkToken?: string,     // one-time, short TTL
  tz: string,             // e.g., "Asia/Singapore" (used for schedules)
  enabled: true,          // global on/off switch

  // Feature toggles + templates
  notifications: {
    sessionCreated: { enabled: true, templateId: "default_session_created" },
    reminders: {
      enabled: true,
      schedule: ["-24h", "-2h"], // relative to session start
      templateId: "default_reminder"
    },
    monthlySummary: {
      enabled: true,
      dayOfMonth: 1,  // run on 1st
      hour: 9,        // 09:00 local
      templateId: "default_monthly_summary"
    }
  },

  // Optional role gating inside Telegram (for future inline commands)
  allowCommandsFrom: "adminsOnly" | "anyMember"
}
```

**Templates collection** (global or per-club):

```ts
templates: {
  default_session_created: "🆕 New session: *{{session.title}}* on {{session.start_local}}.\nRegister here: {{session.url}}",
  default_reminder: "⏰ Reminder: {{session.title}} starts {{relative_time}}.\nRegister: {{session.url}}",
  default_monthly_summary: "📊 *{{club.name}}* — {{month_name}} summary\nMatches: {{stats.matches}}\nTop winner: {{stats.topWinner.name}} ({{stats.topWinner.wins}})\nMore: {{stats.url}}"
}
```

Use simple handlebars-like placeholders; render server-side (Next.js or Worker).

---

## 3) Message flow & responsibilities

### Event-driven (session created, reminders)

- **Your webapp (Next.js)**: When a session is created or updated, POST a **minimal event** to the Worker:

  - `type: "session_created"`, `clubId`, `sessionId`

- **Worker**:

  - Loads club’s Telegram mapping + preferences (either query Firestore via your own HTTP API or receive payload-rich event from Next.js).
  - Renders the message from template (or use the payload if you already rendered).
  - Sends via Telegram Bot API (`sendMessage` with `parse_mode=MarkdownV2` or `HTML`).
  - Optional: enqueue to a **Queue** for retry/backoff and per-chat throttling.

> Simpler MVP: Next.js renders the final text + inline keyboard and calls Worker `/telegram/send` with `chatId` + `text` + `replyMarkup`. The Worker is only responsible for safe delivery + retries.

### Scheduled (monthly summary, timed reminders)

- **Cloudflare Cron Triggers** invoke Worker:

  - **Monthly**: iterate clubs where `monthlySummary.enabled`, compute period (previous month), fetch stats from your backend API, render, send.
  - **Reminders**: Two options:

    1. Pre-schedule reminder “jobs” when the session is created (store in Firestore + the Worker polls/executes).
    2. Run a cron every 5–10 minutes to find sessions starting within the next X minutes that need a reminder (simpler to start).

  - Always respect club’s `tz`.

---

## 4) Telegram details (practical notes)

- **Bot setup**: Create once via BotFather; set “Allow Groups: ON”. Consider “Privacy Mode: ON” (safe). You can still send messages without reading all chat messages.
- **Inline keyboards**: Add one-tap buttons:

  - “Register attendance” → `https://your.app/sessions/{id}`
  - Optional “Open Web App” if you adopt Telegram’s Web Apps later.

- **Formatting**: Prefer `parse_mode: "HTML"` to avoid MarkdownV2 escaping hassles.
- **Rate limits & retries**:

  - Queue sends; backoff on 429/5xx; cap per-chat to ~1 msg/s.

- **Unlink & pause**:

  - Club Settings: “Pause notifications”, “Send test message”, “Unlink group”.
  - In group: provide `/status`, `/unlink` (admin-only).

---

## 5) Cloudflare Worker (skeleton)

**Routes**

- `POST /telegram/webhook` — receives updates (linking, commands).
- `POST /events` — app → worker (session_created, etc.).
- `POST /admin/set-webhook` — one-time call to set Telegram webhook (protected).
- Cron — `monthly-summary`, `send-reminders`.

**Minimal send utility**

```js
async function sendTelegram({
  token,
  chatId,
  text,
  replyMarkup,
  parse = "HTML",
}) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: parse,
    disable_web_page_preview: true,
    reply_markup: replyMarkup ? JSON.stringify(replyMarkup) : undefined,
  };
  const res = await fetch(url, {
    method: "POST",
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Telegram error ${res.status}: ${t}`);
  }
  return res.json();
}
```

**Webhook handler (linking via startgroup)**

```js
async function handleWebhook(env, update) {
  // added to group + /start <token>
  const msg = update.message || update.channel_post;
  if (!msg) return;
  const chat = msg.chat; // { id, type: "group" | "supergroup", title, username? }
  const text = msg.text || "";
  const m = text.match(/^\/start\s+([A-Za-z0-9_-]{20,})/);
  if (m) {
    const token = m[1];
    // Call your backend to exchange token → clubId (validate + claim)
    const club = await claimLinkToken(env, token, {
      chatId: chat.id,
      title: chat.title,
      username: chat.username,
    });
    if (club) {
      await sendTelegram({
        token: env.TELEGRAM_BOT_TOKEN,
        chatId: chat.id,
        text: `✅ Linked to <b>${escapeHtml(club.name)}</b>.`,
      });
    }
    return;
  }
  // Handle migrate_to_chat_id if present
  if (msg.migrate_to_chat_id) {
    await updateChatIdForClub(env, chat.id, msg.migrate_to_chat_id);
  }
}
```

**App → Worker event (session_created)**

```js
// POST /events  { type: "session_created", clubId, session:{ id, title, startISO, url } }
async function handleEvent(env, payload) {
  const club = await getClub(env, payload.clubId);
  if (!club?.telegram?.enabled || club.telegram.linkState !== "linked") return;

  if (
    payload.type === "session_created" &&
    club.telegram.notifications.sessionCreated.enabled
  ) {
    const text = renderTemplate("default_session_created", {
      club,
      session: payload.session,
    });
    const replyMarkup = {
      inline_keyboard: [
        [{ text: "Register attendance", url: payload.session.url }],
      ],
    };
    await sendTelegram({
      token: env.TELEGRAM_BOT_TOKEN,
      chatId: club.telegram.chatId,
      text,
      replyMarkup,
    });
  }
}
```

> Store secrets (BOT token, API keys) as **Worker secrets** (not in repo). For Firestore reads, prefer having your Next.js API feed the Worker with the prepared payloads to avoid service-account handling in Workers (MVP-friendly).

---

## 6) Club Settings UI (what to build)

- **Connection section**

  - Status pill: Linked / Pending / Unlinked
  - Button: Add to Telegram (deep link)
  - Test message
  - Pause/Resume, Unlink

- **Notification switches**

  - New session created (toggle)
  - Reminders (toggle + relative times editor)
  - Monthly summary (toggle + day-of-month + hour, timezone display)

- **Templates**

  - Simple editor per template with preview (side-by-side)

- **Audit**

  - Recent sends log (time, type, success/fail, Telegram response if error)

---

## 7) Monthly summary (inputs & output)

- Inputs: your existing stats pipeline (wins/losses, attendance, ELO deltas, match counts).
- Output example (HTML parse mode):

```
📊 <b>{{club.name}}</b> — {{month_name}} summary

Matches: <b>{{stats.matches}}</b>
Players: <b>{{stats.players}}</b>
Top winner: <b>{{stats.topWinner.name}}</b> ({{stats.topWinner.wins}} wins)
Most active: <b>{{stats.mostActive.name}}</b> ({{stats.mostActive.matches}} matches)
↗️ Biggest ELO gain: <b>{{stats.eloUp.name}}</b> (+{{stats.eloUp.delta}})
↘️ Biggest ELO drop: <b>{{stats.eloDown.name}}</b> ({{stats.eloDown.delta}})

More details: {{stats.url}}
```

---

## 8) Reliability & safety

- **Idempotency**: Deduplicate by `(clubId, eventType, sessionId)` in KV for ~1 hour to avoid double-sends.
- **Backoff & retry**: Queue failures, exponential backoff; alert in UI if repeated failures.
- **Permissions**: Only club owners/admins can link/unlink and edit templates.
- **Abuse guard**: Worker validates that app-originating events carry a JWT signed by your Next.js secret; do not accept arbitrary chatIds in the body — always look up by `clubId`.

---

## 9) Fast path MVP vs. V2

- **MVP (1–2 days of work)**

  - Single bot, deep-link linking, session-created + reminder messages, monthly cron, Settings toggles, simple templates, test message.

- **V2**

  - Telegram commands (`/status`, `/next`, `/unlink`), rich summaries, pinned messages, mini “Web App” sheet for quick RSVP, multi-language templates, per-role targeting, digest opt-in per member.

---

## Starter checklist

1. Create bot with BotFather (record token).
2. Add `TELEGRAM_BOT_TOKEN` to Worker secrets.
3. Implement `/telegram/webhook` + `setWebhook`.
4. Add “Add to Telegram” button using `?startgroup=<token>`.
5. Implement token issuance/claim.
6. Implement `/events` endpoint and wire from Next.js on session create/update.
7. Add Cron for monthly + reminder scans.
8. Build Settings UI (toggles, templates, test).

---
