// Service Worker لإشعارات طلبات الصيدلية: يعرض الإشعار والمنظومة مغلقة، ويفتح الطلب عند الضغط.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "طلب صيدلية", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "طلب صيدلية جديد";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    lang: "ar",
    dir: "rtl",
    icon: "/logo.png",
    badge: "/logo.png",
    data: { url: data.url || "/admin/pharmacy-services/orders" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/admin/pharmacy-services/orders", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
