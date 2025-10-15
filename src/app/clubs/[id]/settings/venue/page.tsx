"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card, Input } from "@/components/layout";
import LoadingScreen from "@/components/LoadingScreen";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  subscribeClub,
  subscribeClubVenues,
  addClubVenueRemote,
  removeClubVenueRemote,
  restoreClubVenueRemote,
  type FirestoreClub,
  type ClubVenue,
} from "@/lib/firestoreClubs";

export default function ClubVenuesSettingsPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const [club, setClub] = useState<FirestoreClub | null>(null);
  const [clubReady, setClubReady] = useState(false);
  const [venues, setVenues] = useState<ClubVenue[]>([]);
  const [user, setUser] = useState<{
    uid: string;
    displayName?: string | null;
  } | null>(
    auth.currentUser
      ? { uid: auth.currentUser.uid, displayName: auth.currentUser.displayName }
      : null
  );
  const [authReady, setAuthReady] = useState(false);
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u ? { uid: u.uid, displayName: u.displayName } : null);
        setAuthReady(true);
      }),
    []
  );

  useEffect(() => {
    if (!id) return;
    setClubReady(false);
    const unsubClub = subscribeClub(
      id,
      (doc) => {
        setClub(doc);
        setClubReady(true);
      },
      () => setClubReady(true),
      user?.uid || undefined
    );
    const unsubVenues = subscribeClubVenues(id, (v) => setVenues(v));
    return () => {
      try {
        unsubClub && (unsubClub as any)();
      } catch {}
      try {
        unsubVenues && (unsubVenues as any)();
      } catch {}
    };
  }, [id, user]);

  const isOwner = useMemo(
    () => !!club && !!user && club.ownerUid === user.uid,
    [club, user]
  );

  const [newVenue, setNewVenue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  if (!clubReady || !authReady) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <LoadingScreen />
        </Card>
      </main>
    );
  }

  if (!club) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <div className="text-gray-600">Club not found.</div>
        </Card>
      </main>
    );
  }

  const base = `/clubs/${id}`;

  // Owner guard: only owner can access venues settings
  if (!isOwner) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <div className="flex items-center justify-between">
            <div className="text-gray-600">
              Only the owner can access settings.
            </div>
            <Link href={`${base}`} className="rounded border px-2 py-1 text-xs">
              Back to club
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md md:max-w-2xl p-4 text-sm">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Venues</h1>
          <div className="text-gray-600">{club.name}</div>
        </div>
        <Link
          href={`${base}/settings`}
          className="rounded border px-2 py-1 text-xs"
        >
          Back to settings
        </Link>
      </header>

      <section className="mb-4">
        <Card>
          <div className="space-y-3">
            <div className="mb-1 text-xs font-semibold uppercase text-gray-500">
              Common venues
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto] md:items-end">
              <Input
                label="Add venue"
                placeholder="e.g. ABC Sports Hall"
                value={newVenue}
                onChange={(e) => setNewVenue(e.target.value)}
              />
              <div className="md:text-right">
                <button
                  className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                  disabled={!isOwner || busy || !newVenue.trim()}
                  onClick={async () => {
                    if (!id || !user || !isOwner) return;
                    setBusy(true);
                    setError("");
                    try {
                      await addClubVenueRemote(id, user.uid, newVenue.trim());
                      setNewVenue("");
                    } catch (e: any) {
                      setError(e?.message || "Failed to add venue");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Adding…" : "Add"}
                </button>
              </div>
            </div>
            {error && <div className="text-[11px] text-red-600">{error}</div>}

            <div className="rounded border">
              {venues.length === 0 ? (
                <div className="p-3 text-[11px] text-gray-600">
                  No venues yet.
                </div>
              ) : (
                <ul className="divide-y">
                  {venues.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between px-2 py-2"
                    >
                      <div className="min-w-0 truncate text-sm">{v.name}</div>
                      <div className="ml-2 flex items-center gap-2">
                        {v.deleted ? (
                          <button
                            className="rounded border px-2 py-1 text-[11px]"
                            disabled={!isOwner}
                            onClick={async () => {
                              if (!id || !user) return;
                              try {
                                await restoreClubVenueRemote(
                                  id,
                                  user.uid,
                                  v.id
                                );
                              } catch {}
                            }}
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            className="rounded border px-2 py-1 text-[11px]"
                            disabled={!isOwner}
                            onClick={async () => {
                              if (!id || !user) return;
                              try {
                                await removeClubVenueRemote(id, user.uid, v.id);
                              } catch {}
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="text-[11px] text-gray-500">
              Removing a venue performs a soft delete to preserve future
              statistics.
            </div>
          </div>
        </Card>
      </section>
    </main>
  );
}
