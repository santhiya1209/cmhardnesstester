import { useEffect, useRef } from 'react';
import { getSerialPortSetting, listSerialPorts } from '@/api/serialPort';
import { xyzConnect, xyzConnectZ } from '@/api/xyzPlatform';

/**
 * One-shot startup hook: reads the persisted serial-port setting and
 * auto-connects the XYZ stage to the saved X/Y port if one is set, and the Z axis
 * to the saved Z port (a SEPARATE, independent connection) if one is set.
 *
 * The Z port comes ONLY from the saved zPortName — no hardcoded COM, no fallback,
 * no auto-scan. If zPortName is unset, Z simply isn't connected here.
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
      const zPort = typeof latest.zPortName === 'string' ? latest.zPortName.trim() : '';
      if (!xyPort && !zPort) return;

      // eslint-disable-next-line no-console
      console.log(`[xyz-restore] xyPort=${xyPort || '(none)'} zPort=${zPort || '(none)'}`);

      const listing = await listSerialPorts().catch(() => ({
        ok: false as const,
        ports: [],
        error: 'list-failed',
      }));
      const available = listing.ok ? listing.ports.map((p) => p.path).filter(Boolean) : [];
      // eslint-disable-next-line no-console
      console.log(`[xyz-restore] availablePorts=${available.join(',') || '(none)'}`);

      if (xyPort) {
        if (!available.includes(xyPort)) {
          // eslint-disable-next-line no-console
          console.warn(`[xyz-restore] auto-connect-skipped axis=xy reason=port-not-found savedPort=${xyPort}`);
        } else {
          // eslint-disable-next-line no-console
          console.log(`[xyz-restore] auto-connect-start axis=xy port=${xyPort}`);
          try {
            const res = await xyzConnect({ port: xyPort });
            // eslint-disable-next-line no-console
            console.log(
              res.ok
                ? `[xyz-restore] auto-connect-success axis=xy port=${xyPort}`
                : `[xyz-restore] auto-connect-failed axis=xy reason=${res.error ?? 'CONNECT_FAILED'} port=${xyPort}`
            );
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console
            console.warn(`[xyz-restore] auto-connect-failed axis=xy reason=${reason}`);
          }
        }
      }

      // Z is a SEPARATE connection. Never share the X/Y port; never fall back.
      if (zPort) {
        if (zPort === xyPort) {
          // eslint-disable-next-line no-console
          console.warn(`[xyz-restore] auto-connect-skipped axis=z reason=shares-xy-port port=${zPort}`);
        } else if (!available.includes(zPort)) {
          // eslint-disable-next-line no-console
          console.warn(`[xyz-restore] auto-connect-skipped axis=z reason=port-not-found savedPort=${zPort}`);
        } else {
          // eslint-disable-next-line no-console
          console.log(`[xyz-restore] auto-connect-start axis=z port=${zPort}`);
          try {
            const res = await xyzConnectZ({ port: zPort });
            // eslint-disable-next-line no-console
            console.log(
              res.ok
                ? `[xyz-restore] auto-connect-success axis=z port=${zPort}`
                : `[xyz-restore] auto-connect-failed axis=z reason=${res.error ?? 'CONNECT_FAILED'} port=${zPort}`
            );
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console
            console.warn(`[xyz-restore] auto-connect-failed axis=z reason=${reason}`);
          }
        }
      }
    })();
  }, []);
}
