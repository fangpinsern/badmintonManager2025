"use client";
import { useEffect, useState } from "react";
import { isTelegramInAppBrowser } from "@/lib/ua";

/**
 * A friendly, closable overlay that instructs users to open the link
 * in their phone browser when we detect Telegram's in-app browser.
 *
 * Non-intrusive: does not alter any existing logic; purely informational.
 */
export default function TelegramBrowserOverlay() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Compute once on mount; avoid SSR access
    if (isTelegramInAppBrowser()) {
      setShow(true);
    }
  }, []);

  if (!show || dismissed) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">
              Open in your browser for a smoother sign-in
            </h2>
            <p className="mt-2 text-xs text-gray-600">
              It looks like you&apos;re using Telegram&apos;s in-app browser.
              Due to its storage restrictions, Google sign-in may fail here.
              Please open this link in your phone&apos;s browser (Safari/Chrome)
              to continue.
            </p>
          </div>
          <button
            aria-label="Close"
            className="ml-3 rounded-full p-1 text-gray-500 hover:bg-gray-100"
            onClick={() => setDismissed(true)}
          >
            ✕
          </button>
        </div>
        <div className="mt-3 rounded-xl bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-700">
          <div className="font-medium">How to open in your browser</div>
          <ul className="mt-1 list-disc pl-5">
            <li>iOS: Tap the share icon, then &quot;Open in Browser&quot;.</li>
            <li>Android: Tap the ⋮ menu, then &quot;Open in browser&quot;.</li>
          </ul>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={() => setDismissed(true)}
            className="rounded-xl border px-3 py-1.5 text-sm"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
