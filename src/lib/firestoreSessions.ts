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
function usersCollection() {
  return collection(db, "users");
}
function usernamesCollection() {
  return collection(db, "usernames");
}
export async function getUserProfile(uid: string) {
  const ref = doc(usersCollection(), uid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as any) : null;
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

function sessionsCollectionForUid(uid: string) {
  return collection(db, "users", uid, "sessions");
}

export async function saveSession(sessionId: string, payload: unknown) {
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
  const players: any[] = Array.isArray(payload.players) ? payload.players : [];
  const idx = players.findIndex((p) => p && p.id === playerId);
  if (idx === -1) throw new Error("Player not found");
  players[idx] = { ...players[idx], accountUid: claimerUid };
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
  return collection(db, "users", uid, "linkedSessions");
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

  const idxCol = collection(db, "users", currentUid, "linkedSessions");
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
    return value.map((v) => stripUndefinedDeep(v)) as unknown as T;
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
