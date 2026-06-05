import { useEffect, useRef, useState } from 'react';
import type { MicrometerState } from '@/types/micrometer';
import { getMicrometerState } from '@/api/micrometer';

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

export function useMicrometer(): MicrometerState {
  const [state, setState] = useState<MicrometerState>(INITIAL_STATE);
  const lastSerializedRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;

    void getMicrometerState()
      .then((reply) => {
        if (cancelled || !reply || !reply.ok) return;
        const next = reply.state;
        const key = `${next.connected}|${next.value}|${next.rawHex}|${next.updatedAt}`;
        if (key === lastSerializedRef.current) return;
        lastSerializedRef.current = key;
        setState(next);
      })
      .catch(() => {
      });

    const off = window.api.on('micrometer:state', (next) => {
      console.log(`[micrometer][ipc-receive] value=${next.value}`);
      const key = `${next.connected}|${next.value}|${next.rawHex}|${next.updatedAt}`;
      if (key === lastSerializedRef.current) return;
      lastSerializedRef.current = key;
      console.log(`[micrometer][ui-state] value=${next.value}`);
      setState(next);
    });

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return state;
}
