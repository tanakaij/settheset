/* Parsing a written list.

   This is the part of the scan feature that can actually be tested without a
   camera, so it carries the weight. The cases below are the shapes real
   setlists come in, plus the misreadings OCR produces on handwriting — which
   is the whole reason the review screen exists. */
const fs = require('fs');
const path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'js', 'import.js'));

let pass = 0, fail = 0;
const check = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};

const LIB = [
  { id: 's1', title: 'Way Maker', key: 'Ab', bpm: '72', chords: '| 1 - 4 |' },
  { id: 's2', title: 'Goodness of God', key: 'C' },
  { id: 's3', title: 'Every Praise', key: 'Bb' },
  { id: 's4', title: 'Great Are You Lord', key: 'G' }
];

console.log('\n— keys —');
const k = SetImport.parseKey;
check('plain major', k('Ab') === 'Ab');
check('lower case', k('bb') === 'Bb');
check('minor suffix', k('Gm') === 'Gm');
check('spelled minor', k('a min') === 'Am');
check('explicit major is dropped', k('D major') === 'D');
check('sharp glyph', k('F\u266F') === 'F#');
check('flat glyph', k('E\u266D') === 'Eb');
check('enharmonic folds to the app spelling', k('C#') === 'Db');
check('parenthesised', k('(Bb)') === 'Bb');

console.log('\n— keys: OCR misreads —');
// The whole point: these are what a phone camera returns for handwriting.
check('6 read for flat', k('B6') === 'Bb');
check('8 read for B', k('8b') === 'Bb');
check('trailing punctuation', k('Eb,') === 'Eb');

console.log('\n— keys: things that are NOT keys —');
check('a digit is not an accidental', k('E5') === '');
check('a word after a note', k('G run') === '');
check('not a note letter', k('H') === '');
check('empty', k('') === '');
check('a whole sentence', k('Hold the last one') === '');

console.log('\n— line shapes —');
const line = s => SetImport.parseLine(s);
check('numbered with dashes', (() => {
  const r = line('1. Way Maker - Ab - Thandi');
  return r.title === 'Way Maker' && r.key === 'Ab' && r.singer === 'Thandi';
})());
check('bracket numbering and parenthesised key', (() => {
  const r = line('2) Goodness of God (C) lead: Kabelo');
  return r.title === 'Goodness of God' && r.key === 'C' && r.singer === 'Kabelo';
})());
check('slash separated', (() => {
  const r = line('3 EVERY PRAISE / Bb / Musa');
  return r.key === 'Bb' && r.singer === 'Musa';
})());
check('double space separated', (() => {
  const r = line('Total Praise  Eb');
  return r.title === 'Total Praise' && r.key === 'Eb';
})());
check('bullet', line('\u2022 Jireh Db').title === 'Jireh');
check('title only', (() => {
  const r = line('Amazing Grace');
  return r.title === 'Amazing Grace' && r.key === '';
})());
check('em dash separated', line('Way Maker \u2014 Ab').key === 'Ab');

console.log('\n— a title is not eaten by a phantom key —');
// "Amazing Grace" must not lose "Grace"; a bare trailing capital is a word.
check('single trailing letter is not taken as a key', line('Song of Praise E') === null
  || line('Song of Praise E').title === 'Song of Praise E');
check('multi-word title survives', line('Great Are You Lord').title === 'Great Are You Lord');

console.log('\n— page furniture is dropped —');
check('setlist header', line('SETLIST') === null);
check('weekday date', line('Sunday 30 Aug') === null);
check('numeric date', line('30/08/2026') === null);
check('month first', line('Aug 30') === null);
check('a stray key on its own line', line('Bb') === null);
check('blank', line('   ') === null);

console.log('\n— service elements are recognised —');
check('offering', line('Offering').element === true);
check('sermon', line('Sermon - Ps. Mokoena').element === true);
check('a song is not an element', line('Way Maker - Ab').element === false);

console.log('\n— fuzzy matching to the library —');
const sim = SetImport.similarity;
check('identical', sim('Way Maker', 'Way Maker') === 1);
check('spacing ignored', sim('Waymaker', 'Way Maker') > 0.85);
check('case ignored', sim('WAY MAKER', 'Way Maker') === 1);
check('a single misread character still matches', sim('Woy Maker', 'Way Maker') > 0.8);
check('different songs do not match',
  sim('Great Are You Lord', 'Goodness of God') < 0.6);

check('match finds the right song',
  SetImport.matchSong('Goodnes of God', LIB).song.id === 's2');
check('match rejects a stranger', SetImport.matchSong('Blessed Assurance', LIB) === null);

console.log('\n— the whole block —');
const rows = SetImport.parse([
  'SETLIST',
  'Sunday 30 Aug',
  '',
  '1. Way Maker - Ab - Thandi',
  '2) Goodnes of God (C) lead: Kabelo',
  '3 EVERY PRAISE / Bb / Musa',
  'Offering',
  '4. Total Praise  Eb',
  '5. Amazing Grace'
].join('\n'), LIB);

check('furniture removed, songs kept', rows.length === 6);
check('numbering is not part of a title', rows[0].title === 'Way Maker');
check('library spelling corrects the camera', rows[1].title === 'Goodness of God');
check('matched rows carry the library id', rows[0].songId === 's1');
check('unmatched rows do not', rows[4].songId === null);
check('the element survives as an element', rows[3].element === true);
check('singer captured', rows[0].singer === 'Thandi');
check('key captured', rows[2].key === 'Bb');
check('everything is included by default', rows.every(r => r.include));

console.log('\n— what the review screen must flag —');
check('a song with no key is flagged', rows[5].needsKey === true);
check('a song with a key is not', rows[0].needsKey === false);
check('an unmatched song is flagged for checking', rows[4].needsCheck === true);
check('a confident library match is not', rows[0].needsCheck === false);
// The offering has no key. Flagging it teaches people to ignore the flag.
check('an element is never flagged for a key', rows[3].needsKey === false);
check('an element is never flagged for checking', rows[3].needsCheck === false);
check('the original line is kept for comparison',
  rows[1].raw.includes('Goodnes'));

console.log('\n— degenerate input —');
check('empty text', SetImport.parse('', LIB).length === 0);
check('null text', SetImport.parse(null, LIB).length === 0);
check('no library', SetImport.parse('Way Maker - Ab', []).length === 1);
check('undefined library', SetImport.parse('Way Maker - Ab').length === 1);
check('one very long line does not hang',
  SetImport.parse('x'.repeat(3000), LIB).length <= 1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
