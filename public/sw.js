/*
 * ホーム画面へのインストール機能は廃止した。
 * 以前のバージョンでこの Service Worker を登録した端末から、自分自身とキャッシュを消すためだけに残している。
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
    })(),
  );
});
