/* SetTheSet service worker.
 *
 * There is no CI build step stamping a hash in here — GitHub Pages serves this
 * repo's files as they are. So CACHE_VERSION is the manual lever: BUMP IT
 * whenever you change index.html, css/, or js/. If you don't, browsers that
 * already installed the app keep serving the old cache.
 *
 * Registration passes updateViaCache:'none' (see js/app.js) so the browser
 * always re-fetches this file rather than serving it from the HTTP cache,
 * which is what makes the bump take effect on the next load.
 */
var CACHE_VERSION = 'v13';
var SHELL_CACHE = 'settheset-shell-' + CACHE_VERSION;

/* Note: './' is deliberately absent. cache.addAll() rejects wholesale if any
   single entry 404s, and the navigation handler already falls back to
   index.html. Anything added to index.html must be added here too, or it will
   work online and fail offline. */
var SHELL = [
  'index.html',
  'css/app.css',
  'js/db.js',
  'js/chords.js',
  'js/sample.js',
  'js/metronome.js',
  'js/insights.js',
  'js/ui.js',
  'js/export.js',
  'js/import.js',
  'js/app.js',
  'settheset.manifest.json',
  'resources/mark.png',
  'resources/mark.svg',
  'resources/font-display.woff2',
  'resources/font-ui.woff2',
  'resources/font-data.woff2',
  'resources/favicon-128.png',
  'resources/apple-touch-icon-180.png',
  'resources/icon-192x192-any.png',
  'resources/icon-512x512-any.png'
];

var NAV_TIMEOUT_MS = 2500;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) { return c.addAll(SHELL); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();

  /* Lets app.js ask "which build are you" before deciding whether the
     "new version is ready" banner is honest. Two service worker files can be
     byte-different (whitespace, comments, staging artefacts from the CI
     build) without CACHE_VERSION having actually moved — that mismatch used
     to be enough on its own to trigger the banner, which is why it could
     show up with nothing meaningfully new inside it. */
  if (e.data && e.data.type === 'GET_VERSION' && e.ports && e.ports[0]) {
    e.ports[0].postMessage({ version: CACHE_VERSION });
  }
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  /* Navigations: try the network briefly, then fall back to cache.
     Pure cache-first would leave you on a stale build after a deploy; pure
     network-first would hang on a weak church wifi that resolves but never
     answers. The timeout is the compromise — with no signal at all the fetch
     rejects immediately and the cached shell paints. */
  if (req.mode === 'navigate') {
    e.respondWith(
      new Promise(function (resolve) {
        var settled = false;
        var done = function (res) { if (!settled) { settled = true; resolve(res); } };

        var timer = setTimeout(function () {
          caches.match('index.html', { ignoreSearch: true }).then(function (hit) {
            if (hit) done(hit);
          });
        }, NAV_TIMEOUT_MS);

        fetch(req).then(function (res) {
          clearTimeout(timer);
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(SHELL_CACHE).then(function (c) { c.put('index.html', copy); });
          }
          done(res);
        }).catch(function () {
          clearTimeout(timer);
          caches.match('index.html', { ignoreSearch: true }).then(function (hit) {
            done(hit || new Response('Offline and nothing cached yet.', {
              status: 503, headers: { 'Content-Type': 'text/plain' }
            }));
          });
        });
      })
    );
    return;
  }

  /* Everything else: cache first for instant paint, revalidate in the
     background so the next load has the fresh copy. */
  e.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return hit || new Response('', { status: 504, statusText: 'Offline' });
      });

      return hit || network;
    })
  );
});
