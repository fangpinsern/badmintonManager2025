"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { isTestMode } from "@/lib/helper";
import { detectInstalledPwa, detectPlatform } from "@/lib/notifications";

export default function AppHeader() {
  const [hasUser, setHasUser] = useState(!!auth.currentUser);
  const [canInstall, setCanInstall] = useState(false);
  const [canEnablePush, setCanEnablePush] = useState(false);
  const [showIosInstallHint, setShowIosInstallHint] = useState(false);
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setHasUser(!!u));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Detect install prompt availability (Chromium)
    const handler = (e: any) => {
      e.preventDefault();
      (window as any).__deferredInstallPrompt = e;
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler as any);
    // Show enable notifications if supported and permission not granted
    const updatePush = () => {
      const supported = !!(window as any).__pushSupported;
      const perm =
        typeof Notification !== "undefined"
          ? Notification.permission
          : "default";
      setCanEnablePush(supported && perm !== "granted");
      try {
        const ios = detectPlatform() === "ios";
        const installed = detectInstalledPwa();
        setShowIosInstallHint(ios && !installed);
      } catch {}
    };
    updatePush();
    const id = setInterval(updatePush, 1500);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler as any);
      clearInterval(id);
    };
  }, []);
  const isTest = isTestMode();

  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-3xl p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Link href="/" className="text-2xl font-bold">
                🏸 Badminton Manager
              </Link>
              {isTest && (
                <span className="mt-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700">
                  BETA
                </span>
              )}
            </div>
            <p className="text-gray-500">
              Create sessions, add players, assign courts.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasUser ? (
              <Link
                href="/profile"
                aria-label="Go to profile"
                className="ml-4 rounded-full border p-2 text-gray-600 hover:bg-gray-100"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-8 w-8"
                >
                  <path d="M12 14.5c-3.59 0-6.5 2.02-6.5 4.5 0 .28.22.5.5.5h12c.28 0 .5-.22.5-.5 0-2.48-2.91-4.5-6.5-4.5z" />
                  <path d="M15.5 8a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" />
                </svg>
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex flex-row justify-between items-end gap-2">
          {(showIosInstallHint || true) && (
            <div className="block text-[11px] text-gray-500 w-1/2">
              Add to Home Screen to receive iOS push notifications
            </div>
          )}
          {!showIosInstallHint && canEnablePush && hasUser && (
            <button
              onClick={() => (window as any).__enablePush?.()}
              className="rounded-full border px-3 py-1 text-xs text-gray-700 hover:bg-gray-100"
            >
              Enable notifications
            </button>
          )}
          {canInstall && (
            <button
              onClick={async () => {
                try {
                  const promptEvt = (window as any).__deferredInstallPrompt;
                  if (promptEvt) {
                    promptEvt.prompt();
                    await promptEvt.userChoice;
                  }
                } catch {}
              }}
              className="rounded-full border px-3 py-1 text-xs text-gray-700 hover:bg-gray-100"
            >
              Install app
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
