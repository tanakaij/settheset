/* Onboarding.
 *
 * Two beliefs shaped this:
 *
 * 1. A tour that points at buttons teaches nothing. A filled-in service you can
 *    open, run, and print teaches everything in about thirty seconds — you see
 *    a chart transposing, a running clock, an element among the songs, and five
 *    PDF views, all with real content.
 *
 * 2. Sample data you cannot get rid of is worse than no sample data. Every
 *    record it creates is tagged `sample: true`, and Help offers one tap to
 *    remove all of it without touching anything real.
 */
(function (global) {
  'use strict';

  /* A believable Sunday: two praise songs, a scripture reading between, a
     worship song with a modulation, and an altar call. Keys chosen so the
     journey line reads sensibly. */
  function sampleSongs() {
    return [
      {
        title: 'Every Praise', artist: 'Hezekiah Walker', key: 'Bb', meter: '4/4',
        bpm: '132', minutes: '6', capo: '', tone: 'Bright organ, no pad',
        chords: '| 1 - 4 | 5 - 1 |\nturnaround: 6m 4 5',
        arrangement: 'Straight in, no intro\nCall and response ×3\nHold the last 1 while he greets',
        firstLine: 'Every praise is to our God',
        refLink: ''
      },
      {
        title: 'Way Maker', artist: 'Sinach', key: 'Ab', meter: '12/8',
        bpm: '72', minutes: '7', capo: '1', tone: 'Rhodes verse, grand from the chorus',
        chords: '| 1 - 6m | 4 - 5 |\nvamp: 4 5 6m 5',
        arrangement: 'Intro 4 bars\nVerse ×2, drop the band on the second\nVamp on 4-5 until she calls it\nUp a semitone for the last chorus',
        firstLine: 'You are here, moving in our midst',
        refLink: ''
      },
      {
        title: 'Total Praise', artist: 'Richard Smallwood', key: 'Eb', meter: '12/8',
        bpm: '66', minutes: '8', capo: '', tone: 'Strings pad, organ swell on the amen',
        chords: '| 1 - 4 | 1/3 - 5 |\namen: 4 5 1',
        arrangement: 'Rubato intro, watch me\nBuild through the amens\nLast amen a cappella, band back in on the 1',
        firstLine: 'Lord, I will lift mine eyes to the hills',
        refLink: ''
      }
    ];
  }

  function nextSundayISO() {
    var d = new Date();
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function build() {
    var songs = sampleSongs().map(function (s) {
      s.id = DB.newId();
      s.sample = true;
      s.createdAt = Date.now();
      return s;
    });

    function item(song, segment, roles, transition) {
      var copy = JSON.parse(JSON.stringify(song));
      copy.id = DB.newId();
      copy.type = 'song';
      copy.songId = song.id;
      copy.segment = segment;
      copy.roles = roles;
      copy.transition = transition || '';
      copy.performed = false;
      copy.sample = true;
      return copy;
    }

    var setlist = {
      id: DB.newId(),
      sample: true,
      date: nextSundayISO(),
      startTime: '10:00',
      service: 'Sample service',
      notes: 'This one is a sample so you have something to poke at. Delete it whenever.',
      createdAt: Date.now(),
      items: [
        item(songs[0], 'Praise', [
          { role: 'Lead vocal', person: 'Thandi' },
          { role: 'Drums', person: 'Kabelo' },
          { role: 'Bass', person: 'Musa' }
        ], 'Straight into the next one, hold on the 1'),

        item(songs[1], 'Worship', [
          { role: 'Lead vocal', person: 'Naledi' },
          { role: 'BGVs', person: 'Sipho + Lerato' }
        ], 'Pads hold underneath'),

        {
          id: DB.newId(), type: 'element', sample: true,
          kind: 'Scripture reading', title: 'Scripture — Psalm 100',
          minutes: '4', notes: 'Pads underneath. Cut before the announcements.',
          roles: [{ role: 'Leads it', person: 'Pastor M' }], performed: false
        },

        item(songs[2], 'Altar call', [
          { role: 'MD cue', person: 'me' },
          { role: 'Organ', person: 'Bra Joe' }
        ], '')
      ]
    };

    var jobs = songs.map(function (s) { return DB.put('songs', s); });
    jobs.push(DB.put('setlists', setlist));
    return Promise.all(jobs).then(function () { return setlist.id; });
  }

  /* Remove everything tagged sample, and nothing else. */
  function clear() {
    return Promise.all([DB.all('songs'), DB.all('setlists')]).then(function (r) {
      var jobs = r[0].filter(function (x) { return x.sample; })
          .map(function (x) { return DB.remove('songs', x.id); })
        .concat(r[1].filter(function (x) { return x.sample; })
          .map(function (x) { return DB.remove('setlists', x.id); }));
      return Promise.all(jobs).then(function () { return jobs.length; });
    });
  }

  function hasSample() {
    return Promise.all([DB.all('songs'), DB.all('setlists')]).then(function (r) {
      return r[0].concat(r[1]).some(function (x) { return x.sample; });
    });
  }

  global.Sample = { build: build, clear: clear, has: hasSample };
})(window);
