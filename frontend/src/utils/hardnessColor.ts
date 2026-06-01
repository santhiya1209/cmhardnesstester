// Industrial hardness color rule: HV inside [min, max] → red (in-spec, needs QC
// acknowledgement); outside the band → dark blue (out-of-spec); no targets
// configured → inherit (no color override, theme default text color).
export const HARDNESS_COLOR_IN_RANGE = '#D32F2F'; // red 700
export const HARDNESS_COLOR_OUT_OF_RANGE = '#0D47A1'; // dark blue 900
export const HARDNESS_COLOR_DEFAULT = 'inherit'; // no override — inherit theme text color

export type HardnessColorMode = 'in-range' | 'out-of-range' | 'default';

export type HardnessColorResult = {
  color: string;
  mode: HardnessColorMode;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// Returns the color to apply to a rendered HV value given the operator's
// target band. Returns HARDNESS_COLOR_DEFAULT ('inherit') when hv is
// null/invalid or either target bound is missing — no visible color override.
// Inclusive comparison: HV equal to minHv or maxHv is considered in-range.
export function getHardnessColor(
  hv: number | null | undefined,
  minHv: number | null | undefined,
  maxHv: number | null | undefined
): HardnessColorResult {
  const hvNum = Number(hv);
  const minNum = Number(minHv);
  const maxNum = Number(maxHv);
  // eslint-disable-next-line no-console
  console.log(`[hardness-target-input] hv=${String(hv)} min=${String(minHv)} max=${String(maxHv)}`);

  if (!isFiniteNumber(hv) || !Number.isFinite(hvNum)) {
    // eslint-disable-next-line no-console
    console.log(`[hardness-target-color] hv=${String(hv)} min=${String(minHv)} max=${String(maxHv)} color=default reason=invalid`);
    return { color: HARDNESS_COLOR_DEFAULT, mode: 'default' };
  }

  const hasMin = Number.isFinite(minNum) && minNum > 0;
  const hasMax = Number.isFinite(maxNum) && maxNum > 0;
  // eslint-disable-next-line no-console
  console.log(`[hardness-target-normalized] hv=${hvNum} min=${hasMin ? minNum : 'missing'} max=${hasMax ? maxNum : 'missing'}`);

  if (!hasMin || !hasMax) {
    // eslint-disable-next-line no-console
    console.log(`[hardness-target-color] hv=${hvNum} min=${String(minHv)} max=${String(maxHv)} color=default reason=missing-target`);
    return { color: HARDNESS_COLOR_DEFAULT, mode: 'default' };
  }

  if (minNum > maxNum) {
    // eslint-disable-next-line no-console
    console.warn(`[hardness-target-color] hv=${hvNum} min=${minNum} max=${maxNum} color=default reason=min-greater-than-max`);
    return { color: HARDNESS_COLOR_DEFAULT, mode: 'default' };
  }

  const inRange = hvNum >= minNum && hvNum <= maxNum;
  const reason = inRange ? 'inside' : (hvNum < minNum ? 'below' : 'above');
  // eslint-disable-next-line no-console
  console.log(`[hardness-target-color] hv=${hvNum} min=${minNum} max=${maxNum} color=${inRange ? 'red' : 'blue'} reason=${reason}`);

  return inRange
    ? { color: HARDNESS_COLOR_IN_RANGE, mode: 'in-range' }
    : { color: HARDNESS_COLOR_OUT_OF_RANGE, mode: 'out-of-range' };
}
