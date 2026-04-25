import { z } from 'zod';
import { AlbumItemModel } from './album-item';
import { AutoMeasureSettingsModel } from './auto-measure-settings';
import { CalibrationSettingsModel } from './calibration-settings';
import { DepthImageSettingModel } from './depth-image-setting';
import { IsoDateTimeSchema } from './common';
import { MachineSettingsModel } from './machine-settings';
import { MeasurementModel } from './measurement';
import { PatternProgramModel } from './pattern-program';
import { TestRecordModel } from './test-record';
import { ToolbarStateModel } from './toolbar-state';
import { XYZPlatformStateModel } from './xyz-platform-state';

const DatabaseMetaSchema = z.object({
  version: z.literal(1),
  updatedAt: IsoDateTimeSchema,
});

export const DatabaseSchema = z.object({
  meta: DatabaseMetaSchema,
  machineSettings: z.array(MachineSettingsModel).default([]),
  measurements: z.array(MeasurementModel).default([]),
  autoMeasureSettings: z.array(AutoMeasureSettingsModel).default([]),
  calibrationSettings: z.array(CalibrationSettingsModel).default([]),
  testRecords: z.array(TestRecordModel).default([]),
  xyzPlatformStates: z.array(XYZPlatformStateModel).default([]),
  patternPrograms: z.array(PatternProgramModel).default([]),
  depthImageSettings: z.array(DepthImageSettingModel).default([]),
  albumItems: z.array(AlbumItemModel).default([]),
  toolbarStates: z.array(ToolbarStateModel).default([]),
});

export type DatabaseState = z.infer<typeof DatabaseSchema>;

export const COLLECTION_NAMES = [
  'machineSettings',
  'measurements',
  'autoMeasureSettings',
  'calibrationSettings',
  'testRecords',
  'xyzPlatformStates',
  'patternPrograms',
  'depthImageSettings',
  'albumItems',
  'toolbarStates',
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
    xyzPlatformStates: [],
    patternPrograms: [],
    depthImageSettings: [],
    albumItems: [],
    toolbarStates: [],
  };
}
