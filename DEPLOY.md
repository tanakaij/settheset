# Deploying SetTheSet on GitHub Pages

Same shape as your PlotEdge repo: root-level files, `.nojekyll`, deploy from a
branch. No Pages workflow needed.

## Steps

1. **Create a repo** on GitHub — public, since Pages on private repos needs a
   paid plan.
2. **Push these files to the repo root.**
   ```bash
   git init
   git add .
   git commit -m "SetTheSet"
   git branch -M main
   git remote add origin https://github.com/<you>/settheset.git
   git push -u origin main
   ```
3. **Settings → Pages → Source → Deploy from a branch**, pick `main` and
   `/ (root)`, Save.
4. You get `https://<you>.github.io/settheset/`. Give it a minute on first push.

HTTPS comes free on `github.io`, which matters — service workers only register
on a secure origin, so without it the app loads but silently loses offline mode.

## Installing it

Open the URL in Chrome → menu → **Install app**. Icon in the drawer,
full-screen, works with no signal. On iPad it's Share → Add to Home Screen.

## After every change: bump the cache version

There is no CI step stamping a build hash into the service worker, so this one
is manual. Open `settheset-sw.js`, find:

```js
var CACHE_VERSION = 'v1';
```

Bump it (`v2`, `v3`, …) whenever you change `index.html`, anything in `css/`,
or anything in `js/`. Skip it and installed devices keep serving the old cache
even though Pages has the new files.

Registration passes `updateViaCache: 'none'`, so the browser always re-fetches
the worker itself — that's what makes the bump take effect on the next load.

If you add a new file to `index.html`, add it to the `SHELL` array in
`settheset-sw.js` too. Miss that and it works online and 504s offline.
`npm test` checks this for you.

## Testing before you push

```bash
npm install
npm test          # 90 assertions across two files
npm run serve     # then open http://localhost:8000
```

Service workers are allowed on `localhost` over plain HTTP, so offline mode is
testable without a certificate. In DevTools: Application → Service Workers, and
the Network panel's Offline throttle to confirm a cold start with no connection.
