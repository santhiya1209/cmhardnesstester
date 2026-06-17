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
import { useTurret } from '@/hooks/mutations/useTurret';
import { useSaveMultipointResult } from '@/hooks/mutations/useSaveMultipointResult';
import { buildMultipointExecutionRequest } from '@/utils/multipointExecution';
import { waitForIndentTerminal } from '@/utils/indentCompletion';
import { resolveDisplayOrigin } from '@/utils/coordinate';
import type { TurretDirection } from '@/types/machine';
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

// The turret carries the viewing objectives on its left/right slots (10X / 40X) —
// the inverse of MachineControlTab's handleTurretClick mapping. Used to rotate the
// turret back to the active objective lens at end-of-cycle so the operator can
// inspect every indent through the lens (the per-indent turret-return is
// setting-dependent and off for indent-only runs). Objectives with no slot button
// (IND/center and others) are intentionally absent → no end-of-cycle rotation.
const OBJECTIVE_TO_TURRET: Record<string, TurretDirection> = {
  '10X': 'left',
  '40X': 'right',
};

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
  /** Resume the live camera display (App owns the camera). Called at each point
   *  boundary and run start/end: the measure step freezes the display to paint
   *  the overlay, so without this the feed sticks on the last measured frame. */
  onResumeLive?: () => void;
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
  const { move: moveTurret } = useTurret();
  const { saveMultipointResult } = useSaveMultipointResult();

  // Latest option values without re-creating the run loop on every render.
  const optsRef = useRef(options);
  optsRef.current = options;

  // Live stage snapshot for the focus step (Z lock + Z speed) read inside the
  // loop without adding `stage` — which changes on every streamed position
  // frame — to executePoint/start deps and churning the run callbacks.
  const stageRef = useRef(stage);
  stageRef.current = stage;

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

  // One single-click FINE Z focus step DOWN — the same CFOCUS/FFOCUS primitive
  // the XYZPlatform tab's focus button issues (one fixed fine step per call, NOT
  // an autofocus search). Z motion requires the drive to be locked (#LK#); if it
  // is not, focus is unavailable and we fall back to the optical settle delay
  // only, mirroring the focus button's z-unlocked guard. RX-gated like every
  // other hardware move; a move failure is logged, not thrown (focus is never
  // worth aborting the run over). Followed by an objective-dependent settle.
  const focusStepFine = useCallback(async (): Promise<MultipointFocusStatus> => {
    const objective = machineStore.getSnapshot()?.objective;
    const s = stageRef.current;
    if (!s.zLocked) {
      // eslint-disable-next-line no-console
      console.warn('[FOCUS] blocked reason=z-unlocked focus=fine source=multipoint');
      await delay(settleMs(objective));
      return 'not-available';
    }
    // eslint-disable-next-line no-console
    console.log('[xyz-ui-action] action=focus-fine source=multipoint');
    const result = await hardware.moveZ('down', s.zSpeed, 'fine');
    if (!result.ok && !result.preempted) {
      // eslint-disable-next-line no-console
      console.warn(`[FOCUS] step failed: ${result.message ?? result.error ?? 'unknown'}`);
    }
    await delay(settleMs(objective));
    return 'settled';
  }, [hardware, machineStore]);

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
      doFocus: boolean,
      doIndent: boolean,
      doMeasure: boolean,
      indentAlreadyDone: boolean,
      origin: { x: number; y: number }
    ): Promise<'ok' | 'skipped'> => {
      let indentDone = indentAlreadyDone;
      // Retry loop for THIS point. `continue` re-attempts after an operator retry.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        dispatch(pointEntered({ pointId: point.id, pointNo: point.no }));
        dispatch(pointErrored({ pointId: point.id, error: null }));
        if (passNo === 1) {
          // eslint-disable-next-line no-console
          console.log('[PASS1_POINT_START]', point.no);
        } else if (passNo === 2) {
          // eslint-disable-next-line no-console
          console.log('[PASS2_POINT_START]', point.no);
        }
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
          // Return the display to live before each move so the operator watches
          // the stage travel — the previous point's measure left it frozen on the
          // captured/overlay frame. No-op when not frozen.
          optsRef.current.onResumeLive?.();
          // Generated points are stored ABSOLUTE stage mm, but moveToPoint expects
          // mm OFFSETS from the taught optical center (backend: target = center +
          // offset*pulsePerMm). Rebase into the same display-origin frame the
          // preview table shows (point − origin) so Start drives exactly the
          // previewed coordinate — never the absolute value, which would re-apply
          // the center and fling the stage ~one center away into the soft limit.
          const targetX = point.x - origin.x;
          const targetY = point.y - origin.y;
          // eslint-disable-next-line no-console
          console.log('[START]', point);
          // eslint-disable-next-line no-console
          console.log('[MOVE_TARGET]', targetX, targetY);
          const moved = await hardware.moveToPoint(targetX, targetY);
          if (!moved.ok) throw new StepError('move', moved.message ?? moved.error ?? 'Move failed');
          setStep(point.id, 'move', 'done');

          // ── FOCUS (FocusAll-gated; one fine Z step DOWN per point — NOT an
          //    autofocus search). When FocusAll is OFF the focus step runs at
          //    every point (local per-point focus); when ON it is skipped
          //    per-point because the single global FOCUS_ALL baseline already
          //    ran once before the loop. The two paths are mutually exclusive —
          //    global focus and per-point focus never both fully execute. ────
          await checkpoint();
          if (doFocus) {
            if (passNo === 1) {
              // eslint-disable-next-line no-console
              console.log('[PASS1_FOCUS]', point.no);
            } else if (passNo === 2) {
              // eslint-disable-next-line no-console
              console.log('[PASS2_FOCUS]', point.no);
            }
            // eslint-disable-next-line no-console
            console.log('[POINT_FOCUS_LOCAL]', point.no);
            setPhase('focusing', `Focusing at point ${point.no}…`);
            setStep(point.id, 'focus', 'active');
            focusStatus = await focusStepFine();
            setStep(point.id, 'focus', 'done');
          } else {
            // eslint-disable-next-line no-console
            console.log('[POINT_FOCUS_SKIP_GLOBAL_ACTIVE]', point.no);
            focusStatus = 'skipped';
            setStep(point.id, 'focus', 'skipped');
          }

          // ── INDENT (skip if already impressed; never double-indent) ────────
          if (doIndent && !indentDone) {
            await checkpoint();
            if (passNo === 1) {
              // eslint-disable-next-line no-console
              console.log('[PASS1_INDENT]', point.no);
            }
            // eslint-disable-next-line no-console
            console.log('[INDENT_START]', point.no);
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
              // A measuring mode (One/Two Pass) with no measurePoint injected is a
              // misconfiguration, not a valid skip — surface it loudly rather than
              // marking the point "Completed" with a silent skip and no HV.
              measureStatus = 'failed';
              throw new StepError('measure', 'No measurement primitive available (measurePoint not injected).');
            } else {
              await checkpoint();
              if (passNo === 2) {
                // eslint-disable-next-line no-console
                console.log('[PASS2_MEASURE]', point.no);
              }
              // eslint-disable-next-line no-console
              console.log('[MEASURE_START]', point.no);
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
              if (passNo === 2) {
                // eslint-disable-next-line no-console
                console.log('[HV_RESULT]', point.no, hv);
              }
              measureStatus = 'measured';
              setStep(point.id, 'measure', 'done');
            }
          } else if (passNo !== 1) {
            // No measure for this point (Indenting mode). Mark it skipped so the
            // row reads "Completed" — NOT pending. Two-pass pass 1 (passNo === 1)
            // is intentionally left pending so it reads "Pass1 Complete" until
            // pass 2 measures it.
            measureStatus = 'skipped';
            setStep(point.id, 'measure', 'skipped');
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
          if (passNo === 1) {
            // eslint-disable-next-line no-console
            console.log('[PASS1_COMPLETE]', point.no);
          } else if (passNo === 2) {
            // eslint-disable-next-line no-console
            console.log('[PASS2_COMPLETE]', point.no);
          }
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
      focusStepFine,
      points,
    ]
  );

  const start = useCallback(async () => {
    // eslint-disable-next-line no-console
    console.log(
      `[MP-EXEC] start clicked: running=${ctrl.current.running} points=${generatedPoints.length} streaming=${cameraStatus.streaming} connected=${stage.connected} xyLocked=${stage.xyLocked} centerX=${stage.centerX} centerY=${stage.centerY} machineConnected=${machineStore.getSnapshot()?.connected ?? false}`
    );
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
    if (validate && !(await validate())) {
      // eslint-disable-next-line no-console
      console.log('[MP-EXEC] blocked by onValidateStart (calibration gate)');
      return;
    }
    // eslint-disable-next-line no-console
    console.log('[MP-EXEC] all gates passed — beginning run');

    const request = buildMultipointExecutionRequest(generatedPoints, programMeta);
    const focusAll = request.focusAll;
    // eslint-disable-next-line no-console
    console.log('[FOCUS_ALL]', focusAll);
    // Decision diagnostic: a "Measure = skip / HV = -" report means the measure
    // step is being skipped, not failing. It is skipped only when impressMode is
    // not ONE_PASS_IMPRESS (doMeasure=false) or no measurePoint was injected.
    // This one line prints both so a single run pinpoints which.
    // eslint-disable-next-line no-console
    console.log(
      `[MP-EXEC] measure-decision impressMode=${request.impressMode} measurePointInjected=${!!optsRef.current.measurePoint}`
    );
    const runId = `run-${Date.now()}`;
    ctrl.current = { stop: false, pause: false, running: true, decide: null };
    dispatch(
      runInitialized({
        runId,
        startedAtMs: Date.now(),
        points: request.points.map((p) => ({ pointId: p.id, pointNo: p.no })),
      })
    );

    // Rebase origin: the absolute-mm → optical-center-offset frame moveToPoint
    // consumes, captured ONCE here so every point uses a STABLE anchor (the live
    // stage position drifts as the run moves). Same origin the preview table and
    // reference readout use (resolveDisplayOrigin), so previewed coordinate ==
    // executed coordinate. Relocation origin when taught; live crosshair otherwise.
    const origin = resolveDisplayOrigin(stage.relocationOriginMm, stage.positionMm, stage.positionKnown);
    // eslint-disable-next-line no-console
    console.log(
      `[MP-EXEC] rebase-origin x=${origin.x} y=${origin.y} source=${stage.relocationOriginMm ? 'relocation' : 'live-position'}`
    );

    const home =
      stage.positionKnown && Number.isFinite(stage.positionMm.x) && Number.isFinite(stage.positionMm.y)
        ? { x: stage.positionMm.x, y: stage.positionMm.y }
        : null;

    try {
      // Clear any stale freeze left by a prior manual measure so the feed is
      // live from the moment the run begins (e.g. Indenting mode never calls the
      // measure path, so nothing else would resume it).
      optsRef.current.onResumeLive?.();
      // FocusAll ON: run the global focus baseline exactly once here, before the
      // loop, as a stabilization step for the whole run (suited to very flat
      // specimens). One fine Z step DOWN — the same single-click primitive the
      // per-point focus uses — so a FocusAll run still performs a real focus
      // move; the per-point focus step is then skipped for every point (global
      // and per-point focus never both execute).
      if (focusAll) {
        // eslint-disable-next-line no-console
        console.log('[FOCUS_ALL_START]');
        setPhase('focusing', 'Focus All — global baseline…');
        await focusStepFine();
        // eslint-disable-next-line no-console
        console.log('[FOCUS_ALL_DONE]');
      }

      if (request.impressMode === 'TWO_PASS_IMPRESS') {
        // eslint-disable-next-line no-console
        console.log('[TWO_PASS_START]');
        // Pass 1: indent every point (no measure) so all impressions stabilize.
        dispatch(passChanged(1));
        for (const point of request.points) {
          // doFocus = !focusAll → per-point focus only when FocusAll is OFF.
          await executePoint(runId, point, 1, !focusAll, true, false, false, origin);
        }
        // Pass 2: return to each point and measure.
        dispatch(passChanged(2));
        for (const point of request.points) {
          // indentAlreadyDone = true → pass 2 never re-indents.
          await executePoint(runId, point, 2, !focusAll, false, true, true, origin);
        }
      } else {
        // INDENTING = move+focus+indent; ONE_PASS = + measure.
        const doMeasure = request.impressMode === 'ONE_PASS_IMPRESS';
        for (const point of request.points) {
          // doFocus = !focusAll → per-point focus only when FocusAll is OFF.
          await executePoint(runId, point, null, !focusAll, true, doMeasure, false, origin);
        }
      }

      // Return to the captured reference/objective position. Same rebase as the
      // points: `home` is the absolute start position, so subtract the origin to
      // get the optical-center offset moveToPoint expects.
      if (home) {
        setPhase('moving', 'Returning to reference position…');
        await hardware.moveToPoint(home.x - origin.x, home.y - origin.y);
      }

      // End-of-cycle: rotate the turret back to the viewing objective so the
      // operator can inspect every indent through the lens. The per-indent
      // turret-return (indent 'X'/'P' suffix) is driven by the auto-measure
      // setting and is off for indent-only runs, so the cycle could otherwise end
      // with the indenter — not the objective — over the sample. Same RX-gated
      // turret command as the Machine Control tab; a failure here is non-fatal
      // (the measurement work already succeeded), so it is logged, not thrown.
      const endObjective = (machineStore.getSnapshot()?.objective ?? '').trim().toUpperCase();
      const turretDir = OBJECTIVE_TO_TURRET[endObjective];
      if (turretDir) {
        setPhase('moving', `Returning turret to ${endObjective} objective…`);
        try {
          await moveTurret(turretDir);
          // eslint-disable-next-line no-console
          console.log(`[MP-EXEC] turret-return objective=${endObjective} direction=${turretDir}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[MP-EXEC] turret-return-failed objective=${endObjective}`, err);
        }
      } else {
        // eslint-disable-next-line no-console
        console.log(
          `[MP-EXEC] turret-return-skip objective=${endObjective || 'unknown'} reason=no-direction-mapping`
        );
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
      // Return the display to live when the run ends (complete/stopped/error) so
      // it never stays frozen on the last measured point's overlay.
      optsRef.current.onResumeLive?.();
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
    focusStepFine,
    hardware,
    moveTurret,
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
