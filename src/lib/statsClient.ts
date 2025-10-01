import { db } from "@/lib/firebase";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  where,
} from "firebase/firestore";

function isTestMode(): boolean {
  const v = String(process.env.NEXT_PUBLIC_TEST_MODE || "").toLowerCase();
  return v === "true" || process.env.NEXT_PUBLIC_TEST_MODE === "1";
}

export async function getUserStatsSummary(uid: string, test?: boolean) {
  const root = test ?? isTestMode() ? "userStats_test" : "userStats";
  const ref = doc(db as any, root, uid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as any) : null;
}

export async function getUserStatsMonthly(
  uid: string,
  months: number = 6,
  test?: boolean
) {
  const root = test ?? isTestMode() ? "userStats_test" : "userStats";
  const col = collection(db as any, root, uid, "monthly");
  // Document IDs are YYYY-MM, so orderBy __name__ desc gives latest first
  const q = query(col as any, orderBy("__name__", "desc"), limit(months));
  const snap = await getDocs(q);
  const out: { id: string; data: any }[] = [];
  snap.forEach((d) => out.push({ id: d.id, data: d.data() }));
  // reverse to ascending by month for nicer left-to-right charts
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// ---- Friends & Opponents mirrors ----

export async function getUserFriends(uid: string, test?: boolean) {
  const root = test ?? isTestMode() ? "userStats_test" : "userStats";
  const col = collection(db as any, root, uid, "friends");
  const snap = await getDocs(col as any);
  const out: { otherUid: string; data: any }[] = [];
  snap.forEach((d) => out.push({ otherUid: d.id, data: d.data() }));
  // Sort by games desc, then lastPlayedAt desc
  out.sort((a, b) => {
    const ag = Number(a.data?.together?.games || 0);
    const bg = Number(b.data?.together?.games || 0);
    if (bg !== ag) return bg - ag;
    const aw = Number(a.data?.together?.wins || 0);
    const bw = Number(b.data?.together?.wins || 0);
    if (bw !== aw) return bw - aw;
    const at = String(a.data?.lastPlayedAt || "");
    const bt = String(b.data?.lastPlayedAt || "");
    return bt.localeCompare(at);
  });
  return out;
}

export async function getUserOpponents(uid: string, test?: boolean) {
  const root = test ?? isTestMode() ? "userStats_test" : "userStats";
  const col = collection(db as any, root, uid, "opponents");
  const snap = await getDocs(col as any);
  const out: { otherUid: string; data: any }[] = [];
  snap.forEach((d) => out.push({ otherUid: d.id, data: d.data() }));
  // Sort by totals.games desc, then lastPlayedAt desc
  out.sort((a, b) => {
    const ag = Number(a.data?.against?.totals?.games || 0);
    const bg = Number(b.data?.against?.totals?.games || 0);
    if (bg !== ag) return bg - ag;
    const winsA = Number(a.data?.against?.totals?.wins || 0);
    const winsB = Number(b.data?.against?.totals?.wins || 0);
    if (winsB !== winsA) return winsB - winsA;
    const at = String(a.data?.lastPlayedAt || "");
    const bt = String(b.data?.lastPlayedAt || "");
    return bt.localeCompare(at);
  });
  return out;
}

export async function getFriendMirror(
  uid: string,
  otherUid: string,
  test?: boolean
) {
  const root = test ?? isTestMode() ? "userStats_test" : "userStats";
  const ref = doc(db as any, root, uid, "friends", otherUid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as any) : null;
}

export async function getOpponentMirror(
  uid: string,
  otherUid: string,
  test?: boolean
) {
  const root = test ?? isTestMode() ? "userStats_test" : "userStats";
  const ref = doc(db as any, root, uid, "opponents", otherUid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as any) : null;
}

// Resolve usernames for display (best-effort; falls back to uid)
export async function resolveUsernames(uids: string[]) {
  const results: Record<string, string> = {};
  const seen = new Set<string>();
  const col = collection(
    db as any,
    isTestMode() ? "usernames_test" : "usernames"
  );
  for (const uid of uids.slice(0, 20)) {
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    try {
      const qres = await getDocs(query(col as any, where("uid", "==", uid)));
      const first = qres.docs[0];
      if (first) results[uid] = String(first.id || "");
    } catch {}
  }
  return results;
}

// ---- Monthly edges (for mini charts) ----

// Global friendEdges monthly counters
export async function getFriendEdgeMonthly(uidA: string, uidB: string) {
  const [u1, u2] = [uidA, uidB].sort();
  const edgeKey = `${u1}__${u2}`;
  const col = collection(
    db as any,
    isTestMode() ? "friendEdges_test" : "friendEdges",
    edgeKey,
    "monthly"
  );
  const q = query(col as any, orderBy("__name__", "desc"), limit(12));
  const snap = await getDocs(q);
  const rows: { month: string; games: number; wins: number }[] = [];
  snap.forEach((d) => {
    const data = d.data() as any;
    const together = data?.together || {};
    rows.push({
      month: String(data?.month || d.id || ""),
      games: Number(together?.games || 0),
      wins: Number(together?.wins || 0),
    });
  });
  rows.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  return rows;
}

// Global opponentEdges monthly counters. wins are for the first participant in the pair
export async function getOpponentEdgeMonthly(
  viewerUid: string,
  otherUid: string
) {
  const [u1, u2] = [viewerUid, otherUid].sort();
  const pairKey = `${u1}__${u2}`;
  const col = collection(
    db as any,
    isTestMode() ? "opponentEdges_test" : "opponentEdges",
    pairKey,
    "monthly"
  );
  const q = query(col as any, orderBy("__name__", "desc"), limit(12));
  const snap = await getDocs(q);
  const rows: { month: string; games: number; wins: number; losses: number }[] =
    [];
  const viewerIsU1 = viewerUid === u1;
  snap.forEach((d) => {
    const data = d.data() as any;
    const head = data?.head?.totals || {};
    const winsU1 = Number(head?.winsU1 || 0);
    const winsU2 = Number(head?.winsU2 || 0);
    const games = Number(head?.games || winsU1 + winsU2);
    const viewerWins = viewerIsU1 ? winsU1 : winsU2;
    const viewerLosses = viewerIsU1 ? winsU2 : winsU1;
    rows.push({
      month: String(data?.month || d.id || ""),
      games,
      wins: viewerWins,
      losses: viewerLosses,
    });
  });
  rows.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  return rows;
}

// Split monthly for opponent edges (viewer perspective)
export async function getOpponentEdgeMonthlySplit(
  viewerUid: string,
  otherUid: string
) {
  const [u1, u2] = [viewerUid, otherUid].sort();
  const pairKey = `${u1}__${u2}`;
  const col = collection(
    db as any,
    isTestMode() ? "opponentEdges_test" : "opponentEdges",
    pairKey,
    "monthly"
  );
  const q = query(col as any, orderBy("__name__", "desc"), limit(12));
  const snap = await getDocs(q);
  const viewerIsU1 = viewerUid === u1;
  const singles: { month: string; games: number; wins: number }[] = [];
  const doubles: { month: string; games: number; wins: number }[] = [];
  snap.forEach((d) => {
    const data = d.data() as any;
    const s = data?.head?.singles || {};
    const dbl = data?.head?.doubles || {};
    const sWinsU1 = Number(s?.winsU1 || 0);
    const sWinsU2 = Number(s?.winsU2 || 0);
    const dWinsU1 = Number(dbl?.winsU1 || 0);
    const dWinsU2 = Number(dbl?.winsU2 || 0);
    singles.push({
      month: String(data?.month || d.id || ""),
      games: Number(s?.games || sWinsU1 + sWinsU2),
      wins: viewerIsU1 ? sWinsU1 : sWinsU2,
    });
    doubles.push({
      month: String(data?.month || d.id || ""),
      games: Number(dbl?.games || dWinsU1 + dWinsU2),
      wins: viewerIsU1 ? dWinsU1 : dWinsU2,
    });
  });
  singles.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  doubles.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  return { singles, doubles };
}

// ---- Global leaderboards (user discovery) ----

type LeaderboardMode = "totals" | "singles" | "doubles";
type LeaderboardMetric = "games" | "wins" | "durationMin";

function fieldPathFor(mode: LeaderboardMode, metric: LeaderboardMetric) {
  if (mode === "totals") return `totals.${metric}`;
  return `totals.${mode}.${metric}`;
}

// Returns top users by the chosen metric, optionally split by mode. Prioritizes doubles by passing mode="doubles".
export async function getTopUsersBy(
  metric: LeaderboardMetric,
  options?: { mode?: LeaderboardMode; limit?: number; test?: boolean }
) {
  const root = options?.test ?? isTestMode() ? "userStats_test" : "userStats";
  const mode: LeaderboardMode = options?.mode || "totals";
  const limitN = Math.max(1, Math.min(50, options?.limit || 5));
  const colRef = collection(db as any, root);
  const path = fieldPathFor(mode, metric);
  // Single-field orderBy with limit should not require a composite index
  const q = query(colRef as any, orderBy(path as any, "desc"), limit(limitN));
  const snap = await getDocs(q);
  const rows: {
    uid: string;
    score: number;
    totals: any;
  }[] = [];
  snap.forEach((d) => {
    const data = d.data() as any;
    const totals = data?.totals || {};
    let score = 0;
    if (mode === "totals") {
      score = Number(totals?.[metric] || 0);
    } else {
      score = Number(totals?.[mode]?.[metric] || 0);
    }
    rows.push({ uid: String(d.id), score, totals });
  });
  return rows;
}

// Convenience helpers for common boards
export async function getTopDoublesWins(limitN: number = 5) {
  return getTopUsersBy("wins", { mode: "doubles", limit: limitN });
}
export async function getTopDoublesTime(limitN: number = 5) {
  return getTopUsersBy("durationMin", { mode: "doubles", limit: limitN });
}
export async function getTopSinglesWins(limitN: number = 5) {
  return getTopUsersBy("wins", { mode: "singles", limit: limitN });
}
export async function getTopSinglesTime(limitN: number = 5) {
  return getTopUsersBy("durationMin", { mode: "singles", limit: limitN });
}
export async function getTopDoublesGames(limitN: number = 5) {
  return getTopUsersBy("games", { mode: "doubles", limit: limitN });
}
export async function getTopSinglesGames(limitN: number = 5) {
  return getTopUsersBy("games", { mode: "singles", limit: limitN });
}
