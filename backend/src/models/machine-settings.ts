import { z } from 'zod';
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
} from './common';

export const MachineSettingsPayloadSchema = z.object({
  force: NonEmptyStringSchema,
  lightness: NonNegativeNumberSchema,
  loadTime: NonNegativeNumberSchema,
  objective: NonEmptyStringSchema,
  hardnessLevel: NonEmptyStringSchema,
});

export const MachineSettingsModel = MachineSettingsPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type MachineSettingsPayload = z.infer<typeof MachineSettingsPayloadSchema>;
export type MachineSettings = z.infer<typeof MachineSettingsModel>;
