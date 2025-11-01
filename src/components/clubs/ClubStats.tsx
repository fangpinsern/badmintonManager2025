"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Select } from "@/components/layout";
import {
  getClubMonthlyAggregate,
  getClubUserMonthly,
  getClubUserSummary,
} from "@/lib/statsClient";
import { resolveUsernamesForUids } from "@/lib/firestoreClubs";

type Period = "month" | "all";

export default function ClubStats({
  clubId,
  memberUids,
}: {
  clubId: string;
  memberUids: string[];
}) {
  const [periodWinners, setPeriodWinners] = useState<Period>("month");
  const [periodActive, setPeriodActive] = useState<Period>("month");

  const [loading, setLoading] = useState(true);
  const [sessionsThisMonth, setSessionsThisMonth] = useState<number>(0);
  const [participationAvg, setParticipationAvg] = useState<number>(0);
  const [topWinnersMonth, setTopWinnersMonth] = useState<
    { uid: string; wins: number }[]
  >([]);
  const [topWinnersAll, setTopWinnersAll] = useState<
    { uid: string; wins: number }[]
  >([]);
  const [topActiveMonth, setTopActiveMonth] = useState<
    { uid: string; sessions: number }[]
  >([]);
  const [topActiveAll, setTopActiveAll] = useState<
    { uid: string; sessions: number }[]
  >([]);
  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({});
  const noData =
    !loading &&
    sessionsThisMonth === 0 &&
    topWinnersMonth.length === 0 &&
    topWinnersAll.length === 0 &&
    topActiveMonth.length === 0 &&
    topActiveAll.length === 0;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        if (!clubId) return;
        const month = new Date().toISOString().slice(0, 7); // YYYY-MM (UTC)
        const agg = await getClubMonthlyAggregate(clubId, month);
        if (cancelled) return;
        const sessCount = Number(agg?.sessionsCount || 0);
        const prSum = Number(agg?.participationRateSum || 0);
        const prSamples = Number(agg?.participationSampleCount || 0);
        setSessionsThisMonth(sessCount);
        setParticipationAvg(prSamples > 0 ? prSum / prSamples : 0);

        const uids = (memberUids || []).filter(Boolean);
        if (!uids.length) {
          setTopWinnersMonth([]);
          setTopWinnersAll([]);
          setTopActiveMonth([]);
          setTopActiveAll([]);
          setUsernameMap({});
          return;
        }

        const unameMap = await resolveUsernamesForUids(uids);
        if (cancelled) return;
        setUsernameMap(unameMap);

        const monthlyRows = await Promise.all(
          uids.map(async (uid) => {
            const m = await getClubUserMonthly(clubId, uid, month);
            return { uid, m };
          })
        );
        if (cancelled) return;
        const summaryRows = await Promise.all(
          uids.map(async (uid) => {
            const s = await getClubUserSummary(clubId, uid);
            return { uid, s };
          })
        );
        if (cancelled) return;

        const winnersM = monthlyRows
          .map(({ uid, m }) => ({ uid, wins: Number(m?.totals?.wins || 0) }))
          .filter((r) => r.wins > 0)
          .sort((a, b) => b.wins - a.wins)
          .slice(0, 5);
        setTopWinnersMonth(winnersM);

        const winnersAll = summaryRows
          .map(({ uid, s }) => ({ uid, wins: Number(s?.totals?.wins || 0) }))
          .filter((r) => r.wins > 0)
          .sort((a, b) => b.wins - a.wins)
          .slice(0, 5);
        setTopWinnersAll(winnersAll);

        const activeM = monthlyRows
          .map(({ uid, m }) => ({
            uid,
            sessions: Number(m?.attendance?.sessions || 0),
          }))
          .filter((r) => r.sessions > 0)
          .sort((a, b) => b.sessions - a.sessions)
          .slice(0, 5);
        setTopActiveMonth(activeM);

        const activeAll = summaryRows
          .map(({ uid, s }) => ({
            uid,
            sessions: Number(s?.attendance?.sessions || 0),
          }))
          .filter((r) => r.sessions > 0)
          .sort((a, b) => b.sessions - a.sessions)
          .slice(0, 5);
        setTopActiveAll(activeAll);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [clubId, (memberUids || []).join("|")]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold">Club stats</h2>
      </div>

      {noData ? (
        <div className="rounded border bg-gray-50 p-4 text-gray-600">
          complete your first session to see your club stats
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
            <StatTile
              label="Sessions this month"
              value={loading ? "—" : String(sessionsThisMonth)}
            />
            <StatTile
              label="Participation rate"
              value={loading ? "—" : `${Math.round(participationAvg * 100)}%`}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-medium">Top winners</div>
                <PeriodSelect
                  value={periodWinners}
                  onChange={setPeriodWinners}
                />
              </div>
              <ol className="space-y-2">
                {(periodWinners === "month"
                  ? topWinnersMonth
                  : topWinnersAll
                ).map((p, idx) => (
                  <li
                    key={`${p.uid}-${idx}`}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-[11px] text-gray-500">
                        {idx + 1}.
                      </span>
                      <span className="font-medium">
                        <Link
                          href={`/profile/${usernameMap[p.uid] || p.uid}`}
                          className="text-blue-600 hover:underline"
                        >
                          @{usernameMap[p.uid] || p.uid}
                        </Link>
                      </span>
                    </div>
                    <div className="text-gray-700">{p.wins} wins</div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-medium">Most active participants</div>
                <PeriodSelect value={periodActive} onChange={setPeriodActive} />
              </div>
              <ol className="space-y-2">
                {(periodActive === "month" ? topActiveMonth : topActiveAll).map(
                  (p, idx) => (
                    <li
                      key={`${p.uid}-${idx}`}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-5 text-[11px] text-gray-500">
                          {idx + 1}.
                        </span>
                        <span className="font-medium">
                          <Link
                            href={`/profile/${usernameMap[p.uid] || p.uid}`}
                            className="text-blue-600 hover:underline"
                          >
                            @{usernameMap[p.uid] || p.uid}
                          </Link>
                        </span>
                      </div>
                      <div className="text-gray-700">{p.sessions} sessions</div>
                    </li>
                  )
                )}
              </ol>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-[11px] text-gray-600">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function PeriodSelect({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="w-32">
      <Select
        value={value}
        onChange={(v) => onChange((v as Period) || "month")}
        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs"
      >
        <option value="month">This month</option>
        <option value="all">All time</option>
      </Select>
    </div>
  );
}
