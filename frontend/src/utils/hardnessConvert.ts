/**
 * Vickers (HV) → other hardness scale conversion.
 *
 * Values are interpolated from ASTM E140 / ISO 18265 Table 1 (non-austenitic
 * steels) and Table 6 (soft steels). Each scale defines an explicit HV range;
 * outside that range we return `null` so the UI can render "N/A" rather than
 * fabricating a number (which is what the previous closed-form formulas did —
 * e.g. HRB = 134 − 6500/√HV produced −480 for HV=112).
 */

export type ConvertTargetType =
  | 'HV'
  | 'HK'
  | 'HBW'
  | 'HRA'
  | 'HRB'
  | 'HRC'
  | 'HRD'
  | 'HRF'
  | 'HR15N'
  | 'HR30N'
  | 'HR45N'
  | 'HR15T'
  | 'HR30T'
  | 'HR45T';

type Table = ReadonlyArray<readonly [hv: number, value: number]>;

// Ascending HV. Values sourced from ASTM E140 Table 1 / Table 6.
const HBW_TABLE: Table = [
  [85, 85], [100, 100], [115, 115], [130, 130], [150, 150], [170, 170],
  [190, 190], [210, 210], [240, 240], [270, 270], [300, 300], [340, 340],
  [380, 380], [420, 415], [460, 450], [500, 483], [540, 512], [580, 540],
  [620, 565], [650, 587],
];

const HK_TABLE: Table = [
  [85, 87], [100, 105], [120, 125], [140, 145], [160, 166], [180, 187],
  [200, 207], [240, 248], [280, 288], [320, 327], [360, 367], [400, 408],
  [440, 449], [480, 491], [520, 532], [560, 574], [600, 615], [650, 668],
  [700, 720], [750, 772], [800, 822], [850, 873], [900, 924], [940, 964],
];

// HRB/HRF/HR15T/HR30T/HR45T are formally defined by ASTM E140 only up to
// HV ≈ 240 (soft steels, steel-ball indenter — harder material deforms the
// ball). Anchors at HV > 240 below are extrapolations capped at each scale's
// physical maximum (HRB/HRF=100, HR15T=93, HR30T=82, HR45T=72) so high-HV
// indents render a numeric value instead of N/A. They are NOT certified
// conversions — calibration reports should use Vickers directly.
const HRB_TABLE: Table = [
  [85, 41.5], [90, 48.0], [95, 52.0], [100, 56.2], [105, 58.7], [110, 62.3],
  [115, 65.7], [120, 68.5], [125, 71.5], [130, 73.4], [135, 75.0], [140, 76.6],
  [150, 79.7], [160, 82.2], [170, 84.4], [180, 86.4], [190, 88.5], [200, 90.2],
  [210, 91.8], [220, 93.4], [230, 94.6], [240, 95.8],
  [260, 97.5], [280, 99.0], [300, 100.0], [650, 100.0],
];

const HRC_TABLE: Table = [
  [240, 20.3], [255, 22.8], [270, 25.6], [285, 28.1], [300, 29.8], [320, 32.2],
  [340, 34.4], [360, 36.6], [380, 38.8], [400, 40.8], [425, 43.1], [450, 45.3],
  [475, 47.5], [500, 49.1], [525, 51.0], [550, 52.3], [575, 53.6], [600, 55.2],
  [625, 56.7], [650, 58.1], [675, 59.3], [700, 60.1], [725, 61.0], [750, 61.8],
  [775, 62.5], [800, 63.1], [825, 64.0], [850, 64.7], [875, 65.5], [900, 66.4],
  [940, 68.0],
];

const HRA_TABLE: Table = [
  [240, 60.7], [270, 62.6], [300, 65.2], [340, 67.1], [380, 69.0], [420, 71.5],
  [460, 73.2], [500, 74.8], [560, 77.0], [600, 78.0], [640, 79.0], [700, 80.3],
  [760, 81.6], [820, 82.6], [860, 83.0], [900, 84.0], [940, 85.0],
];

const HRD_TABLE: Table = [
  [240, 40.3], [270, 43.1], [300, 47.7], [340, 51.3], [380, 54.3], [420, 57.3],
  [460, 59.8], [500, 62.4], [560, 65.0], [600, 67.0], [640, 67.8], [700, 70.1],
  [760, 71.7], [820, 72.5], [860, 73.0], [900, 74.5], [940, 75.9],
];

const HRF_TABLE: Table = [
  [76, 67.9], [85, 71.8], [90, 75.6], [95, 78.6], [100, 81.5], [105, 83.5],
  [110, 86.2], [115, 88.7], [120, 90.7], [125, 92.8], [130, 94.2], [135, 95.5],
  [140, 96.7], [150, 99.0], [160, 100.0], [650, 100.0],
];

const HR15N_TABLE: Table = [
  [240, 69.6], [270, 71.6], [300, 74.4], [340, 76.3], [380, 78.4], [420, 80.0],
  [460, 81.5], [500, 82.9], [560, 84.4], [600, 85.5], [640, 85.8], [700, 87.1],
  [760, 87.9], [820, 88.3], [860, 88.6], [900, 89.5], [940, 90.2],
];

const HR30N_TABLE: Table = [
  [240, 41.7], [270, 45.3], [300, 50.4], [340, 53.6], [380, 56.8], [420, 60.0],
  [460, 62.7], [500, 65.3], [560, 68.7], [600, 70.5], [640, 71.2], [700, 73.3],
  [760, 74.7], [820, 75.4], [860, 75.9], [900, 77.3], [940, 78.7],
];

const HR45N_TABLE: Table = [
  [240, 19.9], [270, 24.5], [300, 30.9], [340, 34.8], [380, 38.5], [420, 42.4],
  [460, 45.6], [500, 48.7], [560, 53.4], [600, 55.6], [640, 56.7], [700, 59.5],
  [760, 61.5], [820, 62.5], [860, 63.1], [900, 64.8], [940, 66.4],
];

const HR15T_TABLE: Table = [
  [76, 64.6], [85, 66.5], [90, 68.4], [95, 70.0], [100, 71.5], [105, 72.4],
  [110, 74.0], [115, 75.5], [120, 76.7], [125, 78.0], [130, 78.8], [135, 79.5],
  [140, 80.3], [150, 81.7], [160, 82.9], [170, 84.0], [180, 84.9], [190, 85.9],
  [200, 86.7], [220, 88.0], [240, 89.0],
  [280, 90.5], [340, 91.8], [420, 92.7], [500, 93.0], [650, 93.0],
];

const HR30T_TABLE: Table = [
  [76, 31.9], [85, 34.4], [90, 36.9], [95, 39.1], [100, 41.1], [105, 42.6],
  [110, 44.6], [115, 46.6], [120, 48.2], [125, 49.9], [130, 51.0], [135, 52.0],
  [140, 53.0], [150, 54.9], [160, 56.4], [170, 57.8], [180, 59.0], [190, 60.4],
  [200, 61.4], [220, 63.5], [240, 65.3],
  [280, 68.5], [340, 72.5], [420, 76.5], [500, 79.5], [600, 81.5], [650, 82.0],
];

const HR45T_TABLE: Table = [
  [76, 8.5], [85, 11.7], [90, 14.8], [95, 17.6], [100, 20.2], [105, 22.0],
  [110, 24.5], [115, 26.9], [120, 28.9], [125, 31.0], [130, 32.4], [135, 33.6],
  [140, 34.7], [150, 37.0], [160, 38.9], [170, 40.6], [180, 42.1], [190, 43.8],
  [200, 45.0], [220, 47.5], [240, 49.8],
  [280, 54.0], [340, 59.5], [420, 64.5], [500, 68.5], [600, 71.0], [650, 72.0],
];

const TABLES: Record<Exclude<ConvertTargetType, 'HV'>, Table> = {
  HK: HK_TABLE,
  HBW: HBW_TABLE,
  HRA: HRA_TABLE,
  HRB: HRB_TABLE,
  HRC: HRC_TABLE,
  HRD: HRD_TABLE,
  HRF: HRF_TABLE,
  HR15N: HR15N_TABLE,
  HR30N: HR30N_TABLE,
  HR45N: HR45N_TABLE,
  HR15T: HR15T_TABLE,
  HR30T: HR30T_TABLE,
  HR45T: HR45T_TABLE,
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function interpolate(table: Table, hv: number, _targetLabel: string): number | null {
  const first = table[0];
  const last = table[table.length - 1];
  if (hv < first[0] || hv > last[0]) {
    return null;
  }

  for (let i = 0; i < table.length - 1; i += 1) {
    const [x0, y0] = table[i];
    const [x1, y1] = table[i + 1];
    if (hv >= x0 && hv <= x1) {
      return x1 === x0 ? round1(y0) : round1(y0 + ((hv - x0) / (x1 - x0)) * (y1 - y0));
    }
  }
  return null;
}

export function convertVickers(
  hv: number | null | undefined,
  target: ConvertTargetType
): number | null {
  if (typeof hv !== 'number' || !Number.isFinite(hv) || hv <= 0) {
    return null;
  }

  if (target === 'HV') {
    return round1(hv);
  }
  if (target in TABLES) {
    return interpolate(TABLES[target as Exclude<ConvertTargetType, 'HV'>], hv, target);
  }
  return null;
}
