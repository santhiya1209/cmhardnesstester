import type { AutoMeasureCorners } from '@/types/autoMeasure';

function pointKey(p: { x: number; y: number }): string {
  return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
}

/**
 * Stable identity of a 4-corner Auto Measure overlay. Used to confirm the
 * AutoMeasureOverlay canvas has actually painted a SPECIFIC set of final
 * corners before the album thumbnail is captured — replacing the previous
 * blind rAF wait that could scrape a stale/preview/blank overlay. Both the
 * overlay (when it reports a draw) and App (when it computes the expected
 * final corners) use this identical function so the keys compare exactly.
 */
export function autoMeasureCornersKey(c: AutoMeasureCorners | null | undefined): string {
  if (!c) return 'none';
  return [pointKey(c.top), pointKey(c.right), pointKey(c.bottom), pointKey(c.left)].join('|');
}
