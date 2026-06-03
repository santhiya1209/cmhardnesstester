import { useCallback, useEffect, useRef } from 'react';
import type { CameraWindowHandle } from '@/component/own/CameraWindow';
import type { AutoMeasureStatusState } from '@/component/own/StatusBar';
import type {
  AutoMeasureGraphics,
} from '@/types/autoMeasure';
import type { AutoMeasureSettingsPayload } from '@/types/autoMeasureSettings';
import type { RunAutoMeasure } from '@/features/autoMeasure/autoMeasureHelpers';
import type { IndentStatus, MachineState } from '@/types/machine';

function logAfterImpressDetectionFailed(reason: string) {
  // eslint-disable-next-line no-console
  console.warn(`[after-impress-detection-failed] reason=${reason}`);
}

// Two RAFs guarantees overlay canvases (AutoMeasure / ManualMeasure) finished
// painting after a state-driven update before downstream consumers composite
// them.
function waitForOverlayPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Readiness signals the after-impress detection gate polls before running.
// All three are owned by App (camera-open state, the authoritative
// activeObjective, and the per-objective calibration lookup) and read through
// a stable callback so the hook never re-subscribes on their changes.
export type AfterImpressReadiness = {
  cameraOpen: boolean;
  activeObjective: string | null;
  calibrationReady: boolean;
};

export type UseAfterImpressFlowArgs = {
  machineIndentStatus: IndentStatus | null;
  machineLastObjectiveRx: string | null;
  cameraRef: React.RefObject<CameraWindowHandle | null>;
  getAfterImpressReadiness: () => AfterImpressReadiness;

  // App-owned auto-measure session refs read/written by the flow
  activeObjectiveRef: React.MutableRefObject<string | null>;
  autoMeasureInFlightRef: React.MutableRefObject<boolean>;
  runAutoMeasureRef: React.MutableRefObject<RunAutoMeasure | null>;
  displayedAutoMeasureGraphicsRef: React.MutableRefObject<AutoMeasureGraphics | null>;
  autoMeasurementIdRef: React.MutableRefObject<string | null>;
  latestAutoMeasurePreviewSettingsRef: React.MutableRefObject<AutoMeasureSettingsPayload>;
  liveMachineStateRef: React.MutableRefObject<MachineState | null>;
  suppressAutoMeasurePreviewRef: React.MutableRefObject<boolean>;

  // Setters
  setAutoMeasureStatus: (next: AutoMeasureStatusState) => void;
  setStatusMessage: (message: string) => void;
  setManualMeasureResetKey: React.Dispatch<React.SetStateAction<number>>;
  setAutoMeasureClearNonce: React.Dispatch<React.SetStateAction<number>>;

  // Cross-feature callbacks
  clearActiveMeasurement: (reason: string) => void;
  clearAutoMeasureOverlay: (reason: string) => void;
};

export type UseAfterImpressFlowResult = {
  // Read by runAutoMeasure entry-guard (App-owned by R1 boundary)
  impressInProgressRef: React.MutableRefObject<boolean>;
  // Called by commitAutoMeasureSnapshot (App-owned by R1 boundary)
  preserveAfterImpressOverlay: (durationMs?: number) => void;
  // Read by the big objective-side-effects effect, handleCenterCommit deps,
  // commitAutoMeasureSnapshot deps, the settings-preview effect, and the
  // settings-saved effect deps.
  shouldPreserveAfterImpressOverlay: () => boolean;
};

// Impress lifecycle + after-impress detection flow.
//
// Drives:
//  - overlay clear at TX time (so old yellow lines disappear before motion),
//  - block on Auto Measure during the run (impressInProgressRef),
//  - auto-trigger Auto Measure on a FRESH frame after FINISH so the new
//    indentation is detected without an operator click,
//  - optional turret-after-impress gating: defer detection until L*OK
//    confirms the rotation has settled,
//  - watchdog cleanup of the pending-turret gate when the objective
//    confirmation never arrives.
//
// Returns the three handles other App-owned auto-measure code paths still
// need (the R1 boundary preserves runAutoMeasure and commitAutoMeasureSnapshot
// inside App.tsx).
export function useAfterImpressFlow({
  machineIndentStatus,
  machineLastObjectiveRx,
  cameraRef,
  getAfterImpressReadiness,
  activeObjectiveRef,
  autoMeasureInFlightRef,
  runAutoMeasureRef,
  displayedAutoMeasureGraphicsRef,
  autoMeasurementIdRef,
  latestAutoMeasurePreviewSettingsRef,
  liveMachineStateRef,
  suppressAutoMeasurePreviewRef,
  setAutoMeasureStatus,
  setStatusMessage,
  setManualMeasureResetKey,
  setAutoMeasureClearNonce,
  clearActiveMeasurement,
  clearAutoMeasureOverlay,
}: UseAfterImpressFlowArgs): UseAfterImpressFlowResult {
  const impressInProgressRef = useRef(false);
  const lastSeenIndentStatusRef = useRef<IndentStatus>('idle');
  // Counts impress runs since app open so the first impress can be flagged in
  // the log trail — that is the click the readiness gate exists to protect.
  const impressRunCountRef = useRef(0);
  // Set when an impress completes WITH turretAfterImpress=true. The next
  // confirmed-objective RX (L1OK / L2OK / objective state-update) clears
  // this and, when measureAfterImpress is also true, triggers detection
  // against a fresh post-rotation frame. Without this gate the auto-detect
  // would fire on the FINISH event before the turret has settled.
  const pendingTurretAfterImpressRef = useRef<
    | {
        armedAt: number;
        measureAfterImpress: boolean;
        lastSeenObjectiveRx: string | null;
      }
    | null
  >(null);
  const turretAfterImpressWatchdogRef = useRef<number | null>(null);
  const afterImpressOverlayPreserveUntilRef = useRef(0);
  const afterImpressAutoMeasureAttemptRef = useRef(0);
  const afterImpressAutoMeasureRunIdRef = useRef(0);
  const afterImpressAutoMeasureInFlightRef = useRef(false);

  const preserveAfterImpressOverlay = useCallback((durationMs = 5000) => {
    afterImpressOverlayPreserveUntilRef.current = Math.max(
      afterImpressOverlayPreserveUntilRef.current,
      Date.now() + durationMs
    );
  }, []);
  const shouldPreserveAfterImpressOverlay = useCallback(() => {
    return Date.now() < afterImpressOverlayPreserveUntilRef.current;
  }, []);

  const runAutoMeasureAfterImpress = useCallback(async (): Promise<boolean> => {
    const markAfterImpressFailed = (reason: string) => {
      logAfterImpressDetectionFailed(reason);
      setAutoMeasureStatus('failed');
      setStatusMessage(`System Status: Auto Measure rejected: ${reason}`);
    };

    impressInProgressRef.current = false;
    const settings = latestAutoMeasurePreviewSettingsRef.current;
    const measureAfterImpressEnabled = settings.measureAfterImpress === true;
    // Defensive sync visibility: surface both the ref (used for the decision)
    // and the latest React state value so a drift between the two is obvious
    // in the log trail if the operator saved settings and clicked Impress in
    // the same tick.
    if (!measureAfterImpressEnabled) {
      return false;
    }
    if (afterImpressAutoMeasureInFlightRef.current) {
      return false;
    }

    afterImpressAutoMeasureInFlightRef.current = true;
    const runId = afterImpressAutoMeasureRunIdRef.current + 1;
    afterImpressAutoMeasureRunIdRef.current = runId;

    try {
      // Preserve the overlay window for up to 12 s so objective-change side
      // effects can't clear the freshly-committed overlay mid-display. The
      // suppress ref is intentionally NOT reset here; it stays true (set by
      // the caller) until line 223 just before the actual runner call, so a
      // concurrently-open Settings dialog cannot fire a preview detection on
      // the needle/retracting-indenter frame during the settle delay.
      preserveAfterImpressOverlay(12000);

      // Readiness gate. On the FIRST impress after a fresh startup the objective
      // sync, the per-objective calibration fetch, or the camera's first stable
      // frame may not have landed yet — later impresses "just work" only because
      // those prerequisites are already warm. Poll briefly for all of them
      // instead of bailing the moment one is missing.
      const GATE_TIMEOUT_MS = 4000;
      const GATE_POLL_MS = 150;
      const gateStart = Date.now();
      let objective = '';
      let lastWaitReason = '';
      for (;;) {
        if (runId !== afterImpressAutoMeasureRunIdRef.current) {
          markAfterImpressFailed('superseded');
          return false;
        }
        const readiness = getAfterImpressReadiness();
        objective = (readiness.activeObjective ?? '').trim().toUpperCase();
        const cameraReady = readiness.cameraOpen && cameraRef.current != null;
        const missing = !cameraReady
          ? 'camera-not-open'
          : !objective
            ? 'objective-null'
            : !readiness.calibrationReady
              ? 'calibration-missing'
              : null;
        if (!missing) break;
        if (Date.now() - gateStart >= GATE_TIMEOUT_MS) {
          // eslint-disable-next-line no-console
          console.warn(
            `[after-impress-detection-gate] cameraOpen=${readiness.cameraOpen} activeObjective=${objective || 'null'} calibrationReady=${readiness.calibrationReady} freshFrameReady=false`
          );
          // eslint-disable-next-line no-console
          console.warn(`[after-impress-detection-skip] reason=${missing}`);
          markAfterImpressFailed(missing);
          return false;
        }
        if (missing !== lastWaitReason) {
          lastWaitReason = missing;
          // eslint-disable-next-line no-console
          console.log(`[after-impress-detection-wait] reason=${missing}`);
        }
        await delay(GATE_POLL_MS);
      }

      const settleMs = objective === '40X' ? 600 : 350;
      await delay(settleMs);

      const camera = cameraRef.current;
      if (!camera) {
        markAfterImpressFailed('camera-unavailable');
        return false;
      }

      const firstFresh = await camera.waitForFreshFrame(1200);
      if (!firstFresh) {
        // eslint-disable-next-line no-console
        console.warn('[camera-fresh-frame] reason=after-impress result=timeout');
      }
      // eslint-disable-next-line no-console
      console.log(
        `[after-impress-detection-gate] cameraOpen=true activeObjective=${objective} calibrationReady=true freshFrameReady=${firstFresh}`
      );
      // eslint-disable-next-line no-console
      console.log(`[after-impress-detection-start] objective=${objective}`);

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (runId !== afterImpressAutoMeasureRunIdRef.current) {
          markAfterImpressFailed('superseded');
          return false;
        }
        if (attempt > 1) {
          await delay(300);
          const fresh = await camera.waitForFreshFrame(1200);
          if (!fresh) {
            // eslint-disable-next-line no-console
            console.warn(
              `[camera-fresh-frame] reason=after-impress retry=${attempt} result=timeout`
            );
          }
        }
        if (autoMeasureInFlightRef.current) {
          const waitStart = Date.now();
          while (autoMeasureInFlightRef.current && Date.now() - waitStart < 2000) {
            await delay(60);
          }
          if (autoMeasureInFlightRef.current) {
            markAfterImpressFailed('in-flight-detection-did-not-clear-within-2s');
            return false;
          }
        }

        const runner = runAutoMeasureRef.current;
        if (!runner) {
          markAfterImpressFailed('runAutoMeasure-ref-missing');
          return false;
        }

        afterImpressAutoMeasureAttemptRef.current = attempt;
        preserveAfterImpressOverlay(12000);
        suppressAutoMeasurePreviewRef.current = false;
        const finished = await runner(latestAutoMeasurePreviewSettingsRef.current, false, 'after-impress');
        await waitForOverlayPaint();
        const overlayReady = displayedAutoMeasureGraphicsRef.current !== null;
        if (finished && overlayReady) {
          preserveAfterImpressOverlay(5000);
          // eslint-disable-next-line no-console
          console.log('[after-impress-detection-success] lines=4 overlayVisible=true');
          return true;
        }

        const reason = finished ? 'overlay-not-ready' : 'detection-failed';
        if (attempt < 3) {
          continue;
        }
        markAfterImpressFailed(reason);
        return false;
      }

      markAfterImpressFailed('max-retries-exhausted');
      return false;
    } finally {
      afterImpressAutoMeasureAttemptRef.current = 0;
      afterImpressAutoMeasureInFlightRef.current = false;
    }
  }, [
    activeObjectiveRef,
    autoMeasureInFlightRef,
    cameraRef,
    displayedAutoMeasureGraphicsRef,
    getAfterImpressReadiness,
    latestAutoMeasurePreviewSettingsRef,
    preserveAfterImpressOverlay,
    runAutoMeasureRef,
    setAutoMeasureStatus,
    setStatusMessage,
    suppressAutoMeasurePreviewRef,
  ]);

  // Impress lifecycle. Driven entirely by the machine's confirmed
  // indentStatus so we never flag "done" before the machine actually
  // finishes.
  useEffect(() => {
    const prev = lastSeenIndentStatusRef.current;
    const next: IndentStatus = machineIndentStatus ?? 'idle';
    if (prev === next) return;
    lastSeenIndentStatusRef.current = next;

    const enteringRun =
      (next === 'started' || next === 'running') && prev !== 'started' && prev !== 'running';
    if (enteringRun) {
      impressRunCountRef.current += 1;
      // eslint-disable-next-line no-console
      console.log(`[impress-click] firstAfterStartup=${impressRunCountRef.current === 1}`);
      impressInProgressRef.current = true;
      clearActiveMeasurement('impress-start');
      clearAutoMeasureOverlay('impress-start');
      setManualMeasureResetKey((current) => current + 1);
      setAutoMeasureClearNonce((n) => n + 1);
      return;
    }

    // Trigger post-impress flow on ANY transition into `completed` (including
    // `idle → completed`, which the machine sends when a cycle completes
    // faster than the running batch can land). The earlier
    // `prev === 'started' || 'running'` guard caused the auto-detect to be
    // silently skipped on fast hardware paths.
    if (next === 'completed') {
      const completedAt = Date.now();
      // eslint-disable-next-line no-console
      console.log('[impress-complete] success=true');
      autoMeasurementIdRef.current = null;
      clearActiveMeasurement('impress-done');
      // Read from the synchronously-updated ref (latestAutoMeasurePreviewSettingsRef)
      // — autoMeasurePreviewSettingsRef lags by one render because it's
      // synced via useEffect. If the operator saves Auto Measure Settings
      // and clicks Impress in the same tick, the laggy ref can still hold
      // the pre-save value.
      const latestSettings = latestAutoMeasurePreviewSettingsRef.current;
      const measureAfterImpressEnabled = latestSettings.measureAfterImpress === true;
      const turretAfterImpressEnabled = latestSettings.turretAfterImpress === true;
      const currentObjective = (activeObjectiveRef.current ?? '')
        .trim()
        .toUpperCase();
      if (measureAfterImpressEnabled && !currentObjective) {
        // First impress after startup: the objective sync may not have landed
        // yet. Do NOT hard-bail (that was the first-click failure) — the
        // readiness gate in runAutoMeasureAfterImpress, or the
        // turret-after-impress wait below, polls until the objective arrives.
        // eslint-disable-next-line no-console
        console.log('[after-impress-detection-wait] reason=objective-null-at-impress-complete');
      }
      const targetObjective = latestSettings.objectiveForMeasure.trim().toUpperCase();
      const shouldWaitForTurretAfterImpress =
        turretAfterImpressEnabled &&
        measureAfterImpressEnabled &&
        (!currentObjective || currentObjective !== targetObjective);

      // eslint-disable-next-line no-console
      console.log(
        `[after-impress] start turretAfterImpress=${turretAfterImpressEnabled} measureAfterImpress=${measureAfterImpressEnabled}`
      );

      if (!measureAfterImpressEnabled) {
        // Measure-disabled path: clear any stale overlay, release the frozen
        // camera frame (if a previous Auto Measure click had frozen it), and
        // resume the live stream immediately. No detection is run.
        if (turretAfterImpressEnabled) {
          // eslint-disable-next-line no-console
          console.log(`[after-impress] turret-start objective=${targetObjective}`);
        }
        // eslint-disable-next-line no-console
        console.log('[after-impress] complete measureAfterImpress=false');
        impressInProgressRef.current = false;
        clearAutoMeasureOverlay('after-impress-measure-disabled');
        suppressAutoMeasurePreviewRef.current = false;
        afterImpressOverlayPreserveUntilRef.current = 0;
        setAutoMeasureStatus('idle');
        // eslint-disable-next-line no-console
        console.log('[auto-measure-overlay] action=clear reason=measure-after-impress-disabled');
        // eslint-disable-next-line no-console
        console.log('[auto-measure-session] action=end reason=measure-after-impress-disabled');
        // eslint-disable-next-line no-console
        console.log('[after-impress] measure-skipped reason=measureAfterImpress-disabled');

        // Release frozen camera frame and resume live stream.
        // If a previous Auto Measure call froze the camera, the freeze canvas
        // is still overlaying the live canvas. Unfreeze here so the operator
        // sees the live image again without having to close/reopen the camera.
        const camera = cameraRef.current;
        if (camera) {
          camera.unfreezeCamera('after-impress-measure-disabled');
          // eslint-disable-next-line no-console
          console.log('[camera-after-impress] action=resume-live cameraOpen=true streaming=true');
          void camera.waitForFreshFrame(1500).then((fresh) => {
            if (fresh) {
              // eslint-disable-next-line no-console
              console.log('[camera-paint] resumed=true reason=after-impress-measure-disabled');
            } else {
              // eslint-disable-next-line no-console
              console.warn('[camera-after-impress] resume-failed reason=fresh-frame-timeout');
            }
          });
        } else {
          // eslint-disable-next-line no-console
          console.warn('[camera-after-impress] resume-failed reason=camera-ref-missing');
        }
        return;
      }

      // measureAfterImpress is ON — arm strict overlay ownership BEFORE entering
      // the detection flow. This must happen whether the turret is also moving
      // (shouldWaitForTurretAfterImpress) or not so that:
      //  a) any stale committed/preview overlay from before impress is gone, and
      //  b) the Settings dialog's 70ms preview timer cannot fire on the needle
      //     frame during the settle delay and paint a bad large-cross overlay.
      suppressAutoMeasurePreviewRef.current = true;
      afterImpressOverlayPreserveUntilRef.current = 0;
      clearAutoMeasureOverlay('before-measure-after-impress');
      // eslint-disable-next-line no-console
      console.log('[auto-measure-overlay] cleared reason=before-measure-after-impress');

      // When the machine is about to rotate the turret after impress, defer
      // detection until the L*OK confirmation arrives. The other effect that
      // watches confirmedObjectiveFromMachine + lastObjectiveRx clears
      // pendingTurretAfterImpressRef and kicks off the fresh-frame wait +
      // detection. Without this gate, auto-measure would fire on the next
      // available camera frame mid-rotation and detect on a moving image.
      if (shouldWaitForTurretAfterImpress) {
        // eslint-disable-next-line no-console
        console.log(`[after-impress] turret-start objective=${targetObjective}`);
        pendingTurretAfterImpressRef.current = {
          armedAt: completedAt,
          measureAfterImpress: measureAfterImpressEnabled,
          lastSeenObjectiveRx: liveMachineStateRef.current?.lastObjectiveRx ?? null,
        };
        impressInProgressRef.current = false;
        // Watchdog cleanup only. Never run Auto Measure unless the required
        // objective confirmation arrives; this just prevents a stale pending
        // gate from being reused by a later, unrelated machine RX.
        if (turretAfterImpressWatchdogRef.current !== null) {
          window.clearTimeout(turretAfterImpressWatchdogRef.current);
        }
        turretAfterImpressWatchdogRef.current = window.setTimeout(() => {
          if (pendingTurretAfterImpressRef.current) {
            // eslint-disable-next-line no-console
            console.warn(
              '[turret-after-impress-done] reason=watchdog-timeout objective-confirmation-missing action=auto-measure-not-run'
            );
            pendingTurretAfterImpressRef.current = null;
          }
          turretAfterImpressWatchdogRef.current = null;
        }, 10000);
        return;
      }

      // eslint-disable-next-line no-console
      console.log('[after-impress] measure-start');
      void runAutoMeasureAfterImpress();
      return;
    }

    if (next === 'error' || next === 'idle') {
      if (impressInProgressRef.current) {
        impressInProgressRef.current = false;
      }
    }
  }, [
    activeObjectiveRef,
    autoMeasurementIdRef,
    cameraRef,
    clearActiveMeasurement,
    clearAutoMeasureOverlay,
    latestAutoMeasurePreviewSettingsRef,
    liveMachineStateRef,
    machineIndentStatus,
    runAutoMeasureAfterImpress,
    setAutoMeasureClearNonce,
    setAutoMeasureStatus,
    setManualMeasureResetKey,
  ]);

  // Resolve the turret-after-impress gate: when the machine confirms the new
  // objective slot (L*OK / objective state-update), the rotation has settled.
  // Then wait for a fresh stable frame and, if measureAfterImpress is also on,
  // run detection. Watching lastObjectiveRx is robust to multiple confirms
  // landing in the same RX batch.
  useEffect(() => {
    const pending = pendingTurretAfterImpressRef.current;
    if (!pending) return;
    const currentRx = machineLastObjectiveRx;
    if (!currentRx || currentRx === pending.lastSeenObjectiveRx) return;
    pendingTurretAfterImpressRef.current = null;
    if (turretAfterImpressWatchdogRef.current !== null) {
      window.clearTimeout(turretAfterImpressWatchdogRef.current);
      turretAfterImpressWatchdogRef.current = null;
    }
    // eslint-disable-next-line no-console
    console.log('[after-impress] turret-complete');
    // eslint-disable-next-line no-console
    console.log('[after-impress] measure-start');
    void runAutoMeasureAfterImpress();
  }, [machineLastObjectiveRx, runAutoMeasureAfterImpress]);

  return {
    impressInProgressRef,
    preserveAfterImpressOverlay,
    shouldPreserveAfterImpressOverlay,
  };
}
