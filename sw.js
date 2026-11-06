/* =========================================================
   サービスワーカー（オフラインでもアプリを開けるようにする仕組み）
   ---------------------------------------------------------
   ・ネットにつながっているときは、いつも最新のファイルを取りに行く
   ・つながっていないときは、前回保存しておいたファイルで表示する
   ・ファイルを大きく変えたら、下の CACHE の番号を1つ上げる
   ========================================================= */
const CACHE = "solitaire-v14";

// 最初に保存しておくファイルの一覧
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./js/game.js",
  "./js/solver.js",
  "./manifest.webmanifest",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
];

// インストールされたとき：ファイルを保存しておく
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

// 新しい版になったとき：古い保存ファイルを消す
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ファイルを読み込むとき：まずネットから、だめなら保存しておいたものを使う
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    // cache: "no-cache" … ブラウザに古いファイルが残っていても、必ず新しいか確かめてから使う
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        // 正常に取れたファイルだけを保存する
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html")))
  );
});
