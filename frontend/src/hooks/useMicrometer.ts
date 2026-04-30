import { useEffect, useRef, useState } from 'react';
import type { MicrometerState } from '@/types/micrometer';
import { getMicrometerState } from '@/api/getMicrometerState';

const INITIAL_STATE: MicrometerState = {
  connected: false,
  portName: null,
  status: 'waiting',
  value: null,
  displayValue: 'Waiting for data...',
  unit: 'mm',
  raw: null,
  rawAscii: null,
  rawHex: '',
  lastError: null,
  updatedAt: null,
  timestamp: null,
  lockedBaudRate: null,
};

// Subscribes to the main-process micrometer:state push events. Returns a
// stable state object that only changes when the underlying value/connection
// actually changes — consumers wrapped in React.memo will not re-render on
// duplicate frames.
export function useMicrometer(): MicrometerState {
  const [state, setState] = useState<MicrometerState>(INITIAL_STATE);
  const lastSerializedRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;

    void getMicrometerState()
      .then((reply) => {
        if (cancelled || !reply || !reply.ok) return;
        const next = reply.state;
        // eslint-disable-next-line no-console
        console.log('[micrometer][hook-received] payload=', next);
        const key = `${next.connected}|${next.value}|${next.rawHex}|${next.updatedAt}`;
        if (key === lastSerializedRef.current) return;
        lastSerializedRef.current = key;
        setState(next);
      })
      .catch(() => {
        // initial fetch optional — push events will populate
      });

    const off = window.api.on('micrometer:state', (next) => {
      // eslint-disable-next-line no-console
      console.log('[micrometer][hook-received] payload=', next);
      const key = `${next.connected}|${next.value}|${next.rawHex}|${next.updatedAt}`;
      if (key === lastSerializedRef.current) return;
      lastSerializedRef.current = key;
      setState(next);
    });

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return state;
}
