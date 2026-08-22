/* Nashville numbers <-> chord names.
 *
 * The whole point: you type the progression ONCE, in numbers. Change the key
 * for a given Sunday and the letter names follow automatically. No rewriting a
 * chart because the lead wants it down a tone.
 *
 * RULES THIS IMPLEMENTS (they are the common Nashville conventions, written
 * down here so the behaviour isn't a mystery six months from now):
 *
 *  - A bare number takes the DIATONIC quality of that degree in the key.
 *    In a major key: 1 4 5 are major, 2 3 6 are minor, 7 is diminished.
 *    In a minor key: 1 4 5 are minor, 3 6 7 are major, 2 is diminished.
 *  - Anything you write after the number is used verbatim: 5-7 is a dominant
 *    seventh, 2m7, 4maj7, 5sus, 6m9 all pass straight through.
 *  - b and # before the number shift it a semitone: b7, b3, #4.
 *  - A slash sets the bass, by number or letter: 1/3, 4/5, 1/Bb.
 *  - Anything that already looks like a chord name (Ab, F#m7, Bbsus) is left
 *    exactly as typed, so you can mix the two in one chart.
 *  - Bar lines, dashes, dots and line breaks are preserved untouched.
 *
 * Spelling follows the key: flat keys get flat names, sharp keys sharp names.
 * Gospel lives in Ab, Db and Eb, so getting this wrong would be noticeable.
 */
(function (global) {
  'use strict';

  var SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  var PITCH = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'Fb': 4,
    'F': 5, 'E#': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8,
    'A': 9, 'A#': 10, 'Bb': 10, 'B': 11, 'Cb': 11
  };

  // Keys that read naturally with sharps. Everything else, including C and Am,
  // gets flats -- because the borrowed chords gospel actually uses (b7, b3, b6)
  // want to be Bb and Eb, not A# and D#.
  var SHARP_KEYS = ['G', 'D', 'A', 'E', 'B', 'F#', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m'];

  var MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
  var MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

  var MAJOR_QUALITY = ['', 'm', 'm', '', '', 'm', 'dim'];
  var MINOR_QUALITY = ['m', 'dim', '', 'm', 'm', '', ''];

  // A number token: optional accidental, digit 1-7, any suffix, optional bass.
  var NUMBER_TOKEN = /^([b#]?)([1-7])([^/]*)(?:\/([b#]?[1-7]|[A-G][b#]?))?$/;
  // Something already written as a chord name.
  var NAME_TOKEN = /^[A-G][b#]?/;

  function keyInfo(key) {
    key = (key || '').trim();
    if (!key) return null;
    var minor = /m$/.test(key) && !/maj/i.test(key);
    var root = minor ? key.slice(0, -1) : key;
    if (!(root in PITCH)) return null;
    return {
      root: PITCH[root],
      minor: minor,
      names: SHARP_KEYS.indexOf(key) > -1 ? SHARP : FLAT,
      steps: minor ? MINOR_STEPS : MAJOR_STEPS,
      quality: minor ? MINOR_QUALITY : MAJOR_QUALITY
    };
  }

  function degreeRoot(info, accidental, degree) {
    var semis = info.steps[degree - 1];
    if (accidental === 'b') semis -= 1;
    if (accidental === '#') semis += 1;
    return info.names[((info.root + semis) % 12 + 12) % 12];
  }

  /* Convert one whitespace-delimited token. Unrecognised tokens come back
     unchanged, which is what keeps bar lines and dashes intact. */
  function convertToken(token, info) {
    if (!info) return token;
    if (NAME_TOKEN.test(token)) return token;   // already a chord name

    var m = NUMBER_TOKEN.exec(token);
    if (!m) return token;

    var accidental = m[1];
    var degree = parseInt(m[2], 10);
    var suffix = m[3] || '';
    var bass = m[4];

    var root = degreeRoot(info, accidental, degree);

    // A bare number inherits the diatonic quality; an explicit suffix wins.
    // Accidental degrees are treated as major unless told otherwise, which is
    // what b7 and b3 nearly always mean in practice.
    if (!suffix) suffix = accidental ? '' : info.quality[degree - 1];

    var out = root + suffix;

    if (bass) {
      if (/^[b#]?[1-7]$/.test(bass)) {
        var bm = /^([b#]?)([1-7])$/.exec(bass);
        out += '/' + degreeRoot(info, bm[1], parseInt(bm[2], 10));
      } else {
        out += '/' + bass;
      }
    }
    return out;
  }

  /* Convert a whole chart, preserving line breaks and spacing. */
  function toNames(chart, key) {
    var info = keyInfo(key);
    if (!info || !chart) return chart || '';
    return chart.split('\n').map(function (line) {
      return line.split(/(\s+)/).map(function (part) {
        return /^\s+$/.test(part) ? part : convertToken(part, info);
      }).join('');
    }).join('\n');
  }

  /* Does this chart contain anything we could actually convert? Used to decide
     whether to bother showing the letter-name line at all. */
  function hasNumbers(chart) {
    if (!chart) return false;
    return chart.split(/\s+/).some(function (t) {
      return !NAME_TOKEN.test(t) && NUMBER_TOKEN.test(t);
    });
  }

  /* Capo: what shapes is the guitarist actually playing?
     Key Ab with capo 1 means G shapes. */
  function shapesKey(key, capo) {
    var info = keyInfo(key);
    capo = parseInt(capo, 10);
    if (!info || !capo) return '';
    var root = ((info.root - capo) % 12 + 12) % 12;
    return info.names[root] + (info.minor ? 'm' : '');
  }

  global.Chords = {
    toNames: toNames,
    hasNumbers: hasNumbers,
    shapesKey: shapesKey,
    _keyInfo: keyInfo
  };
})(window);
