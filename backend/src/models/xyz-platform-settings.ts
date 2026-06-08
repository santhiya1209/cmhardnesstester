import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

// XY Platform Settings — operator CONFIGURATION (not live movement state). The
// backend service owns the active copy; the renderer only edits/persists it via
// the CRUD routes. Singleton (one row). Nothing here invents serial bytes for
// unmapped registers — see the per-field notes.

const NonNegNumber = z.number().finite().nonnegative();

// One speed tier. The mm/s values are configuration/labels for the legacy speed
// profile. `registerValue` is the controller-unit value ACTUALLY written to the
// #05–#0A speed registers, stored SEPARATELY because the mm/s→register-unit
// mapping is not yet hardware-calibrated (so physical mm/s is NOT claimed).
export const XyzSpeedProfileSchema = z.object({
  stepDistanceMm: NonNegNumber,
  beginSpeedMmS: NonNegNumber,
  accelerationMmS2: NonNegNumber,
  finalSpeedMmS: NonNegNumber,
  registerValue: z.number().int().nonnegative(),
});

export const XyzEmptyTripSchema = z.object({
  forward: NonNegNumber,
  backward: NonNegNumber,
  leftward: NonNegNumber,
  rightward: NonNegNumber,
});

export const XYZPlatformSettingsPayloadSchema = z.object({
  // General
  runningByNewThread: z.boolean(),
  hasEmptyTrip: z.boolean(),
  reverseXAxis: z.boolean(),
  reverseYAxis: z.boolean(),
  // pulses per millimetre — the ONLY mm↔pulse conversion factor. Movement is
  // pulse-based in the confirmed protocol, so `pulses = mm * pulsePerMm`.
  pulsePerMm: z.number().int().positive(),
  // Backlash/empty-trip compensation (mm). Stored as config; not yet sent to the
  // controller (no confirmed empty-trip serial command).
  emptyTrip: XyzEmptyTripSchema,
  speedProfiles: z.object({
    slow: XyzSpeedProfileSchema,
    mid: XyzSpeedProfileSchema,
    fast: XyzSpeedProfileSchema,
    ultra: XyzSpeedProfileSchema,
  }),
});

export const XYZPlatformSettingsModel = XYZPlatformSettingsPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type XyzSpeedProfile = z.infer<typeof XyzSpeedProfileSchema>;
export type XYZPlatformSettingsPayload = z.infer<typeof XYZPlatformSettingsPayloadSchema>;
export type XYZPlatformSettings = z.infer<typeof XYZPlatformSettingsModel>;

// Reference legacy-screen defaults. `registerValue` per tier keeps the current
// (uncalibrated) values sent to #05–#0A so behaviour is unchanged out of the box.
export const DEFAULT_XYZ_PLATFORM_SETTINGS: XYZPlatformSettingsPayload = {
  runningByNewThread: false,
  hasEmptyTrip: false,
  reverseXAxis: false,
  reverseYAxis: false,
  pulsePerMm: 1600,
  emptyTrip: { forward: 0.0005, backward: 0.0005, leftward: 0.0005, rightward: 0.0005 },
  speedProfiles: {
    slow: { stepDistanceMm: 0.05, beginSpeedMmS: 0.05, accelerationMmS2: 0.1, finalSpeedMmS: 0.2, registerValue: 1 },
    mid: { stepDistanceMm: 0.2, beginSpeedMmS: 0.2, accelerationMmS2: 0.2, finalSpeedMmS: 1, registerValue: 5 },
    fast: { stepDistanceMm: 0.5, beginSpeedMmS: 0.2, accelerationMmS2: 0.2, finalSpeedMmS: 3, registerValue: 10 },
    ultra: { stepDistanceMm: 1, beginSpeedMmS: 1, accelerationMmS2: 1, finalSpeedMmS: 10, registerValue: 20 },
  },
};
