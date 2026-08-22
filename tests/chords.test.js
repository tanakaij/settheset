/* Nashville conversion. This is the one piece of real logic in the app --
   everything else is forms and rendering -- so it gets its own tests.
   Gospel lives in flat keys, so the spelling cases matter. */
global.window = {};
require('../js/chords.js');
const C = global.window.Chords;

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (got === want) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log(`  FAIL ${label}\n         got  ${got}\n         want ${want}`); }
};

console.log('\n— diatonic quality follows the key —');
eq('1 4 5 in Ab', C.toNames('1 4 5', 'Ab'), 'Ab Db Eb');
eq('1 4 5 in C',  C.toNames('1 4 5', 'C'),  'C F G');
eq('2 3 6 are minor in a major key', C.toNames('2 3 6', 'C'), 'Dm Em Am');
eq('7 is diminished', C.toNames('7', 'C'), 'Bdim');
eq('1 4 5 are minor in a minor key', C.toNames('1 4 5', 'Fm'), 'Fm Bbm Cm');
eq('3 6 7 are major in a minor key', C.toNames('3 6 7', 'Am'), 'C F G');

console.log('\n— flat keys spell with flats —');
eq('b7 in Ab is Gb not F#', C.toNames('b7', 'Ab'), 'Gb');
eq('4 in Db is Gb', C.toNames('4', 'Db'), 'Gb');
eq('sharp key keeps sharps', C.toNames('2 5', 'E'), 'F#m B');

console.log('\n— explicit quality wins —');
eq('2m7 5 1maj7', C.toNames('2m7 5 1maj7', 'Eb'), 'Fm7 Bb Ebmaj7');
eq('bare 5 vs 5sus', C.toNames('5 5sus', 'G'), 'D Dsus');
eq('slash by number', C.toNames('1/3', 'G'), 'G/B');
eq('slash by letter passes through', C.toNames('1/Bb', 'Ab'), 'Ab/Bb');

console.log('\n— formatting is preserved —');
eq('bar lines and dashes survive', C.toNames('| 1 - 4 | 5 - 6m |', 'Ab'), '| Ab - Db | Eb - Fm |');
eq('line breaks survive', C.toNames('1 4\n5 6m', 'Ab'), 'Ab Db\nEb Fm');
eq('chord names pass through untouched', C.toNames('1 Bb F#m7', 'Ab'), 'Ab Bb F#m7');
eq('no key means no conversion', C.toNames('1 4 5', ''), '1 4 5');
eq('unknown key is left alone', C.toNames('1 4 5', 'H'), '1 4 5');

console.log('\n— transposing rewrites the chart —');
const chart = '| 1 - 6m | 4 - 5 |';
eq('same chart in Ab', C.toNames(chart, 'Ab'), '| Ab - Fm | Db - Eb |');
eq('same chart in G',  C.toNames(chart, 'G'),  '| G - Em | C - D |');

console.log('\n— capo —');
eq('Ab capo 1 plays G shapes', C.shapesKey('Ab', 1), 'G');
eq('Bb capo 3 plays G shapes', C.shapesKey('Bb', 3), 'G');
eq('minor key keeps its m',   C.shapesKey('Fm', 1), 'Em');
eq('no capo, no answer',      C.shapesKey('Ab', 0), '');
eq('no key, no answer',       C.shapesKey('', 2), '');

console.log('\n— hasNumbers —');
eq('numbers detected', String(C.hasNumbers('1 4 5')), 'true');
eq('letters are not numbers', String(C.hasNumbers('Ab Db Eb')), 'false');
eq('empty is false', String(C.hasNumbers('')), 'false');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
