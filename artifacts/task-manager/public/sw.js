/* Sổ Công service worker: cache the app shell only; never cache private API data. */
const SHELL_CACHE = "so-cong-shell-v1";
const SHELL_FILES = ["./", "./index.html"];
const OUTBOX_SYNC_TAG = "so-cong-pending-writes";
const OUTBOX_SYNC_MESSAGE = "SO_CONG_SYNC_PENDING_WRITES";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("so-cong-shell-") && key !== SHELL_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put("./index.html", copy));
          }
          return response;
        })
        .catch(async () => (await caches.match("./index.html")) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(request);
      const cacheControl = response.headers.get("cache-control") || "";
      if (response.ok && response.type === "basic" && !cacheControl.includes("no-store")) {
        const copy = response.clone();
        void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }),
  );
});

async function askOpenAppToSync() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  await Promise.all(clients.map((client) => new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      resolve();
    }, 25000);
    channel.port1.onmessage = () => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve();
    };
    client.postMessage({ type: OUTBOX_SYNC_MESSAGE }, [channel.port2]);
  })));
}

self.addEventListener("sync", (event) => {
  if (event.tag === OUTBOX_SYNC_TAG) {
    // The signed-in page supplies a fresh Clerk token and verifies account and
    // business scope. The worker deliberately never stores authentication data.
    event.waitUntil(askOpenAppToSync());
  }
});
