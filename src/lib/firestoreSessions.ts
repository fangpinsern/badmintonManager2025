import { auth, db } from "./firebase";
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
  const normalized = (username || "").trim().toLowerCase();
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

function sessionsCollectionForUid(uid: string) {
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
  const normalized = (username || "").trim().toLowerCase();
  if (!normalized) return null;
  return await runTransaction(db, async (tx) => {
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
    const players: any[] = Array.isArray(payload.players)
      ? [...payload.players]
      : [];

    // if a player already linked to this uid exists, do nothing (idempotent)
    const existingByUid = players.find((p) => p && p.accountUid === uid);
    if (existingByUid) {
      // ensure name is set to the username
      const idx = players.findIndex((p) => p && p.id === existingByUid.id);
      if (idx !== -1)
        players[idx] = {
          ...existingByUid,
          name: normalized,
          linkLocked: true,
          nameBeforeLink: existingByUid.name || existingByUid.nameBeforeLink,
        };
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
      // ensure index
      const idxRef = doc(
        linkedSessionsIndexCol(uid),
        `${organizerUid}_${sessionId}`
      );
      tx.set(
        idxRef,
        { organizerUid, sessionId, updatedAt: serverTimestamp() },
        { merge: true }
      );
      return { playerId: existingByUid.id, uid };
    }

    // if a player with same username (case-insensitive) exists, link it
    const key = normalized;
    const idxByName = players.findIndex(
      (p) => (p?.name || "").trim().toLowerCase() === key
    );
    let playerId: string;
    if (idxByName !== -1) {
      const before = players[idxByName] || {};
      playerId =
        before.id || before.playerId || Math.random().toString(36).slice(2, 10);
      // clear any previous link of this uid on other players
      for (let i = 0; i < players.length; i++) {
        if (i === idxByName) continue;
        const pl = players[i] || {};
        if (pl.accountUid === uid) {
          const { accountUid, ...rest } = pl;
          players[i] = rest;
        }
      }
      players[idxByName] = {
        ...before,
        name: normalized,
        accountUid: uid,
        linkLocked: true,
        nameBeforeLink: before.name || before.nameBeforeLink,
      };
    } else {
      // create new player
      playerId = Math.random().toString(36).slice(2, 10);
      // clear any previous link of this uid on other players
      for (let i = 0; i < players.length; i++) {
        const pl = players[i] || {};
        if (pl.accountUid === uid) {
          const { accountUid, ...rest } = pl;
          players[i] = rest;
        }
      }
      players.push({
        id: playerId,
        name: normalized,
        accountUid: uid,
        linkLocked: true,
      });
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
    tx.set(
      idxRef,
      { organizerUid, sessionId, updatedAt: serverTimestamp() },
      { merge: true }
    );

    return { playerId, uid };
  });
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
}

export async function deleteSessionDoc(sessionId: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) return; // not signed in; skip
  const ref = doc(sessionsCollectionForUid(uid), sessionId);
  await deleteDoc(ref);
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
  // ensure this uid is not linked elsewhere in this session
  for (let i = 0; i < players.length; i++) {
    if (i === idx) continue;
    const pl = players[i] || {};
    if (pl.accountUid === claimerUid) {
      const { accountUid, ...rest } = pl;
      players[i] = rest;
    }
  }
  // resolve username for this uid via usernames collection (reverse lookup)
  let uname = players[idx]?.name;
  try {
    // reverse lookup by uid; usernames documents store { uid } and id is the username
    // this requires a composite index-free simple where query
    const qref = usernamesCollection();
    const qres = await getDocs(query(qref, where("uid", "==", claimerUid)));
    const first = qres.docs[0];
    if (first) uname = (first.id || "").trim().toLowerCase();
  } catch {}
  players[idx] = {
    ...players[idx],
    name: uname || players[idx]?.name,
    accountUid: claimerUid,
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
  // Also index under the claimer for easy discovery
  try {
    const idxRef = doc(
      linkedSessionsIndexCol(claimerUid),
      `${organizerUid}_${sessionId}`
    );
    await setDoc(
      idxRef,
      { organizerUid, sessionId, updatedAt: serverTimestamp() },
      { merge: true }
    );
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
  const { accountUid, ...rest } = before;
  // revert name to nameBeforeLink if present
  const revertedName = before.nameBeforeLink || rest.name;
  const { nameBeforeLink, linkLocked, ...restNoMeta } = rest as any;
  players[idx] = { ...restNoMeta, name: revertedName };
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
  const { accountUid, ...rest } = before;
  players[idx] = { ...rest };
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
          console.log("iamhere", s.data());
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
