import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnectMachine } from '@/hooks/mutations/useConnectMachine';
import { useSerialPortSetting } from '@/hooks/queries/useSerialPortSetting';
import { useSetStatusMessage } from '@/contexts/StatusMessageContext';
import { listSerialPorts } from '@/api/serialPort';

/**
 * Owns machine COM port selection + connect/disconnect lifecycle.
 *
 * - `currentMachinePort` is in-memory only (Serial Port Setting dialog drives
 *   it via `applyMachinePort`). The persisted choice lives in
 *   `useSerialPortSetting()` and only seeds the one-shot auto-connect attempt
 *   on first mount; subsequent reconnect/disconnect cycles do NOT persist.
 *
 * - `applyMachinePort` disconnects the previous port before connecting the
 *   new one. Pass `null` to disconnect without selecting a replacement.
 *
 * The "Saved COM port not detected" status message is pushed via the
 * StatusMessage context so this hook has no UI coupling.
 */
export function useMachineConnection() {
  const setStatusMessage = useSetStatusMessage();
  const { connect: connectMachineFn, disconnect: disconnectMachineFn } = useConnectMachine();
  const { data: serialPortSetting } = useSerialPortSetting();

  const [currentMachinePort, setCurrentMachinePort] = useState<string | null>(null);

  const applyMachinePort = useCallback(
    async (nextPort: string | null) => {
      const trimmed = typeof nextPort === 'string' && nextPort.trim() ? nextPort.trim() : null;
      if (currentMachinePort && currentMachinePort !== trimmed) {
        try {
          await disconnectMachineFn();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[machine-disconnect-old-port] failed:', err);
        }
      }
      setCurrentMachinePort(trimmed);
      if (!trimmed) {
        return;
      }
      try {
        await connectMachineFn({ port: trimmed });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[machine-connect-error] port=${trimmed}`, err);
        throw err;
      }
    },
    [connectMachineFn, currentMachinePort, disconnectMachineFn]
  );

  const machineAutoConnectAttemptedRef = useRef(false);
  useEffect(() => {
    if (machineAutoConnectAttemptedRef.current) return;
    if (!serialPortSetting) return;
    machineAutoConnectAttemptedRef.current = true;
    const savedMachine = serialPortSetting.machineComPort ?? null;
    // eslint-disable-next-line no-console
    console.log(`[serial-port-restore] machineComPort=${savedMachine ?? '(none)'}`);
    if (!savedMachine) return;
    // eslint-disable-next-line no-console
    console.log(`[machine-restore] savedPort=${savedMachine}`);
    void (async () => {
      const listing = await listSerialPorts().catch(() => ({
        ok: false as const,
        ports: [],
        error: 'list-failed',
      }));
      const available = listing.ok
        ? listing.ports.map((p) => p.path).filter(Boolean)
        : [];
      // eslint-disable-next-line no-console
      console.log(`[machine-restore] availablePorts=${available.join(',') || '(none)'}`);
      if (!available.includes(savedMachine)) {
        // eslint-disable-next-line no-console
        console.warn(`[saved-com-missing] device=machine port=${savedMachine}`);
        // eslint-disable-next-line no-console
        console.warn(`[machine-restore] port-exists=false`);
        // eslint-disable-next-line no-console
        console.warn(`[machine-restore] auto-connect-skipped reason=port-not-found savedPort=${savedMachine}`);
        setStatusMessage(
          `Saved COM port not detected. Please check connection or select another port. (machine=${savedMachine})`
        );
        return;
      }
      // eslint-disable-next-line no-console
      console.log(`[machine-restore] port-exists=true`);
      // eslint-disable-next-line no-console
      console.log(`[machine-restore] auto-connect-start port=${savedMachine}`);
      try {
        await applyMachinePort(savedMachine);
        // eslint-disable-next-line no-console
        console.log(`[machine-restore] auto-connect-success port=${savedMachine}`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[machine-restore] auto-connect-failed reason=${reason}`);
      }
    })();
  }, [applyMachinePort, serialPortSetting, setStatusMessage]);

  return { currentMachinePort, applyMachinePort };
}
