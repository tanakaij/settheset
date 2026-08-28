/* Derived numbers.
 *
 * Everything here is computed from setlists and songs already on the device —
 * no new storage, no sync, nothing to keep in step. It exists because the app
 * was holding two years of Sundays and telling you nothing about them: which
 * songs the congregation has actually had, which ones have quietly fallen out
 * of rotation, and whether this Sunday's running order is going to overrun
 * before you are standing in front of it.
 *
 * Every warning is stated with the evidence that produced it. A vague "this
 * looks long" is worse than silence; "68 min against a 60 min slot" is
 * something you can act on.
 */
(function (global) {
  'use strict';

  /* Songs are matched to the library by id where one exists, and by a
     normalised title otherwise — a song added straight into a service and
     saved to the library afterwards has no back-link, so title matching is
     what stops those showing as "never played". */
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function isSong(it) { return it && it.type !== 'element'; }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function daysBetween(isoA, isoB) {
    if (!isoA || !isoB) return null;
    var a = isoA.split('-'), b = isoB.split('-');
    var da = Date.UTC(+a[0], +a[1] - 1, +a[2]);
    var db = Date.UTC(+b[0], +b[1] - 1, +b[2]);
    return Math.round((db - da) / 86400000);
  }

  /* ------------------------------------------------------------------
     Song usage
     ------------------------------------------------------------------ */

  /**
   * Builds a usage index across every service, keyed by both songId and
   * normalised title so either kind of link resolves.
   *
   * Only services on or before today count. A song scheduled for next Sunday
   * has not been played yet, and counting it would quietly break the whole
   * point of the rotation view.
   */
  function usageIndex(sets, today) {
    today = today || todayISO();
    var byId = {}, byTitle = {};

    function bump(map, key, set, item) {
      if (!key) return;
      var rec = map[key] || (map[key] = { count: 0, last: null, first: null, keys: [], dates: [] });
      rec.count++;
      rec.dates.push(set.date);
      if (!rec.last || set.date > rec.last) rec.last = set.date;
      if (!rec.first || set.date < rec.first) rec.first = set.date;
      if (item.key && rec.keys.indexOf(item.key) === -1) rec.keys.push(item.key);
    }

    (sets || []).forEach(function (set) {
      if (!set.date || set.date > today) return;
      (set.items || []).filter(isSong).forEach(function (item) {
        bump(byId, item.songId, set, item);
        bump(byTitle, norm(item.title), set, item);
      });
    });

    return { byId: byId, byTitle: byTitle, today: today };
  }

  /** Usage for one library song, or a zeroed record if it has never run. */
  function usageFor(song, index) {
    var rec = (song.id && index.byId[song.id]) || index.byTitle[norm(song.title)] || null;
    if (!rec) return { count: 0, last: null, keys: [], daysSince: null, status: 'new' };

    var days = rec.last ? daysBetween(rec.last, index.today) : null;
    var status;
    if (days == null) status = 'new';
    else if (days <= 27) status = 'recent';       // inside a month — currently in rotation
    else if (days <= 89) status = 'settled';      // still familiar, not overused
    else status = 'resting';                      // a quarter without it: worth reintroducing

    return {
      count: rec.count,
      last: rec.last,
      keys: rec.keys,
      daysSince: days,
      status: status
    };
  }

  /** Short human label for a usage record: "12× · 3 weeks ago". */
  function usageLabel(u) {
    if (!u.count) return 'Not played yet';
    var when;
    var d = u.daysSince;
    if (d == null) when = '';
    else if (d <= 0) when = 'today';
    else if (d === 1) when = 'yesterday';
    else if (d < 14) when = d + ' days ago';
    else if (d < 60) when = Math.round(d / 7) + ' weeks ago';
    else if (d < 365) when = Math.round(d / 30) + ' months ago';
    else when = Math.round(d / 365) + 'y ago';
    return u.count + '× · ' + when;
  }

  /* ------------------------------------------------------------------
     Service health
     ------------------------------------------------------------------ */

  function minutesOf(v) {
    var n = parseInt(v, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }

  function totalMinutes(items) {
    return (items || []).reduce(function (sum, i) { return sum + minutesOf(i.minutes); }, 0);
  }

  /* The root of a key, ignoring the minor suffix — Ab and Abm share a tonal
     centre for the purposes of "three in a row in the same place". */
  function root(k) {
    return String(k || '').replace(/m$/, '');
  }

  /**
   * Checks a running order for the handful of problems that are obvious in
   * hindsight and invisible while you are building it.
   *
   * Returns a list of {level, title, detail}. `level` is 'warn' for things
   * that will bite on the day and 'note' for things worth a look.
   */
  function serviceHealth(set) {
    var items = (set && set.items) || [];
    var songs = items.filter(isSong);
    var total = totalMinutes(items);
    var out = [];

    var target = minutesOf(set && set.targetMinutes);
    if (target && total > target) {
      out.push({
        level: 'warn',
        title: 'Over the slot by ' + (total - target) + ' min',
        detail: total + ' min of material against a ' + target + ' min service. ' +
                'Something has to come out, or come down.'
      });
    } else if (target && total && target - total > 15) {
      out.push({
        level: 'note',
        title: (target - total) + ' min still unfilled',
        detail: total + ' min planned in a ' + target + ' min service.'
      });
    }

    // Untimed items make the running clock a guess rather than a plan.
    var untimed = items.filter(function (i) { return !minutesOf(i.minutes); });
    if (untimed.length) {
      out.push({
        level: untimed.length > 2 ? 'warn' : 'note',
        title: untimed.length + (untimed.length === 1 ? ' item has' : ' items have') + ' no length',
        detail: 'The running clock skips ' +
                untimed.slice(0, 3).map(function (i) { return '"' + i.title + '"'; }).join(', ') +
                (untimed.length > 3 ? ' and others' : '') + ', so the finish time is optimistic.'
      });
    }

    // Songs with no key are the failure that actually shows up on Sunday.
    var keyless = songs.filter(function (i) { return !i.key; });
    if (keyless.length) {
      out.push({
        level: 'warn',
        title: keyless.length + (keyless.length === 1 ? ' song has' : ' songs have') + ' no key',
        detail: keyless.slice(0, 3).map(function (i) { return '"' + i.title + '"'; }).join(', ') +
                (keyless.length > 3 ? ' and others' : '') +
                '. The sheet and the bench both read blank.'
      });
    }

    // Three consecutive songs sharing a tonal centre flattens a set out.
    var run = 1;
    for (var i = 1; i < songs.length; i++) {
      var a = root(songs[i - 1].key), b = root(songs[i].key);
      if (a && b && a === b) {
        run++;
        if (run === 3) {
          out.push({
            level: 'note',
            title: 'Three in a row in ' + a,
            detail: '"' + songs[i - 2].title + '", "' + songs[i - 1].title + '" and "' +
                    songs[i].title + '" all sit in ' + a + '. Fine if it is deliberate; ' +
                    'flat if it is not.'
          });
          break;
        }
      } else {
        run = 1;
      }
    }

    // A service that is nothing but songs usually means the elements were
    // never entered, and the running time is wrong by however long they take.
    if (songs.length >= 4 && songs.length === items.length) {
      out.push({
        level: 'note',
        title: 'No elements in the running order',
        detail: 'Welcome, offering, notices and the sermon all take time. ' +
                'Without them the finish time is only the music.'
      });
    }

    var noBpm = songs.filter(function (i) { return !i.bpm; }).length;
    if (noBpm && noBpm === songs.length && songs.length > 1) {
      out.push({
        level: 'note',
        title: 'No tempos set',
        detail: 'BPM drives the click in Run service. Without it there is no metronome.'
      });
    }

    return {
      total: total,
      target: target,
      songs: songs.length,
      elements: items.length - songs.length,
      keys: songs.map(function (s) { return s.key; }).filter(Boolean),
      done: items.filter(function (i) { return i.performed; }).length,
      items: items.length,
      warnings: out,
      worst: out.some(function (w) { return w.level === 'warn'; }) ? 'warn'
           : (out.length ? 'note' : 'ok')
    };
  }

  /* ------------------------------------------------------------------
     Live drift
     ------------------------------------------------------------------ */

  /**
   * How far off the plan the service is running, right now.
   *
   * The planned clock for the first not-yet-done item is compared against the
   * actual time. This is the number a musical director keeps in their head all
   * morning, and the one thing a paper running order can never tell you.
   *
   * Returns null when there is no start time — with only cumulative offsets
   * there is no wall clock to be late against.
   */
  function drift(set, items, nowDate) {
    if (!set || !set.startTime) return null;
    var parts = String(set.startTime).split(':');
    if (parts.length < 2) return null;

    var now = nowDate || new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var startMin = (+parts[0]) * 60 + (+parts[1]);

    var list = items || (set.items || []);
    var idx = list.findIndex(function (i) { return !i.performed; });
    if (idx < 0) idx = list.length;              // everything done

    var plannedMin = startMin;
    for (var i = 0; i < idx; i++) plannedMin += minutesOf(list[i].minutes);

    // Before the service starts there is nothing to be late for.
    if (nowMin < startMin - 5) {
      return { state: 'before', minutes: startMin - nowMin, label: 'Starts in ' + (startMin - nowMin) + ' min' };
    }

    var diff = nowMin - plannedMin;
    if (Math.abs(diff) <= 2) return { state: 'ontime', minutes: diff, label: 'On time' };
    if (diff > 0) return { state: 'late', minutes: diff, label: diff + ' min behind' };
    return { state: 'early', minutes: -diff, label: (-diff) + ' min ahead' };
  }

  /** Projected finish, given the drift so far. */
  function projectedFinish(set, items, nowDate) {
    if (!set || !set.startTime) return null;
    var d = drift(set, items, nowDate);
    if (!d || d.state === 'before') return null;
    var parts = String(set.startTime).split(':');
    var endMin = (+parts[0]) * 60 + (+parts[1]) + totalMinutes(items || set.items) + d.minutes;
    endMin = ((endMin % 1440) + 1440) % 1440;
    return String(Math.floor(endMin / 60)).padStart(2, '0') + ':' +
           String(endMin % 60).padStart(2, '0');
  }

  /* ------------------------------------------------------------------
     Plain-text setlist — the format that actually reaches the team
     ------------------------------------------------------------------ */

  /**
   * The running order as text you can paste into WhatsApp.
   *
   * A PDF is the right artefact for a music stand and the wrong one for a
   * group chat the night before, where half the team will open it on a phone
   * with no storage left. This is the version that gets read.
   */
  function shareText(set, opts) {
    opts = opts || {};
    var items = (set.items || []);
    var lines = [];
    var title = set.service || 'Sunday service';

    lines.push(title.toUpperCase());
    if (opts.dateLabel) lines.push(opts.dateLabel + (set.startTime ? ' · ' + set.startTime : ''));
    lines.push('');

    var n = 0;
    items.forEach(function (it) {
      if (isSong(it)) {
        n++;
        var bits = [];
        if (it.key) bits.push(it.key);
        if (it.capo) bits.push('capo ' + it.capo);
        if (it.bpm) bits.push(it.bpm + 'bpm');
        var who = (it.roles || []).filter(function (r) {
          return /lead/i.test(r.role) && r.person;
        }).map(function (r) { return r.person; })[0];
        lines.push(n + '. ' + it.title + (bits.length ? '  [' + bits.join(' · ') + ']' : ''));
        if (who) lines.push('   led by ' + who);
      } else {
        lines.push('   — ' + it.title + (it.minutes ? ' (' + it.minutes + ' min)' : ''));
      }
    });

    var total = totalMinutes(items);
    if (total) {
      lines.push('');
      lines.push('Running time ' + Math.floor(total / 60) + 'h ' + (total % 60) + 'm');
    }
    if (set.notes) {
      lines.push('');
      lines.push(set.notes);
    }
    return lines.join('\n');
  }

  global.Insights = {
    norm: norm,
    todayISO: todayISO,
    daysBetween: daysBetween,
    usageIndex: usageIndex,
    usageFor: usageFor,
    usageLabel: usageLabel,
    totalMinutes: totalMinutes,
    serviceHealth: serviceHealth,
    drift: drift,
    projectedFinish: projectedFinish,
    shareText: shareText
  };
})(window);
