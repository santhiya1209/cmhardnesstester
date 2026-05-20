import { memo, useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useSerialPortSetting } from '@/hooks/queries/useSerialPortSetting';
import { useSaveSerialPortSetting } from '@/hooks/mutations/useSaveSerialPortSetting';
import { useMicrometerConfig } from '@/hooks/queries/useMicrometerConfig';
import { useSaveMicrometerConfig } from '@/hooks/mutations/useSaveMicrometerConfig';
import {
  DEFAULT_SERIAL_PORT_SETTING,
  type SerialPortSetting,
  type SerialPortSettingPayload,
} from '@/types/serialPortSetting';
import { listSerialPorts } from '@/api/listSerialPorts';
import type { SerialPortInfo } from '@/types/serial';
import { colors } from '@/theme/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
  // Current in-memory machine COM port. Lives in App state — never read from
  // or written to the database. `null` means "no current selection".
  currentMachinePort: string | null;
  // Callback that disconnects the previous port (if any) and connects the
  // new one. Handles all machine connect/disconnect logging.
  onApplyMachinePort: (nextPort: string | null) => Promise<void>;
};

type StagePortField = 'xyPortName' | 'zPortName';

function toFormState(settings: SerialPortSetting | null): SerialPortSettingPayload {
  if (!settings) return DEFAULT_SERIAL_PORT_SETTING;
  return {
    machineComPort: settings.machineComPort ?? null,
    xyPortName: settings.xyPortName ?? null,
    zPortName: settings.zPortName ?? null,
  };
}

const TITLE_SX = { bgcolor: colors.headingPrimary, color: '#FFFFFF', py: 1.25 };
const SECTION_PAPER_SX = { p: 2, mb: 1.5 };
const SECTION_TITLE_SX = { color: colors.headingSecondary, fontWeight: 600, mb: 1 };
const ROW_LABEL_SX = { minWidth: 90 };

function renderPortLabel(port: SerialPortInfo): string {
  if (port.friendlyName) return `${port.path} — ${port.friendlyName}`;
  if (port.manufacturer) return `${port.path} — ${port.manufacturer}`;
  return port.path;
}

type DevicePortSelectProps = {
  value: string;
  availablePorts: SerialPortInfo[];
  disabled: boolean;
  onChange: (next: string) => void;
};

const DevicePortSelect = memo(function DevicePortSelect({
  value,
  availablePorts,
  disabled,
  onChange,
}: DevicePortSelectProps) {
  const handleChange = useCallback(
    (event: SelectChangeEvent) => {
      onChange(event.target.value);
    },
    [onChange]
  );
  const savedMissing =
    !!value && availablePorts.length > 0 && !availablePorts.some((p) => p.path === value);
  return (
    <FormControl size="small" sx={{ flex: 1 }} disabled={disabled}>
      <Select value={value} displayEmpty onChange={handleChange}>
        <MenuItem value="">
          <em>(none)</em>
        </MenuItem>
        {savedMissing ? (
          <MenuItem value={value}>{`${value} — not detected`}</MenuItem>
        ) : null}
        {availablePorts.map((port) => (
          <MenuItem key={port.path} value={port.path}>
            {renderPortLabel(port)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
});

type PortSectionProps = {
  title: string;
  rowLabel: string;
  value: string;
  disabled: boolean;
  availablePorts: SerialPortInfo[];
  onChange: (next: string) => void;
};

const PortSection = memo(function PortSection({
  title,
  rowLabel,
  value,
  disabled,
  availablePorts,
  onChange,
}: PortSectionProps) {
  return (
    <Paper variant="outlined" sx={SECTION_PAPER_SX}>
      <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
        {title}
      </Typography>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" sx={ROW_LABEL_SX}>
          {rowLabel}
        </Typography>
        <DevicePortSelect
          value={value}
          availablePorts={availablePorts}
          disabled={disabled}
          onChange={onChange}
        />
      </Stack>
    </Paper>
  );
});

function SerialPortSettingDialogImpl({
  open,
  onClose,
  onStatusChange,
  currentMachinePort,
  onApplyMachinePort,
}: Props) {
  const { data, error: loadError, loading, refetch } = useSerialPortSetting();
  const { saveSerialPortSetting, saving, error: saveError } = useSaveSerialPortSetting();
  const {
    data: micrometerData,
    error: micLoadError,
    loading: micLoading,
    refetch: refetchMicrometer,
  } = useMicrometerConfig();
  const {
    saveMicrometerConfig,
    saving: micSaving,
    error: micSaveError,
  } = useSaveMicrometerConfig();
  const [form, setForm] = useState<SerialPortSettingPayload>(DEFAULT_SERIAL_PORT_SETTING);
  // Machine COM port: seeded preferentially from the persisted record so the
  // dropdown reflects what the app actually auto-connected to. Falls back to
  // the current in-memory selection while the saved record is loading.
  const [machineComPort, setMachineComPort] = useState<string>('');
  const [micrometerComPort, setMicrometerComPort] = useState<string>('');
  const [availablePorts, setAvailablePorts] = useState<SerialPortInfo[]>([]);
  const [portsError, setPortsError] = useState<string | null>(null);
  const [applyingMachine, setApplyingMachine] = useState(false);

  const busy = loading || saving || micLoading || micSaving || applyingMachine;
  const errorMessage = loadError ?? saveError ?? micLoadError ?? micSaveError;

  useEffect(() => {
    if (open) {
      void refetch();
      void refetchMicrometer();
      void listSerialPorts().then((reply) => {
        if (reply.ok) {
          setAvailablePorts(reply.ports);
          setPortsError(null);
        } else {
          setAvailablePorts([]);
          setPortsError(reply.error || 'Failed to enumerate serial ports.');
        }
      });
    }
  }, [open, refetch, refetchMicrometer]);

  useEffect(() => {
    if (open && !loading) {
      setForm(toFormState(data));
    }
  }, [data, loading, open]);

  useEffect(() => {
    if (open && !loading) {
      // Prefer the persisted machine port; only fall back to the in-memory
      // selection (e.g. user picked a port and the save hasn't landed yet)
      // when the DB record has nothing.
      const persisted = data?.machineComPort ?? null;
      setMachineComPort(persisted ?? currentMachinePort ?? '');
    }
  }, [currentMachinePort, data, loading, open]);

  useEffect(() => {
    if (open && !micLoading) {
      setMicrometerComPort(micrometerData?.comPort ?? '');
    }
  }, [micrometerData, micLoading, open]);

  const handleStagePortChange = useCallback((field: StagePortField, value: string) => {
    setForm((current) => ({ ...current, [field]: value.length > 0 ? value : null }));
  }, []);
  const handleXyPortChange = useCallback(
    (next: string) => handleStagePortChange('xyPortName', next),
    [handleStagePortChange]
  );
  const handleZPortChange = useCallback(
    (next: string) => handleStagePortChange('zPortName', next),
    [handleStagePortChange]
  );

  const handleMachineComPortChange = useCallback((next: string) => {
    setMachineComPort(next);
  }, []);

  const handleMicrometerComPortChange = useCallback((next: string) => {
    setMicrometerComPort(next);
    // eslint-disable-next-line no-console
    console.log(`[micrometer-port-selected-current] port=${next || 'null'}`);
  }, []);

  const portConflict =
    !!machineComPort && !!micrometerComPort && machineComPort === micrometerComPort;

  const handleConfirm = useCallback(async () => {
    if (portConflict) return;
    try {
      const nextMachinePort = machineComPort.trim().length > 0 ? machineComPort.trim() : null;
      // Persist machine + XY/Z stage ports together. Machine port is now part
      // of the persisted record so the next launch can auto-connect.
      await saveSerialPortSetting({
        id: data?.id,
        values: { ...form, machineComPort: nextMachinePort },
      });
      // eslint-disable-next-line no-console
      console.log(`[machine-com-saved] port=${nextMachinePort ?? 'null'}`);

      const persistedMicrometerPort =
        micrometerComPort.trim().length > 0 ? micrometerComPort.trim() : null;
      await saveMicrometerConfig({
        id: micrometerData?.id,
        values: {
          enabled: micrometerData?.enabled ?? true,
          comPort: persistedMicrometerPort,
        },
      });
      // eslint-disable-next-line no-console
      console.log(`[micrometer-com-saved] port=${persistedMicrometerPort ?? 'null'}`);

      setApplyingMachine(true);
      try {
        await onApplyMachinePort(nextMachinePort);
      } finally {
        setApplyingMachine(false);
      }

      onStatusChange?.('Serial port setting saved.');
      onClose();
    } catch {
      // surfaced via saveError / micSaveError / connect error logs
    }
  }, [
    data?.id,
    form,
    machineComPort,
    micrometerComPort,
    micrometerData?.enabled,
    micrometerData?.id,
    onApplyMachinePort,
    onClose,
    onStatusChange,
    portConflict,
    saveMicrometerConfig,
    saveSerialPortSetting,
  ]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={TITLE_SX}>Serial Port Setting</DialogTitle>
      <DialogContent dividers>
        <PortSection
          title="Machine"
          rowLabel="COM Port"
          value={machineComPort}
          disabled={busy}
          availablePorts={availablePorts}
          onChange={handleMachineComPortChange}
        />

        <PortSection
          title="Micrometer"
          rowLabel="COM Port"
          value={micrometerComPort}
          disabled={busy}
          availablePorts={availablePorts}
          onChange={handleMicrometerComPortChange}
        />

        <PortSection
          title="X/Y"
          rowLabel="Port Name"
          value={form.xyPortName ?? ''}
          disabled={busy}
          availablePorts={availablePorts}
          onChange={handleXyPortChange}
        />
        <PortSection
          title="Z"
          rowLabel="Port Name"
          value={form.zPortName ?? ''}
          disabled={busy}
          availablePorts={availablePorts}
          onChange={handleZPortChange}
        />

        {portConflict ? (
          <Alert severity="warning" sx={{ mt: 1 }}>
            Machine and Micrometer cannot use same COM port
          </Alert>
        ) : null}
        {portsError ? (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {`Port list unavailable: ${portsError}`}
          </Alert>
        ) : null}
        {errorMessage ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {errorMessage}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          onClick={() => void handleConfirm()}
          disabled={busy || portConflict}
        >
          Confirm
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(SerialPortSettingDialogImpl);
