// Execution state-machine vocabulary for the industrial Multipoint engine.
// The engine phase is a single enum (no nested boolean flags); each point also
// tracks the status of its four atomic operations independently so the table can
// render per-step progress.

import type { DiamondGeometry } from '@/types/measurement';

export type EnginePhase =
  | 'idle'
  | 'moving'
  | 'focusing'
  | 'indenting'
  | 'measuring'
  | 'saving'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error';

// One atomic operation's progress within a point.
export type AtomicStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

// The four atomic operations a point passes through, in order.
export type AtomicStep = 'move' | 'focus' | 'indent' | 'measure';

export type PointExecState = {
  pointId: string;
  pointNo: number;
  move: AtomicStatus;
  focus: AtomicStatus;
  indent: AtomicStatus;
  measure: AtomicStatus;
  hv: number | null;
  d1Um: number | null;
  d2Um: number | null;
  durationMs: number | null;
  error: string | null;
};

// Phases at which the engine is actively driving hardware (used to gate the UI
// and the safety re-check between atomic steps).
export const ACTIVE_PHASES: ReadonlySet<EnginePhase> = new Set<EnginePhase>([
  'moving',
  'focusing',
  'indenting',
  'measuring',
  'saving',
]);

export function isRunning(phase: EnginePhase): boolean {
  return ACTIVE_PHASES.has(phase) || phase === 'paused';
}

// ── Injected measurement primitive ──────────────────────────────────────────
// The engine does NOT own the Vickers detection/save pipeline (that lives in
// App, which has the camera frame, calibration, settings and refs). App supplies
// this real primitive — same injection pattern as `onValidateStart`. No mock.

export type MeasurePointInput = {
  runId: string;
  pointId: string;
  pointNo: number;
  /** Absolute machine coordinates the stage was driven to (mm). */
  xMm: number;
  yMm: number;
};

export type MeasurePointOutcome = {
  /** Detection succeeded, overlay painted, and not rejected → a real result. */
  ok: boolean;
  /** True when detection ran but was rejected for low confidence (no save). */
  rejected?: boolean;
  hv: number | null;
  d1Um: number | null;
  d2Um: number | null;
  confidence: number | null;
  /** Id of the saved measurements row, when a measurement was committed. */
  measurementId: string | null;
  message?: string;
};

export type MeasurePointFn = (input: MeasurePointInput) => Promise<MeasurePointOutcome>;

/**
 * Indenting-mode review capture: after an indent (no metrology), grab a still +
 * best-effort diamond geometry so the point can be revisited on GO. No HV is
 * computed and nothing is rejected — every indent yields at least an image.
 */
export type CaptureReviewResult = {
  /** Captured still (baked thumbnail) for the review display. */
  imageDataUrl?: string | null;
  /** Diamond vertices NORMALISED to 0..1 of the captured frame, when detected. */
  diamond?: DiamondGeometry | null;
  /** Indentation centre NORMALISED to 0..1, when detected (else frame centre). */
  centerNorm?: { x: number; y: number } | null;
};
export type CaptureReviewFn = (input: MeasurePointInput) => Promise<CaptureReviewResult>;

/** Operator command that releases a paused/failed gate inside the run loop. */
export type ExecutionDecision = 'resume' | 'retry' | 'skip' | 'stop';
