import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { API_BASE_URL } from '@/utils/baseUrl';
import { getMachineState } from '@/api/machine';
import type { MachineState } from '@/types/machine';

const UI_FIELDS: (keyof MachineState)[] = [
  'connected',
  'port',
  'force',
  'lightness',
  'loadTime',
  'objective',
  'hardnessLevel',
  'indentStatus',
  'turretPosition',
  'confirmedObjectiveFromMachine',
  'lastObjectiveRx',
  'lastError',
  'syncStatus',
  'syncMessage',
  'machineStatus',
];

const SYNC_UI_LOG_FIELDS: (keyof MachineState)[] = [
  'force',
  'lightness',
  'loadTime',
  'objective',
  'hardnessLevel',
  'turretPosition',
  'indentStatus',
];

function syncUiFieldName(field: keyof MachineState): string {
  if (field === 'turretPosition') return 'turret';
  if (field === 'indentStatus') return 'indent';
  return field;
}

/**
 * External store holding the single live MachineState. Consumers read it via
 * useSyncExternalStore (full snapshot) or useMachineSelector (a derived slice
 * that only re-renders when the selected value changes). This replaces the
 * per-component useMachineState() subscription so exactly ONE SSE/IPC
 * subscription exists app-wide.
 */
type MachineStore = {
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => MachineState | null;
  getError: () => string | null;
};

const MachineStoreContext = createContext<MachineStore | null>(null);

export function MachineStateProvider({ children }: { children: ReactNode }) {
  const snapshotRef = useRef<MachineState | null>(null);
  const errorRef = useRef<string | null>(null);
  const listenersRef = useRef(new Set<() => void>());

  const storeRef = useRef<MachineStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = {
      subscribe: (cb) => {
        listenersRef.current.add(cb);
        return () => {
          listenersRef.current.delete(cb);
        };
      },
      getSnapshot: () => snapshotRef.current,
      getError: () => errorRef.current,
    };
  }
  const store = storeRef.current;

  useEffect(() => {
    let cancelled = false;

    let pendingState: MachineState | null = null;
    let rafId: number | null = null;

    const notify = () => {
      for (const cb of listenersRef.current) cb();
    };

    const commit = (next: MachineState) => {
      const prev = snapshotRef.current;
      if (prev && UI_FIELDS.every((f) => prev[f] === next[f])) {
        return;
      }
      for (const f of SYNC_UI_LOG_FIELDS) {
        if (!prev || prev[f] !== next[f]) {
          // eslint-disable-next-line no-console
          console.log(`[machine-sync][ui-state] field=${syncUiFieldName(f)} value=${next[f]}`);
        }
      }
      snapshotRef.current = next;
      notify();
    };

    const flush = () => {
      rafId = null;
      if (cancelled || pendingState === null) return;
      const next = pendingState;
      pendingState = null;
      commit(next);
    };
    const scheduleUpdate = (state: MachineState) => {
      pendingState = state;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };

    void getMachineState()
      .then((reply) => {
        if (cancelled) return;
        snapshotRef.current = reply.state;
        notify();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        errorRef.current = err instanceof Error ? err.message : String(err);
        notify();
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
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        scheduleUpdate(JSON.parse(event.data) as MachineState);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[machine-ui] failed to parse SSE payload', err);
      }
    };
    source.onerror = () => {
      errorRef.current = 'Connection to backend event stream lost — retrying...';
      notify();
    };
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      source.close();
    };
  }, [store]);

  return <MachineStoreContext.Provider value={store}>{children}</MachineStoreContext.Provider>;
}

function useMachineStore(): MachineStore {
  const store = useContext(MachineStoreContext);
  if (!store) {
    throw new Error('useMachineStore must be used within <MachineStateProvider>');
  }
  return store;
}

/** Full live snapshot. Re-renders the consumer on every accepted change. */
export function useMachineSnapshot(): MachineState | null {
  const store = useMachineStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Latest stream error, if any. */
export function useMachineError(): string | null {
  const store = useMachineStore();
  return useSyncExternalStore(store.subscribe, store.getError, store.getError);
}

/**
 * Subscribe to a derived slice of the machine state. The consumer re-renders
 * only when the selected value changes (Object.is). Use with primitive
 * selectors so unrelated field updates (e.g. loadTime) don't re-render.
 */
export function useMachineSelector<T>(selector: (state: MachineState | null) => T): T {
  const store = useMachineStore();
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const [value, setValue] = useState<T>(() => selector(store.getSnapshot()));
  const valueRef = useRef<T>(value);
  valueRef.current = value;
  useEffect(() => {
    const check = () => {
      const next = selectorRef.current(store.getSnapshot());
      if (!Object.is(next, valueRef.current)) {
        valueRef.current = next;
        setValue(next);
      }
    };
    check();
    return store.subscribe(check);
  }, [store]);
  return value;
}

/**
 * Imperative access to the store for callers that need the latest snapshot in
 * refs / async callbacks WITHOUT subscribing for re-renders.
 */
export function useMachineStoreApi(): MachineStore {
  return useMachineStore();
}
