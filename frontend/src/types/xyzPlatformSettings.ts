// XY Platform Settings — operator configuration (NOT live movement state). The
// backend owns the active copy; this type mirrors the backend model.

export const XY_SPEED_MODES = ['slow', 'mid', 'fast', 'ultra'] as const;
export type XySpeedMode = (typeof XY_SPEED_MODES)[number];

export type XyzSpeedProfile = {
  /** Controller-unit values written to #05–#0A (begin/accel/final, both axes). */
  beginRegisterValue: number;
  accelerationRegisterValue: number;
  finalRegisterValue: number;
  /** Reference label only — physical mm/s depends on hardware calibration. */
  approxMmS: number;
};

export type XyzEmptyTrip = {
  forward: number;
  backward: number;
  leftward: number;
  rightward: number;
};

export type XYZPlatformSettingsPayload = {
  runningByNewThread: boolean;
  hasEmptyTrip: boolean;
  reverseXAxis: boolean;
  reverseYAxis: boolean;
  pulsePerMm: number;
  // Fixed machine geometry (confirmed protocol sheet). Travel bounds drive safety
  // limits only; physical center is the travel midpoint and is DISTINCT from the
  // operator-taught optical center used by Set Center / Relocation.
  travelXmm: number;
  travelYmm: number;
  physicalCenterXmm: number;
  physicalCenterYmm: number;
  physicalCenterXpulses: number;
  physicalCenterYpulses: number;
  emptyTrip: XyzEmptyTrip;
  speedProfiles: Record<XySpeedMode, XyzSpeedProfile>;
};

export type XYZPlatformSettings = XYZPlatformSettingsPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_XYZ_PLATFORM_SETTINGS: XYZPlatformSettingsPayload = {
  runningByNewThread: false,
  hasEmptyTrip: false,
  reverseXAxis: false,
  // Y axis is physically reversed on this controller (confirmed machine constant).
  reverseYAxis: true,
  pulsePerMm: 1600,
  travelXmm: 50,
  travelYmm: 50,
  physicalCenterXmm: 25,
  physicalCenterYmm: 25,
  physicalCenterXpulses: 40000,
  physicalCenterYpulses: 40000,
  emptyTrip: { forward: 0.0005, backward: 0.0005, leftward: 0.0005, rightward: 0.0005 },
  speedProfiles: {
    slow: { beginRegisterValue: 200, accelerationRegisterValue: 300, finalRegisterValue: 1000, approxMmS: 0.62 },
    mid: { beginRegisterValue: 500, accelerationRegisterValue: 1000, finalRegisterValue: 3000, approxMmS: 1.87 },
    fast: { beginRegisterValue: 1000, accelerationRegisterValue: 2000, finalRegisterValue: 6000, approxMmS: 3.75 },
    ultra: { beginRegisterValue: 5000, accelerationRegisterValue: 6000, finalRegisterValue: 32000, approxMmS: 20.0 },
  },
};

/** Deep-merge a (possibly partial / missing) settings row over the defaults so
 *  the dialog always renders a complete, valid form. */
export function toXyzSettingsForm(
  settings: XYZPlatformSettings | XYZPlatformSettingsPayload | null | undefined
): XYZPlatformSettingsPayload {
  const d = DEFAULT_XYZ_PLATFORM_SETTINGS;
  if (!settings) return structuredClone(d);
  const profiles = (settings.speedProfiles ?? {}) as Partial<Record<string, XyzSpeedProfile>>;
  // A row persisted during the (reverted) six-tier window keyed these tiers as
  // medium/ultraFast — fall back to those so an operator's customized values still
  // populate the dialog.
  const merge = (mode: XySpeedMode, legacyKey?: string): XyzSpeedProfile => ({
    ...d.speedProfiles[mode],
    ...(profiles[mode] ?? (legacyKey ? profiles[legacyKey] : undefined) ?? {}),
  });
  return {
    runningByNewThread: settings.runningByNewThread ?? d.runningByNewThread,
    hasEmptyTrip: settings.hasEmptyTrip ?? d.hasEmptyTrip,
    reverseXAxis: settings.reverseXAxis ?? d.reverseXAxis,
    reverseYAxis: settings.reverseYAxis ?? d.reverseYAxis,
    pulsePerMm: settings.pulsePerMm ?? d.pulsePerMm,
    travelXmm: settings.travelXmm ?? d.travelXmm,
    travelYmm: settings.travelYmm ?? d.travelYmm,
    physicalCenterXmm: settings.physicalCenterXmm ?? d.physicalCenterXmm,
    physicalCenterYmm: settings.physicalCenterYmm ?? d.physicalCenterYmm,
    physicalCenterXpulses: settings.physicalCenterXpulses ?? d.physicalCenterXpulses,
    physicalCenterYpulses: settings.physicalCenterYpulses ?? d.physicalCenterYpulses,
    emptyTrip: { ...d.emptyTrip, ...(settings.emptyTrip ?? {}) },
    speedProfiles: {
      slow: merge('slow'),
      mid: merge('mid', 'medium'),
      fast: merge('fast'),
      ultra: merge('ultra', 'ultraFast'),
    },
  };
}
