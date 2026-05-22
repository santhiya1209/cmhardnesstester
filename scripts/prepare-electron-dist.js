#!/usr/bin/env node
// Stage the Electron Windows runtime locally for electron-builder.
//
// electron-builder downloads the Electron binary from GitHub at package time.
// On networks that can't reach github.com that fails (ERR_ELECTRON_BUILDER_CANNOT_EXECUTE).
// The Forge pipeline / @electron/get already cache the same zip under
// %LOCALAPPDATA%\electron\Cache\<sha>\electron-v<ver>-win32-x64.zip — reuse it.
//
// The extracted folder is referenced via `electronDist:` in electron-builder.yml,
// so electron-builder consumes it directly instead of downloading.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const electronVersion = require(path.join(__dirname, '..', 'node_modules', 'electron', 'package.json')).version;
const arch = 'x64';
const platform = 'win32';
const zipName = `electron-v${electronVersion}-${platform}-${arch}.zip`;

const repoRoot = path.resolve(__dirname, '..');
const targetDir = path.join(repoRoot, '.electron-dist', `${platform.replace('32', '')}-${arch}-${electronVersion}`);

if (fs.existsSync(path.join(targetDir, 'electron.exe'))) {
  console.log(`[prepare-electron-dist] already staged: ${targetDir}`);
  process.exit(0);
}

const cacheRoot = path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache');
if (!fs.existsSync(cacheRoot)) {
  console.error(`[prepare-electron-dist] no @electron/get cache at ${cacheRoot}`);
  console.error('[prepare-electron-dist] run `npx electron --version` once to populate it, then retry.');
  process.exit(1);
}

let foundZip = null;
for (const sub of fs.readdirSync(cacheRoot)) {
  const candidate = path.join(cacheRoot, sub, zipName);
  if (fs.existsSync(candidate)) { foundZip = candidate; break; }
}

if (!foundZip) {
  console.error(`[prepare-electron-dist] ${zipName} not found under ${cacheRoot}`);
  console.error('[prepare-electron-dist] download it manually or run `npx electron --version` once with network access.');
  process.exit(1);
}

console.log(`[prepare-electron-dist] extracting ${foundZip}`);
console.log(`[prepare-electron-dist]   -> ${targetDir}`);
fs.mkdirSync(targetDir, { recursive: true });
execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', `Expand-Archive -Path '${foundZip}' -DestinationPath '${targetDir}' -Force`],
  { stdio: 'inherit' }
);
console.log('[prepare-electron-dist] done.');
