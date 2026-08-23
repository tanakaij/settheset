/* SetTheSet — turning somebody's written list into a service.
 *
 * This is the reusable middle of the import feature, and it is deliberately
 * separate from where the text came from. Pasted, typed, or read off a photo
 * by the OCR plugin — it all arrives here as a block of text and leaves as
 * structured rows that the review screen can show and the user can correct.
 *
 * The design assumption throughout: THIS WILL GET THINGS WRONG. A phone
 * camera pointed at a biro scrawl in a church vestry is not a clean input.
 * So nothing here is trusted straight into a service — every row carries a
 * confidence, the review screen makes all of it editable, and keys in
 * particular are flagged rather than assumed. A wrong key that nobody spots
 * is worse than a blank one, because the blank gets noticed at rehearsal and
 * the wrong one gets noticed in front of the congregation.
 *
 * No dependencies, no network, works offline like everything else here.
 */
(function (global) {
  'use strict';

  var MAJORS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  /* Enharmonics people actually write. The app stores flats, so C# on paper
     becomes Db in the app rather than being thrown away as unrecognised. */
  var ENHARMONIC = {
    'C#': 'Db', 'D#': 'Eb', 'Gb': 'F#', 'G#': 'Ab', 'A#': 'Bb',
    'Cb': 'B', 'Fb': 'E', 'E#': 'F', 'B#': 'C'
  };

  /* Characters OCR reliably confuses inside a key, and only inside a key —
     this map is never applied to a song title, where "6" is just a six.
     'b' for flat is the big one: it renders as 6, 8, or the proper ♭ glyph
     depending on the handwriting and the engine. */
  var KEY_FIX = { '\u266D': 'b', '\u266F': '#', '6': 'b', '8': 'b', '\u00DF': 'b' };

  var MINOR = /^(m|min|minor|-)$/i;

  /* Words that mean "this line is not a song": headers, page furniture, and
     the service elements that belong in a running order but not a setlist. */
  var NOISE = /^(set ?list|songs?|order of service|worship|praise ?(&|and) ?worship|sunday|service|team|band|key|keys|notes?|page \d+|\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?|am|pm)$/i;

  /* A date across the top of the page is the single most common non-song line
     on a written setlist, and it survives NOISE because it is never written
     the same way twice. Anything that opens with a weekday or a month and
     carries a number is furniture, not a song. */
  var DATEISH = /^(sun|mon|tues?|wed(nes)?|thur?s?|fri|sat(ur)?)(day)?\b|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b\s*\d|^\d{1,2}\s*(st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

  var ELEMENTS = /^(welcome|notices|announcements|offering|offertory|tithes|sermon|message|preaching|scripture|reading|prayer|altar call|communion|benediction|closing|dismissal|video|testimony)\b/i;

  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ============================================================
     KEYS
     ============================================================ */

  /* Returns a canonical key, or '' if this token is not one. Strict on
     purpose: "A" as a whole token is a key, but "A" inside "A Mighty Fortress"
     never reaches here because titles are matched as a whole. */
  function parseKey(token) {
    if (!token) return '';
    var t = clean(token).replace(/^[(\[{]|[)\]}.,;:]+$/g, '');
    if (!t || t.length > 8) return '';

    // Fix OCR lookalikes only in the accidental position (second character on).
    // '8' for 'B' is the one worth fixing in the note position too — it is the
    // classic misread, and no other note letter looks like a digit.
    var head = t.charAt(0).toUpperCase();
    var fixed = (head === '8' ? 'B' : head);
    for (var i = 1; i < t.length; i++) {
      var c = t.charAt(i);
      fixed += KEY_FIX[c] || c;
    }

    var m = fixed.match(/^([A-G])([b#]?)\s*(.*)$/);
    if (!m) return '';

    var root = m[1] + (m[2] || '');
    var rest = (m[3] || '').trim();
    if (ENHARMONIC[root]) root = ENHARMONIC[root];
    if (MAJORS.indexOf(root) < 0) return '';

    if (!rest) return root;
    if (MINOR.test(rest)) return root + 'm';
    if (/^(maj|major)$/i.test(rest)) return root;
    return '';   // "G run", "A section" — not a key
  }

  /* ============================================================
     SIMILARITY

     Levenshtein on a normalised string. OCR errors are mostly single-character
     substitutions, which is exactly what edit distance is good at — and it
     means the library lookup tolerates "Woy Mokev" for "Way Maker" without
     needing a dictionary of misreadings.
     ============================================================ */
  function normalise(s) {
    return clean(s).toLowerCase()
      .replace(/\(.*?\)/g, ' ')          // "(live)", "(He Won't)"
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\b(the|a|an|of|and|is|to|my|our|your)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function distance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;

    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      for (j = 0; j <= b.length; j++) prev[j] = cur[j];
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    var x = normalise(a), y = normalise(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    // One containing the other ("Waymaker" vs "Way Maker Live") is a strong
    // signal that edit distance alone would undersell on longer titles.
    if (x.indexOf(y) > -1 || y.indexOf(x) > -1) return 0.92;
    var longest = Math.max(x.length, y.length);
    return 1 - (distance(x, y) / longest);
  }

  /* Best library hit above the threshold, or null. 0.72 was chosen by trying
     real misreadings: it catches "Goodnes of God" and "Way Maker" from
     "waymaker", and rejects "Great Are You Lord" against "Goodness of God". */
  function matchSong(title, songs, threshold) {
    var best = null, bestScore = threshold == null ? 0.72 : threshold;
    (songs || []).forEach(function (song) {
      var score = similarity(title, song.title);
      if (score > bestScore) { bestScore = score; best = song; }
    });
    return best ? { song: best, score: bestScore } : null;
  }

  /* ============================================================
     LINE PARSING

     Handles the shapes people actually write, in one pass:
       1. Way Maker - Ab - Thandi
       1) Way Maker (Ab) Thandi
       Way Maker — Ab — lead: Thandi
       WAY MAKER / Bb / Thandi
       • Way Maker   Ab
       Way Maker
     ============================================================ */
  function parseLine(raw) {
    var line = clean(raw);
    if (!line) return null;

    // Strip bullets and numbering. "1." "1)" "01 -" "•" "*" "-"
    line = line.replace(/^[\s\-\u2013\u2014*\u2022\u00B7>]+/, '');
    line = line.replace(/^\(?\d{1,2}\)?[.):\-\s]\s*/, '');
    line = clean(line);
    if (!line) return null;

    if (NOISE.test(line)) return null;
    if (DATEISH.test(line)) return null;
    // A line that is nothing but a key ("Bb") is a stray, not a song.
    if (parseKey(line)) return null;

    var element = ELEMENTS.test(line);

    var key = '';
    var singer = '';

    // A parenthesised key is unambiguous, so take it wherever it sits.
    line = line.replace(/[([{]\s*([^)\]}]{1,10})\s*[)\]}]/g, function (whole, inner) {
      var k = parseKey(inner);
      if (k && !key) { key = k; return ' '; }
      return whole;
    });

    // An explicit lead marker beats positional guessing every time.
    var leadMatch = line.match(/\b(?:lead|led by|sung by|singer|vocals?|by)\s*[:\-\u2013]?\s*([A-Za-z][A-Za-z'\-. ]{1,30})$/i);
    if (leadMatch) {
      singer = clean(leadMatch[1]);
      line = clean(line.slice(0, leadMatch.index));
    }

    // Now split on the separators people use between fields.
    var parts = line.split(/\s*[|\/\u2013\u2014]\s*|\s+-\s+|\s{2,}/)
      .map(clean)
      .filter(function (p) { return p.length; });

    var title = parts.shift() || '';

    parts.forEach(function (part) {
      var k = parseKey(part);
      if (k && !key) { key = k; return; }
      if (!singer && /^[A-Za-z][A-Za-z'\-. ]*(,\s*[A-Za-z][A-Za-z'\-. ]*)*$/.test(part) && part.length <= 40) {
        singer = part;
      }
    });

    /* Last resort: a trailing bare key with only a single space before it,
       as in "Way Maker Ab". Only when the final token is unambiguously a key
       AND there is a title left over — otherwise "Amazing Grace" would lose
       its second word to a phantom G. */
    if (!key) {
      var tokens = title.split(' ');
      if (tokens.length > 1) {
        var last = tokens[tokens.length - 1];
        var asKey = parseKey(last);
        // Require an accidental or a minor marker. A lone capital letter at
        // the end of a title is far more often a word than a key.
        if (asKey && last.length > 1) {
          key = asKey;
          title = tokens.slice(0, -1).join(' ');
        }
      }
    }

    title = clean(title).replace(/[.,;:]+$/, '');
    if (!title) return null;

    return {
      title: title,
      key: key,
      singer: singer,
      element: element,
      raw: clean(raw)
    };
  }

  /* ============================================================
     THE WHOLE BLOCK
     ============================================================ */

  /* Turns raw text into review rows. `songs` is the library, used to fill in
     everything the paper didn't say — the paper has a title and maybe a key;
     the library has the BPM, the chart and the arrangement from last time. */
  function parse(text, songs) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var rows = [];

    lines.forEach(function (raw) {
      var parsed = parseLine(raw);
      if (!parsed) return;

      var hit = parsed.element ? null : matchSong(parsed.title, songs);
      var row = {
        title: parsed.title,
        key: parsed.key,
        singer: parsed.singer,
        element: parsed.element,
        raw: parsed.raw,
        songId: hit ? hit.song.id : null,
        matchedTitle: hit ? hit.song.title : '',
        score: hit ? hit.score : 0,
        include: true
      };

      if (hit) {
        // The library's spelling wins over the camera's. Everything else is
        // inherited so a scanned list arrives with charts already attached.
        row.title = hit.song.title;
        row.key = row.key || hit.song.key || '';
        row.inherited = true;
      }

      /* Confidence drives what the review screen highlights. It is about
         whether a HUMAN needs to look, not about how sure the parser feels:
         an unmatched title with no key is the row most likely to be wrong,
         and a key read off handwriting is the row most costly to get wrong.

         Elements are exempt from the key check — the offering does not have
         a key, and flagging it as missing one trains people to ignore the
         flag on the songs where it matters. */
      row.needsKey = !row.element && !row.key;
      row.needsCheck = !row.element && (!hit || (!!parsed.key && !row.inherited));

      rows.push(row);
    });

    return rows;
  }

  global.SetImport = {
    parse: parse,
    parseLine: parseLine,
    parseKey: parseKey,
    similarity: similarity,
    matchSong: matchSong,
    normalise: normalise
  };
})(window);
