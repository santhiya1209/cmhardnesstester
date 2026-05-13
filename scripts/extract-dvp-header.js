/*
 * extract-dvp-header.js — dump the full dvpcamera.h source rendered inside
 * dvp.qch back to a plain C header. The Qt help bundle contains a Doxygen
 * "file source" page that re-renders the original header as HTML. We pull
 * that page, strip Doxygen markup, and write the recovered header so we
 * can use it as the authoritative source for native bindings.
 *
 * Output: backend/native/hardness-addon/include/dvpcamera.recovered.h
 */

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const Database = require(
  path.join(__dirname, '..', 'backend', 'node_modules', 'better-sqlite3')
);

const QCH = 'C:\\Program Files (x86)\\Do3Think\\BasedCam3 x64\\dvp.qch';
const OUT = path.join(
  __dirname,
  '..',
  'backend',
  'native',
  'hardness-addon',
  'include',
  'dvpcamera.recovered.h'
);

function tryDecompress(buf) {
  if (!buf) return null;
  const variants = [];
  if (buf.length > 4) variants.push(buf.slice(4));
  variants.push(buf);
  for (const c of variants) {
    try { return zlib.inflateSync(c).toString('utf8'); } catch (_e) {}
    try { return zlib.inflateRawSync(c).toString('utf8'); } catch (_e) {}
    try { return zlib.gunzipSync(c).toString('utf8'); } catch (_e) {}
  }
  return null;
}

function htmlToCSource(html) {
  // Doxygen's "source" view wraps each line of the original .h in a
  // <div class="line">…</div> with syntax-highlighted spans inside. To
  // recover the C code: keep only the line divs, strip every <span>, and
  // resolve HTML entities. Result is the original header text.
  const out = [];
  const lineRe = /<div\s+class="line"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = lineRe.exec(html))) {
    let line = m[1]
      .replace(/<a [^>]*>/g, '')
      .replace(/<\/a>/g, '')
      .replace(/<span [^>]*>/g, '')
      .replace(/<\/span>/g, '')
      .replace(/<[^>]+>/g, '');
    // Decode entities (numeric + named). &#160; is non-breaking space → ' '.
    line = line
      .replace(/&#(\d+);/g, (_x, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_x, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    // Strip Doxygen's leading line-number gutter "  123 " then the NBSP it
    // emits as the first whitespace.
    line = line.replace(/^\s*\d+\s+/, '');
    // Collapse the single leading NBSP-as-space that Doxygen uses for indent.
    out.push(line.replace(/^\s/, ''));
  }
  return out.join('\n');
}

function main() {
  const db = new Database(QCH, { readonly: true, fileMustExist: true });
  const row = db
    .prepare(
      `SELECT d.Data AS data
       FROM FileNameTable f
       JOIN FileDataTable d ON f.FileId = d.Id
       WHERE f.Name LIKE '%dvpcamera_8h_source.html'
       LIMIT 1`
    )
    .get();
  if (!row) {
    console.error('dvpcamera_8h_source.html not found in qch');
    process.exit(2);
  }
  const html = tryDecompress(row.data);
  if (!html) {
    console.error('decompress failed');
    process.exit(3);
  }
  const c = htmlToCSource(html);
  fs.writeFileSync(OUT, c, 'utf8');
  console.log(`Wrote ${OUT} (${c.length} bytes, ${c.split('\n').length} lines)`);
}

main();
