import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/utils/baseUrl';
import { getMachineState } from '@/api/getMachineState';
import type { MachineState } from '@/types/machine';

// Subscribes to GET /api/machine/events (Server-Sent Events) and exposes the
// latest MachineState. Falls back to a one-shot fetch if the EventSource
// connection fails (e.g. dev proxy hiccup).
export function useMachineState() {
  const [data, setData] = useState<MachineState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getMachineState()
      .then((reply) => {
        if (cancelled) return;
        setData(reply.state);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    const url = `${API_BASE_URL}/api/machine/events`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as MachineState;
        // eslint-disable-next-line no-console
        console.log('[machine-ipc] state received', parsed);
        // eslint-disable-next-line no-console
        console.log('[machine-ui] state update from machine');
        setData(parsed);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[machine-ui] failed to parse SSE payload', err);
      }
    };
    source.onerror = () => {
      // EventSource auto-reconnects; surface the latest error for the UI.
      setError('Connection to backend event stream lost — retrying...');
    };

    return () => {
      cancelled = true;
      source.close();
      sourceRef.current = null;
    };
  }, []);

  return { data, error };
}
