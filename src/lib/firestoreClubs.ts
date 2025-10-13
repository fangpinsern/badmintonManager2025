import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  query,
  where,
  and as fsAnd,
  or as fsOr,
  runTransaction,
  serverTimestamp,
  getDocs,
  orderBy,
  limit as fsLimit,
  startAfter,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { suggestUsernames } from "@/lib/firestoreSessions";

// Test mode flag mirrors firestoreSessions.ts
const isTestMode =
  typeof process !== "undefined" &&
  typeof process.env !== "undefined" &&
  (String(process.env.NEXT_PUBLIC_TEST_MODE || "").toLowerCase() === "true" ||
    String(process.env.NEXT_PUBLIC_TEST_MODE || "") === "1");

function clubsCollectionId(): string {
  return isTestMode ? "clubs_test" : "clubs";
}

function clubSensitiveCollectionId(): string {
  return isTestMode ? "clubSensitive_test" : "clubSensitive";
}

function usernamesCollectionIdLocal(): string {
  return isTestMode ? "usernames_test" : "usernames";
}

function clubsCollection() {
  return collection(db, clubsCollectionId());
}

function clubDoc(id: string) {
  return doc(clubsCollection(), id);
}

function clubSensitiveDoc(id: string) {
  // Top-level sensitive document: clubSensitive/{clubId}
  // Used for token query and consolidated sensitive state
  return doc(db, clubSensitiveCollectionId(), id);
}

function clubSensitiveNotificationsDoc(id: string) {
  // Sub-document for notifications: clubSensitive/{clubId}/sensitive/notifications
  // UI reads from this doc; rules can be scoped tightly
  return doc(db, clubSensitiveCollectionId(), id, "sensitive", "notifications");
}

function clubFeedCollection(clubId: string) {
  return collection(db, clubsCollectionId(), clubId, "feed");
}

export type FirestoreClub = {
  id: string;
  name: string;
  ownerUid: string;
  memberUids: string[]; // includes owner
  // visibility controls whether non-members can view the club details
  // default unspecified/"public" for backwards compatibility
  visibility?: "public" | "private";
  createdAt?: unknown;
  updatedAt?: unknown;
};

// Optional Telegram settings for clubs. Additive and backward-compatible.
export type ClubTelegramSettings = {
  linkState?: "unlinked" | "pending" | "linked" | "disconnected";
  chatId?: number;
  groupTitle?: string;
  groupUsername?: string; // if public
  linkToken?: string; // one-time, short TTL
  tz?: string; // e.g., "Asia/Singapore"
  enabled?: boolean; // global on/off switch
  notifications?: {
    sessionCreated?: { enabled?: boolean; templateId?: string };
    reminders?: {
      enabled?: boolean;
      schedule?: string[]; // e.g., ["-24h", "-2h"]
      templateId?: string;
    };
    monthlySummary?: {
      enabled?: boolean;
      dayOfMonth?: number;
      hour?: number; // 0-23 local hour
      templateId?: string;
    };
  };
  allowCommandsFrom?: "adminsOnly" | "anyMember";
};

export type FirestoreClubFeed = {
  id: string;
  type: "system" | "join" | "leave" | "kick" | "session";
  message: string;
  actorUid?: string;
  // For type 'session', link to the created session and record organizer
  sessionId?: string;
  organizerUid?: string;
  // Extension payload for richer details based on type (e.g. session metadata)
  ext?: any;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function subscribeMyClubs(
  uid: string,
  onChange: (clubs: FirestoreClub[]) => void
) {
  // Query by membership; sort client-side to avoid composite index requirements
  const qref = query(
    clubsCollection(),
    where("memberUids", "array-contains", uid)
  );
  return onSnapshot(
    qref,
    (snap) => {
      const result: FirestoreClub[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        result.push({ id: d.id, ...(data as any) });
      });
      // Sort newest first using createdAt if present, otherwise by id
      result.sort((a, b) => {
        const ta = (a.createdAt as any)?.toMillis?.() || 0;
        const tb = (b.createdAt as any)?.toMillis?.() || 0;
        if (tb !== ta) return tb - ta;
        return (b.id || "").localeCompare(a.id || "");
      });
      onChange(result);
    },
    (err) => {
      console.error(err);
    }
  );
}

export function subscribeClub(
  clubId: string,
  onChange: (club: FirestoreClub | null) => void,
  onError?: (error: any) => void,
  viewerUid?: string
) {
  // If a viewer uid is provided, apply a visibility/membership filter:
  // (id == clubId AND visibility == "public") OR (id == clubId AND memberUids array-contains viewerUid)
  console.log("viewerUid", viewerUid);
  if (viewerUid) {
    const qref = query(
      clubsCollection(),
      fsOr(
        fsAnd(where("id", "==", clubId), where("visibility", "==", "public")),
        fsAnd(
          where("id", "==", clubId),
          where("memberUids", "array-contains", viewerUid)
        )
      )
    );
    return onSnapshot(
      qref,
      (snap) => {
        const first = snap.docs[0];
        if (!first) return onChange(null);
        const data = first.data() as any;
        onChange({ id: first.id, ...(data as any) });
      },
      (err) => {
        if (onError) onError(err);
      }
    );
  }
  // Fallback: original behavior (no filtering)
  // const ref = clubDoc(clubId);
  // return onSnapshot(
  //   ref,
  //   (snap) => {
  //     if (!snap.exists()) return onChange(null);
  //     const data = snap.data() as any;
  //     onChange({ id: snap.id, ...(data as any) });
  //   },
  //   (err) => {
  //     if (onError) onError(err);
  //   }
  // );
  if (onError) onError(new Error("no permission"));
}

// Subscribe to sensitive club notification settings (separate, rule-protected doc)
export function subscribeClubNotifications(
  clubId: string,
  onChange: (noti: { telegram?: ClubTelegramSettings } | null) => void
) {
  const ref = clubSensitiveDoc(clubId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return onChange(null);
      const data = snap.data() as any;
      onChange({ telegram: data?.telegram });
    },
    (err) => {
      console.error(err);
      onChange(null);
    }
  );
}

export function subscribeClubFeed(
  clubId: string,
  limitN: number,
  onChange: (feed: FirestoreClubFeed[]) => void
) {
  // Order by createdAt desc; if index is missing, Firestore will surface it
  const qref = query(
    clubFeedCollection(clubId),
    orderBy("createdAt", "desc"),
    fsLimit(Math.max(1, Math.min(100, limitN)))
  );
  return onSnapshot(qref, (snap) => {
    const items: FirestoreClubFeed[] = [];
    snap.forEach((d) => items.push({ id: d.id, ...(d.data() as any) }));
    onChange(items);
  });
}

// Create a feed message of type 'session' for a club. Returns the new feed doc id.
export async function createClubSessionFeedMessage(
  clubId: string,
  actorUid: string,
  sessionId: string,
  opts?: { message?: string; ext?: any }
): Promise<string> {
  if (!clubId || !actorUid || !sessionId) throw new Error("invalid args");
  const feed = clubFeedCollection(clubId);
  const ref = doc(feed);
  await setDoc(ref, {
    type: "session",
    message: opts?.message || "Session created",
    actorUid,
    organizerUid: actorUid,
    sessionId,
    ext: opts?.ext,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } as Omit<FirestoreClubFeed, "id">);
  return ref.id;
}

export async function createClubRemote(
  ownerUid: string,
  name: string,
  initialUsernames: string[],
  visibility?: "public" | "private"
): Promise<string> {
  const cleanName = (name || "").trim();
  if (!ownerUid) throw new Error("Not signed in");
  if (!cleanName) throw new Error("Club name required");
  const normalized = Array.from(
    new Set(
      (initialUsernames || [])
        .map((s) =>
          String(s || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  ).slice(0, 29); // owner counts as 1

  // Pre-resolve usernames -> uids outside tx to reduce contention
  const resolved: { uid: string; username: string }[] = [];
  if (normalized.length) {
    const chunks: string[][] = [];
    for (let i = 0; i < normalized.length; i += 10) {
      chunks.push(normalized.slice(i, i + 10));
    }
    for (const group of chunks) {
      // fetch each username doc; group queries are not available for document IDs, so do individual reads
      const reads = await Promise.all(
        group.map(async (uname) => {
          const ref = doc(db, usernamesCollectionIdLocal(), uname);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const uid = (snap.data() as any)?.uid as string | undefined;
            if (uid) return { uid, username: uname };
          }
          return null;
        })
      );
      reads.forEach((r) => {
        if (r && r.uid) resolved.push(r);
      });
    }
  }

  const id = doc(clubsCollection()).id;
  await runTransaction(db, async (tx) => {
    const members = Array.from(
      new Set([ownerUid, ...resolved.map((r) => r.uid)])
    ).slice(0, 30);
    const ref = clubDoc(id);
    const exists = await tx.get(ref);
    if (exists.exists()) throw new Error("ID collision; retry");
    tx.set(ref, {
      id,
      name: cleanName,
      ownerUid,
      memberUids: members,
      visibility: visibility === "private" ? "private" : "public",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as FirestoreClub);
    const feed = clubFeedCollection(id);
    tx.set(doc(feed), {
      type: "system",
      message: "Club created",
      actorUid: ownerUid,
      createdAt: serverTimestamp(),
    } as Omit<FirestoreClubFeed, "id">);
    const addedUsernames = resolved.map((r) => r.username);
    if (addedUsernames.length) {
      tx.set(doc(feed), {
        type: "join",
        message: `Members added: ${addedUsernames.join(", ")}`,
        actorUid: ownerUid,
        createdAt: serverTimestamp(),
      } as Omit<FirestoreClubFeed, "id">);
    }
  });
  return id;
}

export async function joinClubRemote(
  clubId: string,
  uid: string
): Promise<void> {
  if (!uid) throw new Error("Not signed in");
  const ref = clubDoc(clubId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Club not found");
    const data = snap.data() as any as FirestoreClub;
    // prevent joining private clubs by non-members
    if ((data.visibility || "public") === "private") {
      throw new Error("Club is private");
    }
    const set = new Set<string>(
      Array.isArray(data.memberUids) ? data.memberUids : []
    );
    if (set.has(uid)) return; // already a member
    if (set.size >= 30) throw new Error("Club is full");
    set.add(uid);
    tx.set(
      ref,
      { memberUids: Array.from(set), updatedAt: serverTimestamp() },
      { merge: true }
    );
    tx.set(doc(clubFeedCollection(clubId)), {
      type: "join",
      message: "User joined the club",
      actorUid: uid,
      createdAt: serverTimestamp(),
    } as Omit<FirestoreClubFeed, "id">);
  });
}

export async function leaveClubRemote(
  clubId: string,
  uid: string
): Promise<void> {
  if (!uid) throw new Error("Not signed in");
  // best-effort resolve username for feed message
  let leavingUsername: string | "" = "";
  try {
    const qref = query(
      collection(db, usernamesCollectionIdLocal()),
      where("uid", "==", uid)
    );
    const snap = await getDocs(qref);
    const first = snap.docs[0];
    if (first) leavingUsername = (first.id || "").trim().toLowerCase();
  } catch {}
  const ref = clubDoc(clubId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Club not found");
    const data = snap.data() as any as FirestoreClub;
    if (data.ownerUid === uid) throw new Error("Owner cannot leave their club");
    const list = Array.isArray(data.memberUids) ? [...data.memberUids] : [];
    const next = list.filter((u) => u !== uid);
    if (next.length === list.length) return; // not a member
    tx.set(
      ref,
      { memberUids: next, updatedAt: serverTimestamp() },
      { merge: true }
    );
    tx.set(doc(clubFeedCollection(clubId)), {
      type: "leave",
      message: leavingUsername
        ? `Member left: @${leavingUsername}`
        : "User left the club",
      actorUid: uid,
      ext: {
        userId: uid,
        username: leavingUsername || "",
      },
      createdAt: serverTimestamp(),
    } as Omit<FirestoreClubFeed, "id">);
  });
}

export async function addMemberByUsernameRemote(
  clubId: string,
  actorUid: string,
  username: string
): Promise<void> {
  const uname = (username || "").trim().toLowerCase();
  if (!uname) return;
  const unameRef = doc(db, usernamesCollectionIdLocal(), uname);
  const unameSnap = await getDoc(unameRef);
  if (!unameSnap.exists()) throw new Error("Username not found");
  const targetUid = (unameSnap.data() as any)?.uid as string | undefined;
  if (!targetUid) throw new Error("Username not linked to any account");
  const ref = clubDoc(clubId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Club not found");
    const data = snap.data() as any as FirestoreClub;
    if (data.ownerUid !== actorUid)
      throw new Error("Only owner can add members");
    const set = new Set<string>(
      Array.isArray(data.memberUids) ? data.memberUids : []
    );
    if (set.has(targetUid)) return; // already a member
    if (set.size >= 30) throw new Error("Club is full");
    set.add(targetUid);
    tx.set(
      ref,
      { memberUids: Array.from(set), updatedAt: serverTimestamp() },
      { merge: true }
    );
    tx.set(doc(clubFeedCollection(clubId)), {
      type: "join",
      message: `Member added: @${uname}`,
      ext: {
        username: uname,
        userId: targetUid,
      },
      actorUid: actorUid,
      createdAt: serverTimestamp(),
    } as Omit<FirestoreClubFeed, "id">);
  });
}

// Batch add multiple usernames as members in a single transaction.
// Ensures only new users are added (no duplicates) and posts a single feed message.
export async function addMembersByUsernamesRemote(
  clubId: string,
  actorUid: string,
  usernames: string[]
): Promise<{ added: string[]; skipped: string[] }> {
  const normalized = Array.from(
    new Set(
      (usernames || [])
        .map((s) =>
          String(s || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  ).slice(0, 50);
  if (!normalized.length) return { added: [], skipped: [] };

  // Resolve usernames -> uids (best-effort; skip those not found)
  const resolved: { username: string; uid: string }[] = [];
  for (let i = 0; i < normalized.length; i += 10) {
    const chunk = normalized.slice(i, i + 10);
    const reads = await Promise.all(
      chunk.map(async (uname) => {
        const ref = doc(db, usernamesCollectionIdLocal(), uname);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const uid = (snap.data() as any)?.uid as string | undefined;
          if (uid) return { username: uname, uid };
        }
        return null;
      })
    );
    reads.forEach((r) => {
      if (r && r.uid) resolved.push(r);
    });
  }
  if (!resolved.length) return { added: [], skipped: normalized };

  const ref = clubDoc(clubId);
  let addedUsernames: string[] = [];
  let skipped: string[] = [];
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Club not found");
    const data = snap.data() as any as FirestoreClub;
    if (data.ownerUid !== actorUid)
      throw new Error("Only owner can add members");
    const existing = new Set<string>(
      Array.isArray(data.memberUids) ? data.memberUids : []
    );
    const capacityLeft = Math.max(0, 30 - existing.size);
    const toAdd = resolved
      .filter((r) => !existing.has(r.uid))
      .slice(0, capacityLeft);
    addedUsernames = toAdd.map((r) => r.username);
    skipped = normalized.filter((u) => !addedUsernames.includes(u));
    if (toAdd.length) {
      const next = Array.from(
        new Set([...existing, ...toAdd.map((r) => r.uid)])
      );
      tx.set(
        ref,
        { memberUids: next, updatedAt: serverTimestamp() },
        { merge: true }
      );
      tx.set(doc(clubFeedCollection(clubId)), {
        type: "join",
        message:
          addedUsernames.length === 1
            ? `Member added: @${addedUsernames[0]}`
            : `Members added: ${addedUsernames.map((u) => `@${u}`).join(", ")}`,
        actorUid: actorUid,
        createdAt: serverTimestamp(),
      } as Omit<FirestoreClubFeed, "id">);
    }
  });
  return { added: addedUsernames, skipped };
}

export async function kickMemberRemote(
  clubId: string,
  actorUid: string,
  targetUid: string
): Promise<void> {
  // best-effort resolve username for feed message
  let targetUsername: string | "" = "";
  try {
    const qref = query(
      collection(db, usernamesCollectionIdLocal()),
      where("uid", "==", targetUid)
    );
    const snap = await getDocs(qref);
    const first = snap.docs[0];
    if (first) targetUsername = (first.id || "").trim().toLowerCase();
  } catch {}
  const ref = clubDoc(clubId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Club not found");
    const data = snap.data() as any as FirestoreClub;
    if (data.ownerUid !== actorUid)
      throw new Error("Only owner can remove members");
    const list = Array.isArray(data.memberUids) ? [...data.memberUids] : [];
    const m = list.find((u) => u === targetUid);
    if (!m) return;
    if (targetUid === data.ownerUid) throw new Error("Cannot remove the owner");
    const next = list.filter((u) => u !== targetUid);
    tx.set(
      ref,
      { memberUids: next, updatedAt: serverTimestamp() },
      { merge: true }
    );
    tx.set(doc(clubFeedCollection(clubId)), {
      type: "kick",
      message: `Member removed: ${targetUsername || targetUid}`,
      actorUid: actorUid,
      createdAt: serverTimestamp(),
    } as Omit<FirestoreClubFeed, "id">);
  });
}

export async function renameClubRemote(
  clubId: string,
  actorUid: string,
  name: string
): Promise<void> {
  const ref = clubDoc(clubId);
  const clean = (name || "").trim();
  if (!clean) return;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Club not found");
    const data = snap.data() as any as FirestoreClub;
    if (data.ownerUid !== actorUid) throw new Error("Only owner can rename");
    const prevName = String((data as any)?.name || "").trim();
    tx.set(ref, { name: clean, updatedAt: serverTimestamp() }, { merge: true });
    tx.set(doc(clubFeedCollection(clubId)), {
      type: "system",
      message: prevName
        ? `Club renamed from "${prevName}" to "${clean}"`
        : `Club renamed to "${clean}"`,
      actorUid: actorUid,
      createdAt: serverTimestamp(),
    } as Omit<FirestoreClubFeed, "id">);
  });
}

export async function updateClubVisibilityRemote(
  clubId: string,
  actorUid: string,
  visibility: "public" | "private"
): Promise<void> {
  const ref = clubDoc(clubId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Club not found");
    const data = snap.data() as any as FirestoreClub;
    if (data.ownerUid !== actorUid)
      throw new Error("Only owner can change visibility");
    const prev = (data.visibility || "public") as "public" | "private";
    if (prev === visibility) return;
    tx.set(ref, { visibility, updatedAt: serverTimestamp() }, { merge: true });
    tx.set(doc(clubFeedCollection(clubId)), {
      type: "system",
      message:
        visibility === "private"
          ? "Club visibility changed to private"
          : "Club visibility changed to public",
      actorUid: actorUid,
      createdAt: serverTimestamp(),
    } as Omit<FirestoreClubFeed, "id">);
  });
}

export async function resolveUsernamesForUids(
  uids: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const uniq = Array.from(new Set((uids || []).filter(Boolean)));
  for (let i = 0; i < uniq.length; i += 10) {
    const chunk = uniq.slice(i, i + 10);
    // There is no direct index from uid -> username; query by where('uid','==',uid) per uid because 'in' uses up to 10 values but we need separate queries per uid
    const reads = await Promise.all(
      chunk.map(async (uid) => {
        const qref = query(
          collection(db, usernamesCollectionIdLocal()),
          where("uid", "==", uid)
        );
        const snap = await getDocs(qref);
        const first = snap.docs[0];
        if (first) return { uid, username: first.id };
        return { uid, username: "" };
      })
    );
    reads.forEach((r) => {
      if (r && r.username) out[r.uid] = r.username;
    });
  }
  return out;
}

export { suggestUsernames };

// Pagination helpers for club feed (20 per page recommended)
export async function getClubFeedPage(
  clubId: string,
  limitN: number,
  afterCreatedAt?: any
): Promise<{
  items: FirestoreClubFeed[];
  cursor: any | null;
  hasMore: boolean;
}> {
  const constraints: any[] = [
    orderBy("createdAt", "desc"),
    fsLimit(Math.max(1, Math.min(100, limitN))),
  ];
  if (afterCreatedAt) constraints.push(startAfter(afterCreatedAt));
  const qref = query(clubFeedCollection(clubId), ...constraints);
  const snap = await getDocs(qref);
  const items: FirestoreClubFeed[] = [];
  snap.forEach((d) => items.push({ id: d.id, ...(d.data() as any) }));
  const last = items[items.length - 1];
  const cursor = last ? (last as any)?.createdAt || null : null;
  return {
    items,
    cursor,
    hasMore: items.length >= Math.max(1, Math.min(100, limitN)),
  };
}

// Minimal deep merge to preserve existing nested telegram settings when updating specific flags
function deepMerge<T extends Record<string, any>>(
  base: T,
  partial: Partial<T>
): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const [key, value] of Object.entries(partial || {})) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const baseChild = (base as any)[key] || {};
      out[key] = deepMerge(baseChild, value as any);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

// Owner-gated updater for telegram settings (additive only). Backwards-compatible.
export async function updateClubTelegramSettingsRemote(
  clubId: string,
  actorUid: string,
  update: Partial<ClubTelegramSettings>
): Promise<void> {
  if (!clubId) throw new Error("Club id required");
  const ref = clubDoc(clubId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Club not found");
    const data = snap.data() as any as FirestoreClub & {
      telegram?: ClubTelegramSettings;
    };
    if (data.ownerUid !== actorUid)
      throw new Error("Only owner can edit settings");
    // Read existing sensitive state from protected docs if present
    const sref = clubSensitiveDoc(clubId);
    const ssnap = await tx.get(sref);
    const prevSensitive =
      (ssnap.exists() ? (ssnap.data() as any)?.telegram : null) || {};
    const next = deepMerge(prevSensitive, update || {});
    // Write to protected sensitive doc (top-level)
    tx.set(
      sref,
      { telegram: next, updatedAt: serverTimestamp() },
      { merge: true }
    );
    // Also write to notifications sub-doc for UI consumption
    tx.set(
      clubSensitiveNotificationsDoc(clubId),
      { telegram: next, updatedAt: serverTimestamp() },
      { merge: true }
    );
  });
}

// Issue a one-time link token for Telegram group linking. Owner only.
export async function issueClubTelegramLinkTokenRemote(
  clubId: string,
  actorUid: string,
  ttlMs: number = 15 * 60 * 1000
): Promise<{ token: string; expiresAtMs: number }> {
  const token = generateLinkToken();
  const expiresAtMs = Date.now() + Math.max(60_000, ttlMs);
  const ref = clubDoc(clubId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Club not found");
    const data = snap.data() as any as FirestoreClub & {
      telegram?: ClubTelegramSettings;
    };
    if (data.ownerUid !== actorUid)
      throw new Error("Only owner can link Telegram");
    const sref = clubSensitiveDoc(clubId);
    const ssnap = await tx.get(sref);
    const prevSensitive =
      (ssnap.exists() ? (ssnap.data() as any)?.telegram : null) || {};
    const next = deepMerge(prevSensitive, {
      linkState: "pending",
      linkToken: token,
      linkTokenExpiresAt: expiresAtMs,
    } as any);
    // Write to protected sensitive doc (top-level)
    tx.set(
      sref,
      { telegram: next, updatedAt: serverTimestamp() },
      { merge: true }
    );
    // Also write to notifications sub-doc for UI consumption
    tx.set(
      clubSensitiveNotificationsDoc(clubId),
      { telegram: next, updatedAt: serverTimestamp() },
      { merge: true }
    );
  });
  return { token, expiresAtMs };
}

function generateLinkToken(): string {
  try {
    const raw = new Uint8Array(24);
    typeof crypto !== "undefined" && crypto.getRandomValues
      ? crypto.getRandomValues(raw)
      : raw.forEach((_, i) => (raw[i] = Math.floor(Math.random() * 256)));
    const b64 =
      typeof btoa === "function"
        ? btoa(String.fromCharCode(...raw))
        : Buffer.from(raw).toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } catch {
    return (
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    );
  }
}
