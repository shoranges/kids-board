/* 서연·서우 보드 — 오프라인에서도 열리도록 화면을 저장해 둡니다 */
var CACHE = 'kids-board-v5';
var ASSETS = [
  './', './index.html', './meals.json', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './hanja/', './hanja/index.html', './hanja/manifest.json',
  './hanja/data-a.js', './hanja/data-b.js', './hanja/data-c.js', './hanja/app.js',
  './hanja/icon-192.png', './hanja/icon-512.png', './hanja/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(ASSETS);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  // 급식 API(NEIS)·날씨(Open-Meteo) 등 바깥 주소는 그대로 두고 캐시하지 않습니다(늘 새 자료를 보도록).
  var url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (r) {
        if (r) return r;
        // 한자 앱 화면을 새로 열 때(주소 끝이 /hanja/)도 오프라인에서 열리도록.
        if (url.pathname.indexOf('/hanja/') >= 0) return caches.match('./hanja/index.html');
        return caches.match('./index.html');
      });
    })
  );
});
