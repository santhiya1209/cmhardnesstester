import { getLatestMicrometerReading } from '@/api/micrometer';
import { computeQualified } from '@/utils/manualMeasure';

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

export function waitForOverlayPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
