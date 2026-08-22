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
