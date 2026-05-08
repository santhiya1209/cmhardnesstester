import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
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
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useMachineState } from '@/hooks/queries/useMachineState';
import { useSetMachineControl } from '@/hooks/mutations/useSetMachineControl';
import { useStartIndent } from '@/hooks/mutations/useStartIndent';
import { useTurret } from '@/hooks/mutations/useTurret';
import type { IndentStatus, MachineControlKey, MachineState, TurretDirection } from '@/types/machine';

type MachineControlTabProps = {
  /** Called after the backend accepts a 10X / 40X lens change. */
  onObjectiveChange?: (objective: '10X' | '40X') => void;
};

const FORCE_OPTIONS = ['0.01kgf', '0.025kgf', '0.05kgf', '0.1kgf', '0.2kgf', '0.3kgf', '0.5kgf', '1kgf'];
const OBJECTIVE_OPTIONS = ['2.5X', '5X', '10X', '20X', '40X', '50X'];
const HARDNESS_LEVEL_OPTIONS = ['Low', 'Middle', 'High'];
const LIGHTNESS_INPUT_PROPS = { min: 0, max: 10, step: 1 } as const;
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
  gridTemplateColumns: '200px auto auto',
  gap: 2,
  px: 1.5,
  py: 1.5,
  alignItems: 'center',
};
const INDENT_BUTTON_SX: SxProps<Theme> = {
  width: 200,
  height: 64,
  textTransform: 'none',
  fontSize: 14,
  fontWeight: 500,
};
const TURRET_LABEL_SX: SxProps<Theme> = { fontSize: 14, color: 'text.secondary', px: 2 };
const TURRET_BUTTON_SX: SxProps<Theme> = {
  minWidth: 0,
  width: 56,
  height: 44,
  p: 0,
  borderRadius: 0.5,
};
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
const STATUS_DOT_SX: SxProps<Theme> = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};
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
      return 'Impress';
    case 'started':
      return 'Impress (starting)';
    case 'running':
      return 'Impress (running)';
    case 'completed':
      return 'Impress (done)';
    case 'error':
      return 'Impress (error)';
    default:
      return 'Impress';
  }
}

function isValidNumberField(field: 'lightness' | 'loadTime', value: string): boolean {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return false;
  if (field === 'lightness') return numeric >= 0 && numeric <= 10;
  return numeric >= 1 && numeric <= 99;
}

function MachineControlTabImpl({ onObjectiveChange }: MachineControlTabProps = {}) {
  const { data: machineState, error: streamError } = useMachineState();
  const { setControl, busy: setBusy, error: setError } = useSetMachineControl();
  const { start: startIndent, busy: indentBusy, error: indentError } = useStartIndent();
  const { move: moveTurret, busy: turretBusy, error: turretError } = useTurret();

  const formState = useMemo(() => machineToForm(machineState), [machineState]);

  // One-shot startup log: surface the values that came back from SQLite via
  // the backend SSE snapshot so operators can verify what was restored.
  const restoredLoggedRef = useRef(false);
  useEffect(() => {
    if (restoredLoggedRef.current) return;
    if (!machineState) return;
    restoredLoggedRef.current = true;
    // eslint-disable-next-line no-console
    console.log(
      `[machine-control-ui] restored lightness=${machineState.lightness} loadTime=${machineState.loadTime}`
    );
  }, [machineState]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(
      `[MachineControl] render force=${formState.force} objective=${formState.objective} lightness=${formState.lightness} loadTime=${formState.loadTime}`
    );
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

  useEffect(() => {
    if (!machineState) return;
    const source = machineState.lastUpdateSource ?? machineState.lastUpdatedBy;
    if (source !== 'machine') return;
    // eslint-disable-next-line no-console
    console.log(`[MachineControl] machine update source=machine force=${machineState.force}`);
    // eslint-disable-next-line no-console
    console.log(`[MachineControl] force updated from machine value=${machineState.force}`);
    // eslint-disable-next-line no-console
    console.log(`[frontend-machine-state] force updated from machine value=${machineState.force}`);
    // eslint-disable-next-line no-console
    console.log(`[machine-force-panel-update] value=${machineState.force} source=machine`);
    // eslint-disable-next-line no-console
    console.log(`[MachineControl] machine update source=machine objective=${machineState.objective}`);
    // eslint-disable-next-line no-console
    console.log(
      `[frontend-machine-state] objective updated from machine value=${machineState.objective}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[frontend-machine-state] objective confirmed value=${machineState.objective}`
    );
  }, [
    machineState?.force,
    machineState?.lastUpdateSource,
    machineState?.lastUpdatedBy,
    machineState?.objective,
  ]);

  const pushChange = useCallback(
    async (key: MachineControlKey, value: string) => {
      // eslint-disable-next-line no-console
      console.log(`[machine-ui] change field=${key} value=${value}`);
      if (key === 'force') {
        // eslint-disable-next-line no-console
        console.log(`[MachineControl] force change requested value=${value}`);
        // eslint-disable-next-line no-console
        console.log(`[machine-force-ui-change] value=${value}`);
      }
      if (key === 'objective') {
        // eslint-disable-next-line no-console
        console.log(`[frontend-tx] objective requested value=${value}`);
        // eslint-disable-next-line no-console
        console.log(`[objective][ipc] set-active-objective ${value}`);
      }
      try {
        const nextState = await setControl(key, value);
        if (key === 'objective') {
          // eslint-disable-next-line no-console
          console.log(`[objective][backend] saved activeObjective=${value}`);
        }
        return nextState;
      } catch {
        return null;
      }
    },
    [setControl]
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
        // eslint-disable-next-line no-console
        console.log(`[objective-ui] click value=${value}`);
        void pushChange(field, value).then((state) => {
          if ((value === '10X' || value === '40X') && state?.objective === value) {
            onObjectiveChange?.(value);
          }
        });
        return;
      }
      if (field === 'force') {
        void pushChange(field, value);
        return;
      }
      void pushChange(field, value);
    },
    [formState.objective, onObjectiveChange, pushChange]
  );

  const handleNumberChange = useCallback(
    (field: 'lightness' | 'loadTime') => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
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
      void pushChange('hardnessLevel', value);
    },
    [pushChange]
  );

  const handleIndentClick = useCallback(() => {
    void startIndent();
  }, [startIndent]);

  const handleTurretClick = useCallback(
    (direction: TurretDirection) => () => {
      // eslint-disable-next-line no-console
      console.log(`[machine-ui] turret click direction=${direction}`);
      void moveTurret(direction).catch(() => {
        // Errors surface via turretError -> errorMessage. UI must NOT
        // optimistically reflect motion; real state comes from machine RX.
      });
    },
    [moveTurret]
  );

  const connected = machineState?.connected ?? false;
  const indentStatus: IndentStatus = machineState?.indentStatus ?? 'idle';
  const isIndentInFlight = indentStatus === 'started' || indentStatus === 'running';
  const isBusy = setBusy || indentBusy || turretBusy;

  // Hook-local errors (indentError/turretError/setError) persist in React state
  // until the next click. Once the backend reports a healthy sync (lastError
  // cleared, syncStatus='synced'), those local strings become stale and must
  // not keep the red banner visible. Backend lastError remains authoritative.
  const recovered =
    !!connected &&
    !machineState?.lastError &&
    (machineState?.syncStatus === 'synced' || machineState?.syncStatus === undefined);
  const errorMessage = useMemo(() => {
    if (machineState?.lastError) return machineState.lastError;
    if (recovered) return null;
    return indentError ?? turretError ?? setError ?? streamError ?? null;
  }, [indentError, machineState?.lastError, recovered, setError, streamError, turretError]);

  const statusLabel = useMemo(() => {
    if (!connected) return 'Disconnected';
    if (errorMessage) return 'Error';
    if (isIndentInFlight) return 'Impressing';
    if (isBusy) return 'Busy';
    return 'Ready';
  }, [connected, errorMessage, isBusy, isIndentInFlight]);

  const statusDotColor = useMemo(() => {
    if (!connected || errorMessage) return 'error.main';
    if (isBusy || isIndentInFlight) return 'warning.main';
    return 'success.main';
  }, [connected, errorMessage, isBusy, isIndentInFlight]);

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

        <Typography sx={TURRET_LABEL_SX}>Turret</Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            color="primary"
            sx={TURRET_BUTTON_SX}
            disabled={!connected || isBusy}
            onClick={handleTurretClick('left')}
            aria-label="Turret left"
          >
            <ArrowBackIcon fontSize="small" />
          </Button>
          <Button
            variant="contained"
            color="primary"
            sx={TURRET_BUTTON_SX}
            disabled={!connected || isBusy}
            onClick={handleTurretClick('front')}
            aria-label="Turret front"
          >
            <ArrowDownwardIcon fontSize="small" />
          </Button>
          <Button
            variant="contained"
            color="primary"
            sx={TURRET_BUTTON_SX}
            disabled={!connected || isBusy}
            onClick={handleTurretClick('right')}
            aria-label="Turret right"
          >
            <ArrowForwardIcon fontSize="small" />
          </Button>
        </Stack>
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
        <Box sx={{ ...STATUS_DOT_SX, bgcolor: statusDotColor }} />
        <Typography sx={STATUS_TEXT_SX}>
          {connected
            ? `Machine: Connected · COM: ${machineState?.port ?? '?'} · Status: ${statusLabel}`
            : `Machine: Disconnected · Status: ${statusLabel}`}
        </Typography>
        {isBusy ? <CircularProgress size={12} /> : null}
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
