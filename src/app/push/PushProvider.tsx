"use client";
import { useEffect, useState } from "react";
import { app, auth, db } from "@/lib/firebase";
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from "firebase/messaging";
import {
  saveDeviceTokenDoc,
  detectInstalledPwa,
  detectPlatform,
} from "@/lib/notifications";

export function PushProvider({ children }: { children: React.ReactNode }) {
  const [supported, setSupported] = useState<boolean>(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPermission(
      typeof Notification !== "undefined" ? Notification.permission : "default"
    );
    isSupported()
      .then(setSupported)
      .catch(() => setSupported(false));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__pushSupported = supported;
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    // Bind foreground handler and expose enablePush once SW is ready
    navigator.serviceWorker.ready.then((reg) => {
      try {
        const messaging = getMessaging(app);
        onMessage(messaging, () => {
          // Foreground push received: app can show a toast or refresh data
        });
      } catch {}

      // If permission already granted (previously enabled), refresh token silently on app start
      (async () => {
        try {
          if (typeof Notification === "undefined") return;
          if (Notification.permission !== "granted") return;
          const user = auth.currentUser;
          if (!user) return;
          const messaging = getMessaging(app);
          const vapidKey = process.env.NEXT_PUBLIC_FCM_VAPID_KEY as
            | string
            | undefined;
          if (!vapidKey) return;
          const token = await getToken(messaging, {
            vapidKey,
            serviceWorkerRegistration: reg,
          });
          const installed = detectInstalledPwa();
          const platform = detectPlatform();
          await saveDeviceTokenDoc(user.uid, token, platform, installed);
          try {
            if (typeof localStorage !== "undefined") {
              localStorage.setItem("pushEnabled", "1");
            }
            (window as any).__pushEnabled = true;
          } catch {}
        } catch {}
      })();

      async function enablePush() {
        try {
          if (typeof Notification === "undefined") return;
          const current = Notification.permission;
          if (current === "denied") return; // Respect user's choice
          const ask = await Notification.requestPermission();
          setPermission(ask);
          if (ask !== "granted") return;
          const messaging = getMessaging(app);
          const vapidKey = process.env.NEXT_PUBLIC_FCM_VAPID_KEY as
            | string
            | undefined;
          if (!vapidKey) {
            alert("Push not configured: missing NEXT_PUBLIC_FCM_VAPID_KEY");
            return;
          }
          const token = await getToken(messaging, {
            vapidKey,
            serviceWorkerRegistration: reg,
          });
          const user = auth.currentUser;
          if (!user) {
            alert("Please sign in to enable notifications.");
            return;
          }
          const installed = detectInstalledPwa();
          const platform = detectPlatform();
          await saveDeviceTokenDoc(user.uid, token, platform, installed);
          try {
            if ("setAppBadge" in navigator && installed) {
              (navigator as any).setAppBadge(0).catch(() => {});
            }
          } catch {}
          try {
            if (typeof localStorage !== "undefined") {
              localStorage.setItem("pushEnabled", "1");
            }
            (window as any).__pushEnabled = true;
          } catch {}
        } catch (err) {
          // no-op
        }
      }

      (window as any).__enablePush = enablePush;
    });
  }, [supported]);

  return <>{children}</>;
}
