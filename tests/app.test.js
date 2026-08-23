/* SetTheSet — DOM smoke test.
   Boots the real index.html + scripts in jsdom against a fake IndexedDB and
   drives the actual DOM: create a service, add songs, pull from the library,
   override a key, reorder, reject a blank title, tick off in live mode, verify
   persistence, build the print sheet, duplicate, search.
   This is the gate the APK workflow runs before it will build anything. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
require('fake-indexeddb/auto');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => errors.push('jsdomError: ' + e.message));
vc.on('error', e => errors.push('error: ' + e));
vc.on('warn', m => console.log('  warn: ' + m));

const dom = new JSDOM(html, {
  url: 'https://example.github.io/settheset/',
  runScripts: 'outside-only',
  virtualConsole: vc,
  pretendToBeVisual: true
});

const { window } = dom;
const doc = window.document;

// wire the globals jsdom lacks
window.indexedDB = indexedDB;
window.IDBKeyRange = IDBKeyRange;
window.crypto = window.crypto || {};
if (!window.crypto.randomUUID) {
  let n = 0;
  window.crypto.randomUUID = () => 'id-' + (++n);
}
window.scrollTo = () => {};

// jsdom has no Web Audio. Stub just enough for the metronome to run so the
// live-mode wiring is exercised rather than skipped.
class FakeParam { constructor(){ this.value = 0; } setValueAtTime(){} exponentialRampToValueAtTime(){} }
window.AudioContext = class {
  constructor(){ this.currentTime = 0; this.state = 'running'; this.destination = {}; }
  resume(){}
  createOscillator(){ return { frequency: new FakeParam(), type: '', connect(){}, start(){}, stop(){} }; }
  createGain(){ return { gain: new FakeParam(), connect(){} }; }
};
window.print = () => { window.__printed = true; };
window.Element.prototype.scrollIntoView = () => {};

// Read the script list out of index.html rather than hardcoding it. A
// hardcoded list silently goes stale the moment a new file is added — which
// is exactly how this test first missed js/chords.js.
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
if (!scripts.length) { console.error('No scripts found in index.html'); process.exit(1); }
for (const f of scripts) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const $ = id => doc.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const set = (id, v) => {
  const n = $(id);
  n.value = v;
  n.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}

(async () => {
  await wait(120);

  console.log('\n— boot —');
  check('sets view is active', $('view-sets').classList.contains('is-active'));
  check('empty state visible', !$('setsEmpty').hidden);

  console.log('\n— create a service —');
  click($('btnNewSet'));
  await wait();
  check('modal opened', !$('modal').hidden);
  check('date prefilled to a Sunday', /^\d{4}-\d{2}-\d{2}$/.test($('f_date').value));
  $('f_service').value = 'Sunday morning';
  $('f_notes').value = 'Communion week';
  click($('modalSave'));
  await wait(120);
  check('modal closed', $('modal').hidden);
  check('moved into editor', $('view-editor').classList.contains('is-active'));
  check('service title rendered', $('setMeta').textContent.includes('Sunday morning'));
  check('notes rendered', $('setMeta').textContent.includes('Communion week'));

  console.log('\n— add first song —');
  click($('btnAddItem'));
  await wait(80);
  $('f_title').value = 'Jesus Is Mine';
  $('f_artist').value = 'Sinach';
  set('f_key', 'Ab');
  $('f_bpm').value = '68';
  set('f_segment', 'Worship');
  $('f_tone').value = 'Rhodes verse, grand on chorus';
  $('f_arrangement').value = 'Intro 4 bars\nVamp on IV-V\nMod up a semitone last chorus';
  $('f_transition').value = 'Hold on I, segue';
  click(doc.querySelector('[data-addrole]'));
  await wait();
  doc.querySelector('.rolerow__role').value = 'Lead vocal';
  doc.querySelector('.rolerow__who').value = 'Thandi';
  click($('modalSave'));
  await wait(150);

  check('item appears in list', $('itemList').textContent.includes('Jesus Is Mine'));
  check('key chip shows Ab', $('itemList').querySelector('.key').textContent === 'Ab');
  check('segment shown', $('itemList').textContent.includes('Worship'));
  check('role chip rendered', $('itemList').textContent.includes('Thandi'));
  check('bpm shown', $('itemList').textContent.includes('68 bpm'));
  check('auto-saved to library', (await window.DB.all('songs')).length === 1);

  console.log('\n— add second song, then pull it from the library —');
  click($('btnAddItem'));
  await wait(80);
  $('f_title').value = 'Way Maker';
  $('f_artist').value = 'Sinach';
  set('f_key', 'E');
  set('f_segment', 'Praise');
  click($('modalSave'));
  await wait(150);
  check('two items now', $('itemList').querySelectorAll('.item').length === 2);

  click($('btnAddItem'));
  await wait(80);
  const libOpts = Array.from($('f_lib').options).map(o => o.textContent);
  check('library options offered', libOpts.some(t => t.includes('Way Maker')));
  const wayMaker = Array.from($('f_lib').options).find(o => o.textContent.includes('Way Maker'));
  set('f_lib', wayMaker.value);
  await wait();
  check('prefilled title from library', $('f_title').value === 'Way Maker');
  check('prefilled key from library', $('f_key').value === 'E');
  set('f_key', 'F');                     // this Sunday differs from the usual key
  click($('modalSave'));
  await wait(150);
  const keys = Array.from($('itemList').querySelectorAll('.key')).map(k => k.textContent);
  check('per-service key override kept', keys.join(',') === 'Ab,E,F');

  console.log('\n— reorder —');
  click($('itemList').querySelector('[data-down="0"]'));
  await wait(100);
  const titles = Array.from($('itemList').querySelectorAll('.item__title')).map(t => t.textContent);
  check('first song moved down', titles[0] === 'Way Maker' && titles[1] === 'Jesus Is Mine');

  console.log('\n— validation —');
  click($('btnAddItem'));
  await wait(80);
  $('f_title').value = '';
  click($('modalSave'));
  await wait(60);
  check('blank title rejected, modal stays open', !$('modal').hidden);
  check('toast explains why', $('toast').textContent.includes('title'));
  click($('modalCancel'));
  await wait(60);
  check('cancel closes without adding', $('itemList').querySelectorAll('.item').length === 3);

  console.log('\n— live mode —');
  click($('btnLive'));
  await wait(120);
  check('live view active', $('view-live').classList.contains('is-active'));
  check('topbar hidden in live', $('topbar').hidden);
  check('progress starts at 0', $('liveProgress').textContent === '0 / 3');
  check('first card marked up now', $('liveList').querySelector('.lcard').classList.contains('lcard--now'));
  check('big key readout present', !!$('liveList').querySelector('.lcard__key'));
  check('arrangement carried into live', $('liveList').textContent.includes('Vamp on IV-V'));

  click($('liveList').querySelector('[data-tick="0"]'));
  await wait(120);
  check('tick registered', $('liveProgress').textContent === '1 / 3');
  check('done styling applied', $('liveList').querySelector('.lcard').classList.contains('lcard--done'));
  check('next song becomes current',
    $('liveList').querySelectorAll('.lcard')[1].classList.contains('lcard--now'));

  click($('liveList').querySelector('[data-tick="0"]'));
  await wait(120);
  check('untick works', $('liveProgress').textContent === '0 / 3');

  click($('liveList').querySelector('[data-tick="0"]'));
  await wait(120);
  click($('btnExitLive'));
  await wait(80);
  check('exit returns to editor', $('view-editor').classList.contains('is-active'));

  console.log('\n— persistence —');
  const saved = await window.DB.all('setlists');
  check('one setlist stored', saved.length === 1);
  check('tick persisted to disk', saved[0].items[0].performed === true);
  check('roles persisted', JSON.stringify(saved[0].items).includes('Thandi'));

  console.log('\n— sheet / pdf —');
  click($('btnSheet'));
  await wait(80);
  check('sheet view active', $('view-sheet').classList.contains('is-active'));
  check('sheet has service name', $('sheet').textContent.includes('Sunday morning'));
  check('sheet lists all songs', $('sheet').querySelectorAll('.srow').length === 3);
  check('sheet shows keys', $('sheet').textContent.includes('Ab'));
  const roleDefs = [...$('sheet').querySelectorAll('.srow__roles div')]
    .map(d => d.querySelector('dt').textContent + '=' + d.querySelector('dd').textContent);
  check('sheet lists roles as label/value pairs', roleDefs.includes('Lead vocal=Thandi'));
  check('sheet shows arrangement', $('sheet').textContent.includes('Mod up a semitone'));
  click($('btnPrint'));
  check('print invoked', window.__printed === true);

  console.log('\n— generated documents —');
  /* The bug this guards: "Save as PDF" called window.print(), which does
     nothing at all inside the packaged APK's WebView — a blank flash and no
     file. These check that real bytes come out, without needing a browser. */
  const sheetModel = window.SetTheSet.sheetModel;
  const model = sheetModel();

  check('model carries every item', model.rows.length === 3);
  check('model carries the keys', model.rows.some(r => r.key === 'Ab'));
  check('model carries the running clock', model.rows[0].clock === '10:00');

  const pdf = window.Exporter.pdfBytes(model);
  check('PDF has content', pdf && pdf.length > 2000);
  const pdfHead = String.fromCharCode.apply(null, pdf.subarray(0, 8));
  check('PDF starts with a valid header', pdfHead.indexOf('%PDF-1.4') === 0);
  const pdfTail = String.fromCharCode.apply(null, pdf.subarray(pdf.length - 8));
  check('PDF is terminated', pdfTail.indexOf('%%EOF') > -1);

  const docx = window.Exporter.docxBytes(model);
  check('DOCX has content', docx && docx.length > 2000);
  check('DOCX is a ZIP', docx[0] === 0x50 && docx[1] === 0x4B);
  const docxText = String.fromCharCode.apply(null, docx.subarray(0, 400));
  check('DOCX declares its content types', docxText.includes('[Content_Types].xml'));

  const filename = window.Exporter.filenameFor(model, 'pdf');
  check('filename carries the service', filename.includes('Sunday morning'));
  check('filename has no path separators', !/[\\/:*?"<>|]/.test(filename));

  console.log('\n— the setlist —');
  const setlist = window.SetTheSet.setlistModel();
  check('setlist has songs only', setlist.songs.length === 3);
  check('setlist numbers from 1', setlist.songs[0].no === '1');
  check('setlist numbers run consecutively',
    setlist.songs.map(s => s.no).join(',') === '1,2,3');
  check('setlist carries the key', setlist.songs.some(s => s.key === 'Ab'));
  check('setlist carries the singer', setlist.songs.some(s => s.singer === 'Thandi'));
  check('setlist is labelled as one', setlist.viewLabel === 'Setlist');
  check('setlist filename says setlist',
    window.Exporter.filenameFor(setlist, 'pdf').includes('Setlist'));

  const setlistPdf = window.Exporter.setlistBytes(setlist);
  check('setlist PDF has content', setlistPdf && setlistPdf.length > 1000);
  check('setlist PDF is a valid PDF',
    String.fromCharCode.apply(null, setlistPdf.subarray(0, 8)).indexOf('%PDF-1.4') === 0);
  check('setlist also exports to Word', window.Exporter.docxBytes(setlist).length > 1000);

  // It has to be viewable before it is saved — that is the whole point of a
  // preview, and the pill is the only way in.
  click(doc.querySelector('#sheetViews [data-sv="setlist"]'));
  await wait(60);
  const slRows = $('sheet').querySelectorAll('.slrow');
  check('setlist renders on screen', slRows.length === 3);
  check('on-screen setlist is numbered',
    [...slRows].map(r => r.querySelector('.slrow__no').textContent).join(',') === '1,2,3');
  check('on-screen setlist shows the key', $('sheet').textContent.includes('Ab'));
  check('on-screen setlist shows the singer', $('sheet').textContent.includes('Thandi'));
  check('on-screen setlist drops the chart', !$('sheet').textContent.includes('| 1 - 4 |'));
  check('on-screen setlist is labelled', $('sheet').textContent.includes('Setlist'));

  click(doc.querySelector('#sheetViews [data-sv="full"]'));
  await wait(60);
  check('switching back restores the full sheet', $('sheet').querySelectorAll('.srow').length === 3);


  console.log('\n— running time —');
  click($('setMeta'));
  await wait(80);
  check('start time field present', !!$('f_startTime'));
  $('f_startTime').value = '10:00';
  click($('modalSave'));
  await wait(120);

  // give the three existing songs durations
  for (let i = 0; i < 3; i++) {
    click($('itemList').querySelector(`[data-edit="${i}"]`));
    await wait(80);
    $('f_minutes').value = '6';
    click($('modalSave'));
    await wait(120);
  }
  const clocks = Array.from($('itemList').querySelectorAll('.item__clock')).map(c => c.textContent);
  check('clock starts at start time', clocks[0] === '10:00');
  check('clock advances by duration', clocks[1] === '10:06' && clocks[2] === '10:12');
  check('total shown on the header', $('setMeta').textContent.includes('18 min'));
  check('end time shown', $('setMeta').textContent.includes('10:18'));

  console.log('\n— non-song elements —');
  click($('btnAddElement'));
  await wait(80);
  check('element modal has no key field', !$('f_key'));
  set('f_kind', 'Scripture reading');
  $('f_title').value = 'Scripture — Psalm 100';
  $('f_minutes').value = '4';
  $('f_notes').value = 'Pads underneath';
  click($('modalSave'));
  await wait(150);
  check('element added', $('itemList').textContent.includes('Psalm 100'));
  check('element styled differently', !!$('itemList').querySelector('.item--element'));
  check('element has no key chip',
    $('itemList').querySelectorAll('.item').length === 4 &&
    $('itemList').querySelectorAll('.key').length === 3);
  check('total now includes the element', $('setMeta').textContent.includes('22 min'));

  console.log('\n— chords —');
  click($('itemList').querySelector('[data-edit="0"]'));
  await wait(80);
  check('chart field present', !!$('f_chords'));
  $('f_chords').value = '| 1 - 6m | 4 - 5 |';
  set('f_key', 'Ab');
  set('f_capo', '1');
  set('f_meter', '12/8');
  click($('modalSave'));
  await wait(150);
  check('numbers shown as typed', $('itemList').textContent.includes('| 1 - 6m | 4 - 5 |'));
  check('names derived for Ab', $('itemList').textContent.includes('| Ab - Fm | Db - Eb |'));
  check('capo shows the shapes', $('itemList').textContent.includes('capo 1 → play G'));
  check('meter shown', $('itemList').textContent.includes('12/8'));

  // the whole point: change the key, the chart follows
  click($('itemList').querySelector('[data-edit="0"]'));
  await wait(80);
  set('f_key', 'G');
  click($('modalSave'));
  await wait(150);
  check('chart transposed with the key', $('itemList').textContent.includes('| G - Em | C - D |'));
  check('numbers unchanged', $('itemList').textContent.includes('| 1 - 6m | 4 - 5 |'));

  console.log('\n— per-person sheets —');
  click($('btnSheet'));
  await wait(100);
  check('full view has chords', $('sheet').textContent.includes('Em'));
  check('full view labelled', $('sheet').textContent.includes('Full'));
  check('element appears on the sheet', $('sheet').textContent.includes('Psalm 100'));
  check('clock column present', $('sheet').textContent.includes('10:00'));

  const pickView = v => {
    click(doc.querySelector(`#sheetViews [data-sv="${v}"]`));
  };

  pickView('media');
  await wait(60);
  check('media view drops the chart', !$('sheet').textContent.includes('| G - Em |'));
  check('media view keeps the running order', $('sheet').textContent.includes('Psalm 100'));
  check('media view labelled', $('sheet').textContent.includes('Media & sound'));

  pickView('vocals');
  await wait(60);
  check('vocals view drops the chart', !$('sheet').textContent.includes('| G - Em |'));
  check('vocals view keeps keys', $('sheet').querySelectorAll('.srow__key').length > 0);

  pickView('band');
  await wait(60);
  check('band view has the chart', $('sheet').textContent.includes('Em'));
  check('band view drops patch notes', !$('sheet').textContent.includes('Rhodes verse'));

  pickView('keys');
  await wait(60);
  check('keys view has patch notes', $('sheet').textContent.includes('Rhodes verse'));

  pickView('full');
  await wait(60);
  const strip = $('sheet').querySelector('.sheet__strip').textContent;
  check('summary strip counts songs', /3\s*songs/.test(strip));
  check('summary strip counts items', /4\s*items/.test(strip));
  check('summary strip has total time', /22\s*min/.test(strip));
  check('summary strip shows the key journey',
    !!$('sheet').querySelector('.sheet__journey'));
  check('masthead present', !!$('sheet').querySelector('.sheet__masthead'));
  check('repeating runner present', !!$('sheet').querySelector('.sheet__runner'));


  console.log('\n— metronome in live mode —');
  click($('btnLive'));
  await wait(150);
  const clickBtn = $('liveList').querySelector('[data-click]');
  check('songs with a BPM get a click button', !!clickBtn);
  check('button shows the tempo', clickBtn.textContent.includes('68'));
  check('beat dots rendered', clickBtn.querySelectorAll('.dot').length === 4);
  check('first beat is the accent', !!clickBtn.querySelector('.dot--accent'));

  click(clickBtn);
  await wait(120);
  check('metronome started', window.Metronome.isRunning());
  const onBtn = $('liveList').querySelector('[data-click]');
  check('button switches to stop', onBtn.textContent.includes('Stop click'));
  check('button marked active', onBtn.classList.contains('is-on'));

  click($('liveList').querySelector('[data-click]'));
  await wait(120);
  check('metronome stopped by tapping again', !window.Metronome.isRunning());

  // starting it and then leaving must not leave a click running in your ear
  click($('liveList').querySelector('[data-click]'));
  await wait(120);
  check('metronome running again', window.Metronome.isRunning());
  click($('btnExitLive'));
  await wait(150);
  check('leaving live silences the click', !window.Metronome.isRunning());
  check('back in the editor', $('view-editor').classList.contains('is-active'));

  console.log('\n— element cards have no click button —');
  click($('btnLive'));
  await wait(150);
  const cards = $('liveList').querySelectorAll('.lcard');
  const elCard = $('liveList').querySelector('.lcard--element');
  check('element card present', !!elCard);
  check('element card has no metronome', !elCard.querySelector('[data-click]'));
  click($('btnExitLive'));
  await wait(150);

  console.log('\n— duplicate a service —');
  click($('btnSheetBack'));
  await wait(60);
  click($('btnBack'));
  await wait(120);
  check('back to sets', $('view-sets').classList.contains('is-active'));
  click($('setList').querySelector('[data-dup]'));
  await wait(150);
  check('duplicate created', $('setList').querySelectorAll('.card').length === 2);
  const all = await window.DB.all('setlists');
  const dup = all.find(s => s.id !== saved[0].id);
  check('duplicate keeps songs and elements', dup.items.length === 4);
  check('duplicate clears ticks', dup.items.every(i => !i.performed));

  console.log('\n— song library —');
  click(doc.querySelector('.tab[data-view="songs"]'));
  await wait(120);
  check('songs view active', $('view-songs').classList.contains('is-active'));
  check('library shows both songs', $('songList').querySelectorAll('.card').length === 2);
  $('songSearch').value = 'way';
  $('songSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(40);
  check('search filters', $('songList').querySelectorAll('.card').length === 1);

  console.log('\n— escaping —');
  check('no unescaped markup leaked', !doc.body.innerHTML.includes('<script>alert'));

  console.log('\n' + (errors.length ? 'runtime errors:\n' + errors.join('\n') : 'no runtime errors'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  module.exports = { pass, fail, errors };
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error('THREW:', e); process.exit(1); });
