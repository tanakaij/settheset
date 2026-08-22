/* First run, the sample service, and getting rid of it again.
   Sample data you cannot remove is worse than no sample data, so the removal
   path gets as much attention as the creation path. */
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
if (!window.crypto.randomUUID) { let n = 0; window.crypto.randomUUID = () => 's-' + (++n); }
window.scrollTo = () => {};
window.print = () => {};
window.Element.prototype.scrollIntoView = () => {};

for (const f of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const $ = id => doc.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const wait = (ms = 80) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};

(async () => {
  await wait(250);

  console.log('\n— welcome appears on an empty install —');
  check('welcome sheet shown', !$('modal').hidden);
  check('titled for the app', $('modalTitle').textContent.includes('SetTheSet'));
  check('offers a sample', $('modalSave').textContent.includes('sample'));
  check('offers to start empty', $('modalCancel').textContent.includes('empty'));

  console.log('\n— loading the sample —');
  click($('modalSave'));
  await wait(350);
  check('sheet closed', $('modal').hidden);

  const sets = await window.DB.all('setlists');
  const songs = await window.DB.all('songs');
  check('one service created', sets.length === 1);
  check('songs added to the library', songs.length === 3);
  check('service is listed', $('setList').textContent.includes('Sample service'));

  const set = sets[0];
  check('has songs and an element', set.items.length === 4);
  check('includes a non-song element', set.items.some(i => i.type === 'element'));
  check('has a start time', set.startTime === '10:00');
  check('items have durations', set.items.every(i => i.minutes));
  check('songs have charts', set.items.filter(i => i.type !== 'element').every(i => i.chords));
  check('songs have roles', set.items.filter(i => i.type !== 'element').every(i => i.roles.length));
  check('a capo is demonstrated', set.items.some(i => i.capo));
  check('compound meter is demonstrated', set.items.some(i => i.meter === '12/8'));
  check('nothing is pre-ticked', set.items.every(i => !i.performed));

  console.log('\n— everything created is tagged as sample —');
  check('setlist tagged', set.sample === true);
  check('library songs tagged', songs.every(s => s.sample === true));
  check('items tagged', set.items.every(i => i.sample === true));

  console.log('\n— the sample actually works when opened —');
  click($('setList').querySelector('[data-open]'));
  await wait(250);
  check('opens in the editor', $('view-editor').classList.contains('is-active'));
  check('running clock rendered', $('itemList').textContent.includes('10:00'));
  check('chart transposed to the song key',
    $('itemList').textContent.includes('Bb') && $('itemList').textContent.includes('Eb'));
  check('capo shapes computed', $('itemList').textContent.includes('play G'));

  click($('btnSheet'));
  await wait(200);
  check('sheet renders', $('sheet').querySelectorAll('.srow').length === 4);
  check('key journey shown', !!$('sheet').querySelector('.sheet__journey'));
  click($('btnSheetBack'));
  await wait(200);
  click($('btnBack'));
  await wait(250);

  console.log('\n— a real service is not touched by sample removal —');
  click($('btnNewSet'));
  await wait(120);
  $('f_service').value = 'My real service';
  click($('modalSave'));
  await wait(300);
  click($('btnBack'));
  await wait(250);
  check('two services now', (await window.DB.all('setlists')).length === 2);

  console.log('\n— help offers removal —');
  click($('btnHelp'));
  await wait(200);
  check('help sheet opens', !$('modal').hidden);
  check('explains the number system', $('modalBody').textContent.includes('key'));
  const clearBtn = $('btnClearSample');
  check('offers to remove the sample', !!clearBtn);

  click(clearBtn);
  await wait(350);
  const after = await window.DB.all('setlists');
  const afterSongs = await window.DB.all('songs');
  check('sample service gone', after.length === 1);
  check('real service kept', after[0].service === 'My real service');
  check('sample songs gone', afterSongs.length === 0);
  check('list re-rendered', !$('setList').textContent.includes('Sample service'));

  console.log('\n— welcome does not come back —');
  check('welcome flag set', (await window.DB.flag('welcomed')) === true);

  console.log('\n' + (errors.length ? 'runtime errors:\n' + errors.join('\n') : 'no runtime errors'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error('THREW:', e); process.exit(1); });
