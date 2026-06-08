import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase, BindParams } from 'sql.js';
import { env, isProd } from './env';
import { type CollectionName, COLLECTION_NAMES, createEmptyDatabase } from '../models/database';

/**
 * One SQLite table per collection. Each row is keyed by its UUID `id` and
 * stores the full row as JSON in the `json` column. This keeps the existing
 * model-validation pipeline (zod) authoritative for shape while still giving
 * us real SQLite tables that the VS Code SQLite viewer can open. Field-level
 * queries are possible via `json_extract(json, '$.field')`.
 *
 * Uses sql.js (WASM SQLite) instead of a native addon — no ABI mismatch
 * between dev Node and Electron Node. The entire database lives in memory
 * and is flushed to disk after every write.
 */
export const COLLECTION_TO_TABLE: Record<CollectionName, string> = {
  machineSettings: 'machine_settings',
  measurements: 'measurements',
  micrometerConfig: 'micrometer_config',
  autoMeasureSettings: 'auto_measure_settings',
  calibrationSettings: 'calibration_settings',
  calibrations: 'calibrations',
  lineColorSettings: 'line_color_settings',
  serialPortSettings: 'serial_port_settings',
  cameraSettings: 'camera_settings',
  genericSettings: 'generic_settings',
  otherSettings: 'other_settings',
  reportHeaderSettings: 'report_header_settings',
  testRecords: 'test_records',
  xyzPlatformStates: 'xyz_platform_states',
  xyzCenterCalibration: 'xyz_center_calibration',
  xyzPlatformSettings: 'xyz_platform_settings',
  zAxisSettings: 'z_axis_settings',
  patternPrograms: 'pattern_programs',
  depthImageSettings: 'depth_image_settings',
  albumItems: 'album_items',
  toolbarStates: 'toolbar_states',
};

export const TABLE_TO_COLLECTION: Record<string, CollectionName> = Object.fromEntries(
  Object.entries(COLLECTION_TO_TABLE).map(([k, v]) => [v, k as CollectionName])
);

// ─── Path helpers ─────────────────────────────────────────────────────────────

function getProductionDataRoot(): string {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  return path.join(os.homedir(), '.local', 'share');
}

function normalizeRelativeDirectory(directory: string): string {
  return directory.replace(/^(\.[\\/])+/, '').replace(/^[\\/]+/, '');
}

function resolveDatabaseDirectory(): string {
  if (path.isAbsolute(env.DB_LOCATION)) return env.DB_LOCATION;
  if (isProd) {
    return path.resolve(
      getProductionDataRoot(),
      env.APP_NAME,
      normalizeRelativeDirectory(env.DB_LOCATION)
    );
  }
  return path.resolve(__dirname, '..', '..', env.DB_LOCATION);
}

export function getDatabaseFilePath(): string {
  return path.join(resolveDatabaseDirectory(), env.DB_FILENAME);
}

// ─── Compatibility layer: sql.js wrapped to match better-sqlite3's API ────────

export interface PreparedStatement {
  run(...args: unknown[]): { changes: number };
  get(...args: unknown[]): Record<string, unknown> | undefined;
  all(...args: unknown[]): Record<string, unknown>[];
}

export interface DbHandle {
  prepare(sql: string): PreparedStatement;
  exec(sql: string): void;
  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void;
  close(): void;
}

/**
 * Converts args from better-sqlite3 call convention to sql.js BindParams:
 *   - Plain object `{id, json}` → `{'@id': ..., '@json': ...}` (adds @ prefix)
 *   - Single non-object value → wrapped in array for positional binding
 *   - Multiple values → array for positional binding
 *   - Already-prefixed object or raw array → passed through
 */
function normalizeParams(args: unknown[]): BindParams | undefined {
  if (args.length === 0) return undefined;

  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === 'object' &&
    !Array.isArray(args[0])
  ) {
    const obj = args[0] as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (
      keys.length > 0 &&
      !keys[0].startsWith('@') &&
      !keys[0].startsWith(':') &&
      !keys[0].startsWith('$')
    ) {
      return Object.fromEntries(keys.map(k => [`@${k}`, obj[k]])) as unknown as BindParams;
    }
    return obj as unknown as BindParams;
  }

  if (args.length === 1 && Array.isArray(args[0])) return args[0] as BindParams;

  // Single primitive or multiple positional args → array
  return args as unknown as BindParams;
}

function buildHandle(db: SqlJsDatabase): DbHandle {
  return {
    prepare(sql: string): PreparedStatement {
      const stmt = db.prepare(sql);
      return {
        run(...args: unknown[]): { changes: number } {
          const params = normalizeParams(args);
          stmt.reset();
          if (params !== undefined) stmt.bind(params);
          stmt.step();
          stmt.reset();
          return { changes: db.getRowsModified() };
        },
        get(...args: unknown[]): Record<string, unknown> | undefined {
          const params = normalizeParams(args);
          stmt.reset();
          if (params !== undefined) stmt.bind(params);
          const has = stmt.step();
          if (!has) { stmt.reset(); return undefined; }
          const row = stmt.getAsObject() as Record<string, unknown>;
          stmt.reset();
          return row;
        },
        all(...args: unknown[]): Record<string, unknown>[] {
          const params = normalizeParams(args);
          stmt.reset();
          if (params !== undefined) stmt.bind(params);
          const rows: Record<string, unknown>[] = [];
          while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
          stmt.reset();
          return rows;
        },
      };
    },

    exec(sql: string): void {
      db.run(sql);
    },

    transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
      return (...args: T) => {
        db.run('BEGIN');
        try {
          fn(...args);
          db.run('COMMIT');
        } catch (err) {
          try { db.run('ROLLBACK'); } catch { /* ignore rollback error */ }
          throw err;
        }
      };
    },

    close(): void {
      db.close();
    },
  };
}

// ─── Internal state ───────────────────────────────────────────────────────────

let rawDb: SqlJsDatabase | null = null;
let cachedHandle: DbHandle | null = null;
let cachedFilePath: string | null = null;

function persistToDisk(): void {
  if (!rawDb || !cachedFilePath) return;
  const data = rawDb.export();
  fs.writeFileSync(cachedFilePath, Buffer.from(data));
}

// ─── Schema + seed ────────────────────────────────────────────────────────────

function createSchema(db: DbHandle): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA auto_vacuum = INCREMENTAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const insertMeta = db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  insertMeta.run('version', '1');
  insertMeta.run('updatedAt', new Date().toISOString());

  for (const table of Object.values(COLLECTION_TO_TABLE)) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (
         id   TEXT PRIMARY KEY NOT NULL,
         json TEXT NOT NULL
       );`
    );
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Async one-time initializer. Must be awaited before calling getDb().
 * Loads sql.js WASM, opens (or creates) the database, and runs schema setup.
 */
export async function initializeSqlite(): Promise<void> {
  if (cachedHandle) return;

  const filePath = getDatabaseFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const SQL = await initSqlJs();

  let db: SqlJsDatabase;
  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  rawDb = db;
  cachedFilePath = filePath;
  cachedHandle = buildHandle(db);

  createSchema(cachedHandle);

  const integrityRows = cachedHandle.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
  const integrityOk = integrityRows.length === 1 && integrityRows[0]?.integrity_check === 'ok';

  console.log(`[db-path] active=${filePath}`);
  console.log('[db-open] success=true');
  console.log(`[db-integrity] ok=${integrityOk}`);
  console.log('[db-backup-disabled] reason=single-db-policy');

  if (!integrityOk) {
    console.warn(`[db-integrity] details: ${JSON.stringify(integrityRows)}`);
  }

  persistToDisk();
}

export function getDb(): DbHandle {
  if (!cachedHandle) {
    throw new Error('[sqlite] Not initialized. Call initializeSqlite() before getDb().');
  }
  return cachedHandle;
}

export function closeDb(): void {
  if (!cachedHandle || !rawDb) return;
  try {
    persistToDisk();
    console.log('[db-close] persisted and closed');
  } catch (err) {
    console.warn(`[db-close] persist failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  rawDb.close();
  rawDb = null;
  cachedHandle = null;
  cachedFilePath = null;
}

/**
 * Reclaim freed in-memory pages and flush to disk. Safe to call only from
 * low-frequency paths (full saves, shutdown) — never per-frame.
 */
export function runDbMaintenance(): void {
  if (!rawDb) return;
  try {
    rawDb.run('PRAGMA incremental_vacuum');
    persistToDisk();
    console.log('[db-maintenance] vacuumed + persisted to disk');
  } catch (err) {
    console.warn(`[db-maintenance] failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Load every collection in one pass. Used by the existing read-modify-write
 * mutateDatabase flow so the entire state shape (matching the old JSON
 * layout) is reconstructed from SQLite.
 */
export function readAllCollections(): Record<CollectionName, unknown[]> {
  const db = getDb();
  const result = createEmptyDatabase() as unknown as Record<string, unknown[]>;
  for (const collection of COLLECTION_NAMES) {
    const table = COLLECTION_TO_TABLE[collection];
    const rows = db.prepare(`SELECT json FROM ${table}`).all() as { json: string }[];
    result[collection] = rows.map((r) => JSON.parse(r.json));
  }
  return result as unknown as Record<CollectionName, unknown[]>;
}

/**
 * Replace every collection's rows atomically. Mirrors the previous
 * "rewrite the whole JSON" semantics so mutateDatabase keeps its existing
 * contract for callers.
 */
export function writeAllCollections(state: Record<CollectionName, unknown[]>, updatedAt: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE meta SET value = ? WHERE key = 'updatedAt'`).run(updatedAt);
    for (const collection of COLLECTION_NAMES) {
      const table = COLLECTION_TO_TABLE[collection];
      const rows = state[collection];
      db.prepare(`DELETE FROM ${table}`).run();
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const insert = db.prepare(`INSERT INTO ${table} (id, json) VALUES (@id, @json)`);
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const id = (row as { id?: unknown }).id;
        if (typeof id !== 'string' || id.length === 0) continue;
        insert.run({ id, json: JSON.stringify(row) });
      }
    }
  });
  tx();
  runDbMaintenance();
}

/**
 * Narrow write: upsert ONLY the given collection's rows by id. Other tables
 * are left untouched. High-frequency machine-state persistence path.
 */
export function upsertRows(collection: CollectionName, rows: unknown[]): void {
  const db = getDb();
  const table = COLLECTION_TO_TABLE[collection];
  const stmt = db.prepare(
    `INSERT INTO ${table} (id, json) VALUES (@id, @json)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json`
  );
  let count = 0;
  const tx = db.transaction((items: unknown[]) => {
    for (const row of items) {
      if (!row || typeof row !== 'object') continue;
      const id = (row as { id?: unknown }).id;
      if (typeof id !== 'string' || id.length === 0) continue;
      stmt.run({ id, json: JSON.stringify(row) });
      count++;
    }
    db.prepare(`UPDATE meta SET value = ? WHERE key = 'updatedAt'`).run(new Date().toISOString());
  });
  tx(rows);
  persistToDisk();
  console.log(`[db-persist-narrow] collection=${collection} rows=${count}`);
}

/**
 * Delete ALL rows from the measurements table and persist.
 * Returns the number of rows deleted.
 *
 * Bypasses the measurement-service beforeDelete hook (which blocks deleting
 * measurements referenced by test records) so the session clear always
 * succeeds. Test-record measurementIds become orphaned references — acceptable
 * since the records themselves (reports/history) are preserved.
 * Safe to call from startup and from the Electron close handler.
 */
export function deleteAllMeasurements(): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM measurements').run();
  if (result.changes > 0) {
    db.prepare(`UPDATE meta SET value = ? WHERE key = 'updatedAt'`).run(new Date().toISOString());
    persistToDisk();
  }
  return result.changes;
}

/**
 * Narrow delete: remove ONLY the given ids from the given collection's table.
 */
export function deleteRows(collection: CollectionName, ids: string[]): void {
  const db = getDb();
  const table = COLLECTION_TO_TABLE[collection];
  const stmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
  let count = 0;
  const tx = db.transaction((list: string[]) => {
    for (const id of list) {
      if (typeof id !== 'string' || id.length === 0) continue;
      const info = stmt.run(id);
      count += info.changes;
    }
    db.prepare(`UPDATE meta SET value = ? WHERE key = 'updatedAt'`).run(new Date().toISOString());
  });
  tx(ids);
  persistToDisk();
  console.log(`[db-persist-narrow] collection=${collection} rows=${count}`);
}
