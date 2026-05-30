import { z } from 'zod';
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
} from './common';

// Per-objective saved brightness. Only the measurement lenses (10X / 40X)
// carry a saved value — the indenter/center slot intentionally has none. The
// backend owns this map; the renderer never edits it.
export const ObjectiveBrightnessMapSchema = z.record(
  z.string(),
  z.number().int().min(0).max(10)
);

export const DEFAULT_OBJECTIVE_BRIGHTNESS_MAP: Record<string, number> = {
  '10X': 9,
  '40X': 7,
};

export const MachineSettingsPayloadSchema = z.object({
  force: NonEmptyStringSchema,
  lightness: NonNegativeNumberSchema,
  loadTime: NonNegativeNumberSchema,
  objective: NonEmptyStringSchema,
  hardnessLevel: NonEmptyStringSchema,
  objectiveBrightnessMap: ObjectiveBrightnessMapSchema.optional(),
});

export const MachineSettingsModel = MachineSettingsPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type MachineSettingsPayload = z.infer<typeof MachineSettingsPayloadSchema>;
export type MachineSettings = z.infer<typeof MachineSettingsModel>;
