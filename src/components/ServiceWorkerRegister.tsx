"use client";
import { useEffect } from "react";
import { logAnalyticsEvent } from "@/lib/analytics";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    (async () => {
      try {
        // Register our single PWA service worker
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        logAnalyticsEvent("sw_register_success");
      } catch (err) {
        // no-op
        logAnalyticsEvent("sw_register_error");
      }
    })();
  }, []);
  return null;
}
