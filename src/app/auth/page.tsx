"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/layout";
import LoadingScreen from "@/components/LoadingScreen";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { signInWithGoogleSafe } from "@/lib/authClient";

export default function AuthPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const returnToRaw = sp.get("returnTo") || "/";
  const returnTo = useMemo(() => {
    try {
      // Only allow same-origin relative paths for safety
      const u = new URL(
        returnToRaw,
        typeof window !== "undefined"
          ? window.location.origin
          : "http://localhost"
      );
      return u.pathname + (u.search || "") + (u.hash || "");
    } catch {
      return "/";
    }
  }, [returnToRaw]);

  const [authReady, setAuthReady] = useState<boolean>(!!auth.currentUser);
  const [userUid, setUserUid] = useState<string | null>(
    auth.currentUser?.uid || null
  );

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUserUid(u?.uid || null);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (userUid) {
      try {
        router.replace(returnTo || "/");
      } catch {}
    }
  }, [authReady, userUid, returnTo, router]);

  if (!authReady)
    return <LoadingScreen message="Checking your sign-in status…" />;

  return (
    <main className="mx-auto max-w-md p-4 text-sm">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="text-xs text-gray-500">Sign in to continue.</p>
          </div>
          <button
            onClick={async () => {
              await signInWithGoogleSafe(auth);
              // Redirect will also be handled by auth state effect on success
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
