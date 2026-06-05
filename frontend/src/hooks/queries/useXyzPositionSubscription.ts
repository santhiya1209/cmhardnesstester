import { useEffect, useRef, useState } from 'react';
import { subscribeXyzStageState } from '@/api/xyzPlatform';
import type { XyzPosition } from '@/types/xyzPlatform';

interface XyzLiveSnapshot {
  connected: boolean;
  position: XyzPosition | null;
  lastError: string | null;
}

const INITIAL: XyzLiveSnapshot = { connected: false, position: null, lastError: null };

/**
 * Owns EXACTLY ONE `xyz-platform:state` IPC subscription for live position +
 * connection status. No polling. Commits to React state only when a value the
 * UI renders actually changes, so a burst of serial RX never causes a render
 * storm. Unsubscribes on unmount.
 */
export function useXyzPositionSubscription(): XyzLiveSnapshot {
  const [snapshot, setSnapshot] = useState<XyzLiveSnapshot>(INITIAL);
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    const unsubscribe = subscribeXyzStageState((state) => {
      const { x, y, z } = state.position;
      const lastError = state.lastError ?? null;
      const key = `${state.connected}|${x}|${y}|${z}|${lastError ?? ''}`;
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      setSnapshot({
        connected: state.connected,
        position: { x, y, z },
        lastError,
      });
    });

    return unsubscribe;
  }, []);

  return snapshot;
}
