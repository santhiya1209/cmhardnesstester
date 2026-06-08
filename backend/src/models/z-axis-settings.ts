import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

// Z Axis operator CONFIGURATION (not live movement state) — backend-owned
// singleton (one row). The backend service holds the active copy; the renderer
// only edits/persists it through IPC. NOTHING here invents Z serial bytes or
// claims Z movement: these are stored config values only. `pulsePerMm` is the
// mm↔pulse factor used ONLY when a confirmed pulse-based Z operation exists
// (pulses = mm * pulsePerMm) — there is no such operation yet, so the factor is
// stored but never applied to hardware.

// Image-selection percentages offered in the dialog (30%–100%). A union of
// literals so the inferred type is exhaustive rather than "any number".
export const ImageSelectionSchema = z.union([
  z.literal(30),
  z.literal(40),
  z.literal(50),
  z.literal(60),
  z.literal(70),
  z.literal(80),
  z.literal(90),
  z.literal(100),
]);

export const ZAxisSettingsPayloadSchema = z.object({
  // Z axis
  reverseDirection: z.boolean(),
  pulsePerMm: z.number().int().positive(), // > 0
  stepDistanceMm: z.number().finite().positive(), // > 0
  // Empty trip (backlash compensation, mm). Stored as config only — no confirmed
  // empty-trip Z serial command exists, so these are never sent to the controller.
  hasEmptyTrip: z.boolean(),
  upwardEmptyTripMm: z.number().finite().nonnegative(), // >= 0
  downwardEmptyTripMm: z.number().finite().nonnegative(), // >= 0
  // Visual image-selection percentage (30–100).
  imageSelection: ImageSelectionSchema,
});

export const ZAxisSettingsModel = ZAxisSettingsPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type ImageSelection = z.infer<typeof ImageSelectionSchema>;
export type ZAxisSettingsPayload = z.infer<typeof ZAxisSettingsPayloadSchema>;
export type ZAxisSettings = z.infer<typeof ZAxisSettingsModel>;

// Reference legacy-screen defaults.
export const DEFAULT_Z_AXIS_SETTINGS: ZAxisSettingsPayload = {
  reverseDirection: true,
  pulsePerMm: 15000,
  stepDistanceMm: 0.001,
  hasEmptyTrip: true,
  upwardEmptyTripMm: 0.0005,
  downwardEmptyTripMm: 0.0005,
  imageSelection: 40,
};
