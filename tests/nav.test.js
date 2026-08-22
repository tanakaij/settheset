/* Navigation and Back.
   In the installed APK there is no browser chrome, so Android's hardware Back
   is the only back affordance. If it isn't wired, it closes the whole app —
   mid-service. These tests drive real history.back() calls. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
require('fake-indexeddb/auto');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => errors.push('jsdomError: ' + e.message));

const dom = new JSDOM(html, {
  url: 'https://example.github.io/settheset/',
  runScripts: 'outside-only',
  virtualConsole: vc,
  pretendToBeVisual: true
});

const { window } = dom;
const doc = window.document;

window.indexedDB = indexedDB;
window.IDBKeyRange = IDBKeyRange;
window.crypto = window.crypto || {};
if (!window.crypto.randomUUID) { let n = 0; window.crypto.randomUUID = () => 'n-' + (++n); }
window.scrollTo = () => {};
window.print = () => {};
window.Element.prototype.scrollIntoView = () => {};

for (const f of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const $ = id => doc.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const back = async () => { window.history.back(); await wait(90); };
const active = () => ['sets', 'songs', 'editor', 'live', 'sheet']
  .find(v => $('view-' + v).classList.contains('is-active'));

let pass = 0, fail = 0;
const check = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '  (view=' + active() + ', modal=' + !$('modal').hidden + ')'); }
};

(async () => {
  await wait(150);
  check('boots on the services list', active() === 'sets');

  console.log('\n— Back closes a sheet instead of leaving the screen —');
  click($('btnNewSet'));
  await wait(90);
  check('sheet opened', !$('modal').hidden);
  await back();
  check('sheet closed', $('modal').hidden);
  check('still on the services list', active() === 'sets');

  console.log('\n— Cancel does not leave a dead history entry —');
  click($('btnNewSet'));
  await wait(90);
  click($('modalCancel'));
  await wait(120);
  check('sheet closed by Cancel', $('modal').hidden);
  await back();
  // if Cancel had left its entry behind, this Back would be swallowed doing
  // nothing and the user would have to press twice
  check('one Back still reaches the base state', active() === 'sets');

  console.log('\n— drilling in and walking back out —');
  click($('btnNewSet'));
  await wait(90);
  $('f_service').value = 'Sunday morning';
  click($('modalSave'));
  await wait(200);
  check('landed in the editor', active() === 'editor');

  click($('btnAddItem'));
  await wait(90);
  $('f_title').value = 'Total Praise';
  click($('modalSave'));
  await wait(200);

  click($('btnLive'));
  await wait(120);
  check('live is active', active() === 'live');
  check('top bar hidden in live', $('topbar').hidden);

  await back();
  check('Back from live returns to the editor', active() === 'editor');
  check('top bar visible again', !$('topbar').hidden);

  click($('btnSheet'));
  await wait(120);
  check('sheet view active', active() === 'sheet');
  await back();
  check('Back from the sheet returns to the editor', active() === 'editor');

  await back();
  check('Back from the editor returns to the services list', active() === 'sets');
  check('service still listed after walking back', $('setList').textContent.includes('Sunday morning'));

  console.log('\n— on-screen Back matches hardware Back —');
  click($('setList').querySelector('[data-open]'));
  await wait(150);
  check('opened the service', active() === 'editor');
  click($('btnBack'));
  await wait(150);
  check('on-screen Back returns to the list', active() === 'sets');

  console.log('\n— tabs —');
  click(doc.querySelector('.tab[data-view="songs"]'));
  await wait(120);
  check('songs tab active', active() === 'songs');
  check('songs tab marked active', doc.querySelector('.tab[data-view="songs"]').classList.contains('is-active'));
  await back();
  check('Back leaves the songs tab', active() === 'sets');
  check('sets tab marked active again', doc.querySelector('.tab[data-view="sets"]').classList.contains('is-active'));

  console.log('\n— confirm dialogs are covered too —');
  click(doc.querySelector('.tab[data-view="sets"]'));
  await wait(120);
  click($('setList').querySelector('[data-delset]'));
  await wait(90);
  check('confirm opened', !$('modal').hidden);
  await back();
  check('Back cancelled the confirm', $('modal').hidden);
  check('nothing was deleted', $('setList').querySelectorAll('.card').length === 1);

  console.log('\n— chrome consistency —');
  click($('setList').querySelector('[data-open]'));
  await wait(150);
  check('logo hidden on deep views', $('topMark').hidden);
  check('back button shown on deep views', !$('btnBack').hidden);
  check('tabs hidden on deep views', $('topNav').hidden);
  click($('btnBack'));
  await wait(150);
  check('logo back on the list', !$('topMark').hidden);
  check('back button hidden on the list', $('btnBack').hidden);

  console.log('\n' + (errors.length ? 'runtime errors:\n' + errors.join('\n') : 'no runtime errors'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error('THREW:', e); process.exit(1); });
