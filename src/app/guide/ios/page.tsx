"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function IOSSetupGuidePage() {
  const [canEnableNow, setCanEnableNow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const supported = !!(window as any).__pushSupported;
      const perm =
        typeof Notification !== "undefined"
          ? Notification.permission
          : "default";
      const alreadyEnabled =
        (window as any).__pushEnabled === true ||
        (typeof localStorage !== "undefined" &&
          localStorage.getItem("pushEnabled") === "1");
      setCanEnableNow(supported && perm !== "denied" && !alreadyEnabled);
    } catch {
      setCanEnableNow(false);
    }
  }, []);

  return (
    <main className="mx-auto max-w-3xl p-4 text-sm leading-relaxed">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">
          Install on iPhone/iPad & enable notifications
        </h1>
        <p className="text-gray-600 mt-1">
          iOS requires adding the app to your Home Screen before push
          notifications can work.
        </p>
      </header>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">Add to Home Screen (Safari)</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>Open this site in Safari.</li>
          <li>
            Tap the <span className="font-medium">Share</span> button (square
            with an up arrow).
          </li>
          <li>
            Scroll and tap{" "}
            <span className="font-medium">Add to Home Screen</span>.
          </li>
          <li>
            Optionally rename it, then tap{" "}
            <span className="font-medium">Add</span>.
          </li>
          <li>Launch the app from your Home Screen icon.</li>
        </ol>
        <div className="rounded-lg border p-3 bg-gray-50 text-xs text-gray-700">
          Tip: If you don’t see “Add to Home Screen”, ensure you’re in Safari
          (not another browser) and that pop-ups are allowed.
        </div>
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">Enable notifications</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>Open the installed app from your Home Screen.</li>
          <li>Sign in if prompted.</li>
          <li>
            In the app header, tap{" "}
            <span className="font-medium">Enable notifications</span> when
            shown, then allow when iOS prompts.
          </li>
          <li>
            If previously denied: go to iOS Settings → Notifications → find the
            app name → allow notifications.
          </li>
        </ol>
        {canEnableNow && (
          <button
            onClick={() => (window as any).__enablePush?.()}
            className="rounded-full border px-3 py-1 text-xs text-gray-700 hover:bg-gray-100"
          >
            Enable notifications now
          </button>
        )}
      </section>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold">Troubleshooting</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            If prompts don’t appear, make sure you opened the app from the Home
            Screen icon.
          </li>
          <li>
            Notification banner style and sounds are controlled in iOS Settings
            after enabling.
          </li>
          <li>
            Reinstalling the app or toggling notification permission off/on can
            refresh delivery.
          </li>
        </ul>
      </section>

      <div className="mt-10">
        <Link
          href="/"
          className="inline-block rounded-full border px-3 py-1 text-xs text-gray-700 hover:bg-gray-100"
        >
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
