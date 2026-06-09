import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from './common';

// XY Platform Settings — operator CONFIGURATION (not live movement state). The
// backend service owns the active copy; the renderer only edits/persists it via
// the CRUD routes. Singleton (one row). Nothing here invents serial bytes for
// unmapped registers — see the per-field notes.

const NonNegNumber = z.number().finite().nonnegative();

// One speed tier — the verified old-software register profile. The three
// controller-unit register values are written to the #05–#0A speed registers
// (begin/accel/final, applied to both X and Y). `approxMmS` is a reference LABEL
// only: physical mm/s depends on hardware calibration and is NOT derived from
// these registers.
export const XyzSpeedProfileSchema = z.object({
  beginRegisterValue: z.number().int().nonnegative(),
  accelerationRegisterValue: z.number().int().nonnegative(),
  finalRegisterValue: z.number().int().nonnegative(),
  approxMmS: NonNegNumber,
  // Distance (mm) a single QUICK TAP of an arrow moves at this tier. Converted to
  // pulses by the backend (pulses = round(stepDistanceMm * pulsePerMm)) and sent as
  // ONE finite relative move whose landing is read back from the real #11 RX frame.
  // Optional so payloads/rows saved before this field still validate; the backend
  // normalizer fills the per-tier default. A long press still uses continuous jog.
  stepDistanceMm: NonNegNumber.optional(),
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
  // --- Fixed machine geometry (confirmed protocol sheet) ---------------------
  // Total travel per axis. 50 mm * 1600 pulses/mm = 80000 pulses — used ONLY for
  // validation/safety bounds, NEVER to fabricate or clamp a real RX position.
  travelXmm: z.number().positive().default(50),
  travelYmm: z.number().positive().default(50),
  // Physical center = fixed machine geometry (the travel midpoint), DISTINCT from
  // the operator-taught optical center (Set Center / Relocation use that, NOT
  // this). pulses = mm * pulsePerMm (25 mm * 1600 = 40000). Stored for
  // documentation / a future explicit "Set Physical Center" action only.
  physicalCenterXmm: z.number().nonnegative().default(25),
  physicalCenterYmm: z.number().nonnegative().default(25),
  physicalCenterXpulses: z.number().int().nonnegative().default(40000),
  physicalCenterYpulses: z.number().int().nonnegative().default(40000),
  // Backlash/empty-trip compensation (mm). Stored as config; not yet sent to the
  // controller (no confirmed empty-trip serial command).
  emptyTrip: XyzEmptyTripSchema,
  // Four operator tiers. A row persisted during the (reverted) six-tier window is
  // reshaped back BEFORE validation so DatabaseSchema load never rejects it:
  // medium→mid, ultraFast→ultra; veryFast/superFast are dropped. Old four-key rows
  // pass through unchanged.
  speedProfiles: z.preprocess((value) => {
    if (!value || typeof value !== 'object') return value;
    const p = value as Record<string, unknown>;
    return {
      slow: p.slow,
      mid: p.mid ?? p.medium,
      fast: p.fast,
      ultra: p.ultra ?? p.ultraFast,
    };
  }, z.object({
    slow: XyzSpeedProfileSchema,
    mid: XyzSpeedProfileSchema,
    fast: XyzSpeedProfileSchema,
    ultra: XyzSpeedProfileSchema,
  })),
});

export const XYZPlatformSettingsModel = XYZPlatformSettingsPayloadSchema.extend({
  id: EntityIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type XyzSpeedProfile = z.infer<typeof XyzSpeedProfileSchema>;
export type XYZPlatformSettingsPayload = z.infer<typeof XYZPlatformSettingsPayloadSchema>;
export type XYZPlatformSettings = z.infer<typeof XYZPlatformSettingsModel>;

// Verified old-software speed register defaults. The per-tier begin/accel/final
// register values are the values the legacy controller software wrote to #05–#0A;
// `approxMmS` is the legacy reference label (uncalibrated on this hardware).
export const DEFAULT_XYZ_PLATFORM_SETTINGS: XYZPlatformSettingsPayload = {
  runningByNewThread: false,
  hasEmptyTrip: false,
  reverseXAxis: false,
  // Y axis is physically reversed on this controller (confirmed machine constant)
  // — the jog sign builder flips Y so the Up/Down arrows match real motion.
  reverseYAxis: true,
  pulsePerMm: 1600,
  travelXmm: 50,
  travelYmm: 50,
  physicalCenterXmm: 25,
  physicalCenterYmm: 25,
  physicalCenterXpulses: 40000,
  physicalCenterYpulses: 40000,
  emptyTrip: { forward: 0.0005, backward: 0.0005, leftward: 0.0005, rightward: 0.0005 },
  // stepDistanceMm = the per-tap distance for each tier. slow=0.025 mm is the
  // confirmed requirement (0.025 mm * 1600 pulses/mm = 40 pulses); the higher
  // tiers scale up so a tap covers more ground at a faster setting. Operator-
  // configurable; these are the defaults.
  speedProfiles: {
    slow: { beginRegisterValue: 200, accelerationRegisterValue: 300, finalRegisterValue: 1000, approxMmS: 0.62, stepDistanceMm: 0.025 },
    mid: { beginRegisterValue: 500, accelerationRegisterValue: 1000, finalRegisterValue: 3000, approxMmS: 1.87, stepDistanceMm: 0.1 },
    fast: { beginRegisterValue: 1000, accelerationRegisterValue: 2000, finalRegisterValue: 6000, approxMmS: 3.75, stepDistanceMm: 0.25 },
    ultra: { beginRegisterValue: 5000, accelerationRegisterValue: 6000, finalRegisterValue: 32000, approxMmS: 20.0, stepDistanceMm: 1.0 },
  },
};
