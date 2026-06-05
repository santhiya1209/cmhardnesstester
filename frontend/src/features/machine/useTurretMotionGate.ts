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
    clearTurretMovingTimer();
    setTurretMovingState(false);
    setTurretMovingTarget(null);
    if (shouldPreserveAfterImpressOverlay()) {
    } else {
      clearAutoMeasureOverlay('turret-change');
    }
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
