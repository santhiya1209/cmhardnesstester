import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import type { SxProps, Theme } from '@mui/material/styles';
import { useMachineState } from '@/hooks/queries/useMachineState';
import { useSetMachineControl } from '@/hooks/mutations/useSetMachineControl';
import { useStartIndent } from '@/hooks/mutations/useStartIndent';
import type { IndentStatus, MachineControlKey, MachineState } from '@/types/machine';

type MachineControlTabProps = {
  /** Called after the backend accepts a 10X / 40X lens change. */
  onObjectiveChange?: (objective: '10X' | '40X') => void;
};

const FORCE_OPTIONS = ['0.01kgf', '0.025kgf', '0.05kgf', '0.1kgf', '0.2kgf', '0.3kgf', '0.5kgf', '1kgf'];
const OBJECTIVE_OPTIONS = ['2.5X', '5X', '10X', '20X', '40X', '50X'];
const HARDNESS_LEVEL_OPTIONS = ['Low', 'Middle', 'High'];
const LIGHTNESS_INPUT_PROPS = { min: 0, max: 9, step: 1 } as const;
const LOAD_TIME_INPUT_PROPS = { min: 1, max: 99, step: 1 } as const;

type FormState = {
  force: string;
  lightness: string;
  loadTime: string;
  objective: string;
  hardnessLevel: string;
};

const DEFAULT_FORM_STATE: FormState = {
  force: '0.5kgf',
  lightness: '5',
  loadTime: '5',
  objective: '10X',
  hardnessLevel: 'Middle',
};

const INDENTER_SECTION_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: '160px 1fr',
  gap: 1.5,
  px: 1.5,
  py: 1.5,
  alignItems: 'center',
};
const INDENT_BUTTON_SX: SxProps<Theme> = {
  width: 160,
  height: 90,
  textTransform: 'none',
  fontSize: 14,
  fontWeight: 500,
};
const INDENTER_RIGHT_SX: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: 1 };
const ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1 };
const FIELD_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary', width: 100, flexShrink: 0 };
const READONLY_VALUE_SX: SxProps<Theme> = {
  px: 1,
  py: 0.5,
  fontSize: 12,
  border: 1,
  borderColor: 'divider',
  borderRadius: 0.5,
  minWidth: 64,
  textAlign: 'center',
};
const LENS_BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, minWidth: 56, py: 0.25 };
const SETTINGS_GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto 1fr',
  rowGap: 1,
  columnGap: 1,
  alignItems: 'center',
  px: 1.5,
  py: 1.5,
  borderTop: 1,
  borderColor: 'divider',
};
const SETTING_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const STATUS_ROW_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  px: 1.5,
  py: 1,
  borderTop: 1,
  borderColor: 'divider',
};
const STATUS_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const STATUS_DETAILS_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 0.5,
  px: 1.5,
  pb: 1,
};
const STATUS_DETAIL_SX: SxProps<Theme> = { fontSize: 11, color: 'text.secondary' };
const ALERT_SX: SxProps<Theme> = { mx: 1.5, mb: 1.5 };

function machineToForm(state: MachineState | null): FormState {
  if (!state) return DEFAULT_FORM_STATE;
  return {
    force: String(state.force),
    lightness: String(state.lightness),
    loadTime: String(state.loadTime),
    objective: state.objective,
    hardnessLevel: state.hardnessLevel,
  };
}

function indentLabel(status: IndentStatus): string {
  switch (status) {
    case 'idle':
      return 'Indent';
    case 'started':
      return 'Indent (starting)';
    case 'running':
      return 'Indent (running)';
    case 'completed':
      return 'Indent (done)';
    case 'error':
      return 'Indent (error)';
    default:
      return 'Indent';
  }
}

function formatTimestamp(value?: string): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

function isValidNumberField(field: 'lightness' | 'loadTime', value: string): boolean {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return false;
  if (field === 'lightness') return numeric >= 0 && numeric <= 9;
  return numeric >= 1 && numeric <= 99;
}

function MachineControlTabImpl({ onObjectiveChange }: MachineControlTabProps = {}) {
  const { data: machineState, error: streamError } = useMachineState();
  const { setControl, busy: setBusy, error: setError } = useSetMachineControl();
  const { start: startIndent, busy: indentBusy, error: indentError } = useStartIndent();

  // Local form mirrors machineState. We only push to the backend on USER edits.
  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM_STATE);

  // Track the value last sent to backend per-key, so we can also ignore the
  // echo that comes back via SSE.
  const lastSentRef = useRef<Partial<Record<MachineControlKey, string>>>({});

  useEffect(() => {
    if (!machineState) return;
    const next = machineToForm(machineState);
    // Apply machine-origin updates without round-tripping back to backend.
    setFormState((current) => {
      // Only overwrite fields that actually differ.
      const merged: FormState = { ...current };
      (Object.keys(next) as Array<keyof FormState>).forEach((k) => {
        if (current[k] !== next[k]) {
          // If this matches the last value we sent, it's just our own echo.
          const key = k as MachineControlKey;
          if (lastSentRef.current[key] === next[k]) {
            // Clear the echo gate now that we've reconciled.
            delete lastSentRef.current[key];
          }
          merged[k] = next[k];
        }
      });
      return merged;
    });
  }, [machineState]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(
      `[machine-sync][ui-state] objective=${formState.objective} force=${formState.force} lightness=${formState.lightness} loadTime=${formState.loadTime} hardnessLevel=${formState.hardnessLevel}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[machine-ui] state objective=${formState.objective} force=${formState.force} lightness=${formState.lightness} loadTime=${formState.loadTime} hardnessLevel=${formState.hardnessLevel}`
    );
  }, [
    formState.force,
    formState.hardnessLevel,
    formState.lightness,
    formState.loadTime,
    formState.objective,
  ]);

  const pushChange = useCallback(
    async (key: MachineControlKey, value: string) => {
      lastSentRef.current[key] = value;
      // eslint-disable-next-line no-console
      console.log(`[machine-ui] change field=${key} value=${value}`);
      if (key === 'objective') {
        // eslint-disable-next-line no-console
        console.log(`[objective][ipc] set-active-objective ${value}`);
      }
      try {
        const nextState = await setControl(key, value);
        setFormState(machineToForm(nextState));
        if (key === 'objective') {
          // eslint-disable-next-line no-console
          console.log(`[objective][backend] saved activeObjective=${value}`);
        }
        return nextState;
      } catch {
        delete lastSentRef.current[key];
        setFormState(machineToForm(machineState));
        return null;
      }
    },
    [machineState, setControl]
  );

  const handleSelectChange = useCallback(
    (field: 'force' | 'objective' | 'hardnessLevel') => (event: SelectChangeEvent) => {
      const value = event.target.value;
      if (
        (field === 'force' && !FORCE_OPTIONS.includes(value)) ||
        (field === 'objective' && !OBJECTIVE_OPTIONS.includes(value)) ||
        (field === 'hardnessLevel' && !HARDNESS_LEVEL_OPTIONS.includes(value))
      ) {
        // eslint-disable-next-line no-console
        console.warn(`[machine-ui] rejected invalid ${field}=${value}`);
        return;
      }
      if (field === 'objective') {
        // eslint-disable-next-line no-console
        console.log(`[objective][ui] changed ${formState.objective} -> ${value}`);
      }
      setFormState((c) => ({ ...c, [field]: value }));
      void pushChange(field, value);
    },
    [formState.objective, pushChange]
  );

  const handleNumberChange = useCallback(
    (field: 'lightness' | 'loadTime') => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setFormState((c) => ({ ...c, [field]: value }));
      // Only push numeric, non-blank values
      if (value.trim() !== '' && isValidNumberField(field, value)) {
        void pushChange(field, value);
      } else if (value.trim() !== '') {
        // eslint-disable-next-line no-console
        console.warn(`[machine-ui] rejected invalid ${field}=${value}`);
      }
    },
    [pushChange]
  );

  const handleHardnessChange = useCallback(
    (event: SelectChangeEvent) => {
      const value = event.target.value;
      if (!HARDNESS_LEVEL_OPTIONS.includes(value)) {
        // eslint-disable-next-line no-console
        console.warn(`[machine-ui] rejected invalid hardnessLevel=${value}`);
        return;
      }
      setFormState((c) => ({ ...c, hardnessLevel: value }));
      void pushChange('hardnessLevel', value);
    },
    [pushChange]
  );

  const handleLensClick = useCallback(
    (objective: '10X' | '40X') => {
      // eslint-disable-next-line no-console
      console.log(`[objective][ui] changed ${formState.objective} -> ${objective}`);
      setFormState((c) => ({ ...c, objective }));
      void pushChange('objective', objective).then((state) => {
        if (state?.objective === objective) {
          onObjectiveChange?.(objective);
        }
      });
    },
    [formState.objective, onObjectiveChange, pushChange]
  );

  const handleIndentClick = useCallback(() => {
    void startIndent();
  }, [startIndent]);

  const connected = machineState?.connected ?? false;
  const indentStatus: IndentStatus = machineState?.indentStatus ?? 'idle';
  const isIndentInFlight = indentStatus === 'started' || indentStatus === 'running';
  const isBusy = setBusy || indentBusy;
  const hasVerifiedCommands = useMemo(() => {
    const verification = machineState?.commandVerification;
    return verification ? Object.values(verification).some(Boolean) : false;
  }, [machineState?.commandVerification]);

  const errorMessage = useMemo(() => {
    return (
      machineState?.lastError ??
      indentError ??
      setError ??
      streamError ??
      null
    );
  }, [indentError, machineState?.lastError, setError, streamError]);

  const statusText = useMemo(() => {
    if (!connected) return 'Machine not connected. Click Open Device to connect.';
    const protocolNote = hasVerifiedCommands ? '' : ' - RS232 protocol unverified; writes disabled';
    return `Connected on ${machineState?.port ?? '?'}${protocolNote} - last update by ${machineState?.lastUpdatedBy ?? 'system'} - indent: ${indentStatus}`;
  }, [
    connected,
    hasVerifiedCommands,
    indentStatus,
    machineState?.lastUpdatedBy,
    machineState?.port,
  ]);

  const syncStatusText = useMemo(() => {
    const status = machineState?.syncStatus ?? 'synced';
    const message = machineState?.syncMessage ? ` - ${machineState.syncMessage}` : '';
    return `${status}${message}`;
  }, [machineState?.syncMessage, machineState?.syncStatus]);

  return (
    <>
      <Box sx={INDENTER_SECTION_SX}>
        <Button
          variant="outlined"
          sx={INDENT_BUTTON_SX}
          disabled={!connected || isIndentInFlight || isBusy}
          onClick={handleIndentClick}
        >
          {indentLabel(indentStatus)}
        </Button>

        <Box sx={INDENTER_RIGHT_SX}>
          <Box sx={ROW_SX}>
            <Typography sx={FIELD_LABEL_SX}>Indenter</Typography>
            <Typography sx={READONLY_VALUE_SX}>HV</Typography>
          </Box>
          <Box sx={ROW_SX}>
            <Typography sx={FIELD_LABEL_SX}>Objective Lens</Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant={formState.objective === '10X' ? 'contained' : 'outlined'}
                size="small"
                sx={LENS_BTN_SX}
                disabled={!connected || isBusy}
                onClick={() => handleLensClick('10X')}
              >
                10X
              </Button>
              <Button
                variant={formState.objective === '40X' ? 'contained' : 'outlined'}
                size="small"
                sx={LENS_BTN_SX}
                disabled={!connected || isBusy}
                onClick={() => handleLensClick('40X')}
              >
                40X
              </Button>
            </Stack>
          </Box>
        </Box>
      </Box>

      <Divider />

      <Box sx={SETTINGS_GRID_SX}>
        <Typography sx={SETTING_LABEL_SX}>Force</Typography>
        <FormControl size="small">
          <Select
            value={formState.force}
            disabled={!connected || isBusy}
            onChange={handleSelectChange('force')}
          >
            {FORCE_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>
                {o}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography sx={SETTING_LABEL_SX}>Lightness</Typography>
        <TextField
          size="small"
          type="number"
          value={formState.lightness}
          disabled={!connected || isBusy}
          onChange={handleNumberChange('lightness')}
          slotProps={{ htmlInput: LIGHTNESS_INPUT_PROPS }}
        />

        <Typography sx={SETTING_LABEL_SX}>Objective</Typography>
        <FormControl size="small">
          <Select
            value={formState.objective}
            disabled={!connected || isBusy}
            onChange={handleSelectChange('objective')}
          >
            {OBJECTIVE_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>
                {o}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography sx={SETTING_LABEL_SX}>Load Time(s)</Typography>
        <TextField
          size="small"
          type="number"
          value={formState.loadTime}
          disabled={!connected || isBusy}
          onChange={handleNumberChange('loadTime')}
          slotProps={{ htmlInput: LOAD_TIME_INPUT_PROPS }}
        />

        <Typography sx={SETTING_LABEL_SX}>Hardness Level</Typography>
        <FormControl size="small">
          <Select
            value={formState.hardnessLevel}
            disabled={!connected || isBusy}
            onChange={handleHardnessChange}
          >
            {HARDNESS_LEVEL_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>
                {o}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box />
        <Box />
      </Box>

      <Box sx={STATUS_ROW_SX}>
        {isBusy ? <CircularProgress size={14} /> : null}
        <Typography sx={STATUS_TEXT_SX}>{statusText}</Typography>
      </Box>

      <Box sx={STATUS_DETAILS_SX}>
        <Typography sx={STATUS_DETAIL_SX}>
          Last RX: {formatTimestamp(machineState?.lastRxAt)}
        </Typography>
        <Typography sx={STATUS_DETAIL_SX}>
          Last TX: {machineState?.lastTxCommand ?? 'None'}
        </Typography>
        <Typography sx={STATUS_DETAIL_SX}>Sync: {syncStatusText}</Typography>
        <Typography sx={STATUS_DETAIL_SX}>
          Current: F={formState.force}, L={formState.lightness}, T={formState.loadTime}, Obj={formState.objective}
        </Typography>
      </Box>

      {errorMessage ? (
        <Alert severity="error" sx={ALERT_SX}>
          {errorMessage}
        </Alert>
      ) : null}
    </>
  );
}

export default memo(MachineControlTabImpl);
