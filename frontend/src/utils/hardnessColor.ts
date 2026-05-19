// Industrial hardness color rule: HV inside [min, max] is the "in spec" case
// the operator wants flagged in red so the QC sheet draws the eye to it;
// values outside the band fade back to the default dark blue. Matches the
// spec the user gave us — counter-intuitive vs. typical "green=good", but
// reflects the customer's workflow where the in-range case is the one
// requiring action / acknowledgement.
export const HARDNESS_COLOR_IN_RANGE = '#D32F2F'; // red 700
export const HARDNESS_COLOR_OUT_OF_RANGE = '#0D47A1'; // dark blue 900

export type HardnessColorMode = 'in-range' | 'out-of-range' | 'default';

export type HardnessColorResult = {
  color: string;
  mode: HardnessColorMode;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// Returns the color to apply to a rendered HV value given the operator's
// target band. When either bound is missing, falls back to the out-of-range
// dark blue so unconfigured tests stay visually neutral.
export function getHardnessColor(
  hv: number | null | undefined,
  minHv: number | null | undefined,
  maxHv: number | null | undefined
): HardnessColorResult {
  if (!isFiniteNumber(hv)) {
    return { color: HARDNESS_COLOR_OUT_OF_RANGE, mode: 'default' };
  }
  const hasMin = isFiniteNumber(minHv) && minHv > 0;
  const hasMax = isFiniteNumber(maxHv) && maxHv > 0;
  if (!hasMin || !hasMax) {
    // eslint-disable-next-line no-console
    console.log(
      `[hv-color-rule] hv=${hv} min=${minHv ?? 'null'} max=${maxHv ?? 'null'} color=dark-blue reason=range-incomplete`
    );
    return { color: HARDNESS_COLOR_OUT_OF_RANGE, mode: 'default' };
  }
  const inRange = hv >= (minHv as number) && hv <= (maxHv as number);
  const result: HardnessColorResult = inRange
    ? { color: HARDNESS_COLOR_IN_RANGE, mode: 'in-range' }
    : { color: HARDNESS_COLOR_OUT_OF_RANGE, mode: 'out-of-range' };
  // eslint-disable-next-line no-console
  console.log(
    `[hv-color-rule] hv=${hv} min=${minHv} max=${maxHv} color=${inRange ? 'red' : 'dark-blue'}`
  );
  return result;
}
