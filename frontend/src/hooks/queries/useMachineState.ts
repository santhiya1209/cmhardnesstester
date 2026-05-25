import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/utils/baseUrl';
import { getMachineState } from '@/api/machine';
import type { MachineState } from '@/types/machine';

function logFrontendMachineState(state: MachineState): void {
  const source = state.lastUpdateSource ?? state.lastUpdatedBy;
  if (source !== 'machine') return;
}

// Subscribes to GET /api/machine/events (Server-Sent Events) and exposes the
// latest MachineState. Falls back to a one-shot fetch if the EventSource
// connection fails (e.g. dev proxy hiccup).
export function useMachineState() {
  const [data, setData] = useState<MachineState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Coalesce bursts of machine-state pushes into at most ONE React commit per
    // animation frame. The hardware emits several RX snapshots in quick
    // succession (position telemetry, repeated status, lightness echoes);
    // without coalescing each push re-rendered App (a large component), keeping
    // the main thread busy and stealing time from the camera paint rAF.
    // Latest-state-wins. This does NOT drop meaningful transitions: indent /
    // objective / turret edges are mechanical and seconds apart (far longer
    // than a 16ms frame), and the consumers that key off them already react to
    // the latest value, so only same-frame telemetry noise is collapsed.
    let pendingState: MachineState | null = null;
    let rafId: number | null = null;
    const flush = () => {
      rafId = null;
      if (cancelled || pendingState === null) return;
      const next = pendingState;
      pendingState = null;
      setData(next);
    };
    const scheduleUpdate = (state: MachineState) => {
      logFrontendMachineState(state);
      pendingState = state;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };

    void getMachineState()
      .then((reply) => {
        if (cancelled) return;
        setData(reply.state);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    if (window.machineControl) {
      const unsubscribe = window.machineControl.subscribeState((state) => {
        if (cancelled) return;
        scheduleUpdate(state);
      });
      return () => {
        cancelled = true;
        if (rafId !== null) cancelAnimationFrame(rafId);
        unsubscribe();
      };
    }

    const url = `${API_BASE_URL}/api/machine/events`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as MachineState;
        scheduleUpdate(parsed);
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
      if (rafId !== null) cancelAnimationFrame(rafId);
      source.close();
      sourceRef.current = null;
    };
  }, []);

  return { data, error };
}
