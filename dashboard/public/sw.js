/*
 * Service worker for the Imperial Indopack staff PWA.
 *
 * Deliberately does NOT cache anything. A stale team queue is worse than a slow one, and
 * getting invalidation wrong here means staff acting on data that has already moved. Revisit
 * with a real cache strategy only if page loads actually get slow.
 *
 * Its whole job is push: receive a notification while the app is closed, and open the right
 * conversation when it is tapped.
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Never drop a notification because the payload was malformed - a silent push is
    // indistinguishable from the outage this whole feature exists to prevent.
    payload = { title: "Imperial Indopack", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Imperial Indopack", {
      body: payload.body ?? "",
      icon: "/app/icon-192.png",
      badge: "/app/icon-192.png",
      // Hand-offs arriving while the phone is in a pocket must stack, not overwrite each
      // other, so no shared tag - each notification keeps its own url.
      data: { url: payload.url },
      // The point of this feature is that a phone in a pocket gets someone's attention.
      requireInteraction: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (!url) return;

  // Focus an already-open dashboard rather than piling up tabs; only open a new one if there
  // is nothing to focus.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      for (const client of clients) {
        if ("navigate" in client) return client.navigate(url).then((c) => c && c.focus());
      }
      return self.clients.openWindow(url);
    })
  );
});
