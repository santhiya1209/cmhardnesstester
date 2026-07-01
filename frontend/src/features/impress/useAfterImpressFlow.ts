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

  activeObjectiveRef: React.MutableRefObject<string | null>;
  autoMeasureInFlightRef: React.MutableRefObject<boolean>;
  runAutoMeasureRef: React.MutableRefObject<RunAutoMeasure | null>;
  displayedAutoMeasureGraphicsRef: React.MutableRefObject<AutoMeasureGraphics | null>;
  autoMeasurementIdRef: React.MutableRefObject<string | null>;
  latestAutoMeasurePreviewSettingsRef: React.MutableRefObject<AutoMeasureSettingsPayload>;
  liveMachineStateRef: React.MutableRefObject<MachineState | null>;
  suppressAutoMeasurePreviewRef: React.MutableRefObject<boolean>;

  setAutoMeasureStatus: (next: AutoMeasureStatusState) => void;
  setStatusMessage: (message: string) => void;
  setManualMeasureResetKey: React.Dispatch<React.SetStateAction<number>>;
  setAutoMeasureClearNonce: React.Dispatch<React.SetStateAction<number>>;

  clearActiveMeasurement: (reason: string) => void;
  clearAutoMeasureOverlay: (reason: string) => void;
};

export type UseAfterImpressFlowResult = {
  impressInProgressRef: React.MutableRefObject<boolean>;
  preserveAfterImpressOverlay: (durationMs?: number) => void;
  shouldPreserveAfterImpressOverlay: () => boolean;
};

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
  const impressRunCountRef = useRef(0);
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
      preserveAfterImpressOverlay(12000);

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

    if (next === 'completed') {
      const completedAt = Date.now();
      // eslint-disable-next-line no-console
      console.log('[impress-complete] success=true');
      autoMeasurementIdRef.current = null;
      clearActiveMeasurement('impress-done');
      const latestSettings = latestAutoMeasurePreviewSettingsRef.current;
      const measureAfterImpressEnabled = latestSettings.measureAfterImpress === true;
      const turretAfterImpressEnabled = latestSettings.turretAfterImpress === true;
      const currentObjective = (activeObjectiveRef.current ?? '')
        .trim()
        .toUpperCase();
      if (measureAfterImpressEnabled && !currentObjective) {
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

      suppressAutoMeasurePreviewRef.current = true;
      afterImpressOverlayPreserveUntilRef.current = 0;
      clearAutoMeasureOverlay('before-measure-after-impress');
      // eslint-disable-next-line no-console
      console.log('[auto-measure-overlay] cleared reason=before-measure-after-impress');

      if (shouldWaitForTurretAfterImpress) {
        // eslint-disable-next-line no-console
        console.log(`[after-impress] turret-start objective=${targetObjective}`);
        pendingTurretAfterImpressRef.current = {
          armedAt: completedAt,
          measureAfterImpress: measureAfterImpressEnabled,
          lastSeenObjectiveRx: liveMachineStateRef.current?.lastObjectiveRx ?? null,
        };
        impressInProgressRef.current = false;
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
