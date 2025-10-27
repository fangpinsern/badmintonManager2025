/* eslint-disable */

"use client";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  saveSession,
  subscribeUserSessions,
  linkAccountInOrganizerSession,
} from "@/lib/firestoreSessions";
import { subscribeLinkedSessions } from "@/lib/firestoreSessions";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { signInWithGoogleSafe } from "@/lib/authClient";
import { useRouter, useSearchParams } from "next/navigation";
import { Session, Player } from "@/types/player";
import { useStore } from "@/lib/store";
import { formatSessionTitle } from "@/lib/helper";
import { Card, Input } from "@/components/layout";
import { EndSessionModal } from "@/components/session/endSessionModal";
import { triggerStatsRecalc, recordStatsRecalcFailure } from "@/lib/stats";

import Link from "next/link";
import { SessionCard as UnifiedSessionCard } from "@/components/session/SessionCard";
import LoadingScreen from "@/components/LoadingScreen";
import UsernameModal from "@/components/UsernameModal";
import { subscribeUserProfile, claimUsername } from "@/lib/firestoreSessions";
import Leaderboard from "@/components/Leaderboard";
import { deployedAtIso } from "../buildInfo";

/**
 * Single-file Next.js page (drop into app/page.tsx)
 * Mobile-first UI for:
 *  - creating sessions (date, time, number of courts, players per court)
 *  - adding players to a session
 *  - assigning players to courts in that session
 *
 * Dependencies to install:
 *  npm i zustand nanoid @dnd-kit/core
 * (Tailwind is used for styling — run `npx tailwindcss init -p` and the usual Next/TW setup.)
 */

// -----------------------------
// Helpers
// -----------------------------

function useSession(sessionId: string | null) {
  const sessions = useStore((s) => s.sessions);
  return useMemo(
    () => sessions.find((s) => s.id === sessionId) || null,
    [sessions, sessionId]
  );
}

// -----------------------------
// UI
// -----------------------------

function Page() {
  const router = useRouter();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const selected = useSession(selectedSessionId);
  const sessions = useStore((s) => s.sessions);
  const [user, setUser] = useState<{
    uid: string;
    displayName?: string | null;
  } | null>(
    auth.currentUser
      ? { uid: auth.currentUser.uid, displayName: auth.currentUser.displayName }
      : null
  );
  const [authReady, setAuthReady] = useState<boolean>(!!auth.currentUser);
  const lastSaved = useRef<Map<string, string>>(new Map());
  const ownSessionIdsRef = useRef<Set<string>>(new Set());
  const sessionOwnerUidRef = useRef<Map<string, string>>(new Map());
  const linkPlayerToAccount = useStore((s) => s.linkPlayerToAccount);
  const searchParams = useSearchParams();
  const pendingClaimRef = useRef<{
    ouid: string;
    sid: string;
    pid: string;
  } | null>(null);
  const [needsUsername, setNeedsUsername] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid, displayName: u.displayName } : null);
      setAuthReady(true);
    });
  }, []);

  // Subscribe to profile to check username
  useEffect(() => {
    if (!user) {
      setNeedsUsername(false);
      return;
    }
    const unsub = subscribeUserProfile(user.uid, (p) => {
      const has = p && typeof p.username === "string" && p.username.trim();
      setNeedsUsername(!has);
    });
    return () => unsub();
  }, [user?.uid]);

  // Capture claim params from URL, preselect session
  useEffect(() => {
    const claim = searchParams.get("claim");
    const ouid = searchParams.get("ouid");
    const sid = searchParams.get("sid");
    const pid = searchParams.get("pid");
    if (claim && ouid && sid && pid) {
      pendingClaimRef.current = { ouid, sid, pid };
      setSelectedSessionId(sid);
    }
  }, [searchParams]);

  // Replicate any remote session changes to Firestore (only for organizer-owned sessions)
  useEffect(() => {
    if (!user) return;
    const remote = sessions.filter(
      (s) => s.storage === "remote" && ownSessionIdsRef.current.has(s.id)
    );
    remote.forEach((ss) => {
      const key = ss.id;
      const serialized = JSON.stringify(ss);
      const prev = lastSaved.current.get(key);
      if (prev !== serialized) {
        lastSaved.current.set(key, serialized);
        void saveSession(ss.id, ss);
      }
    });
  }, [sessions, user]);

  // If a claim is present and user is available, link and clean URL.
  useEffect(() => {
    if (!user) return;
    const claim = pendingClaimRef.current;
    if (!claim) return;
    // Direct linking: claimer writes into organizer's session document.
    // Requires Firestore rules to permit: request.auth.uid == claimerUid, match player, and only set accountUid.
    (async () => {
      try {
        await linkAccountInOrganizerSession(
          claim.ouid,
          claim.sid,
          claim.pid,
          user.uid
        );
      } finally {
        pendingClaimRef.current = null;
        // Navigate user straight to the session manager page
        try {
          router.push(`/session/${claim.sid}`);
        } catch {}
      }
    })();
  }, [user]);

  // Subscribe to sessions where current user is linked as a player and merge into store
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeLinkedSessions(user.uid, (docs) => {
      const linked: Session[] = docs.map((d: any) => {
        const payload = d.doc.payload as Session;
        const sess = { ...payload, storage: "remote" } as Session;
        sessionOwnerUidRef.current.set(sess.id, d.organizerUid);
        try {
          const w: any = window as any;
          w.__sessionOwners = w.__sessionOwners || new Map<string, string>();
          w.__sessionOwners.set(sess.id, d.organizerUid);
        } catch {}
        return sess;
      });
      // Keep only organizer-owned sessions from current, then add linked
      const current = useStore.getState().sessions;
      const owned = current.filter((s) => ownSessionIdsRef.current.has(s.id));
      const map = new Map<string, Session>();
      for (const s of owned) map.set(s.id, s);
      for (const s of linked) map.set(s.id, s);
      const merged = Array.from(map.values());
      useStore.setState({ sessions: merged });
      for (const ss of linked) {
        lastSaved.current.set(ss.id, JSON.stringify(ss));
      }
    });
    return () => unsub();
  }, [user]);

  // Subscribe to current user's sessions in Firestore and hydrate the store
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeUserSessions(user.uid, (docs) => {
      const remoteSessions: Session[] = docs.map((d) => {
        const payload = (d as any).payload as Session;
        return { ...payload, storage: "remote" };
      });
      // Preserve any already-linked sessions from other organizers instead of overwriting them
      const current = useStore.getState().sessions || [];
      const ownSet = new Set(remoteSessions.map((s) => s.id));
      const linked = current.filter((s) => !ownSet.has(s.id));
      const merged = [...remoteSessions, ...linked];
      useStore.setState({ sessions: merged });
      ownSessionIdsRef.current = new Set(remoteSessions.map((s) => s.id));
      for (const ss of remoteSessions)
        sessionOwnerUidRef.current.set(ss.id, user.uid);
      try {
        const w: any = window as any;
        w.__sessionOwners = w.__sessionOwners || new Map<string, string>();
        for (const ss of remoteSessions) w.__sessionOwners.set(ss.id, user.uid);
      } catch {}
      for (const ss of merged) {
        lastSaved.current.set(ss.id, JSON.stringify(ss));
      }
    });
    return () => unsub();
  }, [user]);

  return (
    <main className="mx-auto max-w-md md:max-w-3xl lg:max-w-5xl xl:max-w-6xl p-4 text-sm">
      {/* Header moved to AppHeader (global) */}

      {!authReady && <LoadingScreen message="Loading..." />}
      {authReady && !user && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Sign in</h2>
              <p className="text-xs text-gray-500">
                Sign in to manage sessions.
              </p>
            </div>
            <button
              onClick={async () => {
                await signInWithGoogleSafe(auth);
              }}
              className="rounded-xl bg-black px-4 py-2 text-white"
            >
              Continue with Google
            </button>
          </div>
        </Card>
      )}

      {authReady && !user && (
        <div className="mt-4 space-y-4">
          <Card>
            <h2 className="text-base font-semibold">What you can do</h2>
            <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
              <li>Create and organize badminton sessions</li>
              <li>Assign players to courts and track games</li>
              <li>Compute statistics and compare with past performances</li>
            </ul>
          </Card>
          <Card>
            <h2 className="text-base font-semibold">How it works</h2>
            <ol className="mt-2 grid gap-2 text-sm text-gray-700 md:grid-cols-3">
              <li className="rounded-lg border p-3">
                <div className="text-[11px] font-medium text-gray-500">
                  Step 1
                </div>
                <div className="mt-1 font-semibold">Create a session</div>
                <div className="mt-1 text-gray-600">
                  Set date/time, courts and capacity.
                </div>
              </li>
              <li className="rounded-lg border p-3">
                <div className="text-[11px] font-medium text-gray-500">
                  Step 2
                </div>
                <div className="mt-1 font-semibold">Add players</div>
                <div className="mt-1 text-gray-600">
                  Type names one by one or paste a bulk list.
                </div>
              </li>
              <li className="rounded-lg border p-3">
                <div className="text-[11px] font-medium text-gray-500">
                  Step 3
                </div>
                <div className="mt-1 font-semibold">
                  Assign players to courts
                </div>
                <div className="mt-1 text-gray-600">
                  Assign players to courts for games or use the auto-assign
                  feature to rotate players evenly.
                </div>
              </li>
              <li className="rounded-lg border p-3">
                <div className="text-[11px] font-medium text-gray-500">
                  Step 4
                </div>
                <div className="mt-1 font-semibold">End session</div>
                <div className="mt-1 text-gray-600">
                  When session ends, link users to the players and we will
                  compute stats (win rate, durations, recent form) and store
                  them in the linked profile.
                </div>
              </li>
            </ol>
          </Card>
          <Card>
            <h2 className="text-base font-semibold">Stats & insights</h2>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-xs text-gray-500">Games played</div>
                <div className="mt-1 text-sm text-gray-700">
                  Singles and doubles totals
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-xs text-gray-500">Win rate over time</div>
                <div className="mt-1 text-sm text-gray-700">
                  Interactive charts by month
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-xs text-gray-500">Game duration</div>
                <div className="mt-1 text-sm text-gray-700">
                  Totals and trends for singles/doubles
                </div>
              </div>
            </div>
          </Card>
          <Leaderboard />
          <Card>
            <h2 className="text-base font-semibold">Privacy & data</h2>
            <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
              <li>Only linked accounts get personal stats stored</li>
              <li>
                Stats are computed on session end. It cannot be changed later
              </li>
              <li>Organizers cannot change your profile stats</li>
              <li>Sessions are stored in the cloud</li>
            </ul>
          </Card>
        </div>
      )}

      {authReady && user && needsUsername && (
        <UsernameModal
          open={true}
          onClose={() => {}}
          onSubmit={async (uname) => {
            await claimUsername(user.uid, uname);
          }}
          canCancel={false}
        />
      )}

      {user && !selected && (
        <div className="space-y-6">
          <SessionForm onCreated={(id) => router.push(`/session/${id}`)} />
          <SessionList onOpen={setSelectedSessionId} />
          <Leaderboard />
        </div>
      )}

      {/* {user && selected && (
        <SessionManager
          session={selected}
          organizerUid={
            (sessionOwnerUidRef.current &&
              sessionOwnerUidRef.current.get(selected.id)) ||
            user.uid
          }
          isOrganizer={ownSessionIdsRef.current.has(selected.id)}
          onBack={() => setSelectedSessionId(null)}
        />
      )} */}

      <footer className="mt-12 text-center text-xs text-gray-400">
        <div className="flex items-center justify-center gap-3">
          <a
            href={
              (process.env.NEXT_PUBLIC_TELEGRAM_URL as string) ||
              "https://t.me/bm25r"
            }
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border px-2 py-1 text-xs"
          >
            Subscribe for Updates
          </a>
          <Link href="/faq" className="rounded border px-2 py-1 text-xs">
            FAQ
          </Link>
          <Link href="/changelog" className="rounded border px-2 py-1 text-xs">
            Changelog
          </Link>
          {user ? (
            <>
              <Link
                href="/profile"
                className="rounded border px-2 py-1 text-xs"
              >
                Profile
              </Link>
              <button
                onClick={() => signOut(auth)}
                className="rounded border px-2 py-1 text-xs"
              >
                Sign out
              </button>
            </>
          ) : null}
        </div>
        <div className="mt-2">
          {(() => {
            try {
              const d = new Date(deployedAtIso);
              if (!isNaN(d.getTime())) {
                return <span>Last deployed: {d.toLocaleString()}</span>;
              }
            } catch {}
            return null;
          })()}
        </div>
      </footer>
    </main>
  );
}

export default function PageWithSearchParams() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}

// -----------------------------
// Session Creation & List
// -----------------------------

function SessionForm({
  onCreated,
}: {
  onCreated: (sessionId: string) => void;
}) {
  const createSession = useStore((s) => s.createSession);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [time, setTime] = useState<string>("19:00");
  const [numCourts, setNumCourts] = useState<string>("3");
  const [venueName, setVenueName] = useState<string>("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const desired = Math.max(1, Number(numCourts || 1));
    if (desired > 10) {
      setError("Courts per session are limited to 10.");
      return;
    }
    const id = createSession({
      date,
      time,
      numCourts: desired,
      // playersPerCourt defaults to 4 in the store
      venue: (() => {
        const n = (venueName || "").trim();
        return n ? { name: n } : undefined;
      })(),
    });
    onCreated(id);
  }

  return (
    <Card>
      <h2 className="mb-3 text-lg font-semibold">Create session</h2>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3">
        <Input
          type="date"
          label="Date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input
          type="time"
          label="Time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <Input
          type="number"
          label="# of courts"
          min={1}
          inputMode="numeric"
          value={numCourts}
          onChange={(e) => setNumCourts(e.target.value)}
        />
        <Input
          label="Venue"
          placeholder="e.g. ABC Sports Hall"
          value={venueName}
          onChange={(e) => setVenueName(e.target.value)}
        />
        {error && <div className="text-xs text-red-600">{error}</div>}
        <button
          type="submit"
          className="mt-1 rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          Create
        </button>
      </form>
    </Card>
  );
}

function SessionList({ onOpen }: { onOpen: (id: string) => void }) {
  const router = useRouter();
  const allSessions = useStore((s) => s.sessions);
  const deleteSession = useStore((s) => s.deleteSession);
  const endSession = useStore((s) => s.endSession);
  const [endFor, setEndFor] = useState<string | null>(null);
  const [shuttles, setShuttles] = useState<string>("0");
  const me = auth.currentUser?.uid || null;

  const nowIsoDate = new Date().toISOString().slice(0, 10);
  const sorted = useMemo(() => {
    const toTs = (s: Session) =>
      new Date(`${s.date}T${s.time ?? "00:00"}`).getTime();
    return [...allSessions].sort((a, b) => toTs(b) - toTs(a));
  }, [allSessions]);

  const [tab, setTab] = useState<"upcoming" | "closed">("upcoming");
  const upcoming = useMemo(() => sorted.filter((s) => !s.ended), [sorted]);
  const closed = useMemo(() => sorted.filter((s) => !!s.ended), [sorted]);

  // pagination (10 per page)
  const [upShown, setUpShown] = useState<number>(10);
  const [clShown, setClShown] = useState<number>(10);
  const list = tab === "upcoming" ? upcoming : closed;
  const shown = tab === "upcoming" ? upShown : clShown;
  const canSeeMore = list.length > shown;
  const display = list.slice(0, shown);

  if (!sorted.length) {
    return (
      <Card>
        <p className="text-gray-500">No sessions yet. Create one above.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="mb-1 flex items-center gap-2">
          <button
            onClick={() => setTab("upcoming")}
            className={`rounded-xl border px-3 py-1.5 text-xs ${
              tab === "upcoming"
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-gray-300"
            }`}
          >
            Upcoming
          </button>
          <button
            onClick={() => setTab("closed")}
            className={`rounded-xl border px-3 py-1.5 text-xs ${
              tab === "closed"
                ? "border-gray-400 bg-gray-100 text-gray-700"
                : "border-gray-300"
            }`}
          >
            Closed
          </button>
        </div>
      </div>

      {display.length == 0 ? (
        <Card>
          <div className="text-gray-600">
            No sessions yet. Create one above.
          </div>
        </Card>
      ) : (
        display.map((ss) => (
          <UnifiedSessionCard
            key={ss.id}
            session={ss}
            onOpen={(id) => {
              onOpen(id);
              router.push(`/session/${id}`);
            }}
            rightActions={(() => {
              const owner =
                (window as any).__sessionOwners?.get?.(ss.id) || null;
              const isOrganizer = owner && me ? owner === me : false;
              if (!isOrganizer) return null;
              return (
                <>
                  {!ss.ended && isOrganizer && (
                    <button
                      onClick={() => {
                        if ((ss.courts || []).some((c) => c.inProgress)) return;
                        setEndFor(ss.id);
                        setShuttles("0");
                      }}
                      disabled={(ss.courts || []).some((c) => c.inProgress)}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700 disabled:opacity-50"
                    >
                      End
                    </button>
                  )}
                  {isOrganizer && (
                    <button
                      onClick={() => {
                        if (confirm("Delete this session?"))
                          deleteSession(ss.id);
                      }}
                      className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-red-600"
                    >
                      Delete
                    </button>
                  )}
                </>
              );
            })()}
          />
        ))
      )}

      {canSeeMore && (
        <div className="flex justify-center">
          <button
            className="rounded-xl border px-3 py-1.5 text-xs"
            onClick={() =>
              tab === "upcoming"
                ? setUpShown((n) => n + 10)
                : setClShown((n) => n + 10)
            }
          >
            See more
          </button>
        </div>
      )}

      {!!endFor && (
        <EndSessionModal
          title={
            endFor
              ? `End ${formatSessionTitle(
                  (tab === "upcoming" ? upcoming : closed).find(
                    (s) => s.id === endFor
                  )!
                )}?`
              : "End session?"
          }
          shuttles={shuttles}
          onShuttlesChange={setShuttles}
          onCancel={() => setEndFor(null)}
          onConfirm={() => {
            const num = Number(shuttles);
            if (endFor)
              endSession(
                endFor,
                Number.isFinite(num) && num >= 0 ? Math.floor(num) : undefined
              );
            if (endFor) {
              (async () => {
                try {
                  const latest = (useStore.getState().sessions || []).find(
                    (s) => s.id === endFor
                  );
                  if (latest) await saveSession(endFor, latest);
                } catch {}
                const res = await triggerStatsRecalc(
                  auth.currentUser?.uid,
                  endFor,
                  {
                    fireAndForget: false,
                  }
                );
                if (!res || !res.ok) {
                  await recordStatsRecalcFailure(
                    auth.currentUser?.uid || null,
                    endFor,
                    res ? res.status : "fetch-error"
                  );
                }
              })();
            }
            setEndFor(null);
          }}
          organizerUid={auth.currentUser?.uid || null}
          sessionId={endFor || ""}
          unlinkedPlayers={(() => {
            const ss = (useStore.getState().sessions || []).find(
              (s) => s.id === endFor
            );
            const arr = Array.isArray(ss?.players) ? ss!.players : [];
            return arr
              .filter((p) => !p.accountUid)
              .map((p) => ({ id: p.id, name: p.name }));
          })()}
          organizerLinked={(() => {
            const ss = (useStore.getState().sessions || []).find(
              (s) => s.id === endFor
            );
            const myUid = auth.currentUser?.uid;
            return !!(
              myUid &&
              ss &&
              ss.players.some((p) => p.accountUid === myUid)
            );
          })()}
        />
      )}
    </div>
  );
}

// -----------------------------
// Session Manager (players + courts)
// -----------------------------
