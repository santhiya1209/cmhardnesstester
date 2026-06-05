import { useEffect, useRef } from 'react';
import { getMicrometerConfig, getMicrometerState, openMicrometer } from '@/api/micrometer';
import { listSerialPorts } from '@/api/serialPort';

/**
 * One-shot startup hook: reads the persisted micrometer config and
 * auto-opens the serial port if enabled=true and a comPort is saved.
 *
 * Guards:
 * - Runs exactly once per mount (ref guard).
 * - Skips if the port is already open (duplicate-open safe).
 * - No reconnect loop — any failure is logged and dropped.
 * - Does not interfere with the manual open/close flow.
 */
export function useMicrometerAutoRestore(): void {
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    void (async () => {
      let configs: Awaited<ReturnType<typeof getMicrometerConfig>>;
      try {
        configs = await getMicrometerConfig();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[micrometer-restore] auto-open-failed reason=config-load-error',
          err instanceof Error ? err.message : String(err)
        );
        return;
      }

      if (!Array.isArray(configs) || configs.length === 0) return;
      const latest = [...configs].sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      )[0];

      const enabled = latest.enabled ?? false;
      const comPort = typeof latest.comPort === 'string' ? latest.comPort.trim() : '';

      if (!enabled || !comPort) return;

      // eslint-disable-next-line no-console
      console.log(`[micrometer-restore] enabled=true port=${comPort}`);

      try {
        const stateReply = await getMicrometerState();
        if (stateReply.ok && stateReply.state.connected) {
          // eslint-disable-next-line no-console
          console.log(`[micrometer-restore] already-open port=${stateReply.state.portName ?? comPort}`);
          return;
        }
      } catch {
      }

      const listing = await listSerialPorts().catch(() => ({
        ok: false as const,
        ports: [],
        error: 'list-failed',
      }));
      const available = listing.ok
        ? listing.ports.map((p) => p.path).filter(Boolean)
        : [];
      // eslint-disable-next-line no-console
      console.log(`[micrometer-restore] availablePorts=${available.join(',') || '(none)'}`);

      if (!available.includes(comPort)) {
        // eslint-disable-next-line no-console
        console.warn(`[micrometer-restore] port-exists=false`);
        // eslint-disable-next-line no-console
        console.warn(`[micrometer-restore] auto-open-skipped reason=port-not-found savedPort=${comPort}`);
        return;
      }
      // eslint-disable-next-line no-console
      console.log(`[micrometer-restore] port-exists=true`);
      // eslint-disable-next-line no-console
      console.log(`[micrometer-restore] auto-open-start port=${comPort}`);
      try {
        const result = await openMicrometer(comPort);
        if (result.ok) {
          // eslint-disable-next-line no-console
          console.log(`[micrometer-restore] auto-open-success port=${comPort}`);
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `[micrometer-restore] auto-open-failed reason=${result.error ?? 'OPEN_FAILED'} port=${comPort}`
          );
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[micrometer-restore] auto-open-failed reason=${reason}`);
      }
    })();
  }, []);
}
