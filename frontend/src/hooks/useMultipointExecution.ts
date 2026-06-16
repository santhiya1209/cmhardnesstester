import { useCallback, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  selectGeneratedPoints,
  selectProgramMeta,
} from '@/store/slices/multipoint.selectors';
import {
  atomicStatusChanged,
  executionReset,
  passChanged,
  phaseChanged,
  pointCompleted,
  pointDurationSet,
  pointEntered,
  pointErrored,
  pointMeasured,
  runErrored,
  runFinished,
  runInitialized,
} from '@/store/slices/multipointExecution.slice';
import {
  selectExecCompletedCount,
  selectExecCurrentPointNo,
  selectExecErrorMessage,
  selectExecPass,
  selectExecPhase,
  selectExecPoints,
  selectExecStartedAtMs,
  selectExecStatusMessage,
  selectExecTotal,
} from '@/store/slices/multipointExecution.selectors';
import { useXyzStageState } from '@/hooks/queries/useXyzStageState';
import { useCameraStatus } from '@/hooks/queries/useCameraStatus';
import { useXyzPlatformHardware } from '@/features/xyzPlatform/useXyzPlatformHardware';
import { useMachineStoreApi } from '@/contexts/MachineStateContext';
import { useStartIndent } from '@/hooks/mutations/useStartIndent';
import { useSaveMultipointResult } from '@/hooks/mutations/useSaveMultipointResult';
import { buildMultipointExecutionRequest } from '@/utils/multipointExecution';
import { waitForIndentTerminal } from '@/utils/indentCompletion';
import type {
  AtomicStep,
  EnginePhase,
  ExecutionDecision,
  MeasurePointFn,
} from '@/types/multipointExecution';
import type { PatternPoint } from '@/types/patternProgram';
import type {
  MultipointFocusStatus,
  MultipointIndentStatus,
  MultipointMeasureStatus,
} from '@/types/multipointResult';

// Failure guard for one indent cycle — completion is RX-gated, not timer-gated.
const INDENT_TIMEOUT_MS = 120000;
// Post-move optical settle before focus/measure (40X needs longer than low mags).
const SETTLE_MS_40X = 600;
const SETTLE_MS_DEFAULT = 350;

// A control signal raised by the operator that aborts the run loop cleanly.
class StopSignal extends Error {}
// A step failed; carries which step so retry can be step-aware (never re-indents).
class StepError extends Error {
  constructor(public step: AtomicStep, message: string) {
    super(message);
  }
}

type ExecOptions = {
  /** Real Vickers detection + save, injected by App (owns the pipeline). */
  measurePoint?: MeasurePointFn;
  /** Pre-flight gate (e.g. calibration-required dialog). Abort if it returns false. */
  onValidateStart?: () => boolean | Promise<boolean>;
  /** Operator name captured into each run record (no auth system). */
  operator?: string | null;
};

function settleMs(objective: string | null | undefined): number {
  return objective === '40X' ? SETTLE_MS_40X : SETTLE_MS_DEFAULT;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Industrial Multipoint execution engine. A single state machine drives every
 * generated point through its atomic operations (move → focus → indent →
 * measure), reusing the SAME hardware/indent primitives as the rest of the app
 * (no parallel motion system) and the injected real measurement primitive.
 *
 * Run controls (pause/resume/stop/skip/retry/re-measure) interrupt at atomic
 * boundaries only — a press/indent in flight always finishes before the engine
 * yields, so the machine is never left mid-cycle. Retry is step-aware: a point
 * whose indent already completed is never re-indented (no double impression).
 */
export function useMultipointExecution(options: ExecOptions = {}) {
  const dispatch = useAppDispatch();
  const generatedPoints = useAppSelector(selectGeneratedPoints);
  const programMeta = useAppSelector(selectProgramMeta);

  const phase = useAppSelector(selectExecPhase);
  const statusMessage = useAppSelector(selectExecStatusMessage);
  const errorMessage = useAppSelector(selectExecErrorMessage);
  const currentPointNo = useAppSelector(selectExecCurrentPointNo);
  const total = useAppSelector(selectExecTotal);
  const completedCount = useAppSelector(selectExecCompletedCount);
  const points = useAppSelector(selectExecPoints);
  const startedAtMs = useAppSelector(selectExecStartedAtMs);
  const pass = useAppSelector(selectExecPass);

  const stage = useXyzStageState();
  const { status: cameraStatus } = useCameraStatus();
  const hardware = useXyzPlatformHardware();
  const machineStore = useMachineStoreApi();
  const { start: fireIndent } = useStartIndent();
  const { saveMultipointResult } = useSaveMultipointResult();

  // Latest option values without re-creating the run loop on every render.
  const optsRef = useRef(options);
  optsRef.current = options;

  // Imperative control surface read by the running loop (refs, not React state,
  // so the loop sees operator commands without stale closures).
  const ctrl = useRef<{
    stop: boolean;
    pause: boolean;
    running: boolean;
    decide: ((cmd: ExecutionDecision) => void) | null;
  }>({ stop: false, pause: false, running: false, decide: null });

  const setPhase = useCallback(
    (p: EnginePhase, message?: string) => dispatch(phaseChanged({ phase: p, message })),
    [dispatch]
  );
  const setStep = useCallback(
    (pointId: string, step: AtomicStep, status: Parameters<typeof atomicStatusChanged>[0]['status']) =>
      dispatch(atomicStatusChanged({ pointId, step, status })),
    [dispatch]
  );

  // Park the loop until the operator issues a command (pause or post-failure
  // decision). Resolves with that command; toolbar handlers call resolveDecision.
  const awaitDecision = useCallback(
    (message: string): Promise<ExecutionDecision> => {
      setPhase('paused', message);
      return new Promise<ExecutionDecision>((resolve) => {
        ctrl.current.decide = (cmd) => {
          ctrl.current.decide = null;
          resolve(cmd);
        };
      });
    },
    [setPhase]
  );

  // Atomic-boundary checkpoint: honor a Stop or Pause request before the next op.
  const checkpoint = useCallback(async (): Promise<void> => {
    if (ctrl.current.stop) throw new StopSignal();
    if (ctrl.current.pause) {
      const cmd = await awaitDecision('Paused.');
      if (cmd === 'stop') throw new StopSignal();
      ctrl.current.pause = false;
    }
  }, [awaitDecision]);

  // Persist one point's run record (best-effort — a save failure never aborts
  // the run; it is logged and surfaced via the result hook's error).
  const persistResult = useCallback(
    async (args: {
      runId: string;
      point: PatternPoint;
      pass: 1 | 2 | null;
      focusStatus: MultipointFocusStatus;
      indentStatus: MultipointIndentStatus;
      measureStatus: MultipointMeasureStatus;
      hv: number | null;
      d1Um: number | null;
      d2Um: number | null;
      confidence: number | null;
      measurementId: string | null;
      durationMs: number;
    }) => {
      try {
        await saveMultipointResult({
          runId: args.runId,
          pointNo: args.point.no,
          pointId: args.point.id,
          pass: args.pass,
          xMm: args.point.x,
          yMm: args.point.y,
          focusStatus: args.focusStatus,
          indentStatus: args.indentStatus,
          measureStatus: args.measureStatus,
          hv: args.hv,
          d1Um: args.d1Um,
          d2Um: args.d2Um,
          averageUm:
            args.d1Um != null && args.d2Um != null ? (args.d1Um + args.d2Um) / 2 : null,
          testForceKgf: numericForce(machineStore.getSnapshot()?.force),
          objective: stage ? machineStore.getSnapshot()?.objective ?? null : null,
          confidence: args.confidence,
          measurementId: args.measurementId,
          operator: optsRef.current.operator ?? null,
          durationMs: args.durationMs,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[MP-EXEC] result-save-failed point=${args.point.no}`, err);
      }
    },
    [saveMultipointResult, machineStore, stage]
  );

  // Execute one point's atomic steps with step-aware retry. `doIndent`/`doMeasure`
  // select which steps run (two-pass splits them across passes). Returns the
  // terminal disposition for this point.
  const executePoint = useCallback(
    async (
      runId: string,
      point: PatternPoint,
      passNo: 1 | 2 | null,
      doIndent: boolean,
      doMeasure: boolean,
      indentAlreadyDone: boolean
    ): Promise<'ok' | 'skipped'> => {
      let indentDone = indentAlreadyDone;
      // Retry loop for THIS point. `continue` re-attempts after an operator retry.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        dispatch(pointEntered({ pointId: point.id, pointNo: point.no }));
        dispatch(pointErrored({ pointId: point.id, error: null }));
        const t0 = Date.now();
        let focusStatus: MultipointFocusStatus = 'not-available';
        let measureStatus: MultipointMeasureStatus = 'pending';
        let hv: number | null = null;
        let d1Um: number | null = null;
        let d2Um: number | null = null;
        let confidence: number | null = null;
        let measurementId: string | null = null;
        try {
          // ── MOVE ──────────────────────────────────────────────────────────
          await checkpoint();
          setPhase('moving', `Moving to point ${point.no}…`);
          setStep(point.id, 'move', 'active');
          const moved = await hardware.moveToPoint(point.x, point.y);
          if (!moved.ok) throw new StepError('move', moved.message ?? moved.error ?? 'Move failed');
          setStep(point.id, 'move', 'done');

          // ── FOCUS (honest: settle only; no autofocus hardware exists) ──────
          await checkpoint();
          setPhase('focusing', `Settling at point ${point.no}…`);
          setStep(point.id, 'focus', 'active');
          await delay(settleMs(machineStore.getSnapshot()?.objective));
          focusStatus = 'settled';
          setStep(point.id, 'focus', 'done');

          // ── INDENT (skip if already impressed; never double-indent) ────────
          if (doIndent && !indentDone) {
            await checkpoint();
            setPhase('indenting', `Indenting at point ${point.no}…`);
            setStep(point.id, 'indent', 'active');
            await fireIndent();
            const outcome = await waitForIndentTerminal(machineStore, INDENT_TIMEOUT_MS);
            if (outcome !== 'completed') throw new StepError('indent', `Indent ${outcome}`);
            setStep(point.id, 'indent', 'done');
            indentDone = true;
          } else if (indentDone) {
            setStep(point.id, 'indent', 'done');
          }

          // ── MEASURE (injected real Vickers detection + save) ──────────────
          if (doMeasure) {
            const measure = optsRef.current.measurePoint;
            if (!measure) {
              measureStatus = 'skipped';
              setStep(point.id, 'measure', 'skipped');
            } else {
              await checkpoint();
              setPhase('measuring', `Measuring point ${point.no}…`);
              setStep(point.id, 'measure', 'active');
              const m = await measure({ runId, pointId: point.id, pointNo: point.no, xMm: point.x, yMm: point.y });
              hv = m.hv;
              d1Um = m.d1Um;
              d2Um = m.d2Um;
              confidence = m.confidence;
              measurementId = m.measurementId;
              dispatch(pointMeasured({ pointId: point.id, hv, d1Um, d2Um }));
              if (!m.ok) {
                measureStatus = m.rejected ? 'rejected' : 'failed';
                throw new StepError('measure', m.message ?? (m.rejected ? 'Low confidence' : 'Measurement failed'));
              }
              measureStatus = 'measured';
              setStep(point.id, 'measure', 'done');
            }
          }

          // ── SAVE run record ───────────────────────────────────────────────
          const durationMs = Date.now() - t0;
          dispatch(pointDurationSet({ pointId: point.id, durationMs }));
          setPhase('saving', `Saving point ${point.no}…`);
          await persistResult({
            runId,
            point,
            pass: passNo,
            focusStatus,
            indentStatus: doIndent || indentDone ? 'indented' : 'skipped',
            measureStatus: doMeasure ? measureStatus : 'pending',
            hv,
            d1Um,
            d2Um,
            confidence,
            measurementId,
            durationMs,
          });
          dispatch(pointCompleted({ pointId: point.id }));
          return 'ok';
        } catch (err) {
          if (err instanceof StopSignal) throw err;
          const stepErr = err instanceof StepError ? err : new StepError('move', err instanceof Error ? err.message : String(err));
          // Mark the failed step and surface the reason on the row.
          setStep(point.id, stepErr.step, 'failed');
          dispatch(pointErrored({ pointId: point.id, error: stepErr.message }));
          // Await the operator's decision. Re-measure maps to 'retry' on a measure
          // failure; because indentDone is preserved, a retry never re-indents.
          const cmd = await awaitDecision(
            `Point ${point.no} failed at ${stepErr.step}: ${stepErr.message}`
          );
          if (cmd === 'stop') throw new StopSignal();
          if (cmd === 'skip') {
            (['move', 'focus', 'indent', 'measure'] as AtomicStep[]).forEach((s) => {
              if (points[point.id]?.[s] !== 'done') setStep(point.id, s, 'skipped');
            });
            await persistResult({
              runId,
              point,
              pass: passNo,
              focusStatus,
              indentStatus: indentDone ? 'indented' : 'skipped',
              measureStatus: 'skipped',
              hv,
              d1Um,
              d2Um,
              confidence,
              measurementId,
              durationMs: Date.now() - t0,
            });
            return 'skipped';
          }
          // 'retry' / 'resume' → loop and re-attempt (step-aware via indentDone).
        }
      }
    },
    [
      dispatch,
      checkpoint,
      setPhase,
      setStep,
      hardware,
      fireIndent,
      machineStore,
      persistResult,
      awaitDecision,
      points,
    ]
  );

  const start = useCallback(async () => {
    if (ctrl.current.running) return;
    // ── Safety gate (fail fast, before any motion) ─────────────────────────
    if (generatedPoints.length === 0) {
      setPhase('idle', 'No generated points to run.');
      return;
    }
    if (!cameraStatus.streaming) {
      setPhase('idle', 'Camera is not live — open and start the camera before running.');
      return;
    }
    if (!stage.connected) return void setPhase('idle', 'XYZ stage not connected.');
    if (!stage.xyLocked) return void setPhase('idle', 'XY stage not locked.');
    if (stage.centerX === null || stage.centerY === null) {
      return void setPhase('idle', 'Set the optical center before running.');
    }
    if (!(machineStore.getSnapshot()?.connected ?? false)) {
      return void setPhase('idle', 'Hardness machine not connected.');
    }
    const validate = optsRef.current.onValidateStart;
    if (validate && !(await validate())) return;

    const request = buildMultipointExecutionRequest(generatedPoints, programMeta);
    const runId = `run-${Date.now()}`;
    ctrl.current = { stop: false, pause: false, running: true, decide: null };
    dispatch(
      runInitialized({
        runId,
        startedAtMs: Date.now(),
        points: request.points.map((p) => ({ pointId: p.id, pointNo: p.no })),
      })
    );

    const home =
      stage.positionKnown && Number.isFinite(stage.positionMm.x) && Number.isFinite(stage.positionMm.y)
        ? { x: stage.positionMm.x, y: stage.positionMm.y }
        : null;

    try {
      if (request.impressMode === 'TWO_PASS_IMPRESS') {
        // Pass 1: indent every point (no measure) so all impressions stabilize.
        dispatch(passChanged(1));
        for (const point of request.points) {
          await executePoint(runId, point, 1, true, false, false);
        }
        // Pass 2: return to each point and measure.
        dispatch(passChanged(2));
        for (const point of request.points) {
          // indentAlreadyDone = true → pass 2 never re-indents.
          await executePoint(runId, point, 2, false, true, true);
        }
      } else {
        // INDENTING = move+focus+indent; ONE_PASS = + measure.
        const doMeasure = request.impressMode === 'ONE_PASS_IMPRESS';
        for (const point of request.points) {
          await executePoint(runId, point, null, true, doMeasure, false);
        }
      }

      // Return to the captured reference/objective position.
      if (home) {
        setPhase('moving', 'Returning to reference position…');
        await hardware.moveToPoint(home.x, home.y);
      }
      dispatch(
        runFinished({
          phase: 'completed',
          finishedAtMs: Date.now(),
          message: `Run complete — ${request.points.length} point(s).`,
        })
      );
    } catch (err) {
      if (err instanceof StopSignal) {
        dispatch(
          runFinished({
            phase: 'stopped',
            finishedAtMs: Date.now(),
            message: 'Run stopped. Completed results preserved.',
          })
        );
      } else {
        dispatch(runErrored({ message: err instanceof Error ? err.message : String(err) }));
      }
    } finally {
      ctrl.current.running = false;
      ctrl.current.decide = null;
    }
  }, [
    generatedPoints,
    programMeta,
    cameraStatus.streaming,
    stage,
    machineStore,
    dispatch,
    setPhase,
    executePoint,
    hardware,
  ]);

  // ── Operator controls (resolve a parked gate, or set a deferred flag) ──────
  const pause = useCallback(() => {
    if (!ctrl.current.running) return;
    ctrl.current.pause = true;
    setPhase('paused', 'Pause requested — finishing current operation…');
  }, [setPhase]);

  const resume = useCallback(() => {
    ctrl.current.pause = false;
    if (ctrl.current.decide) ctrl.current.decide('resume');
  }, []);

  const stop = useCallback(() => {
    ctrl.current.stop = true;
    if (ctrl.current.decide) ctrl.current.decide('stop');
  }, []);

  const skip = useCallback(() => {
    if (ctrl.current.decide) ctrl.current.decide('skip');
  }, []);

  const retry = useCallback(() => {
    if (ctrl.current.decide) ctrl.current.decide('retry');
  }, []);

  // Re-measure = retry the measure of a point paused after a measure failure.
  const remeasure = retry;

  const reset = useCallback(() => {
    if (ctrl.current.running) return;
    dispatch(executionReset());
  }, [dispatch]);

  const progressPct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const running = ctrl.current.running;
  // Awaiting a parked decision (failure or pause) — toolbar shows retry/skip.
  const awaitingDecision = phase === 'paused' && ctrl.current.decide !== null;

  return useMemo(
    () => ({
      phase,
      statusMessage,
      errorMessage,
      currentPointNo,
      total,
      completedCount,
      progressPct,
      points,
      pass,
      startedAtMs,
      running,
      awaitingDecision,
      start,
      pause,
      resume,
      stop,
      skip,
      retry,
      remeasure,
      reset,
    }),
    [
      phase,
      statusMessage,
      errorMessage,
      currentPointNo,
      total,
      completedCount,
      progressPct,
      points,
      pass,
      startedAtMs,
      running,
      awaitingDecision,
      start,
      pause,
      resume,
      stop,
      skip,
      retry,
      remeasure,
      reset,
    ]
  );
}

// The machine `force` is a string like '0.5kgf' or a number; extract the kgf.
function numericForce(force: string | number | undefined): number | null {
  if (force == null) return null;
  if (typeof force === 'number') return Number.isFinite(force) ? force : null;
  const m = force.match(/[\d.]+/);
  return m ? Number(m[0]) : null;
}
