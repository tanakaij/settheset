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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
