/*
 * extract-dvp-signatures.js — pulls function signatures from dvp.qch.
 *
 * dvp.qch is the Qt Help file shipped with Do3Think's BasedCam3 viewer. It
 * is a SQLite database whose `FileDataTable.Data` column contains zlib-
 * compressed HTML pages of the API reference. We open it, locate pages
 * matching the function names we care about, decompress the HTML, and
 * print the surrounding signature text so we can write accurate native
 * bindings without guessing parameter types.
 *
 * Run: node scripts/extract-dvp-signatures.js
 */

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const Database = require(
  path.join(__dirname, '..', 'backend', 'node_modules', 'better-sqlite3')
);

const QCH_PATH = 'C:\\Program Files (x86)\\Do3Think\\BasedCam3 x64\\dvp.qch';

const WANTED_NAMES = [
  'dvpSetRoi',
  'dvpGetRoiDescr',
  'dvpSetRoiState',
  'dvpSetTargetFormat',
  'dvpSetTargetFormatSel',
  'dvpGetTargetFormat',
  'dvpGetTargetFormatSel',
  'dvpSetSourceFormat',
  'dvpSetSourceFormatSel',
  'dvpSetResolutionModeSel',
  'dvpGetResolutionModeSel',
  'dvpSetQuickRoiSel',
  'dvpGetQuickRoiSel',
  'dvpSetMonoState',
  'dvpGetMonoState',
  'dvpSetPixelRateSel',
  'dvpRegisterStreamCallback',
];

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tryDecompress(buf) {
  if (!buf) return null;
  // Qt help stores file data as zlib-deflated with a 4-byte BE length prefix.
  // Try with prefix-stripped first, then raw; fall back to identity if both fail.
  const variants = [];
  if (buf.length > 4) variants.push(buf.slice(4));
  variants.push(buf);
  for (const candidate of variants) {
    try {
      return zlib.inflateSync(candidate).toString('utf8');
    } catch (_e) {}
    try {
      return zlib.inflateRawSync(candidate).toString('utf8');
    } catch (_e) {}
    try {
      return zlib.gunzipSync(candidate).toString('utf8');
    } catch (_e) {}
  }
  // Maybe already plain text
  try {
    const s = buf.toString('utf8');
    if (s.includes('<html') || s.includes('dvp')) return s;
  } catch (_e) {}
  return null;
}

function main() {
  if (!fs.existsSync(QCH_PATH)) {
    console.error('dvp.qch not found at', QCH_PATH);
    process.exit(1);
  }
  const db = new Database(QCH_PATH, { readonly: true, fileMustExist: true });

  // List tables for reference.
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  console.log('Tables:', tables.join(', '));

  // Qt help schema (verified against the Qt docs): FileNameTable joins
  // FileDataTable via Id. FolderTable + NamespaceTable scope it. Names
  // ending in .html / .htm are the doc pages.
  const fileTbl = tables.find((t) => /FileName/i.test(t));
  const dataTbl = tables.find((t) => /FileData/i.test(t));
  if (!fileTbl || !dataTbl) {
    console.error('Unexpected qch schema; tables are:', tables);
    process.exit(2);
  }

  const fileNameCols = db.prepare(`PRAGMA table_info("${fileTbl}")`).all().map((r) => r.name);
  const dataCols = db.prepare(`PRAGMA table_info("${dataTbl}")`).all().map((r) => r.name);
  console.log(fileTbl, 'cols:', fileNameCols.join(', '));
  console.log(dataTbl, 'cols:', dataCols.join(', '));

  // Join FileNameTable (Name, FileId) with FileDataTable (Id, Data) — column
  // names vary slightly across Qt versions. Find the right pair.
  const nameIdCol = fileNameCols.find((c) => /FileId/i.test(c)) || fileNameCols.find((c) => /Id$/i.test(c));
  const nameCol = fileNameCols.find((c) => /Name$/i.test(c));
  const dataIdCol = dataCols.find((c) => /^Id$/i.test(c)) || dataCols[0];
  const dataDataCol = dataCols.find((c) => /Data/i.test(c));

  console.log(`Join: ${fileTbl}.${nameIdCol} = ${dataTbl}.${dataIdCol}; name=${nameCol}, data=${dataDataCol}`);

  // Pull all rows with Title too — Qt help uses Title for the page heading
  // which is often the function name itself.
  const hasTitle = fileNameCols.includes('Title');
  const selectCols = hasTitle
    ? `f."${nameCol}" AS name, f."Title" AS title, d."${dataDataCol}" AS data`
    : `f."${nameCol}" AS name, NULL AS title, d."${dataDataCol}" AS data`;
  const rows = db
    .prepare(
      `SELECT ${selectCols}
       FROM "${fileTbl}" f
       JOIN "${dataTbl}" d ON f."${nameIdCol}" = d."${dataIdCol}"`
    )
    .all();

  console.log(`Total file rows: ${rows.length}`);
  console.log('Sample file names / titles:');
  rows.slice(0, 15).forEach((r) => console.log(`  ${r.name}  |  ${r.title}`));

  const seenForFn = new Map();
  for (const row of rows) {
    const html = tryDecompress(row.data);
    if (!html) continue;
    for (const fn of WANTED_NAMES) {
      const idx = html.indexOf(fn + '(');
      if (idx === -1) continue;
      const ctx = html.slice(Math.max(0, idx - 60), idx + 400);
      const text = stripHtml(ctx);
      const sigMatch = text.match(new RegExp(`(dvpStatus\\s+)?${fn}\\s*\\([^)]*\\)`));
      const sig = sigMatch ? sigMatch[0] : text.slice(0, 300);
      if (!seenForFn.has(fn)) {
        seenForFn.set(fn, []);
      }
      seenForFn.get(fn).push({ file: row.name, sig, contextSample: text.slice(0, 220) });
    }
  }

  console.log('\n=== Signatures extracted from dvp.qch ===\n');
  for (const fn of WANTED_NAMES) {
    const found = seenForFn.get(fn);
    if (!found || !found.length) {
      console.log(`${fn}: NOT FOUND`);
      continue;
    }
    // Best hit = the one whose extracted sig is shortest and starts with `dvpStatus`
    const best =
      found.find((x) => /^dvpStatus/.test(x.sig)) ||
      found.find((x) => x.sig.startsWith(fn)) ||
      found[0];
    console.log(`${fn}:`);
    console.log(`  file:  ${best.file}`);
    console.log(`  sig:   ${best.sig}`);
    console.log(`  ctx:   ${best.contextSample}`);
    console.log('');
  }
}

main();
