# Building the SetTheSet APK

`.github/workflows/build-apk.yml` builds a signed release APK on every push to
`main` and publishes it to a GitHub Release tagged `latest`. One stable link to
send the team:

```
https://github.com/<you>/settheset/releases/download/latest/SetTheSet.apk
```

## Why Capacitor and not Bubblewrap

A Bubblewrap/TWA wrapper proves domain ownership by fetching
`/.well-known/assetlinks.json` from the **domain root**. A GitHub project page
lives at `<you>.github.io/settheset/` — the root belongs to a different repo, so
verification fails and the app opens with a browser address bar across the top.

Capacitor bundles the web assets into the APK instead. No assetlinks, no root
access needed, and the app works on a phone that has never once reached the
Pages URL. It's also what your PlotEdge repo already does, so the failure modes
are ones you've already met.

## The keystore — read this before deleting anything

`signing/settheset-release.keystore` is committed on purpose and is **not** in
`.gitignore`.

Android refuses to update an installed app whose signature doesn't match the
incoming APK. Without a stable key, every CI run signs with a fresh random debug
key, the update is refused as `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, and the only
way forward is uninstall — which deletes the app's storage, and with it every
service, song and arrangement on that device.

- Password: `settheset`, alias: `settheset`
- SHA-256: `61:28:85:44:09:37:0C:66:9D:B8:21:9F:49:58:55:6E:F8:7A:98:0B:2A:4A:FB:23:77:90:59:41:0E:26:C5:FC`

Keep a copy somewhere off GitHub. To rotate it, set repository secrets
`SETTHESET_KEYSTORE_B64`, `SETTHESET_KEYSTORE_PASSWORD`, `SETTHESET_KEY_ALIAS`,
`SETTHESET_KEY_PASSWORD` — but note that rotating breaks updates for anyone who
already installed a build signed with the old key.

This is a self-signed sideload key, not a Play Store upload key. Its only job is
to stay byte-identical between builds.

## versionCode

`scripts/patch-android-signing.py` derives versionCode from
`GITHUB_RUN_NUMBER + 1000`. The floor exists because deleting and recreating the
repo resets the run counter to 1, while phones still hold an APK at a higher
number — Android then reads the new build as a downgrade and refuses it with a
bare "App not installed".

## The test gate

The workflow runs `npm test` before it builds. A red test means no APK. That is
deliberate: a broken APK installs over a working one, and you find out about it
on a Sunday morning.

## Saving PDFs and Word documents

The Sheet screen writes real files rather than calling `window.print()`. That
change was forced by the APK: Capacitor's WebView has no print handler wired
up, so `window.print()` did nothing at all — the button flashed and no file was
ever produced. `js/export.js` now generates the PDF and the `.docx` itself,
offline, with no library and no network.

Writing them to `Documents/SetTheSet/` needs one plugin:

```
npm install @capacitor/filesystem
npx cap sync android
```

`@capacitor/share` is optional and only powers the "open it now" prompt after a
save. Without it the file is still written; you just have to go and find it.

Both are already in `package.json`, so CI picks them up from `npm install`.
Capacitor's native bridge exposes them at `window.Capacitor.Plugins.Filesystem`
automatically — no import or bundler step, same as KeepAwake.

If the plugin is missing at runtime, the export falls back to an ordinary blob
download, which inside a WebView lands in the system **Downloads** folder
instead of `Documents/SetTheSet`. That fallback is silent by design, so if
files are showing up in the wrong place, a missing plugin is the first thing to
check.

On Android 10 and below, writing to the public Documents folder needs a storage
permission; the export requests it and walks down a fallback chain
(`DOCUMENTS` → `EXTERNAL_STORAGE` → `EXTERNAL` → app storage) if it is refused,
so a save never simply fails.

## Updates

There is no "a new version is ready" banner any more. A waiting service worker
is held and swapped in silently once the user is back on the Sets or Songs list
with no sheet open — never mid-edit, and never during a service. Bump
`CACHE_VERSION` in `settheset-sw.js` whenever you change `index.html`, `css/`
or `js/`, exactly as before; the only thing that changed is that nobody gets
asked about it.

## Building a service from a written list

The Sets screen has **Build from a written list**. It takes a block of text —
typed, pasted, or read off a photo — and turns it into a reviewable draft
service. `js/import.js` does the parsing and the fuzzy match against the song
library; it has no dependencies and is covered by `tests/import.test.js`.

Two plugins power the camera path:

```
npm install @capacitor/camera @capacitor-community/image-to-text
npx cap sync android
```

Both are in `package.json`, so CI installs them. The OCR plugin does
recognition **on the device** (ML Kit on Android, Apple Vision on iOS) — no
network, no API key, no per-scan cost, which is the only kind of scanning that
is any use in a hall with no signal.

### Pinning the OCR plugin to Capacitor 6

Most OCR plugins have moved to Capacitor 7 or 8 peer ranges and will fail
`npm install` here with `ERESOLVE`. This project is on Capacitor 6, so the
version matters:

| Plugin | Peer range | Usable here |
| --- | --- | --- |
| `@capacitor-community/image-to-text@6.0.1` | `^6.0.0` | yes |
| `@capacitor-community/image-to-text@7+` | `>=7.0.0` | no |
| `@jcesarmobile/capacitor-ocr` | `>=8.0.0` | no |
| `@capacitor-mlkit/text-recognition` | `>=8.0.0` | no |
| `@pantrist/capacitor-plugin-ml-kit-text-recognition` | `>=7.0.0` | no |

Do not "fix" a resolution failure with `--legacy-peer-deps` or `--force`: it
installs a plugin built against a different Capacitor bridge, which compiles
and then fails at runtime on the device. Upgrade the whole project to
Capacitor 8 deliberately, or stay on the 6.x line of the plugin.

Note the plugin registers itself as **`CapacitorOcr`**, not `Ocr`. `js/app.js`
looks under several names so a future swap needs no code change, but if you
change plugin, check the registered name — getting it wrong makes the Scan
button silently never appear, which looks exactly like "not installed".

If either plugin is missing at runtime, the "Scan a photo instead" button
simply does not render and the paste/type path still works. That is why the
feature is safe to ship ahead of the plugins landing, and why it works
unchanged in the browser build on GitHub Pages.

### What to expect from the accuracy

ML Kit and Apple Vision are built for **printed** text. A typed or printed
sheet reads well. Neat block capitals are variable. Cursive is poor. Google's
handwriting model (Digital Ink Recognition) only works from stylus strokes,
not from a photograph, so there is no on-device option that reads handwriting
properly today.

The feature is designed around that rather than pretending otherwise:

- **Nothing goes straight into a service.** The review screen is mandatory,
  every field is editable, and the line as it was read stays visible above it.
- **The library does the heavy lifting.** A title only has to be *close* —
  "Goodnes of God" matches at 0.92 — and a match brings last time's key, BPM,
  chart and arrangement with it. The paper only ever had a title and a key.
- **Keys are never assumed.** A song with no key is flagged in red. The key
  parser deliberately rejects anything ambiguous (`E5`, `G run`) rather than
  guessing, because a wrong key is worse than a blank one: the blank gets
  caught at rehearsal, the wrong one gets caught in front of the congregation.
- **Only the accidental position is auto-corrected** for OCR lookalikes
  (`B6` → `Bb`, `8b` → `Bb`). A `6` in a song title stays a six.

If scan quality turns out to be the bottleneck, the place to improve it is a
cloud vision model, which reads handwriting far better — but that means a
network call, an API key inside a sideloaded APK, and a per-scan cost. That
trade is a deliberate decision, not a default.
