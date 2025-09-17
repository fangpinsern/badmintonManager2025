"use client";
import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { Card } from "@/components/layout";
import LoadingScreen from "@/components/LoadingScreen";
import UsernameModal from "@/components/UsernameModal";
import { onAuthStateChanged } from "firebase/auth";
import { getUserProfile, claimUsername } from "@/lib/firestoreSessions";

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
            <button
              onClick={async () => {
                if (!user) return;
                const p = await getUserProfile(user.uid);
                const has =
                  p &&
                  typeof p.username === "string" &&
                  String(p.username).trim();
                setNeedsUsername(!has);
                setUsername(has ? String(p!.username) : "");
              }}
              className="rounded border px-2 py-1 text-xs"
            >
              Refresh
            </button>
          </div>
        </Card>
      </section>

      <section>
        <Card>
          <h2 className="text-base font-semibold">Statistics</h2>
          <p className="mt-1 text-sm text-gray-600">Coming soon</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-gray-600">
            <li>Games played, wins/losses</li>
            <li>Average points, average duration</li>
            <li>Preferred partners/opponents</li>
          </ul>
        </Card>
      </section>
    </main>
  );
}
