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
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Slider from '@mui/material/Slider';
import { alpha, type SxProps, type Theme } from '@mui/material/styles';
import Brightness5Icon from '@mui/icons-material/Brightness5';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import {
  IndentCenterIcon,
  Objective10xIcon,
  Objective40xIcon,
} from '@/component/ui/ObjectiveIcons';
import { useMachineState } from '@/hooks/queries/useMachineState';
import { useSetMachineControl } from '@/hooks/mutations/useSetMachineControl';
import { useStartIndent } from '@/hooks/mutations/useStartIndent';
import { useTurret } from '@/hooks/mutations/useTurret';
import type { IndentStatus, MachineControlKey, MachineState, TurretDirection } from '@/types/machine';
import { useRenderCount } from '@/utils/renderStats';

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
const LIGHTNESS_MIN = 1;
const LIGHTNESS_MAX = 10;
const LIGHTNESS_SEND_DEBOUNCE_MS = 200;
const LOAD_TIME_INPUT_PROPS = { min: 1, max: 99, step: 1 } as const;

function clampLightness(n: number): number {
  if (!Number.isFinite(n)) return LIGHTNESS_MIN;
  const i = Math.round(n);
  if (i < LIGHTNESS_MIN) return LIGHTNESS_MIN;
  if (i > LIGHTNESS_MAX) return LIGHTNESS_MAX;
  return i;
}

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
// Unified Machine-Control panel: one bordered container, two grid rows
// (2 cols / 3 cols), zero gap between cells, internal 1px separators only.
const CONTROL_CONTAINER_SX: SxProps<Theme> = {
  borderBottom: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
};
const TOP_ROW_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  borderBottom: 1,
  borderColor: 'divider',
};
function topCardSx(opts: { interactive: boolean; accentColor: 'info' | 'primary'; cellIndex: number }): SxProps<Theme> {
  return (theme) => {
    const accent = opts.accentColor === 'info' ? theme.palette.info : theme.palette.primary;
    const base = {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0.5,
      minHeight: 88,
      px: 1,
      py: 1.25,
      borderRadius: 0,
      borderLeft: opts.cellIndex > 0 ? 1 : 0,
      borderColor: 'divider',
      bgcolor: 'background.paper',
      color: accent.main,
      textTransform: 'none' as const,
      transition: theme.transitions.create(['background-color'], { duration: 180 }),
      '&.Mui-disabled': {
        color: 'text.disabled',
        bgcolor: 'background.paper',
      },
    };
    if (!opts.interactive) {
      return { ...base, cursor: 'default' };
    }
    return {
      ...base,
      '&:hover': {
        bgcolor: alpha(accent.main, 0.05),
      },
    };
  };
}
const TOP_CARD_LABEL_SX: SxProps<Theme> = {
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.3,
  lineHeight: 1,
};
const TOP_CARD_ICON_SX: SxProps<Theme> = {
  fontSize: 30,
};
const OBJECTIVE_ROW_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
};
const TURRET_ICON_ROW_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
};
const TURRET_CARD_LABEL_SX: SxProps<Theme> = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.4,
  lineHeight: 1,
  mt: 0.75,
};
const TURRET_OBJECTIVE_ICON_SX: SxProps<Theme> = {
  fontSize: 28,
  color: 'inherit',
};

type TurretVariant = '10X' | 'CENTER' | '40X';

function turretCardSx(variant: TurretVariant, active: boolean, cellIndex: number): SxProps<Theme> {
  return (theme) => {
    const accent =
      variant === '10X'
        ? theme.palette.warning.main
        : variant === '40X'
          ? theme.palette.info.main
          : theme.palette.grey[500];
    return {
      position: 'relative',
      width: '100%',
      minWidth: 0,
      minHeight: 92,
      px: 1,
      pt: 1,
      pb: 1.5,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 0,
      borderLeft: cellIndex > 0 ? 1 : 0,
      borderColor: 'divider',
      bgcolor: active ? alpha(accent, 0.08) : 'background.paper',
      color: 'text.primary',
      textTransform: 'none',
      transition: theme.transitions.create(['background-color'], { duration: 180 }),
      // Bottom accent strip: yellow for 10X, blue for 40X, neutral for Center.
      '&::after': {
        content: '""',
        position: 'absolute',
        left: 10,
        right: 10,
        bottom: 4,
        height: 3,
        borderRadius: 2,
        backgroundColor: variant === 'CENTER' ? (active ? accent : 'transparent') : accent,
        opacity: variant === 'CENTER' ? 1 : active ? 1 : 0.7,
        transition: 'background-color 180ms ease, opacity 180ms ease',
      },
      '&:hover': {
        bgcolor: alpha(accent, 0.06),
        '&::after': { opacity: 1, backgroundColor: accent },
      },
      '&.Mui-disabled': {
        bgcolor: 'background.paper',
        color: 'text.disabled',
        '&::after': { backgroundColor: 'transparent', opacity: 0 },
      },
    };
  };
}
const SETTINGS_GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: '80px 1fr 90px 1fr',
  rowGap: 1,
  columnGap: 1.25,
  alignItems: 'center',
  mx: 1.5,
  my: 1,
  px: 1.5,
  py: 1.5,
  borderRadius: 2,
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  boxShadow: '0 1px 2px rgba(15, 42, 71, 0.04)',
};
const SETTING_LABEL_SX: SxProps<Theme> = {
  fontSize: 12,
  fontWeight: 500,
  color: 'text.secondary',
};
const HV_BOTTOM_SECTION_SX: SxProps<Theme> = {
  width: '100%',
  px: 1.5,
  pt: 1,
  pb: 1.25,
};
const HV_BOTTOM_ROW_SX: SxProps<Theme> = {
  width: '100%',
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  bgcolor: 'background.paper',
};
const hvItemSx = (cellIndex: number): SxProps<Theme> => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 0.5,
  minWidth: 0,
  px: 1.5,
  py: 1.25,
  borderLeft: cellIndex > 0 ? 1 : 0,
  borderColor: 'divider',
});
const HV_LABEL_SX: SxProps<Theme> = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  color: 'text.secondary',
  lineHeight: 1,
};
const HV_VALUE_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 0.5,
  minWidth: 0,
};
const HV_VALUE_TEXT_SX: SxProps<Theme> = {
  fontSize: 20,
  fontWeight: 600,
  lineHeight: 1.1,
  color: 'text.primary',
  fontVariantNumeric: 'tabular-nums',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const HV_UNIT_TEXT_SX: SxProps<Theme> = {
  fontSize: 11,
  fontWeight: 500,
  color: 'text.secondary',
  letterSpacing: 0.3,
  textTransform: 'uppercase',
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
  if (field === 'lightness') return numeric >= LIGHTNESS_MIN && numeric <= LIGHTNESS_MAX;
  return numeric >= 1 && numeric <= 99;
}

const LIGHTNESS_CONTAINER_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  px: 1,
  py: 0,
  minHeight: 40,
};
const LIGHTNESS_SLIDER_WRAP_SX: SxProps<Theme> = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
};
// Sizing only — color (sky-blue track + white thumb with glow) comes from the
// global MuiSlider theme override so every slider in the app stays consistent.
const LIGHTNESS_SLIDER_SX: SxProps<Theme> = {
  height: 4,
  py: '12px',
  '& .MuiSlider-rail': { height: 2 },
  '& .MuiSlider-track': { height: 2 },
  '& .MuiSlider-thumb': {
    width: 16,
    height: 16,
  },
};
const LIGHTNESS_LABELS_SX: SxProps<Theme> = {
  display: 'flex',
  justifyContent: 'space-between',
  mt: -0.5,
  px: '2px',
  color: 'text.secondary',
  fontSize: 10,
  lineHeight: 1,
};
const LIGHTNESS_ICON_SMALL_SX: SxProps<Theme> = { fontSize: 16, color: 'text.secondary' };
const LIGHTNESS_ICON_LARGE_SX: SxProps<Theme> = { fontSize: 22, color: 'text.primary' };

type LightnessControlProps = {
  value: string;
  disabled: boolean;
  onDrag: (value: number) => void;
  onCommit: (value: number) => void;
};

function LightnessControlImpl({ value, disabled, onDrag, onCommit }: LightnessControlProps) {
  useRenderCount('LightnessControl');
  const parsed = Number(value);
  const sliderValue = Number.isFinite(parsed) ? clampLightness(parsed) : LIGHTNESS_MIN;
  return (
    <Box sx={LIGHTNESS_CONTAINER_SX}>
      <Brightness5Icon sx={LIGHTNESS_ICON_SMALL_SX} />
      <Box sx={LIGHTNESS_SLIDER_WRAP_SX}>
        <Slider
          value={sliderValue}
          min={LIGHTNESS_MIN}
          max={LIGHTNESS_MAX}
          step={1}
          disabled={disabled}
          onChange={(_, v) => onDrag(Array.isArray(v) ? v[0] : v)}
          onChangeCommitted={(_, v) => onCommit(Array.isArray(v) ? v[0] : v)}
          sx={LIGHTNESS_SLIDER_SX}
          aria-label="Lightness"
        />
        <Box sx={LIGHTNESS_LABELS_SX}>
          <span>{LIGHTNESS_MIN}</span>
          <span>{LIGHTNESS_MAX}</span>
        </Box>
      </Box>
      <Brightness7Icon sx={LIGHTNESS_ICON_LARGE_SX} />
    </Box>
  );
}
const LightnessControl = memo(LightnessControlImpl);

type HvReadoutProps = {
  label: string;
  value: string;
  unit: string;
  cellIndex: number;
};

function HvReadout({ label, value, unit, cellIndex }: HvReadoutProps) {
  const showUnit = value !== 'N/A' && unit.length > 0;
  return (
    <Box sx={hvItemSx(cellIndex)}>
      <Typography sx={HV_LABEL_SX}>{label}</Typography>
      <Box sx={HV_VALUE_SX} title={`${value}${showUnit ? ` ${unit}` : ''}`}>
        <Typography component="span" sx={HV_VALUE_TEXT_SX}>
          {value}
        </Typography>
        {showUnit ? (
          <Typography component="span" sx={HV_UNIT_TEXT_SX}>
            {unit}
          </Typography>
        ) : null}
      </Box>
    </Box>
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
  useRenderCount('MachineControlTab');
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
  }, [machineState?.lightness]);

  // Mirror confirmedObjectiveFromMachine into a ref so the click handler can
  // read the freshest value without re-binding on every SSE tick.
  const lastConfirmedObjectiveRef = useRef<string | null>(null);
  useEffect(() => {
    const confirmed = machineState?.confirmedObjectiveFromMachine ?? null;
    if (confirmed === lastConfirmedObjectiveRef.current) return;
    lastConfirmedObjectiveRef.current = confirmed;
  }, [machineState?.confirmedObjectiveFromMachine]);

  const pushChange = useCallback(
    async (key: MachineControlKey, value: string) => {
      try {
        const nextState = await setControl(key, value);
        return nextState;
      } catch (err) {
        console.error(`[machine-ui] setControl failed field=${key}:`, (err as Error)?.message ?? err);
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
        return;
      }
      if (field === 'objective') {
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

  const handleLoadTimeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      if (value.trim() !== '' && isValidNumberField('loadTime', value)) {
        void pushChange('loadTime', value);
      }
    },
    [pushChange]
  );

  // Debounced backend send for the lightness slider. Drag updates fire
  // continuously; we coalesce them into one IPC call after the user pauses,
  // and flush immediately on onChangeCommitted / direct numeric entry.
  const lightnessSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lightnessPendingRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (lightnessSendTimerRef.current !== null) {
        clearTimeout(lightnessSendTimerRef.current);
      }
    };
  }, []);

  const sendLightness = useCallback(
    (value: string) => {
      void pushChange('lightness', value).catch((err) => {
        console.error('[machine-lightness] send failed:', (err as Error)?.message ?? err);
      });
    },
    [pushChange]
  );

  const scheduleLightnessSend = useCallback(
    (value: string, immediate: boolean) => {
      lightnessPendingRef.current = value;
      if (lightnessSendTimerRef.current !== null) {
        clearTimeout(lightnessSendTimerRef.current);
        lightnessSendTimerRef.current = null;
      }
      if (immediate) {
        const v = lightnessPendingRef.current;
        lightnessPendingRef.current = null;
        if (v !== null) sendLightness(v);
        return;
      }
      lightnessSendTimerRef.current = setTimeout(() => {
        lightnessSendTimerRef.current = null;
        const v = lightnessPendingRef.current;
        lightnessPendingRef.current = null;
        if (v !== null) sendLightness(v);
      }, LIGHTNESS_SEND_DEBOUNCE_MS);
    },
    [sendLightness]
  );

  const handleLightnessDrag = useCallback(
    (next: number) => {
      const clamped = clampLightness(next);
      const value = String(clamped);
      lightnessDirtyRef.current = true;
      setLightnessInput(value);
      scheduleLightnessSend(value, false);
    },
    [scheduleLightnessSend]
  );

  const handleLightnessCommit = useCallback(
    (next: number) => {
      const clamped = clampLightness(next);
      const value = String(clamped);
      lightnessDirtyRef.current = true;
      setLightnessInput(value);
      scheduleLightnessSend(value, true);
    },
    [scheduleLightnessSend]
  );

  const handleHardnessChange = useCallback(
    (event: SelectChangeEvent) => {
      const value = event.target.value;
      if (!HARDNESS_LEVEL_OPTIONS.includes(value)) {
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
    if (impressAutoCloseTimerRef.current !== null) {
      clearTimeout(impressAutoCloseTimerRef.current);
      impressAutoCloseTimerRef.current = null;
    }
    setImpressPopup({ open: true, status: 'running', message: 'Impress process is running...' });
    void startIndent().catch((err) => {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[impress] failed: ${reason}`);
      setImpressPopup({
        open: true,
        status: 'error',
        message: `Impress failed: ${reason}`,
      });
      impressAutoCloseTimerRef.current = setTimeout(() => {
        impressAutoCloseTimerRef.current = null;
        setImpressPopup((current) => ({ ...current, open: false }));
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
      setImpressPopup({ open: true, status: 'done', message: 'Impress is done' });
      if (impressAutoCloseTimerRef.current !== null) {
        clearTimeout(impressAutoCloseTimerRef.current);
      }
      impressAutoCloseTimerRef.current = setTimeout(() => {
        impressAutoCloseTimerRef.current = null;
        setImpressPopup((current) => ({ ...current, open: false }));
      }, 1500);
      return;
    }
    if (next === 'error') {
      const reason = machineState?.lastError ?? 'machine reported error';
      console.error(`[impress] error: ${reason}`);
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
      }, 4000);
    }
  }, [impressPopup.open, impressPopup.status, machineState?.indentStatus, machineState?.lastError]);

  const handleTurretClick = useCallback(
    (direction: TurretDirection) => () => {
      // Fire overlay-clear intent BEFORE the IPC so stale yellow lines are
      // gone from the moment the operator presses the button.
      onTurretIntent?.();
      void moveTurret(direction).catch(() => {
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
      <Box sx={CONTROL_CONTAINER_SX}>
        <Box sx={TOP_ROW_SX}>
          <Button
            variant="text"
            sx={topCardSx({ interactive: true, accentColor: 'info', cellIndex: 0 })}
            disabled={!connected || isIndentInFlight || isBusy || impressPopup.open}
            onClick={handleIndentClick}
            aria-label={indentLabel(indentStatus)}
          >
            <IndentCenterIcon sx={TOP_CARD_ICON_SX} />
            <Typography component="span" sx={TOP_CARD_LABEL_SX}>
              {indentLabel(indentStatus)}
            </Typography>
          </Button>
          {/* Turret card: passive status surface showing the current objective.
              The turret-rotation action lives in the 10X / Center / 40X cards
              below. */}
          <Box
            sx={topCardSx({ interactive: false, accentColor: 'primary', cellIndex: 1 })}
            aria-label={`Turret position ${formState.objective}`}
          >
            <RadioButtonCheckedIcon sx={TOP_CARD_ICON_SX} />
            <Typography component="span" sx={TOP_CARD_LABEL_SX}>
              Turret
            </Typography>
          </Box>
        </Box>

        <Box sx={OBJECTIVE_ROW_SX}>
          <Button
            variant="text"
            sx={turretCardSx('10X', formState.objective === '10X', 0)}
            disabled={!connected || isBusy}
            onClick={handleTurretClick('left')}
            aria-label="Turret 10X"
            aria-pressed={formState.objective === '10X'}
          >
            <Box sx={TURRET_ICON_ROW_SX}>
              <Objective10xIcon sx={TURRET_OBJECTIVE_ICON_SX} />
            </Box>
            <Typography component="span" sx={TURRET_CARD_LABEL_SX}>
              10X
            </Typography>
          </Button>
          <Button
            variant="text"
            sx={turretCardSx('CENTER', formState.objective === 'IND', 1)}
            disabled={!connected || isBusy}
            onClick={handleTurretClick('front')}
            aria-label="Turret Center"
            aria-pressed={formState.objective === 'IND'}
          >
            <Box sx={TURRET_ICON_ROW_SX}>
              <GpsFixedIcon sx={TURRET_OBJECTIVE_ICON_SX} />
            </Box>
            <Typography component="span" sx={TURRET_CARD_LABEL_SX}>
              Center
            </Typography>
          </Button>
          <Button
            variant="text"
            sx={turretCardSx('40X', formState.objective === '40X', 2)}
            disabled={!connected || isBusy}
            onClick={handleTurretClick('right')}
            aria-label="Turret 40X"
            aria-pressed={formState.objective === '40X'}
          >
            <Box sx={TURRET_ICON_ROW_SX}>
              <Objective40xIcon sx={TURRET_OBJECTIVE_ICON_SX} />
            </Box>
            <Typography component="span" sx={TURRET_CARD_LABEL_SX}>
              40X
            </Typography>
          </Button>
        </Box>
      </Box>

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
        <LightnessControl
          value={lightnessInput}
          disabled={!connected}
          onDrag={handleLightnessDrag}
          onCommit={handleLightnessCommit}
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
          onChange={handleLoadTimeChange}
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
          <HvReadout label="HV" value={bottomHvDisplay} unit="HV" cellIndex={0} />
          <HvReadout label="Hardness" value={bottomHardnessDisplay} unit={bottomHvTypeDisplay} cellIndex={1} />
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
