import { db } from "@/lib/firebase";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
} from "firebase/firestore";

function isTestMode(): boolean {
  const v = String(process.env.NEXT_PUBLIC_TEST_MODE || "").toLowerCase();
  return v === "true" || process.env.NEXT_PUBLIC_TEST_MODE === "1";
}

export async function getUserStatsSummary(uid: string, test?: boolean) {
  const root = test ?? isTestMode() ? "userStats_test" : "userStats";
  console.log("root", root);
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
