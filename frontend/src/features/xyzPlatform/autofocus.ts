// Passive autofocus search for the CFOCUS / FFOCUS buttons.
//
// Industrial behaviour: instead of a single open-loop Z step, drive the Z stage
// across a bounded range while scoring image sharpness at each position, then
// return to the Z that scored highest. CFOCUS scans with the configured COARSE
// focus step (wide, fast), FFOCUS with the FINE step (narrow, precise) — same
// algorithm, different step size, exactly mirroring the per-mode single-click
// behaviour the buttons had before.
//
// Pieces are all reused, nothing reinvented:
//  - sharpness:  varianceOfLaplacian (frontend/src/utils/focusScore.ts)
//  - frames:     getLatestFullFrame + waitForFreshCameraFrame (cameraStreamManager)
//  - Z motion:   the caller's moveZ closure (one RX-gated #±Z n# step per call)
//
// The sharpness score is RELATIVE (see focusScore.ts) — we never gate on a fixed
// number. "Focus found" is decided by detecting an interior peak (a sample with
// lower-scoring neighbours on both explored sides). A best score sitting at the
// edge of the scan range means true focus is outside the range → reported as not
// found, so a blurred frame is never silently accepted.

import { getLatestFullFrame, waitForFreshCameraFrame } from '@/hooks/cameraStreamManager';
import type { CameraPixelFormat } from '@/types/camera';
import { varianceOfLaplacian } from '@/utils/focusScore';

export type FocusKind = 'coarse' | 'fine';
type ZDir = 'up' | 'down';
type MoveZResult = { ok: boolean; preempted?: boolean; message?: string; error?: string };
/** One RX-gated Z step in the given direction at the given focus step size. */
export type MoveZStep = (direction: ZDir, focus: FocusKind) => Promise<MoveZResult>;

export type AutofocusResult = {
  ok: boolean;
  /** A genuine interior sharpness peak was located and the stage parked on it. */
  peakFound: boolean;
  bestScore: number;
  baselineScore: number;
  /** Total Z steps issued (scan + unwind + return-to-best). */
  steps: number;
  message?: string;
};

// Bounded scan: caps how far the search can travel from the start on each side,
// so a flat/featureless scene can never run the stage away. Steps are in units of
// the configured focus step (coarse vs fine), not millimetres — the Z controller
// has no verified µm↔pulse mapping, so the search stays in step space.
const MAX_STEPS_PER_SIDE: Record<FocusKind, number> = { coarse: 20, fine: 25 };
// After the running peak, this many consecutive non-improving samples ends a scan
// direction early (we have clearly passed the peak).
const DECLINE_PATIENCE = 3;
const FRAME_WAIT_MS = 1500;

let running = false;
export function isAutofocusRunning(): boolean {
  return running;
}

function channelsFor(format: CameraPixelFormat): number {
  switch (format) {
    case 'mono8':
      return 1;
    case 'rgb24':
    case 'bgr24':
      return 3;
    case 'rgb32':
    case 'rgba32':
    case 'bgr32':
      return 4;
    default:
      return 1; // 'raw' — best-effort; relative score still tracks focus
  }
}

/** Score the most recently decoded full frame, or null if none is available. */
function scoreLatestFrame(): number | null {
  const f = getLatestFullFrame();
  if (!f || f.width <= 0 || f.height <= 0) return null;
  return varianceOfLaplacian(f.body as ArrayBuffer, f.width, f.height, channelsFor(f.pixelFormat));
}

/** Wait for a fresh frame (post-move), then score it. */
async function sampleAfterMove(): Promise<number | null> {
  await waitForFreshCameraFrame(FRAME_WAIT_MS);
  return scoreLatestFrame();
}

/** True when `bestOffset` is an interior maximum — lower neighbours on both sides. */
function isInteriorPeak(samples: Map<number, number>, bestOffset: number, bestScore: number): boolean {
  const left = samples.get(bestOffset - 1);
  const right = samples.get(bestOffset + 1);
  return left != null && right != null && bestScore > left && bestScore > right;
}

export async function runAutofocus(moveZ: MoveZStep, focus: FocusKind): Promise<AutofocusResult> {
  if (running) {
    return { ok: false, peakFound: false, bestScore: 0, baselineScore: 0, steps: 0, message: 'Autofocus already running.' };
  }
  running = true;
  let steps = 0;
  try {
    // eslint-disable-next-line no-console
    console.log(`[FOCUS] Scan Started kind=${focus} maxStepsPerSide=${MAX_STEPS_PER_SIDE[focus]}`);

    const baseline = await sampleAfterMove();
    if (baseline == null) {
      // eslint-disable-next-line no-console
      console.warn('[FOCUS] Focus Failed reason=no-frame');
      return { ok: false, peakFound: false, bestScore: 0, baselineScore: 0, steps, message: 'No camera frame available for autofocus.' };
    }
    // offset 0 = starting Z; positive = up, negative = down, in focus steps.
    const samples = new Map<number, number>([[0, baseline]]);
    // eslint-disable-next-line no-console
    console.log(`[FOCUS] Z Position = 0 | Sharpness Score = ${baseline.toFixed(1)}`);

    const maxSteps = MAX_STEPS_PER_SIDE[focus];

    // Scan one direction until the score declines past the peak or the range is
    // exhausted; returns how many steps were actually taken so we can unwind.
    const scan = async (dir: ZDir, sign: 1 | -1): Promise<number> => {
      let best = baseline;
      let declining = 0;
      let taken = 0;
      for (let i = 1; i <= maxSteps; i += 1) {
        const r = await moveZ(dir, focus);
        if (!r.ok) {
          // eslint-disable-next-line no-console
          console.warn(`[FOCUS] move failed dir=${dir} step=${i} msg=${r.message ?? r.error ?? 'unknown'}`);
          break;
        }
        steps += 1;
        taken = i;
        const score = (await sampleAfterMove()) ?? 0;
        samples.set(sign * i, score);
        // eslint-disable-next-line no-console
        console.log(`[FOCUS] Z Position = ${sign * i} | Sharpness Score = ${score.toFixed(1)}`);
        if (score > best) {
          best = score;
          declining = 0;
        } else {
          declining += 1;
          if (declining >= DECLINE_PATIENCE) break;
        }
      }
      return taken;
    };

    // Scan up, unwind back to the start, scan down. The search is symmetric so the
    // peak is found whether focus is above or below the starting Z.
    const upSteps = await scan('up', 1);
    for (let i = 0; i < upSteps; i += 1) {
      const r = await moveZ('down', focus);
      if (r.ok) steps += 1;
    }
    const downSteps = await scan('down', -1);
    let currentOffset = -downSteps;

    let bestOffset = 0;
    let bestScore = -Infinity;
    for (const [off, sc] of samples) {
      if (sc > bestScore) {
        bestScore = sc;
        bestOffset = off;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[FOCUS] Best Score Found offset=${bestOffset} score=${bestScore.toFixed(1)}`);

    // eslint-disable-next-line no-console
    console.log('[FOCUS] Returning To Best Position');
    const delta = bestOffset - currentOffset;
    const dir: ZDir = delta >= 0 ? 'up' : 'down';
    for (let i = 0; i < Math.abs(delta); i += 1) {
      const r = await moveZ(dir, focus);
      if (r.ok) {
        steps += 1;
        currentOffset += delta >= 0 ? 1 : -1;
      }
    }
    await sampleAfterMove();

    const peakFound = isInteriorPeak(samples, bestOffset, bestScore);
    if (peakFound) {
      // eslint-disable-next-line no-console
      console.log(`[FOCUS] Focus Complete peak=true score=${bestScore.toFixed(1)}`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[FOCUS] Focus Failed reason=no-clear-peak best=${bestScore.toFixed(1)} (true focus may be outside scan range)`);
    }

    return {
      ok: true,
      peakFound,
      bestScore,
      baselineScore: baseline,
      steps,
      message: peakFound ? undefined : 'No clear focus peak found within range — image may still be blurred.',
    };
  } finally {
    running = false;
  }
}
