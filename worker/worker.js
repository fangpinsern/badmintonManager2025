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
                await sendTelegram({
                  token: env.TELEGRAM_BOT_TOKEN,
                  chatId: chat.id,
                  text: `✅ Linked to <b>${escapeHtml(
                    result.name || "your club"
                  )}</b>.`,
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
      const clubsCol =
        String(env?.STATS_TEST_MODE || "") === "1" ||
        String(env?.STATS_TEST_MODE || "").toLowerCase() === "true"
          ? "clubs_test"
          : "clubs";
      const clubRes = await fetch(`${baseUrl}/${clubsCol}/${clubId}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!clubRes.ok) {
        try {
          console.log("club read failed", clubId, clubRes.status);
        } catch {}
        return withCors(new Response("club read failed", { status: 502 }), req);
      }
      const clubDoc = await clubRes.json();
      const f = clubDoc.fields || {};
      const telegram = jsonFromFields(f.telegram) || {};
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
      const text = payload?.text || "✅ Test message from Badminton Manager";
      try {
        await sendTelegram({ token: botToken, chatId: telegram.chatId, text });
        return withCors(new Response("sent"), req);
      } catch (e) {
        try {
          console.log("telegram send failed", e);
        } catch {}
        return withCors(new Response("send failed", { status: 502 }), req);
      }
    }

    if (req.method !== "POST") {
      return withCors(new Response("Method Not Allowed", { status: 405 }), req);
    }

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

      const uids = Object.keys(perUser);
      if (!uids.length)
        return withCors(
          new Response("No linked players", { status: 200 }),
          req
        );

      // ----------------------------
      // Elo ratings computation (background)
      // ----------------------------
      // Notes/assumptions:
      // - We compute Elo for both modes; current UI does not display, we store under users/{uid}.elo
      // - Trust weights follow docs/elo.md §2.4 using available links. No confirmation flags in payload, so verification multiplier=1.0.
      // - MOV multiplier uses Math.log; all math fits raw JS (no special libraries needed).
      // - Doubles chemistry is stored on friendEdges/{u1__u2}.chemistry.delta and updated with decay; requires reading current value once.
      // - Idempotency: per-user gate under users/{uid}/gates/elo:session:{organizer_session} to prevent double-apply.

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
  },
};
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
  const clubsCol =
    String(env?.STATS_TEST_MODE || "").toLowerCase() === "true" ||
    env?.STATS_TEST_MODE === "1"
      ? "clubs_test"
      : "clubs";
  try {
    console.log("claim:start", {
      tokenPrefix: String(token || "").slice(0, 8),
      clubsCol,
      project: env.GCP_PROJECT_ID,
      db: env.FIRESTORE_DB,
    });
  } catch {}
  // Firestore structured query to find by linkToken (document field filter)
  const queryEndpoint = `${baseUrl}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: clubsCol }],
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
  try {
    console.log("claim:runQuery body", body);
  } catch {}
  const res = await fetch(queryEndpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${access}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  try {
    console.log("claim:runQuery status", res.status);
  } catch {}
  if (!res.ok) {
    try {
      console.log("claim:runQuery errorText", await res.text());
    } catch {}
    throw new Error("query failed");
  }
  console.log("query res", res);
  const arr = await res.json();
  try {
    console.log(
      "claim:runQuery results length",
      Array.isArray(arr) ? arr.length : -1
    );
  } catch {}
  const first = Array.isArray(arr) ? arr.find((x) => x.document) : null;
  if (!first || !first.document) return null;
  const doc = first.document;
  const name = doc.name || ""; // full path
  try {
    console.log("claim:doc name", name);
  } catch {}
  // Optional TTL check
  try {
    const f = doc.fields || {};
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
  const commitRes = await fetch(`${baseUrl}:commit`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${access}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      writes: [
        {
          update: { name, fields },
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
    const f = doc.fields || {};
    const clubName = jsonFromFields(f.name) || "your club";
    try {
      console.log("claim:success", { clubName });
    } catch {}
    return { name: clubName };
  } catch {
    return { name: "your club" };
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
    const tokens = await listUserFcmTokens(fsToken, this.env, userId, true);
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
    console.log("game", g);
    const rawA = Array.isArray(g.sideA) ? g.sideA.length : 0;
    const rawB = Array.isArray(g.sideB) ? g.sideB.length : 0;
    console.log("game2", rawA);
    console.log("game3", rawB);

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
  for (const uid of uids) {
    const agg = perUser[uid];
    const monthPath = `${rootCol}/${uid}/monthly/${endMonth}`;
    const sumPath = `${rootCol}/${uid}`;

    {
      const monthlyTaskKey = `stats:monthly:${endMonth}:${uid}:${sessionKey}`;
      const writes = [];
      writes.push(
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

      try {
        await commitWrites(token, env, writes);
      } catch (e) {
        if (!isAlreadyApplied(e)) console.log(e);
      }
    }

    {
      const summaryTaskKey = `stats:summary:${uid}:${sessionKey}`;
      const writes = [];
      writes.push(
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

      try {
        await commitWrites(token, env, writes);
      } catch (e) {
        if (!isAlreadyApplied(e)) console.log(e);
      }
    }
  }
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
  for (const uid of updatedUsers) {
    const pr = userElo.get(uid);
    if (!pr) continue;
    const writes = [];
    const eloTaskKey = `elo:session:${organizerUid}_${sessionId}`;
    writes.push(
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
    try {
      await commitWrites(token, env, writes);
    } catch (e) {
      if (!isAlreadyApplied(e)) console.log(e);
    }
  }
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
  for (const [edgeKey, agg] of pairAgg) {
    const { u1, u2, games, wins, durationMin, lastEndedAt } = agg;

    const writes = [];
    writes.push(
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

    try {
      await commitWrites(token, env, writes);
    } catch (e) {
      if (!isAlreadyApplied(e)) continue;
      else console.log(e);
    }
  }
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
  for (const [pairKey, agg] of oppAgg) {
    const { u1, u2, singles, doubles, totals, lastEndedAt } = agg;
    const writes = [];
    writes.push(
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
          inc(
            "against.singles.wins",
            doubles.winsU2 ? singles.winsU2 : singles.winsU2
          ),
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

    try {
      await commitWrites(token, env, writes);
    } catch (e) {
      if (isAlreadyApplied(e)) continue;
      console.log(e);
    }
  }
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
  for (const uid of uids) {
    if (!memberSet.has(uid)) continue;
    const agg = perUser[uid];
    const basePath = `${clubsCol}/${clubId}/userStats/${uid}`;
    const monthPath = `${basePath}/monthly/${endMonth}`;

    // A) MONTHLY task (gate + monthly upserts + increments)
    {
      const monthlyTaskKey = `stats:monthly:${endMonth}:${uid}:${sessionKey}`;
      const writes = [];
      writes.push(
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
      try {
        await commitWrites(token, env, writes);
      } catch (e) {
        if (!isAlreadyApplied(e)) console.log(e);
      }
    }

    // B) SUMMARY task (gate + ensure + increments + recentForm append)
    {
      const summaryTaskKey = `stats:summary:${uid}:${sessionKey}`;
      const writes = [];
      writes.push(
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
      try {
        await commitWrites(token, env, writes);
      } catch (e) {
        if (!isAlreadyApplied(e)) console.log(e);
      }
    }
  }
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
  for (const [edgeKey, agg] of pairAgg) {
    const { u1, u2, games, wins, durationMin, lastEndedAt } = agg;
    if (!memberSet.has(u1) || !memberSet.has(u2)) continue;

    const edgePath = `${clubsCol}/${clubId}/friendEdges/${edgeKey}`;
    const writes = [];
    writes.push(
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

    try {
      await commitWrites(token, env, writes);
    } catch (e) {
      if (!isAlreadyApplied(e)) continue;
      else console.log(e);
    }
  }
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
  for (const [pairKey, agg] of oppAgg) {
    const { u1, u2, singles, doubles, totals, lastEndedAt } = agg;
    if (!memberSet.has(u1) || !memberSet.has(u2)) continue;

    const edgePath = `${clubsCol}/${clubId}/opponentEdges/${pairKey}`;
    const writes = [];
    writes.push(
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

    try {
      await commitWrites(token, env, writes);
    } catch (e) {
      if (isAlreadyApplied(e)) continue;
      console.log(e);
    }
  }
}
