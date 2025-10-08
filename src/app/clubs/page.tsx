"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, Input } from "@/components/layout";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  createClubRemote,
  subscribeMyClubs,
  suggestUsernames,
} from "@/lib/firestoreClubs";
import type { FirestoreClub } from "@/lib/firestoreClubs";

export default function ClubsListPage() {
  const [user, setUser] = useState<{
    uid: string;
    displayName?: string | null;
  } | null>(
    auth.currentUser
      ? { uid: auth.currentUser.uid, displayName: auth.currentUser.displayName }
      : null
  );
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) =>
        setUser(u ? { uid: u.uid, displayName: u.displayName } : null)
      ),
    []
  );

  const [myClubs, setMyClubs] = useState<FirestoreClub[]>([]);
  useEffect(() => {
    if (!user) {
      setMyClubs([]);
      return;
    }
    return subscribeMyClubs(user.uid, setMyClubs);
  }, [user?.uid]);

  // Pagination (client-side)
  const pageSize = 5;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(myClubs.length / pageSize));
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return myClubs.slice(start, start + pageSize);
  }, [myClubs, page]);

  // Create club wizard modal
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [clubName, setClubName] = useState("");
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
  const [unameQuery, setUnameQuery] = useState("");
  const [suggests, setSuggests] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      const q = (unameQuery || "").trim().toLowerCase();
      if (!q) {
        setSuggests([]);
        return;
      }
      const res = await suggestUsernames(q, 8);
      if (!cancelled) setSuggests(res);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [unameQuery]);

  function toSlug(s: string): string {
    return (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
  }

  const parsedUsernames = useMemo(() => {
    const uniq = Array.from(
      new Set((selectedUsernames || []).map((r) => toSlug(r)))
    );
    return uniq;
  }, [selectedUsernames]);

  return (
    <main className="mx-auto max-w-md md:max-w-2xl lg:max-w-3xl p-4 text-sm">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clubs</h1>
          <p className="text-gray-600">Your clubs</p>
        </div>
        <button
          className="rounded bg-black px-3 py-2 text-xs text-white disabled:opacity-50"
          disabled={!user}
          onClick={() => {
            setClubName("");
            setSelectedUsernames([]);
            setStep(1);
            setWizardOpen(true);
          }}
        >
          Create club
        </button>
      </header>

      {/* <section className="mb-4">
        <Card>
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {user ? "Create a new club" : "Sign in to create a club"}
            </div>
            <button
              className="rounded bg-black px-3 py-2 text-xs text-white disabled:opacity-50"
              disabled={!user}
              onClick={() => {
                setClubName("");
                setSelectedUsernames([]);
                setStep(1);
                setWizardOpen(true);
              }}
            >
              Create club
            </button>
          </div>
        </Card>
      </section> */}

      <section className="space-y-3">
        {!user ? (
          <Card>
            <div className="text-gray-600">
              Please sign in to view your clubs.
            </div>
          </Card>
        ) : paged.length === 0 ? (
          <Card>
            <div className="text-gray-600">No clubs yet. Create one above.</div>
          </Card>
        ) : (
          paged.map((c) => (
            <Card key={c.id}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-base font-semibold">{c.name}</div>
                  <div className="text-[11px] text-gray-500">
                    {(c.memberUids || []).length} members
                  </div>
                </div>
                <Link
                  href={`/clubs/${c.id}`}
                  className="rounded border px-2 py-1 text-xs"
                >
                  View
                </Link>
              </div>
            </Card>
          ))
        )}
      </section>

      {user && (
        <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
          <button
            className="rounded border px-2 py-1 disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </button>
          <div>
            Page {page} of {totalPages}
          </div>
          <button
            className="rounded border px-2 py-1 disabled:opacity-50"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      )}

      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setWizardOpen(false)}
          ></div>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-4 shadow-lg max-h-[90vh] overflow-auto">
            <div className="mb-2 text-base font-semibold">Create club</div>
            {step === 1 && (
              <div>
                <Input
                  label="Club name"
                  placeholder="e.g. Friday Smash Buddies"
                  value={clubName}
                  onChange={(e) => setClubName(e.target.value)}
                />
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    className="rounded-xl border px-3 py-1.5 text-sm"
                    onClick={() => setWizardOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-xl bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    disabled={!clubName.trim()}
                    onClick={() => setStep(2)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            {step === 2 && (
              <div>
                <div className="text-xs text-gray-600 mb-1">
                  Add usernames (optional).
                </div>
                {parsedUsernames.length > 0 && (
                  <div className="mb-2 rounded border p-2 text-sm">
                    <div className="mb-1 text-[11px] text-gray-500">
                      Selected
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {parsedUsernames.slice(0, 29).map((u) => (
                        <span
                          key={u}
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                        >
                          @{u}
                          <button
                            className="ml-1 text-gray-500 hover:text-red-600"
                            onClick={() =>
                              setSelectedUsernames((prev) =>
                                prev.filter((x) => toSlug(x) !== u)
                              )
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-3">
                  <Input
                    label="Search usernames"
                    placeholder="type to search"
                    value={unameQuery}
                    onChange={(e) => setUnameQuery(e.target.value)}
                  />
                  {suggests.length > 0 && (
                    <div className="mt-2 rounded border p-2 text-sm">
                      <div className="mb-1 text-[11px] text-gray-500">
                        Suggestions
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {suggests.map((s) => (
                          <button
                            key={s}
                            className="rounded-full border px-2 py-0.5 text-xs"
                            onClick={() => {
                              setSelectedUsernames((prev) => {
                                const set = new Set(prev.map((x) => toSlug(x)));
                                if (set.has(toSlug(s)) || prev.length >= 29)
                                  return prev;
                                return [...prev, s];
                              });
                              setUnameQuery("");
                              setSuggests([]);
                            }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-2 text-[11px] text-gray-500">
                  Will add {parsedUsernames.length} member(s) on creation. Max
                  29 additional (owner counts towards 30).
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    className="rounded-xl border px-3 py-1.5 text-sm"
                    onClick={() => setStep(1)}
                  >
                    Back
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-xl border px-3 py-1.5 text-sm"
                      onClick={() => setWizardOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="rounded-xl bg-black px-3 py-1.5 text-sm text-white"
                      onClick={() => setStep(3)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
            {step === 3 && (
              <div>
                <div className="text-xs text-gray-600">Confirm details</div>
                <div className="mt-2 rounded border p-3">
                  <div className="text-[11px] text-gray-500">Club name</div>
                  <div className="text-sm font-semibold">{clubName.trim()}</div>
                </div>
                <div className="mt-2 rounded border p-3">
                  <div className="text-[11px] text-gray-500">
                    Members to add
                  </div>
                  {parsedUsernames.length === 0 ? (
                    <div className="text-sm text-gray-600">None</div>
                  ) : (
                    <ul className="mt-1 list-disc pl-5 text-sm">
                      {parsedUsernames.slice(0, 29).map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                      {parsedUsernames.length > 29 && (
                        <li className="text-gray-500">
                          … and {parsedUsernames.length - 29} more (will be
                          ignored due to member limit)
                        </li>
                      )}
                    </ul>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    className="rounded-xl border px-3 py-1.5 text-sm"
                    onClick={() => setStep(2)}
                  >
                    Back
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-xl border px-3 py-1.5 text-sm"
                      onClick={() => setWizardOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="rounded-xl bg-black px-3 py-1.5 text-sm text-white"
                      onClick={async () => {
                        if (!user) return;
                        const id = await createClubRemote(
                          user.uid,
                          clubName,
                          parsedUsernames
                        );
                        setWizardOpen(false);
                        window.location.href = `/clubs/${id}`;
                      }}
                    >
                      Confirm & Create
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
