/* Static checks that don't need a DOM. These catch the two mistakes that are
   invisible on GitHub Pages and fatal in the APK:
     1. a file referenced by index.html that the workflow never stages;
     2. a file added to index.html but forgotten in the service worker's
        SHELL list, which works online and 504s offline. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const check = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};

const html = read('index.html');
const sw = read('settheset-sw.js');
const manifest = JSON.parse(read('settheset.manifest.json'));

console.log('\n— referenced files exist —');
const refs = [
  ...html.matchAll(/(?:href|src)="((?:css|js|resources)\/[^"]+)"/g)
].map(m => m[1]);
const uniq = [...new Set(refs)];
check('index.html references at least 4 assets', uniq.length >= 4);
for (const r of uniq) {
  check(r + ' exists', fs.existsSync(path.join(ROOT, r)));
}

console.log('\n— service worker precache covers them —');
for (const r of uniq) {
  if (r.startsWith('resources/') && !/\.(png|jpg)$/.test(r)) continue;
  check(r + ' is in SHELL', sw.includes("'" + r + "'"));
}
check('index.html is in SHELL', sw.includes("'index.html'"));
check('manifest is in SHELL', sw.includes("'settheset.manifest.json'"));

console.log('\n— every SHELL entry is a real file —');
const shell = [...sw.matchAll(/^\s*'([^']+)',?$/gm)].map(m => m[1])
  .filter(s => /\.(html|css|js|json|png)$/.test(s));
check('SHELL is not empty', shell.length > 0);
for (const s of shell) {
  check('SHELL: ' + s + ' exists', fs.existsSync(path.join(ROOT, s)));
}

console.log('\n— manifest icons exist —');
for (const icon of manifest.icons) {
  check(icon.src + ' exists', fs.existsSync(path.join(ROOT, icon.src)));
}
check('has a maskable icon', manifest.icons.some(i => i.purpose === 'maskable'));
check('start_url is relative', !manifest.start_url.startsWith('/'));
check('name is SetTheSet', manifest.name === 'SetTheSet');

console.log('\n— no leftover branding or absolute paths —');
check('no "Sunday Set" left in index.html', !html.includes('Sunday Set'));
check('no absolute /css or /js paths', !/(?:href|src)="\/(?:css|js)/.test(html));
check('sw registered with the right filename', read('js/app.js').includes('settheset-sw.js'));


console.log('\n— Android chrome colour agreement —');
const css = read('css/app.css');
const themeColor = (html.match(/name="theme-color" content="(#[0-9A-Fa-f]{6})"/) || [])[1];
const panel = (css.match(/--panel:\s*(#[0-9A-Fa-f]{6})/) || [])[1];
const themePy = read('scripts/patch-android-theme.py');
check('theme-color meta is set', !!themeColor);
check('--panel is set', !!panel);
check('theme-color matches --panel', themeColor && panel && themeColor.toUpperCase() === panel.toUpperCase());
check('native status bar uses the same colour',
  themePy.includes('#FF' + (panel || '').replace('#', '').toUpperCase()));
check('colour-scheme declared dark', html.includes('name="color-scheme" content="dark"'));

console.log('\n— safe areas on all four edges —');
for (const edge of ['top', 'bottom', 'left', 'right']) {
  check('safe-area-inset-' + edge + ' used', css.includes('safe-area-inset-' + edge));
}
check('top bar insets horizontally', /\.topbar\s*\{[^}]*safe-area-inset-left/s.test(css));
check('page content insets horizontally', /\.stack\s*\{[^}]*safe-area-inset-left/s.test(css));
check('live list insets horizontally', /\.livelist\s*\{[^}]*safe-area-inset-left/s.test(css));
check('modal footer clears the gesture bar', /\.modal__foot\s*\{[^}]*safe-area-inset-bottom/s.test(css));

console.log('\n— touch targets —');
const tap = parseInt((css.match(/--tap:\s*(\d+)px/) || [])[1], 10);
check('base tap target is at least 48px', tap >= 48);
const smallest = [...css.matchAll(/min-height:\s*(\d+)px/g)]
  .map(m => parseInt(m[1], 10))
  .filter(n => n > 20);
check('no interactive height below 36px', Math.min(...smallest) >= 36);

console.log('\n— no horizontal overflow traps —');
check('long titles can wrap', css.includes('overflow-wrap: anywhere'));
check('flex children can shrink', /\.item__title\s*\{[^}]*min-width:\s*0/s.test(css));
check('action rows wrap', /\.item__acts\s*\{[^}]*flex-wrap:\s*wrap/s.test(css));
check('narrow-screen breakpoint exists', css.includes('@media (max-width: 360px)'));
/* Found in QA at 320px: one long name in the sheet's role list set the width
   of the whole document and scrolled the entire page sideways, because the
   role/name pair was nowrap with no min-width escape. */
check('sheet role pairs can wrap', /\.srow__roles div\s*\{[^}]*flex-wrap:\s*wrap/s.test(css));
check('sheet role pairs can shrink', /\.srow__roles div\s*\{[^}]*min-width:\s*0/s.test(css));
check('a long name wraps rather than overflows', /\.srow__roles dd\s*\{[^}]*overflow-wrap:\s*anywhere/s.test(css));

console.log('\n— markup validity —');
check('no block elements nested in a button',
  !/<button[^>]*>[^<]*<(h[1-6]|p|div)\b/.test(html));
check('setmeta exposes a button role', html.includes('role="button"'));

console.log('\n— back navigation is wired —');
const app = read('js/app.js');
check('popstate handled', app.includes("addEventListener('popstate'"));
check('history entries pushed', app.includes('history.pushState'));
check('initial state seeded', app.includes('history.replaceState'));
check('modal open/close hooks used', app.includes('UI.onOpen') && app.includes('UI.onClosed'));


console.log('\n— self-hosted fonts —');
const cssText = read('css/app.css');
const faces = [...cssText.matchAll(/url\('\.\.\/(resources\/[^']+)'\)/g)].map(m => m[1]);
check('font files referenced', faces.length === 3);
for (const f of faces) {
  check(f + ' exists', fs.existsSync(path.join(ROOT, f)));
  check(f + ' is precached', sw.includes("'" + f + "'"));
  const kb = fs.statSync(path.join(ROOT, f)).size / 1024;
  check(f + ' is under 60 KB (' + kb.toFixed(0) + ')', kb < 60);
}
check('no external font CDN', !cssText.includes('fonts.googleapis') && !cssText.includes('fonts.gstatic'));
check('font-display: swap set', /font-display:\s*swap/.test(cssText));
check('display face used for titles', cssText.includes('var(--font-display)'));

console.log('\n— vector icon master —');
check('mark.svg exists', fs.existsSync(path.join(ROOT, 'resources/mark.svg')));
const svg = read('resources/mark.svg');
check('gradient is userSpaceOnUse', svg.includes('gradientUnits="userSpaceOnUse"'));
check('has a viewBox', svg.includes('viewBox='));
check('icons are generated from it', read('tools/make_icons.py').includes('mark.svg'));

console.log('\n— motion respects the reduced-motion setting —');
check('reduced-motion block exists', cssText.includes('prefers-reduced-motion'));
const rm = cssText.slice(cssText.indexOf('prefers-reduced-motion'));
check('animations disabled there', rm.includes('animation: none !important'));
check('fill-mode leftovers reset', /opacity:\s*1;\s*transform:\s*none/.test(rm));

console.log('\n— haptics are optional —');
const appJs = read('js/app.js');
check('vibrate is feature-detected', appJs.includes('if (!navigator.vibrate) return'));
check('vibrate calls are guarded', appJs.includes('try { navigator.vibrate'));


console.log('\n— stacking order: nothing may cover an open sheet —');
const layer = name => {
  const m = cssText.match(new RegExp('\\' + name + '[^{]*\\{[^}]*z-index:\\s*(\\d+)', 's'));
  return m ? parseInt(m[1], 10) : null;
};
const zModal = layer('.modal ');
const zToast = layer('.toast ');
check('modal has a z-index', zModal !== null);
check('toast sits above the modal', zToast !== null && zToast > zModal);

console.log('\n— updates apply silently, with no banner —');
check('no update bar in the markup', !html.includes('id="updateBar"'));
check('no update bar styles left behind', !/^\.update\s*\{/m.test(cssText));
check('a waiting worker is held, not announced', appJs.includes('pendingWorker'));
check('the swap is gated on being idle', appJs.includes('function applyUpdateIfIdle'));
check('never swaps with a sheet open', /applyUpdateIfIdle[\s\S]{0,400}UI\.isOpen\(\)/.test(appJs));
check('never swaps off a list screen',
  /applyUpdateIfIdle[\s\S]{0,500}state\.view !== 'sets'[\s\S]{0,60}state\.view !== 'songs'/.test(appJs));

console.log('\n— the modal tracks the visible viewport, not the layout one —');
check('viewport height variable declared', cssText.includes('--vvh'));
check('modal is sized from it', /\.modal\s*\{[^}]*var\(--vvh/s.test(cssText));
check('modal no longer uses inset: 0', !/\.modal\s*\{[^}]*inset:\s*0/s.test(cssText));
check('visualViewport is observed', read('js/ui.js').includes('visualViewport'));
check('there is a fallback for browsers without it', read('js/ui.js').includes('global.innerHeight'));

console.log('\n— documents are generated, not printed —');
const exportJs = read('js/export.js');
check('export module exists', fs.existsSync(path.join(ROOT, 'js/export.js')));
check('export.js is loaded by index.html', html.includes('js/export.js'));
check('export.js is precached', sw.includes("'js/export.js'"));
check('a PDF writer is present', exportJs.includes('%PDF-1.4'));
check('a DOCX writer is present', exportJs.includes('word/document.xml'));
check('PDF and Word buttons exist', html.includes('id="btnPdf"') && html.includes('id="btnDocx"'));
check('both are wired up', appJs.includes("$('btnPdf')") && appJs.includes("$('btnDocx')"));
check('the sheet model feeds them', appJs.includes('function sheetModel'));
check('saving prefers the native filesystem', exportJs.includes('Filesystem'));
check('and falls back to a download', exportJs.includes('saveBrowser'));
check('print is still available for desktop', html.includes('id="btnPrint"'));
check('setlist is a selectable view', html.includes('data-sv="setlist"'));
check('setlist view is defined', appJs.includes('setlist: { label: '));
check('setlist has its own model', appJs.includes('function setlistModel'));
check('setlist has its own screen renderer', appJs.includes('function renderSetlistSheet'));
check('setlist has its own PDF layout', exportJs.includes('function buildSetlistPdf'));
check('the PDF writer branches on it', exportJs.includes("model.layout === 'setlist'"));
check('setlist drops elements', /setlistModel[\s\S]{0,300}filter\(isSong\)/.test(appJs));
check('exports follow the selected view', appJs.includes('function currentModel'));

console.log('\n— building a service from a written list —');
const importJs = read('js/import.js');
check('parser module exists', fs.existsSync(path.join(ROOT, 'js/import.js')));
check('parser is loaded by index.html', html.includes('js/import.js'));
check('parser is precached', sw.includes("'js/import.js'"));
check('import entry point exists', html.includes('id="btnImport"'));
check('review view exists', html.includes('id="view-import"'));
check('review view is registered in show()', appJs.includes("'sheet', 'import'"));
check('review view has a depth', /DEPTH\s*=\s*\{[^}]*import:/.test(appJs));
check('nothing is created without review', appJs.includes("$('btnImportCreate')"));
check('camera and OCR are both optional',
  appJs.includes('function ocrPlugin') && appJs.includes('function cameraPlugin'));
check('OCR result shapes are handled defensively', appJs.includes('function ocrText'));
check('rows can be skipped', appJs.includes('data-drop'));
check('missing keys are flagged', appJs.includes('needsKey'));

/* Three bugs found in QA, pinned so they cannot come back:
     1. the review screen had no PARENT, so the top-bar Back button was dead;
     2. navTo() from inside the sheet's onSave had the sheet's own close
        handler swallow the entry the review screen had just pushed;
     3. service elements were flagged as missing a key, which trains people
        to ignore the flag on the songs where it actually matters. */
check('review screen has a parent for Back', /PARENT\s*=\s*\{[^}]*import:\s*'sets'/.test(appJs));
check('the sheet entry is replaced, not stacked', appJs.includes('function enterReview'));
check('entering review retires the sheet entry itself',
  /enterReview[\s\S]{0,400}modalPushed = false[\s\S]{0,200}closeSilent/.test(appJs));
check('an emptied review screen is not restored from history',
  /target === 'import' && !importRows\.length/.test(appJs));
check('elements are exempt from the key flag',
  importJs.includes('!row.element && !row.key'));
check('the original line is retained', importJs.includes('raw:'));
check('library matches inherit the chart',
  /lib\)\s*\{[\s\S]{0,300}'chords'/.test(appJs));

console.log('\n— dependencies resolve against this Capacitor major —');
/* This suite once passed while `npm install` itself failed with ERESOLVE: an
   OCR plugin was added at a version whose peer range wanted Capacitor 8 while
   the project is on 6. Tests that go green on a tree that cannot be installed
   are worse than no tests, so the peer ranges are checked here. */
const pkg = JSON.parse(read('package.json'));
const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
const capRange = deps['@capacitor/core'] || '';
const capMajor = parseInt(capRange.replace(/[^\d.]/g, '').split('.')[0], 10);
check('@capacitor/core major is known', !isNaN(capMajor));

for (const name of Object.keys(deps)) {
  const meta = path.join(ROOT, 'node_modules', name, 'package.json');
  if (!fs.existsSync(meta)) continue;   // not installed here; CI will catch it
  const peer = (JSON.parse(fs.readFileSync(meta, 'utf8')).peerDependencies || {})['@capacitor/core'];
  if (!peer) continue;
  // Lowest major the peer range will accept.
  const lowest = parseInt((peer.match(/(\d+)/) || [])[1], 10);
  check(name + ' accepts Capacitor ' + capMajor + ' (peer ' + peer + ')',
    !isNaN(lowest) && lowest <= capMajor);
}

check('the OCR plugin is looked up by its registered name',
  appJs.includes('p.CapacitorOcr'));

console.log('\n— derived numbers —');
/* The insights module is loaded by index.html and precached like every other
   script. It has no build step, so the only thing standing between "added a
   file" and "the APK ships without it" is this check. */
check('insights module exists', fs.existsSync(path.join(ROOT, 'js/insights.js')));
check('insights.js is loaded by index.html', html.includes('js/insights.js'));
check('insights.js is precached', sw.includes("'js/insights.js'"));
const insightsJs = read('js/insights.js');
check('usage is derived, not stored', insightsJs.includes('function usageIndex'));
check('future services are excluded from usage', insightsJs.includes('set.date > today'));
check('songs match on id or normalised title',
  insightsJs.includes('byId') && insightsJs.includes('byTitle'));
check('service health exists', insightsJs.includes('function serviceHealth'));
check('drift needs a start time', /drift[\s\S]{0,200}!set\.startTime/.test(insightsJs));
check('a plain-text setlist can be produced', insightsJs.includes('function shareText'));

console.log('\n— the home screen leads with the next service —');
check('a hero host exists', html.includes('id="heroHost"'));
check('the hero is rendered from data', appJs.includes('function renderHero'));
check('services are split into sections', appJs.includes('sechead__title'));
check('the next service is marked', appJs.includes('card--next'));
check('there is a countdown', appJs.includes('function countdown'));
check('the key journey is computed', appJs.includes('function keyRun'));
check('a loading skeleton is present', html.includes('id="setsSkeleton"'));
check('the skeleton is hidden once loaded', appJs.includes("$('setsSkeleton')"));

console.log('\n— the library reports rotation —');
check('filter chips exist', html.includes('id="songFilters"'));
check('all four filters are present',
  ['all', 'recent', 'resting', 'new'].every(f => html.includes('data-filter="' + f + '"')));
check('filters are wired', appJs.includes("$('songFilters')"));
check('usage is shown per song', appJs.includes('Insights.usageLabel'));
check('the usage index is invalidated when services change',
  /loadSets[\s\S]{0,400}state\.usage = null/.test(appJs));

console.log('\n— the editor flags an overrun before Sunday does —');
check('a health host exists', html.includes('id="healthHost"'));
check('health is rendered', appJs.includes('function renderHealth'));
check('a target length can be set', appJs.includes('targetMinutes'));
check('warnings are collapsed by default', appJs.includes('state.healthOpen'));

console.log('\n— live mode carries a running clock —');
check('a wall clock exists', html.includes('id="liveClock"'));
check('a drift chip exists', html.includes('id="liveDrift"'));
check('the clock ticks on its own timer', appJs.includes('function tickClock'));
check('it starts with live mode', appJs.includes('startClock()'));
/* A timer left running in a background tab is a battery bug you never see in
   testing and always hear about afterwards. */
check('and is stopped on the way out', appJs.includes('stopClock()'));
check('leaving live clears the interval', /stopClock[\s\S]{0,200}clearInterval/.test(appJs));
check('the current item has an elapsed readout', appJs.includes('lcard__elapsed'));
check('the elapsed timer survives a re-render',
  /state\.liveIdx !== nowIdx/.test(appJs));
check('what is coming is previewed', appJs.includes('lcard__next'));

console.log('\n— sharing the list as text —');
check('a share control exists', html.includes('id="btnShare"'));
check('it is wired', appJs.includes("$('btnShare')"));
check('native share is preferred where present', appJs.includes('navigator.share'));
check('clipboard is the fallback', appJs.includes('navigator.clipboard'));
check('and execCommand backs that up', appJs.includes('execCommand'));

console.log('\n— toasts distinguish outcomes —');
check('toast takes a kind', read('js/ui.js').includes('function toast(text, kind)'));
check('warn and info variants are styled',
  cssText.includes('.toast--warn') && cssText.includes('.toast--info'));

console.log('\n— android launcher assets —');
const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
for (const d of densities) {
  for (const n of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground']) {
    const f = 'resources/android/' + n + '-' + d + '.png';
    check(f + ' committed', fs.existsSync(path.join(ROOT, f)));
  }
}
check('splash committed', fs.existsSync(path.join(ROOT, 'resources/android/splash.png')));
const iconPatch = read('scripts/patch-android-icons.py');
check('icon patch uses the panel colour', iconPatch.includes('#FF1B1C21'));
check('icon patch verifies it landed', iconPatch.includes('would ship the default logo'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
