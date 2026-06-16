import { useCallback, useState } from 'react';
import {
  xyzConnect,
  xyzConnectZ,
  xyzDisconnect,
  xyzDisconnectZ,
  xyzGetPosition,
  xyzHome,
  xyzLocateCenter,
  xyzLockXy,
  xyzLockZ,
  xyzMoveByOffset,
  xyzMoveStage,
  xyzMoveStep,
  xyzMoveToCenter,
  xyzMoveToPoint,
  xyzMoveZ,
  xyzPollZStatus,
  xyzSetCenter,
  xyzSetFocusMode,
  xyzSetXySpeed,
  xyzSetZSpeed,
  xyzStartZJog,
  xyzStopStage,
  xyzStopZJog,
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
        // A preempted command is expected jog control flow, never a user error.
        if (result.ok || result.preempted) setError(null);
        else setError(result.message ?? result.error);
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

  // Connect/disconnect are NOT movement commands and return the stage-state
  // response shape, so they don't go through `run`. They only toggle busy +
  // surface a connect error; the authoritative connected/lastError state still
  // arrives via the `xyz-platform:state` subscription. The port is the operator-
  // selected X/Y port from Serial Port Setting — no hardcoded COM number.
  const connect = useCallback(async (port: string) => {
    const trimmed = port?.trim() ?? '';
    if (!trimmed) {
      setError('X/Y port is not configured');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await xyzConnect({ port: trimmed });
      if (!res.ok) setError(res.message ?? res.error ?? 'Connect failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await xyzDisconnect();
      if (!res.ok) setError(res.message ?? res.error ?? 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  }, []);

  // Jog start/stop deliberately bypass `run` (no busy toggle) so a held arrow is
  // never disabled mid-press by the busy flag. They still surface errors, and
  // `moving` comes from the backend state broadcast, never from here.
  const moveStage = useCallback(async (direction: XyzDirection) => {
    const result = await xyzMoveStage(direction);
    if (!result.ok && !result.preempted) setError(result.message ?? result.error);
    return result;
  }, []);
  // Quick tap: a single finite step. Like moveStage it bypasses `run` (no busy
  // toggle) so the arrow isn't disabled by a transient flag; `moving`/position
  // still come only from the backend broadcast.
  const moveStep = useCallback(async (direction: XyzDirection) => {
    const result = await xyzMoveStep(direction);
    if (!result.ok && !result.preempted) setError(result.message ?? result.error);
    return result;
  }, []);
  const stopStage = useCallback(async () => {
    const result = await xyzStopStage();
    // A #0B that preempted an in-flight command is expected jog control flow.
    if (!result.ok && !result.preempted) setError(result.message ?? result.error);
    return result;
  }, []);
  // Z quick-tap step + press-and-hold jog mirror their X/Y counterparts: they
  // bypass `run` (no busy toggle) so a held Z arrow is never disabled mid-press;
  // `zMoving` comes only from the backend broadcast.
  const moveZ = useCallback(async (direction: ZDirection, speed: ZSpeed, focus?: 'coarse' | 'fine') => {
    const result = await xyzMoveZ(direction, speed, focus);
    if (!result.ok && !result.preempted) setError(result.message ?? result.error);
    return result;
  }, []);
  const startZJog = useCallback(async (direction: ZDirection) => {
    const result = await xyzStartZJog(direction);
    if (!result.ok && !result.preempted) setError(result.message ?? result.error);
    return result;
  }, []);
  const stopZJog = useCallback(async () => {
    const result = await xyzStopZJog();
    if (!result.ok && !result.preempted) setError(result.message ?? result.error);
    return result;
  }, []);
  // Kept for API symmetry; the backend single-shot Z stop routes to the jog stop.
  const stopZ = stopZJog;
  const pollZStatus = useCallback(() => run(() => xyzPollZStatus()), [run]);
  // Dedicated Z connection — INDEPENDENT of the X/Y connect. Port is the operator-
  // selected Z port from Serial Port Setting; empty fails honestly (no fallback).
  const connectZ = useCallback(async (port: string, baudRate?: number) => {
    const trimmed = port?.trim() ?? '';
    if (!trimmed) {
      setError('Z Axis port not configured');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await xyzConnectZ({ port: trimmed, baudRate });
      if (!res.ok) setError(res.message ?? res.error ?? 'Z connect failed');
    } finally {
      setBusy(false);
    }
  }, []);
  const disconnectZ = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await xyzDisconnectZ();
      if (!res.ok) setError(res.message ?? res.error ?? 'Z disconnect failed');
    } finally {
      setBusy(false);
    }
  }, []);
  const lockZ = useCallback(() => run(() => xyzLockZ()), [run]);
  const unlockZ = useCallback(() => run(() => xyzUnlockZ()), [run]);
  const lockXy = useCallback(() => run(() => xyzLockXy()), [run]);
  const unlockXy = useCallback(() => run(() => xyzUnlockXy()), [run]);
  const setFocusMode = useCallback((mode: FocusMode) => run(() => xyzSetFocusMode(mode)), [run]);
  const setXySpeed = useCallback((speed: XySpeed) => run(() => xyzSetXySpeed(speed)), [run]);
  const setZSpeed = useCallback((speed: ZSpeed) => run(() => xyzSetZSpeed(speed)), [run]);
  const getPosition = useCallback(() => run(() => xyzGetPosition()), [run]);
  const moveToCenter = useCallback(() => run(() => xyzMoveToCenter()), [run]);
  // Absolute point move (Multipoint execution): x/y are mm offsets from the taught
  // optical center. RX-gated by the backend relocation engine — no optimistic update.
  const moveToPoint = useCallback((x: number, y: number) => run(() => xyzMoveToPoint(x, y)), [run]);
  // Relative nudge from the current position (camera-click point selection): dx/dy
  // are mm deltas. RX-gated by the same backend relocation engine — no optimistic update.
  const moveByOffsetMm = useCallback((dx: number, dy: number) => run(() => xyzMoveByOffset(dx, dy)), [run]);
  const locateCenter = useCallback(() => run(() => xyzLocateCenter()), [run]);
  const setCenter = useCallback(() => run(() => xyzSetCenter()), [run]);
  const home = useCallback(() => run(() => xyzHome()), [run]);

  return {
    busy,
    error,
    connect,
    disconnect,
    moveStage,
    moveStep,
    stopStage,
    moveZ,
    stopZ,
    startZJog,
    stopZJog,
    pollZStatus,
    connectZ,
    disconnectZ,
    lockZ,
    unlockZ,
    lockXy,
    unlockXy,
    setFocusMode,
    setXySpeed,
    setZSpeed,
    getPosition,
    moveToCenter,
    moveToPoint,
    moveByOffsetMm,
    locateCenter,
    setCenter,
    home,
  };
}
