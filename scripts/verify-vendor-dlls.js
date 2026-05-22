#!/usr/bin/env node
// Warn-only check that runtime DLLs are staged for packaging.
// Missing files do NOT fail the build — the installer still produces a valid
// exe; the camera path just won't work on target machines without the DLLs.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const checks = [
  {
    label: 'OpenCV runtime',
    dir: path.join(root, 'vendor', 'opencv', 'bin'),
    pattern: /^opencv_world.*\.dll$/i,
    hint: 'Drop opencv_world<ver>.dll (e.g. opencv_world4100.dll) into vendor/opencv/bin/.',
  },
  {
    label: 'DVP camera SDK',
    dir: path.join(root, 'vendor', 'camera-sdk'),
    pattern: /^DVPCamera64\.dll$/i,
    hint: 'Drop DVPCamera64.dll (and its dependencies) into vendor/camera-sdk/.',
  },
];

let missing = 0;
for (const c of checks) {
  const exists = fs.existsSync(c.dir);
  const files = exists ? fs.readdirSync(c.dir) : [];
  const match = files.find((f) => c.pattern.test(f));
  if (match) {
    console.log(`[verify-vendor-dlls] OK     ${c.label}: ${path.join(c.dir, match)}`);
  } else {
    missing++;
    console.warn(`[verify-vendor-dlls] WARN   ${c.label}: no match in ${c.dir}`);
    console.warn(`[verify-vendor-dlls]        ${c.hint}`);
  }
}

if (missing > 0) {
  console.warn(
    `[verify-vendor-dlls] ${missing} runtime dependency group(s) missing. ` +
      'Continuing build; installer will still be generated but the camera ' +
      'pipeline will fail at runtime on machines that lack these DLLs.'
  );
} else {
  console.log('[verify-vendor-dlls] all runtime DLLs present.');
}
// Exit 0 always — warning is the contract.
process.exit(0);
