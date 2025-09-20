"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card } from "@/components/layout";
import LoadingScreen from "@/components/LoadingScreen";
import { auth } from "@/lib/firebase";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
} from "firebase/auth";
import {
  linkAccountInOrganizerSession,
  getUserProfile,
  claimUsername,
} from "@/lib/firestoreSessions";
import UsernameModal from "@/components/UsernameModal";

function ClaimPageInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [authReady, setAuthReady] = useState<boolean>(!!auth.currentUser);
  const [userUid, setUserUid] = useState<string | null>(
    auth.currentUser?.uid || null
  );
  const [status, setStatus] = useState<"idle" | "linking" | "linked" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [needsUsername, setNeedsUsername] = useState(true);
  const [profileChecked, setProfileChecked] = useState(false);

  const params = useMemo(() => {
    const ouid = sp.get("ouid") || "";
    const sid = sp.get("sid") || "";
    const pid = sp.get("pid") || "";
    return { ouid, sid, pid, valid: !!(ouid && sid && pid) };
  }, [sp]);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUserUid(u?.uid || null);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    (async () => {
      if (!authReady || !userUid) return;
      try {
        const p = await getUserProfile(userUid);
        const has = p && typeof p.username === "string" && p.username.trim();
        setNeedsUsername(!has);
      } catch {
        setNeedsUsername(true);
      }
      setProfileChecked(true);
    })();
  }, [authReady, userUid]);

  useEffect(() => {
    if (!authReady || !userUid || !params.valid) return;
    if (!profileChecked) return; // wait until we know username status
    if (needsUsername) return; // gate until username claimed
    (async () => {
      try {
        setStatus("linking");
        await linkAccountInOrganizerSession(
          params.ouid,
          params.sid,
          params.pid,
          userUid
        );
        setStatus("linked");
        try {
          router.replace(`/session/${params.sid}`);
        } catch {}
      } catch (e) {
        setStatus("error");
        setErrorMsg(
          (e as Error)?.message || "Failed to link. Please try again."
        );
      }
    })();
  }, [
    authReady,
    userUid,
    params.valid,
    params.ouid,
    params.sid,
    params.pid,
    needsUsername,
  ]);

  if (!params.valid) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <h1 className="text-base font-semibold">Invalid claim link</h1>
          <p className="mt-1 text-gray-600">Missing or malformed parameters.</p>
        </Card>
      </main>
    );
  }

  if (!authReady)
    return <LoadingScreen message="Checking your sign-in status…" />;

  if (!userUid) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <Card>
          <h1 className="text-lg font-semibold">
            Link your player to your account
          </h1>
          <p className="mt-1 text-gray-600">Please sign in to continue.</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={async () => {
                const provider = new GoogleAuthProvider();
                await signInWithPopup(auth, provider);
              }}
              className="rounded-xl bg-black px-4 py-2 text-white"
            >
              Continue with Google
            </button>
          </div>
        </Card>
      </main>
    );
  }

  if (needsUsername) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <UsernameModal
          open={true}
          onClose={() => {}}
          canCancel={false}
          onSubmit={async (uname) => {
            if (!userUid) return;
            try {
              await claimUsername(userUid, uname);
              // Wait for profile to reflect the username to avoid flicker on redirect
              try {
                for (let i = 0; i < 10; i++) {
                  const p = await getUserProfile(userUid);
                  const has =
                    p && typeof p.username === "string" && p.username.trim();
                  if (has) break;
                  await new Promise((r) => setTimeout(r, 150));
                }
              } catch {}
              setNeedsUsername(false);
            } catch (e) {
              alert((e as Error)?.message || "Failed to claim username.");
            }
          }}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-4 text-sm">
      <Card>
        {status == "linking" && (
          <div>
            <h1 className="text-lg font-semibold">Linking your account…</h1>
            <p className="mt-1 text-gray-600">This only takes a moment.</p>
          </div>
        )}
        {status === "linked" && (
          <div>
            <h1 className="text-lg font-semibold">Linked successfully</h1>
            <p className="mt-1 text-gray-600">
              Your account has been linked to the player.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => router.push("/")}
                className="rounded-xl border px-3 py-1.5 text-sm"
              >
                Back to home
              </button>
            </div>
          </div>
        )}
        {status === "error" && (
          <div>
            <h1 className="text-lg font-semibold">Link failed</h1>
            <p className="mt-1 text-red-600">{errorMsg}</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => {
                  setStatus("idle");
                  setErrorMsg("");
                }}
                className="rounded-xl border px-3 py-1.5 text-sm"
              >
                Try again
              </button>
            </div>
          </div>
        )}
        {status === "idle" && (
          <div>
            <h1 className="text-lg font-semibold">Ready to link</h1>
            <p className="mt-1 text-gray-600">
              Preparing to link your account…
            </p>
          </div>
        )}
      </Card>
    </main>
  );
}

export default function ClaimPage() {
  return (
    <Suspense fallback={<LoadingScreen message="Loading…" />}>
      <ClaimPageInner />
    </Suspense>
  );
}
