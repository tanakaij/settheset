/* Metronome meter parsing. The timing itself needs a real AudioContext, but
   the meter maths is where the bugs live -- particularly compound time, which
   a naive implementation clicks as twelve even eighths instead of four
   dotted-quarter pulses. */
global.window = {};
require('../js/metronome.js');
const M = global.window.Metronome;

let pass = 0, fail = 0;
const check = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};
const close = (a, b) => Math.abs(a - b) < 1e-9;

console.log('\n— simple meters —');
let r = M.parseMeter('4/4', 120);
check('4/4 has 4 beats', r.beatsPerBar === 4);
check('4/4 at 120 is half a second a beat', close(r.secondsPerBeat, 0.5));

r = M.parseMeter('3/4', 90);
check('3/4 has 3 beats', r.beatsPerBar === 3);

r = M.parseMeter('2/4', 100);
check('2/4 has 2 beats', r.beatsPerBar === 2);

console.log('\n— compound meters click the dotted-quarter pulse —');
r = M.parseMeter('12/8', 60);
check('12/8 is 4 pulses, not 12', r.beatsPerBar === 4);
check('12/8 pulse is a dotted quarter', close(r.secondsPerBeat, 1.5));

r = M.parseMeter('6/8', 60);
check('6/8 is 2 pulses, not 6', r.beatsPerBar === 2);
check('6/8 pulse is a dotted quarter', close(r.secondsPerBeat, 1.5));

r = M.parseMeter('9/8', 60);
check('9/8 is 3 pulses', r.beatsPerBar === 3);

console.log('\n— simple eighth meters stay in eighths —');
r = M.parseMeter('5/8', 120);
check('5/8 has 5 beats', r.beatsPerBar === 5);
check('5/8 counts eighths', close(r.secondsPerBeat, 0.25));

console.log('\n— cut time —');
r = M.parseMeter('cut time', 120);
check('cut time has 2 beats', r.beatsPerBar === 2);
check('cut time counts half notes', close(r.secondsPerBeat, 1));

console.log('\n— half-note meters —');
r = M.parseMeter('6/4', 120);
check('6/4 has 6 beats', r.beatsPerBar === 6);

console.log('\n— missing or junk input still gives something usable —');
r = M.parseMeter('', 100);
check('no meter falls back to 4', r.beatsPerBar === 4);
r = M.parseMeter(null, null);
check('no bpm falls back to 90', r.bpm === 90);
r = M.parseMeter('banana', 80);
check('junk meter falls back to 4', r.beatsPerBar === 4);

console.log('\n— tempo is clamped to something playable —');
check('absurdly fast is capped', M.parseMeter('4/4', 9999).bpm === 300);
check('absurdly slow is floored', M.parseMeter('4/4', 1).bpm === 20);
check('bar length is capped', M.parseMeter('64/4', 100).beatsPerBar === 16);

console.log('\n— not running before it is started —');
check('starts stopped', M.isRunning() === false);
M.stop();
check('stop on a stopped metronome is safe', M.isRunning() === false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
