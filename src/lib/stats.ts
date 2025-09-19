export async function triggerStatsRecalc(
  organizerUid: string | null | undefined,
  sessionId: string,
  opts?: {
    test?: boolean;
    dryRun?: boolean;
    workerUrl?: string;
    fireAndForget?: boolean; // default true
  }
): Promise<void> {
  try {
    if (!organizerUid) return;

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
      if (!res.ok) {
        // surface error for caller in testable mode
        throw new Error(`Stats worker failed: ${res.status}`);
      }
    }
  } catch {
    // swallow errors for background trigger
  }
}
