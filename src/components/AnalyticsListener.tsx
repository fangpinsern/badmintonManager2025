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

  return null;
}
