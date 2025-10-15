"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card, Input } from "@/components/layout";
import LoadingScreen from "@/components/LoadingScreen";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  subscribeClub,
  renameClubRemote,
  updateClubVisibilityRemote,
} from "@/lib/firestoreClubs";
import type { FirestoreClub } from "@/lib/firestoreClubs";
import { ConfirmModal } from "@/components/session/confirmModal";

export default function ClubSettingsPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const router = useRouter();
  const [club, setClub] = useState<FirestoreClub | null>(null);
  const [clubReady, setClubReady] = useState(false);
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
    return subscribeClub(
      id,
      (doc) => {
        setClub(doc);
        setClubReady(true);
      },
      () => setClubReady(true),
      user?.uid || undefined
    );
  }, [id, user]);

  const isMember = useMemo(
    () => !!club && !!user && (club.memberUids || []).includes(user.uid),
    [club, user]
  );
  const isOwner = useMemo(
    () => !!club && !!user && club.ownerUid === user.uid,
    [club, user]
  );

  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmVisibility, setConfirmVisibility] = useState<null | {
    desired: "public" | "private";
  }>(null);
  const isPrivate = ((club as any)?.visibility || "public") === "private";

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
          <div className="flex items-center justify-between">
            <div className="text-gray-600">Club not found.</div>
            <Link href="/clubs" className="rounded border px-2 py-1 text-xs">
              Back
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  // Owner guard: only club owner can access the settings pages
  if (!isOwner) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <div className="flex items-center justify-between">
            <div className="text-gray-600">
              Only the owner can access settings.
            </div>
            <Link
              href={`/clubs/${id}`}
              className="rounded border px-2 py-1 text-xs"
            >
              Back to club
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  const base = `/clubs/${id}`;

  return (
    <main className="mx-auto max-w-md md:max-w-2xl p-4 text-sm">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Club settings</h1>
          <div className="text-gray-600">{club.name}</div>
        </div>
        <Link href={base} className="rounded border px-2 py-1 text-xs">
          Back to club
        </Link>
      </header>

      <section className="mb-4">
        <Card>
          <ul className="divide-y">
            <li className="py-3">
              <div className="mb-1 text-xs font-semibold uppercase text-gray-500">
                Club
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Rename club</div>
                    <div className="text-[11px] text-gray-600">
                      Change this club&apos;s display name
                    </div>
                  </div>
                  <button
                    className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                    disabled={!isOwner}
                    onClick={() => {
                      if (!club) return;
                      setNewName(club.name || "");
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Visibility</div>
                    <div className="text-[11px] text-gray-600">
                      {isPrivate
                        ? "Private — only members can view details"
                        : "Public — anyone can view"}
                    </div>
                  </div>
                  <div className="relative inline-flex h-8 items-center rounded-full border px-1">
                    <button
                      className={`rounded-full px-3 py-1 text-xs ${
                        !isPrivate ? "bg-blue-600 text-white" : "text-gray-700"
                      }`}
                      disabled={!isOwner}
                      onClick={() => {
                        if (isPrivate)
                          setConfirmVisibility({ desired: "public" });
                      }}
                    >
                      Public
                    </button>
                    <button
                      className={`rounded-full px-3 py-1 text-xs ${
                        isPrivate ? "bg-gray-900 text-white" : "text-gray-700"
                      }`}
                      disabled={!isOwner}
                      onClick={() => {
                        if (!isPrivate)
                          setConfirmVisibility({ desired: "private" });
                      }}
                    >
                      Private
                    </button>
                  </div>
                </div>
              </div>
            </li>
            <li className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">Notifications</div>
                <div className="text-[11px] text-gray-600">
                  Configure Telegram notifications and delivery settings
                </div>
              </div>
              <button
                className="rounded border px-2 py-1 text-xs"
                onClick={() => router.push(`${base}/settings/notifications`)}
              >
                Open
              </button>
            </li>
            <li className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">Venues</div>
                <div className="text-[11px] text-gray-600">
                  Manage common places your club plays at
                </div>
              </div>
              <button
                className="rounded border px-2 py-1 text-xs"
                onClick={() => router.push(`${base}/settings/venue`)}
              >
                Open
              </button>
            </li>
            {!isOwner && (
              <li className="py-3">
                <div className="text-[11px] text-gray-500">
                  You do not have permission to change settings. Only the owner
                  can edit.
                </div>
              </li>
            )}
          </ul>
        </Card>
      </section>

      {renaming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setRenaming(false)}
          ></div>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg">
            <div className="mb-2 text-base font-semibold">Rename club</div>
            <Input
              label="New name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Saturday Smashers"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                className="rounded-xl border px-3 py-1.5 text-sm"
                onClick={() => setRenaming(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                disabled={!newName.trim() || !isOwner}
                onClick={async () => {
                  if (!user || !club) return;
                  await renameClubRemote(club.id, user.uid, newName.trim());
                  setRenaming(false);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmVisibility}
        title="Change visibility?"
        body={
          confirmVisibility?.desired === "private"
            ? "Switch to private: only members can view details and join is disabled. Proceed?"
            : "Switch to public: anyone can view details and can join. Proceed?"
        }
        confirmText="Confirm"
        onCancel={() => setConfirmVisibility(null)}
        onConfirm={async () => {
          if (!confirmVisibility?.desired || !user || !club) return;
          await updateClubVisibilityRemote(
            club.id,
            user.uid,
            confirmVisibility.desired
          );
          setConfirmVisibility(null);
        }}
      />
    </main>
  );
}

export const runtime = "edge";
