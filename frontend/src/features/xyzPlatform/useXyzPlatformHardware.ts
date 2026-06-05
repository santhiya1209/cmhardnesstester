import { useCallback, useState } from 'react';
import {
  xyzGetPosition,
  xyzLocateCenter,
  xyzLockXy,
  xyzLockZ,
  xyzMoveStage,
  xyzMoveToCenter,
  xyzMoveZ,
  xyzSetFocusMode,
  xyzSetXySpeed,
  xyzSetZSpeed,
  xyzStopStage,
  xyzStopZ,
  xyzUnlockXy,
  xyzUnlockZ,
} from '@/api/xyzPlatform';
import type {
  FocusMode,
  XyzCommandResult,
  XyzDirection,
  XySpeed,
  ZDirection,
  ZSpeed,
} from '@/types/xyzPlatform';

/**
 * Owns the live XYZ-stage IPC bridge calls. Every method returns the structured
 * {@link XyzCommandResult} so the caller updates coordinates ONLY from a real
 * `ok: true` reply. No CRUD persistence, no fabricated success.
 */
export function useXyzPlatformHardware() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (action: () => Promise<XyzCommandResult>): Promise<XyzCommandResult> => {
      setBusy(true);
      try {
        const result = await action();
        setError(result.ok ? null : result.message ?? result.error);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return { ok: false, error: message };
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const moveStage = useCallback(
    (direction: XyzDirection, speed: XySpeed) => run(() => xyzMoveStage(direction, speed)),
    [run]
  );
  const stopStage = useCallback(() => run(() => xyzStopStage()), [run]);
  const moveZ = useCallback(
    (direction: ZDirection, speed: ZSpeed) => run(() => xyzMoveZ(direction, speed)),
    [run]
  );
  const stopZ = useCallback(() => run(() => xyzStopZ()), [run]);
  const lockZ = useCallback(() => run(() => xyzLockZ()), [run]);
  const unlockZ = useCallback(() => run(() => xyzUnlockZ()), [run]);
  const lockXy = useCallback(() => run(() => xyzLockXy()), [run]);
  const unlockXy = useCallback(() => run(() => xyzUnlockXy()), [run]);
  const setFocusMode = useCallback((mode: FocusMode) => run(() => xyzSetFocusMode(mode)), [run]);
  const setXySpeed = useCallback((speed: XySpeed) => run(() => xyzSetXySpeed(speed)), [run]);
  const setZSpeed = useCallback((speed: ZSpeed) => run(() => xyzSetZSpeed(speed)), [run]);
  const getPosition = useCallback(() => run(() => xyzGetPosition()), [run]);
  const moveToCenter = useCallback(() => run(() => xyzMoveToCenter()), [run]);
  const locateCenter = useCallback(() => run(() => xyzLocateCenter()), [run]);

  return {
    busy,
    error,
    moveStage,
    stopStage,
    moveZ,
    stopZ,
    lockZ,
    unlockZ,
    lockXy,
    unlockXy,
    setFocusMode,
    setXySpeed,
    setZSpeed,
    getPosition,
    moveToCenter,
    locateCenter,
  };
}
