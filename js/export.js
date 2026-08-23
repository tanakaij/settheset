/* SetTheSet — document export.
 *
 * Why this file exists at all: the Sheet screen used to hand the job to
 * window.print(). That works in a desktop browser and does NOTHING in the
 * packaged Android APK — Capacitor's WebView has no print handler wired up, so
 * the tap produced a blank flash and no file. Nothing was ever written to
 * Documents because nothing was ever generated.
 *
 * So we generate the documents ourselves, in the app, offline:
 *   - a real PDF, written byte by byte against the PDF 1.4 spec using the
 *     14 standard base fonts (no font embedding, no library, no network);
 *   - a real .docx, which is an OOXML package inside a ZIP — written here with
 *     a stored (uncompressed) ZIP writer, which Word accepts happily.
 *
 * Both are then SAVED, not printed: through Capacitor's Filesystem plugin into
 * Documents/SetTheSet/ on Android, and through a normal blob download in a
 * browser or PWA.
 *
 * Everything below is deliberately dependency-free and side-effect free at
 * load: this file only defines window.Exporter.
 */
(function (global) {
  'use strict';

  /* ============================================================
     1. TEXT ENCODING

     The base-14 fonts are used with /WinAnsiEncoding, which is one byte per
     character and covers Latin-1 plus the typographic punctuation we actually
     use. Anything outside it (arrows, musical glyphs) is folded down to an
     ASCII equivalent rather than silently dropped — a chart that prints "->"
     is fine; a chart with a hole in it is not.
     ============================================================ */
  var WINANSI = {
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94,
    0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85, 0x2022: 0x95,
    0x00B7: 0xB7, 0x2122: 0x99, 0x20AC: 0x80, 0x2039: 0x8B, 0x203A: 0x9B
  };

  var FOLD = {
    0x2192: '->', 0x2190: '<-', 0x2191: '^', 0x2193: 'v',
    0x266D: 'b', 0x266F: '#', 0x00A0: ' ', 0x2212: '-', 0x2044: '/'
  };

  function toWinAnsi(str) {
    var out = '';
    str = String(str == null ? '' : str);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c === 9) { out += ' '; continue; }
      if (c < 128) { out += str[i]; continue; }
      if (FOLD[c]) { out += FOLD[c]; continue; }
      if (WINANSI[c]) { out += String.fromCharCode(WINANSI[c]); continue; }
      if (c <= 255) { out += String.fromCharCode(c); continue; }
      out += '?';
    }
    return out;
  }

  /* ============================================================
     2. METRICS

     Widths for Helvetica / Helvetica-Bold / Helvetica-Oblique (per 1000 units)
     for the printable ASCII range. Without these there is no way to wrap a
     line, and unwrapped text runs straight off the right edge of the page.
     Courier is fixed-pitch at 600, which is exactly why the charts are set in
     it: a bar line stays a bar line.
     ============================================================ */
  var W_HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
    667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
    278,278,278,469,556,333,
    556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
    334,260,334,584];

  var W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,
    722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
    333,278,333,584,556,333,
    556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,
    389,280,389,584];

  function widthOf(text, font, size) {
    text = toWinAnsi(text);
    if (font === 'mono' || font === 'monob') return text.length * 0.6 * size;
    var table = (font === 'bold') ? W_BOLD : W_HELV;
    var total = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      var w = (c >= 32 && c <= 126) ? table[c - 32] : (c === 32 ? 278 : 556);
      total += (w == null ? 556 : w);
    }
    return total * size / 1000;
  }

  /* Greedy wrap. Tokens longer than the column (a URL, a long chart line) are
     chopped at the character level rather than allowed to overrun. */
  function wrap(text, font, size, maxWidth) {
    var lines = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (para) {
      var words = para.split(/\s+/).filter(function (w) { return w.length; });
      if (!words.length) { lines.push(''); return; }
      var line = '';
      words.forEach(function (word) {
        while (widthOf(word, font, size) > maxWidth) {
          var cut = word.length;
          while (cut > 1 && widthOf(word.slice(0, cut), font, size) > maxWidth) cut--;
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        var probe = line ? line + ' ' + word : word;
        if (widthOf(probe, font, size) <= maxWidth) { line = probe; }
        else { if (line) lines.push(line); line = word; }
      });
      if (line) lines.push(line);
    });
    return lines;
  }

  /* ============================================================
     3. PDF WRITER
     ============================================================ */
  var FONT_RES = { reg: '/F1', bold: '/F2', obl: '/F3', mono: '/F4', monob: '/F5' };

  var INK    = [0.078, 0.086, 0.102];
  var MUTED  = [0.40, 0.44, 0.49];
  var FAINT  = [0.62, 0.66, 0.70];
  var RULE   = [0.86, 0.88, 0.90];
  var ACCENT = [0.02, 0.58, 0.42];
  var WASH   = [0.965, 0.972, 0.976];

  function pdfString(s) {
    return toWinAnsi(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function n(v) { return (Math.round(v * 100) / 100).toString(); }

  function Doc(opts) {
    opts = opts || {};
    this.W = opts.width || 595.28;      // A4 portrait, points
    this.H = opts.height || 841.89;
    this.M = opts.margin || 48;
    this.footerText = opts.footer || '';
    this.pages = [];
    this.buf = null;
    this.y = 0;
    this.newPage();
  }

  Doc.prototype.newPage = function () {
    if (this.buf) this.pages.push(this.buf.join('\n'));
    this.buf = [];
    this.y = this.M;
    this.pageNo = this.pages.length + 1;
  };

  Doc.prototype.contentWidth = function () { return this.W - this.M * 2; };

  /* Bottom limit leaves room for the running footer. */
  Doc.prototype.limit = function () { return this.H - this.M - 22; };

  Doc.prototype.room = function (h) { return (this.y + h) <= this.limit(); };

  Doc.prototype.ensure = function (h) {
    if (!this.room(h)) { this.newPage(); return true; }
    return false;
  };

  Doc.prototype.op = function (s) { this.buf.push(s); };

  Doc.prototype.fill = function (c) {
    this.op(n(c[0]) + ' ' + n(c[1]) + ' ' + n(c[2]) + ' rg');
  };

  Doc.prototype.stroke = function (c) {
    this.op(n(c[0]) + ' ' + n(c[1]) + ' ' + n(c[2]) + ' RG');
  };

  /* y here is measured from the TOP of the page, because that is how the
     layout code below thinks. Converted to PDF's bottom-left origin on write. */
  Doc.prototype.textAt = function (text, x, yTop, o) {
    o = o || {};
    var size = o.size || 10;
    var font = o.font || 'reg';
    this.fill(o.color || INK);
    var baseline = this.H - yTop - size;
    var extra = o.tracking ? ' ' + n(o.tracking) + ' Tc' : '';
    this.op('BT ' + FONT_RES[font] + ' ' + n(size) + ' Tf' + extra +
            ' 1 0 0 1 ' + n(x) + ' ' + n(baseline) + ' Tm (' + pdfString(text) + ') Tj ET');
    if (o.tracking) this.op('BT 0 Tc ET');
  };

  Doc.prototype.textRight = function (text, right, yTop, o) {
    o = o || {};
    var w = widthOf(text, o.font || 'reg', o.size || 10);
    if (o.tracking) w += o.tracking * String(text).length;
    this.textAt(text, right - w, yTop, o);
  };

  Doc.prototype.rect = function (x, yTop, w, h, color) {
    this.fill(color);
    this.op(n(x) + ' ' + n(this.H - yTop - h) + ' ' + n(w) + ' ' + n(h) + ' re f');
  };

  Doc.prototype.hline = function (x1, x2, yTop, color, width) {
    this.stroke(color || RULE);
    this.op(n(width || 0.6) + ' w ' + n(x1) + ' ' + n(this.H - yTop) + ' m ' +
            n(x2) + ' ' + n(this.H - yTop) + ' l S');
  };

  /* Wrapped paragraph. Returns the height consumed so callers can lay out
     without guessing. Splits across a page break when it has to. */
  Doc.prototype.para = function (text, x, width, o) {
    o = o || {};
    var size = o.size || 10;
    var lead = o.lead || size * 1.34;
    var lines = wrap(text, o.font || 'reg', size, width);
    var used = 0;
    for (var i = 0; i < lines.length; i++) {
      if (!this.room(lead)) { this.newPage(); used = 0; }
      this.textAt(lines[i], x, this.y, o);
      this.y += lead;
      used += lead;
    }
    return used;
  };

  Doc.prototype.heightOf = function (text, width, o) {
    o = o || {};
    var size = o.size || 10;
    var lead = o.lead || size * 1.34;
    return wrap(text, o.font || 'reg', size, width).length * lead;
  };

  /* The mark: a nod to the logo (ring, stem, crossbar) drawn as vectors so the
     document carries no image dependency. Bézier circle, k = 0.5523. */
  Doc.prototype.mark = function (cx, cyTop, r) {
    var k = 0.5523 * r;
    var cy = this.H - cyTop;
    this.stroke(ACCENT);
    this.op('1.5 w');
    this.op(n(cx) + ' ' + n(cy - r) + ' m');
    this.op(n(cx + k) + ' ' + n(cy - r) + ' ' + n(cx + r) + ' ' + n(cy - k) + ' ' + n(cx + r) + ' ' + n(cy) + ' c');
    this.op(n(cx + r) + ' ' + n(cy + k) + ' ' + n(cx + k) + ' ' + n(cy + r) + ' ' + n(cx) + ' ' + n(cy + r) + ' c');
    this.op(n(cx - k) + ' ' + n(cy + r) + ' ' + n(cx - r) + ' ' + n(cy + k) + ' ' + n(cx - r) + ' ' + n(cy) + ' c');
    this.op(n(cx - r) + ' ' + n(cy - k) + ' ' + n(cx - k) + ' ' + n(cy - r) + ' ' + n(cx) + ' ' + n(cy - r) + ' c');
    this.op('S');
    this.stroke(INK);
    this.op('1.4 w ' + n(cx + r * 0.62) + ' ' + n(cy + r * 0.62) + ' m ' +
            n(cx + r * 0.62) + ' ' + n(cy + r * 2.5) + ' l S');
    this.op('1.2 w ' + n(cx + r * 0.1) + ' ' + n(cy + r * 1.85) + ' m ' +
            n(cx + r * 1.35) + ' ' + n(cy + r * 2.15) + ' l S');
  };

  /* Written last, once the total page count is known, so "page 2 of 4" is
     honest. A sheet handed to five people needs to survive being dropped. */
  Doc.prototype.stampFooters = function () {
    this.pages.push(this.buf.join('\n'));
    this.buf = null;
    var total = this.pages.length;
    var self = this;
    this.pages = this.pages.map(function (content, i) {
      var parts = [content];
      /* PDF's origin is bottom-left, so a small y is the FOOT of the page.
         This was H - margin, which is the top — the runner printed as a
         header, above the masthead, on every page. */
      var y = 30;
      parts.push(n(RULE[0]) + ' ' + n(RULE[1]) + ' ' + n(RULE[2]) + ' RG');
      parts.push('0.6 w ' + n(self.M) + ' ' + n(y + 13) + ' m ' + n(self.W - self.M) + ' ' + n(y + 13) + ' l S');
      parts.push(n(FAINT[0]) + ' ' + n(FAINT[1]) + ' ' + n(FAINT[2]) + ' rg');
      parts.push('BT /F1 7.5 Tf 1 0 0 1 ' + n(self.M) + ' ' + n(y) + ' Tm (' +
                 pdfString(self.footerText) + ') Tj ET');
      var label = 'Page ' + (i + 1) + ' of ' + total;
      var w = widthOf(label, 'reg', 7.5);
      parts.push('BT /F1 7.5 Tf 1 0 0 1 ' + n(self.W - self.M - w) + ' ' + n(y) + ' Tm (' +
                 pdfString(label) + ') Tj ET');
      return parts.join('\n');
    });
    return this.pages;
  };

  /* Assemble the file. Objects are written in order and the xref table is
     built from the running byte offset, which is the one part of the format
     that must be exact or the reader rejects the file outright. */
  Doc.prototype.build = function (meta) {
    meta = meta || {};
    var pages = this.stampFooters();
    var objects = [];
    var FONT_BASE = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Courier', 'Courier-Bold'];

    var firstPageObj = 3 + FONT_BASE.length + 1;   // catalog, pages, info, fonts, then pages
    var kids = [];
    for (var p = 0; p < pages.length; p++) kids.push((firstPageObj + p * 2) + ' 0 R');

    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids.join(' ') + '] >>');
    objects.push('<< /Title (' + pdfString(meta.title || 'SetTheSet') + ')' +
                 ' /Author (' + pdfString(meta.author || 'SetTheSet') + ')' +
                 ' /Subject (' + pdfString(meta.subject || 'Service running order') + ')' +
                 ' /Creator (SetTheSet) /Producer (SetTheSet) >>');

    FONT_BASE.forEach(function (base) {
      objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /' + base + ' /Encoding /WinAnsiEncoding >>');
    });

    var fontDict = FONT_BASE.map(function (_, i) {
      return '/F' + (i + 1) + ' ' + (4 + i) + ' 0 R';
    }).join(' ');

    var self = this;
    pages.forEach(function (content, i) {
      var pageObj = firstPageObj + i * 2;
      objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + n(self.W) + ' ' + n(self.H) + ']' +
                   ' /Resources << /Font << ' + fontDict + ' >> >>' +
                   ' /Contents ' + (pageObj + 1) + ' 0 R >>');
      objects.push({ stream: content });
    });

    var out = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
    var offsets = [];
    var pos = out[0].length;

    objects.forEach(function (obj, i) {
      var body;
      if (typeof obj === 'object' && obj.stream != null) {
        body = (i + 1) + ' 0 obj\n<< /Length ' + obj.stream.length + ' >>\nstream\n' +
               obj.stream + '\nendstream\nendobj\n';
      } else {
        body = (i + 1) + ' 0 obj\n' + obj + '\nendobj\n';
      }
      offsets.push(pos);
      out.push(body);
      pos += body.length;
    });

    var xrefPos = pos;
    var xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (o) {
      xref += String(o).padStart(10, '0') + ' 00000 n \n';
    });
    xref += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R /Info 3 0 R >>\n' +
            'startxref\n' + xrefPos + '\n%%EOF\n';
    out.push(xref);

    return latin1Bytes(out.join(''));
  };

  function latin1Bytes(str) {
    var bytes = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xFF;
    return bytes;
  }

  function utf8Bytes(str) {
    if (global.TextEncoder) return new global.TextEncoder().encode(str);
    var esc = unescape(encodeURIComponent(str));
    return latin1Bytes(esc);
  }

  /* ============================================================
     4. THE SHEET, AS A PDF

     Same information architecture as the on-screen sheet: masthead, summary
     strip, then one block per item with a left rail carrying the clock and a
     zero-padded number. Set as a document, not a screen dump.
     ============================================================ */
  var RAIL = 62;

  function buildPdf(model) {
    var doc = new Doc({ footer: model.runner });
    var M = doc.M;
    var right = doc.W - M;
    var mainX = M + RAIL;
    var mainW = right - mainX;

    /* ---- masthead ---- */
    doc.mark(M + 7, M + 12, 7);

    doc.textAt(model.eyebrow, M + 26, M, { size: 8, color: MUTED, font: 'bold', tracking: 0.9 });
    doc.textAt(model.title, M, M + 18, { size: 21, font: 'bold' });

    doc.textRight(model.viewLabel.toUpperCase(), right, M, { size: 8, font: 'bold', color: ACCENT, tracking: 1.1 });
    doc.y = M + 46;

    doc.hline(M, right, doc.y, INK, 1.4);
    doc.y += 12;

    /* ---- summary strip ---- */
    var stripH = 26;
    doc.rect(M, doc.y, right - M, stripH, WASH);
    var sx = M + 10;
    model.stats.forEach(function (s) {
      doc.textAt(s.value, sx, doc.y + 8, { size: 10, font: 'bold' });
      var vw = widthOf(s.value, 'bold', 10);
      doc.textAt(s.label, sx + vw + 4, doc.y + 9, { size: 8.5, color: MUTED });
      sx += vw + 6 + widthOf(s.label, 'reg', 8.5) + 14;
    });
    if (model.journey) {
      var jw = widthOf(model.journey, 'mono', 9);
      if (sx + jw < right - 10) doc.textRight(model.journey, right - 10, doc.y + 8.5, { size: 9, font: 'mono', color: ACCENT });
    }
    doc.y += stripH + 14;

    /* ---- service notes ---- */
    if (model.notes) {
      doc.para(model.notes, M, mainW + RAIL, { size: 10, font: 'obl', color: MUTED, lead: 13.5 });
      doc.y += 8;
    }

    /* ---- items ---- */
    model.rows.forEach(function (row, i) {
      var blockTop = doc.y;

      /* Measure first so a block is never orphaned with its title on one page
         and its chart on the next. Anything that fits in half a page stays
         whole; longer blocks are allowed to split rather than leave a gap. */
      var est = 20;
      if (row.by) est += 12;
      if (row.meta) est += doc.heightOf(row.meta, mainW, { size: 9, lead: 12 });
      if (row.firstLine) est += 14;
      if (row.chart) est += (row.chart.split('\n').length) * 11.5 + 10;
      if (row.chartAlt) est += (row.chartAlt.split('\n').length) * 10.5 + 4;
      if (row.arrangement) est += doc.heightOf(row.arrangement, mainW, { size: 9.5, lead: 12.5 });
      if (row.transition) est += 13;
      if (row.roles && row.roles.length) est += 14;
      if (row.ref) est += 12;

      var broke = false;
      if (est < 320 && !doc.room(est + 14)) { doc.newPage(); blockTop = doc.y; broke = true; }

      /* A hairline between blocks — but never one hanging under the top edge
         of a fresh page, which reads as a printing fault. */
      if (i > 0 && !broke) doc.hline(M, right, doc.y - 8, RULE, 0.6);

      /* Elements are not songs and should not have to be read to be told
         apart: they get a marker in the gutter, drawn once the block's real
         height is known. */
      var isEl = row.kind === 'element';
      var pagesAtStart = doc.pages.length;

      /* left rail */
      if (row.clock) {
        doc.textAt(row.clock, M, doc.y + 2, { size: 9.5, font: 'monob', color: isEl ? MUTED : INK });
      }
      doc.textAt(row.no, M, doc.y + (row.clock ? 15 : 2), { size: 8, font: 'mono', color: FAINT });

      /* head: title, minutes, key */
      var headY = doc.y;
      var keyW = 0;
      if (row.key) {
        var kw = widthOf(row.key, 'monob', 11) + 12;
        doc.rect(right - kw, headY - 2, kw, 17, isEl ? WASH : [0.91, 0.97, 0.94]);
        doc.textAt(row.key, right - kw + 6, headY + 2, { size: 11, font: 'monob', color: ACCENT });
        keyW = kw + 8;
      }
      if (row.minutes) {
        doc.textRight(row.minutes, right - keyW, headY + 3, { size: 8.5, font: 'mono', color: MUTED });
        keyW += widthOf(row.minutes, 'mono', 8.5) + 10;
      }

      var titleW = right - mainX - keyW;
      var titleLines = wrap(row.title, 'bold', 12.5, titleW);
      titleLines.forEach(function (ln, k) {
        doc.textAt(ln, mainX, doc.y, { size: 12.5, font: 'bold', color: isEl ? [0.24, 0.28, 0.33] : INK });
        doc.y += 15;
        if (k === 0) titleW = right - mainX;   // subsequent lines run full width
      });

      if (row.by) {
        doc.textAt(row.by, mainX, doc.y, { size: 8.5, color: MUTED, font: 'bold', tracking: 0.4 });
        doc.y += 12;
      }
      if (row.meta) {
        doc.para(row.meta, mainX, mainW, { size: 9, color: MUTED, font: 'mono', lead: 12 });
      }
      if (row.firstLine) {
        doc.para('\u201C' + row.firstLine + '\u2026\u201D', mainX, mainW, { size: 10, font: 'obl', lead: 13 });
      }

      if (row.chart) {
        doc.y += 4;
        var chartLines = row.chart.split('\n');
        var chartH = chartLines.length * 11.5 + 8;
        var altLines = row.chartAlt ? row.chartAlt.split('\n') : [];
        doc.rect(mainX, doc.y, mainW, chartH + (altLines.length ? altLines.length * 10.5 + 4 : 0), WASH);
        doc.y += 5;
        chartLines.forEach(function (ln) {
          if (!doc.room(11.5)) doc.newPage();
          doc.textAt(ln, mainX + 8, doc.y, { size: 9.5, font: 'monob' });
          doc.y += 11.5;
        });
        altLines.forEach(function (ln) {
          if (!doc.room(10.5)) doc.newPage();
          doc.textAt(ln, mainX + 8, doc.y, { size: 8.5, font: 'mono', color: MUTED });
          doc.y += 10.5;
        });
        doc.y += 7;
      }

      if (row.arrangement) {
        doc.para(row.arrangement, mainX, mainW, { size: 9.5, lead: 12.5, color: [0.20, 0.24, 0.29] });
        doc.y += 2;
      }
      if (row.transition) {
        doc.textAt('\u2192 ' + row.transition, mainX, doc.y, { size: 9, font: 'obl', color: ACCENT });
        doc.y += 13;
      }

      if (row.roles && row.roles.length) {
        var rx = mainX;
        doc.y += 2;
        row.roles.forEach(function (r) {
          /* Measure what is actually drawn — the uppercased string, plus the
             tracking. Measuring the mixed-case original made every label read
             ~15% narrower than it printed, so the name landed on top of it. */
          var label = String(r.role).toUpperCase();
          var lw = widthOf(label, 'bold', 8) + 0.4 * label.length;
          var pw = widthOf(r.person, 'reg', 9);
          if (rx + lw + pw + 20 > right) { doc.y += 13; rx = mainX; }
          doc.textAt(label, rx, doc.y + 1, { size: 8, font: 'bold', color: FAINT, tracking: 0.4 });
          doc.textAt(r.person, rx + lw + 5, doc.y, { size: 9 });
          rx += lw + pw + 22;
        });
        doc.y += 14;
      }

      if (row.ref) {
        doc.para(row.ref, mainX, mainW, { size: 8, color: FAINT, lead: 10.5 });
      }

      if (isEl && doc.pages.length === pagesAtStart) {
        doc.rect(mainX - 11, blockTop, 2.5, Math.max(doc.y - blockTop - 2, 10), [0.80, 0.84, 0.87]);
      }

      doc.y += 14;
    });

    if (!model.rows.length) {
      doc.para('Nothing in this service yet.', M, doc.contentWidth(), { size: 11, font: 'obl', color: MUTED });
    }

    return doc.build({ title: model.docTitle, subject: model.runner });
  }

  /* ============================================================
     4b. THE SETLIST

     A different document with a different job. The sheet above is for the
     people playing it; this is the one taped to the front of a monitor or
     held by a singer — song, key, who's leading it, nothing else. So it is
     not the sheet with fields switched off: it is set much larger, with the
     numbers running 1, 2, 3 down the page, to be read at a glance from a
     stand rather than studied.
     ============================================================ */
  function buildSetlistPdf(model) {
    var doc = new Doc({ footer: model.runner });
    var M = doc.M;
    var right = doc.W - M;
    var numW = 38;
    var textX = M + numW;

    doc.mark(M + 7, M + 12, 7);
    doc.textAt(model.eyebrow, M + 26, M, { size: 8, color: MUTED, font: 'bold', tracking: 0.9 });
    doc.textAt(model.title, M, M + 18, { size: 21, font: 'bold' });
    doc.textRight('SETLIST', right, M, { size: 8, font: 'bold', color: ACCENT, tracking: 1.4 });

    doc.y = M + 46;
    doc.hline(M, right, doc.y, INK, 1.4);
    doc.y += 18;

    if (!model.songs.length) {
      doc.para('No songs in this service yet.', M, doc.contentWidth(),
        { size: 12, font: 'obl', color: MUTED });
      return doc.build({ title: model.docTitle, subject: model.runner });
    }

    model.songs.forEach(function (song, i) {
      /* Keep number, title, singer and key together or move the lot to the
         next page. A key stranded at the top of page two is worse than a
         short page one. */
      var rowH = song.singer ? 44 : 34;
      if (!doc.room(rowH + 8)) doc.newPage();
      if (i > 0) doc.hline(M, right, doc.y - 9, RULE, 0.6);

      var top = doc.y;

      /* key first, so the title knows how much room it has left */
      var keyReserve = 0;
      if (song.key) {
        var kw = Math.max(widthOf(song.key, 'monob', 15) + 16, 40);
        doc.rect(right - kw, top - 3, kw, 25, [0.91, 0.97, 0.94]);
        doc.textAt(song.key, right - kw + (kw - widthOf(song.key, 'monob', 15)) / 2, top + 2,
          { size: 15, font: 'monob', color: ACCENT });
        keyReserve = kw + 14;
      }

      doc.textAt(song.no, M, top + 3, { size: 15, font: 'monob', color: FAINT });

      var titleLines = wrap(song.title, 'bold', 15, right - textX - keyReserve);
      titleLines.forEach(function (line, k) {
        doc.textAt(line, textX, doc.y, { size: 15, font: 'bold' });
        // The last line needs clearance for its descenders before the singer
        // name goes underneath it — a "y" in the title was clipping the caps.
        doc.y += k === titleLines.length - 1 ? 21 : 17;
      });

      if (song.singer) {
        doc.textAt(song.singer.toUpperCase(), textX, doc.y,
          { size: 8.5, font: 'bold', color: MUTED, tracking: 0.7 });
        doc.y += 13;
      }

      doc.y += 9;
    });

    return doc.build({ title: model.docTitle, subject: model.runner });
  }

  /* ============================================================
     5. ZIP (stored) — the container a .docx actually is
     ============================================================ */
  var CRC_TABLE = (function () {
    var t = new Int32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = -1;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function zip(entries) {
    var chunks = [];
    var central = [];
    var offset = 0;

    function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
    function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

    entries.forEach(function (e) {
      var nameBytes = utf8Bytes(e.name);
      var data = e.data;
      var sum = crc32(data);
      /* A zeroed DOS date decodes to day 0 of month 0, which strict unzip
         implementations reject. 0x21 = 1 Jan 1980, the epoch of the format. */
      var local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x0021),
                            u32(sum), u32(data.length), u32(data.length),
                            u16(nameBytes.length), u16(0));
      chunks.push(new Uint8Array(local), nameBytes, data);
      central.push({ name: nameBytes, crc: sum, size: data.length, offset: offset });
      offset += local.length + nameBytes.length + data.length;
    });

    var centralStart = offset;
    var centralSize = 0;
    central.forEach(function (c) {
      var head = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x0021),
                           u32(c.crc), u32(c.size), u32(c.size),
                           u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset));
      chunks.push(new Uint8Array(head), c.name);
      centralSize += head.length + c.name.length;
    });

    chunks.push(new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
      u32(centralSize), u32(centralStart), u16(0))));

    var total = chunks.reduce(function (t, c) { return t + c.length; }, 0);
    var out = new Uint8Array(total);
    var at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }

  /* ============================================================
     6. THE SHEET, AS A .DOCX

     Word opens this as an editable document, which is the point: the MD can
     add a line about the guest minister and reprint without coming back here.
     ============================================================ */
  function xml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function run(text, o) {
    o = o || {};
    var props = '<w:rPr>' +
      (o.font ? '<w:rFonts w:ascii="' + o.font + '" w:hAnsi="' + o.font + '"/>' : '') +
      (o.bold ? '<w:b/>' : '') +
      (o.italic ? '<w:i/>' : '') +
      (o.caps ? '<w:caps/>' : '') +
      (o.color ? '<w:color w:val="' + o.color + '"/>' : '') +
      (o.size ? '<w:sz w:val="' + (o.size * 2) + '"/><w:szCs w:val="' + (o.size * 2) + '"/>' : '') +
      (o.spacing ? '<w:spacing w:val="' + o.spacing + '"/>' : '') +
      '</w:rPr>';
    var body = String(text == null ? '' : text).split(/\r?\n/).map(function (line, i) {
      return (i ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + xml(line) + '</w:t>';
    }).join('');
    return '<w:r>' + props + body + '</w:r>';
  }

  function para(runs, o) {
    o = o || {};
    var pPr = '<w:pPr>' +
      (o.rightTab ? '<w:tabs><w:tab w:val="right" w:pos="' + o.rightTab + '"/></w:tabs>' : '') +
      '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 40 : o.after) + '" w:line="' + (o.line || 252) + '" w:lineRule="auto"/>' +
      (o.align ? '<w:jc w:val="' + o.align + '"/>' : '') +
      (o.shade ? '<w:shd w:val="clear" w:fill="' + o.shade + '"/>' : '') +
      (o.border ? '<w:pBdr><w:bottom w:val="single" w:sz="' + (o.borderSize || 6) +
                  '" w:space="4" w:color="' + o.border + '"/></w:pBdr>' : '') +
      (o.indent ? '<w:ind w:left="' + o.indent + '"/>' : '') +
      '</w:pPr>';
    return '<w:p>' + pPr + (Array.isArray(runs) ? runs.join('') : runs) + '</w:p>';
  }

  function cell(width, content, o) {
    o = o || {};
    return '<w:tc><w:tcPr><w:tcW w:w="' + width + '" w:type="dxa"/>' +
      (o.shade ? '<w:shd w:val="clear" w:fill="' + o.shade + '"/>' : '') +
      '<w:tcBorders><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D8DCE0"/></w:tcBorders>' +
      '<w:tcMar><w:top w:w="90" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/>' +
      '<w:left w:w="0" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar>' +
      '</w:tcPr>' + (content || para([run('')])) + '</w:tc>';
  }

  var MONO = 'Consolas';
  var SANS = 'Calibri';

  function buildDocx(model) {
    var body = [];

    body.push(para([
      run(model.eyebrow.toUpperCase(), { size: 8, bold: true, color: '667080', spacing: 30 })
    ], { after: 20 }));

    body.push(para([
      run(model.title, { size: 24, bold: true, color: '14161A' })
    ], { after: 40 }));

    body.push(para([
      run(model.viewLabel.toUpperCase() + ' SHEET', { size: 8.5, bold: true, color: '0E9469', spacing: 40 })
    ], { after: 60, border: '14161A', borderSize: 12 }));

    var strip = model.stats.map(function (s) { return s.value + ' ' + s.label; }).join('   \u00B7   ');
    body.push(para([
      run(strip, { size: 9.5, bold: true, color: '2A3038', font: SANS }),
      model.journey ? run('        ' + model.journey, { size: 9.5, font: MONO, color: '0E9469' }) : ''
    ], { after: 120, shade: 'F4F7F9' }));

    if (model.notes) {
      body.push(para([run(model.notes, { size: 10, italic: true, color: '4A5560' })], { after: 160 }));
    }

    var rows = model.rows.map(function (row) {
      var isEl = row.kind === 'element';

      var rail = [];
      if (row.clock) rail.push(para([run(row.clock, { font: MONO, bold: true, size: 10, color: isEl ? '667080' : '14161A' })], { after: 20 }));
      rail.push(para([run(row.no, { font: MONO, size: 8, color: '9AA3AC' })], { after: 0 }));

      var main = [];
      var head = [run(row.title, { size: 12.5, bold: true, color: isEl ? '3C4450' : '14161A' })];
      if (row.minutes || row.key) head.push('<w:r><w:tab/></w:r>');
      if (row.minutes) head.push(run(row.minutes + '   ', { size: 8.5, font: MONO, color: '667080' }));
      if (row.key) head.push(run(row.key, { size: 11.5, bold: true, font: MONO, color: '0E9469' }));
      main.push(para(head, { after: 20, rightTab: 7780 }));

      if (row.by) main.push(para([run(row.by.toUpperCase(), { size: 8, bold: true, color: '667080', spacing: 20 })], { after: 20 }));
      if (row.meta) main.push(para([run(row.meta, { size: 9, font: MONO, color: '4A5560' })], { after: 20 }));
      if (row.firstLine) main.push(para([run('\u201C' + row.firstLine + '\u2026\u201D', { size: 10, italic: true })], { after: 20 }));

      if (row.chart) {
        main.push(para([run(row.chart, { size: 9.5, bold: true, font: MONO })],
          { after: row.chartAlt ? 0 : 40, shade: 'F4F7F9', line: 240 }));
        if (row.chartAlt) {
          main.push(para([run(row.chartAlt, { size: 8.5, font: MONO, color: '667080' })],
            { after: 40, shade: 'F4F7F9', line: 240 }));
        }
      }

      if (row.arrangement) main.push(para([run(row.arrangement, { size: 9.5, color: '2A3038' })], { after: 20 }));
      if (row.transition) main.push(para([run('\u2192 ' + row.transition, { size: 9, italic: true, color: '0E9469' })], { after: 20 }));

      if (row.roles && row.roles.length) {
        var roleRuns = [];
        row.roles.forEach(function (r, i) {
          if (i) roleRuns.push(run('     ', { size: 9 }));
          roleRuns.push(run(r.role.toUpperCase() + ' ', { size: 8, bold: true, color: '9AA3AC', spacing: 20 }));
          roleRuns.push(run(r.person, { size: 9.5 }));
        });
        main.push(para(roleRuns, { after: 20 }));
      }

      if (row.ref) main.push(para([run(row.ref, { size: 8, color: '9AA3AC' })], { after: 0 }));

      return '<w:tr>' +
        cell(1100, rail.join(''), { shade: isEl ? 'F7F9FA' : null }) +
        cell(7900, main.join(''), { shade: isEl ? 'F7F9FA' : null }) +
        '</w:tr>';
    }).join('');

    var table = '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>' +
      '<w:tblLayout w:type="fixed"/>' +
      '<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr><w:tblGrid><w:gridCol w:w="1100"/><w:gridCol w:w="7900"/></w:tblGrid>' + rows + '</w:tbl>';

    body.push(model.rows.length ? table : para([run('Nothing in this service yet.', { italic: true, color: '667080' })]));
    body.push(para([run('')], { after: 0 }));

    var sectPr = '<w:sectPr>' +
      '<w:footerReference w:type="default" r:id="rIdFooter"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="567" w:gutter="0"/>' +
      '</w:sectPr>';

    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:body>' + body.join('') + sectPr + '</w:body></w:document>';

    var footerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      para([
        run(model.runner + '   \u00B7   page ', { size: 7.5, color: '9AA3AC' })
      ], { after: 0, border: 'D8DCE0' }).replace('</w:p>',
        '<w:r><w:rPr><w:sz w:val="15"/><w:color w:val="9AA3AC"/></w:rPr>' +
        '<w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>') +
      '</w:ftr>';

    var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="' + SANS + '" w:hAnsi="' + SANS + '" w:cs="' + SANS + '"/>' +
      '<w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="14161A"/>' +
      '</w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '</w:styles>';

    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>';

    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>';

    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
      '</Relationships>';

    var stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var coreXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + xml(model.docTitle) + '</dc:title>' +
      '<dc:creator>SetTheSet</dc:creator>' +
      '<cp:lastModifiedBy>SetTheSet</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + stamp + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + stamp + '</dcterms:modified>' +
      '</cp:coreProperties>';

    return zip([
      { name: '[Content_Types].xml', data: utf8Bytes(contentTypes) },
      { name: '_rels/.rels', data: utf8Bytes(rootRels) },
      { name: 'docProps/core.xml', data: utf8Bytes(coreXml) },
      { name: 'word/_rels/document.xml.rels', data: utf8Bytes(docRels) },
      { name: 'word/document.xml', data: utf8Bytes(documentXml) },
      { name: 'word/styles.xml', data: utf8Bytes(stylesXml) },
      { name: 'word/footer1.xml', data: utf8Bytes(footerXml) }
    ]);
  }

  /* ============================================================
     7. SAVING

     Android (the APK): Capacitor's Filesystem plugin, into
     Documents/SetTheSet/. That folder is visible in Files, in the Downloads
     app, and over USB — which is the whole point of asking for a file rather
     than a print preview. Directory.DOCUMENTS needs a storage permission on
     older Android, so we ask, and fall back down a chain if it's refused.

     Everywhere else: an ordinary blob download.
     ============================================================ */
  function plugins() {
    return (global.Capacitor && global.Capacitor.Plugins) || {};
  }

  function isNative() {
    return !!(global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function' &&
              global.Capacitor.isNativePlatform() && plugins().Filesystem);
  }

  function toBase64(bytes) {
    var chunk = 0x8000, parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return global.btoa(parts.join(''));
  }

  function askPermission(FS) {
    if (!FS.checkPermissions) return Promise.resolve();
    return FS.checkPermissions().then(function (res) {
      if (res && res.publicStorage === 'granted') return;
      if (!FS.requestPermissions) return;
      return FS.requestPermissions();
    }).catch(function () { /* older plugin versions have neither — carry on */ });
  }

  function saveNative(filename, bytes) {
    var FS = plugins().Filesystem;
    var data = toBase64(bytes);
    var attempts = [
      { directory: 'DOCUMENTS', label: 'Documents/SetTheSet' },
      { directory: 'EXTERNAL_STORAGE', label: 'Documents/SetTheSet' },
      { directory: 'EXTERNAL', label: 'SetTheSet' },
      { directory: 'DATA', label: 'app storage' }
    ];

    return askPermission(FS).then(function () {
      var chain = Promise.reject();
      attempts.forEach(function (a) {
        chain = chain.catch(function () {
          var path = (a.directory === 'EXTERNAL_STORAGE' ? 'Documents/SetTheSet/' : 'SetTheSet/') + filename;
          return FS.writeFile({
            path: path,
            data: data,
            directory: a.directory,
            recursive: true
          }).then(function (res) {
            return { where: a.label, uri: (res && res.uri) || '', filename: filename };
          });
        });
      });
      return chain;
    });
  }

  /* Offer to open it straight away. Both plugins are optional; a saved file the
     user has to go and find is still a saved file, so a missing plugin is not
     an error worth surfacing. */
  function openAfterSave(uri, mime) {
    var p = plugins();
    if (p.FileOpener && uri) {
      return p.FileOpener.open({ filePath: uri, contentType: mime }).catch(function () {});
    }
    if (p.Share && uri) {
      return p.Share.share({ url: uri, title: 'Service sheet' }).catch(function () {});
    }
    return Promise.resolve();
  }

  function saveBrowser(filename, bytes, mime) {
    return new Promise(function (resolve, reject) {
      try {
        var blob = new Blob([bytes], { type: mime });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 4000);
        resolve({ where: 'your downloads', uri: '', filename: filename });
      } catch (e) { reject(e); }
    });
  }

  function save(filename, bytes, mime, opts) {
    opts = opts || {};
    if (!isNative()) return saveBrowser(filename, bytes, mime);
    return saveNative(filename, bytes).then(function (res) {
      if (opts.open !== false) openAfterSave(res.uri, mime);
      return res;
    }).catch(function () {
      // Native write refused (permission, storage policy) — a download still
      // works inside the WebView and lands in the system Downloads folder.
      return saveBrowser(filename, bytes, mime);
    });
  }

  /* ============================================================
     8. PUBLIC API
     ============================================================ */
  function safeName(s) {
    return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  function filenameFor(model, ext) {
    return safeName('SetTheSet ' + model.dateSlug + ' ' + model.title + ' - ' + model.viewLabel) + '.' + ext;
  }

  global.Exporter = {
    /* exposed for the tests and for anyone wanting the bytes without saving */
    pdfBytes: buildPdf,
    docxBytes: buildDocx,
    setlistBytes: buildSetlistPdf,
    filenameFor: filenameFor,
    save: save,
    isNative: isNative,

    pdf: function (model) {
      var name = filenameFor(model, 'pdf');
      // The setlist is its own layout, not the sheet with fields removed.
      var bytes = model.layout === 'setlist' ? buildSetlistPdf(model) : buildPdf(model);
      return save(name, bytes, 'application/pdf');
    },

    setlist: function (model) {
      var name = filenameFor(model, 'pdf');
      return save(name, buildSetlistPdf(model), 'application/pdf');
    },

    docx: function (model) {
      var name = filenameFor(model, 'docx');
      return save(name, buildDocx(model),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    }
  };
})(window);
