import fs from 'node:fs';
import { getDb, getDatabaseFilePath } from '../lib/sqlite';

function main(): void {
  const filePath = getDatabaseFilePath();
  // eslint-disable-next-line no-console
  console.log(`DB path:    ${filePath}`);

  if (!fs.existsSync(filePath)) {
    // Opening will create it; let getDb handle migration/seed.
    // eslint-disable-next-line no-console
    console.log('DB file:    (does not exist yet — opening will create it)');
  } else {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    try {
      fs.readSync(fd, buf, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
    const expected = Buffer.concat([Buffer.from('SQLite format 3'), Buffer.from([0])]);
    const header = buf.toString('utf8', 0, 15); // printable portion only
    // eslint-disable-next-line no-console
    console.log(`DB header:  "${header}" (+0x00)`);
    // eslint-disable-next-line no-console
    console.log(`DB header valid: ${buf.equals(expected) ? 'yes' : 'no'}`);
  }

  const db = getDb();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all() as { name: string }[];
  // eslint-disable-next-line no-console
  console.log(`Tables:     ${tables.length}`);
  for (const t of tables) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get() as { n: number };
    // eslint-disable-next-line no-console
    console.log(`  ${t.name.padEnd(28)} rows=${row.n}`);
  }
}

main();
