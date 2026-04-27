#!/usr/bin/env node
/*
 * Launches Electron in dev with NODE_OPTIONS set so N-API callback throws
 * become real errors instead of the generic DEP0168 deprecation warning.
 * Cross-shell (no PowerShell/bash-specific env syntax in package.json).
 */
const { spawn } = require('child_process');
const path = require('path');

const electronBin = require('electron');

const env = {
  ...process.env,
  NODE_OPTIONS: [
    process.env.NODE_OPTIONS || '',
    '--force-node-api-uncaught-exceptions-policy=true',
  ]
    .filter(Boolean)
    .join(' '),
};

const child = spawn(electronBin, [path.resolve(__dirname, '..')], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
