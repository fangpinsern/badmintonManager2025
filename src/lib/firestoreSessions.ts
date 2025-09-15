import { auth, db } from "./firebase";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";

export type FirestoreSession = {
  id: string;
  payload: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function sessionsCollectionForUid(uid: string) {
  return collection(db, "users", uid, "sessions");
}

export async function saveSession(sessionId: string, payload: unknown) {
  const uid = auth.currentUser?.uid;
  if (!uid) return; // not signed in; skip
  const ref = doc(sessionsCollectionForUid(uid), sessionId);
  await setDoc(
    ref,
    {
      id: sessionId,
      payload,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function createSessionDoc(sessionId: string, payload: unknown) {
  const uid = auth.currentUser?.uid;
  if (!uid) return; // not signed in; skip
  const ref = doc(sessionsCollectionForUid(uid), sessionId);
  await setDoc(
    ref,
    {
      id: sessionId,
      payload,
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


