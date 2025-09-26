const WORKER_VERSION = "2025-09-22.1";

// --- Push/aggregation policy ---
const AGG_WINDOW_MS   = 1 * 30 * 1000;   // aggregate events for 3 min
const MIN_INTERVAL_MS = 1 * 30 * 1000;   // no more than 1 push / 2 min per user
const DAILY_MAX       = 100;               // cap per user per UTC day


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
      const sessionRes = await fetch(`${baseUrl}/${userCol}/${organizerUid}/sessions/${sessionId}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!sessionRes.ok) {
        return withCors(new Response("Session read failed", { status: 502 }), req);
      }
      const sessionDoc = await sessionRes.json();

      const payload = sessionDoc?.fields?.payload ? jsonFromFields(sessionDoc.fields.payload) : {};
      if (!payload?.ended) {
        return withCors(
          new Response(
            JSON.stringify({ error: "session_not_ended", message: "Session has not ended yet." }),
            { status: 400, headers: { "content-type": "application/json" } }
          ),
          req
        );
      }

      const players = Array.isArray(payload.players) ? payload.players : [];
      const gamesAll = Array.isArray(payload.games) ? payload.games : [];
      const games = gamesAll.filter((g) => !g?.voided);
      if (!games.length) return withCors(new Response("No games", { status: 200 }), req);

      // playerId -> accountUid
      const pidToUid = new Map();
      for (const p of players) {
        if (p?.id && p?.accountUid) pidToUid.set(p.id, p.accountUid);
      }

      // Build per-user aggregates
      const ensure = (map, uid) => {
        if (!map[uid]) {
          map[uid] = {
            singles: { games: 0, wins: 0, durationMin: 0 },
            doubles: { games: 0, wins: 0, durationMin: 0 },
            totals:  { games: 0, wins: 0, durationMin: 0 },
            recent: []
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
        const winners = winner === "A" ? new Set(a) : winner === "B" ? new Set(b) : new Set();

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

      // --- Friendship (teammate) pair aggregation for this session ---
      function canonicalPair(a, b) { return a < b ? [a, b] : [b, a]; }
      function combos2(arr) {
        const out = [];
        for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) out.push([arr[i], arr[j]]);
        return out;
      }
      const pairAgg = new Map(); // edgeKey -> { u1,u2,games,wins,durationMin,lastEndedAt }

      for (const g of games) {
        // Use RAW team sizes to understand the game shape/winner; profiles may be missing.
        const rawA = Array.isArray(g.sideA) ? g.sideA.length : 0;
        const rawB = Array.isArray(g.sideB) ? g.sideB.length : 0;
    
        // We only record teammate pairs for doubles (at least one team had 2+ players).
        if (rawA < 2 && rawB < 2) continue;
    
        // Now map to registered accounts (only linked accounts produce stats).
        const teamA = (Array.isArray(g.sideA) ? g.sideA : []).map(pid => pidToUid.get(pid)).filter(Boolean);
        const teamB = (Array.isArray(g.sideB) ? g.sideB : []).map(pid => pidToUid.get(pid)).filter(Boolean);
    
        // If neither registered team has ≥2 players, nothing to do.
        if (teamA.length < 2 && teamB.length < 2) continue;
    
        const durMin = Math.round(normalizeDurationMs(g.durationMs, meanMs) / 60000);
        const endedAt = g.endedAt || payload.endedAt || new Date().toISOString();
        const winnerTeam = g.winner === "A" ? "A" : g.winner === "B" ? "B" : null;
    
        // Tally a side's teammate pairs with the correct win attribution based on RAW winner.
        const tallySide = (sideKey, linkedTeam) => {
          if (linkedTeam.length < 2) return;
          for (const [ua, ub] of combos2(linkedTeam)) {
            const [u1, u2] = canonicalPair(ua, ub);
            const key = `${u1}__${u2}`;
            const agg = pairAgg.get(key) || { u1, u2, games: 0, wins: 0, durationMin: 0, lastEndedAt: "" };
            agg.games += 1;
            if (winnerTeam && winnerTeam === sideKey) agg.wins += 1;
            agg.durationMin += durMin;
            if (!agg.lastEndedAt || endedAt > agg.lastEndedAt) agg.lastEndedAt = endedAt;
            pairAgg.set(key, agg);
          }
        };
    
        // Attribute per original team label so wins/losses aren't flipped by filtering.
        tallySide("A", teamA);
        tallySide("B", teamB);
      }

      // Opponent (head-to-head) pair aggregation (singles & doubles)
      // For doubles, count cross-team pairs (every A vs every B).
      // function canonicalPair(a, b) { return a < b ? [a, b] : [b, a]; }
      const oppAgg = new Map(); // pairKey -> { u1,u2, singles:{games,winsU1,winsU2,durationMin}, doubles:{...}, totals:{...}, lastEndedAt }

      for (const g of games) {
        // Decide mode from RAW sides (before filtering to linked accounts).
        console.log("game", g)
        const rawA = Array.isArray(g.sideA) ? g.sideA.length : 0;
        const rawB = Array.isArray(g.sideB) ? g.sideB.length : 0;
        console.log("game2", rawA)
        console.log("game3", rawB)

        // If your data sometimes carries g.mode, prefer it; else derive from raw counts.
        const mode = (g.mode === "singles" || g.mode === "doubles")
          ? g.mode
          : ((rawA === 1 && rawB === 1) ? "singles" : "doubles");

        // Now filter to linked accounts (only write stats for linked users).
        const sideA = (Array.isArray(g.sideA) ? g.sideA : []).map(pid => pidToUid.get(pid)).filter(Boolean);
        const sideB = (Array.isArray(g.sideB) ? g.sideB : []).map(pid => pidToUid.get(pid)).filter(Boolean);
        if (!sideA.length || !sideB.length) continue;

        const durMin = Math.round(normalizeDurationMs(g.durationMs, meanMs) / 60000);
        const endedAt = g.endedAt || payload.endedAt || new Date().toISOString();
        const winnerIdx = g.winner === "A" ? 0 : g.winner === "B" ? 1 : -1;

        for (const ua of sideA) {
          for (const ub of sideB) {
            const [u1, u2] = canonicalPair(ua, ub);
            const key = `${u1}__${u2}`;
            const cur = oppAgg.get(key) || {
              u1, u2,
              singles: { games: 0, winsU1: 0, winsU2: 0, durationMin: 0 },
              doubles: { games: 0, winsU1: 0, winsU2: 0, durationMin: 0 },
              totals:  { games: 0, winsU1: 0, winsU2: 0, durationMin: 0 },
              lastEndedAt: ""
            };
            const bucket = cur[mode];

            bucket.games += 1;
            bucket.durationMin += durMin;
            cur.totals.games += 1;
            cur.totals.durationMin += durMin;

            if (winnerIdx !== -1) {
              // who is winner among (ua in A) vs (ub in B)?
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

            if (!cur.lastEndedAt || endedAt > cur.lastEndedAt) cur.lastEndedAt = endedAt;
            oppAgg.set(key, cur);
          }
        }
      }

      const uids = Object.keys(perUser);
      if (!uids.length) return withCors(new Response("No linked players", { status: 200 }), req);

      console.log("uids", uids);
      if (dryRun) {
        const sessionKey = `${organizerUid}_${sessionId}`;
        const endMonth = monthKey(payload.endedAt || (games[games.length - 1] || {}).endedAt);
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
        const opp = Array.from(oppAgg.values())
        return withCors(
          new Response(JSON.stringify({ sessionKey, endMonth, users: summary, pairs, opp }, null, 2), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
          req
        );
      }

      const sessionKey = `${organizerUid}_${sessionId}`;
      const endMonth = monthKey(payload.endedAt || (games[games.length - 1] || {}).endedAt);
      const rootCol = isTest ? "userStats_test" : "userStats";

      // ----------------------------
      // Per-user writes (granular gates; split into two commits per user)
      // ----------------------------
      for (const uid of uids) {
        const agg       = perUser[uid];
        const monthPath = `${rootCol}/${uid}/monthly/${endMonth}`;
        const sumPath   = `${rootCol}/${uid}`;

        // A) MONTHLY task (gate + monthly upserts + increments)
        {
          const monthlyTaskKey = `stats:monthly:${endMonth}:${uid}:${sessionKey}`;
          const writes = [];

          // granular idempotency gate
          writes.push(makeUpdatePrecondCreate(
            `${rootCol}/${uid}/gates/${monthlyTaskKey}`,
            { taskKey: monthlyTaskKey, sessionKey, scope: { uid, month: endMonth }, workerVersion: WORKER_VERSION, createdAt: { __ts: true } },
            env
          ));

          // mark appliedSessions.{sessionKey} = true and ensure doc exists
          writes.push(makeUpdateMaskWrite(
            monthPath,
            { month: endMonth, appliedSessions: { [sessionKey]: true } },
            ["month", maskPath(`appliedSessions.${sessionKey}`)],
            env
          ));

          // increment monthly counters
          writes.push(makeTransformWrite(monthPath, [
            inc("singles.games",       agg.singles.games),
            inc("singles.wins",        agg.singles.wins),
            inc("singles.durationMin", agg.singles.durationMin),
            inc("doubles.games",       agg.doubles.games),
            inc("doubles.wins",        agg.doubles.wins),
            inc("doubles.durationMin", agg.doubles.durationMin),
            inc("totals.games",        agg.totals.games),
            inc("totals.wins",         agg.totals.wins),
            inc("totals.durationMin",  agg.totals.durationMin),
            reqTime("updatedAt"),
          ], env));

          try { await commitWrites(token, env, writes); }
          catch (e) { if (!isAlreadyApplied(e)) console.log(e); }
        }

        // B) SUMMARY task (gate + summary upserts + increments + recentForm append)
        {
          const summaryTaskKey = `stats:summary:${uid}:${sessionKey}`;
          const writes = [];

          // granular idempotency gate
          writes.push(makeUpdatePrecondCreate(
            `${rootCol}/${uid}/gates/${summaryTaskKey}`,
            { taskKey: summaryTaskKey, sessionKey, scope: { uid }, workerVersion: WORKER_VERSION, createdAt: { __ts: true } },
            env
          ));

          // ensure summary doc exists (uid field)
          writes.push(makeUpdateMaskWrite(
            sumPath,
            { uid },
            ["uid"],
            env
          ));

          // increment summary counters & append recent slice
          writes.push(makeTransformWrite(sumPath, [
            // overall totals under totals.*
            inc("totals.games",        agg.totals.games),
            inc("totals.wins",         agg.totals.wins),
            inc("totals.durationMin",  agg.totals.durationMin),

            // nest singles/doubles under totals.*
            inc("totals.singles.games",       agg.singles.games),
            inc("totals.singles.wins",        agg.singles.wins),
            inc("totals.singles.durationMin", agg.singles.durationMin),
            inc("totals.doubles.games",       agg.doubles.games),
            inc("totals.doubles.wins",        agg.doubles.wins),
            inc("totals.doubles.durationMin", agg.doubles.durationMin),

            arrayUnion("recentForm",   agg.recent.slice().reverse()), // sort on read; or migrate to feed later
            reqTime("updatedAt"),
          ], env));

          try { await commitWrites(token, env, writes); }
          catch (e) { if (!isAlreadyApplied(e)) console.log(e); }
        }
      }

      // ----------------------------
      // Friendship graph + Global index (granular gates; one commit per edge)
      // ----------------------------
      const friendEdgeCol = isTest ? "friendEdges_test" : "friendEdges";
      for (const [edgeKey, agg] of pairAgg) {
        const { u1, u2, games, wins, durationMin, lastEndedAt } = agg;

        const writes = [];

        // global edge task gates (you can rely on these to protect mirrors too)
        // const globalTaskKey  = `friends:global:${edgeKey}`;
        // const monthlyTaskKey = `friends:monthly:${endMonth}:${edgeKey}`;

        // writes.push(makeUpdatePrecondCreate(
        //   `${friendEdgeCol}/${edgeKey}/gates/${globalTaskKey}`,
        //   { taskKey: globalTaskKey, sessionKey, scope: { edgeKey }, workerVersion: WORKER_VERSION, createdAt: { __ts: true } },
        //   env
        // ));
        // writes.push(makeUpdatePrecondCreate(
        //   `${friendEdgeCol}/${edgeKey}/gates/${monthlyTaskKey}`,
        //   { taskKey: monthlyTaskKey, sessionKey, scope: { edgeKey, month: endMonth }, workerVersion: WORKER_VERSION, createdAt: { __ts: true } },
        //   env
        // ));

        writes.push(makeUpdatePrecondCreate(
          `${friendEdgeCol}/${edgeKey}/bySession/${sessionKey}`,
          { sessionKey, month: endMonth, createdAt: { __ts: true } },
          env
        ));

        // Authoritative global edge doc
        writes.push(makeUpdateMaskWrite(
          `${friendEdgeCol}/${edgeKey}`,
          { edgeKey, participants: [u1, u2], lastPlayedAt: { timestampValue: lastEndedAt } },
          ["edgeKey", "participants", "lastPlayedAt"],
          env
        ));
        writes.push(makeTransformWrite(`${friendEdgeCol}/${edgeKey}`, [
          inc("together.games",       games),
          inc("together.wins",        wins),
          inc("together.durationMin", durationMin),
          reqTime("updatedAt"),
        ], env));

        // Global monthly edge doc
        writes.push(makeUpdateMaskWrite(
          `${friendEdgeCol}/${edgeKey}/monthly/${endMonth}`,
          { month: endMonth, appliedSessions: { [sessionKey]: true }, lastPlayedAt: { timestampValue: lastEndedAt } },
          ["month", maskPath(`appliedSessions.${sessionKey}`), "lastPlayedAt"],
          env
        ));
        writes.push(makeTransformWrite(`${friendEdgeCol}/${edgeKey}/monthly/${endMonth}`, [
          inc("together.games",       games),
          inc("together.wins",        wins),
          inc("together.durationMin", durationMin),
          reqTime("updatedAt"),
        ], env));

        // Per-user adjacency mirrors (fast reads by path)
        writes.push(makeUpdateMaskWrite(
          `${rootCol}/${u1}/friends/${u2}`,
          { otherUid: u2, edgeKey, lastPlayedAt: { timestampValue: lastEndedAt } },
          ["otherUid", "edgeKey", "lastPlayedAt"],
          env
        ));
        writes.push(makeUpdateMaskWrite(
          `${rootCol}/${u2}/friends/${u1}`,
          { otherUid: u1, edgeKey, lastPlayedAt: { timestampValue: lastEndedAt } },
          ["otherUid", "edgeKey", "lastPlayedAt"],
          env
        ));
        writes.push(makeTransformWrite(`${rootCol}/${u1}/friends/${u2}`, [
          inc("together.games",       games),
          inc("together.wins",        wins),
          inc("together.durationMin", durationMin),
          reqTime("updatedAt"),
        ], env));
        writes.push(makeTransformWrite(`${rootCol}/${u2}/friends/${u1}`, [
          inc("together.games",       games),
          inc("together.wins",        wins),
          inc("together.durationMin", durationMin),
          reqTime("updatedAt"),
        ], env));

        try { await commitWrites(token, env, writes); }
        catch (e) { if (!isAlreadyApplied(e)) continue; else console.log(e); }
      }

      const opponentEdgeCol = isTest ? "opponentEdges_test" : "opponentEdges";
      for (const [pairKey, agg] of oppAgg) {
        const { u1, u2, singles, doubles, totals, lastEndedAt } = agg;

        const writes = [];

        // Per-session gate (create-only). Using bySession prevents blocking later sessions.
        writes.push(makeUpdatePrecondCreate(
          `${opponentEdgeCol}/${pairKey}/bySession/${sessionKey}`,
          { sessionKey, month: endMonth, createdAt: { __ts: true } },
          env
        ));

        // 1) Global opponent edge doc (authoritative)
        writes.push(makeUpdateMaskWrite(
          `${opponentEdgeCol}/${pairKey}`,
          { edgeKey: pairKey, participants: [u1, u2], lastPlayedAt: { timestampValue: lastEndedAt } },
          ["edgeKey", "participants", "lastPlayedAt"],
          env
        ));
        writes.push(makeTransformWrite(`${opponentEdgeCol}/${pairKey}`, [
          // singles
          inc("head.singles.games",        singles.games),
          inc("head.singles.winsU1",       singles.winsU1),
          inc("head.singles.winsU2",       singles.winsU2),
          inc("head.singles.durationMin",  singles.durationMin),
          // doubles
          inc("head.doubles.games",        doubles.games),
          inc("head.doubles.winsU1",       doubles.winsU1),
          inc("head.doubles.winsU2",       doubles.winsU2),
          inc("head.doubles.durationMin",  doubles.durationMin),
          // totals
          inc("head.totals.games",         totals.games),
          inc("head.totals.winsU1",        totals.winsU1),
          inc("head.totals.winsU2",        totals.winsU2),
          inc("head.totals.durationMin",   totals.durationMin),
          reqTime("updatedAt"),
        ], env));

        // 2) Global monthly opponent edge doc
        writes.push(makeUpdateMaskWrite(
          `${opponentEdgeCol}/${pairKey}/monthly/${endMonth}`,
          { month: endMonth, lastPlayedAt: { timestampValue: lastEndedAt }, appliedSessions: { [sessionKey]: true } },
          ["month", "lastPlayedAt", maskPath(`appliedSessions.${sessionKey}`)],
          env
        ));
        writes.push(makeTransformWrite(`${opponentEdgeCol}/${pairKey}/monthly/${endMonth}`, [
          // singles
          inc("head.singles.games",        singles.games),
          inc("head.singles.winsU1",       singles.winsU1),
          inc("head.singles.winsU2",       singles.winsU2),
          inc("head.singles.durationMin",  singles.durationMin),
          // doubles
          inc("head.doubles.games",        doubles.games),
          inc("head.doubles.winsU1",       doubles.winsU1),
          inc("head.doubles.winsU2",       doubles.winsU2),
          inc("head.doubles.durationMin",  doubles.durationMin),
          // totals
          inc("head.totals.games",         totals.games),
          inc("head.totals.winsU1",        totals.winsU1),
          inc("head.totals.winsU2",        totals.winsU2),
          inc("head.totals.durationMin",   totals.durationMin),
          reqTime("updatedAt"),
        ], env));

        // 3) Per-user opponent mirrors (fast profile reads by path)
        // u1's doc vs u2
        writes.push(makeUpdateMaskWrite(
          `${rootCol}/${u1}/opponents/${u2}`,
          { otherUid: u2, edgeKey: pairKey, lastPlayedAt: { timestampValue: lastEndedAt } },
          ["otherUid", "edgeKey", "lastPlayedAt"],
          env
        ));
        writes.push(makeTransformWrite(`${rootCol}/${u1}/opponents/${u2}`, [
          // singles
          inc("against.singles.games",       singles.games),
          inc("against.singles.wins",        singles.winsU1),
          inc("against.singles.losses",      singles.winsU2),
          inc("against.singles.durationMin", singles.durationMin),
          // doubles
          inc("against.doubles.games",       doubles.games),
          inc("against.doubles.wins",        doubles.winsU1),
          inc("against.doubles.losses",      doubles.winsU2),
          inc("against.doubles.durationMin", doubles.durationMin),
          // totals
          inc("against.totals.games",        totals.games),
          inc("against.totals.wins",         totals.winsU1),
          inc("against.totals.losses",       totals.winsU2),
          inc("against.totals.durationMin",  totals.durationMin),
          reqTime("updatedAt"),
        ], env));

        // u2's doc vs u1 (flip wins/losses)
        writes.push(makeUpdateMaskWrite(
          `${rootCol}/${u2}/opponents/${u1}`,
          { otherUid: u1, edgeKey: pairKey, lastPlayedAt: { timestampValue: lastEndedAt } },
          ["otherUid", "edgeKey", "lastPlayedAt"],
          env
        ));
        writes.push(makeTransformWrite(`${rootCol}/${u2}/opponents/${u1}`, [
          // singles
          inc("against.singles.games",       singles.games),
          inc("against.singles.wins",        singles.winsU2),
          inc("against.singles.losses",      singles.winsU1),
          inc("against.singles.durationMin", singles.durationMin),
          // doubles
          inc("against.doubles.games",       doubles.games),
          inc("against.doubles.wins",        doubles.winsU2),
          inc("against.doubles.losses",      doubles.winsU1),
          inc("against.doubles.durationMin", doubles.durationMin),
          // totals
          inc("against.totals.games",        totals.games),
          inc("against.totals.wins",         totals.winsU2),
          inc("against.totals.losses",       totals.winsU1),
          inc("against.totals.durationMin",  totals.durationMin),
          reqTime("updatedAt"),
        ], env));

        try {
          await commitWrites(token, env, writes);
        } catch (e) {
          // If the bySession gate exists, this session already applied for this pair; skip.
          if (isAlreadyApplied(e)) continue;
          console.log(e)
        }
      }

      console.log("notifying uids", uids);
      for (const uid of uids) {
        const ev = {
          idempotencyKey: `stats:${organizerUid}:${sessionId}:${uid}`,
          type: "stats_update",
          title: "Session Ended. View your stats now",
          url: `/session/${sessionId}?u=${uid}`,     // deep link your PWA handles
          occurredAt: new Date().toISOString()
        };
        // Fire-and-forget; DO alarm will aggregate and send
        try {
          const res = await enqueueEvent(env, uid, ev)
          console.log("enqueueEvent res", res);
        } catch (e) {
          console.log("enqueueEvent error", e);
        }
      }

      return withCors(new Response("OK"), req);
    } catch (e) {
      return withCors(new Response(`Error: ${e?.message || "Internal Error"}`, { status: 500 }), req);
    }
  }
};

// ---------- Helpers (unchanged unless noted) ----------

function fsBases(projectId, db) {
  return {
    url: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(db)}/documents`,
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
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(data));
  const signature = b64urlFromString(String.fromCharCode(...new Uint8Array(sigBuf)));
  const jwt = `${data}.${signature}`;
  const res = await fetch(G_AUTH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`token error: ${res.status} ${await res.text()}`);
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
    throw new Error("Got PKCS#1 (BEGIN RSA PRIVATE KEY). Use PKCS#8 (BEGIN PRIVATE KEY). Convert or rotate key.");
  }
  if (!/-----BEGIN PRIVATE KEY-----/.test(pem)) {
    throw new Error("Missing 'BEGIN PRIVATE KEY' header; check the secret value.");
  }
  return pem;
}

async function importPkcs8(pem, algName) {
  const keyData = pemToArrayBuffer(normalizePem(pem));
  return crypto.subtle.importKey("pkcs8", keyData, { name: algName, hash: "SHA-256" }, false, ["sign"]);
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
  const durs = games.map(g => (g?.durationMs && g.durationMs > 0 ? g.durationMs : NaN)).filter(Number.isFinite);
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
    const out = {}; for (const k in obj) out[k] = expandTimestamps(obj[k]); return out;
  }
  return obj;
}
function fieldsFromJson(obj) {
  if (obj === null || obj === undefined) return { nullValue: null };
  const t = typeof obj;
  if (t === "string")  return { stringValue: obj };
  if (t === "number")  return Number.isInteger(obj) ? { integerValue: String(obj) } : { doubleValue: obj };
  if (t === "boolean") return { booleanValue: obj };
  if (Array.isArray(obj)) return { arrayValue: { values: obj.map(fieldsFromJson) } };
  if (obj && typeof obj === "object") {
    if ("timestampValue" in obj) return obj;
    const fields = {};
    for (const k in obj) { const v = obj[k]; if (v !== undefined) fields[k] = fieldsFromJson(v); }
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
  return { update: { name: `${nameBase}/${path}`, fields }, currentDocument: { exists: false } };
}
function makeUpdateMaskWrite(path, data, fieldPaths, env) {
  const { name: nameBase } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
  const fields = fieldsFromJson(expandTimestamps(data)).mapValue.fields;
  return { update: { name: `${nameBase}/${path}`, fields }, updateMask: { fieldPaths } };
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
  return { fieldPath, appendMissingElements: { values: jsValues.map(fieldsFromJson) } };
}
async function commitWrites(token, env, writes) {
  const { url: baseUrl } = fsBases(env.GCP_PROJECT_ID, env.FIRESTORE_DB);
  const res = await fetch(`${baseUrl}:commit`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { const j = JSON.parse(text); if (j?.error) msg = `${j.error.status||""} ${j.error.code||""} — ${j.error.message||""}`; } catch {}
    throw new Error(`commit failed: ${res.status} ${msg}`);
  }
}
function isAlreadyApplied(e) {
  return /FAILED_PRECONDITION|ALREADY_EXISTS/i.test(String(e?.message || ""));
}

// CORS
const ALLOW_ORIGINS = new Set(["http://localhost:3000","https://bm25r.codingcrayons.com"]);
function corsHeaders(req, { credentials = false } = {}) {
  const origin = req.headers.get("Origin") || "";
  const allowOrigin = ALLOW_ORIGINS.has(origin) ? origin : "";
  const acrh = req.headers.get("Access-Control-Request-Headers") || "";
  const acrm = req.headers.get("Access-Control-Request-Method") || "";
  const h = new Headers();
  if (allowOrigin) h.set("Access-Control-Allow-Origin", allowOrigin);
  if (credentials && allowOrigin) h.set("Access-Control-Allow-Credentials", "true");
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

async function enqueueEvent(env, userId, ev) {
  const id   = env.MAILBOX.idFromName(userId);
  const stub = env.MAILBOX.get(id);
  console.log("enqueueEvent", userId, ev);
  const res = await stub.fetch("https://do/push/enqueue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, events: [ev] })
  });
  return res
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

      if (!userId || !Array.isArray(events) || !events.length) return new Response("bad", { status: 400 });

      // Persist the app userId so alarm() can look up FCM tokens correctly
      try {
        const storedUid = await this.state.storage.get("uid");
        if (storedUid !== userId) await this.state.storage.put("uid", userId);
      } catch {}

      // Load existing queue
      const queue = (await this.state.storage.get("q")) || [];
      const seen  = new Set(queue.map((e) => e.idempotencyKey));
      for (const e of events) {
        if (!e?.idempotencyKey) continue;
        if (seen.has(e.idempotencyKey)) continue;
        queue.push({
          idempotencyKey: e.idempotencyKey,
          type: e.type || "event",
          title: e.title || "Update",
          url: e.url || "/",
          occurredAt: e.occurredAt || new Date().toISOString()
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
    let rate = (await this.state.storage.get("rate")) || { lastSentAt: 0, day: dayKey(), count: 0 };
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
      body  = "Tap to view";
      url   = coalesced[0].url || "/";
    } else {
      title = "You have updates";
      body  = `${coalesced.length} new items • Tap to review`;
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
    const fsToken = await getAccessTokenScoped(this.env, "https://www.googleapis.com/auth/datastore");
    const tokens = await listUserFcmTokens(fsToken, this.env, userId, true);
    try { console.log("[DO alarm] uid=", userId, "items=", coalesced.length, "tokens=", tokens.length); } catch {}

    if (tokens.length) {
      const fcmToken = await getAccessTokenScoped(this.env, "https://www.googleapis.com/auth/firebase.messaging");
      const sendResults = await sendFcmToMany(this.env, fcmToken, tokens, { title, body, url });

      // (Optional) remove invalid tokens from Firestore using fsToken + document paths from sendResults.removable
      // keep minimal for now
      if (!sendResults.anySucceeded) {
        // If nothing delivered, don't lose the queue; retry later
        const when = Date.now() + MIN_INTERVAL_MS;
        await this.state.storage.setAlarm(when);
        await this.state.storage.put("alarmAt", when);
        return;
      }
    } else {
      // No devices registered; keep queue and retry later
      const when = Date.now() + MIN_INTERVAL_MS;
      await this.state.storage.setAlarm(when);
      await this.state.storage.put("alarmAt", when);
      return;
    }

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
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return [];
  const j = await res.json();
  const docs = Array.isArray(j.documents) ? j.documents : [];
  const tokens = [];
  for (const d of docs) {
    const f = d.fields || {};
    const token  = jsonFromFields(f.token);
    const pwa    = !!jsonFromFields(f.installedPwa);
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
    scope
  };
  const encHeader = b64urlFromJSON(header);
  const encPayload = b64urlFromJSON(claim);
  const data = `${encHeader}.${encPayload}`;
  const key = await importPkcs8(env.GOOGLE_SA_PRIVATE_KEY, "RSASSA-PKCS1-v1_5");
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(data));
  const signature = b64urlFromString(String.fromCharCode(...new Uint8Array(sigBuf)));
  const jwt = `${data}.${signature}`;
  const res = await fetch(G_AUTH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`token error: ${res.status} ${await res.text()}`);
  const t = await res.json();
  return t.access_token;
}


async function sendFcmToMany(env, oauthAccessToken, tokens, { title, body, url }) {
  const endpoint = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`;
  let anySucceeded = false;
  const removable = [];

  for (const token of tokens) {
    const payload = {
      message: {
        token,
        notification: { title, body },
        data: url ? { url } : undefined
      }
    };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${oauthAccessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) { anySucceeded = true; continue; }

    // Try to detect "bad token" to allow cleanup later (optional)
    const txt = await res.text();
    if (/UNREGISTERED|NotRegistered|invalid-argument|registration token|requested entity was not found/i.test(txt)) {
      removable.push(token);
    }
  }
  return { anySucceeded, removable };
}

