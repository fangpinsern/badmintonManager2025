"use client";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  logAnalyticsEvent,
  setAnalyticsUserId,
  setAnalyticsUserProperties,
} from "@/lib/analytics";
import { detectInstalledPwa, detectPlatform } from "@/lib/notifications";

export default function AnalyticsListener() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Track page views
  useEffect(() => {
    const url = pathname + (searchParams?.toString() ? `?${searchParams}` : "");
    logAnalyticsEvent("page_view", {
      page_path: pathname,
      page_location: typeof window !== "undefined" ? window.location.href : url,
      page_title: typeof document !== "undefined" ? document.title : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  // Track auth state → set user id and properties
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      await setAnalyticsUserId(u?.uid || null);
      if (u) {
        await setAnalyticsUserProperties({
          email_verified: !!u.emailVerified,
          provider:
            (u.providerData && u.providerData[0]?.providerId) || "unknown",
        });
        await logAnalyticsEvent("login", {
          method:
            (u.providerData && u.providerData[0]?.providerId) || "unknown",
        });
      } else {
        await logAnalyticsEvent("logout");
      }
    });
    return () => unsub();
  }, []);

  // Track PWA install conversions (Chromium: appinstalled; iOS: detect installed on next load)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onInstalled = () => {
      try {
        const source =
          (typeof localStorage !== "undefined" &&
            localStorage.getItem("pwa_install_source")) ||
          "unknown";
        void logAnalyticsEvent("pwa_installed", {
          source,
          platform: detectPlatform(),
        });
        try {
          localStorage.removeItem("pwa_install_source");
        } catch {}
      } catch {}
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  useEffect(() => {
    // iOS: no appinstalled event. If user followed guide and app is now installed,
    // treat as a conversion the next time the app runs.
    try {
      const installed = detectInstalledPwa();
      const source =
        (typeof localStorage !== "undefined" &&
          localStorage.getItem("pwa_install_source")) ||
        null;
      if (installed && source) {
        void logAnalyticsEvent("pwa_installed", {
          source,
          platform: detectPlatform(),
        });
        try {
          localStorage.removeItem("pwa_install_source");
        } catch {}
      }
    } catch {}
  }, []);

  return null;
}
