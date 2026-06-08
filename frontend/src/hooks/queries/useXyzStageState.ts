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
  position: XyzPosition;
  xySpeed: XySpeed;
  zSpeed: ZSpeed;
  xyLocked: boolean;
  zLocked: boolean;
  focusMode: FocusMode;
  moving: boolean;
  /** Operator-taught optical center (absolute pulses), or null until taught. */
  centerX: number | null;
  centerY: number | null;
  lastAction: string;
  lastError: string | null;
}

const INITIAL: XyzStageSnapshot = {
  connected: false,
  position: { x: 0, y: 0, z: 0 },
  xySpeed: 'slow',
  zSpeed: 'fast',
  xyLocked: false,
  zLocked: false,
  focusMode: 'manual',
  moving: false,
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
      const lastError = state.lastError ?? null;
      const centerX = state.centerX ?? null;
      const centerY = state.centerY ?? null;
      const key = [
        state.connected,
        x,
        y,
        z,
        state.xySpeed,
        state.zSpeed,
        state.xyLocked,
        state.zLocked,
        state.focusMode,
        state.moving,
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
        xySpeed: state.xySpeed,
        zSpeed: state.zSpeed,
        xyLocked: state.xyLocked,
        zLocked: state.zLocked,
        focusMode: state.focusMode,
        moving: state.moving,
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
