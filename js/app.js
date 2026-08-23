(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = UI.esc;

  /* ---------------- musical vocabulary ---------------- */
  var MAJORS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  var KEYS = [{ value: '', label: '— no key set —' }]
    .concat(MAJORS.map(function (k) { return { value: k, label: k + ' major' }; }))
    .concat(MAJORS.map(function (k) { return { value: k + 'm', label: k + ' minor' }; }));

  // 6/8 and 12/8 matter more here than anywhere else: a gospel ballad and a
  // shuffle are the same BPM on paper and nothing alike on the stand.
  var METERS = ['', '4/4', '12/8', '6/8', '3/4', '2/4', '6/4', '5/4', 'cut time'];

  var CAPOS = ['', '1', '2', '3', '4', '5', '6', '7'];

  var SEGMENTS = ['Praise', 'Worship', 'Offering', 'Altar call', 'Communion',
                  'Special', 'Sermon response', 'Closing', 'Other'];

  var ELEMENT_KINDS = ['Welcome', 'Prayer', 'Scripture reading', 'Announcements',
                       'Offering', 'Testimony', 'Special item', 'Sermon',
                       'Altar call', 'Communion', 'Benediction', 'Other'];

  var ROLE_NAMES = ['Lead vocal', 'BGVs', 'Drums', 'Bass', 'Guitar', 'Organ',
                    'Keys 2', 'Sax', 'Horns', 'Percussion', 'MD cue', 'Sound',
                    'Media', 'Leads it'];

  /* Per-person sheet views. Everyone gets the same running order; they just
     don't get each other's clutter. The drummer does not need patch notes and
     the media desk does not need chord charts. */
  var SHEET_VIEWS = {
    full:   { label: 'Full',           key: 1, capo: 1, meter: 1, bpm: 1, tone: 1, chords: 1, numbers: 1, arrangement: 1, transition: 1, roles: 1, firstLine: 1, ref: 1, clock: 1 },
    keys:   { label: 'Keys / MD',      key: 1, capo: 1, meter: 1, bpm: 1, tone: 1, chords: 1, numbers: 1, arrangement: 1, transition: 1, roles: 1, firstLine: 0, ref: 1, clock: 1 },
    band:   { label: 'Band',           key: 1, capo: 1, meter: 1, bpm: 1, tone: 0, chords: 1, numbers: 1, arrangement: 1, transition: 1, roles: 1, firstLine: 0, ref: 1, clock: 1 },
    vocals: { label: 'Vocals',         key: 1, capo: 0, meter: 0, bpm: 1, tone: 0, chords: 0, numbers: 0, arrangement: 1, transition: 1, roles: 1, firstLine: 1, ref: 1, clock: 1 },
    media:  { label: 'Media & sound',  key: 1, capo: 0, meter: 0, bpm: 0, tone: 0, chords: 0, numbers: 0, arrangement: 0, transition: 0, roles: 0, firstLine: 1, ref: 0, clock: 1 },

    /* The setlist is not the sheet with fields switched off — it is a
       different document with its own layout, so it carries a `setlist` flag
       rather than a row of zeroes. renderSheet() and the exporters both branch
       on it. Elements are dropped and the songs renumber from 1. */
    setlist: { label: 'Setlist', setlist: 1, key: 1, capo: 0, meter: 0, bpm: 0, tone: 0, chords: 0, numbers: 0, arrangement: 0, transition: 0, roles: 1, firstLine: 0, ref: 0, clock: 0 }
  };

  var state = {
    view: 'sets', setId: null, set: null,
    songs: [], sets: [], wakeLock: null, query: '', sheetView: 'full',
    clickIdx: -1        // which song the metronome is running for, if any
  };

  /* ---------------- helpers ---------------- */
  function fmtDate(iso) {
    if (!iso) return 'No date';
    var p = iso.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);   // 'YYYY-MM-DD' parses as UTC and can slip a day
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  function nextSunday() {
    var d = new Date();
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function mins(v) {
    var n = parseInt(v, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  /* Running time. If the service has a start time you get a wall clock, which
     is what actually tells you the 11am is going to overrun. Without one you
     get a cumulative offset, which is still better than nothing. */
  function clockFor(items, idx, startTime) {
    var offset = 0;
    for (var i = 0; i < idx; i++) offset += mins(items[i].minutes);

    if (!startTime || !/^\d{1,2}:\d{2}$/.test(startTime)) {
      return { label: '+' + offset, offset: offset, isClock: false };
    }
    var p = startTime.split(':');
    var total = (+p[0]) * 60 + (+p[1]) + offset;
    var h = Math.floor(total / 60) % 24;
    var m = total % 60;
    return {
      label: String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'),
      offset: offset,
      isClock: true
    };
  }

  function totalMinutes(items) {
    return (items || []).reduce(function (t, i) { return t + mins(i.minutes); }, 0);
  }

  function fmtDuration(m) {
    if (!m) return '0 min';
    var h = Math.floor(m / 60), r = m % 60;
    return h ? h + 'h ' + r + 'm' : m + ' min';
  }

  function keyChip(k) {
    return '<span class="key' + (k ? '' : ' key--empty') + '">' + esc(k || '—') + '</span>';
  }

  function roleChips(roles) {
    if (!roles || !roles.length) return '';
    return roles.map(function (r) {
      return '<span class="role"><b>' + esc(r.role) + '</b> ' + esc(r.person) + '</span>';
    }).join('');
  }

  function capoLine(it) {
    if (!it.capo) return '';
    var shapes = Chords.shapesKey(it.key, it.capo);
    return 'capo ' + esc(it.capo) + (shapes ? ' → play ' + esc(shapes) : '');
  }

  function isSong(it) { return it.type !== 'element'; }

  /* Haptics. Short and sparse on purpose: a buzz you feel without looking is
     useful mid-song, a buzz on every tap is a phone you want to put down.
     Android fires these; iOS Safari ignores vibrate() entirely, which is fine
     because nothing depends on it. */
  var HAPTIC = { tap: 12, done: [0, 18], undo: 8, warn: [0, 22, 60, 22] };

  function haptic(pattern) {
    if (!navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) { /* blocked, no matter */ }
  }

  /* ============================================================
     NAVIGATION

     The Back button has to work. In the installed APK there is no browser
     chrome, so Android's hardware Back is the ONLY back affordance -- and
     without this, pressing it from any screen closes the whole app mid-service.

     Model: each screen deeper than the list pushes a history entry, and every
     open sheet pushes one too. popstate walks back up. Closing a sheet with
     Cancel or Save calls history.back() so the entry doesn't linger, which
     would otherwise cost the user a second Back press that appeared to do
     nothing.
     ============================================================ */
  var PARENT = { sets: null, songs: null, editor: 'sets', live: 'editor', sheet: 'editor', import: 'sets' };
  var ignorePop = false;      // set when WE caused the popstate
  var modalPushed = false;    // an open sheet owns a history entry

  function navTo(view) {
    if (!view || !$('view-' + view)) return;   // never navigate to a non-view
    if (view === state.view) return;
    history.pushState({ v: view }, '');
    show(view);
  }

  /* Updates are applied silently — see applyUpdateIfIdle() near the bottom.
     There is no longer a banner asking permission: it sat over the bottom of
     every screen, it appeared on the one morning nobody wants to read a
     dialog, and "reload" is not a decision a musician should have to make
     mid-service. The worker waits instead until you are back on a list screen
     with nothing open, then swaps itself in. */
  var pendingWorker = null;

  UI.onOpen = function () {
    history.pushState({ modal: true, v: state.view }, '');
    modalPushed = true;
  };

  UI.onClosed = function () {
    // Save/Cancel closed the sheet: retire the history entry it pushed.
    if (modalPushed) {
      modalPushed = false;
      ignorePop = true;
      history.back();
    }
    applyUpdateIfIdle();
  };

  window.addEventListener('popstate', function (e) {
    if (ignorePop) { ignorePop = false; return; }

    // Back with a sheet open closes the sheet and goes no further.
    if (UI.isOpen()) {
      modalPushed = false;
      UI.closeSilent();
      applyUpdateIfIdle();
      return;
    }

    var target = (e.state && e.state.v) || 'sets';
    if (target === 'live' || target === 'sheet') target = PARENT[target] || 'sets';
    if (target === 'editor' && !state.set) target = 'sets';
    // A review screen with nothing in it is a dead end: the rows live in
    // memory only, so coming back to it after leaving would show an empty
    // list with a Create button that does nothing.
    if (target === 'import' && !importRows.length) target = 'sets';

    if (target === 'editor') renderEditor();
    if (target === 'sets') { loadSets().then(renderSets); }
    show(target);
  });

  /* ---------------- view switching ---------------- */
  var DEPTH = { sets: 0, songs: 0, import: 1, editor: 1, sheet: 2, live: 2 };

  function show(view) {
    var back = DEPTH[view] < DEPTH[state.view];
    state.view = view;
    ['sets', 'songs', 'editor', 'live', 'sheet', 'import'].forEach(function (v) {
      $('view-' + v).classList.toggle('is-active', v === view);
    });

    var deep = view === 'editor' || view === 'live' || view === 'sheet' || view === 'import';
    $('btnBack').hidden = !deep;
    $('topNav').hidden = deep;
    $('topMark').hidden = deep;
    $('topbar').hidden = view === 'live';

    if (view === 'sets') $('topTitle').textContent = 'SetTheSet';
    if (view === 'songs') $('topTitle').textContent = 'Song library';
    if (view === 'editor') $('topTitle').textContent = state.set ? fmtDate(state.set.date) : 'Service';
    if (view === 'sheet') $('topTitle').textContent = 'Sheet';
    if (view === 'import') $('topTitle').textContent = 'Check the list';

    document.querySelectorAll('.tab[data-view]').forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-view') === view);
    });

    // Direction-aware: forward slides in from the right, back from the left.
    // Cheap, but it is the difference between screens cutting and screens moving.
    var pane = $('view-' + view);
    pane.classList.remove('anim-in', 'anim-back');
    void pane.offsetWidth;                       // restart the animation
    pane.classList.add(back ? 'anim-back' : 'anim-in');

    window.scrollTo(0, 0);

    // Back on a list screen with nothing open is the safe moment to swap in a
    // waiting build. Never mid-service, never mid-edit.
    applyUpdateIfIdle();

    if (view === 'live') {
      lockScreen();
    } else {
      releaseScreen();
      // leaving live must silence the click, however you left
      if (Metronome.isRunning()) { Metronome.stop(); state.clickIdx = -1; }
    }
  }

  /* The on-screen Back button drives history rather than calling show()
     directly, so it and the hardware Back stay on the same path. */
  function goUp() {
    var parent = PARENT[state.view];
    if (!parent) return;
    if (parent === 'editor') renderEditor();
    history.back();
  }

  $('btnBack').addEventListener('click', goUp);

  document.querySelectorAll('.tab[data-view]').forEach(function (t) {
    t.addEventListener('click', function () {
      var v = t.getAttribute('data-view');
      (v === 'songs' ? loadSongs().then(renderSongs) : loadSets().then(renderSets)).then(function () { navTo(v); });
    });
  });

  /* ============================================================
     SERVICES
     ============================================================ */
  function loadSets() {
    return DB.all('setlists').then(function (rows) {
      rows.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      state.sets = rows;
      return rows;
    });
  }

  function renderSets() {
    var host = $('setList');
    host.innerHTML = '';
    state.sets.forEach(function (s) {
      var items = s.items || [];
      var songs = items.filter(isSong).length;
      var done = items.filter(function (i) { return i.performed; }).length;
      var total = totalMinutes(items);

      var li = document.createElement('li');
      li.className = 'card';
      li.innerHTML =
        '<button class="card__main" type="button" data-open="' + esc(s.id) + '">' +
          '<span class="card__date">' + esc(fmtDate(s.date)) + '</span>' +
          '<div class="card__title">' + esc(s.service || 'Sunday service') + '</div>' +
          '<div class="card__sub">' + songs + ' songs · ' + items.length + ' items' +
            (total ? ' · ' + fmtDuration(total) : '') +
            (done ? ' · ' + done + ' done' : '') + '</div>' +
        '</button>' +
        '<div class="card__acts">' +
          '<button class="btn btn--ghost" type="button" data-dup="' + esc(s.id) + '">Duplicate</button>' +
          '<button class="btn btn--danger" type="button" data-delset="' + esc(s.id) + '">Delete</button>' +
        '</div>';
      host.appendChild(li);
    });
    $('setsEmpty').hidden = state.sets.length > 0;
  }

  $('setList').addEventListener('click', function (e) {
    var openId = e.target.closest('[data-open]');
    var dupId = e.target.closest('[data-dup]');
    var delId = e.target.closest('[data-delset]');

    if (openId) return openSet(openId.getAttribute('data-open'));

    if (dupId) {
      var src = state.sets.find(function (s) { return s.id === dupId.getAttribute('data-dup'); });
      var copy = JSON.parse(JSON.stringify(src));
      copy.id = DB.newId();
      copy.date = nextSunday();
      copy.items = (copy.items || []).map(function (i) {
        i.id = DB.newId();
        i.performed = false;
        return i;
      });
      return DB.put('setlists', copy).then(loadSets).then(renderSets).then(function () {
        UI.toast('Copied to ' + fmtDate(copy.date));
      });
    }

    if (delId) {
      var id = delId.getAttribute('data-delset');
      var target = state.sets.find(function (s) { return s.id === id; });
      UI.confirm({
        title: 'Delete this service?',
        message: fmtDate(target.date) + ' — ' + (target.service || 'Sunday service') +
                 '. The songs stay in your library.',
        onConfirm: function () {
          DB.remove('setlists', id).then(loadSets).then(renderSets).then(function () { UI.toast('Deleted'); });
        }
      });
    }
  });

  function openSet(id) {
    return DB.get('setlists', id).then(function (s) {
      state.set = s;
      state.setId = id;
      renderEditor();
      navTo('editor');
    });
  }

  $('btnNewSet').addEventListener('click', function () {
    serviceModal({ date: nextSunday(), service: 'Sunday morning', startTime: '10:00', notes: '', items: [] }, true);
  });

  $('setMeta').addEventListener('click', function () { serviceModal(state.set, false); });
  $('setMeta').addEventListener('keydown', function (e) {
    // role="button" does not bring Enter/Space activation with it.
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); serviceModal(state.set, false); }
  });

  function serviceModal(set, isNew) {
    UI.open({
      title: isNew ? 'New service' : 'Service details',
      fields: [
        { type: 'pair', fields: [
          { name: 'date', label: 'Date', type: 'date', value: set.date },
          { name: 'startTime', label: 'Starts', type: 'time', value: set.startTime || '10:00' }
        ] },
        { name: 'service', label: 'Service', type: 'text', value: set.service, placeholder: 'Sunday morning' },
        { name: 'notes', label: 'Notes for the team', type: 'textarea', rows: 3, value: set.notes,
          placeholder: 'Theme, guest minister, rehearsal time…' }
      ],
      saveLabel: isNew ? 'Create' : 'Save',
      onSave: function (v) {
        var rec = isNew ? { id: DB.newId(), items: [], createdAt: Date.now() } : set;
        rec.date = v.date;
        rec.startTime = v.startTime;
        rec.service = v.service;
        rec.notes = v.notes;
        return DB.put('setlists', rec).then(function () {
          if (isNew) return loadSets().then(function () { openSet(rec.id); });
          state.set = rec;
          renderEditor();
          $('topTitle').textContent = fmtDate(rec.date);
        });
      }
    });
  }

  /* ============================================================
     EDITOR
     ============================================================ */
  function renderEditor() {
    var s = state.set;
    if (!s) return;

    var items = s.items || [];
    var total = totalMinutes(items);
    var ends = items.length ? clockFor(items, items.length, s.startTime) : null;

    $('setMeta').innerHTML =
      '<div class="setmeta__date">' + esc(fmtDate(s.date)) +
        (s.startTime ? ' · ' + esc(s.startTime) : '') + '</div>' +
      '<h2 class="setmeta__title">' + esc(s.service || 'Sunday service') + '</h2>' +
      (total
        ? '<div class="setmeta__run">' + fmtDuration(total) + ' total' +
          (ends && ends.isClock ? ' · ends ' + esc(ends.label) : '') + '</div>'
        : '') +
      (s.notes ? '<p class="setmeta__note">' + esc(s.notes) + '</p>' : '');

    var host = $('itemList');
    host.innerHTML = '';

    items.forEach(function (it, idx) {
      var clock = clockFor(items, idx, s.startTime);
      var li = document.createElement('li');
      li.className = 'item' + (isSong(it) ? '' : ' item--element');

      var head =
        '<div class="item__head">' +
          '<span class="item__clock">' + esc(clock.label) + '</span>' +
          '<span class="item__title">' + esc(it.title) + '</span>' +
          (isSong(it) ? keyChip(it.key) : '') +
        '</div>';

      var body;
      if (isSong(it)) {
        var data = [];
        if (it.minutes) data.push('<span>' + esc(it.minutes) + ' min</span>');
        if (it.meter) data.push('<span>' + esc(it.meter) + '</span>');
        if (it.bpm) data.push('<span>' + esc(it.bpm) + ' bpm</span>');
        if (it.capo) data.push('<span>' + capoLine(it) + '</span>');
        if (it.tone) data.push('<span>' + esc(it.tone) + '</span>');
        if (it.transition) data.push('<span>→ ' + esc(it.transition) + '</span>');

        body =
          (it.segment ? '<div class="item__seg">' + esc(it.segment) + '</div>' : '') +
          (it.artist ? '<div class="item__artist">' + esc(it.artist) + '</div>' : '') +
          (data.length ? '<div class="item__data">' + data.join('') + '</div>' : '') +
          chartHTML(it, true);
      } else {
        var edata = [];
        if (it.minutes) edata.push('<span>' + esc(it.minutes) + ' min</span>');
        if (it.kind) edata.push('<span>' + esc(it.kind) + '</span>');
        body =
          '<div class="item__seg item__seg--el">element</div>' +
          (edata.length ? '<div class="item__data">' + edata.join('') + '</div>' : '') +
          (it.notes ? '<div class="item__note">' + esc(it.notes) + '</div>' : '');
      }

      li.innerHTML =
        (isSong(it) ? '' : '') + head + body +
        (it.roles && it.roles.length ? '<div class="item__roles">' + roleChips(it.roles) + '</div>' : '') +
        '<div class="item__acts">' +
          '<button class="btn btn--ghost" type="button" data-edit="' + idx + '">Edit</button>' +
          '<button class="btn btn--ghost btn--move" type="button" data-up="' + idx + '" aria-label="Move up">↑</button>' +
          '<button class="btn btn--ghost btn--move" type="button" data-down="' + idx + '" aria-label="Move down">↓</button>' +
          '<button class="btn btn--danger" type="button" data-del="' + idx + '">Remove</button>' +
        '</div>';

      host.appendChild(li);
    });

    $('itemsEmpty').hidden = items.length > 0;
  }

  /* The chart, shown as numbers and letters together. The numbers are what you
     typed; the letters are derived from this Sunday's key, so changing the key
     rewrites the chart for free. */
  function chartHTML(it, compact) {
    if (!it.chords) return '';
    var names = Chords.toNames(it.chords, it.key);
    var showBoth = Chords.hasNumbers(it.chords) && it.key && names !== it.chords;
    return '<div class="chart' + (compact ? ' chart--compact' : '') + '">' +
      '<pre class="chart__nums">' + esc(it.chords) + '</pre>' +
      (showBoth ? '<pre class="chart__names">' + esc(names) + '</pre>' : '') +
    '</div>';
  }

  $('itemList').addEventListener('click', function (e) {
    var s = state.set;
    var btn = e.target.closest('button');
    if (!btn) return;

    var idx;
    if (btn.hasAttribute('data-edit')) {
      idx = +btn.getAttribute('data-edit');
      return isSong(s.items[idx]) ? itemModal(s.items[idx], idx) : elementModal(s.items[idx], idx);
    }
    if (btn.hasAttribute('data-up')) {
      idx = +btn.getAttribute('data-up');
      if (idx === 0) return;
      s.items.splice(idx - 1, 0, s.items.splice(idx, 1)[0]);
      return saveSet();
    }
    if (btn.hasAttribute('data-down')) {
      idx = +btn.getAttribute('data-down');
      if (idx >= s.items.length - 1) return;
      s.items.splice(idx + 1, 0, s.items.splice(idx, 1)[0]);
      return saveSet();
    }
    if (btn.hasAttribute('data-del')) {
      idx = +btn.getAttribute('data-del');
      UI.confirm({
        title: 'Remove from service?',
        message: s.items[idx].title + (isSong(s.items[idx]) ? ' stays in your library.' : ''),
        confirmLabel: 'Remove',
        onConfirm: function () { s.items.splice(idx, 1); saveSet(); }
      });
    }
  });

  function saveSet() {
    return DB.put('setlists', state.set).then(renderEditor);
  }

  /* ---------------- non-song elements ---------------- */
  $('btnAddElement').addEventListener('click', function () { elementModal(null, -1); });

  function elementModal(item, idx) {
    var isNew = idx < 0;
    var it = item || { type: 'element', title: '', kind: 'Welcome', minutes: '5', notes: '', roles: [], performed: false };

    UI.open({
      title: isNew ? 'Add element' : 'Edit element',
      fields: [
        { name: 'kind', label: 'What is it', type: 'select', options: ELEMENT_KINDS, value: it.kind },
        { name: 'title', label: 'Shown on the sheet', type: 'text', value: it.title,
          placeholder: 'e.g. Scripture — Psalm 100' },
        { name: 'minutes', label: 'Minutes', type: 'number', value: it.minutes, inputmode: 'numeric', placeholder: '5' },
        { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, value: it.notes,
          placeholder: 'Pads under the prayer, cut before announcements' },
        { name: 'roles', label: 'Who does what', type: 'roles', options: ROLE_NAMES, value: it.roles || [] }
      ],
      saveLabel: isNew ? 'Add to service' : 'Save',
      onSave: function (v) {
        var rec = isNew ? { id: DB.newId(), type: 'element', performed: false } : it;
        rec.type = 'element';
        rec.kind = v.kind;
        rec.title = v.title || v.kind;
        rec.minutes = v.minutes;
        rec.notes = v.notes;
        rec.roles = v.roles;
        if (isNew) state.set.items.push(rec);
        return DB.put('setlists', state.set).then(renderEditor);
      }
    });
  }

  /* ---------------- songs in a service ---------------- */
  $('btnAddItem').addEventListener('click', function () {
    loadSongs().then(function () { itemModal(null, -1); });
  });

  function songFields(it, opts) {
    opts = opts || {};
    var f = [];

    if (opts.library) {
      f.push({ name: 'lib', label: 'Pull from library', type: 'select', options: opts.library, value: '' });
    }

    f.push(
      { name: 'title', label: 'Song', type: 'text', value: it.title, placeholder: 'Song title' },
      { name: 'artist', label: 'Original / known by', type: 'text', value: it.artist,
        placeholder: 'e.g. Ntokozo Mbambo' },
      { type: 'pair', fields: [
        { name: 'key', label: opts.inService ? 'Key this Sunday' : 'Usual key', type: 'select', options: KEYS, value: it.key },
        { name: 'capo', label: 'Capo', type: 'select', options: CAPOS, value: it.capo }
      ] },
      { type: 'pair', fields: [
        { name: 'meter', label: 'Time signature', type: 'select', options: METERS, value: it.meter },
        { name: 'bpm', label: 'BPM', type: 'number', value: it.bpm, inputmode: 'numeric', placeholder: '72' }
      ] },
      { name: 'minutes', label: 'Minutes (feeds the running time)', type: 'number', value: it.minutes,
        inputmode: 'numeric', placeholder: '5' }
    );

    if (opts.inService) {
      f.push({ name: 'segment', label: 'Where in the service', type: 'select', options: SEGMENTS, value: it.segment });
    }

    f.push(
      { name: 'tone', label: 'Sounds / patches', type: 'text', value: it.tone,
        placeholder: 'Rhodes verse → grand on the bridge, pad under' },
      { name: 'chords', label: 'Chart — Nashville numbers', type: 'textarea', rows: 4, value: it.chords,
        placeholder: '| 1 - 4 | 5 - 6m |\nvamp: 4 5 6m 5\nlast chorus: b7 4 1' },
      { name: 'arrangement', label: 'Arrangement & cues', type: 'textarea', rows: 4, value: it.arrangement,
        placeholder: 'Intro 4 bars · verse ×2 · vamp on IV–V · mod up a semitone on last chorus · tag ×3' },
      { name: 'firstLine', label: 'First line (for the slides)', type: 'text', value: it.firstLine },
      { name: 'refLink', label: 'Reference recording', type: 'url', value: it.refLink,
        placeholder: 'https://…' }
    );

    return f;
  }

  function readSongFields(rec, v) {
    rec.title = v.title;
    rec.artist = v.artist;
    rec.key = v.key;
    rec.capo = v.capo;
    rec.meter = v.meter;
    rec.bpm = v.bpm;
    rec.minutes = v.minutes;
    rec.tone = v.tone;
    rec.chords = v.chords;
    rec.arrangement = v.arrangement;
    rec.firstLine = v.firstLine;
    rec.refLink = v.refLink;
    return rec;
  }

  function itemModal(item, idx) {
    var isNew = idx < 0;
    var it = item || { type: 'song', title: '', artist: '', key: '', capo: '', meter: '', bpm: '',
                       minutes: '5', tone: '', segment: 'Praise', chords: '', arrangement: '',
                       transition: '', firstLine: '', refLink: '', roles: [], performed: false };

    var libOptions = [{ value: '', label: isNew ? '— blank song —' : '— leave as is —' }]
      .concat(state.songs.map(function (s) {
        return { value: s.id, label: s.title + (s.artist ? ' · ' + s.artist : '') };
      }));

    var fields = songFields(it, { library: libOptions, inService: true });

    fields.push(
      { name: 'transition', label: 'Into the next item', type: 'text', value: it.transition,
        placeholder: 'Hold on I, segue straight in' },
      { name: 'roles', label: 'Who does what', type: 'roles', options: ROLE_NAMES, value: it.roles || [] }
    );

    if (isNew) {
      fields.push({ name: 'tolib', label: 'Also save to library', type: 'select',
        options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], value: 'yes' });
    }

    UI.open({
      title: isNew ? 'Add song' : 'Edit song',
      fields: fields,
      saveLabel: isNew ? 'Add to service' : 'Save',
      onOpen: function () {
        // Picking a library song fills the form but leaves everything editable,
        // so this Sunday's key can differ from the song's usual key.
        var lib = document.getElementById('f_lib');
        if (!lib) return;
        lib.addEventListener('change', function () {
          var song = state.songs.find(function (s) { return s.id === lib.value; });
          if (!song) return;
          ['title', 'artist', 'key', 'capo', 'meter', 'bpm', 'minutes', 'tone', 'firstLine', 'refLink']
            .forEach(function (f) {
              var node = document.getElementById('f_' + f);
              if (node) node.value = song[f] || '';
            });
          ['chords', 'arrangement'].forEach(function (f) {
            var node = document.getElementById('f_' + f);
            if (node && !node.value) node.value = song[f] || '';
          });
        });
      },
      onSave: function (v) {
        if (!v.title) { haptic(HAPTIC.warn); UI.toast('Give the song a title'); return false; }

        var rec = isNew ? { id: DB.newId(), type: 'song', performed: false } : it;
        rec.type = 'song';
        rec.songId = v.lib || rec.songId || null;
        readSongFields(rec, v);
        rec.segment = v.segment;
        rec.transition = v.transition;
        rec.roles = v.roles;

        if (isNew) state.set.items.push(rec);

        var chain = DB.put('setlists', state.set);

        if (isNew && v.tolib === 'yes' && !v.lib) {
          chain = chain.then(function () {
            var lib = readSongFields({ id: DB.newId(), createdAt: Date.now() }, v);
            return DB.put('songs', lib);
          }).then(loadSongs);
        }

        return chain.then(renderEditor);
      }
    });
  }

  /* ============================================================
     SONG LIBRARY
     ============================================================ */
  function loadSongs() {
    return DB.all('songs').then(function (rows) {
      rows.sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
      state.songs = rows;
      return rows;
    });
  }

  function renderSongs() {
    var q = state.query.toLowerCase();
    var rows = state.songs.filter(function (s) {
      return !q || (s.title + ' ' + (s.artist || '')).toLowerCase().indexOf(q) > -1;
    });

    var host = $('songList');
    host.innerHTML = '';
    rows.forEach(function (s) {
      var sub = [];
      if (s.artist) sub.push(esc(s.artist));
      if (s.meter) sub.push(esc(s.meter));
      if (s.bpm) sub.push(esc(s.bpm) + ' bpm');
      if (s.minutes) sub.push(esc(s.minutes) + ' min');

      var li = document.createElement('li');
      li.className = 'card';
      li.innerHTML =
        '<button class="card__main" type="button" data-song="' + esc(s.id) + '">' +
          '<div class="card__title">' + esc(s.title) + ' ' + keyChip(s.key) + '</div>' +
          (sub.length ? '<div class="card__sub">' + sub.join(' · ') + '</div>' : '') +
        '</button>' +
        '<div class="card__acts">' +
          '<button class="btn btn--danger" type="button" data-delsong="' + esc(s.id) + '">Delete</button>' +
        '</div>';
      host.appendChild(li);
    });

    $('songsEmpty').hidden = state.songs.length > 0;
  }

  $('songSearch').addEventListener('input', function (e) {
    state.query = e.target.value;
    renderSongs();
  });

  $('btnNewSong').addEventListener('click', function () { songModal(null); });

  $('songList').addEventListener('click', function (e) {
    var open = e.target.closest('[data-song]');
    var del = e.target.closest('[data-delsong]');
    if (open) {
      var s = state.songs.find(function (x) { return x.id === open.getAttribute('data-song'); });
      return songModal(s);
    }
    if (del) {
      var id = del.getAttribute('data-delsong');
      var song = state.songs.find(function (x) { return x.id === id; });
      UI.confirm({
        title: 'Delete from library?',
        message: song.title + '. Services that already use it keep their copy.',
        onConfirm: function () {
          DB.remove('songs', id).then(loadSongs).then(renderSongs).then(function () { UI.toast('Deleted'); });
        }
      });
    }
  });

  function songModal(song) {
    var isNew = !song;
    var s = song || { title: '', artist: '', key: '', capo: '', meter: '', bpm: '', minutes: '',
                      tone: '', chords: '', arrangement: '', firstLine: '', refLink: '' };

    UI.open({
      title: isNew ? 'Add song' : 'Edit song',
      fields: songFields(s, { inService: false }),
      saveLabel: isNew ? 'Add' : 'Save',
      onSave: function (v) {
        if (!v.title) { haptic(HAPTIC.warn); UI.toast('Give the song a title'); return false; }
        var rec = readSongFields(isNew ? { id: DB.newId(), createdAt: Date.now() } : s, v);
        return DB.put('songs', rec).then(loadSongs).then(renderSongs);
      }
    });
  }

  /* ============================================================
     LIVE
     ============================================================ */
  $('btnLive').addEventListener('click', function () {
    if (!(state.set.items || []).length) { UI.toast('Add some songs first'); return; }
    renderLive();
    navTo('live');
  });

  $('btnExitLive').addEventListener('click', function () {
    Metronome.stop();
    state.clickIdx = -1;
    goUp();
  });

  $('btnResetTicks').addEventListener('click', function () {
    UI.confirm({
      title: 'Clear all ticks?',
      message: 'Every item goes back to not done.',
      confirmLabel: 'Clear',
      onConfirm: function () {
        state.set.items.forEach(function (i) { i.performed = false; });
        // starting the run over means the click belongs to nothing
        Metronome.stop();
        state.clickIdx = -1;
        DB.put('setlists', state.set).then(renderLive);
      }
    });
  });

  function renderLive() {
    var items = state.set.items || [];
    var nowIdx = items.findIndex(function (i) { return !i.performed; });
    var done = items.filter(function (i) { return i.performed; }).length;

    $('liveProgress').textContent = done + ' / ' + items.length;
    $('liveEmpty').hidden = items.length > 0;

    var host = $('liveList');
    host.innerHTML = '';

    items.forEach(function (it, idx) {
      var clock = clockFor(items, idx, state.set.startTime);
      var li = document.createElement('li');
      li.className = 'lcard' +
        (isSong(it) ? '' : ' lcard--element') +
        (it.performed ? ' lcard--done' : (idx === nowIdx ? ' lcard--now' : ''));

      var head =
        '<div class="lcard__seg">' +
          '<span class="lcard__clock">' + esc(clock.label) + '</span> · ' +
          (idx + 1) + ' / ' + items.length +
          (isSong(it) && it.segment ? ' · ' + esc(it.segment) : '') +
          (!isSong(it) && it.kind ? ' · ' + esc(it.kind) : '') +
          (idx === nowIdx ? ' · up now' : '') +
        '</div>' +
        '<div class="lcard__title">' + esc(it.title) + '</div>';

      var body;
      if (isSong(it)) {
        var line = [];
        if (it.meter) line.push(esc(it.meter));
        if (it.bpm) line.push(esc(it.bpm) + ' bpm');
        if (it.minutes) line.push(esc(it.minutes) + ' min');
        if (it.capo) line.push(capoLine(it));
        if (it.tone) line.push(esc(it.tone));

        body =
          (it.artist ? '<div class="lcard__artist">' + esc(it.artist) + '</div>' : '') +
          '<span class="lcard__key">' + esc(it.key || '—') + '</span>' +
          '<div class="lcard__keylabel">key</div>' +
          (line.length ? '<div class="lcard__line">' + line.join(' · ') + '</div>' : '') +
          chartHTML(it, false) +
          (it.arrangement ? '<div class="lcard__arr">' + esc(it.arrangement) + '</div>' : '') +
          (it.transition ? '<div class="lcard__line">→ ' + esc(it.transition) + '</div>' : '');
      } else {
        body =
          (it.minutes ? '<div class="lcard__line">' + esc(it.minutes) + ' min</div>' : '') +
          (it.notes ? '<div class="lcard__arr">' + esc(it.notes) + '</div>' : '');
      }

      var running = state.clickIdx === idx;
      var canClick = isSong(it) && it.bpm;

      li.innerHTML = head + body +
        (it.roles && it.roles.length ? '<div class="lcard__roles">' + roleChips(it.roles) + '</div>' : '') +
        (canClick
          ? '<div class="lcard__tools">' +
              '<button class="clickbtn' + (running ? ' is-on' : '') + '" type="button" data-click="' + idx + '">' +
                '<span class="clickbtn__dots" id="beat-' + idx + '">' + beatDots(it) + '</span>' +
                '<span class="clickbtn__label">' + (running ? 'Stop click' : 'Click ' + esc(it.bpm)) + '</span>' +
              '</button>' +
            '</div>'
          : '') +
        '<button class="lcard__tick" type="button" data-tick="' + idx + '">' +
          (it.performed ? 'Undo' : 'Mark as done') + '</button>';

      host.appendChild(li);
    });

    var now = host.querySelector('.lcard--now');
    if (now) now.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  $('liveList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tick]');
    if (!btn) return;
    var idx = +btn.getAttribute('data-tick');
    var it = state.set.items[idx];
    it.performed = !it.performed;
    it.performedAt = it.performed ? Date.now() : null;
    haptic(it.performed ? HAPTIC.done : HAPTIC.undo);

    // the click belongs to the song that was playing; moving on stops it
    if (state.clickIdx === idx) { Metronome.stop(); state.clickIdx = -1; }

    DB.put('setlists', state.set).then(renderLive);
  });

  /* One dot per beat in the bar, so you can see the pulse as well as hear it.
     Useful when the click is in an earpiece and you want to check you set the
     right meter before the band comes in. */
  function beatDots(it) {
    var m = Metronome.parseMeter(it.meter, it.bpm);
    var out = '';
    for (var i = 0; i < m.beatsPerBar; i++) {
      out += '<i class="dot' + (i === 0 ? ' dot--accent' : '') + '"></i>';
    }
    return out;
  }

  $('liveList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-click]');
    if (!btn) return;
    var idx = +btn.getAttribute('data-click');
    var it = state.set.items[idx];

    if (state.clickIdx === idx) {
      Metronome.stop();
      state.clickIdx = -1;
      renderLive();
      return;
    }

    var ok = Metronome.start(it.bpm, it.meter, function (beat) {
      var host = document.getElementById('beat-' + idx);
      if (!host) return;
      var dots = host.querySelectorAll('.dot');
      dots.forEach(function (d, i) { d.classList.toggle('is-lit', i === beat); });
    });

    if (!ok) { UI.toast('This device has no audio support'); return; }
    haptic(HAPTIC.tap);
    state.clickIdx = idx;
    renderLive();
  });

  /* Keep the screen awake during a service. Without this the tablet sleeps
     mid-song and you're unlocking it with one hand on the keys.

     The web Screen Wake Lock API (navigator.wakeLock) is the fallback for
     the browser/PWA install, but it does NOT work inside the packaged
     Android APK: Android's WebView blocks the "screen-wake-lock" feature by
     its default Permissions Policy, so request() rejects with
     NotAllowedError every time, silently, and the screen keeps sleeping.
     That's a WebView platform restriction, not something fixable from CSS
     or JS alone.

     The reliable fix on Android is the native KeepAwake plugin
     (@capacitor-community/keep-awake), which sets the window's
     FLAG_KEEP_SCREEN_ON directly and isn't subject to that WebView policy.
     Once it's installed (npm install @capacitor-community/keep-awake &&
     npx cap sync android — see BUILD_APK.md), Capacitor's native bridge
     exposes it at window.Capacitor.Plugins.KeepAwake automatically; no JS
     import or bundler is needed for that. If the plugin isn't present
     (e.g. running as a plain browser tab/PWA, where window.Capacitor
     doesn't exist), this falls back to the web API. */
  function nativeKeepAwake() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KeepAwake;
  }

  function lockScreen() {
    var native = nativeKeepAwake();
    if (native) { native.keepAwake().catch(function () { /* not worth interrupting for */ }); return; }

    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (l) {
      state.wakeLock = l;
      l.addEventListener('release', function () { state.wakeLock = null; });
    }).catch(function () { /* denied or unsupported — not worth interrupting for */ });
  }

  function releaseScreen() {
    var native = nativeKeepAwake();
    if (native) { native.allowSleep().catch(function () { /* not worth interrupting for */ }); return; }

    if (state.wakeLock) { state.wakeLock.release(); state.wakeLock = null; }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.view === 'live') lockScreen();
  });

  /* ============================================================
     SHEET / PDF
     ============================================================ */
  $('btnSheet').addEventListener('click', function () { renderSheet(); navTo('sheet'); });
  $('btnSheetBack').addEventListener('click', goUp);
  $('btnPrint').addEventListener('click', function () { window.print(); });

  /* Generating a few pages takes a beat on a cheap tablet, so the button says
     so rather than appearing to have missed the tap — which is exactly how the
     old silent window.print() failure read. */
  /* What you are looking at is what gets saved. The pill picks the document;
     these buttons only pick the format. Reaching for the model here rather
     than at bind time means switching pills needs no rewiring. */
  function currentModel() {
    var V = SHEET_VIEWS[state.sheetView] || SHEET_VIEWS.full;
    return V.setlist ? setlistModel() : sheetModel();
  }

  function runExport(btn, job, label) {
    if (btn.disabled) return;
    var original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    // Yield a frame so the label actually paints before we block on layout.
    setTimeout(function () {
      Promise.resolve().then(function () {
        return job(currentModel());
      }).then(function (res) {
        UI.toast(label + ' saved to ' + ((res && res.where) || 'your device'));
        haptic(HAPTIC.done);
      }).catch(function () {
        UI.toast("Couldn't save the " + label + ' — try Print instead');
        haptic(HAPTIC.warn);
      }).then(function () {
        btn.disabled = false;
        btn.innerHTML = original;
      });
    }, 30);
  }

  $('btnPdf').addEventListener('click', function () {
    runExport(this, Exporter.pdf, 'PDF');
  });

  $('btnDocx').addEventListener('click', function () {
    runExport(this, Exporter.docx, 'Word document');
  });

  $('sheetViews').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sv]');
    if (!b) return;
    state.sheetView = b.getAttribute('data-sv');
    document.querySelectorAll('#sheetViews .pill').forEach(function (p) {
      p.classList.toggle('is-active', p === b);
    });
    renderSheet();
  });

  /* The sheet is the only surface anyone else sees. It gets a masthead, a
     left rail carrying the clock and a zero-padded number, and a summary strip
     so the MD can read the harmonic journey of the service in one line. */
  function renderSheet() {
    var s = state.set;
    var items = s.items || [];
    var V = SHEET_VIEWS[state.sheetView] || SHEET_VIEWS.full;

    // A different document, so a different renderer — not this one with most
    // of its branches turned off.
    if (V.setlist) return renderSetlistSheet();

    var total = totalMinutes(items);
    var ends = items.length ? clockFor(items, items.length, s.startTime) : null;
    var songs = items.filter(isSong);

    function rail(clock, idx) {
      return '<div class="srow__rail">' +
        (V.clock ? '<span class="srow__clock">' + esc(clock.label) + '</span>' : '') +
        '<span class="srow__no">' + String(idx + 1).padStart(2, '0') + '</span>' +
      '</div>';
    }

    function roleList(roles) {
      if (!roles || !roles.length || !V.roles) return '';
      return '<dl class="srow__roles">' + roles.map(function (r) {
        return '<div><dt>' + esc(r.role) + '</dt><dd>' + esc(r.person) + '</dd></div>';
      }).join('') + '</dl>';
    }

    var rows = items.map(function (it, idx) {
      var clock = clockFor(items, idx, s.startTime);

      if (!isSong(it)) {
        return '<section class="srow srow--el">' +
          rail(clock, idx) +
          '<div class="srow__main">' +
            '<div class="srow__head">' +
              '<h3 class="srow__title srow__title--el">' + esc(it.title) + '</h3>' +
              (it.minutes ? '<span class="srow__mins">' + esc(it.minutes) + ' min</span>' : '') +
            '</div>' +
            (it.kind ? '<div class="srow__by">' + esc(it.kind) + '</div>' : '') +
            (it.notes && V.arrangement ? '<p class="srow__detail">' + esc(it.notes) + '</p>' : '') +
            roleList(it.roles) +
          '</div>' +
        '</section>';
      }

      var meta = [];
      if (V.meter && it.meter) meta.push(esc(it.meter));
      if (V.bpm && it.bpm) meta.push(esc(it.bpm) + ' bpm');
      if (V.capo && it.capo) meta.push(capoLine(it));
      if (V.tone && it.tone) meta.push(esc(it.tone));

      var by = [];
      if (it.artist) by.push(esc(it.artist));
      if (it.segment) by.push(esc(it.segment));

      var chart = '';
      if (V.chords && it.chords) {
        var names = Chords.toNames(it.chords, it.key);
        var both = V.numbers && Chords.hasNumbers(it.chords) && it.key && names !== it.chords;
        chart = '<div class="srow__chart">' +
          '<pre class="srow__names">' + esc(both ? names : it.chords) + '</pre>' +
          (both ? '<pre class="srow__nums">' + esc(it.chords) + '</pre>' : '') +
        '</div>';
      }

      return '<section class="srow">' +
        rail(clock, idx) +
        '<div class="srow__main">' +
          '<div class="srow__head">' +
            '<h3 class="srow__title">' + esc(it.title) + '</h3>' +
            (it.minutes ? '<span class="srow__mins">' + esc(it.minutes) + ' min</span>' : '') +
            (V.key ? '<span class="srow__key">' + esc(it.key || '—') + '</span>' : '') +
          '</div>' +
          (by.length ? '<div class="srow__by">' + by.join(' · ') + '</div>' : '') +
          (meta.length ? '<div class="srow__meta">' + meta.join(' · ') + '</div>' : '') +
          (V.firstLine && it.firstLine ? '<p class="srow__first">\u201C' + esc(it.firstLine) + '\u2026\u201D</p>' : '') +
          chart +
          (V.arrangement && it.arrangement ? '<p class="srow__detail">' + esc(it.arrangement) + '</p>' : '') +
          (V.transition && it.transition ? '<div class="srow__seg">\u2192 ' + esc(it.transition) + '</div>' : '') +
          roleList(it.roles) +
          (V.ref && it.refLink ? '<div class="srow__ref">' + esc(it.refLink) + '</div>' : '') +
        '</div>' +
      '</section>';
    }).join('');

    /* The key journey. An MD reading one line can see where the service sits
       harmonically and whether the modulations make sense end to end. */
    var journey = songs.map(function (x) { return x.key; }).filter(Boolean);
    var stat = function (value, label) {
      return '<span class="sheet__stat"><b>' + esc(value) + '</b> ' + esc(label) + '</span>';
    };

    $('sheet').innerHTML =
      '<header class="sheet__masthead">' +
        '<img class="sheet__mark" src="resources/mark.svg" alt="" width="46" height="46">' +
        '<div class="sheet__id">' +
          '<div class="sheet__eyebrow">' + esc(fmtDate(s.date)) +
            (s.startTime ? ' \u00B7 starts ' + esc(s.startTime) : '') + '</div>' +
          '<h2>' + esc(s.service || 'Sunday service') + '</h2>' +
        '</div>' +
        '<div class="sheet__for">' + esc(V.label) + '</div>' +
      '</header>' +

      '<div class="sheet__strip">' +
        stat(songs.length, songs.length === 1 ? 'song' : 'songs') +
        stat(items.length, 'items') +
        stat(total, 'min') +
        (ends && ends.isClock ? stat(ends.label, 'finish') : '') +
        (V.key && journey.length
          ? '<span class="sheet__journey">' + journey.map(esc).join(' \u2192 ') + '</span>'
          : '') +
      '</div>' +

      (s.notes ? '<p class="sheet__note">' + esc(s.notes) + '</p>' : '') +
      (rows || '<p class="sheet__note">Nothing in this service yet.</p>') +

      '<footer class="sheet__runner">' +
        esc(s.service || 'Sunday service') + ' \u00B7 ' + esc(fmtDate(s.date)) +
        ' \u00B7 ' + esc(V.label) +
      '</footer>';
  }


  /* The same service, described as data rather than markup, for the PDF and
     Word writers in js/export.js. It runs through the identical SHEET_VIEWS
     filter the on-screen sheet uses, so what you saved is what you were
     looking at — including which pill was selected. Building it from state
     rather than scraping the rendered DOM keeps the documents honest even if
     the sheet markup changes. */
  function sheetModel() {
    var s = state.set;
    var items = s.items || [];
    var V = SHEET_VIEWS[state.sheetView] || SHEET_VIEWS.full;
    var total = totalMinutes(items);
    var ends = items.length ? clockFor(items, items.length, s.startTime) : null;
    var songs = items.filter(isSong);

    var stats = [
      { value: String(songs.length), label: songs.length === 1 ? 'song' : 'songs' },
      { value: String(items.length), label: 'items' },
      { value: String(total), label: 'min' }
    ];
    if (ends && ends.isClock) stats.push({ value: ends.label, label: 'finish' });

    var journey = V.key ? songs.map(function (x) { return x.key; }).filter(Boolean) : [];

    var rows = items.map(function (it, idx) {
      var clock = clockFor(items, idx, s.startTime);
      var row = {
        kind: isSong(it) ? 'song' : 'element',
        clock: V.clock ? clock.label : '',
        no: String(idx + 1).padStart(2, '0'),
        title: it.title || (isSong(it) ? 'Untitled' : 'Element'),
        minutes: it.minutes ? it.minutes + ' min' : '',
        roles: V.roles ? (it.roles || []) : []
      };

      if (!isSong(it)) {
        row.by = it.kind || '';
        row.arrangement = V.arrangement ? (it.notes || '') : '';
        return row;
      }

      var meta = [];
      if (V.meter && it.meter) meta.push(it.meter);
      if (V.bpm && it.bpm) meta.push(it.bpm + ' bpm');
      if (V.capo && it.capo) {
        var shapes = Chords.shapesKey(it.key, it.capo);
        meta.push('capo ' + it.capo + (shapes ? ' \u2192 play ' + shapes : ''));
      }
      if (V.tone && it.tone) meta.push(it.tone);

      var by = [];
      if (it.artist) by.push(it.artist);
      if (it.segment) by.push(it.segment);

      row.key = V.key ? (it.key || '\u2014') : '';
      row.by = by.join(' \u00B7 ');
      row.meta = meta.join(' \u00B7 ');
      row.firstLine = V.firstLine ? (it.firstLine || '') : '';
      row.arrangement = V.arrangement ? (it.arrangement || '') : '';
      row.transition = V.transition ? (it.transition || '') : '';
      row.ref = V.ref ? (it.refLink || '') : '';

      if (V.chords && it.chords) {
        var names = Chords.toNames(it.chords, it.key);
        var both = V.numbers && Chords.hasNumbers(it.chords) && it.key && names !== it.chords;
        row.chart = both ? names : it.chords;
        row.chartAlt = both ? it.chords : '';
      }
      return row;
    });

    var service = s.service || 'Sunday service';
    return {
      title: service,
      viewLabel: V.label,
      eyebrow: fmtDate(s.date) + (s.startTime ? ' \u00B7 starts ' + s.startTime : ''),
      dateSlug: s.date || '',
      docTitle: service + ' \u2014 ' + V.label,
      runner: service + ' \u00B7 ' + fmtDate(s.date) + ' \u00B7 ' + V.label,
      notes: s.notes || '',
      stats: stats,
      journey: journey.join(' \u2192 '),
      rows: rows
    };
  }

  /* The setlist is a different question from the sheet: not "what is in this
     service" but "what are we singing, in what key, and who takes it". So it
     drops the elements entirely and renumbers — the fourth item in the service
     might be the second song, and on this document it is song 2. It also
     ignores the view pills, because a setlist is the same for everybody. */
  function singerFor(item) {
    var roles = item.roles || [];
    var lead = roles.filter(function (r) {
      return /^(lead vocal|leads it)$/i.test(r.role);
    });
    // Nobody marked as leading it: fall back to any other voice on the song
    // rather than printing a blank where a name should be.
    if (!lead.length) {
      lead = roles.filter(function (r) { return /vocal|bgv|sing/i.test(r.role); });
    }
    return lead.filter(function (r) { return r.person; });
  }

  function setlistModel() {
    var s = state.set;
    var picked = (s.items || []).filter(isSong).map(function (it, i) {
      var voices = singerFor(it);
      return {
        no: String(i + 1),
        title: it.title || 'Untitled',
        key: it.key || '',
        singer: voices.map(function (r) { return r.person; }).join(', '),
        roles: voices
      };
    });

    var service = s.service || 'Sunday service';
    return {
      /* The flag the PDF writer branches on. Word doesn't need one: the
         generic table renderer already produces a clean setlist when the rows
         only carry a number, a title, a key and a name. */
      layout: 'setlist',
      title: service,
      viewLabel: 'Setlist',
      eyebrow: fmtDate(s.date) + (s.startTime ? ' \u00B7 starts ' + s.startTime : ''),
      dateSlug: s.date || '',
      docTitle: service + ' \u2014 Setlist',
      runner: service + ' \u00B7 ' + fmtDate(s.date) + ' \u00B7 Setlist',
      notes: '',
      journey: '',
      stats: [{ value: String(picked.length), label: picked.length === 1 ? 'song' : 'songs' }],
      songs: picked,
      rows: picked.map(function (song) {
        return {
          kind: 'song',
          clock: '',
          no: song.no,
          title: song.title,
          key: song.key,
          minutes: '',
          roles: song.roles
        };
      })
    };
  }

  /* Exposed deliberately: the test suite asserts on the exact data the
     documents are built from, and on a support call `SetTheSet.sheetModel()`
     in a console answers "what would this actually print" without saving a
     file to somebody's phone. */
  window.SetTheSet = { sheetModel: sheetModel, setlistModel: setlistModel };

  /* The on-screen setlist. Deliberately the same shape as the PDF the Save
     button produces, so what you check here is what the singers get — the
     whole point of being able to look at it first. */
  function renderSetlistSheet() {
    var s = state.set;
    var model = setlistModel();

    var rows = model.songs.map(function (song) {
      return '<section class="slrow">' +
        '<span class="slrow__no">' + esc(song.no) + '</span>' +
        '<div class="slrow__main">' +
          '<h3 class="slrow__title">' + esc(song.title) + '</h3>' +
          (song.singer ? '<div class="slrow__who">' + esc(song.singer) + '</div>' : '') +
        '</div>' +
        (song.key ? '<span class="slrow__key">' + esc(song.key) + '</span>' : '') +
      '</section>';
    }).join('');

    $('sheet').innerHTML =
      '<header class="sheet__masthead">' +
        '<img class="sheet__mark" src="resources/mark.svg" alt="" width="46" height="46">' +
        '<div class="sheet__id">' +
          '<div class="sheet__eyebrow">' + esc(model.eyebrow) + '</div>' +
          '<h2>' + esc(s.service || 'Sunday service') + '</h2>' +
        '</div>' +
        '<div class="sheet__for">Setlist</div>' +
      '</header>' +

      '<div class="setlist">' +
        (rows || '<p class="sheet__note">No songs in this service yet.</p>') +
      '</div>' +

      '<footer class="sheet__runner">' + esc(model.runner) + '</footer>';
  }


  /* ============================================================
     IMPORT — a written list becomes a service

     Three stages, deliberately separate: get some text (typed, pasted, or
     read off a photo), let the user correct it, then build the service. The
     middle stage is not optional and not skippable. OCR on handwriting is
     good enough to save typing and nowhere near good enough to trust, so the
     value here is in the correction screen, not the camera.
     ============================================================ */
  var importRows = [];

  /* The registered plugin name, not the name of the JS export.
     @capacitor-community/image-to-text registers as 'CapacitorOcr', so
     looking for 'Ocr' finds nothing and the Scan button silently never
     appears — which looks identical to "not installed". The alternatives are
     listed so swapping plugin later needs no change here. */
  function ocrPlugin() {
    var p = (window.Capacitor && window.Capacitor.Plugins) || {};
    return p.CapacitorOcr || p.Ocr || p.TextRecognition || p.MlKitTextRecognition || null;
  }

  function cameraPlugin() {
    var p = (window.Capacitor && window.Capacitor.Plugins) || {};
    return p.Camera || null;
  }

  function filesystemPlugin() {
    var p = (window.Capacitor && window.Capacitor.Plugins) || {};
    return p.Filesystem || null;
  }

  $('btnImport').addEventListener('click', function () {
    var canScan = !!(ocrPlugin() && cameraPlugin());

    UI.open({
      title: 'Build from a written list',
      fields: [
        { name: 'text', label: 'One song per line', type: 'textarea', rows: 8,
          placeholder: '1. Way Maker - Ab - Thandi\n2. Goodness of God (C)\n3. Every Praise / Bb / Musa' }
      ],
      extraHTML:
        (canScan
          ? '<button class="btn btn--ghost btn--block" id="btnScan" type="button">Scan a photo instead</button>'
          : '<p class="hint">Scanning a photo needs the camera build of the app. ' +
            'Typing or pasting the list works the same way from here.</p>') +
        '<p class="hint">Keys and names are optional \u2014 anything already in your ' +
        'song library gets filled in automatically. You can fix everything on the next screen.</p>',
      saveLabel: 'Read the list',
      onOpen: function () {
        var scan = document.getElementById('btnScan');
        if (scan) scan.onclick = function () { scanPhoto(); };
      },
      onSave: function (v) {
        if (!clean(v.text)) { haptic(HAPTIC.warn); UI.toast('Paste or type the list first'); return false; }
        enterReview(v.text);
        return false;   // enterReview already closed the sheet, history and all
      }
    });
  });

  function clean(s) { return String(s == null ? '' : s).trim(); }

  /* The camera path. Both plugins are optional — in a browser, or in an APK
     built before they were added, the button simply never appears rather than
     failing when it is tapped. */
  function scanPhoto() {
    var Camera = cameraPlugin();
    var Ocr = ocrPlugin();
    if (!Camera || !Ocr) { UI.toast('Scanning is not available in this build'); return; }

    UI.toast('Opening the camera…');
    Camera.getPhoto({ quality: 90, resultType: 'uri', source: 'CAMERA', correctOrientation: true })
      .then(function (photo) {
        UI.toast('Reading the page…');
        return recognise(Ocr, photo);
      })
      .then(function (res) {
        var text = ocrText(res);
        if (!clean(text)) {
          haptic(HAPTIC.warn);
          UI.toast('Nothing readable on that photo — try better light');
          return;
        }
        enterReview(text);
      })
      .catch(function () {
        haptic(HAPTIC.warn);
        UI.toast("Couldn't read that photo — type the list instead");
      });
  }

  /* Hand the photo to whichever OCR plugin is installed.

     Two calling conventions are covered because the plugins disagree:
     detectText({filename}) for image-to-text, process({image}) for the
     ML Kit wrappers. If the path cannot be read across the native bridge —
     which depends on where the camera chose to write the file — the photo is
     re-read as bytes and handed over that way instead. Slower and heavier,
     but it is the difference between "scanning doesn't work on my phone" and
     a two-second delay. */
  function recognise(Ocr, photo) {
    var path = photo.path || photo.webPath;

    var first = Ocr.detectText ? Ocr.detectText({ filename: path })
                               : Ocr.process({ image: path });

    return first.catch(function () {
      var FS = filesystemPlugin();
      if (!FS || !photo.path) throw new Error('unreadable');
      return FS.readFile({ path: photo.path }).then(function (file) {
        var data = file.data;
        if (Ocr.detectText) return Ocr.detectText({ base64: data });
        return Ocr.process({ image: 'data:image/jpeg;base64,' + data });
      });
    });
  }

  /* Different OCR plugins hand back different shapes. Take whichever one this
     build happens to have rather than pinning to a single plugin's API. */
  function ocrText(res) {
    if (!res) return '';
    if (typeof res === 'string') return res;
    if (res.text) return res.text;
    if (res.textDetections) {
      return res.textDetections.map(function (d) { return d.text; }).join('\n');
    }
    if (res.blocks) {
      return res.blocks.map(function (b) { return b.text; }).join('\n');
    }
    return '';
  }

  /* Entering the review screen from inside a bottom sheet needs care.

     The obvious version — navTo('import') from onSave, then let the sheet
     close normally — pushes the review screen and then immediately has the
     sheet's own close handler call history.back() to retire ITS entry, which
     swallows the entry the review screen just pushed. Back then still worked
     by luck, but the history said 'sets' while the screen said 'import', and
     the stack was one entry short.

     So the sheet's entry is REPLACED by the review screen's rather than
     stacked on top of it: one screen in, one Back out. */
  function enterReview(text) {
    var rows = SetImport.parse(text, state.songs);

    modalPushed = false;        // we are retiring the sheet's entry ourselves
    UI.closeSilent();
    history.replaceState({ v: 'import' }, '');

    importRows = rows;
    renderImport();
    show('import');
  }

  function renderImport() {
    var host = $('importList');
    var usable = importRows.filter(function (r) { return r.include; });
    var flagged = usable.filter(function (r) { return r.needsKey || r.needsCheck; }).length;

    $('importEmpty').hidden = importRows.length > 0;
    $('importSummary').textContent = importRows.length
      ? usable.length + (usable.length === 1 ? ' item' : ' items') +
        (flagged ? ' \u00B7 ' + flagged + ' to check' : ' \u00B7 all matched')
      : '';

    host.innerHTML = '';

    importRows.forEach(function (row, idx) {
      var li = document.createElement('li');
      li.className = 'item improw' +
        (row.include ? '' : ' improw--out') +
        (row.element ? ' item--element' : '');

      var tag = row.element
        ? '<span class="improw__tag">Element</span>'
        : (row.songId
            ? '<span class="improw__tag improw__tag--ok">In library</span>'
            : '<span class="improw__tag improw__tag--new">New song</span>');

      li.innerHTML =
        '<div class="improw__top">' +
          '<span class="improw__no">' + (idx + 1) + '</span>' +
          tag +
          '<button class="improw__drop" type="button" data-drop="' + idx + '">' +
            (row.include ? 'Skip' : 'Include') + '</button>' +
        '</div>' +

        // The line as it was read, kept visible. When a title is wrong this is
        // the only way to tell what it was meant to say without the paper.
        (row.raw && row.raw !== row.title
          ? '<div class="improw__raw">read: ' + esc(row.raw) + '</div>' : '') +

        '<label class="field">' +
          '<span class="field__label">Title</span>' +
          '<input type="text" data-f="title" data-i="' + idx + '" value="' + esc(row.title) + '">' +
        '</label>' +

        (row.element ? '' :
          '<div class="field__pair">' +
            '<label class="field">' +
              '<span class="field__label' + (row.needsKey ? ' field__label--warn' : '') + '">' +
                'Key' + (row.needsKey ? ' \u2014 not on the paper' : '') + '</span>' +
              '<select data-f="key" data-i="' + idx + '">' + keyOptions(row.key) + '</select>' +
            '</label>' +
            '<label class="field">' +
              '<span class="field__label">Who leads it</span>' +
              '<input type="text" data-f="singer" data-i="' + idx + '" value="' + esc(row.singer) + '">' +
            '</label>' +
          '</div>');

      host.appendChild(li);
    });
  }

  function keyOptions(selected) {
    return KEYS.map(function (k) {
      return '<option value="' + esc(k.value) + '"' +
        (k.value === selected ? ' selected' : '') + '>' + esc(k.label) + '</option>';
    }).join('');
  }

  $('importList').addEventListener('input', function (e) {
    var node = e.target.closest('[data-f]');
    if (!node) return;
    var row = importRows[+node.getAttribute('data-i')];
    var field = node.getAttribute('data-f');
    row[field] = node.value;
    if (field === 'key') row.needsKey = !node.value;
    // Editing a title by hand means it is no longer whatever the camera saw.
    if (field === 'title') { row.songId = null; row.needsCheck = false; }
  });

  $('importList').addEventListener('change', function (e) {
    var node = e.target.closest('select[data-f]');
    if (!node) return;
    var row = importRows[+node.getAttribute('data-i')];
    row.key = node.value;
    row.needsKey = !node.value;
    renderImport();
  });

  $('importList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-drop]');
    if (!btn) return;
    var row = importRows[+btn.getAttribute('data-drop')];
    row.include = !row.include;
    renderImport();
  });

  $('btnImportCancel').addEventListener('click', function () {
    UI.confirm({
      title: 'Discard this list?',
      message: 'Nothing has been saved yet.',
      confirmLabel: 'Discard',
      onConfirm: function () { importRows = []; navTo('sets'); }
    });
  });

  $('btnImportCreate').addEventListener('click', function () {
    var keep = importRows.filter(function (r) { return r.include && clean(r.title); });
    if (!keep.length) { haptic(HAPTIC.warn); UI.toast('Nothing to add'); return; }

    var set = {
      id: DB.newId(),
      date: nextSunday(),
      service: 'Sunday service',
      startTime: '10:00',
      notes: '',
      items: keep.map(function (row) {
        if (row.element) {
          return { id: DB.newId(), type: 'element', kind: 'Other',
                   title: clean(row.title), minutes: '5', notes: '', roles: [], performed: false };
        }

        var lib = row.songId && state.songs.find(function (s) { return s.id === row.songId; });
        var item = {
          id: DB.newId(), type: 'song', songId: row.songId || null,
          title: clean(row.title), key: row.key || '', segment: 'Praise',
          artist: '', capo: '', meter: '', bpm: '', minutes: '5',
          tone: '', chords: '', arrangement: '', transition: '', firstLine: '', refLink: '',
          roles: [], performed: false
        };

        /* A matched song brings last time's work with it — chart, tempo,
           patches. That is the real payoff of the library match: the paper
           only ever had a title and a key on it. */
        if (lib) {
          ['artist', 'capo', 'meter', 'bpm', 'minutes', 'tone', 'chords',
           'arrangement', 'firstLine', 'refLink'].forEach(function (f) {
            item[f] = lib[f] || item[f];
          });
          if (!item.key) item.key = lib.key || '';
        }

        if (clean(row.singer)) {
          item.roles = [{ role: 'Lead vocal', person: clean(row.singer) }];
        }
        return item;
      })
    };

    DB.put('setlists', set)
      .then(loadSets)
      .then(function () {
        importRows = [];
        state.setId = set.id;
        state.set = set;
        renderEditor();
        navTo('editor');
        UI.toast(set.items.length + ' items added — check the details');
        haptic(HAPTIC.done);
      });
  });

  /* ============================================================
     FIRST RUN + HELP
     ============================================================ */
  var HELP_HTML =
    '<div class="help">' +
      '<h3>Numbers, not chord names</h3>' +
      '<p>Type a chart once as <code>| 1 - 6m | 4 - 5 |</code>. The letter names ' +
      'underneath come from that Sunday\u2019s key, so changing the key rewrites ' +
      'the chart for you. Real chord names can be mixed in and pass through ' +
      'untouched.</p>' +

      '<h3>Songs and elements</h3>' +
      '<p>Welcome, scripture, offering and the sermon all take time, so they ' +
      'belong in the running order too. Give the service a start time and every ' +
      'item shows the clock it should begin at \u2014 which is how you spot an ' +
      'overrun before it happens.</p>' +

      '<h3>Five sheets, one order</h3>' +
      '<p>The PDF filters by who it\u2019s for. Band gets the chart but not your ' +
      'patch notes. Media gets timings and first lines and no chart. Print each ' +
      'one separately.</p>' +

      '<h3>Running it</h3>' +
      '<p><strong>Run service</strong> is the Sunday-morning screen: key at ' +
      'display size, one button to tick a song off, screen kept awake. Songs with ' +
      'a BPM get a click \u2014 12/8 is counted in four, the way the band counts it.</p>' +

      '<h3>Back it up</h3>' +
      '<p>Everything lives on this device only. No account, no server \u2014 which ' +
      'is what makes it work with no signal, and why the backup file is your only ' +
      'copy if the tablet dies.</p>' +
    '</div>';

  function helpModal() {
    Sample.has().then(function (has) {
      UI.open({
        title: 'How this works',
        fields: [],
        extraHTML: HELP_HTML +
          (has ? '<button class="btn btn--danger btn--block" id="btnClearSample" type="button">' +
                 'Remove the sample service</button>' : ''),
        saveLabel: 'Got it',
        cancelLabel: 'Close',
        autofocus: false,
        onOpen: function () {
          var b = document.getElementById('btnClearSample');
          if (!b) return;
          b.onclick = function () {
            Sample.clear().then(function () {
              return Promise.all([loadSongs(), loadSets()]);
            }).then(function () {
              renderSets(); renderSongs();
              UI.close();
              UI.toast('Sample removed');
            });
          };
        },
        onSave: function () { return true; }
      });
    });
  }

  $('btnHelp').addEventListener('click', helpModal);

  /* Shown once, on a genuinely empty install. Offering a real service to open
     beats explaining what the buttons do. */
  function firstRun() {
    return DB.flag('welcomed').then(function (seen) {
      if (seen) return;
      if (UI.isOpen()) return;   // never stomp a sheet already on screen

      UI.open({
        title: 'Welcome to SetTheSet',
        fields: [],
        extraHTML:
          '<div class="help">' +
            '<p>Plan a service, run it from the bench, print a sheet for the team. ' +
            'Everything stays on this device and works with no signal.</p>' +
            '<p>Easiest way in is a sample Sunday \u2014 real songs, charts, roles ' +
            'and a running clock, already filled in. Open it, run it, print it, ' +
            'then delete it.</p>' +
          '</div>',
        saveLabel: 'Load a sample Sunday',
        cancelLabel: 'Start empty',
        autofocus: false,
        onCancel: function () { DB.setFlag('welcomed', true); },
        onSave: function () {
          return DB.setFlag('welcomed', true)
            .then(Sample.build)
            .then(function () { return Promise.all([loadSongs(), loadSets()]); })
            .then(function () {
              renderSets();
              renderSongs();
              UI.toast('Sample service added');
            });
        }
      });
    }).catch(function () { /* never block boot on this */ });
  }

  /* ============================================================
     BACKUP
     ============================================================ */
  $('btnBackup').addEventListener('click', function () {
    Promise.all([DB.all('songs'), DB.all('setlists')]).then(function (r) {
      var blob = new Blob([JSON.stringify({ songs: r[0], setlists: r[1], exportedAt: Date.now() }, null, 2)],
                          { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'settheset-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    });
  });

  $('btnRestore').addEventListener('click', function () { $('restoreFile').click(); });

  $('restoreFile').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    file.text().then(function (txt) {
      var data = JSON.parse(txt);
      var jobs = (data.songs || []).map(function (s) { return DB.put('songs', s); })
        .concat((data.setlists || []).map(function (s) { return DB.put('setlists', s); }));
      return Promise.all(jobs);
    }).then(function () {
      return Promise.all([loadSongs(), loadSets()]);
    }).then(function () {
      renderSets(); renderSongs();
      UI.toast('Restored');
    }).catch(function () {
      UI.toast("That file didn't read as a backup");
    });
    e.target.value = '';
  });

  /* ============================================================
     BOOT
     ============================================================ */
  /* Ask a service worker instance which CACHE_VERSION it's running, so the
     update banner can be gated on an actual version change rather than on
     "the script's bytes differ", which fires for whitespace/comment-only
     diffs too and produces a banner with nothing behind it. Resolves null
     if the worker doesn't answer in time rather than hanging forever. */
  /* The whole update policy, in one function.

     A new build reloads the page, which is why it can never be allowed to
     happen while something is in flight. So it waits for all three of: no
     sheet open, no unsaved editor screen, and not running a service. On the
     Sunday-morning screen the app will simply never update — which is
     correct. The swap happens next time you're back on the list, or on the
     next cold start, and nobody is ever asked about it. */
  function applyUpdateIfIdle() {
    if (!pendingWorker) return;
    if (UI.isOpen()) return;
    if (state.view !== 'sets' && state.view !== 'songs') return;

    var worker = pendingWorker;
    pendingWorker = null;
    try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { pendingWorker = worker; }
  }

  function swVersion(worker) {
    return new Promise(function (resolve) {
      if (!worker) { resolve(null); return; }
      var settled = false;
      var done = function (v) { if (!settled) { settled = true; resolve(v); } };
      var ch = new MessageChannel();
      ch.port1.onmessage = function (e) { done(e.data && e.data.version); };
      try { worker.postMessage({ type: 'GET_VERSION' }, [ch.port2]); } catch (e) { done(null); }
      setTimeout(function () { done(null); }, 1500);
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('settheset-sw.js', { updateViaCache: 'none' }).then(function (reg) {
        reg.addEventListener('updatefound', function () {
          var incoming = reg.installing;
          if (!incoming) return;
          incoming.addEventListener('statechange', function () {
            if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
              Promise.all([
                swVersion(incoming),
                swVersion(navigator.serviceWorker.controller)
              ]).then(function (v) {
                var incomingVersion = v[0], currentVersion = v[1];
                // Only act when we can positively confirm the build changed.
                // If both answered and they match, this is a no-op rebuild
                // (e.g. only comments/whitespace changed) — do nothing.
                if (incomingVersion && currentVersion && incomingVersion === currentVersion) return;
                pendingWorker = incoming;
                applyUpdateIfIdle();
              });
            }
          });
        });
      }).catch(function () {
        UI.toast('Offline mode needs HTTPS — this page is not on a secure origin');
      });

      var reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });
    });
  }

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

  history.replaceState({ v: 'sets' }, '');

  Promise.all([loadSongs(), loadSets()]).then(function () {
    renderSongs();
    renderSets();
    show('sets');
    if (!state.sets.length && !state.songs.length) firstRun();
  });
})();
