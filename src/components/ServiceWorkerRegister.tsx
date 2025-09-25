"use client";
import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    (async () => {
      try {
        // Register our single PWA service worker
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch (err) {
        // no-op
      }
    })();
  }, []);
  return null;
}
