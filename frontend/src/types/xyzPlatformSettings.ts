// XY Platform Settings — operator configuration (NOT live movement state). The
// backend owns the active copy; this type mirrors the backend model.

export const XY_SPEED_MODES = ['slow', 'mid', 'fast', 'ultra'] as const;
export type XySpeedMode = (typeof XY_SPEED_MODES)[number];

export type XyzSpeedProfile = {
  stepDistanceMm: number;
  beginSpeedMmS: number;
  accelerationMmS2: number;
  finalSpeedMmS: number;
  /** Controller-unit value written to #05–#0A. Separate from mm/s (uncalibrated). */
  registerValue: number;
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

/** Deep-merge a (possibly partial / missing) settings row over the defaults so
 *  the dialog always renders a complete, valid form. */
export function toXyzSettingsForm(
  settings: XYZPlatformSettings | XYZPlatformSettingsPayload | null | undefined
): XYZPlatformSettingsPayload {
  const d = DEFAULT_XYZ_PLATFORM_SETTINGS;
  if (!settings) return structuredClone(d);
  const profiles = (settings.speedProfiles ?? {}) as Partial<Record<XySpeedMode, XyzSpeedProfile>>;
  return {
    runningByNewThread: settings.runningByNewThread ?? d.runningByNewThread,
    hasEmptyTrip: settings.hasEmptyTrip ?? d.hasEmptyTrip,
    reverseXAxis: settings.reverseXAxis ?? d.reverseXAxis,
    reverseYAxis: settings.reverseYAxis ?? d.reverseYAxis,
    pulsePerMm: settings.pulsePerMm ?? d.pulsePerMm,
    emptyTrip: { ...d.emptyTrip, ...(settings.emptyTrip ?? {}) },
    speedProfiles: {
      slow: { ...d.speedProfiles.slow, ...(profiles.slow ?? {}) },
      mid: { ...d.speedProfiles.mid, ...(profiles.mid ?? {}) },
      fast: { ...d.speedProfiles.fast, ...(profiles.fast ?? {}) },
      ultra: { ...d.speedProfiles.ultra, ...(profiles.ultra ?? {}) },
    },
  };
}
