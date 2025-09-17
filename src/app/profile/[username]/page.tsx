"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/layout";
import LoadingScreen from "@/components/LoadingScreen";
import { getProfileByUsername } from "@/lib/firestoreSessions";

export default function PublicProfilePage() {
  const { username } = useParams<{ username: string }>();
  const [profile, setProfile] = useState<{
    uid: string;
    username: string;
  } | null>(null);
  const [ready, setReady] = useState(false);

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
          <h2 className="text-base font-semibold">Statistics</h2>
          <p className="mt-1 text-sm text-gray-600">Coming soon</p>
        </Card>
      </section>
    </main>
  );
}
