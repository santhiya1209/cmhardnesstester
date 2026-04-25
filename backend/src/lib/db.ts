import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { DatabaseError } from './errors';
import { env, isProd } from './env';
import {
  type CollectionName,
  createEmptyDatabase,
  type DatabaseState,
  DatabaseSchema,
} from '../models/database';

let writeQueue: Promise<unknown> = Promise.resolve();

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
  if (path.isAbsolute(env.DB_LOCATION)) {
    return env.DB_LOCATION;
  }

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

async function ensureDatabaseFile(): Promise<string> {
  const filePath = getDatabaseFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
  } catch {
    const initialState = createEmptyDatabase();
    await fs.writeFile(filePath, JSON.stringify(initialState, null, 2), 'utf-8');
  }

  return filePath;
}

async function loadDatabase(): Promise<DatabaseState> {
  const filePath = await ensureDatabaseFile();
  const raw = await fs.readFile(filePath, 'utf-8');

  if (!raw.trim()) {
    const initialState = createEmptyDatabase();
    await fs.writeFile(filePath, JSON.stringify(initialState, null, 2), 'utf-8');
    return initialState;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new DatabaseError('The database file contains invalid JSON.', {
      filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const result = DatabaseSchema.safeParse(parsed);
  if (!result.success) {
    throw new DatabaseError('The database file does not match the expected schema.', {
      filePath,
      issues: result.error.flatten(),
    });
  }

  return result.data;
}

async function saveDatabase(database: DatabaseState): Promise<void> {
  const filePath = await ensureDatabaseFile();
  const result = DatabaseSchema.safeParse(database);

  if (!result.success) {
    throw new DatabaseError('Refusing to save an invalid database state.', {
      filePath,
      issues: result.error.flatten(),
    });
  }

  await fs.writeFile(filePath, JSON.stringify(result.data, null, 2), 'utf-8');
}

export async function readDatabase(): Promise<DatabaseState> {
  return loadDatabase();
}

export async function readCollection<K extends CollectionName>(collection: K): Promise<DatabaseState[K]> {
  const database = await loadDatabase();
  return database[collection];
}

export function mutateDatabase<T>(
  mutator: (database: DatabaseState) => Promise<{ database: DatabaseState; result: T }> | { database: DatabaseState; result: T }
): Promise<T> {
  const run = async () => {
    const currentDatabase = await loadDatabase();
    const { database, result } = await mutator(currentDatabase);
    const nextDatabase: DatabaseState = {
      ...database,
      meta: {
        ...database.meta,
        updatedAt: new Date().toISOString(),
      },
    };
    await saveDatabase(nextDatabase);
    return result;
  };

  const task = writeQueue.then(run, run);
  writeQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}
