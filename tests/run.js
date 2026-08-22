/* Test runner. `npm test` -> this file -> every *.test.js in tests/.
   The APK workflow runs it as a gate: a red test means no APK is built, which
   is the point. A broken build that installs over a working one is worse than
   no build at all. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();

if (!files.length) {
  console.error('No test files found in tests/ — refusing to pass vacuously.');
  process.exit(1);
}

let failed = 0;
for (const f of files) {
  console.log('\n══ ' + f + ' ══');
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log('\n' + (failed ? failed + ' test file(s) FAILED' : 'all test files passed'));
process.exit(failed ? 1 : 0);
