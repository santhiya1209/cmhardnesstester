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
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Paper from '@mui/material/Paper';
import { alpha, type SxProps, type Theme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useMachineState } from '@/hooks/queries/useMachineState';
import { useSetMachineControl } from '@/hooks/mutations/useSetMachineControl';
import { useStartIndent } from '@/hooks/mutations/useStartIndent';
import { useTurret } from '@/hooks/mutations/useTurret';
import type { IndentStatus, MachineControlKey, MachineState, TurretDirection } from '@/types/machine';

type MachineControlTabProps = {
  hvDisplay?: string;
  hvTypeValue?: string | null;
  hardnessValue?: string;
  /** Called after the backend accepts a 10X / 40X lens change. */
  onObjectiveChange?: (objective: '10X' | '40X') => void;
  /**
   * Fired the instant a turret direction button is clicked, before the IPC
   * is sent. App-level uses this to clear stale Auto/Manual/Calibration
   * overlays so the operator never sees old yellow lines on top of the
   * moving image during turret rotation.
   */
  onTurretIntent?: () => void;
  /**
   * Same as `onTurretIntent` but fired when the user picks a 10X / 40X
   * objective via the dropdown — i.e. an intent to move that will change
   * the optical zoom. Overlays must clear immediately, before the machine
   * RX confirms.
   */
  onObjectiveChangeIntent?: (target: '10X' | '40X') => void;
};

const FORCE_OPTIONS = ['0.01kgf', '0.025kgf', '0.05kgf', '0.1kgf', '0.2kgf', '0.3kgf', '0.5kgf', '1kgf'];
// Real machine turret slots (per machine notes):
//   UL1 -> 10X, UL2 -> IND (indenter), UL3 -> 40X.
// Other zoom values exist in the calibration table for legacy reasons but the
// physical turret on this tester only addresses these three slots.
const OBJECTIVE_OPTIONS = ['10X', 'IND', '40X'];
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

const ROOT_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
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
const HV_BOTTOM_SECTION_SX: SxProps<Theme> = {
  width: '100%',
  px: 1.5,
  py: 1,
  borderTop: 1,
  borderColor: 'divider',
};
const HV_BOTTOM_ROW_SX: SxProps<Theme> = {
  width: '100%',
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 1.25,
  alignItems: 'stretch',
};
const HV_COMPACT_CARD_SX: SxProps<Theme> = (theme) => ({
  minWidth: 0,
  overflow: 'hidden',
  display: 'grid',
  gridTemplateRows: `${theme.spacing(3)} ${theme.spacing(6.5)}`,
  borderRadius: 0.5,
  border: 1,
  borderColor: 'primary.dark',
  bgcolor: 'primary.dark',
  boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.common.white, 0.06)}`,
});
const HV_COMPACT_TITLE_SX: SxProps<Theme> = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  px: 1,
  bgcolor: 'primary.main',
  color: 'primary.contrastText',
};
const HV_COMPACT_TITLE_TEXT_SX: SxProps<Theme> = {
  color: 'inherit',
  fontWeight: 800,
  letterSpacing: 0,
  lineHeight: 1,
  textTransform: 'uppercase',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const HV_COMPACT_VALUE_SX: SxProps<Theme> = (theme) => ({
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  px: 1,
  bgcolor: 'primary.dark',
  borderTop: `1px solid ${alpha(theme.palette.common.white, 0.12)}`,
  color: 'primary.contrastText',
});
const HV_COMPACT_VALUE_TEXT_SX: SxProps<Theme> = {
  color: 'inherit',
  fontSize: (theme) => theme.typography.pxToRem(24),
  fontWeight: 800,
  lineHeight: 1,
  letterSpacing: 0,
  fontVariantNumeric: 'tabular-nums',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const ALERT_SX: SxProps<Theme> = { mx: 1.5, mb: 1.5 };

function machineToForm(state: MachineState | null): FormState {
  if (!state) return DEFAULT_FORM_STATE;
  // The dropdown reflects the machine-confirmed objective (set on L1OK/L2OK
  // RX). state.objective is the optimistic activeObjective written by the
  // last set-control TX — using it would let the dropdown jump to the user's
  // pick before the lens physically rotates. Fall back to state.objective
  // only when no confirmation has arrived yet (first connection).
  return {
    force: String(state.force),
    lightness: String(state.lightness),
    loadTime: String(state.loadTime),
    objective: state.confirmedObjectiveFromMachine ?? state.objective,
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

type CompactHvCardProps = {
  title: string;
  value: string;
};

function CompactHvCard({ title, value }: CompactHvCardProps) {
  return (
    <Paper elevation={0} sx={HV_COMPACT_CARD_SX}>
      <Box sx={HV_COMPACT_TITLE_SX}>
        <Typography variant="overline" sx={HV_COMPACT_TITLE_TEXT_SX}>
          {title}
        </Typography>
      </Box>
      <Box sx={HV_COMPACT_VALUE_SX}>
        <Typography title={value} sx={HV_COMPACT_VALUE_TEXT_SX}>
          {value}
        </Typography>
      </Box>
    </Paper>
  );
}

function MachineControlTabImpl({
  hvDisplay = '',
  hvTypeValue = null,
  hardnessValue = 'N/A',
  onObjectiveChange,
  onTurretIntent,
  onObjectiveChangeIntent,
}: MachineControlTabProps = {}) {
  const { data: machineState, error: streamError } = useMachineState();
  const { setControl, busy: setBusy, error: setError } = useSetMachineControl();
  const { start: startIndent, busy: indentBusy, error: indentError } = useStartIndent();
  const { move: moveTurret, busy: turretBusy, error: turretError } = useTurret();

  const formState = useMemo(() => machineToForm(machineState), [machineState]);
  const bottomHvDisplay = hvDisplay.trim() ? hvDisplay : 'N/A';
  const bottomHvTypeDisplay = useMemo(() => {
    const trimmed = hvTypeValue?.trim();
    return trimmed ? trimmed : 'HV';
  }, [hvTypeValue]);
  const bottomHardnessDisplay = hardnessValue.trim() ? hardnessValue : 'N/A';

  // Local input state for Lightness so the field reflects what the user just
  // typed without waiting for the backend → RS232 → ACK → SSE round trip. The
  // field stays disconnected from machineState only while the user is actively
  // editing; once a machine confirmation arrives, the latest value wins.
  const [lightnessInput, setLightnessInput] = useState<string>(formState.lightness);
  const lightnessDirtyRef = useRef(false);
  const lastLightnessSyncedRef = useRef<string>(formState.lightness);
  useEffect(() => {
    const incoming = String(machineState?.lightness ?? '');
    if (!incoming) return;
    if (incoming === lastLightnessSyncedRef.current) return;
    lastLightnessSyncedRef.current = incoming;
    // Machine-confirmed value wins, even if the user has a dirty input — the
    // physical machine is the source of truth and an ACK means the new value
    // is in effect. This also covers operator-driven changes on the panel.
    lightnessDirtyRef.current = false;
    setLightnessInput(incoming);
    const source = machineState?.lastUpdateSource ?? machineState?.lastUpdatedBy ?? 'machine';
    // eslint-disable-next-line no-console
    console.log(`[lightness-sync] source=${source} value=${incoming}`);
  }, [machineState?.lightness, machineState?.lastUpdateSource, machineState?.lastUpdatedBy]);

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
    // eslint-disable-next-line no-console
    console.log(`[machine-control-bottom-hv-compact-render] value=${bottomHvDisplay}`);
  }, [bottomHvDisplay]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(`[machine-control-bottom-hvtype-compact-render] value=${bottomHvTypeDisplay}`);
  }, [bottomHvTypeDisplay]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(`[machine-control-bottom-hardness-compact-render] value=${bottomHardnessDisplay}`);
  }, [bottomHardnessDisplay]);

  // Mirror confirmedObjectiveFromMachine into a ref so impress logs can read
  // the freshest value without re-binding the click handler on every SSE tick.
  const lastConfirmedObjectiveRef = useRef<string | null>(null);
  useEffect(() => {
    const confirmed = machineState?.confirmedObjectiveFromMachine ?? null;
    if (confirmed === lastConfirmedObjectiveRef.current) return;
    lastConfirmedObjectiveRef.current = confirmed;
    if (confirmed) {
      // eslint-disable-next-line no-console
      console.log(`[machine-objective-rx] confirmedObjective=${confirmed}`);
      // eslint-disable-next-line no-console
      console.log(
        `[machine-objective-sync] uiObjective=${formState.objective} confirmedObjective=${confirmed}`
      );
    }
  }, [machineState?.confirmedObjectiveFromMachine, formState.objective]);

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
        // eslint-disable-next-line no-console
        console.log(`[machine-objective-tx] objective=${value}`);
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
        // eslint-disable-next-line no-console
        console.log(`[objective-ui-click] objective=${value}`);
        // eslint-disable-next-line no-console
        console.log(`[machine-objective-ui] selected=${value}`);
        // Fire overlay-clear intent immediately so stale yellow lines are
        // gone before the optical zoom actually changes.
        if (value === '10X' || value === '40X') {
          onObjectiveChangeIntent?.(value);
        }
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
    [formState.objective, onObjectiveChange, onObjectiveChangeIntent, pushChange]
  );

  const handleNumberChange = useCallback(
    (field: 'lightness' | 'loadTime') => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      if (field === 'lightness') {
        // Echo the keystroke into local state immediately so the field never
        // appears frozen while the IPC + RS232 round trip is in flight.
        lightnessDirtyRef.current = true;
        setLightnessInput(value);
        // eslint-disable-next-line no-console
        console.log(`[lightness-ui-change] value=${value}`);
      }
      // Only push numeric, non-blank values
      if (value.trim() !== '' && isValidNumberField(field, value)) {
        if (field === 'lightness') {
          // eslint-disable-next-line no-console
          console.log(`[lightness-ipc-send] value=${value}`);
        }
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

  // Impress progress popup. Opens on click, transitions to "done" after the
  // machine reports indentStatus='completed', or to "error" on indent failure
  // / ACK timeout. Auto-closes 1.5 s after done, 4 s after error.
  const [impressPopup, setImpressPopup] = useState<{
    open: boolean;
    status: 'running' | 'done' | 'error';
    message: string;
  }>({ open: false, status: 'running', message: '' });
  const impressAutoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIndentStatusRef = useRef<IndentStatus>(machineState?.indentStatus ?? 'idle');

  const closeImpressPopup = useCallback(() => {
    if (impressAutoCloseTimerRef.current !== null) {
      clearTimeout(impressAutoCloseTimerRef.current);
      impressAutoCloseTimerRef.current = null;
    }
    setImpressPopup((current) => ({ ...current, open: false }));
  }, []);

  useEffect(() => {
    return () => {
      if (impressAutoCloseTimerRef.current !== null) {
        clearTimeout(impressAutoCloseTimerRef.current);
      }
    };
  }, []);

  const handleIndentClick = useCallback(() => {
    // Source-of-truth resolution: confirmed lens position first, optimistic
    // activeObjective only when no confirmation has arrived yet. Mirrors the
    // backend command path so the operator can verify which objective the
    // impress is actually firing under.
    const confirmedObjective =
      machineState?.confirmedObjectiveFromMachine ?? lastConfirmedObjectiveRef.current ?? null;
    const activeObjective = machineState?.objective ?? null;
    const objectiveForCommand = confirmedObjective ?? activeObjective ?? formState.objective;
    // eslint-disable-next-line no-console
    console.log(
      `[impress-click] confirmedObjective=${confirmedObjective ?? 'null'} activeObjective=${activeObjective ?? 'null'}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[impress-command-context] objective=${objectiveForCommand} force=${formState.force} loadTime=${formState.loadTime}`
    );
    if (impressAutoCloseTimerRef.current !== null) {
      clearTimeout(impressAutoCloseTimerRef.current);
      impressAutoCloseTimerRef.current = null;
    }
    setImpressPopup({ open: true, status: 'running', message: 'Impress process is running...' });
    // eslint-disable-next-line no-console
    console.log('[impress-popup] open');
    // eslint-disable-next-line no-console
    console.log('[impress-popup] status=running');
    void startIndent().catch((err) => {
      const reason = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.log(`[impress-popup] status=error reason=${reason}`);
      setImpressPopup({
        open: true,
        status: 'error',
        message: `Impress failed: ${reason}`,
      });
      impressAutoCloseTimerRef.current = setTimeout(() => {
        impressAutoCloseTimerRef.current = null;
        setImpressPopup((current) => ({ ...current, open: false }));
        // eslint-disable-next-line no-console
        console.log('[impress-popup] auto-close');
      }, 4000);
    });
  }, [
    formState.force,
    formState.loadTime,
    formState.objective,
    machineState?.confirmedObjectiveFromMachine,
    machineState?.objective,
    startIndent,
  ]);

  // Watch machine indent status transitions to drive popup state. Real machine
  // status only — no optimistic "done" on click.
  useEffect(() => {
    const prev = lastIndentStatusRef.current;
    const next: IndentStatus = machineState?.indentStatus ?? 'idle';
    if (prev === next) return;
    lastIndentStatusRef.current = next;
    if (!impressPopup.open) return;
    if (impressPopup.status !== 'running') return;

    if (next === 'completed') {
      // eslint-disable-next-line no-console
      console.log('[impress-popup] status=done');
      setImpressPopup({ open: true, status: 'done', message: 'Impress is done' });
      if (impressAutoCloseTimerRef.current !== null) {
        clearTimeout(impressAutoCloseTimerRef.current);
      }
      impressAutoCloseTimerRef.current = setTimeout(() => {
        impressAutoCloseTimerRef.current = null;
        setImpressPopup((current) => ({ ...current, open: false }));
        // eslint-disable-next-line no-console
        console.log('[impress-popup] auto-close');
      }, 1500);
      return;
    }
    if (next === 'error') {
      const reason = machineState?.lastError ?? 'machine reported error';
      // eslint-disable-next-line no-console
      console.log(`[impress-popup] status=error reason=${reason}`);
      setImpressPopup({
        open: true,
        status: 'error',
        message: `Impress failed: ${reason}`,
      });
      if (impressAutoCloseTimerRef.current !== null) {
        clearTimeout(impressAutoCloseTimerRef.current);
      }
      impressAutoCloseTimerRef.current = setTimeout(() => {
        impressAutoCloseTimerRef.current = null;
        setImpressPopup((current) => ({ ...current, open: false }));
        // eslint-disable-next-line no-console
        console.log('[impress-popup] auto-close');
      }, 4000);
    }
  }, [impressPopup.open, impressPopup.status, machineState?.indentStatus, machineState?.lastError]);

  const handleTurretClick = useCallback(
    (direction: TurretDirection) => () => {
      // eslint-disable-next-line no-console
      console.log(`[machine-ui] turret click direction=${direction}`);
      // eslint-disable-next-line no-console
      console.log(`[machine-turret-click] direction=${direction}`);
      // Fire overlay-clear intent BEFORE the IPC so stale yellow lines are
      // gone from the moment the operator presses the button.
      onTurretIntent?.();
      // eslint-disable-next-line no-console
      console.log(`[machine-turret-tx] command=move-turret direction=${direction}`);
      void moveTurret(direction)
        .then(() => {
          // eslint-disable-next-line no-console
          console.log(`[machine-turret-ack] status=ok direction=${direction}`);
        })
        .catch(() => {
          // Errors surface via turretError -> errorMessage. UI must NOT
          // optimistically reflect motion; real state comes from machine RX.
        });
    },
    [moveTurret, onTurretIntent]
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

  return (
    <Box sx={ROOT_SX}>
      <Box sx={INDENTER_SECTION_SX}>
        <Button
          variant="outlined"
          sx={INDENT_BUTTON_SX}
          disabled={!connected || isIndentInFlight || isBusy || impressPopup.open}
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
          value={lightnessInput}
          disabled={!connected}
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

      <Box sx={HV_BOTTOM_SECTION_SX}>
        <Box sx={HV_BOTTOM_ROW_SX}>
          <CompactHvCard title="HV" value={bottomHvDisplay} />
          <CompactHvCard title="HV TYPE" value={bottomHvTypeDisplay} />
          <CompactHvCard title="HARDNESS" value={bottomHardnessDisplay} />
        </Box>
      </Box>

      {errorMessage ? (
        <Alert severity="error" sx={ALERT_SX}>
          {errorMessage}
        </Alert>
      ) : null}

      <Dialog
        open={impressPopup.open}
        onClose={impressPopup.status === 'running' ? undefined : closeImpressPopup}
        maxWidth="xs"
      >
        <DialogContent sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 280 }}>
          {impressPopup.status === 'running' ? <CircularProgress size={20} /> : null}
          <Typography
            sx={{
              fontSize: 14,
              color:
                impressPopup.status === 'error'
                  ? 'error.main'
                  : impressPopup.status === 'done'
                    ? 'success.main'
                    : 'text.primary',
            }}
          >
            {impressPopup.message}
          </Typography>
        </DialogContent>
        {impressPopup.status === 'error' ? (
          <DialogActions>
            <Button size="small" onClick={closeImpressPopup}>
              Close
            </Button>
          </DialogActions>
        ) : null}
      </Dialog>
    </Box>
  );
}

export default memo(MachineControlTabImpl);
