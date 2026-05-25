import { useEffect } from 'react';

/**
 * DEV-ONLY render-count instrumentation. Lets you capture before/after
 * re-render counts per component without the React DevTools flame graph, and
 * cross-check the Profiler numbers.
 *
 * Usage in DevTools console:
 *   __renderStats.reset()        // before an action
 *   ...perform the action...
 *   __renderStats.dump()         // { App: 2, CameraWindow: 0, RightPanel: 5, ... }
 *
 * Counts one increment per COMMIT (effect with no deps), matching the
 * Profiler's commit semantics. In StrictMode the initial mount is double-
 * invoked, so the first reading per component is inflated by the mount; use
 * reset() right before the action you care about to get a clean delta.
 *
 * Removal: delete this file and grep `useRenderCount` to drop the call sites.
 * No per-frame logging — these only fire on real React commits.
 */

const isDev = import.meta.env.MODE !== 'production';

type RenderStats = {
  counts: Record<string, number>;
  reset: () => void;
  dump: () => Record<string, number>;
};

declare global {
  interface Window {
    __renderStats?: RenderStats;
  }
}

function ensureStore(): RenderStats {
  if (!window.__renderStats) {
    const counts: Record<string, number> = {};
    window.__renderStats = {
      counts,
      reset: () => {
        for (const key of Object.keys(counts)) delete counts[key];
      },
      dump: () => ({ ...counts }),
    };
  }
  return window.__renderStats;
}

export function useRenderCount(name: string): void {
  useEffect(() => {
    if (!isDev) return;
    const store = ensureStore();
    store.counts[name] = (store.counts[name] ?? 0) + 1;
  });
}
