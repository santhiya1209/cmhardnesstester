import { DatabaseError } from './errors';
import {
  type CollectionName,
  createEmptyDatabase,
  type DatabaseState,
  DatabaseSchema,
} from '../models/database';
import { getDatabaseFilePath as getDbPath, readAllCollections, writeAllCollections } from './sqlite';

let writeQueue: Promise<unknown> = Promise.resolve();

export function getDatabaseFilePath(): string {
  return getDbPath();
}

function loadDatabase(): DatabaseState {
  const collections = readAllCollections();
  const candidate = {
    ...createEmptyDatabase(),
    ...collections,
  };
  const result = DatabaseSchema.safeParse(candidate);
  if (!result.success) {
    throw new DatabaseError('The database does not match the expected schema.', {
      filePath: getDbPath(),
      issues: result.error.flatten(),
    });
  }
  return result.data;
}

function saveDatabase(database: DatabaseState): void {
  const result = DatabaseSchema.safeParse(database);
  if (!result.success) {
    throw new DatabaseError('Refusing to save an invalid database state.', {
      filePath: getDbPath(),
      issues: result.error.flatten(),
    });
  }
  const state = result.data;
  // Strip meta out of the per-collection write; meta is owned by sqlite.ts.
  const rows: Record<CollectionName, unknown[]> = {
    machineSettings: state.machineSettings,
    measurements: state.measurements,
    autoMeasureSettings: state.autoMeasureSettings,
    calibrationSettings: state.calibrationSettings,
    calibrations: state.calibrations,
    lineColorSettings: state.lineColorSettings,
    serialPortSettings: state.serialPortSettings,
    cameraSettings: state.cameraSettings,
    genericSettings: state.genericSettings,
    otherSettings: state.otherSettings,
    reportHeaderSettings: state.reportHeaderSettings,
    testRecords: state.testRecords,
    xyzPlatformStates: state.xyzPlatformStates,
    patternPrograms: state.patternPrograms,
    depthImageSettings: state.depthImageSettings,
    albumItems: state.albumItems,
    toolbarStates: state.toolbarStates,
  };
  writeAllCollections(rows, state.meta.updatedAt);
}

export async function readDatabase(): Promise<DatabaseState> {
  return loadDatabase();
}

export async function readCollection<K extends CollectionName>(
  collection: K
): Promise<DatabaseState[K]> {
  const database = loadDatabase();
  return database[collection];
}

export function mutateDatabase<T>(
  mutator: (
    database: DatabaseState
  ) =>
    | Promise<{ database: DatabaseState; result: T }>
    | { database: DatabaseState; result: T }
): Promise<T> {
  const run = async () => {
    const currentDatabase = loadDatabase();
    const { database, result } = await mutator(currentDatabase);
    const nextDatabase: DatabaseState = {
      ...database,
      meta: {
        ...database.meta,
        updatedAt: new Date().toISOString(),
      },
    };
    saveDatabase(nextDatabase);
    return result;
  };

  const task = writeQueue.then(run, run);
  writeQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}
