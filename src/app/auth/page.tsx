"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components/layout";
import LoadingScreen from "@/components/LoadingScreen";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { signInWithGoogleSafe } from "@/lib/authClient";
import { logAnalyticsEvent } from "@/lib/analytics";
import UsernameModal from "@/components/UsernameModal";
import { getUserProfile, claimUsername } from "@/lib/firestoreSessions";
import TelegramBrowserOverlay from "@/components/TelegramBrowserOverlay";

function AuthPageInner() {
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
  const [needsUsername, setNeedsUsername] = useState<boolean>(false);
  const [profileChecked, setProfileChecked] = useState<boolean>(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUserUid(u?.uid || null);
      setAuthReady(true);
    });
  }, []);

  // Check for required username after sign-in
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
    if (!authReady) return;
    if (userUid && profileChecked && !needsUsername) {
      try {
        router.replace(returnTo || "/");
      } catch {}
    }
  }, [authReady, userUid, profileChecked, needsUsername, returnTo, router]);

  if (!authReady)
    return <LoadingScreen message="Checking your sign-in status…" />;

  // Gate on username if signed in but missing username
  if (authReady && userUid && profileChecked && needsUsername) {
    return (
      <main className="mx-auto max-w-md p-4 text-sm">
        <TelegramBrowserOverlay />
        <UsernameModal
          open={true}
          onClose={() => {}}
          canCancel={false}
          onSubmit={async (uname) => {
            if (!userUid) return;
            await claimUsername(userUid, uname);
            // Wait briefly for profile to reflect the username
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
          }}
        />
        <p>{JSON.stringify(window)}</p>
        <p>
          {(window as any).TelegramWebview
            ? "Found Telegram Webview"
            : "No Telegram Webview"}
        </p>
        <p>
          {(window as any).TelegramWebviewProxy
            ? "Found Telegram Webview Proxy"
            : "No Telegram Webview Proxy"}
        </p>
        <p>
          {(window as any).TelegramWebviewProxyProto
            ? "Found Telegram Webview Proxy Proto"
            : "No Telegram Webview Proxy Proto"}
        </p>
        <p>
          {(window as any).TelegramWebviewProxyProto.name
            ? "Found Telegram Webview Proxy Proto Name"
            : "No Telegram Webview Proxy Proto Name"}
        </p>
        <p>
          {(window as any).TelegramWebviewProxyProto.version
            ? "Found Telegram Webview Proxy Proto Version"
            : "No Telegram Webview Proxy Proto Version"}
        </p>
        <p>
          {(window as any).TelegramWebviewProxyProto.author
            ? "Found Telegram Webview Proxy Proto Author"
            : "No Telegram Webview Proxy Proto Author"}
        </p>
        <p>
          {(window as any).TelegramWebviewProxyProto.authorEmail
            ? "Found Telegram Webview Proxy Proto Author Email"
            : "No Telegram Webview Proxy Proto Author Email"}
        </p>
        <p>
          {(window as any).TelegramWebviewProxyProto.authorUrl
            ? "Found Telegram Webview Proxy Proto Author Url"
            : "No Telegram Webview Proxy Proto Author Url"}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-4 text-sm">
      <TelegramBrowserOverlay />
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="text-xs text-gray-500">Sign in to continue.</p>
          </div>
          <button
            onClick={async () => {
              await logAnalyticsEvent("login_start", { method: "google" });
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

export default function AuthPage() {
  return (
    <Suspense
      fallback={<LoadingScreen message="Checking your sign-in status…" />}
    >
      <AuthPageInner />
    </Suspense>
  );
}
