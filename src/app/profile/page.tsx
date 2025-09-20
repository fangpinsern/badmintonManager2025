"use client";
import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { Card } from "@/components/layout";
import LoadingScreen from "@/components/LoadingScreen";
import UsernameModal from "@/components/UsernameModal";
import { onAuthStateChanged } from "firebase/auth";
import {
  getUserProfile,
  claimUsername,
  updateUserProfile,
} from "@/lib/firestoreSessions";
import ProfileEditForm, {
  ProfileEditable,
} from "@/components/profile/ProfileEditForm";
import UserInfoCard from "@/components/profile/UserInfoCard";
import GamesPlayedTiles from "@/components/profile/GamesPlayedTiles";
import WinRateTiles from "@/components/profile/WinRateTiles";
import RecentForm from "@/components/profile/RecentForm";
import InteractiveLineChart from "@/components/profile/InteractiveLineChart";
import DurationTiles from "@/components/profile/DurationTiles";
import { getUserStatsMonthly, getUserStatsSummary } from "@/lib/statsClient";

export default function ProfilePage() {
  const [user, setUser] = useState<{
    uid: string;
    displayName?: string | null;
  } | null>(
    auth.currentUser
      ? { uid: auth.currentUser.uid, displayName: auth.currentUser.displayName }
      : null
  );
  const [authReady, setAuthReady] = useState<boolean>(!!auth.currentUser);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [username, setUsername] = useState<string>("");
  const [profileData, setProfileData] = useState<ProfileEditable>({
    racketModels: [],
    favouriteShuttlecock: "",
    bio: "",
    level: "",
  });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stats, setStats] = useState<any | null>(null);
  const [monthly, setMonthly] = useState<{ id: string; data: any }[] | null>(
    null
  );
  const [winrateSeries, setWinrateSeries] = useState<"singles" | "doubles">(
    "singles"
  );
  const [durationSeries, setDurationSeries] = useState<"singles" | "doubles">(
    "singles"
  );

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid, displayName: u.displayName } : null);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) {
        setNeedsUsername(false);
        setUsername("");
        return;
      }
      const p = await getUserProfile(user.uid);
      if (cancelled) return;
      const has =
        p && typeof p.username === "string" && String(p.username).trim();
      setNeedsUsername(!has);
      setUsername(has ? String(p!.username) : "");
      setProfileData({
        racketModels: Array.isArray(p?.racketModels) ? p?.racketModels : [],
        favouriteShuttlecock:
          typeof p?.favouriteShuttlecock === "string"
            ? p?.favouriteShuttlecock
            : "",
        bio: typeof p?.bio === "string" ? p?.bio : "",
        level: typeof p?.level === "string" ? p?.level : "",
      });
      try {
        const [sum, months] = await Promise.all([
          getUserStatsSummary(user.uid),
          getUserStatsMonthly(user.uid, 6),
        ]);
        if (!cancelled) {
          setStats(sum);
          setMonthly(months);
        }
      } catch {}
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  if (!authReady) return <LoadingScreen message="Loading…" />;

  if (authReady && !user) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <div className="text-gray-600">
            Please sign in to view your profile.
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md md:max-w-2xl lg:max-w-3xl p-4 text-sm">
      {needsUsername && user && (
        <UsernameModal
          open={true}
          onClose={() => {}}
          onSubmit={async (uname) => {
            await claimUsername(user.uid, uname);
          }}
          canCancel={false}
        />
      )}

      <header className="mb-4">
        <h1 className="text-2xl font-bold">Your Profile</h1>
        <p className="text-gray-600">Manage your account information.</p>
      </header>

      <section className="mb-4">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500">Username</div>
              <div className="text-base font-semibold">{username || "—"}</div>
            </div>
          </div>
        </Card>
      </section>

      <section className="mb-4">
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Profile</h2>
            <button
              onClick={() => setEditing((v) => !v)}
              className="rounded border px-2 py-1 text-xs"
            >
              {editing ? "Cancel" : "Edit"}
            </button>
          </div>
          <div className="mt-2">
            {editing ? (
              <ProfileEditForm
                value={profileData}
                onChange={setProfileData}
                saving={saving}
                onSubmit={async () => {
                  if (!user) return;
                  setSaving(true);
                  try {
                    await updateUserProfile(user.uid, profileData);
                    setEditing(false);
                  } finally {
                    setSaving(false);
                  }
                }}
              />
            ) : (
              <UserInfoCard
                username={username}
                racketModels={profileData.racketModels || []}
                favouriteShuttlecock={profileData.favouriteShuttlecock || ""}
                bio={profileData.bio || ""}
                level={profileData.level || ""}
              />
            )}
          </div>
        </Card>
      </section>

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
              ? stats.recentForm
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
            const hasSingles = (singlesTotals.games || 0) > 0;
            const hasDoubles = (doublesTotals.games || 0) > 0;
            const hasAny =
              hasSingles ||
              hasDoubles ||
              recent.length > 0 ||
              (monthly && monthly.length > 0);

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
    </main>
  );
}
