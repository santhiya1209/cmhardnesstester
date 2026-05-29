import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { getLastPaintedFrameId } from '@/hooks/useCameraStream';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';
import type { CameraStatusState } from '@/component/own/StatusBar';

export type UseTurretMotionGateArgs = {
  machineTurretPosition: string | null;
  cameraStatus: CameraStatusState;
  setTurretMovingState: (moving: boolean) => void;
  setTurretMovingTarget: Dispatch<SetStateAction<string | null>>;
  setPreviewAutoMeasureOverlay: Dispatch<SetStateAction<AutoMeasureGraphics | null>>;
  setAutoMeasureSessionActive: Dispatch<SetStateAction<boolean>>;
  setManualMeasureResetKey: Dispatch<SetStateAction<number>>;
  clearAutoMeasureOverlay: (reason: string) => void;
  shouldPreserveAfterImpressOverlay: () => boolean;
};

export type UseTurretMotionGate = {
  markTurretIntent: (
    reason: 'turret-click' | 'objective-change-click',
    target?: string | null
  ) => void;
  clearTurretMovingTimer: () => void;
};

/**
 * Turret motion gate. `turretMoving` (owned by App) gates overlay rendering
 * during the click → ACK window: the yellow overlays must disappear the
 * instant a turret/objective button is pressed and reappear once the machine
 * confirms the move (or a 4 s watchdog releases the gate if no RX arrives).
 */
export function useTurretMotionGate({
  machineTurretPosition,
  cameraStatus,
  setTurretMovingState,
  setTurretMovingTarget,
  setPreviewAutoMeasureOverlay,
  setAutoMeasureSessionActive,
  setManualMeasureResetKey,
  clearAutoMeasureOverlay,
  shouldPreserveAfterImpressOverlay,
}: UseTurretMotionGateArgs): UseTurretMotionGate {
  const turretMovingTimerRef = useRef<number | null>(null);
  const clearTurretMovingTimer = useCallback(() => {
    if (turretMovingTimerRef.current !== null) {
      window.clearTimeout(turretMovingTimerRef.current);
      turretMovingTimerRef.current = null;
    }
  }, []);
  const markTurretIntent = useCallback(
    (
      reason: 'turret-click' | 'objective-change-click',
      target?: string | null
    ) => {
      if (reason === 'objective-change-click') {
        const to = (target ?? 'unknown') || 'unknown';
        setTurretMovingTarget(to === 'unknown' ? null : to);
      }
      // Force-clear overlay state. clearAutoMeasureOverlay nulls
      // committedAutoMeasureOverlay → AutoMeasureOverlay re-renders empty.
      // Bumping manualMeasureResetKey clears the manual measure overlay's
      // internal corners + repaints empty. The calibration overlay shares
      // committedAutoMeasureOverlay, so the same call clears it too.
      clearAutoMeasureOverlay(reason);
      setPreviewAutoMeasureOverlay(null);
      setAutoMeasureSessionActive(false);
      setManualMeasureResetKey((current) => current + 1);
      clearTurretMovingTimer();
      setTurretMovingState(true);
      turretMovingTimerRef.current = window.setTimeout(() => {
        turretMovingTimerRef.current = null;
        setTurretMovingState(false);
        setTurretMovingTarget(null);
      }, 4000);
    },
    [clearAutoMeasureOverlay, clearTurretMovingTimer, setTurretMovingState]
  );
  useEffect(() => clearTurretMovingTimer, [clearTurretMovingTimer]);

  // Turret position change — any direction button (left/front/right) that
  // moves the turret can land on a different slot (incl. IND, which is not
  // an objective lens and therefore does NOT bump confirmedObjective). The
  // overlay was captured against a specific turret orientation, so any
  // turret move invalidates it regardless of objective.
  //
  // IMPORTANT: do NOT clear the live canvas here. Turret rotation is a pure
  // mechanical move on the same camera/sensor — closing or blanking the
  // canvas would make the camera look frozen for the entire motion window
  // (the next worker frame paints only when one is grabbed/decoded, which
  // can lag a couple of frames during vibration). The canvas-flush belongs
  // exclusively to the confirmed-objective-change handler below, which
  // fires when the new turret slot actually changes the optical objective.
  // Pure turret rotation on the same objective MUST keep streaming pixels.
  const lastSeenTurretPositionRef = useRef<string | null>(null);
  useEffect(() => {
    const pos = machineTurretPosition;
    if (!pos) return;
    if (lastSeenTurretPositionRef.current === null) {
      lastSeenTurretPositionRef.current = pos;
      return;
    }
    if (lastSeenTurretPositionRef.current === pos) return;
    lastSeenTurretPositionRef.current = pos;
    const frameId = getLastPaintedFrameId();
    // RX confirms the motion completed — release the overlay-render gate
    // immediately, regardless of whether the gate was set by a click in
    // this session (a hardware-driven turret move with no click also lands
    // here and must not leave the gate stuck on if a prior watchdog set it).
    clearTurretMovingTimer();
    setTurretMovingState(false);
    setTurretMovingTarget(null);
    if (shouldPreserveAfterImpressOverlay()) {
    } else {
      clearAutoMeasureOverlay('turret-change');
    }
    // Schedule a one-shot post-RX log on the next paint so the user can
    // verify the stream resumed (frameId advanced) without the camera ever
    // being closed/reset.
    const startId = frameId;
    let cancelled = false;
    const tickStart = Date.now();
    const tick = () => {
      if (cancelled) return;
      const cur = getLastPaintedFrameId();
      if (cur > startId) {
        return;
      }
      if (Date.now() - tickStart > 2000) {
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [
    machineTurretPosition,
    clearAutoMeasureOverlay,
    cameraStatus,
    clearTurretMovingTimer,
    setTurretMovingState,
    shouldPreserveAfterImpressOverlay,
  ]);

  return { markTurretIntent, clearTurretMovingTimer };
}
