import type { MachineState } from '@/types/machine';

export type MachineSnapshotStore = {
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => MachineState | null;
};

type IndentStatusLike = MachineState['indentStatus'];

/**
 * Await one indent cycle's REAL completion via the live machine-state broadcast
 * (RX-confirmed) — no optimistic success, no setTimeout-driven completion. Resolves
 * 'completed' only after the status has been observed armed ('started'/'running')
 * and then reaches 'completed', so a stale 'completed' from the previous point is
 * never mistaken for this one. Resolves 'error' on a machine error, or 'timeout'
 * if no terminal status arrives within `timeoutMs`.
 *
 * Shared by the legacy Multipoint `start` loop and the execution engine so both
 * gate on the same RX-confirmed completion logic.
 */
export function waitForIndentTerminal(
  store: MachineSnapshotStore,
  timeoutMs: number
): Promise<'completed' | 'error' | 'timeout'> {
  return new Promise((resolve) => {
    let armed = false;
    let done = false;
    const read = (): IndentStatusLike => store.getSnapshot()?.indentStatus ?? 'idle';
    const finish = (result: 'completed' | 'error' | 'timeout') => {
      if (done) return;
      done = true;
      unsubscribe();
      window.clearTimeout(timer);
      resolve(result);
    };
    const evaluate = () => {
      const status = read();
      if (status === 'started' || status === 'running') armed = true;
      if (status === 'error') finish('error');
      else if (status === 'completed' && armed) finish('completed');
    };
    const unsubscribe = store.subscribe(evaluate);
    const timer = window.setTimeout(() => finish('timeout'), timeoutMs);
    evaluate();
  });
}
