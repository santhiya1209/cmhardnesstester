import { z } from 'zod';
import { AutoMeasureSettingsModel } from './auto-measure-settings';
import { CalibrationSettingsModel } from './calibration-settings';
import { IsoDateTimeSchema } from './common';
import { MachineSettingsModel } from './machine-settings';
import { MeasurementModel } from './measurement';
import { TestRecordModel } from './test-record';

const DatabaseMetaSchema = z.object({
  version: z.literal(1),
  updatedAt: IsoDateTimeSchema,
});

export const DatabaseSchema = z.object({
  meta: DatabaseMetaSchema,
  machineSettings: z.array(MachineSettingsModel),
  measurements: z.array(MeasurementModel),
  autoMeasureSettings: z.array(AutoMeasureSettingsModel),
  calibrationSettings: z.array(CalibrationSettingsModel),
  testRecords: z.array(TestRecordModel),
});

export type DatabaseState = z.infer<typeof DatabaseSchema>;

export const COLLECTION_NAMES = [
  'machineSettings',
  'measurements',
  'autoMeasureSettings',
  'calibrationSettings',
  'testRecords',
] as const;

export type CollectionName = (typeof COLLECTION_NAMES)[number];

export function createEmptyDatabase(now = new Date().toISOString()): DatabaseState {
  return {
    meta: {
      version: 1,
      updatedAt: now,
    },
    machineSettings: [],
    measurements: [],
    autoMeasureSettings: [],
    calibrationSettings: [],
    testRecords: [],
  };
}
