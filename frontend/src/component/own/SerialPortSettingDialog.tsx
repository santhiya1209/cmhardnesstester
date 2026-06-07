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
import { listSerialPorts } from '@/api/serialPort';
import type { SerialPortInfo } from '@/types/serial';
import { tokens } from '@/theme/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
  currentMachinePort: string | null;
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

const TITLE_SX = { bgcolor: tokens.accent.base, color: '#FFFFFF', py: 1.25 };
const SECTION_PAPER_SX = { p: 2, mb: 1.5 };
const SECTION_TITLE_SX = { color: tokens.status.success, fontWeight: 600, mb: 1 };
const ROW_LABEL_SX = { minWidth: 90 };

function renderPortLabel(port: SerialPortInfo): string {
  if (port.friendlyName) return `${port.path} - ${port.friendlyName}`;
  if (port.manufacturer) return `${port.path} - ${port.manufacturer}`;
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
  useEffect(() => {
    if (savedMissing) {
      // eslint-disable-next-line no-console
      console.warn(`[serial-settings][saved-port-unavailable] port=${value}`);
    }
  }, [savedMissing, value]);
  return (
    <FormControl size="small" sx={{ flex: 1 }} disabled={disabled}>
      <Select value={value} displayEmpty onChange={handleChange}>
        <MenuItem value="">
          <em>(none)</em>
        </MenuItem>
        {savedMissing ? (
          <MenuItem value={value}>{`${value} - not detected`}</MenuItem>
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
      const persisted = data?.machineComPort ?? null;
      setMachineComPort(persisted ?? currentMachinePort ?? '');
    }
  }, [currentMachinePort, data, loading, open]);

  useEffect(() => {
    if (open && !micLoading) {
      setMicrometerComPort(micrometerData?.comPort ?? '');
    }
  }, [micrometerData, micLoading, open]);

  useEffect(() => {
    if (!open || loading || micLoading) return;
    const machine = data?.machineComPort ?? currentMachinePort ?? null;
    const micrometer = micrometerData?.comPort ?? null;
    // eslint-disable-next-line no-console
    console.log(`[serial-port-ui] loaded machineComPort=${machine ?? '(none)'} micrometerComPort=${micrometer ?? '(none)'}`);
  }, [open, loading, micLoading, data, micrometerData, currentMachinePort]);

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
  }, []);

  // A port may belong to exactly one device. X/Y and Z must not collide with the
  // Machine or Micrometer ports (different physical controllers). X/Y and Z may
  // share a port — the XYZ stage is a single controller and the service opens
  // only the X/Y port (Z movement isn't a separate connection).
  const xyPort = form.xyPortName ?? '';
  const zPort = form.zPortName ?? '';
  const conflicts: string[] = [];
  if (machineComPort && micrometerComPort && machineComPort === micrometerComPort) {
    conflicts.push('Machine and Micrometer cannot use same COM port');
  }
  if (xyPort && machineComPort && xyPort === machineComPort) {
    conflicts.push('X/Y port cannot use machine COM port');
  }
  if (xyPort && micrometerComPort && xyPort === micrometerComPort) {
    conflicts.push('X/Y port cannot use micrometer COM port');
  }
  if (zPort && machineComPort && zPort === machineComPort) {
    conflicts.push('Z port cannot use machine COM port');
  }
  if (zPort && micrometerComPort && zPort === micrometerComPort) {
    conflicts.push('Z port cannot use micrometer COM port');
  }
  const hasConflict = conflicts.length > 0;

  const handleConfirm = useCallback(async () => {
    if (hasConflict) return;
    try {
      const nextMachinePort = machineComPort.trim().length > 0 ? machineComPort.trim() : null;
      const persistedMicrometerPort =
        micrometerComPort.trim().length > 0 ? micrometerComPort.trim() : null;
      // eslint-disable-next-line no-console
      console.log(`[machine-port-save] port=${nextMachinePort ?? '(none)'}`);
      // eslint-disable-next-line no-console
      console.log(`[serial-settings] xyzXyPort=${form.xyPortName ?? '(none)'} xyzZPort=${form.zPortName ?? '(none)'}`);
      await saveSerialPortSetting({
        id: data?.id,
        values: { ...form, machineComPort: nextMachinePort },
      });

      const micEnabled = micrometerData?.enabled ?? true;
      // eslint-disable-next-line no-console
      console.log(`[micrometer-port-save] port=${persistedMicrometerPort ?? '(none)'} enabled=${micEnabled}`);
      await saveMicrometerConfig({
        id: micrometerData?.id,
        values: {
          enabled: micEnabled,
          comPort: persistedMicrometerPort,
        },
      });

      setApplyingMachine(true);
      try {
        await onApplyMachinePort(nextMachinePort);
      } finally {
        setApplyingMachine(false);
      }

      onStatusChange?.('Serial port setting saved.');
      onClose();
    } catch {
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
    hasConflict,
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

        {conflicts.map((message) => (
          <Alert key={message} severity="warning" sx={{ mt: 1 }}>
            {message}
          </Alert>
        ))}
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
          disabled={busy || hasConflict}
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
