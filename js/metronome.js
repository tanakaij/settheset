/* Metronome.
 *
 * Every song already carries a BPM and a time signature and the app did
 * nothing with them. This clicks.
 *
 * TIMING
 * ------
 * setInterval is not accurate enough to click to. It drifts, and it stalls
 * outright when the tab is backgrounded or the phone throttles. So this uses
 * the standard lookahead pattern: a coarse timer wakes up every 25ms and
 * schedules any beats falling inside the next 100ms directly on the
 * AudioContext clock, which runs on the audio thread and does not drift. The
 * timer only has to be roughly on time; the scheduled beats are exact.
 *
 * METER
 * -----
 * Gospel lives in 12/8 as much as 4/4, and a 12/8 shuffle clicked as twelve
 * even eighths is useless. Compound meters are clicked in dotted-quarter
 * groups — 12/8 gives four pulses per bar, 6/8 gives two — with the first
 * accented. That is how the band counts it.
 */
(function (global) {
  'use strict';

  var LOOKAHEAD_MS = 25;      // how often the scheduler wakes
  var SCHEDULE_AHEAD = 0.1;   // how far ahead it schedules, in seconds

  var ctx = null;
  var timer = null;
  var nextNoteTime = 0;
  var beat = 0;
  var settings = { bpm: 90, beatsPerBar: 4, secondsPerBeat: 0.5 };
  var onBeat = null;

  /* Beats per bar and what a "beat" is, from a time signature string.
     Compound meters click the dotted-quarter pulse, not every eighth. */
  function parseMeter(meter, bpm) {
    var beatsPerBar = 4;
    var multiplier = 1;         // relative to a quarter note at the given BPM

    var m = /^(\d+)\s*\/\s*(\d+)$/.exec((meter || '').trim());

    if (/cut/i.test(meter || '')) {
      beatsPerBar = 2;
      multiplier = 2;           // half notes
    } else if (m) {
      var top = parseInt(m[1], 10);
      var bottom = parseInt(m[2], 10);

      if (bottom === 8 && top % 3 === 0 && top > 3) {
        // compound: 6/8, 9/8, 12/8 -> click the dotted quarters
        beatsPerBar = top / 3;
        multiplier = 1.5;
      } else if (bottom === 8) {
        beatsPerBar = top;
        multiplier = 0.5;
      } else if (bottom === 2) {
        beatsPerBar = top;
        multiplier = 2;
      } else {
        beatsPerBar = top;
        multiplier = 1;
      }
    }

    var safeBpm = Math.min(300, Math.max(20, parseInt(bpm, 10) || 90));
    return {
      bpm: safeBpm,
      beatsPerBar: Math.min(16, Math.max(1, beatsPerBar)),
      secondsPerBeat: (60 / safeBpm) * multiplier
    };
  }

  function click(time, accent) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();

    // A short pitched blip rather than a sample: nothing to download, nothing
    // to cache, and it cuts through a band better than a soft tick.
    osc.frequency.value = accent ? 1600 : 1000;
    osc.type = 'square';

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.28, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  function scheduler() {
    while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
      var thisBeat = beat;
      var when = nextNoteTime;
      click(when, thisBeat === 0);

      if (onBeat) {
        // Fire the visual pulse when the sound actually lands, not when it
        // was scheduled — otherwise the flash runs ahead of the click.
        var delay = Math.max(0, (when - ctx.currentTime) * 1000);
        setTimeout(function () {
          if (timer) onBeat(thisBeat, settings.beatsPerBar);
        }, delay);
      }

      nextNoteTime += settings.secondsPerBeat;
      beat = (beat + 1) % settings.beatsPerBar;
    }
  }

  function start(bpm, meter, beatCallback) {
    stop();

    // Must be created inside a user gesture or mobile browsers keep it
    // suspended and nothing is heard.
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();

    settings = parseMeter(meter, bpm);
    onBeat = beatCallback || null;
    beat = 0;
    nextNoteTime = ctx.currentTime + 0.06;

    timer = setInterval(scheduler, LOOKAHEAD_MS);
    scheduler();
    return true;
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    onBeat = null;
    beat = 0;
  }

  global.Metronome = {
    start: start,
    stop: stop,
    isRunning: function () { return !!timer; },
    parseMeter: parseMeter,
    settings: function () { return settings; }
  };
})(window);
