import { useEffect, useRef, useState } from 'react';
import { subscribeXyzStageState } from '@/api/xyzPlatform';
import type { FocusMode, XyzPosition, XySpeed, ZSpeed } from '@/types/xyzPlatform';

/**
 * The renderer's READ-ONLY view of the backend XYZ stage. Every field here is
 * owned by the backend `xyzPlatformSerialService` and arrives over the single
 * `xyz-platform:state` event — the UI never computes or guesses any of it. A
 * button click sends an IPC command; this snapshot only changes when the
 * service broadcasts a new state after a validated hardware RX (or, for the
 * software interlocks, after the service applies the state).
 */
export interface XyzStageSnapshot {
  connected: boolean;
  /** Raw hardware position in pulses. */
  position: XyzPosition;
  /** Backend-derived position in mm (pulses / pulsePerMm) — the displayed value. */
  positionMm: XyzPosition;
  xySpeed: XySpeed;
  zSpeed: ZSpeed;
  xyLocked: boolean;
  zLocked: boolean;
  /** Z serial connection — independent of `connected` (the X/Y port). */
  zConnected: boolean;
  zPort: string | null;
  /** True while a Z press-and-hold jog is in flight (separate from `moving`). */
  zMoving: boolean;
  focusMode: FocusMode;
  moving: boolean;
  /** False until a real position frame has been received (UI shows "--"). */
  positionKnown: boolean;
  /** Operator-taught optical center (absolute pulses), or null until taught. */
  centerX: number | null;
  centerY: number | null;
  lastAction: string;
  lastError: string | null;
}

const INITIAL: XyzStageSnapshot = {
  connected: false,
  position: { x: 0, y: 0, z: 0 },
  positionMm: { x: 0, y: 0, z: 0 },
  xySpeed: 'slow',
  zSpeed: 'fast',
  xyLocked: false,
  zLocked: false,
  zConnected: false,
  zPort: null,
  zMoving: false,
  focusMode: 'manual',
  moving: false,
  positionKnown: false,
  centerX: null,
  centerY: null,
  lastAction: 'Ready for platform control.',
  lastError: null,
};

/**
 * Owns EXACTLY ONE `xyz-platform:state` subscription. No polling. Commits to
 * React state only when a value the UI renders actually changes, so a burst of
 * serial RX never causes a render storm. Unsubscribes on unmount.
 */
export function useXyzStageState(): XyzStageSnapshot {
  const [snapshot, setSnapshot] = useState<XyzStageSnapshot>(INITIAL);
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    const unsubscribe = subscribeXyzStageState((state) => {
      const { x, y, z } = state.position;
      // mm mirror from the backend; fall back to pulses only if an older backend
      // build omits the field (so the UI never crashes on a missing positionMm).
      const mm = state.positionMm ?? state.position;
      const lastError = state.lastError ?? null;
      const centerX = state.centerX ?? null;
      const centerY = state.centerY ?? null;
      const positionKnown = state.positionKnown ?? false;
      const zConnected = state.zConnected ?? false;
      const zPort = state.zPort ?? null;
      const zMoving = state.zMoving ?? false;
      const key = [
        state.connected,
        x,
        y,
        z,
        mm.x,
        mm.y,
        mm.z,
        state.xySpeed,
        state.zSpeed,
        state.xyLocked,
        state.zLocked,
        zConnected,
        zPort ?? '',
        zMoving,
        state.focusMode,
        state.moving,
        positionKnown,
        centerX ?? '',
        centerY ?? '',
        state.lastAction,
        lastError ?? '',
      ].join('|');
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      setSnapshot({
        connected: state.connected,
        position: { x, y, z },
        positionMm: { x: mm.x, y: mm.y, z: mm.z },
        xySpeed: state.xySpeed,
        zSpeed: state.zSpeed,
        xyLocked: state.xyLocked,
        zLocked: state.zLocked,
        zConnected,
        zPort,
        zMoving,
        focusMode: state.focusMode,
        moving: state.moving,
        positionKnown,
        centerX,
        centerY,
        lastAction: state.lastAction,
        lastError,
      });
    });

    return unsubscribe;
  }, []);

  return snapshot;
}
