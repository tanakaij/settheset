/* The derived-numbers layer and the screens built on it.
 *
 * Two halves: pure checks on js/insights.js with no DOM at all, then a real
 * jsdom boot that drives the home screen, the library filters, the editor's
 * health panel and the live clock. The second half is the one that matters —
 * every one of those renderers builds HTML from user data, and a thrown
 * exception in any of them leaves a blank screen with no error anyone sees.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
require('fake-indexeddb/auto');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};

/* ============================================================
   1. insights.js on its own
   ============================================================ */
console.log('\n— usage is counted from services, not guessed —');

const sandbox = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'js/insights.js'), 'utf8'))(sandbox);
const I = sandbox.Insights;

check('module exposes its API', !!I && typeof I.usageIndex === 'function');

const TODAY = '2026-06-14';
const sets = [
  { id: 'a', date: '2026-06-07', items: [
    { type: 'song', songId: 's1', title: 'Way Maker', key: 'G', minutes: '6' },
    { type: 'element', title: 'Offering', minutes: '5' }
  ] },
  { id: 'b', date: '2026-05-03', items: [
    { type: 'song', songId: 's1', title: 'Way Maker', key: 'Ab', minutes: '6' },
    { type: 'song', title: 'Great Are You Lord', key: 'A', minutes: '5' }
  ] },
  { id: 'c', date: '2026-01-04', items: [
    { type: 'song', title: 'Great Are You Lord', key: 'A', minutes: '5' }
  ] },
  // In the future: must not be counted as played.
  { id: 'd', date: '2026-07-05', items: [
    { type: 'song', songId: 's9', title: 'Not Yet Sung', key: 'C', minutes: '4' }
  ] }
];

const idx = I.usageIndex(sets, TODAY);
const u1 = I.usageFor({ id: 's1', title: 'Way Maker' }, idx);
check('counts every past outing', u1.count === 2);
check('remembers the most recent date', u1.last === '2026-06-07');
check('collects the keys it has been done in', u1.keys.includes('G') && u1.keys.includes('Ab'));
check('recent song is flagged in rotation', u1.status === 'recent');

// No songId anywhere — this is the case a naive id-only match gets wrong.
const u2 = I.usageFor({ id: 'x', title: 'great are you  LORD' }, idx);
check('matches on a normalised title when there is no id', u2.count === 2);

const u3 = I.usageFor({ id: 's9', title: 'Not Yet Sung' }, idx);
check('a future service is not a play', u3.count === 0);
check('and reads as never played', u3.status === 'new');

const u4 = I.usageFor({ id: 'zz', title: 'Nothing Like This' }, idx);
check('an unknown song is not an error', u4.count === 0 && u4.daysSince === null);
check('label handles the never-played case', I.usageLabel(u4) === 'Not played yet');
check('label reads in weeks, not days, once it is old', /weeks ago/.test(I.usageLabel(u2)));

// A song last done in January is resting by mid-June.
const resting = I.usageFor({ id: 'r', title: 'Old One' },
  I.usageIndex([{ id: 'z', date: '2025-11-02', items: [{ type: 'song', title: 'Old One', key: 'C' }] }], TODAY));
check('a song untouched for a quarter is resting', resting.status === 'resting');

console.log('\n— service health states the evidence —');

const over = I.serviceHealth({
  targetMinutes: '60',
  items: [
    { type: 'song', title: 'A', key: 'G', minutes: '10', bpm: '70' },
    { type: 'song', title: 'B', key: 'G', minutes: '10', bpm: '70' },
    { type: 'song', title: 'C', key: 'G', minutes: '10', bpm: '70' },
    { type: 'element', title: 'Sermon', minutes: '45' }
  ]
});
check('totals every item, songs and elements alike', over.total === 75);
check('an overrun is reported', over.warnings.some(w => /Over the slot by 15 min/.test(w.title)));
check('the overrun carries its arithmetic', over.warnings.some(w => /75 min .* 60 min/.test(w.detail)));
check('three in the same key is noticed', over.warnings.some(w => /Three in a row in G/.test(w.title)));
check('and it names the three songs', over.warnings.some(w => /"A", "B" and "C"/.test(w.detail)));
check('overall state is a warning', over.worst === 'warn');

const missing = I.serviceHealth({
  items: [
    { type: 'song', title: 'No Key Here', minutes: '5' },
    { type: 'song', title: 'Timed', key: 'C', minutes: '5' }
  ]
});
check('a song with no key is flagged', missing.warnings.some(w => /no key/.test(w.title)));
check('the flagged song is named', missing.warnings.some(w => /No Key Here/.test(w.detail)));

const untimed = I.serviceHealth({
  items: [
    { type: 'song', title: 'A', key: 'C' },
    { type: 'song', title: 'B', key: 'D' },
    { type: 'song', title: 'C', key: 'E' }
  ]
});
check('items with no length are flagged', untimed.warnings.some(w => /no length/.test(w.title)));

const clean = I.serviceHealth({
  targetMinutes: '40',
  items: [
    { type: 'song', title: 'A', key: 'C', minutes: '6', bpm: '72' },
    { type: 'element', title: 'Welcome', minutes: '4' },
    { type: 'song', title: 'B', key: 'G', minutes: '6', bpm: '80' },
    { type: 'element', title: 'Sermon', minutes: '22' }
  ]
});
check('a sound running order raises nothing', clean.worst === 'ok');
check('an empty service is not warned about', I.serviceHealth({ items: [] }).warnings.length === 0);
check('a missing set does not throw', I.serviceHealth(null).total === 0);

console.log('\n— the running clock —');

const liveSet = {
  startTime: '10:00',
  items: [
    { type: 'song', title: 'A', minutes: '10', performed: true },
    { type: 'song', title: 'B', minutes: '10', performed: false },
    { type: 'song', title: 'C', minutes: '10', performed: false }
  ]
};
const at = (h, m) => { const d = new Date(2026, 5, 14, h, m, 0); return d; };

check('no start time means no drift to report',
  I.drift({ items: liveSet.items }, liveSet.items, at(10, 30)) === null);

const onTime = I.drift(liveSet, liveSet.items, at(10, 10));
check('on the plan reads as on time', onTime.state === 'ontime');

const late = I.drift(liveSet, liveSet.items, at(10, 22));
check('behind the plan is reported late', late.state === 'late' && late.minutes === 12);
check('and says so in minutes', /12 min behind/.test(late.label));

const early = I.drift(liveSet, liveSet.items, at(10, 4));
check('ahead of the plan is reported early', early.state === 'early' && early.minutes === 6);

const before = I.drift(liveSet, liveSet.items, at(9, 30));
check('before the start it counts down instead', before.state === 'before');
check('a two-minute slip is still on time',
  I.drift(liveSet, liveSet.items, at(10, 12)).state === 'ontime');

// Start 10:00 + 30 min of material + 12 min already lost = 10:42.
const finish = I.projectedFinish(liveSet, liveSet.items, at(10, 22));
check('the finish is projected from the drift', finish === '10:42');

console.log('\n— the plain-text setlist —');

const text = I.shareText({
  service: 'Sunday morning',
  startTime: '10:00',
  items: [
    { type: 'song', title: 'Way Maker', key: 'G', bpm: '72', capo: '2',
      roles: [{ role: 'Lead vocal', person: 'Thandi' }] },
    { type: 'element', title: 'Offering', minutes: '5' },
    { type: 'song', title: 'Great Are You Lord', key: 'A', minutes: '5' }
  ],
  notes: 'Rehearsal 8am'
}, { dateLabel: 'Sun 14 Jun 2026' });

check('songs are numbered from one', /^1\. Way Maker/m.test(text));
check('elements are not numbered with them', /^2\. Great Are You Lord/m.test(text));
check('the key travels with the song', /\[G · capo 2 · 72bpm\]/.test(text));
check('the lead is named', /led by Thandi/.test(text));
check('elements still appear', /— Offering \(5 min\)/.test(text));
check('the date is carried', text.includes('Sun 14 Jun 2026 · 10:00'));
check('notes reach the team', text.includes('Rehearsal 8am'));

/* ============================================================
   2. the screens, in a real DOM
   ============================================================ */
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
if (!window.crypto.randomUUID) { let n = 0; window.crypto.randomUUID = () => 'u-' + (++n); }
window.scrollTo = () => {};
window.print = () => {};
window.Element.prototype.scrollIntoView = () => {};

for (const f of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const $ = id => doc.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const wait = (ms = 80) => new Promise(r => setTimeout(r, ms));

function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

(async () => {
  await wait(180);
  // Dismiss the first-run sheet if it appeared, so it can't swallow clicks.
  if (!$('modal').hidden) { click($('modalCancel')); await wait(80); }

  console.log('\n— the home screen answers "what is next" —');

  // Seed through the app's own DB layer rather than reaching into IndexedDB
  // directly — the store names and version live there, and duplicating them
  // here is how a test starts failing for a reason that has nothing to do
  // with what it is checking.
  const put = (store, rec) => window.DB.put(store, rec);

  await put('setlists', {
    id: 'future', date: isoOffset(3), service: 'Sunday morning', startTime: '10:00',
    targetMinutes: '60',
    items: [
      { id: 'i1', type: 'song', title: 'Way Maker', key: 'G', minutes: '30', bpm: '72' },
      { id: 'i2', type: 'song', title: 'Great Are You Lord', key: 'G', minutes: '30', bpm: '70' },
      { id: 'i3', type: 'song', title: 'Same Again', key: 'G', minutes: '20', bpm: '68' },
      // A fourth song in a different key, so the journey strip has somewhere
      // to travel to — keyRun collapses consecutive duplicates, and a
      // "journey" of one key is not a journey.
      { id: 'i4', type: 'song', title: 'Lift Him Up', key: 'Ab', minutes: '5', bpm: '64' }
    ]
  });
  await put('setlists', {
    id: 'pastone', date: isoOffset(-21), service: 'Last month', startTime: '10:00',
    items: [{ id: 'p1', type: 'song', title: 'Way Maker', key: 'Ab', minutes: '6' }]
  });
  await put('songs', { id: 'sng1', title: 'Way Maker', key: 'G', artist: 'Sinach' });
  await put('songs', { id: 'sng2', title: 'Never Done', key: 'C' });

  // Re-enter the sets view so it reloads from the store.
  click(doc.querySelector('[data-view="songs"]'));
  await wait(140);
  click(doc.querySelector('[data-view="sets"]'));
  await wait(180);

  const hero = $('heroHost');
  check('a hero card is rendered', !!hero.querySelector('.hero'));
  check('it names the service', hero.textContent.includes('Sunday morning'));
  check('it counts down to the day', /In 3 days/.test(hero.textContent));
  check('it shows the key journey', hero.querySelectorAll('.hero__key').length >= 1);
  check('it offers to run the service', !!hero.querySelector('[data-hero-live]'));

  const list = $('setList');
  check('services are grouped under headings', list.querySelectorAll('.sechead').length === 2);
  check('the next service is marked', !!list.querySelector('.card--next'));
  check('past services are set back', !!list.querySelector('.card--past'));
  check('cards carry their keys', list.querySelectorAll('.card__keys .kmini').length > 0);
  check('the skeleton is retired once loaded', $('setsSkeleton').hidden === true);
  check('songs planned is counted', $('statSetsSongs').textContent === '5');

  console.log('\n— the library reports rotation —');

  click(doc.querySelector('[data-view="songs"]'));
  await wait(200);

  const songs = $('songList');
  check('usage appears on the card', /1× ·/.test(songs.textContent));
  check('an unplayed song says so', songs.textContent.includes('Not played yet'));
  check('filter counts are filled in', $('fnAll').textContent === '2');
  check('the never-played filter counts one', $('fnNew').textContent === '1');

  click(doc.querySelector('[data-filter="new"]'));
  await wait(90);
  check('filtering narrows the list', songs.querySelectorAll('.card').length === 1);
  check('and keeps the right song', songs.textContent.includes('Never Done'));

  click(doc.querySelector('[data-filter="all"]'));
  await wait(90);
  check('clearing the filter restores it', songs.querySelectorAll('.card').length === 2);

  // A filter that matches nothing must not read as a lost library, and it
  // must not permanently overwrite the first-run copy underneath it.
  $('songSearch').value = 'zzzz no such song';
  $('songSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(90);
  check('an empty filter explains itself', /Nothing in this filter/.test($('songsEmpty').textContent));
  check('and says the library is intact', /still has 2 songs/.test($('songsEmpty').textContent));

  $('songSearch').value = '';
  $('songSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(90);
  check('clearing the search hides it again', $('songsEmpty').hidden === true);

  console.log('\n— the editor flags the running order —');

  click(doc.querySelector('[data-view="sets"]'));
  await wait(160);
  click(list.querySelector('[data-open="future"]'));
  await wait(180);

  const health = $('healthHost');
  check('a health panel is rendered', !!health.querySelector('.health'));
  check('it warns rather than reassures', !!health.querySelector('.health--warn'));
  check('the overrun is named', /Over the slot by 25 min/.test(health.textContent));
  check('the journey strip is present', !!health.querySelector('.journey'));
  check('detail is collapsed until asked for',
    health.querySelector('.health').classList.contains('is-open') === false);

  click($('healthToggle'));
  await wait(90);
  check('tapping it opens the detail',
    $('healthHost').querySelector('.health').classList.contains('is-open') === true);
  check('the same-key run is listed', /Three in a row in G/.test($('healthHost').textContent));

  console.log('\n— live mode shows the clock —');

  click($('btnLive'));
  await wait(200);
  check('the wall clock is filled in', /^\d\d:\d\d$/.test($('liveClock').textContent));
  check('a drift chip is shown when there is a start time', $('liveDrift').hidden === false);
  check('the current item has an elapsed readout',
    !!doc.querySelector('.lcard--now .lcard__elapsed'));
  check('the current card previews what is next',
    !!doc.querySelector('.lcard--now .lcard__next'));
  check('up next names the song',
    /Great Are You Lord/.test(doc.querySelector('.lcard--now .lcard__next').textContent));

  click($('btnExitLive'));
  await wait(160);

  console.log('\n— sharing —');
  check('a share control exists', !!$('btnShare'));

  console.log('\n— nothing threw —');
  check('no jsdom errors', errors.length === 0);
  if (errors.length) errors.forEach(e => console.log('    ' + e));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
