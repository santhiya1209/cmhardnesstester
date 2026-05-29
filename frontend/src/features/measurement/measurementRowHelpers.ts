import { getLatestMicrometerReading } from '@/api/micrometer';
import { computeQualified } from '@/utils/manualMeasure';

// Fixed acceptance window for the Qualified column. Treated as inclusive on
// both ends per the workpiece spec. Hoist to a Settings panel later if a
// per-job range is needed.
const QUALIFIED_TARGET_MIN_HV = 300;
const QUALIFIED_TARGET_MAX_HV = 800;

export function deriveQualifiedForRow(hv: number | null | undefined): 'YES' | 'NO' | null {
  return computeQualified(hv, QUALIFIED_TARGET_MIN_HV, QUALIFIED_TARGET_MAX_HV);
}

export async function readLatestMicrometerDepthMm(): Promise<number | null> {
  try {
    const reply = await getLatestMicrometerReading();
    const value = reply.reading?.value ?? null;
    const resolved =
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    return resolved;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[micrometer-depth-before-row] value=null error=${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

export type DepthSavePayload = {
  depthMm: number | null;
  depthSource: 'device' | 'manual';
  deviceDepthMm: number | null;
  manualDepthMm: number | null;
};

// Captures the depth snapshot to save on a NEW measurement row. Enabled =
// freeze the live micrometer reading into deviceDepthMm + depthMm with
// source='device'. Disabled = leave depth fields null with source='manual'
// so the operator can type the value into the table afterward. Callers MUST
// only invoke this for new rows; existing rows are preserved via the
// `{}`-spread path so saved depth never gets clobbered by a re-detect.
export async function buildNewRowDepthPayload(
  micrometerEnabled: boolean
): Promise<DepthSavePayload> {
  if (micrometerEnabled) {
    const deviceValue = await readLatestMicrometerDepthMm();
    return {
      depthMm: deviceValue,
      depthSource: 'device',
      deviceDepthMm: deviceValue,
      manualDepthMm: null,
    };
  }
  return {
    depthMm: null,
    depthSource: 'manual',
    deviceDepthMm: null,
    manualDepthMm: null,
  };
}

// Two RAFs guarantees overlay canvases (AutoMeasure / ManualMeasure) finished
// painting after a state-driven update before downstream consumers composite
// them into a thumbnail.
export function waitForOverlayPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
