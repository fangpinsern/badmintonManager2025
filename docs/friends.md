Data model
Store per-user edges for easy reads:
Collection: userFriends or userFriends_test (use isTestMode)
Doc path: userFriends/{uid}/edges/{otherUid}
Fields (all time; keep singles/doubles breakdown):
gamesTogether, winsTogether, lossesTogether
singles: { games, wins, losses }
doubles: { games, wins, losses }
winRateTogether (denormalized), lastPlayedAt (timestamp)
firstPlayedAt (timestamp), sessionsCount, recentStreakTogether (optional)
strength (computed score for sorting, e.g. gamesTogether \* log(1+winRate))
Optional global undirected index for cross-user ops:
friendEdges/{uidA_uidB} (uidA < uidB). Same metrics; helps global queries.
Calculation (extend current worker at session end)
For each non-voided game:
Build pairs for side A and side B (singles: 1-player “pair”; doubles: 2-player pair → 1 edge).
For each pair (p, q), update both userFriends/p.edges[q] and userFriends/q.edges[p].
Increment gamesTogether; winsTogether if their side won; update singles/doubles buckets; update timestamps.
Idempotency:
Use the same session job/audit mechanism you adopted for stats:
userStats_jobs/{uid}/sessions/{organizerUid_sessionId} with inputHash + statsVersion.
If job exists with same inputHash, skip edge updates.
Writes should be deterministic overwrites (recompute totals from session deltas), not blind increments.
Store a per-user-pair per-session audit if you prefer additive updates:
userFriends_audit/{uid}/bySession/{organizerUid_sessionId}{otherUid} = { games, wins, losses, singles, doubles }
Edge = sum of audits; recompute is idempotent.
Queries
Top partners: order userFriends/{uid}/edges by strength desc (or gamesTogether desc).
Partner details on profile: read edges where otherUid == profile uid.
Recent partners: order by lastPlayedAt desc.
Indexes
Single-field: edges.strength (desc), edges.lastPlayedAt (desc) are sufficient.
If you keep a global friendEdges collection, add composite index if you plan complex filters; otherwise avoid.
Privacy
Decide read rules:
Private by default: a user can read only userFriends/{uid == auth.uid}.
If you want public profile insights, allow read of edges under the profiled uid but consider redacting sensitive fields.
UI
Simple list: avatar/name, games together, win rate, last played, strength bar.
Graph view (later): force-directed graph for top N partners; edge width ~ gamesTogether; color ~ winRateTogether.
Scale and storage
Use user-centric edges only; avoid duplicating large global graphs unless needed.
TTL/decay (optional): keep a decayedStrength = Σ weight(game)decayFactor^age for “recent chemistry”.
Test mode
Mirror collections with test suffix via isTestMode (userFriends_test, friendEdges_test, userFriends_audit_test).
Migration/consistency
Backfill: iterate sessions; worker recomputes edges with idempotent jobs.
Version bump: add friendshipVersion; force recompute when logic changes.
If you want, I can wire the worker to emit these edges (idempotent), add the Firestore rules for userFriends, and surface a “Top partners” module on the profile page.
