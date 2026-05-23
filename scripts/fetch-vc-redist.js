#!/usr/bin/env node
/*
 * fetch-vc-redist.js
 *
 * Downloads the Microsoft VC++ 2015-2022 x64 redistributable installer into
 * drivers/redist/vc_redist.x64.exe so the NSIS installer (build/installer.nsh)
 * can chain it during install. Idempotent: skips the download when the cached
 * copy already exists. Runs as a pre-step before `npm run make`.
 *
 * The redist binary is gitignored; we re-fetch it on each CI / fresh-clone
 * machine instead of carrying 25 MB in git.
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
const REDIST_DIR = path.resolve(__dirname, '..', 'drivers', 'redist');
const OUT_PATH = path.join(REDIST_DIR, 'vc_redist.x64.exe');
// Minimum plausible size for the redist (~14 MB). A truncated download will
// be smaller; we refuse to use it.
const MIN_BYTES = 10 * 1024 * 1024;

function follow(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) {
      reject(new Error(`too many redirects fetching ${url}`));
      return;
    }
    https
      .get(url, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          follow(res.headers.location, depth + 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status} fetching ${url}`));
          return;
        }
        resolve(res);
      })
      .on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(OUT_PATH)) {
    const { size } = fs.statSync(OUT_PATH);
    if (size >= MIN_BYTES) {
      // eslint-disable-next-line no-console
      console.log(
        `[fetch-vc-redist] cached at ${OUT_PATH} (${(size / 1024 / 1024).toFixed(1)} MB) — skipping download`
      );
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(`[fetch-vc-redist] cached file is too small (${size} bytes) — re-downloading`);
    fs.unlinkSync(OUT_PATH);
  }

  fs.mkdirSync(REDIST_DIR, { recursive: true });

  // eslint-disable-next-line no-console
  console.log(`[fetch-vc-redist] downloading ${URL}`);
  const res = await follow(URL);
  const tmpPath = `${OUT_PATH}.partial`;
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmpPath);
    res.pipe(file);
    file.on('finish', () => file.close(resolve));
    file.on('error', reject);
    res.on('error', reject);
  });

  const { size } = fs.statSync(tmpPath);
  if (size < MIN_BYTES) {
    fs.unlinkSync(tmpPath);
    throw new Error(
      `[fetch-vc-redist] downloaded file too small (${size} bytes) — Microsoft URL may have changed`
    );
  }
  fs.renameSync(tmpPath, OUT_PATH);
  // eslint-disable-next-line no-console
  console.log(`[fetch-vc-redist] saved ${OUT_PATH} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[fetch-vc-redist] failed: ${err.message}`);
  process.exit(1);
});
