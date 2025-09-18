"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/layout";
import GamesPlayedTiles from "@/components/profile/GamesPlayedTiles";
import WinRateTiles from "@/components/profile/WinRateTiles";
import RecentForm from "@/components/profile/RecentForm";
import LineChartSelectable from "@/components/profile/LineChartSelectable";
import InteractiveLineChart from "@/components/profile/InteractiveLineChart";
import DurationTiles from "@/components/profile/DurationTiles";
import LoadingScreen from "@/components/LoadingScreen";
import { getProfileByUsername } from "@/lib/firestoreSessions";

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

  useEffect(() => {
    if (!username) return;
    (async () => {
      const p = await getProfileByUsername(username);
      setProfile(p);
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

      <section>
        <Card>
          <h2 className="text-base font-semibold">Statistics (Preview)</h2>
          <p className="mt-1 text-xs text-gray-500">
            Sample UI using mock data. Final numbers will be computed when a
            session ends.
          </p>

          {/* Mock data for preview only */}
          {(() => {
            const mock = {
              singles: { games: 12, wins: 7 },
              doubles: { games: 34, wins: 18 },
              recent: ["W", "L", "W", "W", "L", "W", "L", "W", "W", "L"] as (
                | "W"
                | "L"
              )[],
            };
            const winrateLabels = [
              "Jan",
              "Feb",
              "Mar",
              "Apr",
              "May",
              "Jun",
              "Jul",
              "Aug",
              "Sep",
              "Oct",
              "Nov",
              "Dec",
            ];
            const winrateSingles = [
              50, 55, 52, 58, 60, 62, 65, 63, 67, 70, 68, 72,
            ];
            const winrateDoubles = [
              48, 50, 53, 49, 55, 57, 59, 61, 60, 64, 66, 69,
            ];
            const durationLabels = winrateLabels;
            const singlesMin = [
              50, 65, 40, 72, 85, 90, 105, 80, 110, 130, 95, 140,
            ];
            const doublesMin = [
              120, 135, 160, 140, 170, 185, 200, 210, 190, 220, 230, 240,
            ];
            const sum = (a: number[]) => a.reduce((acc, v) => acc + v, 0);
            return (
              <div className="mt-3 space-y-4">
                <GamesPlayedTiles
                  singlesGames={mock.singles.games}
                  doublesGames={mock.doubles.games}
                />
                <WinRateTiles singles={mock.singles} doubles={mock.doubles} />
                <RecentForm results={mock.recent} />
                <InteractiveLineChart
                  title="Win rate over time (preview)"
                  labels={winrateLabels}
                  singles={winrateSingles}
                  doubles={winrateDoubles}
                  selected={winrateSeries}
                  onSelect={setWinrateSeries}
                  ySuffix="%"
                  yMax={100}
                />
                <DurationTiles
                  totalSinglesMin={sum(singlesMin)}
                  totalDoublesMin={sum(doublesMin)}
                />
                <InteractiveLineChart
                  title="Game duration over time (preview)"
                  labels={durationLabels}
                  singles={singlesMin}
                  doubles={doublesMin}
                  selected={durationSeries}
                  onSelect={setDurationSeries}
                  ySuffix="m"
                />
              </div>
            );
          })()}
        </Card>
      </section>
    </main>
  );
}
