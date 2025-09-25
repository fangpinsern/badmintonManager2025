self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => self.clients.claim());

// Basic background push handling compatible with FCM payloads
self.addEventListener("push", (event) => {
  try {
    const data = event.data?.json?.() ?? {};
    const title = data.notification?.title || data.title || "Update";
    const body = data.notification?.body || data.body || "";
    const url = (data.data && data.data.url) || data.url || "/";
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        data: { url },
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
      })
    );
  } catch (err) {
    // no-op
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification && event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.openWindow(url));
});


