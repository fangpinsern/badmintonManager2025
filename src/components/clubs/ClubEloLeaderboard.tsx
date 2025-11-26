import React, { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/layout";
import { getUserProfile } from "@/lib/firestoreSessions";

type EloBlock = {
  R?: number;
  K?: number;
  matches?: number;
} | null;

type Row = {
  uid: string;
  username: string;
  rating: number;
  matches: number;
};

export default function ClubEloLeaderboard({
  memberUids,
  usernames,
  limit = 10,
  defaultMode = "doubles",
  className = "",
}: {
  memberUids: string[];
  usernames?: Record<string, string>;
  limit?: number;
  defaultMode?: "singles" | "doubles";
  className?: string;
}) {
  const [mode, setMode] = useState<"singles" | "doubles">(defaultMode);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const uids = Array.from(new Set(memberUids)).slice(0, 300);
        const profiles = await Promise.all(
          uids.map(async (uid) => {
            try {
              const p = await getUserProfile(uid);
              return { uid, profile: p || null };
            } catch {
              return { uid, profile: null };
            }
          })
        );
        if (cancelled) return;
        const data = profiles
          .map(({ uid, profile }) => {
            const eb = ((profile?.elo || {})[mode] as EloBlock) || null;
            const r = Number(eb?.R ?? NaN);
            const m = Number(eb?.matches ?? 0);
            if (!Number.isFinite(r) || m <= 0) return null;
            const name = usernames?.[uid] || uid;
            return { uid, username: name, rating: r, matches: m } as Row;
          })
          .filter(Boolean) as Row[];
        data.sort((a, b) => b.rating - a.rating);
        setRows(limit > 0 ? data.slice(0, limit) : data);
      } catch (e: any) {
        if (!cancelled) setError("Failed to load leaderboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    memberUids.join("|"),
    limit,
    mode,
    usernames && Object.keys(usernames).join("|"),
  ]);

  const title = useMemo(
    () => (mode === "doubles" ? "Club Elo · Doubles" : "Club Elo · Singles"),
    [mode]
  );

  return (
    <Card className={className}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        <ModeToggle mode={mode} onChange={setMode} />
      </div>
      {loading ? (
        <div className="mt-2 text-xs text-gray-600">Loading…</div>
      ) : error ? (
        <div className="mt-2 text-xs text-red-600">{error}</div>
      ) : rows.length === 0 ? (
        <div className="mt-2 text-xs text-gray-500">No rated members yet</div>
      ) : (
        <>
          <ol className="mt-2 space-y-1">
            {(showAll ? rows : rows.slice(0, 5)).map((r, idx) => {
              const rank = idx + 1 + (showAll ? 0 : 0); // ranks always 1..N in the visible subset
              const overallRank = rows.indexOf(r) + 1; // true overall rank
              return (
                <li
                  key={r.uid}
                  className="flex items-center justify-between rounded border p-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-6 text-right text-xs text-gray-600">
                      {overallRank}.
                    </span>
                    <span className="text-sm font-medium truncate">
                      @{r.username}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-semibold">
                      {Math.round(r.rating)}
                    </span>
                    <span className="text-[11px] text-gray-500">
                      {r.matches} matches
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          {rows.length > 5 && (
            <div className="mt-3 flex justify-center">
              <button
                className="rounded border px-3 py-1.5 text-xs"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "Show less" : "Show more"}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "singles" | "doubles";
  onChange: (m: "singles" | "doubles") => void;
}) {
  return (
    <div className="relative inline-flex items-center rounded-full border border-gray-300 p-0.5 text-[11px]">
      <button
        className={`rounded-full px-2 py-1 ${
          mode === "doubles" ? "bg-gray-800 text-white" : "text-gray-700"
        }`}
        onClick={() => onChange("doubles")}
        aria-pressed={mode === "doubles"}
      >
        Doubles
      </button>
      <button
        className={`rounded-full px-2 py-1 ${
          mode === "singles" ? "bg-gray-800 text-white" : "text-gray-700"
        }`}
        onClick={() => onChange("singles")}
        aria-pressed={mode === "singles"}
      >
        Singles
      </button>
    </div>
  );
}
