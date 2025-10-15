"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/layout";
import GamesPlayedTiles from "@/components/profile/GamesPlayedTiles";
import WinRateTiles from "@/components/profile/WinRateTiles";
import RecentForm from "@/components/profile/RecentForm";
import InteractiveLineChart from "@/components/profile/InteractiveLineChart";
import DurationTiles from "@/components/profile/DurationTiles";
import UserInfoCard from "@/components/profile/UserInfoCard";
import LoadingScreen from "@/components/LoadingScreen";
import { getProfileByUsername, getUserProfile } from "@/lib/firestoreSessions";
import { toUsernameSlug } from "@/lib/helper";
import {
  getUserStatsSummary,
  getUserStatsMonthly,
  getUserFriends,
  getUserOpponents,
  getFriendMirror,
  getOpponentMirror,
  resolveUsernames,
  getFriendEdgeMonthly,
  getOpponentEdgeMonthlySplit,
} from "@/lib/statsClient";
import TopPartnersTable from "@/components/profile/TopPartnersTable";
import TopOpponentsTable from "@/components/profile/TopOpponentsTable";
import DuoFriendshipCard from "@/components/profile/DuoFriendshipCard";
import HeadToHeadCard from "@/components/profile/HeadToHeadCard";
import { auth } from "@/lib/firebase";

export default function PublicProfilePage() {
  const { username } = useParams<{ username: string }>();
  const [profile, setProfile] = useState<{
    uid: string;
    username: string;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [winrateSeries, setWinrateSeries] = useState<"singles" | "doubles">(
    "singles"
  );
  const [durationSeries, setDurationSeries] = useState<"singles" | "doubles">(
    "singles"
  );
  const [stats, setStats] = useState<any | null>(null);
  const [monthly, setMonthly] = useState<{ id: string; data: any }[] | null>(
    null
  );
  const [profileInfo, setProfileInfo] = useState<any | null>(null);
  const [friends, setFriends] = useState<
    { otherUid: string; data: any }[] | null
  >(null);
  const [opponents, setOpponents] = useState<
    { otherUid: string; data: any }[] | null
  >(null);
  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({});
  const [viewerUid, setViewerUid] = useState<string | null>(
    auth.currentUser?.uid || null
  );
  const [viewerVsViewed, setViewerVsViewed] = useState<{
    friend: any | null;
    opponent: any | null;
    viewerName?: string;
    friendMonthly?: { month: string; games: number; wins: number }[];
    opponentMonthly?:
      | { month: string; games: number; wins: number; losses: number }[]
      | {
          singles: { month: string; games: number; wins: number }[];
          doubles: { month: string; games: number; wins: number }[];
        };
  } | null>(null);

  useEffect(() => {
    if (!username) return;
    (async () => {
      const slug = toUsernameSlug(username);
      const p = await getProfileByUsername(slug);
      setProfile(p);
      if (p?.uid) {
        try {
          const [sum, months, info, fr, opp] = await Promise.all([
            getUserStatsSummary(p.uid),
            getUserStatsMonthly(p.uid, 6),
            getUserProfile(p.uid),
            getUserFriends(p.uid),
            getUserOpponents(p.uid),
          ]);

          setStats(sum);
          setMonthly(months);
          setProfileInfo(info);
          setFriends(fr);
          setOpponents(opp);
          const uids = Array.from(
            new Set([
              ...(fr || []).map((i) => i.otherUid),
              ...(opp || []).map((i) => i.otherUid),
            ])
          );
          try {
            const names = await resolveUsernames(uids);
            setUsernameMap(names);
          } catch {}
          try {
            // viewer context
            const vuid = auth.currentUser?.uid || null;
            setViewerUid(vuid);
            if (vuid && vuid !== p.uid) {
              const [vf, vo] = await Promise.all([
                getFriendMirror(vuid, p.uid),
                getOpponentMirror(vuid, p.uid),
              ]);
              const [friendMonthly, opponentMonthly] = await Promise.all([
                getFriendEdgeMonthly(vuid, p.uid),
                getOpponentEdgeMonthlySplit(vuid, p.uid),
              ]);
              const names2 = await resolveUsernames([vuid]);
              setViewerVsViewed({
                friend: vf,
                opponent: vo,
                viewerName: names2?.[vuid] || vuid,
                friendMonthly,
                opponentMonthly,
              });
            } else {
              setViewerVsViewed(null);
            }
          } catch (error) {}
        } catch (error) {}
      }
      setReady(true);
    })();
  }, [username]);

  if (!ready) return <LoadingScreen message="Loading…" />;

  if (ready && !profile) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <div className="text-gray-600">User not found.</div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md md:max-w-2xl lg:max-w-3xl p-4 text-sm">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">{profile?.username}</h1>
        <p className="text-gray-600">Public profile</p>
      </header>

      <section className="mb-4">
        <Card>
          <h2 className="text-base font-semibold">Player Info</h2>
          <div className="mt-2">
            <UserInfoCard
              username={profile?.username}
              racketModels={
                Array.isArray(profileInfo?.racketModels)
                  ? profileInfo?.racketModels
                  : []
              }
              favouriteShuttlecock={
                typeof profileInfo?.favouriteShuttlecock === "string"
                  ? profileInfo?.favouriteShuttlecock
                  : ""
              }
              bio={typeof profileInfo?.bio === "string" ? profileInfo?.bio : ""}
              level={
                typeof profileInfo?.level === "string" ? profileInfo?.level : ""
              }
            />
          </div>
        </Card>
      </section>

      {viewerUid && viewerUid !== profile?.uid && (
        <section className="mb-4">
          <Card>
            <h2 className="text-base font-semibold">
              Your connection with @{profile?.username}
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              {viewerVsViewed?.friend?.together && (
                <div>
                  <DuoFriendshipCard
                    partnerUsername={viewerVsViewed?.viewerName || "you"}
                    together={viewerVsViewed?.friend?.together}
                    monthly={viewerVsViewed?.friendMonthly}
                  />
                </div>
              )}
              {viewerVsViewed?.opponent?.against && (
                <div>
                  <HeadToHeadCard
                    opponentUsername={viewerVsViewed?.viewerName || "you"}
                    against={viewerVsViewed?.opponent?.against}
                    monthly={viewerVsViewed?.opponentMonthly}
                  />
                </div>
              )}
            </div>
          </Card>
        </section>
      )}

      <section>
        <Card>
          <h2 className="text-base font-semibold">Statistics</h2>

          {(() => {
            const safeWinPct = (b?: { games?: number; wins?: number }) => {
              const g = Number(b?.games || 0);
              const w = Number(b?.wins || 0);
              return g > 0 ? Math.round((w / g) * 100) : 0;
            };
            const safeMinutes = (m?: number) => Number(m || 0);

            const recent = Array.isArray(stats?.recentForm)
              ? [...stats.recentForm].reverse()
              : [];
            const totals = stats?.totals || null;
            const singlesTotals = totals?.singles || {
              games: 0,
              wins: 0,
              durationMin: 0,
            };
            const doublesTotals = totals?.doubles || {
              games: 0,
              wins: 0,
              durationMin: 0,
            };
            const last10 = recent.slice(0, 10).map((r: any) => r.result);

            const labels = (monthly || []).map((m) => m.id);
            const singlesSeries = (monthly || []).map((m) =>
              safeWinPct(m.data?.singles)
            );
            const doublesSeries = (monthly || []).map((m) =>
              safeWinPct(m.data?.doubles)
            );
            const singlesDur = (monthly || []).map((m) =>
              safeMinutes(m.data?.singles?.durationMin)
            );
            const doublesDur = (monthly || []).map((m) =>
              safeMinutes(m.data?.doubles?.durationMin)
            );

            const hasSingles = (singlesTotals.games || 0) > 0;
            const hasDoubles = (doublesTotals.games || 0) > 0;
            const hasAny =
              hasSingles ||
              hasDoubles ||
              recent.length > 0 ||
              (monthly && monthly.length > 0);

            if (!hasAny) {
              return (
                <div className="mt-3 rounded-lg border bg-gray-50 p-6 text-center text-sm text-gray-600">
                  No statistics yet. Stats will appear after you participate in
                  ended sessions.
                </div>
              );
            }

            return (
              <div className="mt-3 space-y-4">
                <GamesPlayedTiles
                  singlesGames={singlesTotals.games || 0}
                  doublesGames={doublesTotals.games || 0}
                  showSingles={hasSingles}
                  showDoubles={hasDoubles}
                />
                <WinRateTiles
                  singles={{
                    games: singlesTotals.games || 0,
                    wins: singlesTotals.wins || 0,
                  }}
                  doubles={{
                    games: doublesTotals.games || 0,
                    wins: doublesTotals.wins || 0,
                  }}
                  showSingles={hasSingles}
                  showDoubles={hasDoubles}
                />
                {last10.length > 0 && (
                  <RecentForm results={last10 as ("W" | "L")[]} />
                )}
                {(hasSingles || hasDoubles) && labels.length > 0 && (
                  <InteractiveLineChart
                    title="Win rate over time"
                    labels={labels}
                    singles={singlesSeries}
                    doubles={doublesSeries}
                    selected={winrateSeries}
                    onSelect={setWinrateSeries}
                    ySuffix="%"
                    yMax={100}
                    showSingles={hasSingles}
                    showDoubles={hasDoubles}
                  />
                )}
                {(hasSingles || hasDoubles) && labels.length > 0 && (
                  <DurationTiles
                    totalSinglesMin={singlesTotals.durationMin || 0}
                    totalDoublesMin={doublesTotals.durationMin || 0}
                  />
                )}
                {(hasSingles || hasDoubles) && labels.length > 0 && (
                  <InteractiveLineChart
                    title="Game duration over time"
                    labels={labels}
                    singles={singlesDur}
                    doubles={doublesDur}
                    selected={durationSeries}
                    onSelect={setDurationSeries}
                    ySuffix="m"
                    showSingles={hasSingles}
                    showDoubles={hasDoubles}
                  />
                )}
              </div>
            );
          })()}
        </Card>
      </section>

      <section className="mt-4">
        <Card>
          <h2 className="text-base font-semibold">Partners & Opponents</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-medium text-gray-600">
                Top partners
              </div>
              <TopPartnersTable
                items={friends || []}
                usernames={usernameMap}
                highlightUid={viewerUid}
              />
            </div>
            {opponents &&
              opponents.filter((o) => o.data?.against?.doubles?.games > 0)
                .length > 0 && (
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs font-medium text-gray-600">
                      Top opponents (Doubles)
                    </div>
                    <TopOpponentsTable
                      items={opponents || []}
                      usernames={usernameMap}
                      highlightUid={viewerUid}
                      mode="doubles"
                    />
                  </div>
                </div>
              )}
            {opponents &&
              opponents.filter((o) => o.data?.against?.singles?.games > 0)
                .length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium text-gray-600">
                    Top opponents (Singles)
                  </div>
                  <TopOpponentsTable
                    items={opponents || []}
                    usernames={usernameMap}
                    highlightUid={viewerUid}
                    mode="singles"
                  />
                </div>
              )}
          </div>
        </Card>
      </section>
    </main>
  );
}
