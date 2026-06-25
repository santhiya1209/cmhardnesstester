/**
 * Diagnostics flag + logger for the camera/measurement reliability investigation.
 *
 * Goal: capture a GOOD vs BAD Auto/Manual Measure run (frame freshness, render
 * health, measurement state machine, stage timing, manual coordinate mapping)
 * WITHOUT spamming normal production logs. Off by default; turn on to capture a
 * bad run in the field, then compare.
 *
 * Enable via either:
 *   - persisted toggle: localStorage 'DEBUG_MEASURE' = '1'
 *   - runtime (devtools console): window.__measureDebug(true)
 */
const LS_KEY = 'DEBUG_MEASURE';

function readInitial(): boolean {
  try {
    return window.localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

let enabled = readInitial();

export function isMeasureDebug(): boolean {
  return enabled;
}

export function setMeasureDebug(on: boolean): void {
  enabled = on;
  try {
    window.localStorage.setItem(LS_KEY, on ? '1' : '0');
  } catch {
    // ignore storage failures — the in-memory flag still applies this session
  }
  // eslint-disable-next-line no-console
  console.log(`[measure-debug] ${on ? 'ENABLED' : 'disabled'}`);
}

/** Gated structured log. No-op unless DEBUG_MEASURE is on. */
export function mlog(tag: string, fields?: Record<string, unknown>): void {
  if (!enabled) return;
  const parts = fields
    ? Object.entries(fields)
        .map(([k, v]) => `${k}=${typeof v === 'number' ? Math.round(v * 100) / 100 : v}`)
        .join(' ')
    : '';
  // eslint-disable-next-line no-console
  console.log(`[${tag}]${parts ? ' ' + parts : ''}`);
}

/**
 * Uniform per-measurement diagnostic so a Manual run and an Auto run can be
 * compared field-for-field. Logs the full pixel→micron pipeline for one
 * measurement under the single tag `measure-calc`. Gated by DEBUG_MEASURE.
 *
 * leftX/rightX/topY/bottomY are the canonical axis-aligned endpoints both modes
 * reduce to (see cornersToDiagonalsPx): d1Px = |rightX-leftX|, d2Px = |bottomY-topY|.
 * Precision-sensitive fields (calibration factor, microns) are pre-formatted as
 * strings so mlog's 2-decimal rounding doesn't hide a divergence.
 */
export function logMeasureCalc(
  source: 'manual' | 'auto' | 'auto-adjusted',
  f: {
    leftX: number;
    rightX: number;
    topY: number;
    bottomY: number;
    d1Px: number;
    d2Px: number;
    umPerPixel: number;
    objective: string | null;
    d1Um: number;
    d2Um: number;
    avgDUm: number;
  }
): void {
  if (!enabled) return;
  mlog('measure-calc', {
    source,
    leftX: f.leftX.toFixed(2),
    rightX: f.rightX.toFixed(2),
    topY: f.topY.toFixed(2),
    bottomY: f.bottomY.toFixed(2),
    d1Px: f.d1Px.toFixed(3),
    d2Px: f.d2Px.toFixed(3),
    umPerPixel: f.umPerPixel.toFixed(6),
    objective: f.objective ?? 'null',
    d1Um: f.d1Um.toFixed(4),
    d2Um: f.d2Um.toFixed(4),
    avgDUm: f.avgDUm.toFixed(4),
  });
}

// Expose a runtime toggle so a bad run can be captured without a rebuild.
if (typeof window !== 'undefined') {
  (window as unknown as { __measureDebug?: (on: boolean) => void }).__measureDebug =
    setMeasureDebug;
}
