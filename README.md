# SetTheSet

Setlist planning for a gospel musician. Plan a service, run it from the bench,
print it for the team. Works with no signal — everything is stored on the device.

Deployed as a PWA on GitHub Pages; the same repo builds a signed Android APK via
GitHub Actions. See `DEPLOY.md` and `BUILD_APK.md`.

## What it does

**Services** — one per Sunday. Duplicate last week's in one tap and change the
date; ticks reset, songs and arrangements carry over.

**Services contain songs and elements.** A service isn't just a song list —
welcome, scripture, offering, testimony, sermon and altar call all sit in the
running order and all take time. Elements carry a duration and notes; songs
carry everything below.

**Songs in a service** carry, per Sunday: key (independent of the song's usual
key), capo, time signature, BPM, length, original artist, where it falls in the
service, sounds/patches, a chord chart, arrangement and cues, transition into
the next item, first line for the slides, a reference recording link, and roles
— instrument or part plus the person's name.

**Running time.** Give the service a start time and every item shows the wall
clock it should begin at, with the total and the finish time on the header. No
start time and you get cumulative offsets instead. This is what tells you the
service will overrun before it does.

**Chord charts in Nashville numbers.** You type `| 1 - 6m | 4 - 5 |` once. The
app shows the numbers as typed and the letter names underneath, derived from
this Sunday's key — change the key and the letters follow. Capo works the same
way: set capo 1 in Ab and it tells you to play G shapes. You can mix real chord
names into a chart and they pass through untouched.

**Song library** — a reusable catalogue. Adding a song to a service saves it to
the library by default; next time you pick it from a dropdown and it fills the
form in, still fully editable.

**Run service** — full-screen mode for during the service. The key is set at
display size because that's the one thing you need at a glance from the bench.
Current song is ringed with the gradient, arrangement and roles visible without
tapping, one big button ticks it off, progress reads `3 / 9`. Screen stays awake.

**Sheet / PDF, five ways.** Same running order, filtered per person: Full,
Keys/MD, Band, Vocals, Media & sound. The drummer doesn't get your patch notes;
the media desk gets first lines and timings and no chord charts. *Save as PDF*
in the print dialog gives a real PDF with selectable text, no PDF library
bundled. Print each view separately.

**The home screen leads with next Sunday.** A hero card carries the countdown
("in 3 days"), the song and element counts, the running time and finish, the
run of keys the service travels through, and how far through it you got if you
have started. Open and Run service sit on it. Below, services are split into
**Coming up** and **Done** rather than one flat list where next Sunday and a
Sunday eighteen months ago carried identical weight.

**Song rotation.** Every song in the library shows how many times it has been
played and when it last was — derived from the services already on the device,
so there is nothing new to store or keep in step. Four filters answer the
question you actually arrive with: *All*, *Recent* (inside a month), *Resting*
(a quarter without it) and *Never played*. Future services do not count as
plays.

**Service health.** Give the service a target length and the editor says
*"Over the slot by 15 min"* while there is still time to do something about it.
It also flags songs with no key, items with no length, three consecutive songs
in the same key, and a running order with no elements in it. Every warning
carries the arithmetic behind it — "75 min of material against a 60 min
service" is actionable in a way that "this looks long" is not. Collapsed to one
line when there is nothing wrong.

**The running clock, live.** During the service the bar carries the wall clock
and a drift chip: *On time*, *4 min behind*, *6 min ahead*. The current song
shows how long it has actually been running against how long it was given, and
the card previews what is coming so you can set up for it without scrolling
away from what you are playing. This is the number an MD carries in their head
all morning and the one thing a paper running order can never tell you.

**Share list** — the running order as plain text, straight to the group chat.
A PDF is the right artefact for a music stand and the wrong one for WhatsApp
the night before, where half the team will open it on a phone with no storage
left. Native share sheet where there is one, clipboard everywhere else.

**Back up / Restore** — writes a JSON file of everything. Do it occasionally.

## Usability choices

Every edit happens in a bottom sheet, so it lands under your thumb. Modals **do
not** close when you tap the dark area around them — with one hand still on the
keys, a stray tap that wipes a half-typed arrangement is worse than one extra
deliberate tap. Buttons are 52px minimum. Reordering is up/down arrows, not
drag.

## Files

```
index.html                     the whole shell: five views + the modal host
css/app.css                    tokens, layout, live mode, print styles
js/db.js                       IndexedDB (songs + setlists)
js/chords.js                   Nashville numbers -> chord names, capo shapes
js/metronome.js                Web Audio click, meter-aware
js/sample.js                   the sample service offered on first run
js/ui.js                       modal sheet, toast, confirm
js/app.js                      views, editing, live mode, sheet, backup
settheset-sw.js                service worker — BUMP CACHE_VERSION ON CHANGES
settheset.manifest.json        PWA manifest
resources/                     icons (from mark.svg) + three subset woff2 faces
tools/make_icons.py            regenerates them
tools/make_android_assets.py   renders the APK launcher icons (run locally)
tests/                         npm test — 603 assertions, gates the APK build
scripts/                       Capacitor signing, theme and launcher-icon patches
signing/                       the stable release keystore — DO NOT DELETE
.github/workflows/build-apk.yml
.nojekyll                      tells Pages to serve files as-is
```

## Design notes

**The hero.** The home screen opened on three stacked grey buttons and a pair
of counters: it told you the app worked, not what your Sunday looked like. The
gradient was already reserved for "the thing that is live right now" — the next
service is the home-screen equivalent of that, so it gets the same treatment.

**Everything derived, nothing stored.** Usage counts, rotation status, health
warnings and drift are all computed from setlists that were already on the
device. No new store, no migration, no second source of truth to fall out of
step. The usage index is invalidated whenever services reload.

**Warnings are amber, not red.** Red stays reserved for destructive actions in
this app, so it has to keep meaning "this deletes something". A service running
long is amber; a missing key is amber; Delete is red.

**Evidence, not vibes.** Every warning names the songs and the numbers that
produced it. A confident-sounding claim with nothing visible behind it is worse
than silence, particularly on a screen someone checks at 8am on a Sunday.

## Theme

Palette taken from the supplied UI reference: slate page (`#303644`), near-black
chrome (`#1B1C21`), raised slate cards (`#313747`), mint (`#48F8BA`) for
anything you act on, and a violet→cyan gradient spent only on the service header
and the one song that's live right now. Musical data is set in monospace so
`Ab` and `F#m` read instantly.

## First run

An empty install offers a sample Sunday: three real songs with charts, roles
and durations, a scripture reading among them, a start time and a running
clock. Opening it teaches the app faster than any tour — you see a chart
transposing, an element counted into the running time, and five PDF views, all
with real content.

Everything it creates is tagged `sample: true`, and **?** in the top bar offers
one tap to remove all of it without touching anything real. Sample data you
cannot get rid of is worse than none.

The **?** button also holds a short guide to the number system, songs versus
elements, the five sheets, and why backups matter.

## Metronome

Every song already carried a BPM and a time signature. In live mode, songs with
a BPM get a click button: tap it and the beat dots pulse in time.

Compound meters are handled properly — 12/8 clicks four dotted-quarter pulses,
not twelve even eighths, because that is how the band counts it. 6/8 gives two,
cut time gives two half notes.

Timing uses a lookahead scheduler against the Web Audio clock rather than
setInterval, which drifts and stalls when the phone throttles. The click stops
when you tick the song off or leave live mode, so it can never be left running
in an earpiece.

## Type and icon

Three variable faces, self-hosted and precached, 97 KB total: Bricolage
Grotesque for titles, Instrument Sans for the interface, JetBrains Mono for
every piece of musical data. No font CDN — that would be a network call this
app cannot depend on.

The icon comes from `resources/mark.svg`, a redraw of the supplied artwork as
real paths. `tools/make_icons.py` renders every PNG size from it. The previous
version alpha-cut the logo out of a JPEG and went soft below 192px.

## Android specifics

**Status bar colour.** `<meta name="theme-color">`, `--panel` in the CSS, and
`scripts/patch-android-theme.py` all carry the same `#1B1C21`. The meta tag
covers the Chrome-installed PWA; the patch script covers the APK, where the
status bar comes from the Android theme instead and Capacitor's default is a
stock blue-grey. A test asserts the three stay in agreement.

**Safe areas** are applied on all four edges, including left and right for
landscape on a notched phone. The APK is deliberately *not* edge-to-edge, so
insets read as zero there — correct, since the WebView starts below the status
bar. They do their real work in the browser-installed PWA. If `targetSdk` is
ever raised to 35+, Android forces edge-to-edge and this needs revisiting.

**Hardware Back** is fully wired. There is no browser chrome in the APK, so
Back is the only back affordance: it closes an open sheet, then walks live →
editor → services list, and only exits from the list. Cancel and Save retire
the sheet's history entry so Back never needs pressing twice.

## Deliberately not included

**CCLI fields.** Song number, publisher and a reporting export would belong here
if you held a licence. You don't, so they'd be dead fields on every form.
Straightforward to add later if that changes.

## If you want more later

Lyrics beyond the first line; a read-only sheet link to share instead of a PDF;
a rehearsal timer; multiple services on one day sharing a song list.
