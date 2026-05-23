#!/usr/bin/env node
// Warn-only check that runtime DLLs are staged for packaging.
//
// Policy (per project rule):
//   - Optional camera SDK / runtime DLLs may legitimately be absent at build
//     time (e.g. a build machine that doesn't have the vendor SDK installed
//     locally; drivers will be added later inside the app package and
//     installed via the NSIS installer's customInstall hook).
//   - Missing optional files therefore produce a clear WARN list and continue
//     the build. The installer still ships; the camera path will report a
//     structured "driver not installed" error at runtime if the DLL is still
//     missing on the target machine.
//   - Hard-fail (exit 1) is reserved for filesystem errors that prevent the
//     check from running at all.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const checks = [
  {
    label: 'OpenCV runtime',
    dir: path.join(root, 'drivers', 'opencv', 'bin'),
    pattern: /^opencv_world.*\.dll$/i,
    hint: 'Drop opencv_world<ver>.dll (e.g. opencv_world4100.dll) into drivers/opencv/bin/.',
  },
  {
    label: 'DVP camera SDK',
    dir: path.join(root, 'drivers', 'DVP2 x64'),
    pattern: /^DVPCamera64\.dll$/i,
    hint: 'Drop DVPCamera64.dll (and its dependencies) into drivers/DVP2 x64/.',
  },
];

const missing = [];
try {
  for (const c of checks) {
    const exists = fs.existsSync(c.dir);
    const files = exists ? fs.readdirSync(c.dir) : [];
    const match = files.find((f) => c.pattern.test(f));
    if (match) {
      console.log(`[driver-check] OK     ${c.label}: ${path.join(c.dir, match)}`);
    } else {
      missing.push(c);
      console.warn(`[driver-check] WARN   ${c.label}: no match in ${c.dir}`);
      console.warn(`[driver-check]        ${c.hint}`);
    }
  }
} catch (err) {
  console.error(`[driver-check] FAIL   filesystem error: ${err.message}`);
  process.exit(1);
}

if (missing.length > 0) {
  console.warn(
    `[driver-check] WARN   ${missing.length} optional runtime DLL group(s) missing. ` +
      'Build will continue — installer ships, and the NSIS customInstall step ' +
      'will skip any per-vendor driver installers that are also missing. The ' +
      'camera will report a clear "driver not installed" error at runtime if ' +
      'the DLLs are still absent on the target machine.'
  );
  console.warn('[driver-check] WARN   Missing groups:');
  for (const m of missing) {
    console.warn(`[driver-check]          - ${m.label} (${m.dir})`);
  }
} else {
  console.log('[driver-check] all runtime DLLs present.');
}
