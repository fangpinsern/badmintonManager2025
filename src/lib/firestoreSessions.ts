import { auth, db } from "./firebase";
import { toUsernameSlug } from "@/lib/helper";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  serverTimestamp,
  onSnapshot,
  runTransaction,
  query,
  where,
  getDocs,
  updateDoc,
  orderBy,
  startAt,
  endAt,
  limit as fsLimit,
  documentId,
  deleteField,
} from "firebase/firestore";

export type FirestoreSession = {
  id: string;
  payload: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type LinkClaim = {
  id: string;
  playerId: string;
  claimerUid: string;
  claimerName?: string | null;
  createdAt?: unknown;
};

// --- User profiles / usernames ---
const isTestMode =
  typeof process !== "undefined" &&
  typeof process.env !== "undefined" &&
  (String(process.env.NEXT_PUBLIC_TEST_MODE || "").toLowerCase() === "true" ||
    String(process.env.NEXT_PUBLIC_TEST_MODE || "") === "1");

function usersCollectionId(): string {
  return isTestMode ? "users_test" : "users";
}
function usernamesCollectionId(): string {
  return isTestMode ? "usernames_test" : "usernames";
}
function clubsCollectionId(): string {
  return isTestMode ? "clubs_test" : "clubs";
}
function usersCollection() {
  return collection(db, usersCollectionId());
}
function usernamesCollection() {
  return collection(db, usernamesCollectionId());
}
export async function getUserProfile(uid: string) {
  const ref = doc(usersCollection(), uid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as any) : null;
}
export async function updateUserProfile(
  uid: string,
  data: {
    racketModels?: string[] | null;
    favouriteShuttlecock?: string | null;
    bio?: string | null;
    level?: string | null;
  }
) {
  const ref = doc(usersCollection(), uid);
  // Normalize values: trim strings, clamp bio to 200 chars, filter empty models
  const cleanModels = Array.isArray(data.racketModels)
    ? data.racketModels
        .map((s) => String(s || "").trim())
        .filter((s) => !!s)
        .slice(0, 10)
    : data.racketModels === null
    ? null
    : undefined;
  const fav =
    typeof data.favouriteShuttlecock === "string"
      ? data.favouriteShuttlecock.trim() || null
      : data.favouriteShuttlecock;
  const bio =
    typeof data.bio === "string"
      ? (data.bio || "").slice(0, 200).trim() || null
      : data.bio;
  const level =
    typeof data.level === "string" ? data.level.trim() || null : data.level;

  const payload: Record<string, any> = { updatedAt: serverTimestamp() };
  if (typeof cleanModels !== "undefined") payload.racketModels = cleanModels;
  if (typeof fav !== "undefined") payload.favouriteShuttlecock = fav;
  if (typeof bio !== "undefined") payload.bio = bio;
  if (typeof level !== "undefined") payload.level = level;

  await setDoc(ref, payload, { merge: true });
}
export function subscribeUserProfile(
  uid: string,
  onChange: (profile: any | null) => void
) {
  const ref = doc(usersCollection(), uid);
  return onSnapshot(ref, (snap) =>
    onChange(snap.exists() ? (snap.data() as any) : null)
  );
}
export async function claimUsername(uid: string, username: string) {
  const normalized = toUsernameSlug(username);
  if (!normalized || normalized.length < 3)
    throw new Error("Username too short");
  const usernameRef = doc(usernamesCollection(), normalized);
  const userRef = doc(usersCollection(), uid);
  await runTransaction(db, async (tx) => {
    const taken = await tx.get(usernameRef);
    if (taken.exists()) throw new Error("Username is already taken");
    tx.set(usernameRef, { uid, createdAt: serverTimestamp() });
    tx.set(
      userRef,
      { uid, username: normalized, updatedAt: serverTimestamp() },
      { merge: true }
    );
  });
  return normalized;
}

// Change an existing user's username atomically.
// - Validates new username with the same rules as claim (slug + min length)
// - Ensures availability
// - Prevents no-op changes (same username) with a cheeky error message
// - Updates users/{uid}.username and usernames/{new} mapping; removes old mapping if owned
export async function changeUsername(uid: string, newUsername: string) {
  const next = toUsernameSlug(newUsername);
  if (!next || next.length < 3) throw new Error("Username too short");
  const userRef = doc(usersCollection(), uid);
  const nextRef = doc(usernamesCollection(), next);
  let curr: string | undefined = undefined;
  await runTransaction(db, async (tx) => {
    // Read current user to find the old username
    const userSnap = await tx.get(userRef);
    const current = (
      userSnap.exists() ? (userSnap.data() as any)?.username : undefined
    ) as string | undefined;
    curr = (current || "").trim().toLowerCase();

    // Same username? Don't proceed.
    if (curr === next) throw new Error("dont waste my time");

    // Ensure the new username is available
    const nextSnap = await tx.get(nextRef);
    if (nextSnap.exists()) throw new Error("Username is already taken");

    // Create new mapping first
    tx.set(nextRef, { uid, createdAt: serverTimestamp() });

    // Update user doc
    tx.set(
      userRef,
      { uid, username: next, updatedAt: serverTimestamp() },
      { merge: true }
    );
  });

  // Remove old mapping if it exists and belongs to the same uid
  await runTransaction(db, async (tx) => {
    if (curr) {
      const oldRef = doc(usernamesCollection(), curr);
      const oldSnap = await tx.get(oldRef);
      if (oldSnap.exists()) {
        const oldUid = (oldSnap.data() as any)?.uid;
        if (oldUid === uid) tx.delete(oldRef);
      }
    }
  });

  return next;
}

export function subscribeProfileByUsername(
  username: string,
  onChange: (profile: { uid: string; username: string } | null) => void
) {
  const normalized = (username || "").trim().toLowerCase();
  if (!normalized) return () => {};
  const unameRef = doc(usernamesCollection(), normalized);
  const unsubUname = onSnapshot(unameRef, (snap) => {
    if (!snap.exists()) {
      onChange(null);
      return;
    }
    const data = snap.data() as any;
    const uid = data?.uid as string | undefined;
    if (!uid) {
      onChange(null);
      return;
    }
    onChange({ uid, username: normalized });
  });
  return () => {
    unsubUname();
  };
}

export async function getProfileByUsername(
  username: string
): Promise<{ uid: string; username: string } | null> {
  const normalized = (username || "").trim().toLowerCase();
  if (!normalized) return null;
  const unameRef = doc(usernamesCollection(), normalized);
  const unameSnap = await getDoc(unameRef);
  if (!unameSnap.exists()) return null;
  const data = unameSnap.data() as any;
  const uid = data?.uid as string | undefined;
  if (!uid) return null;
  return { uid, username: normalized };
}

// Suggest usernames by prefix (case-insensitive). Returns list of username strings.
export async function suggestUsernames(
  prefix: string,
  limitN: number = 5
): Promise<string[]> {
  const q = (prefix || "").trim().toLowerCase();
  if (!q) return [];
  const col = usernamesCollection();
  const qref = query(
    col,
    orderBy(documentId()),
    startAt(q),
    endAt(q + "\uf8ff"),
    fsLimit(Math.max(1, Math.min(20, limitN)))
  );
  const snap = await getDocs(qref);
  const out: string[] = [];
  snap.forEach((d) => {
    const id = (d.id || "").trim().toLowerCase();
    if (id) out.push(id);
  });
  return out.slice(0, limitN);
}

export function sessionsCollectionForUid(uid: string) {
  return collection(db, usersCollectionId(), uid, "sessions");
}

// Add a new player to an organizer's session by username and link the account.
// - Finds the uid from the `usernames` collection
// - Adds a Player with name = username (if not already present by name)
// - Links player.accountUid = resolved uid
// - Indexes the linked session under that uid
export async function addAndLinkPlayerByUsername(
  organizerUid: string,
  sessionId: string,
  username: string
): Promise<{ playerId: string; uid: string } | null> {
  console.log("addAndLinkPlayerByUsername", organizerUid, sessionId, username);
  const normalized = (username || "").trim().toLowerCase();
  if (!normalized) return null;
  let sessionClubId: string | undefined = undefined;
  const result = await runTransaction(db, async (tx) => {
    // resolve username -> uid
    const unameRef = doc(usernamesCollection(), normalized);
    const unameSnap = await tx.get(unameRef);
    if (!unameSnap.exists()) throw new Error("Username not found");
    const uid = (unameSnap.data() as any)?.uid as string | undefined;
    if (!uid) throw new Error("Username not linked to any account");

    // load organizer session
    const sessionRef = doc(sessionsCollectionForUid(organizerUid), sessionId);
    const sSnap = await tx.get(sessionRef);
    if (!sSnap.exists()) throw new Error("Session not found");
    const data = sSnap.data() as FirestoreSession;
    const payload: any = data.payload || {};
    try {
      const cid = (payload && payload.clubId) || undefined;
      sessionClubId = typeof cid === "string" && cid ? cid : undefined;
    } catch {}
    const players: any[] = Array.isArray(payload.players)
      ? [...payload.players]
      : [];

    // if this uid is already linked to any player in this session, disallow
    const existingByUid = players.find((p) => p && p.accountUid === uid);
    if (existingByUid) {
      throw new Error(
        "This account is already linked to another player in this session"
      );
    }

    // if a player with same username (case-insensitive) exists, link it
    const key = normalized;
    const idxByName = players.findIndex(
      (p) => (p?.name || "").trim().toLowerCase() === key
    );
    let playerId: string;
    if (idxByName !== -1) {
      const before = players[idxByName] || {};
      if (before.accountUid && before.accountUid !== uid)
        throw new Error("Player is already linked to another account");
      playerId =
        before.id || before.playerId || Math.random().toString(36).slice(2, 10);
      // if uid already linked elsewhere (should not happen since existingByUid was null), block
      const linkedElsewhere = players.some(
        (p, i) => i !== idxByName && p && p.accountUid === uid
      );
      if (linkedElsewhere)
        throw new Error("This account is already linked to another player");
      players[idxByName] = {
        ...before,
        name: normalized,
        accountUid: uid,
        accountUsername: normalized,
        linkLocked: true,
        nameBeforeLink: before.name || before.nameBeforeLink,
      };
      console.log("iamhere2", players[idxByName]);
    } else {
      // create new player
      playerId = Math.random().toString(36).slice(2, 10);
      const linkedElsewhere = players.some((p) => p && p.accountUid === uid);
      if (linkedElsewhere)
        throw new Error("This account is already linked to another player");
      players.push({
        id: playerId,
        name: normalized,
        accountUid: uid,
        accountUsername: normalized,
        linkLocked: true,
      });
      console.log("new player", players);
    }

    const nextPayload = stripUndefinedDeep({ ...payload, players });
    const linkedUids = collectLinkedUids(nextPayload);
    tx.set(
      sessionRef,
      {
        id: sessionId,
        payload: nextPayload,
        linkedUids,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    // index under the user's linked sessions
    const idxRef = doc(
      linkedSessionsIndexCol(uid),
      `${organizerUid}_${sessionId}`
    );
    console.log("iamhere");
    tx.set(
      idxRef,
      { organizerUid, sessionId, updatedAt: serverTimestamp() },
      { merge: true }
    );

    return { playerId, uid };
  });

  // Best-effort: if session is a club session, notify worker to update Telegram message
  try {
    if (sessionClubId) {
      const endpoint = (process.env.NEXT_PUBLIC_WORKER_BASE_URL as any)
        ? `${process.env.NEXT_PUBLIC_WORKER_BASE_URL}/telegram/send`
        : "/api/telegram/send";
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clubId: sessionClubId,
          type: "session_updated",
          organizerUid,
          sessionId,
        }),
      });
    }
  } catch {}

  return result;
}

export async function saveSession(sessionId: string, payload: unknown) {
  const uid = auth.currentUser?.uid;
  if (!uid) return; // not signed in; skip
  const ref = doc(sessionsCollectionForUid(uid), sessionId);
  // enforce one-link-per-uid within players before persisting
  let sanitized = payload as any;
  try {
    const p: any = payload as any;
    const arr: any[] = Array.isArray(p?.players) ? [...p.players] : [];
    const seen = new Set<string>();
    const updated = arr.map((pl) => ({ ...(pl || {}) }));
    for (let i = 0; i < updated.length; i++) {
      const au = updated[i]?.accountUid;
      if (typeof au === "string" && au) {
        if (seen.has(au)) {
          const { accountUid, ...rest } = updated[i];
          updated[i] = rest;
        } else {
          seen.add(au);
        }
      }
    }
    sanitized = { ...p, players: updated };
  } catch {}
  const linkedUids = collectLinkedUids(sanitized);
  // Read previous linkedUids to update per-user linkedSessions index
  let prevLinked: string[] = [];
  let prevPayload: any = undefined;
  try {
    const prevSnap = await getDoc(ref);
    if (prevSnap.exists()) {
      const d = prevSnap.data() as any;
      if (Array.isArray(d?.linkedUids)) prevLinked = [...d.linkedUids];
      prevPayload = (d && d.payload) || undefined;
    }
  } catch {}
  await setDoc(
    ref,
    {
      id: sessionId,
      payload: stripUndefinedDeep(sanitized),
      linkedUids,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  // If playerLimit was cleared (undefined), merge doesn't delete nested fields; explicitly delete it.
  try {
    if (typeof (sanitized as any)?.playerLimit === "undefined") {
      await updateDoc(ref, { "payload.playerLimit": deleteField() });
    }
    if (typeof (sanitized as any)?.venue === "undefined") {
      await updateDoc(ref, { "payload.venue": deleteField() });
    }
  } catch {}
  // Index under club if session is sanctioned by a club
  try {
    const clubId: string | undefined = (sanitized as any)?.clubId;
    if (typeof clubId === "string" && clubId) {
      const idxRef = doc(
        collection(db, clubsCollectionId(), clubId, "sessions"),
        `${uid}_${sessionId}`
      );
      const ended = !!(sanitized as any)?.ended;
      const endedAt = (sanitized as any)?.endedAt || undefined;
      await setDoc(
        idxRef,
        {
          organizerUid: uid,
          sessionId,
          clubId,
          ended,
          endedAt,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch {}
  // Sync index docs (users/{uid}/linkedSessions/{organizer_session})
  try {
    const next = new Set(linkedUids || []);
    const prev = new Set(prevLinked || []);
    const added: string[] = [];
    const removed: string[] = [];
    next.forEach((u) => {
      if (!prev.has(u)) added.push(u);
    });
    prev.forEach((u) => {
      if (!next.has(u)) removed.push(u);
    });
    // add new index entries
    await Promise.all(
      added.map(async (u) => {
        const idxRef = doc(linkedSessionsIndexCol(u), `${uid}_${sessionId}`);
        await setDoc(
          idxRef,
          { organizerUid: uid, sessionId, updatedAt: serverTimestamp() },
          { merge: true }
        );
      })
    );
    // remove stale index entries
    await Promise.all(
      removed.map(async (u) => {
        const idxRef = doc(linkedSessionsIndexCol(u), `${uid}_${sessionId}`);
        await deleteDoc(idxRef);
      })
    );
  } catch {}
  // Best-effort: if participants or venue changed, ask worker to edit Telegram message
  try {
    const clubId: string | undefined = (sanitized as any)?.clubId;
    if (typeof clubId === "string" && clubId) {
      const beforeP = (prevPayload as any) || {};
      const afterP = sanitized || {};
      const namesFrom = (p: any): string[] => {
        try {
          const arr: any[] = Array.isArray(p?.players) ? p.players : [];
          return arr
            .map(
              (x) =>
                (x && (x.accountUsername || x.name || "").toString().trim()) ||
                ""
            )
            .filter((s) => !!s)
            .sort();
        } catch {
          return [];
        }
      };
      const beforeNames = namesFrom(beforeP).join("|");
      const afterNames = namesFrom(afterP).join("|");
      const playersChanged = beforeNames !== afterNames;
      const normVenue = (v: any) =>
        (v && v.venue && v.venue.name ? String(v.venue.name) : "")
          .trim()
          .toLowerCase() || "";
      const venueChanged = normVenue(beforeP) !== normVenue(afterP);
      if (playersChanged || venueChanged) {
        const endpoint = (process.env.NEXT_PUBLIC_WORKER_BASE_URL as any)
          ? `${process.env.NEXT_PUBLIC_WORKER_BASE_URL}/telegram/send`
          : "/api/telegram/send";
        try {
          await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              clubId,
              type: "session_updated",
              organizerUid: uid,
              sessionId,
            }),
          });
        } catch {}
      }
    }
  } catch {}
}

// Allow a non-organizer privileged user (e.g., co-organizer) to save into the organizer's session doc.
export async function saveSessionOnBehalf(
  organizerUid: string,
  sessionId: string,
  payload: unknown
) {
  if (!organizerUid) return;
  const ref = doc(sessionsCollectionForUid(organizerUid), sessionId);
  // sanitize players to enforce one-link-per-uid
  let sanitized = payload as any;
  try {
    const p: any = payload as any;
    const arr: any[] = Array.isArray(p?.players) ? [...p.players] : [];
    const seen = new Set<string>();
    const updated = arr.map((pl) => ({ ...(pl || {}) }));
    for (let i = 0; i < updated.length; i++) {
      const au = updated[i]?.accountUid;
      if (typeof au === "string" && au) {
        if (seen.has(au)) {
          const { accountUid, ...rest } = updated[i];
          updated[i] = rest;
        } else {
          seen.add(au);
        }
      }
    }
    sanitized = { ...p, players: updated };
  } catch {}
  const linkedUids = collectLinkedUids(sanitized);
  await setDoc(
    ref,
    {
      id: sessionId,
      payload: stripUndefinedDeep(sanitized),
      linkedUids,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  // If playerLimit was cleared (undefined), merge doesn't delete nested fields; explicitly delete it.
  try {
    if (typeof (sanitized as any)?.playerLimit === "undefined") {
      await updateDoc(ref, { "payload.playerLimit": deleteField() });
    }
  } catch {}
  // Index under club if session is sanctioned by a club
  try {
    const clubId: string | undefined = (sanitized as any)?.clubId;
    if (typeof clubId === "string" && clubId) {
      const idxRef = doc(
        collection(db, clubsCollectionId(), clubId, "sessions"),
        `${organizerUid}_${sessionId}`
      );
      const ended = !!(sanitized as any)?.ended;
      const endedAt = (sanitized as any)?.endedAt || undefined;
      await setDoc(
        idxRef,
        {
          organizerUid,
          sessionId,
          clubId,
          ended,
          endedAt,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch {}
  // update linkedSessions index for any newly linked users
  try {
    const next = new Set(linkedUids || []);
    // We cannot read prev without extra read; skip cleanup for performance
    await Promise.all(
      Array.from(next).map(async (u) => {
        if (u === organizerUid) return;
        const idxRef = doc(
          linkedSessionsIndexCol(u),
          `${organizerUid}_${sessionId}`
        );
        await setDoc(
          idxRef,
          { organizerUid, sessionId, updatedAt: serverTimestamp() },
          { merge: true }
        );
      })
    );
  } catch {}
  // Best-effort: Edit Telegram message if participants or venue changed and session is a club session
  try {
    const clubId: string | undefined = (sanitized as any)?.clubId;
    if (typeof clubId === "string" && clubId) {
      const endpoint = (process.env.NEXT_PUBLIC_WORKER_BASE_URL as any)
        ? `${process.env.NEXT_PUBLIC_WORKER_BASE_URL}/telegram/send`
        : "/api/telegram/send";
      try {
        await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clubId,
            type: "session_updated",
            organizerUid,
            sessionId,
          }),
        });
      } catch {}
    }
  } catch {}
}

export async function createSessionDoc(sessionId: string, payload: unknown) {
  const uid = auth.currentUser?.uid;
  if (!uid) return; // not signed in; skip
  const ref = doc(sessionsCollectionForUid(uid), sessionId);
  const linkedUids = collectLinkedUids(payload);
  await setDoc(
    ref,
    {
      id: sessionId,
      payload: stripUndefinedDeep(payload),
      linkedUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  // If club-sanctioned, index under the club for discovery on club page
  try {
    const clubId: string | undefined = (payload as any)?.clubId;
    if (typeof clubId === "string" && clubId) {
      const idxRef = doc(
        collection(db, clubsCollectionId(), clubId, "sessions"),
        `${uid}_${sessionId}`
      );
      const docInfo = stripUndefinedDeep({
        organizerUid: uid,
        sessionId,
        clubId,
        ended: !!(payload as any)?.ended,
        endedAt: (payload as any)?.endedAt || undefined,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(idxRef, docInfo, { merge: true });
    }
  } catch (e) {
    console.error("Error creating session doc", e);
  }
}

export async function deleteSessionDoc(sessionId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) return; // not signed in; skip
  const ref = doc(sessionsCollectionForUid(uid), sessionId);
  // best-effort: clean up club index if present
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as any;
      const clubId: string | undefined = (data?.payload as any)?.clubId;
      if (typeof clubId === "string" && clubId) {
        try {
          const idxRef = doc(
            collection(db, clubsCollectionId(), clubId, "sessions"),
            `${uid}_${sessionId}`
          );
          await deleteDoc(idxRef);
        } catch {}
        // Update the feed message to indicate session deletion (best-effort)
        try {
          const feedMsgId: string | undefined = (data?.payload as any)
            ?.clubFeedMessageId;
          if (feedMsgId) {
            const feedRef = doc(
              collection(db, clubsCollectionId(), clubId, "feed"),
              feedMsgId
            );
            // resolve username by uid for display
            let actorName = uid;
            try {
              const ucol = usernamesCollection();
              const qs = await getDocs(query(ucol, where("uid", "==", uid)));
              const first = qs.docs[0];
              if (first && first.id) actorName = first.id;
            } catch {}
            await setDoc(
              feedRef,
              {
                message: `Session deleted by @${actorName}`,
                ext: {
                  ...(typeof (data?.payload || {}) === "object"
                    ? (data?.payload as any)
                    : {}),
                  deletedByUid: uid,
                  sessionId,
                },
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          }
        } catch {}
      }
    }
  } catch {}
  await deleteDoc(ref);
}

// Minimal update helper to set Telegram message id without touching players/linked indices
export async function setSessionTelegramMessageId(
  sessionId: string,
  messageId: number
) {
  const uid = auth.currentUser?.uid;
  if (!uid) return; // not signed in; skip
  const ref = doc(sessionsCollectionForUid(uid), sessionId);
  await updateDoc(ref, {
    "payload.telegramMessageId": messageId,
    updatedAt: serverTimestamp(),
  });
}

export async function getSessionDoc(sessionId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const ref = doc(sessionsCollectionForUid(uid), sessionId);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as FirestoreSession) : null;
}

export function subscribeUserSessions(
  uid: string,
  onChange: (sessions: FirestoreSession[]) => void
) {
  const col = sessionsCollectionForUid(uid);
  const unsub = onSnapshot(col, (snap) => {
    const result: FirestoreSession[] = [];
    snap.forEach((d) => {
      const data = d.data() as FirestoreSession;
      result.push({ ...data, id: d.id });
    });
    onChange(result);
  });
  return unsub;
}

// Directly link a claimer's account to a player in an organizer's session.
// Requires Firestore rules to allow this specific write by the claimer.
export async function linkAccountInOrganizerSession(
  organizerUid: string,
  sessionId: string,
  playerId: string,
  claimerUid: string
) {
  const ref = doc(sessionsCollectionForUid(organizerUid), sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Session not found");
  const data = snap.data() as FirestoreSession;
  const payload: any = data.payload || {};
  const players: any[] = Array.isArray(payload.players)
    ? [...payload.players]
    : [];
  const idx = players.findIndex((p) => p && p.id === playerId);
  if (idx === -1) throw new Error("Player not found");
  // Enforce 1:1 mapping strictly
  const alreadyLinkedElsewhere = players.some(
    (p, i) => i !== idx && p && p.accountUid === claimerUid
  );
  if (alreadyLinkedElsewhere)
    throw new Error(
      "Your account is already linked to another player in this session"
    );
  // Block claiming if this player already has a different linked account
  if (players[idx]?.accountUid && players[idx].accountUid !== claimerUid)
    throw new Error("This player is already linked to another account");
  // best-effort: resolve username for storage (optional) for backward compatibility
  let uname: string | undefined;
  try {
    const qref = usernamesCollection();
    const qres = await getDocs(query(qref, where("uid", "==", claimerUid)));
    const first = qres.docs[0];
    if (first) uname = (first.id || "").trim().toLowerCase();
  } catch {}
  players[idx] = {
    ...players[idx],
    accountUid: claimerUid,
    accountUsername: uname || players[idx]?.accountUsername,
    // self-link is user-driven; do not lock, allow unlink
    linkLocked: players[idx]?.linkLocked || false,
    nameBeforeLink: players[idx]?.name || players[idx]?.nameBeforeLink,
  };
  const nextPayload = stripUndefinedDeep({ ...payload, players });
  const linkedUids = collectLinkedUids(nextPayload);
  await setDoc(
    ref,
    {
      id: sessionId,
      payload: nextPayload,
      linkedUids,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  // Also index under the claimer for easy discovery (skip if claimer is the organizer)
  try {
    if (claimerUid !== organizerUid) {
      const idxRef = doc(
        linkedSessionsIndexCol(claimerUid),
        `${organizerUid}_${sessionId}`
      );
      await setDoc(
        idxRef,
        { organizerUid, sessionId, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } else {
      // best-effort cleanup of an accidental self-index
      const idxRef = doc(
        linkedSessionsIndexCol(claimerUid),
        `${organizerUid}_${sessionId}`
      );
      try {
        await deleteDoc(idxRef);
      } catch {}
    }
  } catch {}
}

export async function unlinkAccountInOrganizerSession(
  organizerUid: string,
  sessionId: string,
  playerId: string,
  claimerUid: string
) {
  const ref = doc(sessionsCollectionForUid(organizerUid), sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Session not found");
  const data = snap.data() as FirestoreSession;
  const payload: any = data.payload || {};
  const players: any[] = Array.isArray(payload.players) ? payload.players : [];
  const idx = players.findIndex((p) => p && p.id === playerId);
  if (idx === -1) throw new Error("Player not found");
  const before = players[idx] || {};
  if (before.accountUid !== claimerUid) return; // nothing to do or not allowed
  // Prevent self-unlink if organizer locked this link
  if (before.linkLocked) {
    throw new Error("This link is locked by the organizer");
  }
  const { accountUid, accountUsername, ...rest } = before as any;
  // revert name to nameBeforeLink if present
  const revertedName = before.nameBeforeLink || rest.name;
  const { nameBeforeLink, linkLocked, ...restNoMeta } = rest as any;
  players[idx] = { ...restNoMeta, name: revertedName };
  // also remove from coOrganizerUids if present
  const co = Array.isArray(payload.coOrganizerUids)
    ? (payload.coOrganizerUids as string[]).filter((u) => u !== claimerUid)
    : undefined;
  const nextPayload = stripUndefinedDeep({
    ...payload,
    players,
    coOrganizerUids: co,
  });
  const linkedUids = collectLinkedUids(nextPayload);
  await setDoc(
    ref,
    {
      id: sessionId,
      payload: nextPayload,
      linkedUids,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  // remove index entry
  try {
    const idxRef = doc(
      linkedSessionsIndexCol(claimerUid),
      `${organizerUid}_${sessionId}`
    );
    await deleteDoc(idxRef);
  } catch {}
}

export async function organizerUnlinkPlayer(
  organizerUid: string,
  sessionId: string,
  playerId: string
) {
  const ref = doc(sessionsCollectionForUid(organizerUid), sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Session not found");
  const data = snap.data() as FirestoreSession;
  const payload: any = data.payload || {};
  const players: any[] = Array.isArray(payload.players) ? payload.players : [];
  const idx = players.findIndex((p) => p && p.id === playerId);
  if (idx === -1) throw new Error("Player not found");
  const before = players[idx] || {};
  const linkedUid: string | undefined =
    typeof before.accountUid === "string" ? before.accountUid : undefined;
  const { accountUid, accountUsername, ...rest } = before as any;
  // Revert name to nameBeforeLink if present (same semantics as self-unlink)
  const revertedName = before.nameBeforeLink || rest.name;
  const { nameBeforeLink, linkLocked, ...restNoMeta } = rest as any;
  players[idx] = { ...restNoMeta, name: revertedName };
  // if linked uid existed, drop from coOrganizerUids
  const co = Array.isArray(payload.coOrganizerUids)
    ? (payload.coOrganizerUids as string[]).filter((u) => u !== linkedUid)
    : undefined;
  const nextPayload = stripUndefinedDeep({
    ...payload,
    players,
    coOrganizerUids: co,
  });
  const linkedUids = collectLinkedUids(nextPayload);
  await setDoc(
    ref,
    {
      id: sessionId,
      payload: nextPayload,
      linkedUids,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  if (linkedUid) {
    try {
      const idxRef = doc(
        linkedSessionsIndexCol(linkedUid),
        `${organizerUid}_${sessionId}`
      );
      await deleteDoc(idxRef);
    } catch {}
  }
}

// Fallback: subscribe to per-user linked sessions index under users/{uid}/linkedSessions
function linkedSessionsIndexCol(uid: string) {
  return collection(db, usersCollectionId(), uid, "linkedSessions");
}

export function subscribeLinkedSessions(
  uid: string,
  onChange: (
    sessions: { doc: FirestoreSession; organizerUid: string }[]
  ) => void
) {
  const unsub = onSnapshot(linkedSessionsIndexCol(uid), async (snap) => {
    const entries: { organizerUid: string; sessionId: string }[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      if (
        data &&
        typeof data.organizerUid === "string" &&
        typeof data.sessionId === "string"
      ) {
        entries.push({
          organizerUid: data.organizerUid,
          sessionId: data.sessionId,
        });
      }
    });
    if (!entries.length) {
      onChange([]);
      return;
    }
    try {
      const docs = await Promise.all(
        entries.map(async (e) => {
          const ref = doc(
            sessionsCollectionForUid(e.organizerUid),
            e.sessionId
          );
          const s = await getDoc(ref);
          return s.exists()
            ? {
                doc: s.data() as FirestoreSession,
                organizerUid: e.organizerUid,
              }
            : null;
        })
      );
      onChange(
        docs.filter(Boolean) as {
          doc: FirestoreSession;
          organizerUid: string;
        }[]
      );
    } catch {
      onChange([]);
    }
  });
  return unsub;
}

// Subscribe to all sessions sanctioned by a club, using club-level index docs.
export function subscribeClubSessions(
  clubId: string,
  onChange: (
    sessions: { doc: FirestoreSession; organizerUid: string }[]
  ) => void
) {
  if (!clubId) return () => {};
  const idxCol = collection(db, clubsCollectionId(), clubId, "sessions");
  const unsub = onSnapshot(idxCol, async (snap) => {
    const entries: { organizerUid: string; sessionId: string }[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      if (
        data &&
        typeof data.organizerUid === "string" &&
        typeof data.sessionId === "string"
      ) {
        entries.push({
          organizerUid: data.organizerUid,
          sessionId: data.sessionId,
        });
      }
    });
    if (!entries.length) {
      onChange([]);
      return;
    }
    try {
      const docs = await Promise.all(
        entries.map(async (e) => {
          const ref = doc(
            sessionsCollectionForUid(e.organizerUid),
            e.sessionId
          );
          const s = await getDoc(ref);
          return s.exists()
            ? {
                doc: s.data() as FirestoreSession,
                organizerUid: e.organizerUid,
              }
            : null;
        })
      );
      onChange(
        docs.filter(Boolean) as any as {
          doc: FirestoreSession;
          organizerUid: string;
        }[]
      );
    } catch {
      onChange([]);
    }
  });
  return unsub;
}

// Subscribe to a single session by id for the current user. Resolves organizer first.
export function subscribeSessionById(
  currentUid: string,
  sessionId: string,
  onChange: (
    info: { doc: FirestoreSession; organizerUid: string } | null
  ) => void
) {
  const ownRef = doc(sessionsCollectionForUid(currentUid), sessionId);
  let unsubOwn: (() => void) | null = null;
  let unsubIndex: (() => void) | null = null;
  let unsubOrg: (() => void) | null = null;
  let linkedChecked = false;
  let organizerActive = false;

  function cleanup() {
    if (unsubOwn) unsubOwn();
    if (unsubIndex) unsubIndex();
    if (unsubOrg) unsubOrg();
  }

  unsubOwn = onSnapshot(ownRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data() as FirestoreSession;
      onChange({ doc: data, organizerUid: currentUid });
    } else if (linkedChecked && !organizerActive) {
      onChange(null);
    }
  });

  const idxCol = collection(
    db,
    usersCollectionId(),
    currentUid,
    "linkedSessions"
  );
  unsubIndex = onSnapshot(idxCol, async (snap) => {
    linkedChecked = true;
    let foundOrganizer: string | null = null;
    snap.forEach((d) => {
      const data = d.data() as any;
      if (
        data &&
        typeof data.organizerUid === "string" &&
        typeof data.sessionId === "string" &&
        data.sessionId === sessionId
      ) {
        foundOrganizer = data.organizerUid;
      }
    });
    if (!foundOrganizer) {
      const ownSnap = await getDoc(ownRef);
      if (!ownSnap.exists()) onChange(null);
      if (unsubOrg) {
        unsubOrg();
        unsubOrg = null;
      }
      return;
    }
    const orgRef = doc(sessionsCollectionForUid(foundOrganizer), sessionId);
    if (unsubOrg) unsubOrg();
    organizerActive = true;
    unsubOrg = onSnapshot(orgRef, (s) => {
      if (!s.exists()) {
        onChange(null);
        return;
      }
      onChange({
        doc: s.data() as FirestoreSession,
        organizerUid: foundOrganizer!,
      });
    });
  });

  return cleanup;
}

// ----------
// Utilities
// ----------

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    const filtered = (value as unknown as any[]).filter(
      (v) => typeof v !== "undefined"
    );
    return filtered.map((v) => stripUndefinedDeep(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (typeof v === "undefined") continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

function collectLinkedUids(payload: unknown): string[] {
  try {
    const p: any = payload as any;
    const arr: any[] = Array.isArray(p?.players) ? p.players : [];
    const set = new Set<string>();
    for (const pl of arr) {
      if (pl && typeof pl.accountUid === "string" && pl.accountUid)
        set.add(pl.accountUid);
    }
    return Array.from(set);
  } catch {
    return [];
  }
}
