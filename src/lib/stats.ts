import { db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export async function triggerStatsRecalc(
  organizerUid: string | null | undefined,
  sessionId: string,
  opts?: {
    test?: boolean;
    dryRun?: boolean;
    workerUrl?: string;
    fireAndForget?: boolean; // default true
  }
): Promise<Response | null> {
  try {
    if (!organizerUid) return null;

    const workerUrl =
      opts?.workerUrl ||
      (process.env.NEXT_PUBLIC_STATS_WORKER_URL as string) ||
      "https://statscalc.techstufffang.workers.dev";

    const envTest =
      String(process.env.NEXT_PUBLIC_TEST_MODE || "").toLowerCase() ===
        "true" || process.env.NEXT_PUBLIC_TEST_MODE === "1";

    const body: any = {
      organizerUid,
      sessionId,
    };

    if (opts?.test || envTest) body.test = true;
    if (opts?.dryRun) body.dryRun = true;

    const fireAndForget = opts?.fireAndForget !== false; // default true
    const fetchInit: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };

    const p = fetch(workerUrl, fetchInit);
    if (!fireAndForget) {
      const res = await p;
      return res;
    }
    return null;
  } catch (e) {
    // swallow errors for background trigger
    return null;
  }
}

export async function recordStatsRecalcFailure(
  organizerUid: string | null | undefined,
  sessionId: string,
  error?: string | number | null
) {
  if (!organizerUid) return;
  const id = `${organizerUid}_${sessionId}`;
  const ref = doc(db as any, "statsRecalcFailures", id);
  await setDoc(
    ref as any,
    {
      organizerUid,
      sessionId,
      error: typeof error === "undefined" ? null : String(error),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
