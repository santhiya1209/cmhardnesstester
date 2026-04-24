import { useEffect, useState } from 'react';
import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg';
import { getHealth } from './api/getHealth';
import type { Health } from './types/health';

function App() {
  const [count, setCount] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      setHealth(await getHealth());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const ok = health?.ok === true;
  const statusColor = error ? 'bg-red-500' : ok ? 'bg-green-500' : 'bg-yellow-500';
  const statusText = error ? 'unreachable' : ok ? 'connected' : 'pending';

  return (
    <div className="mx-auto max-w-3xl px-8 py-8 text-center">
      <div className="flex justify-center gap-4">
        <a href="https://vite.dev" target="_blank">
          <img
            src={viteLogo}
            className="h-24 p-6 transition-[filter] duration-300 hover:[filter:drop-shadow(0_0_2em_#646cffaa)]"
            alt="Vite logo"
          />
        </a>
        <a href="https://react.dev" target="_blank">
          <img
            src={reactLogo}
            className="h-24 p-6 motion-safe:animate-[spin_20s_linear_infinite] hover:[filter:drop-shadow(0_0_2em_#61dafbaa)]"
            alt="React logo"
          />
        </a>
      </div>
      <h1 className="text-5xl font-bold leading-tight">Vite + React</h1>

      <div className="p-6">
        <button
          onClick={() => setCount((c) => c + 1)}
          className="rounded-lg border border-transparent bg-neutral-900 px-5 py-2 font-medium text-white transition-colors hover:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          count is {count}
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-neutral-700 bg-neutral-900/60 p-6 text-left">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-3 w-3 rounded-full ${statusColor}`} />
            <h2 className="text-lg font-semibold text-neutral-100">
              Backend: <span className="font-mono text-sm text-neutral-300">/api/health</span>
            </h2>
            <span className="ml-2 rounded bg-neutral-800 px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-300">
              {statusText}
            </span>
          </div>
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="rounded border border-neutral-600 bg-neutral-800 px-3 py-1 text-sm text-neutral-100 hover:border-indigo-400 disabled:opacity-50"
          >
            {loading ? 'checking…' : 'refresh'}
          </button>
        </div>

        {error && (
          <pre className="overflow-auto rounded bg-red-950/40 p-3 text-sm text-red-300">{error}</pre>
        )}
        {health && (
          <pre className="overflow-auto rounded bg-neutral-950 p-3 text-sm text-green-300">
            {JSON.stringify(health, null, 2)}
          </pre>
        )}

        <p className="mt-3 text-xs text-neutral-400">
          Mode: <span className="font-mono">{import.meta.env.VITE_MODE}</span> · Vite proxies
          <span className="font-mono"> /api</span> →
          <span className="font-mono"> {import.meta.env.VITE_API_PROXY_TARGET || '(prod: same origin)'}</span>
        </p>
      </div>

      <p className="mt-6 text-neutral-400">
        Edit <code className="rounded bg-neutral-800 px-1 text-sm">src/App.tsx</code> and save to test HMR
      </p>
    </div>
  );
}

export default App;
