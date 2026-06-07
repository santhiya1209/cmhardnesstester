import { useEffect, useRef } from 'react';
import { getSerialPortSetting, listSerialPorts } from '@/api/serialPort';
import { xyzConnect } from '@/api/xyzPlatform';

/**
 * One-shot startup hook: reads the persisted serial-port setting and
 * auto-connects the XYZ stage to the saved X/Y port (e.g. COM6) if one is set.
 *
 * Z-axis is intentionally NOT auto-connected: its protocol is still unmapped, so
 * there is no Z port to open yet. Only the X/Y controller is brought up here.
 *
 * Guards (mirror useMicrometerAutoRestore):
 * - Runs exactly once per mount (ref guard) — no reconnect loop.
 * - Server-side connect is idempotent (already-connected => no-op).
 * - Skips if the saved port is not in the OS port list.
 * - Any failure is logged and dropped; the manual Connect button still works.
 */
export function useXyzAutoConnect(): void {
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    void (async () => {
      let settings: Awaited<ReturnType<typeof getSerialPortSetting>>;
      try {
        settings = await getSerialPortSetting();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[xyz-restore] auto-connect-failed reason=setting-load-error',
          err instanceof Error ? err.message : String(err)
        );
        return;
      }

      if (!Array.isArray(settings) || settings.length === 0) return;
      const latest = [...settings].sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      )[0];

      const xyPort = typeof latest.xyPortName === 'string' ? latest.xyPortName.trim() : '';
      if (!xyPort) return;

      // eslint-disable-next-line no-console
      console.log(`[xyz-restore] xyPort=${xyPort}`);

      const listing = await listSerialPorts().catch(() => ({
        ok: false as const,
        ports: [],
        error: 'list-failed',
      }));
      const available = listing.ok ? listing.ports.map((p) => p.path).filter(Boolean) : [];
      // eslint-disable-next-line no-console
      console.log(`[xyz-restore] availablePorts=${available.join(',') || '(none)'}`);

      if (!available.includes(xyPort)) {
        // eslint-disable-next-line no-console
        console.warn(`[xyz-restore] auto-connect-skipped reason=port-not-found savedPort=${xyPort}`);
        return;
      }

      // eslint-disable-next-line no-console
      console.log(`[xyz-restore] auto-connect-start port=${xyPort}`);
      try {
        const res = await xyzConnect({ port: xyPort });
        if (res.ok) {
          // eslint-disable-next-line no-console
          console.log(`[xyz-restore] auto-connect-success port=${xyPort}`);
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `[xyz-restore] auto-connect-failed reason=${res.error ?? 'CONNECT_FAILED'} port=${xyPort}`
          );
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[xyz-restore] auto-connect-failed reason=${reason}`);
      }
    })();
  }, []);
}
