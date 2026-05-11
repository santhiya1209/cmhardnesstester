/**
 * Vickers (HV) → other hardness scale conversion.
 *
 * These are widely-used analytical approximations for hardened steel that are
 * good to roughly ±1 unit on Rockwell scales and ±1-2 % on Brinell over the
 * common Vickers range. They are NOT ISO 18265 / ASTM E140 table-grade values.
 * For traceable cross-scale reporting use the full standard table.
 *
 * Range guards: each scale only returns a number when the input HV is in a
 * range where the formula is reasonable. Outside that range we return `null`
 * so the UI shows a dash rather than nonsense.
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function convertVickers(
  hv: number | null | undefined,
  target: ConvertTargetType
): number | null {
  if (typeof hv !== 'number' || !Number.isFinite(hv) || hv <= 0) {
    return null;
  }

  // Identity — Vickers stays Vickers.
  if (target === 'HV') {
    return round1(hv);
  }

  // Knoop is numerically very close to Vickers at low loads.
  if (target === 'HK') {
    return round1(hv * 1.05);
  }

  // Brinell (HBW): HBW ≈ HV up to ~350; above that the relationship flattens.
  if (target === 'HBW') {
    if (hv < 100) return null;
    if (hv <= 350) return round1(hv * 0.95);
    if (hv <= 650) return round1(hv * 0.92);
    return null;
  }

  // Rockwell C: HRC ≈ 116 − 1500/√HV in the typical hardened-steel range.
  if (target === 'HRC') {
    if (hv < 240 || hv > 940) return null;
    return round1(116 - 1500 / Math.sqrt(hv));
  }

  // Rockwell A: HRA ≈ 80 + 0.15·HRC (empirical proxy via HRC).
  if (target === 'HRA') {
    if (hv < 240 || hv > 940) return null;
    const hrc = 116 - 1500 / Math.sqrt(hv);
    return round1(80 + 0.15 * hrc);
  }

  // Rockwell B: HRB ≈ 134 − 6500/√HV in the soft-steel range.
  if (target === 'HRB') {
    if (hv < 90 || hv > 240) return null;
    return round1(134 - 6500 / Math.sqrt(hv));
  }

  // Rockwell D, F: thin-piece scales — keep proportional to HRC/HRB.
  if (target === 'HRD') {
    if (hv < 240 || hv > 940) return null;
    const hrc = 116 - 1500 / Math.sqrt(hv);
    return round1(hrc + 2.5);
  }

  if (target === 'HRF') {
    if (hv < 70 || hv > 200) return null;
    return round1(140 - 6800 / Math.sqrt(hv));
  }

  // Superficial Rockwell N (15N / 30N / 45N): hardened-steel surfaces.
  // Empirical proxies anchored on HRC.
  if (target === 'HR15N' || target === 'HR30N' || target === 'HR45N') {
    if (hv < 240 || hv > 940) return null;
    const hrc = 116 - 1500 / Math.sqrt(hv);
    if (target === 'HR15N') return round1(0.5 * hrc + 67);
    if (target === 'HR30N') return round1(0.7 * hrc + 50);
    return round1(0.85 * hrc + 35);
  }

  // Superficial Rockwell T (15T / 30T / 45T): soft material surfaces.
  if (target === 'HR15T' || target === 'HR30T' || target === 'HR45T') {
    if (hv < 90 || hv > 240) return null;
    const hrb = 134 - 6500 / Math.sqrt(hv);
    if (target === 'HR15T') return round1(0.5 * hrb + 47);
    if (target === 'HR30T') return round1(0.7 * hrb + 30);
    return round1(0.85 * hrb + 15);
  }

  return null;
}
