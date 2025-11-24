const WORKER_VERSION = "2025-09-22.1";

// --- Push/aggregation policy ---
const AGG_WINDOW_MS = 1 * 30 * 1000; // aggregate events for 3 min
const MIN_INTERVAL_MS = 1 * 30 * 1000; // no more than 1 push / 2 min per user
const DAILY_MAX = 100; // cap per user per UTC day

export default {
  async fetch(req, env) {
    // Preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    const url = new URL(req.url);
    try {
      console.log("worker.fetch:request", {
        method: req.method,
        path: url.pathname,
        search: url.search,
        origin: req.headers.get("Origin") || "",
        ua: req.headers.get("User-Agent") || "",
      });
    } catch {}

    // ---- New: event ingestion endpoint ----
    // if (req.method === "POST" && url.pathname === "/push/events") {
    //   let body; try { body = await req.json(); } catch {
    //     return withCors(new Response("Bad JSON", { status: 400 }), req);
    //   }
    //   const userId = body?.userId;
    //   const events = Array.isArray(body?.events) ? body.events : [];
    //   const isDemo = body?.isDemo;
    //   if (isDemo) {
    //     console.log("isDemo", userId, events);
    //     return new Response(`is in demo mode ${userId} ${events}`, { status: 200 });
    //   }
    //   if (!userId || !events.length) {
    //     return withCors(new Response("Missing userId/events", { status: 400 }), req);
    //   }

    //   // (Optional) verify client-side auth here if you’ll call this from the app.
    //   // For now, we assume internal calls from this Worker.

    //   const id   = env.MAILBOX.idFromName(userId);
    //   const stub = env.MAILBOX.get(id);
    //   const resp = await stub.fetch("https://do/push/enqueue", {
    //     method: "POST",
    //     headers: { "content-type": "application/json" },
    //     body: JSON.stringify({ userId, events })
    //   });
    //   return withCors(resp, req);
    // }

    // OAuth (Google Calendar) - start authorization to obtain a refresh token (one-time setup)
    if (
      req.method === "GET" &&
      url.pathname === "/oauth/google/calendar/start"
    ) {
      const oauthgate =
        String(env?.ALLOW_OAUTH_CAL || "").toLowerCase() === "true";
      if (!oauthgate) {
        return withCors(
          new Response("OAuth calendar not allowed", { status: 403 }),
          req
        );
      }
      const clientId = String(env?.OAUTH_CLIENT_ID || "").trim();
      const redirectUri = String(env?.OAUTH_REDIRECT_URI || "").trim();
      if (!clientId || !redirectUri) {
        return withCors(
          new Response("Missing OAUTH_CLIENT_ID/OAUTH_REDIRECT_URI", {
            status: 500,
          }),
          req
        );
      }
      const scope = "https://www.googleapis.com/auth/calendar.events";
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("include_granted_scopes", "true");
      authUrl.searchParams.set("scope", scope);
      try {
        console.log("[oauth] start redirect", authUrl.toString());
      } catch {}
      return withCors(
        new Response(null, {
          status: 302,
          headers: { Location: authUrl.toString() },
        }),
        req
      );
    }

    // OAuth (Google Calendar) - callback to exchange code for tokens; prints refresh_token for operator
    if (
      req.method === "GET" &&
      url.pathname === "/oauth/google/calendar/callback"
    ) {
      const oauthgate =
        String(env?.ALLOW_OAUTH_CAL || "").toLowerCase() === "true";
      if (!oauthgate) {
        return withCors(
          new Response("OAuth calendar not allowed", { status: 403 }),
          req
        );
      }
      const code = String(url.searchParams.get("code") || "").trim();
      const clientId = String(env?.OAUTH_CLIENT_ID || "").trim();
      const clientSecret = String(env?.OAUTH_CLIENT_SECRET || "").trim();
      const redirectUri = String(env?.OAUTH_REDIRECT_URI || "").trim();
      if (!code || !clientId || !clientSecret || !redirectUri) {
        return withCors(
          new Response("Missing code or OAuth env", { status: 400 }),
          req
        );
      }
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }),
      });
      const txt = await tokenRes.text();
      if (!tokenRes.ok) {
        try {
          console.log(
            "[oauth] exchange failed",
            tokenRes.status,
            txt.slice(0, 200)
          );
        } catch {}
        return withCors(
          new Response(
            `exchange failed: ${tokenRes.status} ${txt}`.slice(0, 2048),
            { status: 502 }
          ),
          req
        );
      }
      let parsed = {};
      try {
        parsed = JSON.parse(txt);
      } catch {}
      const refreshToken = (parsed && parsed.refresh_token) || "";
      const accessToken = (parsed && parsed.access_token) || "";
      const body = JSON.stringify(
        { refresh_token: refreshToken, access_token: accessToken },
        null,
        2
      );
      try {
        console.log("[oauth] obtained refresh token?", !!refreshToken);
      } catch {}
      return withCors(
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
        req
      );
    }

    // Telegram webhook: bot updates (linking via /start <token> and chat id capture)
    if (req.method === "POST" && url.pathname === "/telegram/webhook") {
      try {
        const update = await req.json();
        console.log("telegram webhook update", update);
        const msg = update.message || update.channel_post;
        console.log("telegram webhook msg", msg);
        if (!msg) return withCors(new Response("ok"), req);
        const chat = msg.chat || {};
        const text = msg.text || "";
        console.log("telegram webhook text", text);
        const re =
          /^\/start(?:@[A-Za-z0-9_]{5,32})?\s+([A-Za-z0-9_-]{10,128})$/;
        const m = text.trim().match(re);
        console.log("telegram webhook match", m);
        if (m) {
          const token = m[1];
          try {
            const result = await claimTelegramLinkToken(env, token, {
              id: chat.id,
              title: chat.title,
              username: chat.username,
            });
            console.log("telegram claim token result", result);
            if (result && env.TELEGRAM_BOT_TOKEN) {
              try {
                const origin = req.headers.get("origin") || "";
                const allowOrigin = ALLOW_ORIGINS.has(origin) ? origin : "";
                const baseApp =
                  allowOrigin || "https://bm25r.codingcrayons.com";
                const clubId = (result && result.id) || "";
                const clubUrl = clubId ? `${baseApp}/clubs/${clubId}` : baseApp;
                const replyMarkup = {
                  inline_keyboard: [[{ text: "View club", url: clubUrl }]],
                };
                await sendTelegram({
                  token: env.TELEGRAM_BOT_TOKEN,
                  chatId: chat.id,
                  text: `✅ Linked to <b>${escapeHtml(
                    result.name || ""
                  )}</b>club.`,
                  replyMarkup,
                  parse: "HTML",
                });
              } catch (e) {
                try {
                  console.log("telegram confirm send error", e);
                } catch {}
              }
            }
          } catch (e) {
            try {
              console.log("claim token error", e);
            } catch {}
          }
        }
        return withCors(new Response("ok"), req);
      } catch (e) {
        try {
          console.log("webhook error", e);
        } catch {}
        return withCors(new Response("bad", { status: 400 }), req);
      }
    }

    // Telegram send: app → worker for test messages or simple deliveries
    if (req.method === "POST" && url.pathname === "/telegram/send") {
      let payload;
      try {
        payload = await req.json();
      } catch {
        return withCors(new Response("Bad JSON", { status: 400 }), req);
      }
      const clubId = payload?.clubId;
      if (!clubId)
        return withCors(new Response("Missing clubId", { status: 400 }), req);
      const token = await getAccessToken(env);
      const { url: baseUrl } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
      const sensitiveCol =
        String(env?.STATS_TEST_MODE || "") === "1" ||
        String(env?.STATS_TEST_MODE || "").toLowerCase() === "true"
          ? "clubSensitive_test"
          : "clubSensitive";
      // Read only from protected sensitive notifications sub-document
      let telegram = {};
      const notiRes = await fetch(
        `${baseUrl}/${sensitiveCol}/${clubId}/sensitive/notifications`,
        {
          headers: { authorization: `Bearer ${token}` },
        }
      );
      if (!notiRes.ok)
        return withCors(
          new Response("club sensitive read failed", { status: 502 }),
          req
        );
      const notiDoc = await notiRes.json();
      const nf = notiDoc.fields || {};
      telegram = jsonFromFields(nf.telegram) || {};
      if (
        !telegram.enabled ||
        telegram.linkState !== "linked" ||
        !telegram.chatId
      ) {
        return withCors(new Response("not linked", { status: 202 }), req);
      }
      const botToken = env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        try {
          console.log("no bot token configured");
        } catch {}
        return withCors(new Response("no bot token", { status: 500 }), req);
      }
      // Optional enforcement/rendering based on type
      const type = String(payload?.type || "").trim();

      if (type === "session_created") {
        // Gate by feature toggle
        const enabledCreated = !!(
          telegram?.notifications?.sessionCreated?.enabled ?? true
        );
        if (!enabledCreated) {
          return withCors(
            new Response("feature disabled", { status: 202 }),
            req
          );
        }
        const organizerUid = String(payload?.organizerUid || "").trim();
        const sessionId = String(payload?.sessionId || "").trim();
        if (!organizerUid || !sessionId) {
          return withCors(
            new Response("Missing organizer/session", { status: 400 }),
            req
          );
        }

        // Read session payload to render message text safely on server
        const userCol =
          String(env?.STATS_TEST_MODE || "").toLowerCase() === "true" ||
          env?.STATS_TEST_MODE === "1"
            ? "users_test"
            : "users";
        const sessionRes = await fetch(
          `${baseUrl}/${userCol}/${organizerUid}/sessions/${sessionId}`,
          { headers: { authorization: `Bearer ${token}` } }
        );
        if (!sessionRes.ok) {
          return withCors(
            new Response("Session read failed", { status: 502 }),
            req
          );
        }
        const sdoc = await sessionRes.json();
        const sfields = sdoc.fields || {};
        const spayload = jsonFromFields(sfields.payload) || {};
        const date = String(spayload.date || "");
        const time = String(spayload.time || "");

        // Read club name for nicer message
        let clubName = "";
        try {
          const clubsCol =
            String(env?.STATS_TEST_MODE || "").toLowerCase() === "true" ||
            env?.STATS_TEST_MODE === "1"
              ? "clubs_test"
              : "clubs";
          const cres = await fetch(`${baseUrl}/${clubsCol}/${clubId}`, {
            headers: { authorization: `Bearer ${token}` },
          });
          if (cres.ok) {
            const cdoc = await cres.json();
            const cf = cdoc.fields || {};
            clubName = String(jsonFromFields(cf.name) || "");
          }
        } catch {}

        const origin = req.headers.get("Origin") || "";
        const allowOrigin = ALLOW_ORIGINS.has(origin)
          ? origin
          : String(env?.APP_BASE_URL || "");
        const baseApp = allowOrigin || "https://bm25r.codingcrayons.com";
        const sessionUrl = `${baseApp}/session/${sessionId}`;

        // Compose header and include initial participants (if any) in original message
        const header = clubName
          ? `🆕 New session for <b>${escapeHtml(
              clubName
            )}</b> on <b>${escapeHtml(date)}</b> at <b>${escapeHtml(
              time
            )}</b>.\nJoin here:`
          : `🆕 New session on <b>${escapeHtml(date)}</b> at <b>${escapeHtml(
              time
            )}</b>.\nJoin here:`;
        const players0 = Array.isArray(spayload.players)
          ? spayload.players
          : [];
        const entries0 = players0
          .map((p) => {
            const uname = (
              p && p.accountUsername ? String(p.accountUsername) : ""
            ).trim();
            const display = (p && (p.accountUsername || p.name || ""))
              .toString()
              .trim();
            const isGuest = !uname;
            return { uname, display, isGuest };
          })
          .filter((e) => !!e.display)
          .slice(0, 100);
        const list0 = entries0
          .map(({ uname, display, isGuest }) => {
            if (!isGuest && uname) {
              const url = `${baseApp}/profile/${encodeURIComponent(uname)}`;
              return `<a href="${escapeHtml(url)}">@${escapeHtml(uname)}</a>`;
            }
            return escapeHtml(display);
          })
          .join("\n");
        // Append venue when available
        const venueName = (
          spayload && spayload.venue && spayload.venue.name
            ? String(spayload.venue.name)
            : ""
        ).trim();
        const headerWithVenue = venueName
          ? `${header}\n\nVenue: <b>${escapeHtml(venueName)}</b>`
          : header;
        const text = entries0.length
          ? `${headerWithVenue}\n\nParticipants (${entries0.length}):\n${list0}`
          : headerWithVenue;
        const replyMarkup = {
          inline_keyboard: [[{ text: "Open session", url: sessionUrl }]],
        };

        try {
          const res = await sendTelegram({
            token: botToken,
            chatId: telegram.chatId,
            text,
            replyMarkup,
            parse: "HTML",
          });
          const mid =
            (res && res.result && res.result.message_id) || res?.message_id;
          const body = mid ? JSON.stringify({ message_id: mid }) : "sent";
          return withCors(
            new Response(body, {
              status: 200,
              headers: mid ? { "content-type": "application/json" } : undefined,
            }),
            req
          );
        } catch (e) {
          try {
            console.log("telegram send failed", e);
          } catch {}
          return withCors(new Response("send failed", { status: 502 }), req);
        }
      }

      if (type === "session_removed") {
        const organizerUid = String(payload?.organizerUid || "").trim();
        const sessionId = String(payload?.sessionId || "").trim();
        if (!organizerUid || !sessionId) {
          return withCors(
            new Response("Missing organizer/session", { status: 400 }),
            req
          );
        }
        // Load session payload to get message id
        const userCol =
          String(env?.STATS_TEST_MODE || "").toLowerCase() === "true" ||
          env?.STATS_TEST_MODE === "1"
            ? "users_test"
            : "users";
        const sRes = await fetch(
          `${baseUrl}/${userCol}/${organizerUid}/sessions/${sessionId}`,
          { headers: { authorization: `Bearer ${token}` } }
        );
        if (!sRes.ok)
          return withCors(
            new Response("Session read failed", { status: 502 }),
            req
          );
        const sdoc = await sRes.json();
        const sfields = sdoc.fields || {};
        const spayload = jsonFromFields(sfields.payload) || {};
        const mid = Number(spayload.telegramMessageId || 0);
        if (!mid)
          return withCors(new Response("no message id", { status: 202 }), req);
        try {
          await editTelegramMessage({
            token: botToken,
            chatId: telegram.chatId,
            messageId: mid,
            text: "Session removed from club",
            replyMarkup: undefined,
            parse: "HTML",
          });
          return withCors(new Response("edited"), req);
        } catch (e) {
          try {
            console.log("telegram remove edit failed", e);
          } catch {}
          return withCors(new Response("edit failed", { status: 502 }), req);
        }
      }

      if (
        type === "session_updated" ||
        type === "session_joined" ||
        type === "session_meta_updated"
      ) {
        // Gate by optional flag under sessionCreated settings
        // const showList = !!(
        //   telegram?.notifications?.sessionCreated?.showParticipantsOnJoin ===
        //   true
        // );
        // if (!showList)
        //   return withCors(new Response("no-op", { status: 202 }), req);

        const organizerUid = String(payload?.organizerUid || "").trim();
        const sessionId = String(payload?.sessionId || "").trim();
        if (!organizerUid || !sessionId)
          return withCors(
            new Response("Missing organizer/session", { status: 400 }),
            req
          );

        // Load session to get message id + participants
        const userCol =
          String(env?.STATS_TEST_MODE || "").toLowerCase() === "true" ||
          env?.STATS_TEST_MODE === "1"
            ? "users_test"
            : "users";
        const sRes = await fetch(
          `${baseUrl}/${userCol}/${organizerUid}/sessions/${sessionId}`,
          { headers: { authorization: `Bearer ${token}` } }
        );
        if (!sRes.ok)
          return withCors(
            new Response("Session read failed", { status: 502 }),
            req
          );
        const sdoc = await sRes.json();
        const sfields = sdoc.fields || {};
        const spayload = jsonFromFields(sfields.payload) || {};
        const date = String(spayload.date || "");
        const time = String(spayload.time || "");
        const players = Array.isArray(spayload.players) ? spayload.players : [];
        const mid = Number(spayload.telegramMessageId || 0);
        if (!mid)
          return withCors(new Response("no message id", { status: 202 }), req);

        // Compose participant list
        let clubName = "";
        try {
          const clubsCol =
            String(env?.STATS_TEST_MODE || "").toLowerCase() === "true" ||
            env?.STATS_TEST_MODE === "1"
              ? "clubs_test"
              : "clubs";
          const cres = await fetch(`${baseUrl}/${clubsCol}/${clubId}`, {
            headers: { authorization: `Bearer ${token}` },
          });
          if (cres.ok) {
            const cdoc = await cres.json();
            const cf = cdoc.fields || {};
            clubName = String(jsonFromFields(cf.name) || "");
          }
        } catch {}

        const origin = req.headers.get("Origin") || "";
        const allowOrigin = ALLOW_ORIGINS.has(origin)
          ? origin
          : String(env?.APP_BASE_URL || "");
        const baseApp = allowOrigin || "https://bm25r.codingcrayons.com";
        const sessionUrl = `${baseApp}/session/${sessionId}`;

        const entries = players
          .map((p) => {
            const uname = (
              p && p.accountUsername ? String(p.accountUsername) : ""
            ).trim();
            const display = (p && (p.accountUsername || p.name || ""))
              .toString()
              .trim();
            const isGuest = !uname;
            return { uname, display, isGuest };
          })
          .filter((e) => !!e.display)
          .slice(0, 100);
        const list = entries
          .map(({ uname, display, isGuest }) => {
            if (!isGuest && uname) {
              const url = `${baseApp}/profile/${encodeURIComponent(uname)}`;
              return `<a href="${escapeHtml(url)}">@${escapeHtml(uname)}</a>`;
            }
            return escapeHtml(display);
          })
          .join("\n");
        const header = clubName
          ? `🆕 New session for <b>${escapeHtml(
              clubName
            )}</b> on <b>${escapeHtml(date)}</b> at <b>${escapeHtml(
              time
            )}</b>.\nJoin here:`
          : `🆕 New session on <b>${escapeHtml(date)}</b> at <b>${escapeHtml(
              time
            )}</b>.\nJoin here:`;
        const venueName = (
          spayload && spayload.venue && spayload.venue.name
            ? String(spayload.venue.name)
            : ""
        ).trim();
        const headerWithVenue = venueName
          ? `${header}\n\nVenue: <b>${escapeHtml(venueName)}</b>`
          : header;
        const body = entries.length
          ? `${headerWithVenue}\n\nParticipants (${entries.length}):\n${list}`
          : headerWithVenue;

        const replyMarkup = {
          inline_keyboard: [[{ text: "Open session", url: sessionUrl }]],
        };

        try {
          const res = await editTelegramMessage({
            token: botToken,
            chatId: telegram.chatId,
            messageId: mid,
            text: body,
            replyMarkup,
            parse: "HTML",
          });
          return withCors(new Response("edited"), req);
        } catch (e) {
          try {
            console.log("telegram edit failed", e);
          } catch {}
          return withCors(new Response("edit failed", { status: 502 }), req);
        }
      }

      // Default: simple test or explicit text send (legacy/test usage)
      const text = payload?.text || "✅ Test message from Badminton Manager";
      const replyMarkup = payload?.replyMarkup || undefined;
      const parse = payload?.parse || "HTML";
      try {
        const res = await sendTelegram({
          token: botToken,
          chatId: telegram.chatId,
          text,
          replyMarkup,
          parse,
        });
        const mid =
          (res && res.result && res.result.message_id) || res?.message_id;
        const body = mid ? JSON.stringify({ message_id: mid }) : "sent";
        return withCors(
          new Response(body, {
            status: 200,
            headers: mid ? { "content-type": "application/json" } : undefined,
          }),
          req
        );
      } catch (e) {
        try {
          console.log("telegram send failed", e);
        } catch {}
        return withCors(new Response("send failed", { status: 502 }), req);
      }
    }

    // Calendar upsert: app → worker to create/update shared calendar event for a session (idempotent)
    if (req.method === "POST" && url.pathname === "/calendar/session-upsert") {
      let payload;
      try {
        payload = await req.json();
      } catch {
        return withCors(new Response("Bad JSON", { status: 400 }), req);
      }
      const organizerUid = String(payload?.organizerUid || "").trim();
      const sessionId = String(payload?.sessionId || "").trim();
      if (!organizerUid || !sessionId) {
        return withCors(
          new Response("Missing organizer/session", { status: 400 }),
          req
        );
      }

      const calendarId = String(env?.CALENDAR_ID || "").trim();
      if (!calendarId) {
        return withCors(
          new Response("Missing CALENDAR_ID", { status: 500 }),
          req
        );
      }

      try {
        console.log("[calendar] upsert request", {
          organizerUid,
          sessionId,
          calendarId,
          tz: String(env?.CALENDAR_TIMEZONE || "Asia/Singapore"),
        });
      } catch {}

      // Read session and build attendees list based on linked users' preferences
      const fsToken = await getAccessTokenScoped(
        env,
        "https://www.googleapis.com/auth/datastore"
      );
      const { url: baseUrl } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
      const userCol =
        String(env?.STATS_TEST_MODE || "").toLowerCase() === "true" ||
        env?.STATS_TEST_MODE === "1"
          ? "users_test"
          : "users";
      const sRes = await fetch(
        `${baseUrl}/${userCol}/${organizerUid}/sessions/${sessionId}`,
        { headers: { authorization: `Bearer ${fsToken}` } }
      );
      if (!sRes.ok) {
        try {
          console.log("[calendar] session read failed", sRes.status);
        } catch {}
        return withCors(
          new Response("Session read failed", { status: 502 }),
          req
        );
      }
      const sdoc = await sRes.json();
      const sfields = sdoc.fields || {};
      const spayload = jsonFromFields(sfields.payload) || {};
      try {
        const dateDbg = String(spayload?.date || "");
        const timeDbg = String(spayload?.time || "");
        const playersDbg = Array.isArray(spayload?.players)
          ? spayload.players.length
          : 0;
        console.log("[calendar] session loaded", {
          date: dateDbg,
          time: timeDbg,
          players: playersDbg,
        });
      } catch {}

      // Collect linked uids from root field when available; otherwise derive from players[].accountUid
      let linkedUids = [];
      try {
        const arr = jsonFromFields(sfields.linkedUids) || [];
        if (Array.isArray(arr))
          linkedUids = arr.filter((x) => typeof x === "string" && x);
      } catch {}
      if (!linkedUids.length) {
        try {
          const players = Array.isArray(spayload?.players)
            ? spayload.players
            : [];
          linkedUids = players
            .map((p) => (p && p.accountUid ? String(p.accountUid) : "").trim())
            .filter(Boolean);
        } catch {}
      }
      try {
        console.log("[calendar] linked uids", {
          count: linkedUids.length,
        });
      } catch {}

      // Load userSensitive for each linked uid and build attendees list
      const userSensitiveCol =
        String(env?.STATS_TEST_MODE || "") === "1" ||
        String(env?.STATS_TEST_MODE || "").toLowerCase() === "true"
          ? "userSensitive_test"
          : "userSensitive";
      const attendees = [];
      const seenEmails = new Set();
      await Promise.all(
        linkedUids.slice(0, 500).map(async (uid) => {
          try {
            const uRes = await fetch(`${baseUrl}/${userSensitiveCol}/${uid}`, {
              headers: { authorization: `Bearer ${fsToken}` },
            });
            if (!uRes.ok) return;
            const udoc = await uRes.json();
            const uf = udoc.fields || {};
            const data = jsonFromFields(uf) || {};
            const enabled = !!(
              data?.notifications?.calendarInvites?.enabled === true
            );
            const email = (data?.email || "").trim();
            if (enabled && email && !seenEmails.has(email.toLowerCase())) {
              seenEmails.add(email.toLowerCase());
              attendees.push({ email });
            }
          } catch {}
        })
      );
      try {
        console.log("[calendar] attendees derived", {
          count: attendees.length,
        });
      } catch {}

      // Build event payload
      const tz = String(env?.CALENDAR_TIMEZONE || "Asia/Singapore");
      const sendUpdates = String(
        env?.CALENDAR_SEND_UPDATES || "none"
      ).toLowerCase(); // 'none' | 'all' | 'externalOnly'
      const allowAttendees =
        String(env?.CALENDAR_ALLOW_ATTENDEES || "true").toLowerCase() ===
        "true";
      const date = String(spayload?.date || "");
      const time = String(spayload?.time || "");
      // Default 2 hours duration if not specified
      const defaultDurationMin = Number(
        env?.CALENDAR_DEFAULT_DURATION_MIN || 120
      );
      // Build RFC3339 local times; pass timeZone separately so Google adjusts
      const startDateTime = date && time ? `${date}T${time}:00` : undefined;
      let endDateTime = undefined;
      if (startDateTime) {
        try {
          const [Y, M, D] = date.split("-").map((x) => Number(x));
          const [h, m] = time.split(":").map((x) => Number(x));
          // Compute end in UTC via Date using tz offset is non-trivial in Workers; approximate by minutes add
          // Since we pass timeZone, Google will interpret local time; we can format end as same pattern
          const endMin = defaultDurationMin;
          const endH = h + Math.floor(endMin / 60);
          const endM = m + (endMin % 60);
          const carryH = Math.floor(endM / 60);
          const finalM = endM % 60;
          const finalH = (endH + carryH) % 24; // naive day wrap
          const pad = (n) => String(n).padStart(2, "0");
          endDateTime = `${date}T${pad(finalH)}:${pad(finalM)}:00`;
        } catch {}
      }

      // Optional: include club name in summary if available
      let clubName = "";
      try {
        const clubId =
          spayload && spayload.clubId ? String(spayload.clubId) : "";
        if (clubId) {
          const clubsCol =
            String(env?.STATS_TEST_MODE || "").toLowerCase() === "true" ||
            env?.STATS_TEST_MODE === "1"
              ? "clubs_test"
              : "clubs";
          const cres = await fetch(`${baseUrl}/${clubsCol}/${clubId}`, {
            headers: { authorization: `Bearer ${fsToken}` },
          });
          if (cres.ok) {
            const cdoc = await cres.json();
            const cf = cdoc.fields || {};
            clubName = String(jsonFromFields(cf.name) || "");
          }
        }
      } catch {}

      const venueName =
        spayload && spayload.venue && spayload.venue.name
          ? String(spayload.venue.name).trim()
          : "";

      const summaryBase = clubName
        ? `Badminton Session - ${clubName}`
        : "Badminton Session";
      const description = "Managed by Badminton Manager";

      // Build deterministic, alphanumeric-only event id: 'sess' + sha256(organizerUid|sessionId)
      async function sha256Hex(input) {
        const buf = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(input)
        );
        return Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }
      const computedId = await sha256Hex(`${organizerUid}|${sessionId}`);
      const eventId = `sess${computedId}`; // letters+digits only
      try {
        console.log("[calendar] computed event id", { eventId });
      } catch {}

      const body = {
        id: eventId,
        summary: summaryBase,
        location: venueName || undefined,
        description,
        start: startDateTime
          ? { dateTime: startDateTime, timeZone: tz }
          : undefined,
        end: endDateTime ? { dateTime: endDateTime, timeZone: tz } : undefined,
        attendees: allowAttendees ? attendees : undefined,
        extendedProperties: {
          private: { sessionId, organizerUid },
        },
      };

      // Idempotent upsert with end-user OAuth access token or refresh-token exchange
      let gToken = "";
      // const bearerHeader = req.headers.get("authorization") || "";
      // const bearerToken = bearerHeader.replace(/^Bearer\s+/i, "").trim();
      // const bodyToken = String(payload?.oauthAccessToken || "").trim();
      // gToken = bodyToken || bearerToken;
      // If only a refresh token is provided via env, exchange it for an access token
      if (!gToken) {
        const rt = String(env?.OAUTH_REFRESH_TOKEN || "").trim();
        const clientId = String(env?.OAUTH_CLIENT_ID || "").trim();
        const clientSecret = String(env?.OAUTH_CLIENT_SECRET || "").trim();
        if (rt && clientId && clientSecret) {
          const tres = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: rt,
              client_id: clientId,
              client_secret: clientSecret,
            }),
          });
          const ttxt = await tres.text();
          if (tres.ok) {
            try {
              gToken = (JSON.parse(ttxt) || {}).access_token || "";
            } catch {}
          } else {
            try {
              console.log(
                "[oauth] refresh failed",
                tres.status,
                ttxt.slice(0, 200)
              );
            } catch {}
          }
        }
      }
      if (!gToken) {
        try {
          console.log("[calendar] missing end-user OAuth token");
        } catch {}
        return withCors(
          new Response("Missing OAuth token", { status: 401 }),
          req
        );
      }
      const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calendarId
      )}/events`;
      let patched = false;
      try {
        try {
          console.log("[calendar] patch attempt", { eventId });
        } catch {}
        const pres = await fetch(
          `${base}/${encodeURIComponent(
            eventId
          )}?sendUpdates=${encodeURIComponent(sendUpdates)}`,
          {
            method: "PATCH",
            headers: {
              authorization: `Bearer ${gToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          }
        );
        if (pres.ok) {
          patched = true;
          const result = await pres.json().catch(() => ({}));
          return withCors(
            new Response(
              JSON.stringify({ status: "patched", id: result?.id || eventId }),
              { status: 200, headers: { "content-type": "application/json" } }
            ),
            req
          );
        }
        if (pres.status !== 404) {
          const txt = await pres.text().catch(() => "");
          try {
            console.log(
              "[calendar] patch failed",
              pres.status,
              txt.slice(0, 200)
            );
          } catch {}
          return withCors(
            new Response(`patch failed: ${pres.status} ${txt}`.slice(0, 2048), {
              status: 502,
            }),
            req
          );
        }
      } catch (e) {}

      if (!patched) {
        try {
          try {
            console.log("[calendar] insert attempt", { eventId });
          } catch {}
          const ires = await fetch(
            `${base}?sendUpdates=${encodeURIComponent(sendUpdates)}`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${gToken}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(body),
            }
          );
          if (!ires.ok) {
            const txt = await ires.text().catch(() => "");
            // Handle race: if event already created elsewhere, fallback to PATCH and treat as success
            if (ires.status === 409) {
              try {
                console.log("[calendar] insert 409, retrying patch", {
                  eventId,
                });
              } catch {}
              const pres2 = await fetch(
                `${base}/${encodeURIComponent(
                  eventId
                )}?sendUpdates=${encodeURIComponent(sendUpdates)}`,
                {
                  method: "PATCH",
                  headers: {
                    authorization: `Bearer ${gToken}`,
                    "content-type": "application/json",
                  },
                  body: JSON.stringify(body),
                }
              );
              if (pres2.ok) {
                const r2 = await pres2.json().catch(() => ({}));
                return withCors(
                  new Response(
                    JSON.stringify({
                      status: "patched_after_409",
                      id: r2?.id || eventId,
                    }),
                    {
                      status: 200,
                      headers: { "content-type": "application/json" },
                    }
                  ),
                  req
                );
              }
              const t2 = await pres2.text().catch(() => "");
              return withCors(
                new Response(
                  `insert 409 but patch failed: ${pres2.status} ${t2}`.slice(
                    0,
                    2048
                  ),
                  { status: 502 }
                ),
                req
              );
            }
            return withCors(
              new Response(
                `insert failed: ${ires.status} ${txt}`.slice(0, 2048),
                { status: 502 }
              ),
              req
            );
          }
          const result = await ires.json().catch(() => ({}));
          try {
            console.log("[calendar] inserted", { id: result?.id || eventId });
          } catch {}
          return withCors(
            new Response(
              JSON.stringify({ status: "inserted", id: result?.id || eventId }),
              { status: 200, headers: { "content-type": "application/json" } }
            ),
            req
          );
        } catch (e) {
          try {
            console.log("[calendar] insert error", e);
          } catch {}
          return withCors(new Response("insert error", { status: 502 }), req);
        }
      }
    }

    if (req.method !== "POST") {
      return withCors(new Response("Method Not Allowed", { status: 405 }), req);
    }

    // Custom weekly reminders: sync configuration from app → DO scheduler
    if (req.method === "POST" && url.pathname === "/telegram/reminders/sync") {
      let payload;
      try {
        payload = await req.json();
      } catch {
        return withCors(new Response("Bad JSON", { status: 400 }), req);
      }
      const clubId = String(payload?.clubId || "").trim();
      if (!clubId)
        return withCors(new Response("Missing clubId", { status: 400 }), req);

      // Read club's sensitive notifications to fetch Telegram + reminder config
      const token = await getAccessToken(env);
      const { url: baseUrl } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
      const sensitiveCol =
        String(env?.STATS_TEST_MODE || "") === "1" ||
        String(env?.STATS_TEST_MODE || "").toLowerCase() === "true"
          ? "clubSensitive_test"
          : "clubSensitive";

      const notiRes = await fetch(
        `${baseUrl}/${sensitiveCol}/${clubId}/sensitive/notifications`,
        {
          headers: { authorization: `Bearer ${token}` },
        }
      );
      if (!notiRes.ok)
        return withCors(
          new Response("club sensitive read failed", { status: 502 }),
          req
        );
      const notiDoc = await notiRes.json();
      const nf = notiDoc.fields || {};
      const telegram = jsonFromFields(nf.telegram) || {};

      const globalEnabled = !!telegram.enabled;
      const linkOk =
        String(telegram?.linkState || "") === "linked" && !!telegram.chatId;
      const tz = String(telegram?.tz || "UTC");
      const cr = telegram?.notifications?.customReminders || {};
      const customEnabled = !!cr.enabled;
      const rawItems = Array.isArray(cr.items) ? cr.items : [];
      const items = rawItems
        .map((r) => ({
          id: String(r?.id || ""),
          name: String(r?.name || ""),
          message: String(r?.message || ""),
          dow: Number(r?.dow),
          hour: Number(r?.hour),
          minute: Number(r?.minute),
          enabled: r?.enabled !== false,
        }))
        .filter(
          (r) =>
            r.id &&
            Number.isFinite(r.dow) &&
            r.dow >= 0 &&
            r.dow <= 6 &&
            Number.isFinite(r.hour) &&
            r.hour >= 0 &&
            r.hour <= 23 &&
            Number.isFinite(r.minute) &&
            r.minute >= 0 &&
            r.minute <= 59
        )
        .slice(0, 5);

      // Configure the DO regardless of link status; DO will schedule only when effective
      try {
        console.log("reminders.sync:state", {
          clubId,
          globalEnabled,
          linkOk,
          tz,
          customEnabled,
          items: items.map((x) => ({
            id: x.id,
            dow: x.dow,
            h: x.hour,
            m: x.minute,
            enabled: x.enabled !== false,
          })),
        });
      } catch {}
      if (!env.REMINDERS) {
        return withCors(
          new Response("reminders DO not bound", { status: 500 }),
          req
        );
      }
      const id = env.REMINDERS.idFromName(clubId);
      const stub = env.REMINDERS.get(id);
      const resp = await stub.fetch("https://do/reminders/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clubId,
          enabled: !!(globalEnabled && customEnabled && linkOk && items.length),
          chatId: telegram.chatId || null,
          timeZone: tz,
          items,
        }),
      });
      try {
        console.log("reminders.sync:do_response", resp.status);
      } catch {}
      return withCors(resp, req);
    }

    // Stats recalculation endpoint (explicit path)
    if (
      req.method === "POST" &&
      (url.pathname === "/stats/recalc" || url.pathname === "/") // keep "/" for backward compatibility
    ) {
      try {
        let body;
        try {
          body = await req.json();
        } catch {
          return withCors(new Response("Bad JSON", { status: 400 }), req);
        }

        const url = new URL(req.url);
        const dryRun = url.searchParams.get("dryRun") === "1" || !!body?.dryRun;
        const isTest =
          url.searchParams.get("test") === "1" ||
          !!body?.test ||
          String(env?.STATS_TEST_MODE || "").toLowerCase() === "true" ||
          env?.STATS_TEST_MODE === "1";

        const organizerUid = body?.organizerUid;
        const sessionId = body?.sessionId;
        if (!organizerUid || !sessionId) {
          return withCors(new Response("Bad Request", { status: 400 }), req);
        }

        const token = await getAccessToken(env);
        const { url: baseUrl } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
        const userCol = isTest ? "users_test" : "users";
        const sessionRes = await fetch(
          `${baseUrl}/${userCol}/${organizerUid}/sessions/${sessionId}`,
          {
            headers: { authorization: `Bearer ${token}` },
          }
        );
        if (!sessionRes.ok) {
          return withCors(
            new Response("Session read failed", { status: 502 }),
            req
          );
        }
        const sessionDoc = await sessionRes.json();

        const payload = sessionDoc?.fields?.payload
          ? jsonFromFields(sessionDoc.fields.payload)
          : {};
        if (!payload?.ended) {
          return withCors(
            new Response(
              JSON.stringify({
                error: "session_not_ended",
                message: "Session has not ended yet.",
              }),
              { status: 400, headers: { "content-type": "application/json" } }
            ),
            req
          );
        }

        const players = Array.isArray(payload.players) ? payload.players : [];
        const gamesAll = Array.isArray(payload.games) ? payload.games : [];
        const games = gamesAll.filter((g) => !g?.voided);
        if (!games.length)
          return withCors(new Response("No games", { status: 200 }), req);

        const { pidToUid, perUser, meanMs } = buildPerUserAggregates(
          players,
          games,
          payload
        );

        // --- Friendship (teammate) pair aggregation for this session ---
        const pairAgg = buildFriendPairAggregates(
          games,
          pidToUid,
          meanMs,
          payload
        );

        // Opponent (head-to-head) pair aggregation (singles & doubles)
        // For doubles, count cross-team pairs (every A vs every B).
        // function canonicalPair(a, b) { return a < b ? [a, b] : [b, a]; }
        const oppAgg = buildOpponentPairAggregates(
          games,
          pidToUid,
          meanMs,
          payload
        );

        // Best-effort: send a new end-of-session message with a concise summary.
        // If original session message exists, reply to it; otherwise send as standalone.
        // This is additive and fully gated; failures are swallowed to avoid altering existing behavior
        try {
          const mid = Number(payload?.telegramMessageId || 0);
          const clubIdForTelegram =
            typeof payload?.clubId === "string" && payload.clubId
              ? String(payload.clubId)
              : "";
          if (clubIdForTelegram) {
            // Read Telegram config from protected sensitive notifications doc
            const sensitiveCol =
              String(env?.STATS_TEST_MODE || "") === "1" ||
              String(env?.STATS_TEST_MODE || "").toLowerCase() === "true"
                ? "clubSensitive_test"
                : "clubSensitive";
            const notiRes = await fetch(
              `${baseUrl}/${sensitiveCol}/${clubIdForTelegram}/sensitive/notifications`,
              { headers: { authorization: `Bearer ${token}` } }
            );
            if (notiRes.ok) {
              const notiDoc = await notiRes.json();
              const nf = notiDoc.fields || {};
              const telegram = jsonFromFields(nf.telegram) || {};
              const linked =
                !!telegram.enabled &&
                String(telegram?.linkState || "") === "linked" &&
                !!telegram.chatId;
              const botToken = env.TELEGRAM_BOT_TOKEN;

              if (linked && botToken) {
                // Build concise, comparable summary body
                const date = String(payload?.date || "");
                const time = String(payload?.time || "");
                const playersAll = Array.isArray(payload?.players)
                  ? payload.players
                  : [];
                const gamesNonVoided = Array.isArray(gamesAll)
                  ? gamesAll.filter((g) => !g?.voided)
                  : [];
                const avgMin = Math.round(
                  (meanMs || meanDurationMs(gamesNonVoided)) / 60000
                );

                const summaryText = composeSessionSummary({
                  date,
                  time,
                  players: playersAll,
                  games: gamesNonVoided,
                  avgMin,
                });

                // Prepend explicit end notice per requirement
                const endNotice =
                  "🔚 Session has ended. You can now check your stats.";

                // Optional payment request section (split equally across all players)
                let paymentSection = "";
                try {
                  const pr = (payload && payload.paymentRequest) || {};
                  const enabled = !!pr.enabled;
                  const courtC = Number(pr.courtCost || 0);
                  const shuttleC = Number(pr.shuttleCost || 0);
                  const totalC =
                    (Number.isFinite(courtC) ? courtC : 0) +
                    (Number.isFinite(shuttleC) ? shuttleC : 0);
                  const nPlayers = Array.isArray(playersAll)
                    ? playersAll.length
                    : 0;
                  if (enabled && totalC > 0 && nPlayers > 0) {
                    const each = totalC / nPlayers;
                    const fmt = (n) =>
                      Number.isFinite(n) ? n.toFixed(2) : String(n || 0);
                    const parts = [];
                    if (Number.isFinite(courtC) && courtC > 0)
                      parts.push(`Court: $${fmt(courtC)}`);
                    if (Number.isFinite(shuttleC) && shuttleC > 0)
                      parts.push(`Shuttle: $${fmt(shuttleC)}`);
                    const breakdown = parts.length ? `${parts.join("\n")}` : "";
                    paymentSection =
                      `\n\n💳 Payment\n` +
                      `${breakdown}\n` +
                      `Total: $${fmt(
                        totalC
                      )}\nPlayers: ${nPlayers}\nEach: $${fmt(each)}`;

                    // Append 'pay to' line:
                    // If a specific recipientPlayerId is provided, use that player;
                    // otherwise fall back to organizer username as before.
                    try {
                      const recipientPidRaw = pr && pr.recipientPlayerId;
                      const recipientPid =
                        typeof recipientPidRaw === "string" &&
                        recipientPidRaw.trim()
                          ? String(recipientPidRaw)
                          : "";
                      let payToLine = "";
                      if (recipientPid) {
                        // Resolve recipient from players list
                        const target = (
                          Array.isArray(playersAll) ? playersAll : []
                        ).find((p) => p && p.id === recipientPid);
                        if (target) {
                          const targetName = String(target.name || "").trim();
                          const targetUid = String(
                            target.accountUid || ""
                          ).trim();
                          let username = "";
                          if (targetUid) {
                            // Try user profile username first
                            try {
                              const ures = await fetch(
                                `${baseUrl}/${userCol}/${targetUid}`,
                                {
                                  headers: { authorization: `Bearer ${token}` },
                                }
                              );
                              if (ures.ok) {
                                const udoc = await ures.json();
                                const uf = udoc.fields || {};
                                const uname = String(
                                  jsonFromFields(uf.username) || ""
                                );
                                if (uname) username = uname;
                              }
                            } catch {}
                            // Fallback to cached accountUsername on player snapshot
                            if (!username) {
                              try {
                                const uname2 = String(
                                  target.accountUsername || ""
                                ).trim();
                                if (uname2) username = uname2;
                              } catch {}
                            }
                          }
                          if (username) {
                            payToLine = `\npay to @${escapeHtml(username)}`;
                          } else if (targetName) {
                            payToLine = `\npay to ${escapeHtml(targetName)}`;
                          }
                        }
                      }
                      if (!payToLine) {
                        // Organizer fallback (previous behavior)
                        let organizerUsername = "";
                        // Preferred: users/{uid}.username
                        try {
                          const ures = await fetch(
                            `${baseUrl}/${userCol}/${organizerUid}`,
                            { headers: { authorization: `Bearer ${token}` } }
                          );
                          if (ures.ok) {
                            const udoc = await ures.json();
                            const uf = udoc.fields || {};
                            const uname = String(
                              jsonFromFields(uf.username) || ""
                            );
                            if (uname) organizerUsername = uname;
                          }
                        } catch {}
                        // Fallback: from session players snapshot
                        if (!organizerUsername) {
                          try {
                            const owner = (
                              Array.isArray(playersAll) ? playersAll : []
                            ).find((p) => p && p.accountUid === organizerUid);
                            const uname2 =
                              (owner && owner.accountUsername) || "";
                            if (uname2) organizerUsername = String(uname2);
                          } catch {}
                        }
                        if (organizerUsername) {
                          payToLine = `\npay to @${escapeHtml(
                            organizerUsername
                          )}`;
                        }
                      }
                      if (payToLine) paymentSection += payToLine;
                    } catch {}
                  }
                } catch {}

                const finalText = `${endNotice}\n\n${summaryText}${paymentSection}`;

                // Keep link to session
                const origin = req.headers.get("Origin") || "";
                const allowOrigin = ALLOW_ORIGINS.has(origin)
                  ? origin
                  : String(env?.APP_BASE_URL || "");
                const baseApp =
                  allowOrigin || "https://bm25r.codingcrayons.com";
                const sessionUrl = `${baseApp}/session/${sessionId}`;
                const replyMarkup = {
                  inline_keyboard: [
                    [{ text: "See session stats", url: sessionUrl }],
                  ],
                };

                try {
                  await sendTelegram({
                    token: botToken,
                    chatId: telegram.chatId,
                    text: finalText,
                    replyMarkup,
                    replyToMessageId:
                      Number.isFinite(mid) && mid > 0 ? mid : undefined,
                    parse: "HTML",
                  });
                } catch (e) {
                  try {
                    console.log("telegram end-summary send failed", e);
                  } catch {}
                }
              }
            }
          }
        } catch (e) {
          try {
            console.log("end-summary block error", e);
          } catch {}
        }

        const uids = Object.keys(perUser);
        if (!uids.length) {
          // No linked players: still record club-level monthly aggregates so that
          // sessionsCount and participationRate (0% when no linked attendees) are tracked.
          const sessionKey = `${organizerUid}_${sessionId}`;
          const endMonth = monthKey(
            payload.endedAt || (games[games.length - 1] || {}).endedAt
          );
          const clubId =
            typeof payload?.clubId === "string" && payload.clubId
              ? String(payload.clubId)
              : "";
          if (clubId) {
            try {
              const clubsCol = isTest ? "clubs_test" : "clubs";
              const members = await fetchClubMembers({
                clubId,
                isTest,
                baseUrl,
                token,
              });
              if (members && members.size) {
                try {
                  const memberCountTotal = members.size;
                  let memberAttendeeCount = 0;
                  const attendeeSet = new Set();
                  for (const p of Array.isArray(players) ? players : []) {
                    const uid = p && p.accountUid ? String(p.accountUid) : "";
                    if (uid && members.has(uid)) {
                      memberAttendeeCount += 1;
                      attendeeSet.add(uid);
                    }
                  }
                  await commitClubMonthlyAggregate({
                    clubsCol,
                    clubId,
                    endMonth,
                    sessionKey,
                    memberCount: memberCountTotal,
                    memberAttendeeCount,
                    env,
                    token,
                  });
                  if (attendeeSet.size) {
                    await commitClubPerUserAttendance({
                      clubsCol,
                      clubId,
                      endMonth,
                      sessionKey,
                      attendeeUids: Array.from(attendeeSet),
                      env,
                      token,
                    });
                  }
                } catch (e) {
                  try {
                    console.log("club-monthly aggregate error", e);
                  } catch {}
                }
              }
            } catch (e) {
              try {
                console.log("club-stats error", e);
              } catch {}
            }
          }
          return withCors(new Response("OK"), req);
        }

        // ----------------------------
        // Elo ratings computation (background)
        // ----------------------------
        const {
          userElo,
          updatedUsers,
          chemistryByEdge,
          updatedPairs,
          allLinkedUids,
        } = await computeEloAndChemistry({
          games,
          pidToUid,
          isTest,
          env,
          baseUrl,
          userCol,
          token,
          payload,
        });

        console.log("uids", uids);
        if (dryRun) {
          const sessionKey = `${organizerUid}_${sessionId}`;
          const endMonth = monthKey(
            payload.endedAt || (games[games.length - 1] || {}).endedAt
          );
          const summary = Object.fromEntries(
            Object.entries(perUser).map(([uid, v]) => [
              uid,
              {
                singles: v.singles,
                doubles: v.doubles,
                totals: v.totals,
                recentCount: v.recent.length,
                recent: v.recent,
              },
            ])
          );
          const pairs = Array.from(pairAgg.values());
          const opp = Array.from(oppAgg.values());
          const eloPreview = Object.fromEntries(
            Array.from(allLinkedUids).map((u) => [u, userElo.get(u)])
          );
          const chemPreview = Object.fromEntries(
            Array.from(chemistryByEdge.entries())
          );
          return withCors(
            new Response(
              JSON.stringify(
                {
                  sessionKey,
                  endMonth,
                  users: summary,
                  pairs,
                  opp,
                  eloPreview,
                  chemPreview,
                },
                null,
                2
              ),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            ),
            req
          );
        }

        const sessionKey = `${organizerUid}_${sessionId}`;
        const endMonth = monthKey(
          payload.endedAt || (games[games.length - 1] || {}).endedAt
        );
        const rootCol = isTest ? "userStats_test" : "userStats";

        // ----------------------------
        // Per-user writes (granular gates; split into two commits per user)
        // ----------------------------
        await commitPerUserStats({
          uids,
          perUser,
          sessionKey,
          endMonth,
          rootCol,
          env,
          token,
        });

        await commitEloWrites({
          updatedUsers,
          userElo,
          userCol,
          organizerUid,
          sessionId,
          env,
          token,
        });

        // ----------------------------
        // Friendship graph + Global index (granular gates; one commit per edge)
        // ----------------------------
        await commitFriendEdgesAndMirrors({
          pairAgg,
          endMonth,
          rootCol,
          isTest,
          sessionKey,
          env,
          token,
          chemistryByEdge,
        });

        // Opponent edges and mirrors
        await commitOpponentEdgesAndMirrors({
          oppAgg,
          endMonth,
          rootCol,
          isTest,
          sessionKey,
          env,
          token,
        });

        // ----------------------------
        // Club-scoped stats (in addition to global)
        // ----------------------------
        const clubId =
          typeof payload?.clubId === "string" && payload.clubId
            ? String(payload.clubId)
            : "";
        if (clubId) {
          try {
            const clubsCol = isTest ? "clubs_test" : "clubs";
            const members = await fetchClubMembers({
              clubId,
              isTest,
              baseUrl,
              token,
            });
            if (members && members.size) {
              // Compute club participation and attendance for this session using current membership snapshot
              try {
                const memberCountTotal = members.size;
                let memberAttendeeCount = 0;
                const attendeeSet = new Set();
                for (const p of Array.isArray(players) ? players : []) {
                  const uid = p && p.accountUid ? String(p.accountUid) : "";
                  if (uid && members.has(uid)) {
                    memberAttendeeCount += 1;
                    attendeeSet.add(uid);
                  }
                }
                await commitClubMonthlyAggregate({
                  clubsCol,
                  clubId,
                  endMonth,
                  sessionKey,
                  memberCount: memberCountTotal,
                  memberAttendeeCount,
                  env,
                  token,
                });
                if (attendeeSet.size) {
                  await commitClubPerUserAttendance({
                    clubsCol,
                    clubId,
                    endMonth,
                    sessionKey,
                    attendeeUids: Array.from(attendeeSet),
                    env,
                    token,
                  });
                }
              } catch (e) {
                try {
                  console.log("club-monthly aggregate error", e);
                } catch {}
              }

              // Per-user writes for club members only
              await commitClubPerUserStats({
                uids,
                perUser,
                memberSet: members,
                clubsCol,
                clubId,
                sessionKey,
                endMonth,
                env,
                token,
              });

              // Club friend edges and mirrors: only if both users are members
              await commitClubFriendEdgesAndMirrors({
                pairAgg,
                memberSet: members,
                clubsCol,
                clubId,
                endMonth,
                sessionKey,
                env,
                token,
                chemistryByEdge,
              });

              // Club opponent edges and mirrors: only if both users are members
              await commitClubOpponentEdgesAndMirrors({
                oppAgg,
                memberSet: members,
                clubsCol,
                clubId,
                endMonth,
                sessionKey,
                env,
                token,
              });
            }
          } catch (e) {
            try {
              console.log("club-stats error", e);
            } catch {}
          }
        }

        await notifyStatsUpdate({ uids, organizerUid, sessionId, env });

        return withCors(new Response("OK"), req);
      } catch (e) {
        console.log("error", e);
        return withCors(
          new Response(`Error: ${e?.message || "Internal Error"}`, {
            status: 500,
          }),
          req
        );
      }
    }

    // If we reached here, POST path is not recognized
    return withCors(new Response("Not Found", { status: 404 }), req);
  },
};

async function sendTelegram({
  token,
  chatId,
  text,
  replyMarkup,
  replyToMessageId,
  parse = "HTML",
}) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const params = new URLSearchParams();
  params.set("chat_id", String(chatId));
  params.set("text", String(text || ""));
  if (parse) params.set("parse_mode", String(parse));
  params.set("disable_web_page_preview", "true");
  if (
    Number.isFinite(Number(replyToMessageId)) &&
    Number(replyToMessageId) > 0
  ) {
    params.set("reply_to_message_id", String(replyToMessageId));
    // Ensure reply works even if the original message is not found (graceful behavior)
    params.set("allow_sending_without_reply", "true");
  }
  if (replyMarkup) {
    try {
      params.set("reply_markup", JSON.stringify(replyMarkup));
    } catch (e) {
      try {
        console.log("sendTelegram reply_markup JSON error", e);
      } catch {}
    }
  }
  const res = await fetch(url, { method: "POST", body: params });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Telegram error ${res.status}: ${t}`);
  }
  return res.json();
}
async function editTelegramMessage({
  token,
  chatId,
  messageId,
  text,
  replyMarkup,
  parse = "HTML",
}) {
  const url = `https://api.telegram.org/bot${token}/editMessageText`;
  const params = new URLSearchParams();
  params.set("chat_id", String(chatId));
  params.set("message_id", String(messageId));
  params.set("text", String(text || ""));
  if (parse) params.set("parse_mode", String(parse));
  params.set("disable_web_page_preview", "true");
  if (replyMarkup) {
    try {
      params.set("reply_markup", JSON.stringify(replyMarkup));
    } catch (e) {
      try {
        console.log("editTelegram reply_markup JSON error", e);
      } catch {}
    }
  }
  const res = await fetch(url, { method: "POST", body: params });
  if (!res.ok) {
    const t = await res.text();
    // If there's no effective change, Telegram returns 400: message is not modified — treat as success/no-op
    if (/message is not modified/i.test(t)) {
      try {
        console.log("telegram edit: no changes, treated as success");
      } catch {}
      return { ok: true, unchanged: true };
    }
    throw new Error(`Telegram edit error ${res.status}: ${t}`);
  }
  return res.json();
}

// ---------- Helpers (unchanged unless noted) ----------

function fsBases(projectId, db) {
  return {
    url: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(
      db
    )}/documents`,
    name: `projects/${projectId}/databases/${db}/documents`,
  };
}

async function getAccessToken(env) {
  const G_AUTH = "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: env.GOOGLE_SA_EMAIL,
    sub: env.GOOGLE_SA_EMAIL,
    aud: G_AUTH,
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore",
  };
  const encHeader = b64urlFromJSON(header);
  const encPayload = b64urlFromJSON(claim);
  const data = `${encHeader}.${encPayload}`;
  const key = await importPkcs8(env.GOOGLE_SA_PRIVATE_KEY, "RSASSA-PKCS1-v1_5");
  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(data)
  );
  const signature = b64urlFromString(
    String.fromCharCode(...new Uint8Array(sigBuf))
  );
  const jwt = `${data}.${signature}`;
  const res = await fetch(G_AUTH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok)
    throw new Error(`token error: ${res.status} ${await res.text()}`);
  const t = await res.json();
  return t.access_token;
}

// Base64url helpers for JWT
function b64urlFromString(s) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlFromJSON(obj) {
  return b64urlFromString(JSON.stringify(obj));
}

function normalizePem(pemMaybeEscaped) {
  const pem = pemMaybeEscaped.replace(/\\n/g, "\n").trim();
  if (/-----BEGIN RSA PRIVATE KEY-----/.test(pem)) {
    throw new Error(
      "Got PKCS#1 (BEGIN RSA PRIVATE KEY). Use PKCS#8 (BEGIN PRIVATE KEY). Convert or rotate key."
    );
  }
  if (!/-----BEGIN PRIVATE KEY-----/.test(pem)) {
    throw new Error(
      "Missing 'BEGIN PRIVATE KEY' header; check the secret value."
    );
  }
  return pem;
}

async function importPkcs8(pem, algName) {
  const keyData = pemToArrayBuffer(normalizePem(pem));
  return crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: algName, hash: "SHA-256" },
    false,
    ["sign"]
  );
}
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

function monthKey(iso) {
  const d = iso ? new Date(iso) : new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function meanDurationMs(games) {
  const durs = games
    .map((g) => (g?.durationMs && g.durationMs > 0 ? g.durationMs : NaN))
    .filter(Number.isFinite);
  if (!durs.length) return 10 * 60 * 1000;
  return durs.reduce((a, b) => a + b, 0) / durs.length;
}
function normalizeDurationMs(d, mean) {
  if (!d || d <= 0) return mean;
  if (d < 0.5 * mean) return mean;
  if (d > 2.0 * mean) return mean;
  return d;
}

// Firestore value <-> JSON helpers (minimal)
function jsonFromFields(f) {
  if (!f || typeof f !== "object") return f;
  if ("stringValue" in f) return f.stringValue;
  if ("integerValue" in f) return Number(f.integerValue);
  if ("doubleValue" in f) return Number(f.doubleValue);
  if ("booleanValue" in f) return !!f.booleanValue;
  if ("timestampValue" in f) return f.timestampValue;
  if ("arrayValue" in f) return (f.arrayValue.values || []).map(jsonFromFields);
  if ("mapValue" in f) {
    const out = {};
    const ent = f.mapValue.fields || {};
    for (const k in ent) out[k] = jsonFromFields(ent[k]);
    return out;
  }
  const out = {};
  for (const k in f) out[k] = jsonFromFields(f[k]);
  return out;
}
function expandTimestamps(obj) {
  if (obj && obj.__ts) return { timestampValue: new Date().toISOString() };
  if (Array.isArray(obj)) return obj.map(expandTimestamps);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const k in obj) out[k] = expandTimestamps(obj[k]);
    return out;
  }
  return obj;
}
function fieldsFromJson(obj) {
  if (obj === null || obj === undefined) return { nullValue: null };
  const t = typeof obj;
  if (t === "string") return { stringValue: obj };
  if (t === "number")
    return Number.isInteger(obj)
      ? { integerValue: String(obj) }
      : { doubleValue: obj };
  if (t === "boolean") return { booleanValue: obj };
  if (Array.isArray(obj))
    return { arrayValue: { values: obj.map(fieldsFromJson) } };
  if (obj && typeof obj === "object") {
    if ("timestampValue" in obj) return obj;
    const fields = {};
    for (const k in obj) {
      const v = obj[k];
      if (v !== undefined) fields[k] = fieldsFromJson(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(obj) };
}

// Field path utilities
function quoteFieldPathSegment(seg) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(seg) ? seg : `\`${seg}\``;
}
function maskPath(p) {
  return p.split(".").map(quoteFieldPathSegment).join(".");
}

// Commit helpers (transform-based, no transactions)
function makeUpdatePrecondCreate(path, data, env) {
  const { name: nameBase } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
  const fields = fieldsFromJson(expandTimestamps(data)).mapValue.fields;
  return {
    update: { name: `${nameBase}/${path}`, fields },
    currentDocument: { exists: false },
  };
}
function makeUpdateMaskWrite(path, data, fieldPaths, env) {
  const { name: nameBase } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
  const fields = fieldsFromJson(expandTimestamps(data)).mapValue.fields;
  return {
    update: { name: `${nameBase}/${path}`, fields },
    updateMask: { fieldPaths },
  };
}
function makeTransformWrite(path, fieldTransforms, env) {
  const { name: nameBase } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
  return { transform: { document: `${nameBase}/${path}`, fieldTransforms } };
}
function inc(fieldPath, n) {
  return { fieldPath, increment: { integerValue: String(n) } };
}
function reqTime(fieldPath) {
  return { fieldPath, setToServerValue: "REQUEST_TIME" };
}
function arrayUnion(fieldPath, jsValues) {
  return {
    fieldPath,
    appendMissingElements: { values: jsValues.map(fieldsFromJson) },
  };
}
async function commitWrites(token, env, writes) {
  const { url: baseUrl } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
  const res = await fetch(`${baseUrl}:commit`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ writes }),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text);
      if (j?.error)
        msg = `${j.error.status || ""} ${j.error.code || ""} — ${
          j.error.message || ""
        }`;
    } catch {}
    throw new Error(`commit failed: ${res.status} ${msg}`);
  }
}
// Groups many Firestore writes into fewer HTTP requests while tolerating idempotent failures.
// Uses documents:batchWrite so one failed write (e.g. gate already exists) doesn't abort the whole batch.
async function batchWriteIgnoreIdempotentErrors(
  token,
  env,
  writes,
  chunkSize = 450
) {
  const { url: baseUrl } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
  for (let i = 0; i < writes.length; i += chunkSize) {
    const chunk = writes.slice(i, i + chunkSize);
    const res = await fetch(`${baseUrl}:batchWrite`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ writes: chunk }),
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = text;
      try {
        const j = JSON.parse(text);
        if (j?.error)
          msg = `${j.error.status || ""} ${j.error.code || ""} — ${
            j.error.message || ""
          }`;
      } catch {}
      // Log and continue to behave like per-write best-effort updates
      console.log(`batchWrite failed: ${res.status} ${msg}`);
      continue;
    }
    try {
      const j = await res.json();
      const statuses = Array.isArray(j?.status) ? j.status : [];
      for (const s of statuses) {
        const code = Number(s?.code || 0);
        if (code !== 0) {
          const msg = String(s?.message || "");
          if (!/ALREADY_EXISTS|FAILED_PRECONDITION/i.test(msg)) {
            console.log("batchWrite non-idempotent error", s);
          }
        }
      }
    } catch (e) {
      // Be tolerant of parsing issues; continue
      console.log("batchWrite parse error", e);
    }
  }
}
async function commitWritesChunked(token, env, writes, chunkSize = 450) {
  for (let i = 0; i < writes.length; i += chunkSize) {
    const chunk = writes.slice(i, i + chunkSize);
    await commitWrites(token, env, chunk);
  }
}
function isAlreadyApplied(e) {
  return /FAILED_PRECONDITION|ALREADY_EXISTS/i.test(String(e?.message || ""));
}

// CORS
const ALLOW_ORIGINS = new Set([
  "http://localhost:3000",
  "https://bm25r.codingcrayons.com",
]);
function corsHeaders(req, { credentials = false } = {}) {
  const origin = req.headers.get("Origin") || "";
  const allowOrigin = ALLOW_ORIGINS.has(origin) ? origin : "";
  const acrh = req.headers.get("Access-Control-Request-Headers") || "";
  const acrm = req.headers.get("Access-Control-Request-Method") || "";
  const h = new Headers();
  if (allowOrigin) h.set("Access-Control-Allow-Origin", allowOrigin);
  if (credentials && allowOrigin)
    h.set("Access-Control-Allow-Credentials", "true");
  h.set("Access-Control-Allow-Methods", acrm || "GET,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers", acrh || "Content-Type, Authorization");
  h.set("Access-Control-Max-Age", "86400");
  h.append("Vary", "Origin");
  h.append("Vary", "Access-Control-Request-Method");
  h.append("Vary", "Access-Control-Request-Headers");
  return h;
}
function withCors(resp, req, opts) {
  const h = new Headers(resp.headers);
  const ch = corsHeaders(req, opts);
  for (const [k, v] of ch) h.set(k, v);
  try {
    const u = new URL(req.url);
    console.log("worker.fetch:response", {
      path: u.pathname,
      search: u.search,
      status: resp.status,
    });
  } catch {}
  return new Response(resp.body, { status: resp.status, headers: h });
}
function escapeHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function claimTelegramLinkToken(env, token, chat) {
  // Direct Firestore edit: find club by telegram.linkToken == token and not expired
  // Then set telegram.chatId/title/username, linkState=linked, clear linkToken
  const access = await getAccessToken(env);
  const { url: baseUrl } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
  const sensitiveCol =
    String(env?.STATS_TEST_MODE || "").toLowerCase() === "true" ||
    env?.STATS_TEST_MODE === "1"
      ? "clubSensitive_test"
      : "clubSensitive";
  try {
    console.log("claim:start", {
      tokenPrefix: String(token || "").slice(0, 8),
      project: env.GCP_PROJECT_ID,
      db: env.FIRESTORE_DB,
    });
  } catch {}
  // Firestore structured query to find by linkToken in sensitive collection only
  const queryEndpoint = `${baseUrl}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: sensitiveCol }],
      where: {
        fieldFilter: {
          field: { fieldPath: "telegram.linkToken" },
          op: "EQUAL",
          value: { stringValue: token },
        },
      },
      limit: 1,
    },
  };
  const res = await fetch(queryEndpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${access}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const arr = await res.json();
  const first = Array.isArray(arr) ? arr.find((x) => x.document) : null;
  const foundDoc = first && first.document ? first.document : null;
  if (!foundDoc) return null;
  const name = foundDoc.name || ""; // full path
  try {
    console.log("claim:doc name", name);
  } catch {}
  // Optional TTL check
  try {
    const f = foundDoc.fields || {};
    const ttlField = f.telegram?.mapValue?.fields?.linkTokenExpiresAt;
    const expiresMs = ttlField
      ? "integerValue" in ttlField
        ? Number(ttlField.integerValue)
        : "doubleValue" in ttlField
        ? Number(ttlField.doubleValue)
        : 0
      : 0;
    try {
      console.log("claim:ttl", { now: Date.now(), expiresMs });
    } catch {}
    if (expiresMs && Date.now() > expiresMs) {
      try {
        console.log("claim:ttl expired", { expiresMs });
      } catch {}
      return null;
    }
  } catch {}
  // Apply update mask: set telegram.chatId/title/username/linkState, clear linkToken
  const fields = {
    telegram: {
      mapValue: {
        fields: {
          chatId: { integerValue: String(chat.id) },
          groupTitle: { stringValue: chat.title || "" },
          groupUsername: chat.username
            ? { stringValue: chat.username }
            : undefined,
          linkState: { stringValue: "linked" },
          linkToken: { nullValue: null },
        },
      },
    },
  };
  // Remove undefined entries
  if (!fields.telegram.mapValue.fields.groupUsername)
    delete fields.telegram.mapValue.fields.groupUsername;
  const updateMask = [
    "telegram.chatId",
    "telegram.groupTitle",
    "telegram.linkState",
    "telegram.linkToken",
  ];
  if (fields.telegram.mapValue.fields.groupUsername)
    updateMask.push("telegram.groupUsername");
  // Write to sensitive collection top-level and notifications sub-doc only
  const notifPath = `${name}/sensitive/notifications`;
  const commitRes = await fetch(`${baseUrl}:commit`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${access}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      writes: [
        { update: { name, fields }, updateMask: { fieldPaths: updateMask } },
        {
          update: { name: notifPath, fields },
          updateMask: { fieldPaths: updateMask },
        },
      ],
    }),
  });
  try {
    console.log("claim:commit status", commitRes.status);
  } catch {}
  if (!commitRes.ok) {
    try {
      console.log("claim commit failed", await commitRes.text());
    } catch {}
    throw new Error("claim commit failed");
  }
  // Return minimal club metadata for confirmation message
  try {
    const f = foundDoc.fields || {};
    let clubName = jsonFromFields(f.name) || "your club";
    let clubId = "";
    // Attempt to read public club document for a better name
    try {
      const parts = String(name || "").split("/");
      clubId = parts[parts.length - 1] || "";
      if (clubId) {
        const clubsCol =
          String(env?.STATS_TEST_MODE || "").toLowerCase() === "true" ||
          env?.STATS_TEST_MODE === "1"
            ? "clubs_test"
            : "clubs";
        const cres = await fetch(`${baseUrl}/${clubsCol}/${clubId}`, {
          headers: { authorization: `Bearer ${access}` },
        });
        if (cres.ok) {
          const cdoc = await cres.json();
          const cf = cdoc.fields || {};
          clubName = String(jsonFromFields(cf.name) || clubName);
        }
      }
    } catch {}
    try {
      console.log("claim:success", { clubName });
    } catch {}
    return { name: clubName, id: clubId };
  } catch {
    return { name: "your club", id: "" };
  }
}

async function enqueueEvent(env, userId, ev) {
  const id = env.MAILBOX.idFromName(userId);
  const stub = env.MAILBOX.get(id);
  console.log("enqueueEvent", userId, ev);
  const res = await stub.fetch("https://do/push/enqueue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, events: [ev] }),
  });
  return res;
}

export class NotificationMailbox {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname.endsWith("/push/enqueue")) {
      const { userId, events } = await req.json();

      if (!userId || !Array.isArray(events) || !events.length)
        return new Response("bad", { status: 400 });

      // Persist the app userId so alarm() can look up FCM tokens correctly
      try {
        const storedUid = await this.state.storage.get("uid");
        if (storedUid !== userId) await this.state.storage.put("uid", userId);
      } catch {}

      // Load existing queue
      const queue = (await this.state.storage.get("q")) || [];
      const seen = new Set(queue.map((e) => e.idempotencyKey));
      for (const e of events) {
        if (!e?.idempotencyKey) continue;
        if (seen.has(e.idempotencyKey)) continue;
        queue.push({
          idempotencyKey: e.idempotencyKey,
          type: e.type || "event",
          title: e.title || "Update",
          url: e.url || "/",
          occurredAt: e.occurredAt || new Date().toISOString(),
        });
      }
      await this.state.storage.put("q", queue);

      // Set alarm if none pending
      const alarmAt = await this.state.storage.get("alarmAt");
      if (!alarmAt) {
        const when = Date.now() + AGG_WINDOW_MS;
        await this.state.storage.setAlarm(when);
        await this.state.storage.put("alarmAt", when);
      }
      return new Response("queued");
    }

    return new Response("not-found", { status: 404 });
  }

  async alarm() {
    // Clear alarm marker
    await this.state.storage.delete("alarmAt");

    let queue = (await this.state.storage.get("q")) || [];
    if (!queue.length) return;

    // Rate limiting state
    let rate = (await this.state.storage.get("rate")) || {
      lastSentAt: 0,
      day: dayKey(),
      count: 0,
    };
    const now = Date.now();
    const today = dayKey();
    if (rate.day !== today) rate = { lastSentAt: 0, day: today, count: 0 };

    // Respect min interval
    const nextAllowed = rate.lastSentAt + MIN_INTERVAL_MS;
    if (now < nextAllowed) {
      const when = nextAllowed; // push alarm forward
      await this.state.storage.setAlarm(when);
      await this.state.storage.put("alarmAt", when);
      return;
    }

    // Respect daily cap
    if (rate.count >= DAILY_MAX) {
      // Defer a digest to midnight UTC
      const when = nextUtcMidnight();
      await this.state.storage.setAlarm(when);
      await this.state.storage.put("alarmAt", when);
      return;
    }

    // Coalesce: dedupe by idempotencyKey and type
    const coalesced = [];
    const seen = new Set();
    for (const e of queue) {
      if (seen.has(e.idempotencyKey)) continue;
      seen.add(e.idempotencyKey);
      coalesced.push(e);
    }

    // Build payload
    let title, body, url;
    if (coalesced.length === 1) {
      title = coalesced[0].title || "Update";
      body = "Tap to view";
      url = coalesced[0].url || "/";
    } else {
      title = "You have updates";
      body = `${coalesced.length} new items • Tap to review`;
      // Route to an inbox page that shows items since the oldest occurredAt
      const since = encodeURIComponent(coalesced[0].occurredAt);
      url = `/inbox?since=${since}`;
    }

    // Fetch user tokens fresh from Firestore (and cacheable if you want)
    const userId = await this.state.storage.get("uid");
    if (!userId) {
      const when = Date.now() + MIN_INTERVAL_MS;
      await this.state.storage.setAlarm(when);
      await this.state.storage.put("alarmAt", when);
      return;
    }
    const fsToken = await getAccessTokenScoped(
      this.env,
      "https://www.googleapis.com/auth/datastore"
    );
    const isTest =
      String(this.env?.STATS_TEST_MODE || "").toLowerCase() === "true" ||
      this.env?.STATS_TEST_MODE === "1";
    const tokens = await listUserFcmTokens(fsToken, this.env, userId, isTest);
    try {
      console.log(
        "[DO alarm] uid=",
        userId,
        "items=",
        coalesced.length,
        "tokens=",
        tokens.length
      );
    } catch {}

    if (tokens.length) {
      const fcmToken = await getAccessTokenScoped(
        this.env,
        "https://www.googleapis.com/auth/firebase.messaging"
      );
      const sendResults = await sendFcmToMany(this.env, fcmToken, tokens, {
        title,
        body,
        url,
      });

      // (Optional) remove invalid tokens from Firestore using fsToken + document paths from sendResults.removable
      // keep minimal for now
      if (!sendResults.anySucceeded) {
        // If nothing delivered, don't lose the queue; retry later
        const when = Date.now() + MIN_INTERVAL_MS;
        await this.state.storage.setAlarm(when);
        await this.state.storage.put("alarmAt", when);
        return;
      }
    }

    // else {
    //   // No devices registered; keep queue and retry later
    //   const when = Date.now() + MIN_INTERVAL_MS;
    //   await this.state.storage.setAlarm(when);
    //   await this.state.storage.put("alarmAt", when);
    //   return;
    // }

    // Success: clear queue & bump rate
    await this.state.storage.put("q", []);
    rate.lastSentAt = Date.now();
    rate.count += 1;
    await this.state.storage.put("rate", rate);

    // If more events arrived during send (race), set a fresh alarm
    const remaining = (await this.state.storage.get("q")) || [];
    if (remaining.length) {
      const when = Date.now() + AGG_WINDOW_MS;
      await this.state.storage.setAlarm(when);
      await this.state.storage.put("alarmAt", when);
    }
  }
}

// Durable Object: per-club weekly reminder scheduler for Telegram
export class ClubReminders {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname.endsWith("/reminders/config")) {
      let body = {};
      try {
        body = await req.json();
      } catch {}
      try {
        console.log("ClubReminders.fetch:config", { body });
      } catch {}
      const clubId = String(body?.clubId || "").trim();
      const enabled = !!body?.enabled;
      const chatId = body?.chatId || null;
      const timeZone = String(body?.timeZone || "UTC");
      const items = Array.isArray(body?.items) ? body.items : [];
      await this.state.storage.put("config", {
        clubId,
        enabled,
        chatId,
        timeZone,
        // Normalize and cap at 5
        items: items
          .map((r) => ({
            id: String(r?.id || ""),
            name: String(r?.name || ""),
            message: String(r?.message || ""),
            dow: Number(r?.dow),
            hour: Number(r?.hour),
            minute: Number(r?.minute),
            enabled: r?.enabled !== false,
          }))
          .filter(
            (r) =>
              r.id &&
              Number.isFinite(r.dow) &&
              r.dow >= 0 &&
              r.dow <= 6 &&
              Number.isFinite(r.hour) &&
              r.hour >= 0 &&
              r.hour <= 23 &&
              Number.isFinite(r.minute) &&
              r.minute >= 0 &&
              r.minute <= 59
          )
          .slice(0, 5),
      });
      // Schedule next alarm
      try {
        console.log("ClubReminders.config:stored", {
          clubId,
          enabled,
          chatId,
          timeZone,
          count: items.length,
        });
      } catch {}
      await this.scheduleNext();
      return new Response("ok");
    }
    return new Response("not-found", { status: 404 });
  }

  async alarm() {
    // On alarm, send messages due in the minute window, then schedule next
    try {
      console.log("ClubReminders.alarm:triggered");
    } catch {}
    const cfg = (await this.state.storage.get("config")) || {};
    const enabled = !!cfg.enabled;
    const chatId = cfg.chatId;
    const timeZone = cfg.timeZone || "UTC";
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    if (!enabled || !chatId || !items.length) {
      try {
        console.log("ClubReminders.alarm:skip", {
          enabled,
          chatId: !!chatId,
          count: items.length,
        });
      } catch {}
      return; // nothing to do
    }
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window
    for (const r of items) {
      if (!r.enabled) continue;
      const nextTs = nextOccurrenceTs(
        timeZone,
        r.dow,
        r.hour,
        r.minute,
        now - windowMs
      );
      // If next occurrence falls within [now-window, now+window), consider it due
      if (nextTs >= now - windowMs && nextTs <= now + windowMs) {
        try {
          // Use Telegram bot token from env; send html-safe message
          const token = this.env.TELEGRAM_BOT_TOKEN;
          if (!token) continue;
          const formatted = formatReminderMessage(
            r.message || r.name || "Reminder",
            timeZone
          );
          const text = escapeHtml(formatted);
          await sendTelegram({ token, chatId, text, parse: "HTML" });
          try {
            console.log("ClubReminders.alarm:sent", {
              id: r.id,
              dow: r.dow,
              h: r.hour,
              m: r.minute,
            });
          } catch {}
        } catch (e) {
          try {
            console.log("ClubReminders.alarm:error", e?.message || e);
          } catch {}
        }
      }
    }
    await this.scheduleNext();
  }

  async scheduleNext() {
    const cfg = (await this.state.storage.get("config")) || {};
    const enabled = !!cfg.enabled;
    const chatId = cfg.chatId;
    const timeZone = cfg.timeZone || "UTC";
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    // Clear any existing alarm marker
    await this.state.storage.delete("alarmAt");
    if (!enabled || !chatId || !items.length) {
      try {
        console.log("ClubReminders.scheduleNext:skip", {
          enabled,
          chatId: !!chatId,
          count: items.length,
        });
      } catch {}
      return;
    }
    const now = Date.now();
    let earliest = Infinity;
    for (const r of items) {
      if (!r.enabled) continue;
      const ts = nextOccurrenceTs(timeZone, r.dow, r.hour, r.minute, now);
      if (ts < earliest) earliest = ts;
    }
    if (!Number.isFinite(earliest)) return;
    // If earliest is in the past for any reason (clock/tz mismatch), schedule a minimal delay
    const when = earliest > now ? earliest : now + 60 * 1000;
    await this.state.storage.setAlarm(when);
    await this.state.storage.put("alarmAt", when);
    try {
      console.log("ClubReminders.scheduleNext:set", { when });
    } catch {}
  }
}

// Compute next occurrence in ms for a weekly schedule in a given IANA time zone
function nextOccurrenceTs(timeZone, dow, hour, minute, fromMs) {
  const now = new Date(fromMs);
  const nowDow = tzWeekdayIndexOf(now, timeZone);
  const initialAdd = (dow - nowDow + 7) % 7;

  function ymdAfterDays(days) {
    const d2 = new Date(fromMs + days * 24 * 60 * 60 * 1000);
    const p = tzParts(d2, timeZone);
    return [p.year, p.month - 1, p.day];
  }

  let addDays = initialAdd;
  let [y, m, d] = ymdAfterDays(addDays);
  let ts = localTimeToUtcTs(timeZone, y, m, d, hour, minute);
  if (ts <= fromMs) {
    addDays = addDays === 0 ? 7 : addDays + 7;
    [y, m, d] = ymdAfterDays(addDays);
    ts = localTimeToUtcTs(timeZone, y, m, d, hour, minute);
  }
  return ts;
}

// Create a Date that represents local time in timeZone at y-m-d hh:mm
function zonedDate(timeZone, year, monthIdx, day, hour, minute) {
  // Deprecated in favor of localTimeToUtcTs; kept for backward-compat only
  const ts = localTimeToUtcTs(timeZone, year, monthIdx, day, hour, minute);
  return new Date(ts);
}

function tzOffsetAt(timeZone, date) {
  // Compute offset minutes for provided date/timeZone
  const str = date.toLocaleString("en-US", { timeZone });
  const local = new Date(str);
  return (date.getTime() - local.getTime()) / (60 * 1000);
}

// ---- Timezone helpers (robust) ----
function tzParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const obj = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    year: Number(obj.year),
    month: Number(obj.month),
    day: Number(obj.day),
    hour: Number(obj.hour),
    minute: Number(obj.minute),
    weekday: String(obj.weekday || ""),
  };
}

function tzWeekdayIndexOf(date, timeZone) {
  const w = tzParts(date, timeZone).weekday.toLowerCase();
  if (w.startsWith("sun")) return 0;
  if (w.startsWith("mon")) return 1;
  if (w.startsWith("tue")) return 2;
  if (w.startsWith("wed")) return 3;
  if (w.startsWith("thu")) return 4;
  if (w.startsWith("fri")) return 5;
  if (w.startsWith("sat")) return 6;
  return new Date(date).getUTCDay();
}

function daysBetweenUTC(y1, m1, d1, y2, m2, d2) {
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function localTimeToUtcTs(timeZone, year, monthIdx, day, hour, minute) {
  // Iteratively adjust a UTC timestamp so that, when viewed in timeZone,
  // it matches the desired local Y-M-D HH:mm.
  let ts = Date.UTC(year, monthIdx, day, hour, minute, 0);
  for (let i = 0; i < 4; i++) {
    const p = tzParts(new Date(ts), timeZone);
    const dayDelta = daysBetweenUTC(
      p.year,
      p.month,
      p.day,
      year,
      monthIdx + 1,
      day
    );
    const minutesDelta =
      p.hour * 60 + p.minute - (hour * 60 + minute) + dayDelta * 1440;
    if (minutesDelta === 0) break;
    ts -= minutesDelta * 60 * 1000;
  }
  return ts;
}

// Simple token formatter for reminder messages
// Supports {date} as YYYY-MM-DD in the reminder's timezone
// Also supports offsets: {date+Nd} / {date-Nd} (days), {date+Nw} / {date-Nw} (weeks)
function formatReminderMessage(template, timeZone) {
  try {
    const d = new Date();
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(d).map((p) => [p.type, p.value])
    );
    const yyyy = parts.year;
    const mm = parts.month;
    const dd = parts.day;
    const dateStr = `${yyyy}-${mm}-${dd}`;

    // Replace offset tokens first, then the base {date}
    let out = String(template || "");
    out = out.replace(/\{date([+-]\d+)([dw])\}/g, (_m, numStr, unit) => {
      const n = parseInt(numStr, 10);
      if (!Number.isFinite(n)) return _m;
      const days = unit === "w" ? n * 7 : n; // 'd' for days, 'w' for weeks
      const d2 = new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
      const parts2 = Object.fromEntries(
        fmt.formatToParts(d2).map((p) => [p.type, p.value])
      );
      const yyyy2 = parts2.year;
      const mm2 = parts2.month;
      const dd2 = parts2.day;
      return `${yyyy2}-${mm2}-${dd2}`;
    });
    out = out.replace(/\{date\}/g, dateStr);
    return out;
  } catch {
    return String(template || "");
  }
}

// Compose a concise and comparable end-of-session summary for Telegram
// Includes everyone in the session (not just linked accounts), similar to computeSessionStats
function composeSessionSummary({ date, time, players, games, avgMin }) {
  try {
    const nonVoided = Array.isArray(games)
      ? games.filter((g) => !g?.voided)
      : [];
    const playerCount = Array.isArray(players) ? players.length : 0;

    // Build player label map by player id for consistency with UI labels
    const pidToLabel = new Map();
    for (const p of Array.isArray(players) ? players : []) {
      const display = (p?.accountUsername || p?.name || "").toString().trim();
      const uname = (p?.accountUsername || "").toString().trim();
      const label = uname ? `@${uname}` : display;
      if (p?.id && label) pidToLabel.set(String(p.id), label);
    }

    let singles = 0,
      doubles = 0;
    let sumGameDurationsMin = 0;

    const playCount = new Map(); // pid -> games played
    const winsCount = new Map(); // pid -> wins

    for (const g of nonVoided) {
      const a = Array.isArray(g?.sideA) ? g.sideA : [];
      const b = Array.isArray(g?.sideB) ? g.sideB : [];
      if (a.length === 1 && b.length === 1) singles += 1;
      else doubles += 1;

      const durMs = Number(g?.durationMs || 0) > 0 ? Number(g.durationMs) : NaN;
      const durMin = Number.isFinite(durMs) ? Math.round(durMs / 60000) : NaN;
      if (Number.isFinite(durMin)) sumGameDurationsMin += durMin;

      const winner = g?.winner;
      const winners = winner === "A" ? a : winner === "B" ? b : [];
      for (const pid of [...a, ...b])
        playCount.set(pid, (playCount.get(pid) || 0) + 1);
      for (const pid of winners)
        winsCount.set(pid, (winsCount.get(pid) || 0) + 1);
    }

    const totalGames = nonVoided.length;
    const avgMinFinal = totalGames
      ? Math.round(sumGameDurationsMin / totalGames)
      : Math.max(1, Number.isFinite(avgMin) ? avgMin : 10);

    const header =
      date && time
        ? `✅ Session Summary — <b>${escapeHtml(date)}</b> at <b>${escapeHtml(
            time
          )}</b>`
        : `✅ Session Summary`;

    const line1 = `Games: ${totalGames} • Players: ${playerCount} • Avg: ${avgMinFinal}m`;
    const line2 = `Singles: ${singles} • Doubles: ${doubles}`;

    let line3 = "";
    // Most active
    let mostActive = null;
    for (const [pid, cnt] of playCount.entries()) {
      if (!mostActive || cnt > mostActive.count)
        mostActive = { pid, count: cnt };
    }
    if (mostActive) {
      const name = escapeHtml(
        pidToLabel.get(String(mostActive.pid)) || "Player"
      );
      line3 = `Most active: ${name} (${mostActive.count})`;
    }

    // Best win rate (≥3 games)
    let best = null;
    for (const [pid, cnt] of playCount.entries()) {
      if (cnt < 3) continue;
      const w = winsCount.get(pid) || 0;
      const rate = cnt > 0 ? Math.round((w * 100) / cnt) : 0;
      if (!best || rate > best.rate) best = { pid, rate, games: cnt };
    }
    let line4 = "";
    if (best) {
      const name = escapeHtml(pidToLabel.get(String(best.pid)) || "Player");
      line4 = `Best win rate (≥3): ${name} (${best.rate}%)`;
    }

    const parts = [header, line1, line2];
    if (line3) parts.push(line3);
    if (line4) parts.push(line4);
    return parts.join("\n");
  } catch {
    // Fallback minimal body to avoid failures
    return `✅ Session Summary`;
  }
}

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}
function nextUtcMidnight() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return +d;
}

async function listUserFcmTokens(accessToken, env, uid, isTest) {
  const { url: baseUrl } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
  const col = isTest ? "usersNoti_test" : "usersNoti";
  const res = await fetch(`${baseUrl}/${col}/${uid}/devices`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const j = await res.json();
  const docs = Array.isArray(j.documents) ? j.documents : [];
  const tokens = [];
  for (const d of docs) {
    const f = d.fields || {};
    const token = jsonFromFields(f.token);
    const pwa = !!jsonFromFields(f.installedPwa);
    if (token && pwa !== false) tokens.push(token); // keep all; optionally require pwa===true
  }
  return tokens;
}

async function getAccessTokenScoped(env, scope) {
  const G_AUTH = "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: env.GOOGLE_SA_EMAIL,
    sub: env.GOOGLE_SA_EMAIL,
    aud: G_AUTH,
    iat: now,
    exp: now + 3600,
    scope,
  };
  const encHeader = b64urlFromJSON(header);
  const encPayload = b64urlFromJSON(claim);
  const data = `${encHeader}.${encPayload}`;
  const key = await importPkcs8(env.GOOGLE_SA_PRIVATE_KEY, "RSASSA-PKCS1-v1_5");
  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(data)
  );
  const signature = b64urlFromString(
    String.fromCharCode(...new Uint8Array(sigBuf))
  );
  const jwt = `${data}.${signature}`;
  const res = await fetch(G_AUTH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok)
    throw new Error(`token error: ${res.status} ${await res.text()}`);
  const t = await res.json();
  return t.access_token;
}

async function sendFcmToMany(
  env,
  oauthAccessToken,
  tokens,
  { title, body, url }
) {
  const endpoint = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`;
  let anySucceeded = false;
  const removable = [];

  for (const token of tokens) {
    const payload = {
      message: {
        token,
        notification: { title, body },
        data: url ? { url } : undefined,
      },
    };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${oauthAccessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      anySucceeded = true;
      continue;
    }

    // Try to detect "bad token" to allow cleanup later (optional)
    const txt = await res.text();
    if (
      /UNREGISTERED|NotRegistered|invalid-argument|registration token|requested entity was not found/i.test(
        txt
      )
    ) {
      removable.push(token);
    }
  }
  return { anySucceeded, removable };
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

// -------------------- Extracted helpers (behavior-preserving) --------------------

function buildPerUserAggregates(players, games, payload) {
  const pidToUid = new Map();
  for (const p of players) {
    if (p?.id && p?.accountUid) pidToUid.set(p.id, p.accountUid);
  }

  const ensure = (map, uid) => {
    if (!map[uid]) {
      map[uid] = {
        singles: { games: 0, wins: 0, durationMin: 0 },
        doubles: { games: 0, wins: 0, durationMin: 0 },
        totals: { games: 0, wins: 0, durationMin: 0 },
        recent: [],
      };
    }
    return map[uid];
  };

  const meanMs = meanDurationMs(games);
  const perUser = {};

  for (const g of games) {
    const a = Array.isArray(g.sideA) ? g.sideA : [];
    const b = Array.isArray(g.sideB) ? g.sideB : [];
    const mode = a.length === 1 && b.length === 1 ? "singles" : "doubles";
    const durMs = normalizeDurationMs(g.durationMs, meanMs);
    const durMin = Math.round(durMs / 60000);
    const endedAt = g.endedAt || payload.endedAt || new Date().toISOString();
    const winner = g.winner;
    const winners =
      winner === "A" ? new Set(a) : winner === "B" ? new Set(b) : new Set();

    for (const pid of [...a, ...b]) {
      const uid = pidToUid.get(pid);
      if (!uid) continue; // only linked accounts

      const agg = ensure(perUser, uid);
      const bucket = agg[mode];

      bucket.games += 1;
      agg.totals.games += 1;

      if (winner !== "draw") {
        if (winners.has(pid)) {
          bucket.wins += 1;
          agg.totals.wins += 1;
          agg.recent.push({ endedAt, result: "W", mode });
        } else {
          agg.recent.push({ endedAt, result: "L", mode });
        }
      }

      bucket.durationMin += durMin;
      agg.totals.durationMin += durMin;
    }
  }

  return { pidToUid, perUser, meanMs };
}

function buildFriendPairAggregates(games, pidToUid, meanMs, payload) {
  function canonicalPair(a, b) {
    return a < b ? [a, b] : [b, a];
  }
  function combos2(arr) {
    const out = [];
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) out.push([arr[i], arr[j]]);
    return out;
  }
  const pairAgg = new Map();

  for (const g of games) {
    const rawA = Array.isArray(g.sideA) ? g.sideA.length : 0;
    const rawB = Array.isArray(g.sideB) ? g.sideB.length : 0;
    if (rawA < 2 && rawB < 2) continue;

    const teamA = (Array.isArray(g.sideA) ? g.sideA : [])
      .map((pid) => pidToUid.get(pid))
      .filter(Boolean);
    const teamB = (Array.isArray(g.sideB) ? g.sideB : [])
      .map((pid) => pidToUid.get(pid))
      .filter(Boolean);
    if (teamA.length < 2 && teamB.length < 2) continue;

    const durMin = Math.round(
      normalizeDurationMs(g.durationMs, meanMs) / 60000
    );
    const endedAt = g.endedAt || payload.endedAt || new Date().toISOString();
    const winnerTeam = g.winner === "A" ? "A" : g.winner === "B" ? "B" : null;

    const tallySide = (sideKey, linkedTeam) => {
      if (linkedTeam.length < 2) return;
      for (const [ua, ub] of combos2(linkedTeam)) {
        const [u1, u2] = canonicalPair(ua, ub);
        const key = `${u1}__${u2}`;
        const agg = pairAgg.get(key) || {
          u1,
          u2,
          games: 0,
          wins: 0,
          durationMin: 0,
          lastEndedAt: "",
        };
        agg.games += 1;
        if (winnerTeam && winnerTeam === sideKey) agg.wins += 1;
        agg.durationMin += durMin;
        if (!agg.lastEndedAt || endedAt > agg.lastEndedAt)
          agg.lastEndedAt = endedAt;
        pairAgg.set(key, agg);
      }
    };

    tallySide("A", teamA);
    tallySide("B", teamB);
  }

  return pairAgg;
}

function buildOpponentPairAggregates(games, pidToUid, meanMs, payload) {
  function canonicalPair(a, b) {
    return a < b ? [a, b] : [b, a];
  }
  const oppAgg = new Map();

  for (const g of games) {
    // Decide mode from RAW sides (before filtering to linked accounts).
    const rawA = Array.isArray(g.sideA) ? g.sideA.length : 0;
    const rawB = Array.isArray(g.sideB) ? g.sideB.length : 0;

    const mode =
      g.mode === "singles" || g.mode === "doubles"
        ? g.mode
        : rawA === 1 && rawB === 1
        ? "singles"
        : "doubles";

    const sideA = (Array.isArray(g.sideA) ? g.sideA : [])
      .map((pid) => pidToUid.get(pid))
      .filter(Boolean);
    const sideB = (Array.isArray(g.sideB) ? g.sideB : [])
      .map((pid) => pidToUid.get(pid))
      .filter(Boolean);
    if (!sideA.length || !sideB.length) continue;

    const durMin = Math.round(
      normalizeDurationMs(g.durationMs, meanMs) / 60000
    );
    const endedAt = g.endedAt || payload.endedAt || new Date().toISOString();
    const winnerIdx = g.winner === "A" ? 0 : g.winner === "B" ? 1 : -1;

    for (const ua of sideA) {
      for (const ub of sideB) {
        const [u1, u2] = canonicalPair(ua, ub);
        const key = `${u1}__${u2}`;
        const cur = oppAgg.get(key) || {
          u1,
          u2,
          singles: { games: 0, winsU1: 0, winsU2: 0, durationMin: 0 },
          doubles: { games: 0, winsU1: 0, winsU2: 0, durationMin: 0 },
          totals: { games: 0, winsU1: 0, winsU2: 0, durationMin: 0 },
          lastEndedAt: "",
        };
        const bucket = cur[mode];

        bucket.games += 1;
        bucket.durationMin += durMin;
        cur.totals.games += 1;
        cur.totals.durationMin += durMin;

        if (winnerIdx !== -1) {
          const winnerIsA = winnerIdx === 0;
          const winnerUid = winnerIsA ? ua : ub;
          const winnerIsU1 = winnerUid === u1;
          if (winnerIsU1) {
            bucket.winsU1 += 1;
            cur.totals.winsU1 += 1;
          } else {
            bucket.winsU2 += 1;
            cur.totals.winsU2 += 1;
          }
        }

        if (!cur.lastEndedAt || endedAt > cur.lastEndedAt)
          cur.lastEndedAt = endedAt;
        oppAgg.set(key, cur);
      }
    }
  }

  return oppAgg;
}

async function computeEloAndChemistry({
  games,
  pidToUid,
  isTest,
  env,
  baseUrl,
  userCol,
  token,
  payload,
}) {
  const allLinkedUids = new Set();
  for (const g of games) {
    const aU = (Array.isArray(g.sideA) ? g.sideA : [])
      .map((pid) => pidToUid.get(pid))
      .filter(Boolean);
    const bU = (Array.isArray(g.sideB) ? g.sideB : [])
      .map((pid) => pidToUid.get(pid))
      .filter(Boolean);
    aU.forEach((u) => allLinkedUids.add(u));
    bU.forEach((u) => allLinkedUids.add(u));
  }

  const userElo = new Map();
  {
    const readPromises = Array.from(allLinkedUids).map(async (uid) => {
      try {
        const res = await fetch(`${baseUrl}/${userCol}/${uid}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(String(res.status));
        const doc = await res.json();
        const f = doc.fields || {};
        const elo = jsonFromFields(f.elo) || {};
        const singles = elo.singles || { R: 1500, K: 32, matches: 0 };
        const doubles = elo.doubles || { R: 1500, K: 32, matches: 0 };
        userElo.set(uid, {
          singles: {
            R: Number(singles.R ?? 1500),
            K: Number(singles.K ?? 32),
            matches: Number(singles.matches ?? 0),
          },
          doubles: {
            R: Number(doubles.R ?? 1500),
            K: Number(doubles.K ?? 32),
            matches: Number(doubles.matches ?? 0),
          },
        });
      } catch (e) {
        try {
          console.log("readUserElo error", uid, e);
        } catch {}
        userElo.set(uid, {
          singles: { R: 1500, K: 32, matches: 0 },
          doubles: { R: 1500, K: 32, matches: 0 },
        });
      }
    });
    await Promise.all(readPromises);
  }

  const friendEdgeColName = isTest ? "friendEdges_test" : "friendEdges";
  const chemistryByEdge = new Map();
  async function getChem(edgeKey) {
    if (chemistryByEdge.has(edgeKey)) return chemistryByEdge.get(edgeKey);
    try {
      const res = await fetch(`${baseUrl}/${friendEdgeColName}/${edgeKey}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      const doc = await res.json();
      const f = doc.fields || {};
      const chem = jsonFromFields(f.chemistry) || {};
      const last = jsonFromFields(f.lastPlayedAt) || "";
      const row = {
        delta: Number(chem.delta ?? 0),
        lastPlayedAt: String(last || ""),
      };
      chemistryByEdge.set(edgeKey, row);
      return row;
    } catch (e) {
      try {
        console.log("getChem error", edgeKey, e);
      } catch {}
      const row = { delta: 0, lastPlayedAt: "" };
      chemistryByEdge.set(edgeKey, row);
      return row;
    }
  }

  const updatedUsers = new Set();
  const updatedPairs = new Set();
  for (const g of games) {
    const rawA = Array.isArray(g.sideA) ? g.sideA.length : 0;
    const rawB = Array.isArray(g.sideB) ? g.sideB.length : 0;
    const mode = rawA === 1 && rawB === 1 ? "singles" : "doubles";

    const sideA = (Array.isArray(g.sideA) ? g.sideA : [])
      .map((pid) => pidToUid.get(pid))
      .filter(Boolean);
    const sideB = (Array.isArray(g.sideB) ? g.sideB : [])
      .map((pid) => pidToUid.get(pid))
      .filter(Boolean);
    const linkedCount = sideA.length + sideB.length;
    const teamALinked = sideA.length > 0;
    const teamBLinked = sideB.length > 0;
    if (!teamALinked && !teamBLinked) continue;

    let wTrust;
    if (teamALinked && teamBLinked && linkedCount === 4) wTrust = 1.0;
    else if (teamALinked && teamBLinked) wTrust = 0.75;
    else if (linkedCount === 1) wTrust = 0.25;
    else wTrust = 0;
    if (wTrust === 0) continue;

    const SA = g.winner === "A" ? 1 : g.winner === "B" ? 0 : 0.5;
    const pointsA = Number.isFinite(Number(g.scoreA))
      ? Number(g.scoreA)
      : undefined;
    const pointsB = Number.isFinite(Number(g.scoreB))
      ? Number(g.scoreB)
      : undefined;
    const fMov =
      Number.isFinite(pointsA) && Number.isFinite(pointsB)
        ? Math.min(1.2, Math.log(1 + Math.abs(pointsA - pointsB) / 8))
        : 1.0;

    function sumRatings(uids, ladder) {
      let sum = 0;
      for (const u of uids) sum += (userElo.get(u) || {})[ladder]?.R ?? 1500;
      return sum;
    }
    function pairKey(u1, u2) {
      return u1 < u2 ? `${u1}__${u2}` : `${u2}__${u1}`;
    }

    let TA = 0,
      TB = 0;
    if (mode === "singles") {
      TA = sumRatings(sideA, "singles");
      TB = sumRatings(sideB, "singles");
    } else {
      TA = sumRatings(sideA, "doubles");
      TB = sumRatings(sideB, "doubles");
      if (sideA.length >= 2) {
        const [ua, ub] = sideA.slice(0, 2);
        const ek = pairKey(ua, ub);
        const chem = await getChem(ek);
        TA += chem.delta || 0;
      } else if (sideA.length === 1) {
        TA += 1500;
      }
      if (sideB.length >= 2) {
        const [va, vb] = sideB.slice(0, 2);
        const ek = pairKey(va, vb);
        const chem = await getChem(ek);
        TB += chem.delta || 0;
      } else if (sideB.length === 1) {
        TB += 1500;
      }
    }

    if (teamALinked && !teamBLinked) TB = mode === "singles" ? 1500 : 3000;
    if (teamBLinked && !teamALinked) TA = mode === "singles" ? 1500 : 3000;

    const EA = 1 / (1 + Math.pow(10, (TB - TA) / 400));
    const eventWeight = 1.0;

    function avgK(uids, ladder) {
      if (!uids.length) return 32;
      let sum = 0,
        n = 0;
      for (const u of uids) {
        const pr = (userElo.get(u) || {})[ladder];
        if (pr) {
          sum += pr.K || 32;
          n++;
        }
      }
      return n ? sum / n : 32;
    }
    const K_A = avgK(sideA, mode);
    const K_B = avgK(sideB, mode);
    const K_eff = (K_A + K_B) / 2;

    const delta = K_eff * wTrust * eventWeight * fMov * (SA - EA);

    function applyDelta(uids, ladder, sgn) {
      for (const u of uids) {
        const pr = (userElo.get(u) || {})[ladder];
        if (!pr) continue;
        pr.R += sgn * delta;
        pr.matches = (pr.matches || 0) + 1;
        if (pr.matches >= 20) pr.K = 20;
        userElo.set(u, { ...userElo.get(u), [ladder]: pr });
        updatedUsers.add(u);
      }
    }
    if (teamALinked) applyDelta(sideA, mode, +1);
    if (teamBLinked) applyDelta(sideB, mode, -1);

    if (mode === "doubles") {
      const endedAt = g.endedAt || payload.endedAt || new Date().toISOString();
      const residualA = SA - EA;
      const residualB = -residualA;
      async function updChem(uids, residual) {
        if (uids.length < 2) return;
        const [x, y] = uids.slice(0, 2).sort();
        const ek = `${x}__${y}`;
        const cur = await getChem(ek);
        const months = monthsSince(cur.lastPlayedAt, endedAt) || 0;
        const decay = 1 - 0.01 * months;
        const next = Math.max(
          -70,
          Math.min(
            70,
            (isFinite(decay) ? decay : 1) * (cur.delta || 0) + 6 * residual
          )
        );
        chemistryByEdge.set(ek, { delta: next, lastPlayedAt: endedAt });
        updatedPairs.add(ek);
      }
      if (sideA.length >= 2) await updChem(sideA, residualA);
      if (sideB.length >= 2) await updChem(sideB, residualB);
    }
  }

  return {
    userElo,
    updatedUsers,
    chemistryByEdge,
    updatedPairs,
    allLinkedUids,
  };
}

async function commitPerUserStats({
  uids,
  perUser,
  sessionKey,
  endMonth,
  rootCol,
  env,
  token,
}) {
  const gateWrites = [];
  const writes = [];
  for (const uid of uids) {
    const agg = perUser[uid];
    const monthPath = `${rootCol}/${uid}/monthly/${endMonth}`;
    const sumPath = `${rootCol}/${uid}`;

    const monthlyTaskKey = `stats:monthly:${endMonth}:${uid}:${sessionKey}`;
    gateWrites.push(
      makeUpdatePrecondCreate(
        `${rootCol}/${uid}/gates/${monthlyTaskKey}`,
        {
          taskKey: monthlyTaskKey,
          sessionKey,
          scope: { uid, month: endMonth },
          workerVersion: WORKER_VERSION,
          createdAt: { __ts: true },
        },
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        monthPath,
        { month: endMonth, appliedSessions: { [sessionKey]: true } },
        ["month", maskPath(`appliedSessions.${sessionKey}`)],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        monthPath,
        [
          inc("singles.games", agg.singles.games),
          inc("singles.wins", agg.singles.wins),
          inc("singles.durationMin", agg.singles.durationMin),
          inc("doubles.games", agg.doubles.games),
          inc("doubles.wins", agg.doubles.wins),
          inc("doubles.durationMin", agg.doubles.durationMin),
          inc("totals.games", agg.totals.games),
          inc("totals.wins", agg.totals.wins),
          inc("totals.durationMin", agg.totals.durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );

    const summaryTaskKey = `stats:summary:${uid}:${sessionKey}`;
    gateWrites.push(
      makeUpdatePrecondCreate(
        `${rootCol}/${uid}/gates/${summaryTaskKey}`,
        {
          taskKey: summaryTaskKey,
          sessionKey,
          scope: { uid },
          workerVersion: WORKER_VERSION,
          createdAt: { __ts: true },
        },
        env
      )
    );
    writes.push(makeUpdateMaskWrite(sumPath, { uid }, ["uid"], env));
    writes.push(
      makeTransformWrite(
        sumPath,
        [
          inc("totals.games", agg.totals.games),
          inc("totals.wins", agg.totals.wins),
          inc("totals.durationMin", agg.totals.durationMin),
          inc("totals.singles.games", agg.singles.games),
          inc("totals.singles.wins", agg.singles.wins),
          inc("totals.singles.durationMin", agg.singles.durationMin),
          inc("totals.doubles.games", agg.doubles.games),
          inc("totals.doubles.wins", agg.doubles.wins),
          inc("totals.doubles.durationMin", agg.doubles.durationMin),
          arrayUnion("recentForm", agg.recent.slice().reverse()),
          reqTime("updatedAt"),
        ],
        env
      )
    );
  }
  if (gateWrites.length)
    await batchWriteIgnoreIdempotentErrors(token, env, gateWrites);
  if (writes.length) await commitWritesChunked(token, env, writes);
}

async function commitEloWrites({
  updatedUsers,
  userElo,
  userCol,
  organizerUid,
  sessionId,
  env,
  token,
}) {
  const gateWrites = [];
  const writes = [];
  for (const uid of updatedUsers) {
    const pr = userElo.get(uid);
    if (!pr) continue;
    const eloTaskKey = `elo:session:${organizerUid}_${sessionId}`;
    gateWrites.push(
      makeUpdatePrecondCreate(
        `${userCol}/${uid}/gates/${eloTaskKey}`,
        {
          taskKey: eloTaskKey,
          sessionKey: `${organizerUid}_${sessionId}`,
          scope: { uid },
          workerVersion: WORKER_VERSION,
          createdAt: { __ts: true },
        },
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        `${userCol}/${uid}`,
        {
          elo: {
            singles: pr.singles,
            doubles: pr.doubles,
            updatedAt: { __ts: true },
          },
        },
        ["elo"],
        env
      )
    );
  }
  if (gateWrites.length)
    await batchWriteIgnoreIdempotentErrors(token, env, gateWrites);
  if (writes.length) await commitWritesChunked(token, env, writes);
}

async function commitFriendEdgesAndMirrors({
  pairAgg,
  endMonth,
  rootCol,
  isTest,
  sessionKey,
  env,
  token,
  chemistryByEdge,
}) {
  const friendEdgeCol = isTest ? "friendEdges_test" : "friendEdges";
  const gateWrites = [];
  const writes = [];
  for (const [edgeKey, agg] of pairAgg) {
    const { u1, u2, games, wins, durationMin, lastEndedAt } = agg;
    gateWrites.push(
      makeUpdatePrecondCreate(
        `${friendEdgeCol}/${edgeKey}/bySession/${sessionKey}`,
        { sessionKey, month: endMonth, createdAt: { __ts: true } },
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        `${friendEdgeCol}/${edgeKey}`,
        {
          edgeKey,
          participants: [u1, u2],
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["edgeKey", "participants", "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        `${friendEdgeCol}/${edgeKey}`,
        [
          inc("together.games", games),
          inc("together.wins", wins),
          inc("together.durationMin", durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
    if (chemistryByEdge.has(edgeKey)) {
      const chem = chemistryByEdge.get(edgeKey);
      writes.push(
        makeUpdateMaskWrite(
          `${friendEdgeCol}/${edgeKey}`,
          {
            chemistry: {
              delta: Number(chem.delta || 0),
              updatedAt: { __ts: true },
            },
          },
          ["chemistry"],
          env
        )
      );
    }
    writes.push(
      makeUpdateMaskWrite(
        `${friendEdgeCol}/${edgeKey}/monthly/${endMonth}`,
        {
          month: endMonth,
          appliedSessions: { [sessionKey]: true },
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["month", maskPath(`appliedSessions.${sessionKey}`), "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        `${friendEdgeCol}/${edgeKey}/monthly/${endMonth}`,
        [
          inc("together.games", games),
          inc("together.wins", wins),
          inc("together.durationMin", durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        `${rootCol}/${u1}/friends/${u2}`,
        {
          otherUid: u2,
          edgeKey,
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["otherUid", "edgeKey", "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        `${rootCol}/${u2}/friends/${u1}`,
        {
          otherUid: u1,
          edgeKey,
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["otherUid", "edgeKey", "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        `${rootCol}/${u1}/friends/${u2}`,
        [
          inc("together.games", games),
          inc("together.wins", wins),
          inc("together.durationMin", durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        `${rootCol}/${u2}/friends/${u1}`,
        [
          inc("together.games", games),
          inc("together.wins", wins),
          inc("together.durationMin", durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
  }
  if (gateWrites.length)
    await batchWriteIgnoreIdempotentErrors(token, env, gateWrites);
  if (writes.length) await commitWritesChunked(token, env, writes);
}

async function commitOpponentEdgesAndMirrors({
  oppAgg,
  endMonth,
  rootCol,
  isTest,
  sessionKey,
  env,
  token,
}) {
  const opponentEdgeCol = isTest ? "opponentEdges_test" : "opponentEdges";
  const gateWrites = [];
  const writes = [];
  for (const [pairKey, agg] of oppAgg) {
    const { u1, u2, singles, doubles, totals, lastEndedAt } = agg;
    gateWrites.push(
      makeUpdatePrecondCreate(
        `${opponentEdgeCol}/${pairKey}/bySession/${sessionKey}`,
        { sessionKey, month: endMonth, createdAt: { __ts: true } },
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        `${opponentEdgeCol}/${pairKey}`,
        {
          edgeKey: pairKey,
          participants: [u1, u2],
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["edgeKey", "participants", "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        `${opponentEdgeCol}/${pairKey}`,
        [
          inc("head.singles.games", singles.games),
          inc("head.singles.winsU1", singles.winsU1),
          inc("head.singles.winsU2", singles.winsU2),
          inc("head.singles.durationMin", singles.durationMin),
          inc("head.doubles.games", doubles.games),
          inc("head.doubles.winsU1", doubles.winsU1),
          inc("head.doubles.winsU2", doubles.winsU2),
          inc("head.doubles.durationMin", doubles.durationMin),
          inc("head.totals.games", totals.games),
          inc("head.totals.winsU1", totals.winsU1),
          inc("head.totals.winsU2", totals.winsU2),
          inc("head.totals.durationMin", totals.durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        `${opponentEdgeCol}/${pairKey}/monthly/${endMonth}`,
        {
          month: endMonth,
          lastPlayedAt: { timestampValue: lastEndedAt },
          appliedSessions: { [sessionKey]: true },
        },
        ["month", "lastPlayedAt", maskPath(`appliedSessions.${sessionKey}`)],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        `${opponentEdgeCol}/${pairKey}/monthly/${endMonth}`,
        [
          inc("head.singles.games", singles.games),
          inc("head.singles.winsU1", singles.winsU1),
          inc("head.singles.winsU2", singles.winsU2),
          inc("head.singles.durationMin", singles.durationMin),
          inc("head.doubles.games", doubles.games),
          inc("head.doubles.winsU1", doubles.winsU1),
          inc("head.doubles.winsU2", doubles.winsU2),
          inc("head.doubles.durationMin", doubles.durationMin),
          inc("head.totals.games", totals.games),
          inc("head.totals.winsU1", totals.winsU1),
          inc("head.totals.winsU2", totals.winsU2),
          inc("head.totals.durationMin", totals.durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        `${rootCol}/${u1}/opponents/${u2}`,
        {
          otherUid: u2,
          edgeKey: pairKey,
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["otherUid", "edgeKey", "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        `${rootCol}/${u1}/opponents/${u2}`,
        [
          inc("against.singles.games", singles.games),
          inc("against.singles.wins", singles.winsU1),
          inc("against.singles.losses", singles.winsU2),
          inc("against.singles.durationMin", singles.durationMin),
          inc("against.doubles.games", doubles.games),
          inc("against.doubles.wins", doubles.winsU1),
          inc("against.doubles.losses", doubles.winsU2),
          inc("against.doubles.durationMin", doubles.durationMin),
          inc("against.totals.games", totals.games),
          inc("against.totals.wins", totals.winsU1),
          inc("against.totals.losses", totals.winsU2),
          inc("against.totals.durationMin", totals.durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        `${rootCol}/${u2}/opponents/${u1}`,
        {
          otherUid: u1,
          edgeKey: pairKey,
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["otherUid", "edgeKey", "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        `${rootCol}/${u2}/opponents/${u1}`,
        [
          inc("against.singles.games", singles.games),
          inc("against.singles.wins", singles.winsU2),
          inc("against.singles.losses", singles.winsU1),
          inc("against.singles.durationMin", singles.durationMin),
          inc("against.doubles.games", doubles.games),
          inc("against.doubles.wins", doubles.winsU2),
          inc("against.doubles.losses", doubles.winsU1),
          inc("against.doubles.durationMin", doubles.durationMin),
          inc("against.totals.games", totals.games),
          inc("against.totals.wins", totals.winsU2),
          inc("against.totals.losses", totals.winsU1),
          inc("against.totals.durationMin", totals.durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
  }
  if (gateWrites.length)
    await batchWriteIgnoreIdempotentErrors(token, env, gateWrites);
  if (writes.length) await commitWritesChunked(token, env, writes);
}

async function notifyStatsUpdate({ uids, organizerUid, sessionId, env }) {
  console.log("notifying uids", uids);
  for (const uid of uids) {
    const ev = {
      idempotencyKey: `stats:${organizerUid}:${sessionId}:${uid}`,
      type: "stats_update",
      title: "Session Ended. View your stats now",
      url: `/session/${sessionId}?u=${uid}`,
      occurredAt: new Date().toISOString(),
    };
    try {
      const res = await enqueueEvent(env, uid, ev);
      console.log("enqueueEvent res", res);
    } catch (e) {
      console.log("enqueueEvent error", e);
    }
  }
}

// -------------------- Club-scoped helpers --------------------

async function fetchClubMembers({ clubId, isTest, baseUrl, token }) {
  try {
    const clubsCol = isTest ? "clubs_test" : "clubs";
    const res = await fetch(`${baseUrl}/${clubsCol}/${clubId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(String(res.status));
    const doc = await res.json();
    const f = doc.fields || {};
    const memberUids = jsonFromFields(f.memberUids) || [];
    const set = new Set();
    for (const u of Array.isArray(memberUids) ? memberUids : []) {
      if (typeof u === "string" && u) set.add(u);
    }
    return set;
  } catch (e) {
    try {
      console.log("fetchClubMembers error", clubId, e);
    } catch {}
    return new Set();
  }
}

async function commitClubPerUserStats({
  uids,
  perUser,
  memberSet,
  clubsCol,
  clubId,
  sessionKey,
  endMonth,
  env,
  token,
}) {
  const gateWrites = [];
  const writes = [];
  for (const uid of uids) {
    if (!memberSet.has(uid)) continue;
    const agg = perUser[uid];
    const basePath = `${clubsCol}/${clubId}/userStats/${uid}`;
    const monthPath = `${basePath}/monthly/${endMonth}`;

    const monthlyTaskKey = `stats:monthly:${endMonth}:${uid}:${sessionKey}`;
    gateWrites.push(
      makeUpdatePrecondCreate(
        `${basePath}/gates/${monthlyTaskKey}`,
        {
          taskKey: monthlyTaskKey,
          sessionKey,
          scope: { uid, month: endMonth, clubId },
          workerVersion: WORKER_VERSION,
          createdAt: { __ts: true },
        },
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        monthPath,
        { month: endMonth, appliedSessions: { [sessionKey]: true } },
        ["month", maskPath(`appliedSessions.${sessionKey}`)],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        monthPath,
        [
          inc("singles.games", agg.singles.games),
          inc("singles.wins", agg.singles.wins),
          inc("singles.durationMin", agg.singles.durationMin),
          inc("doubles.games", agg.doubles.games),
          inc("doubles.wins", agg.doubles.wins),
          inc("doubles.durationMin", agg.doubles.durationMin),
          inc("totals.games", agg.totals.games),
          inc("totals.wins", agg.totals.wins),
          inc("totals.durationMin", agg.totals.durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );

    const summaryTaskKey = `stats:summary:${uid}:${sessionKey}`;
    gateWrites.push(
      makeUpdatePrecondCreate(
        `${basePath}/gates/${summaryTaskKey}`,
        {
          taskKey: summaryTaskKey,
          sessionKey,
          scope: { uid, clubId },
          workerVersion: WORKER_VERSION,
          createdAt: { __ts: true },
        },
        env
      )
    );
    // ensure summary doc exists (uid, clubId fields)
    writes.push(
      makeUpdateMaskWrite(basePath, { uid, clubId }, ["uid", "clubId"], env)
    );
    // increment summary counters & append recent slice (club summary uses top-level singles/doubles)
    writes.push(
      makeTransformWrite(
        basePath,
        [
          inc("totals.games", agg.totals.games),
          inc("totals.wins", agg.totals.wins),
          inc("totals.durationMin", agg.totals.durationMin),
          inc("singles.games", agg.singles.games),
          inc("singles.wins", agg.singles.wins),
          inc("singles.durationMin", agg.singles.durationMin),
          inc("doubles.games", agg.doubles.games),
          inc("doubles.wins", agg.doubles.wins),
          inc("doubles.durationMin", agg.doubles.durationMin),
          arrayUnion("recentForm", agg.recent.slice().reverse()),
          reqTime("updatedAt"),
        ],
        env
      )
    );
  }
  if (gateWrites.length)
    await batchWriteIgnoreIdempotentErrors(token, env, gateWrites);
  if (writes.length) await commitWritesChunked(token, env, writes);
}

async function commitClubFriendEdgesAndMirrors({
  pairAgg,
  memberSet,
  clubsCol,
  clubId,
  endMonth,
  sessionKey,
  env,
  token,
  chemistryByEdge,
}) {
  const gateWrites = [];
  const writes = [];
  for (const [edgeKey, agg] of pairAgg) {
    const { u1, u2, games, wins, durationMin, lastEndedAt } = agg;
    if (!memberSet.has(u1) || !memberSet.has(u2)) continue;

    const edgePath = `${clubsCol}/${clubId}/friendEdges/${edgeKey}`;
    gateWrites.push(
      makeUpdatePrecondCreate(
        `${edgePath}/bySession/${sessionKey}`,
        { sessionKey, month: endMonth, createdAt: { __ts: true } },
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        edgePath,
        {
          edgeKey,
          participants: [u1, u2],
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["edgeKey", "participants", "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        edgePath,
        [
          inc("together.games", games),
          inc("together.wins", wins),
          inc("together.durationMin", durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
    if (chemistryByEdge && chemistryByEdge.has(edgeKey)) {
      const chem = chemistryByEdge.get(edgeKey);
      writes.push(
        makeUpdateMaskWrite(
          edgePath,
          {
            chemistry: {
              delta: Number(chem.delta || 0),
              updatedAt: { __ts: true },
            },
          },
          ["chemistry"],
          env
        )
      );
    }
    const monthlyPath = `${edgePath}/monthly/${endMonth}`;
    writes.push(
      makeUpdateMaskWrite(
        monthlyPath,
        {
          month: endMonth,
          appliedSessions: { [sessionKey]: true },
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["month", maskPath(`appliedSessions.${sessionKey}`), "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        monthlyPath,
        [
          inc("together.games", games),
          inc("together.wins", wins),
          inc("together.durationMin", durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );

    // Per-user mirrors under club scope
    const mirrorA = `${clubsCol}/${clubId}/userStats/${u1}/friends/${u2}`;
    const mirrorB = `${clubsCol}/${clubId}/userStats/${u2}/friends/${u1}`;
    writes.push(
      makeUpdateMaskWrite(
        mirrorA,
        {
          otherUid: u2,
          edgeKey,
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["otherUid", "edgeKey", "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        mirrorB,
        {
          otherUid: u1,
          edgeKey,
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["otherUid", "edgeKey", "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        mirrorA,
        [
          inc("together.games", games),
          inc("together.wins", wins),
          inc("together.durationMin", durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        mirrorB,
        [
          inc("together.games", games),
          inc("together.wins", wins),
          inc("together.durationMin", durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
  }
  if (gateWrites.length)
    await batchWriteIgnoreIdempotentErrors(token, env, gateWrites);
  if (writes.length) await commitWritesChunked(token, env, writes);
}

async function commitClubOpponentEdgesAndMirrors({
  oppAgg,
  memberSet,
  clubsCol,
  clubId,
  endMonth,
  sessionKey,
  env,
  token,
}) {
  const gateWrites = [];
  const writes = [];
  for (const [pairKey, agg] of oppAgg) {
    const { u1, u2, singles, doubles, totals, lastEndedAt } = agg;
    if (!memberSet.has(u1) || !memberSet.has(u2)) continue;

    const edgePath = `${clubsCol}/${clubId}/opponentEdges/${pairKey}`;
    gateWrites.push(
      makeUpdatePrecondCreate(
        `${edgePath}/bySession/${sessionKey}`,
        { sessionKey, month: endMonth, createdAt: { __ts: true } },
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        edgePath,
        {
          edgeKey: pairKey,
          participants: [u1, u2],
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["edgeKey", "participants", "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        edgePath,
        [
          inc("head.singles.games", singles.games),
          inc("head.singles.winsU1", singles.winsU1),
          inc("head.singles.winsU2", singles.winsU2),
          inc("head.singles.durationMin", singles.durationMin),
          inc("head.doubles.games", doubles.games),
          inc("head.doubles.winsU1", doubles.winsU1),
          inc("head.doubles.winsU2", doubles.winsU2),
          inc("head.doubles.durationMin", doubles.durationMin),
          inc("head.totals.games", totals.games),
          inc("head.totals.winsU1", totals.winsU1),
          inc("head.totals.winsU2", totals.winsU2),
          inc("head.totals.durationMin", totals.durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
    const monthlyPath = `${edgePath}/monthly/${endMonth}`;
    writes.push(
      makeUpdateMaskWrite(
        monthlyPath,
        {
          month: endMonth,
          lastPlayedAt: { timestampValue: lastEndedAt },
          appliedSessions: { [sessionKey]: true },
        },
        ["month", "lastPlayedAt", maskPath(`appliedSessions.${sessionKey}`)],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        monthlyPath,
        [
          inc("head.singles.games", singles.games),
          inc("head.singles.winsU1", singles.winsU1),
          inc("head.singles.winsU2", singles.winsU2),
          inc("head.singles.durationMin", singles.durationMin),
          inc("head.doubles.games", doubles.games),
          inc("head.doubles.winsU1", doubles.winsU1),
          inc("head.doubles.winsU2", doubles.winsU2),
          inc("head.doubles.durationMin", doubles.durationMin),
          inc("head.totals.games", totals.games),
          inc("head.totals.winsU1", totals.winsU1),
          inc("head.totals.winsU2", totals.winsU2),
          inc("head.totals.durationMin", totals.durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );

    // Per-user mirrors under club scope
    const mirrorA = `${clubsCol}/${clubId}/userStats/${u1}/opponents/${u2}`;
    const mirrorB = `${clubsCol}/${clubId}/userStats/${u2}/opponents/${u1}`;
    writes.push(
      makeUpdateMaskWrite(
        mirrorA,
        {
          otherUid: u2,
          edgeKey: pairKey,
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["otherUid", "edgeKey", "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        mirrorA,
        [
          inc("against.singles.games", singles.games),
          inc("against.singles.wins", singles.winsU1),
          inc("against.singles.losses", singles.winsU2),
          inc("against.singles.durationMin", singles.durationMin),
          inc("against.doubles.games", doubles.games),
          inc("against.doubles.wins", doubles.winsU1),
          inc("against.doubles.losses", doubles.winsU2),
          inc("against.doubles.durationMin", doubles.durationMin),
          inc("against.totals.games", totals.games),
          inc("against.totals.wins", totals.winsU1),
          inc("against.totals.losses", totals.winsU2),
          inc("against.totals.durationMin", totals.durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(
        mirrorB,
        {
          otherUid: u1,
          edgeKey: pairKey,
          lastPlayedAt: { timestampValue: lastEndedAt },
        },
        ["otherUid", "edgeKey", "lastPlayedAt"],
        env
      )
    );
    writes.push(
      makeTransformWrite(
        mirrorB,
        [
          inc("against.singles.games", singles.games),
          inc("against.singles.wins", singles.winsU2),
          inc("against.singles.losses", singles.winsU1),
          inc("against.singles.durationMin", singles.durationMin),
          inc("against.doubles.games", doubles.games),
          inc("against.doubles.wins", doubles.winsU2),
          inc("against.doubles.losses", doubles.winsU1),
          inc("against.doubles.durationMin", doubles.durationMin),
          inc("against.totals.games", totals.games),
          inc("against.totals.wins", totals.winsU2),
          inc("against.totals.losses", totals.winsU1),
          inc("against.totals.durationMin", totals.durationMin),
          reqTime("updatedAt"),
        ],
        env
      )
    );
  }
  if (gateWrites.length)
    await batchWriteIgnoreIdempotentErrors(token, env, gateWrites);
  if (writes.length) await commitWritesChunked(token, env, writes);
}

// Aggregates club-level monthly participation and session count.
// Idempotent per session via create-only gate under monthly/{YYYY-MM}/bySession/{sessionKey}
async function commitClubMonthlyAggregate({
  clubsCol,
  clubId,
  endMonth,
  sessionKey,
  memberCount,
  memberAttendeeCount,
  env,
  token,
}) {
  const monthPath = `${clubsCol}/${clubId}/monthly/${endMonth}`;
  const gatePath = `${monthPath}/bySession/${sessionKey}`;
  const writes = [];
  writes.push(
    makeUpdatePrecondCreate(
      gatePath,
      { sessionKey, createdAt: { __ts: true } },
      env
    )
  );
  writes.push(
    makeUpdateMaskWrite(monthPath, { month: endMonth }, ["month"], env)
  );
  const participationRate =
    Number(memberCount) > 0
      ? Number(memberAttendeeCount || 0) / Number(memberCount)
      : 0;
  const participationRateX100 = Math.floor(
    Number(participationRate * 100) || 0
  );
  writes.push(
    makeTransformWrite(
      monthPath,
      [
        inc("sessionsCount", 1),
        inc("participationSampleCount", 1),
        inc("memberAttendeeSum", Number(memberAttendeeCount || 0)),
        inc("memberCountSum", Number(memberCount || 0)),
        inc("participationRateSum", participationRateX100),
        reqTime("updatedAt"),
      ],
      env
    )
  );
  try {
    await commitWrites(token, env, writes);
  } catch (e) {
    if (!isAlreadyApplied(e)) console.log("monthly aggregate error", e);
  }
}

// Increments per-user club attendance (once per session), both monthly and summary.
// Idempotent per user+session via gates under userStats/{uid}/gates
async function commitClubPerUserAttendance({
  clubsCol,
  clubId,
  endMonth,
  sessionKey,
  attendeeUids,
  env,
  token,
}) {
  const gateWrites = [];
  const writes = [];
  for (const uid of Array.isArray(attendeeUids) ? attendeeUids : []) {
    const basePath = `${clubsCol}/${clubId}/userStats/${uid}`;
    const monthPath = `${basePath}/monthly/${endMonth}`;

    // Monthly attendance gate and increment
    const monthlyKey = `attendance:${endMonth}:${uid}:${sessionKey}`;
    gateWrites.push(
      makeUpdatePrecondCreate(
        `${basePath}/gates/${monthlyKey}`,
        {
          taskKey: monthlyKey,
          sessionKey,
          scope: { uid, month: endMonth, clubId },
          workerVersion: WORKER_VERSION,
          createdAt: { __ts: true },
        },
        env
      )
    );
    writes.push(
      makeUpdateMaskWrite(monthPath, { month: endMonth }, ["month"], env)
    );
    writes.push(
      makeTransformWrite(
        monthPath,
        [inc("attendance.sessions", 1), reqTime("updatedAt")],
        env
      )
    );

    // Summary attendance gate and increment
    const summaryKey = `attendance:summary:${uid}:${sessionKey}`;
    gateWrites.push(
      makeUpdatePrecondCreate(
        `${basePath}/gates/${summaryKey}`,
        {
          taskKey: summaryKey,
          sessionKey,
          scope: { uid, clubId },
          workerVersion: WORKER_VERSION,
          createdAt: { __ts: true },
        },
        env
      )
    );
    // ensure summary doc exists
    writes.push(
      makeUpdateMaskWrite(basePath, { uid, clubId }, ["uid", "clubId"], env)
    );
    writes.push(
      makeTransformWrite(
        basePath,
        [inc("attendance.sessions", 1), reqTime("updatedAt")],
        env
      )
    );
  }
  if (gateWrites.length)
    await batchWriteIgnoreIdempotentErrors(token, env, gateWrites);
  if (writes.length) await commitWritesChunked(token, env, writes);
}
