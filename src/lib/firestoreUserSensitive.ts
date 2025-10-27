import { db } from "@/lib/firebase";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";

// Test mode flag mirrors firestoreSessions.ts
const isTestMode =
  typeof process !== "undefined" &&
  typeof process.env !== "undefined" &&
  (String(process.env.NEXT_PUBLIC_TEST_MODE || "").toLowerCase() === "true" ||
    String(process.env.NEXT_PUBLIC_TEST_MODE || "") === "1");

function userSensitiveCollectionId(): string {
  return isTestMode ? "userSensitive_test" : "userSensitive";
}

function userSensitiveDoc(uid: string) {
  return doc(db, userSensitiveCollectionId(), uid);
}

export type UserSensitive = {
  email?: string | null;
  notifications?: {
    calendarInvites?: {
      enabled?: boolean;
    };
  };
};

export async function getUserSensitive(
  uid: string
): Promise<UserSensitive | null> {
  const ref = userSensitiveDoc(uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return (snap.data() as UserSensitive) || null;
}

export function subscribeUserSensitive(
  uid: string,
  onChange: (data: UserSensitive | null) => void
) {
  const ref = userSensitiveDoc(uid);
  return onSnapshot(
    ref,
    (snap) =>
      onChange(snap.exists() ? (snap.data() as UserSensitive) || null : null),
    () => onChange(null)
  );
}

export async function saveUserSensitive(
  uid: string,
  data: Partial<UserSensitive>
): Promise<void> {
  const ref = userSensitiveDoc(uid);
  await setDoc(ref, data as any, { merge: true });
}
