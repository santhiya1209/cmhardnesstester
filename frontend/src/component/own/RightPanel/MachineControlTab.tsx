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
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import RemoveCircleOutlinedIcon from '@mui/icons-material/RemoveCircleOutlined';
import {
  IndentCenterIcon,
  Objective10xIcon,
  Objective40xIcon,
} from '@/component/ui/ObjectiveIcons';
import { useMachineSelector, useMachineError } from '@/contexts/MachineStateContext';
import { useSetMachineControl } from '@/hooks/mutations/useSetMachineControl';
import { useStartIndent } from '@/hooks/mutations/useStartIndent';
import { useTurret } from '@/hooks/mutations/useTurret';
import type { IndentStatus, MachineControlKey, MachineState, TurretDirection } from '@/types/machine';
import type { ToolbarActionId, MeasureSelection } from '@/types/tool';
import { useRenderCount } from '@/utils/renderStats';

type ObjectiveCommitSource = 'ack';

type MachineControlTabProps = {
  hvDisplay?: string;
  hvTypeValue?: string | null;
  hardnessValue?: string;
  activeObjective?: string | null;
  /** Called after a real objective commit source is available. */
  onObjectiveChange?: (objective: '10X' | '40X', source: ObjectiveCommitSource) => void;
  /**
   * Fired after the turret-front (Center) command is handled. App-level clears
   * activeObjective so 10X/40X highlights turn off and Auto Measure blocks —
   * Center carries no measurement lens.
   */
  onCenterCommit?: () => void;
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
  /**
   * Same dispatch path the top toolbar uses. The Auto/Manual Measure cards call
   * this with 'tools:autoMeasure' / 'tools:manualMeasure' so they share the
   * exact handler and source of truth — no duplicated measure logic here.
   */
  onToolbarAction?: (action: ToolbarActionId) => void;
  /** Shared Auto/Manual highlight state (also drives the toolbar underline). */
  selectedMeasureMode?: MeasureSelection;
  // Bottom HV/HARDNESS card data — all forwarded read-only from the summary row
  // (MeasurementsWorkspace), reusing its existing displayedMeasurement +
  // convert state. No new source of truth here.
  /** qualified field of the displayed measurement ('YES' | 'NO' | null). */
  hardnessQualified?: string | null;
  /** Timestamp of the displayed measurement. */
  measurementTimestamp?: string | null;
  /** Disables the HARDNESS card's convert dropdown (mirrors the summary row). */
  convertDisabled?: boolean;
  /** Convert-type options for the HARDNESS card dropdown. */
  convertOptions?: readonly string[];
  /** Same convert handler the top row uses — keeps both dropdowns in sync. */
  onConvertTypeChange?: (value: string) => void;
};

const FORCE_OPTIONS =['0.01kgf', '0.025kgf', '0.05kgf', '0.1kgf', '0.2kgf', '0.3kgf', '0.5kgf', '1kgf'];
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
  objective: 'IND',
  hardnessLevel: 'Middle',
};

const ROOT_SX: SxProps<Theme> = {
  flex: 1,
  // minHeight:0 lets this flex child shrink below its content height inside the
  // (overflow-hidden) right panel, so the overflowY scroll below engages
  // instead of the content being clipped at small window heights. overflowX is
  // pinned hidden so a vertical scrollbar never triggers a horizontal one.
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  overflowX: 'hidden',
};
// Machine-Control panel: two rows of three equal rounded cards (Row 1 =
// Impress / Auto Measure / Manual Measure, Row 2 = 10X / Center / 40X), each a
// separate raised card with a soft shadow and gap-based spacing.
const CONTROL_CONTAINER_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1.5,
  px: 1.5,
  pt: 1.5,
  pb: 1.5,
  borderBottom: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
};
const CARD_ROW_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 1.5,
};

type MeasureAccent = 'blue' | 'green';

// Row 1 cards. Impress + Auto Measure use the blue (info) accent, Manual
// Measure uses green (success). `active` shows the blue/green underline +
// tinted background (synced with the toolbar highlight via selectedMeasureMode).
function measureCardSx(opts: { accent: MeasureAccent; active: boolean }): SxProps<Theme> {
  return (theme) => {
    const accent = opts.accent === 'green' ? theme.palette.success.main : theme.palette.info.main;
    return {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0.5,
      minHeight: 88,
      px: 1,
      py: 1.25,
      borderRadius: 2,
      border: 1,
      borderColor: opts.active ? accent : 'divider',
      bgcolor: opts.active ? alpha(accent, 0.08) : 'background.paper',
      color: accent,
      textTransform: 'none',
      boxShadow: '0 1px 2px rgba(15, 42, 71, 0.05)',
      transition: theme.transitions.create(['background-color', 'border-color', 'box-shadow'], {
        duration: 180,
      }),
      '&::after': {
        content: '""',
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 4,
        height: 3,
        borderRadius: 2,
        backgroundColor: opts.active ? accent : 'transparent',
        transition: 'background-color 180ms ease',
      },
      '&:hover': {
        bgcolor: opts.active ? alpha(accent, 0.1) : alpha(accent, 0.05),
        boxShadow: '0 2px 6px rgba(15, 42, 71, 0.08)',
        '&::after': { backgroundColor: accent },
      },
      '&.Mui-disabled': {
        color: 'text.disabled',
        bgcolor: 'background.paper',
        boxShadow: 'none',
        '&::after': { backgroundColor: 'transparent' },
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

function turretCardSx(variant: TurretVariant, active: boolean): SxProps<Theme> {
  return (theme) => {
    const accent =
      variant === '10X'
        ? theme.palette.warning.main
        : variant === '40X'
          ? theme.palette.info.main
          : theme.palette.grey[500];
    const activeBackground =
      variant === '10X' ? alpha(accent, 0.18) : alpha(accent, 0.08);
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
      borderRadius: 2,
      border: 1,
      borderColor: active ? accent : 'divider',
      bgcolor: active ? activeBackground : 'background.paper',
      color: 'text.primary',
      textTransform: 'none',
      boxShadow: '0 1px 2px rgba(15, 42, 71, 0.05)',
      transition: theme.transitions.create(['background-color', 'border-color', 'box-shadow'], {
        duration: 180,
      }),
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
        bgcolor: active ? activeBackground : alpha(accent, 0.06),
        boxShadow: '0 2px 6px rgba(15, 42, 71, 0.08)',
        '&::after': { opacity: 1, backgroundColor: accent },
      },
      '&.Mui-disabled': {
        bgcolor: 'background.paper',
        color: 'text.disabled',
        boxShadow: 'none',
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
// Bottom HV/HARDNESS KPI cards: two equal white cards, thin border, rounded
// corners, a colored top accent strip (blue / green), a large value, and a
// footer (divider line + status/timestamp). No shadow.
const HV_BOTTOM_SECTION_SX: SxProps<Theme> = {
  width: '100%',
  px: 1.5,
  pt: 1,
  pb: 1.25,
};
const HV_CARDS_GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 1.5,
  alignItems: 'stretch',
};
const KPI_CARD_SX: SxProps<Theme> = {
  position: 'relative',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  border: 1,
  borderColor: 'divider',
  borderRadius: 2,
  bgcolor: 'background.paper',
};
const kpiStripSx = (accent: string): SxProps<Theme> => ({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 4,
  bgcolor: accent,
});
const KPI_BODY_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0.5,
  px: 1.5,
  pt: 1.75,
  pb: 1.25,
};
const kpiLabelSx = (accent: string): SxProps<Theme> => ({
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  lineHeight: 1,
  color: accent,
});
const KPI_VALUE_ROW_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 0.75,
  minWidth: 0,
};
const KPI_VALUE_SX: SxProps<Theme> = {
  fontSize: 32,
  fontWeight: 700,
  lineHeight: 1.05,
  color: 'text.primary',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const KPI_UNIT_SX: SxProps<Theme> = {
  fontSize: 14,
  fontWeight: 600,
  color: 'text.secondary',
  whiteSpace: 'nowrap',
};
const KPI_CONVERT_SELECT_SX: SxProps<Theme> = {
  mt: 0.5,
  '& .MuiSelect-select': { py: 0.5, fontSize: 13, fontWeight: 600 },
};
const KPI_FOOTER_SX: SxProps<Theme> = {
  mt: 'auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1,
  px: 1.5,
  py: 0.75,
  borderTop: 1,
  borderColor: 'divider',
};
const KPI_FOOTER_LEFT_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 };
const KPI_FOOTER_LABEL_SX: SxProps<Theme> = { fontSize: 11, fontWeight: 500, color: 'text.secondary', whiteSpace: 'nowrap' };
const KPI_FOOTER_TIME_SX: SxProps<Theme> = { fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' };
const ALERT_SX: SxProps<Theme> = { mx: 1.5, mb: 1.5 };

function formatMeasurementTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}

function normalizeObjectiveOption(value: string | null | undefined): string | null {
  const key = String(value ?? '').trim().toUpperCase();
  return OBJECTIVE_OPTIONS.includes(key) ? key : null;
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
  const propValue = Number.isFinite(parsed) ? clampLightness(parsed) : LIGHTNESS_MIN;
  // [rerender-optimization] During an active drag the slider owns its value
  // locally so each tick re-renders only this small memoized control — not the
  // whole Machine Control panel. Cleared on commit so the parent/machine value
  // wins again. Machine command behavior is unchanged (onDrag/onCommit still
  // fire identically).
  const [dragValue, setDragValue] = useState<number | null>(null);
  const sliderValue = dragValue ?? propValue;
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
          onChange={(_, v) => {
            const next = Array.isArray(v) ? v[0] : v;
            setDragValue(next);
            onDrag(next);
          }}
          onChangeCommitted={(_, v) => {
            const next = Array.isArray(v) ? v[0] : v;
            setDragValue(null);
            onCommit(next);
          }}
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

function MachineControlTabImpl({
  hvDisplay = '',
  hvTypeValue = null,
  hardnessValue = 'N/A',
  hardnessQualified = null,
  measurementTimestamp = null,
  convertDisabled = false,
  convertOptions = [],
  onConvertTypeChange,
  activeObjective = null,
  onObjectiveChange,
  onCenterCommit,
  onTurretIntent,
  onObjectiveChangeIntent,
  onToolbarAction,
  selectedMeasureMode = null,
}: MachineControlTabProps = {}) {
  useRenderCount('MachineControlTab');
  // Narrow selectors — MachineControlTab re-renders only when the fields it
  // actually displays change, not on every accepted machine push.
  const machineConnected = useMachineSelector(s => s?.connected ?? false);
  const machineIndentStatus = useMachineSelector<IndentStatus>(s => s?.indentStatus ?? 'idle');
  const machineLastError = useMachineSelector(s => s?.lastError ?? null);
  const machineSyncStatus = useMachineSelector(s => s?.syncStatus);
  const machineConfirmedObjective = useMachineSelector(s => s?.confirmedObjectiveFromMachine ?? null);
  const machineRawObjective = useMachineSelector(s => s?.objective ?? null);
  const machineForce = useMachineSelector(s => s?.force);
  const machineLightness = useMachineSelector(s => s?.lightness);
  const machineLoadTime = useMachineSelector(s => s?.loadTime);
  const machineHardnessLevel = useMachineSelector(s => s?.hardnessLevel);
  // True when a full machine state snapshot exists (force/lightness/etc. are
  // available). False on first render before the first SSE push arrives.
  const hasMachineState = useMachineSelector(s => s !== null);
  const streamError = useMachineError();
  const { setControl, busy: setBusy, error: setError } = useSetMachineControl();
  const { start: startIndent, busy: indentBusy, error: indentError } = useStartIndent();
  const { move: moveTurret, busy: turretBusy, error: turretError } = useTurret();

  const formState = useMemo(
    () =>
      hasMachineState
        ? {
            force: String(machineForce ?? DEFAULT_FORM_STATE.force),
            lightness: String(machineLightness ?? DEFAULT_FORM_STATE.lightness),
            loadTime: String(machineLoadTime ?? DEFAULT_FORM_STATE.loadTime),
            objective:
              normalizeObjectiveOption(activeObjective) ??
              normalizeObjectiveOption(machineConfirmedObjective) ??
              '',
            hardnessLevel: String(machineHardnessLevel ?? DEFAULT_FORM_STATE.hardnessLevel),
          }
        : {
            ...DEFAULT_FORM_STATE,
            objective: normalizeObjectiveOption(activeObjective) ?? '',
          },
    [
      hasMachineState,
      machineForce,
      machineLightness,
      machineLoadTime,
      machineHardnessLevel,
      machineConfirmedObjective,
      activeObjective,
    ]
  );
  const bottomHvDisplay = hvDisplay.trim() ? hvDisplay : 'N/A';
  const bottomHvTypeDisplay = useMemo(() => {
    const trimmed = hvTypeValue?.trim();
    return trimmed ? trimmed : 'HV';
  }, [hvTypeValue]);
  const bottomHardnessDisplay = hardnessValue.trim() ? hardnessValue : 'N/A';
  // Ensure the current convert type is always a valid Select option.
  const bottomConvertOptions = convertOptions.includes(bottomHvTypeDisplay)
    ? convertOptions
    : [bottomHvTypeDisplay, ...convertOptions];
  const bottomTimestamp = formatMeasurementTimestamp(measurementTimestamp);
  const hardnessStatus =
    hardnessQualified === 'YES'
      ? { Icon: CheckCircleOutlinedIcon, label: 'Qualified: YES', color: 'success.main' as const }
      : hardnessQualified === 'NO'
        ? { Icon: CancelOutlinedIcon, label: 'Qualified: NO', color: 'error.main' as const }
        : { Icon: RemoveCircleOutlinedIcon, label: 'Qualified: —', color: 'text.secondary' as const };
  const HardnessStatusIcon = hardnessStatus.Icon;

  const lastObjectiveSyncLogRef = useRef<string | null>(null);
  useEffect(() => {
    // Single sync log: the app-committed activeObjective (the source of truth,
    // may be null until a real commit) paired with its active highlight color
    // — yellow for 10X, blue for 40X (the other card's background clears).
    const active = normalizeObjectiveOption(activeObjective);
    const activeColor = active === '10X' ? 'yellow' : active === '40X' ? 'blue' : 'none';
    const key = `${active ?? 'null'}|${activeColor}`;
    if (key === lastObjectiveSyncLogRef.current) return;
    lastObjectiveSyncLogRef.current = key;
    // eslint-disable-next-line no-console
    console.log(
      `[machine-ui-objective-sync] activeObjective=${active ?? 'null'} activeColor=${activeColor}`
    );
  }, [activeObjective]);

  // Trace what the Objective dropdown actually displays, logged only when the
  // shown value changes (effect, not render — no rerender impact).
  const lastUiObjectiveLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (formState.objective === lastUiObjectiveLogRef.current) return;
    lastUiObjectiveLogRef.current = formState.objective;
    // eslint-disable-next-line no-console
    console.log(`[machine-control-objective-ui] objective=${formState.objective || 'unselected'}`);
  }, [formState.objective]);

  const commitObjectiveResult = useCallback(
    (requested: '10X' | '40X', state: MachineState | null) => {
      if (!state) return;
      onObjectiveChange?.(requested, 'ack');
    },
    [onObjectiveChange]
  );

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
          // eslint-disable-next-line no-console
          console.log(`[machine-objective-click] requested=${value}`);
          onObjectiveChangeIntent?.(value);
        }
        void pushChange(field, value).then((state) => {
          if (value === '10X' || value === '40X') {
            commitObjectiveResult(value, state);
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
    [commitObjectiveResult, onObjectiveChangeIntent, pushChange]
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
      scheduleLightnessSend(value, false);
    },
    [scheduleLightnessSend]
  );

  const handleLightnessCommit = useCallback(
    (next: number) => {
      const clamped = clampLightness(next);
      const value = String(clamped);
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
  const lastIndentStatusRef = useRef<IndentStatus>(machineIndentStatus);

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
    machineConfirmedObjective,
    machineRawObjective,
    startIndent,
  ]);

  // Watch machine indent status transitions to drive popup state. Real machine
  // status only — no optimistic "done" on click.
  useEffect(() => {
    const prev = lastIndentStatusRef.current;
    const next = machineIndentStatus;
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
      const reason = machineLastError ?? 'machine reported error';
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
  }, [impressPopup.open, impressPopup.status, machineIndentStatus, machineLastError]);

  const handleTurretClick = useCallback(
    (direction: TurretDirection) => () => {
      // The 10X / 40X turret cards rotate to known objective slots
      // (left=10X, right=40X); Center=front carries no objective. App-level
      // objective state is committed only after the returned state contains
      // the machine-confirmed objective from L<n>OK.
      const objectiveForDirection: '10X' | '40X' | null =
        direction === 'left' ? '10X' : direction === 'right' ? '40X' : null;
      // eslint-disable-next-line no-console
      console.log(`[machine-objective-click] requested=${objectiveForDirection ?? 'CENTER'}`);
      // Fire overlay-clear intent BEFORE the IPC so stale yellow lines are
      // gone from the moment the operator presses the button.
      if (objectiveForDirection) {
        onObjectiveChangeIntent?.(objectiveForDirection);
      } else {
        onTurretIntent?.();
      }
      void moveTurret(direction)
        .then((state) => {
          if (objectiveForDirection) {
            commitObjectiveResult(objectiveForDirection, state);
          } else {
            // Center/indenter slot — no measurement lens. Command handled, so
            // clear the active objective at App level.
            onCenterCommit?.();
          }
        })
        .catch(() => {
          // Errors surface via turretError -> errorMessage. The move was not
          // accepted, so do NOT record the objective selection.
        });
    },
    [commitObjectiveResult, moveTurret, onCenterCommit, onObjectiveChangeIntent, onTurretIntent]
  );

  // Auto/Manual Measure cards: dispatch through the exact same toolbar path so
  // there is one handler and one source of truth (no duplicated measure logic).
  const handleAutoMeasureCardClick = useCallback(() => {
    onToolbarAction?.('tools:autoMeasure');
  }, [onToolbarAction]);
  const handleManualMeasureCardClick = useCallback(() => {
    onToolbarAction?.('tools:manualMeasure');
  }, [onToolbarAction]);

  const connected = machineConnected;
  const indentStatus: IndentStatus = machineIndentStatus;
  const isIndentInFlight = indentStatus === 'started' || indentStatus === 'running';
  const isBusy = setBusy || indentBusy || turretBusy;

  // Hook-local errors (indentError/turretError/setError) persist in React state
  // until the next click. Once the backend reports a healthy sync (lastError
  // cleared, syncStatus='synced'), those local strings become stale and must
  // not keep the red banner visible. Backend lastError remains authoritative.
  const recovered =
    !!connected &&
    !machineLastError &&
    (machineSyncStatus === 'synced' || machineSyncStatus === undefined);
  const errorMessage = useMemo(() => {
    if (machineLastError) return machineLastError;
    if (recovered) return null;
    return indentError ?? turretError ?? setError ?? streamError ?? null;
  }, [indentError, machineLastError, recovered, setError, streamError, turretError]);

  return (
    <Box sx={ROOT_SX}>
      <Box sx={CONTROL_CONTAINER_SX}>
        <Box sx={CARD_ROW_SX}>
          <Button
            variant="text"
            sx={measureCardSx({ accent: 'blue', active: false })}
            disabled={!connected || isIndentInFlight || isBusy || impressPopup.open}
            onClick={handleIndentClick}
            aria-label={indentLabel(indentStatus)}
          >
            <IndentCenterIcon sx={TOP_CARD_ICON_SX} />
            <Typography component="span" sx={TOP_CARD_LABEL_SX}>
              {indentLabel(indentStatus)}
            </Typography>
          </Button>
          <Button
            variant="text"
            sx={measureCardSx({ accent: 'blue', active: selectedMeasureMode === 'auto' })}
            onClick={handleAutoMeasureCardClick}
            aria-label="Auto Measure"
            aria-pressed={selectedMeasureMode === 'auto'}
          >
            <CenterFocusStrongIcon sx={TOP_CARD_ICON_SX} />
            <Typography component="span" sx={TOP_CARD_LABEL_SX}>
              Auto Measure
            </Typography>
          </Button>
          <Button
            variant="text"
            sx={measureCardSx({ accent: 'green', active: selectedMeasureMode === 'manual' })}
            onClick={handleManualMeasureCardClick}
            aria-label="Manual Measure"
            aria-pressed={selectedMeasureMode === 'manual'}
          >
            <TouchAppIcon sx={TOP_CARD_ICON_SX} />
            <Typography component="span" sx={TOP_CARD_LABEL_SX}>
              Manual Measure
            </Typography>
          </Button>
        </Box>

        <Box sx={CARD_ROW_SX}>
          <Button
            variant="text"
            sx={turretCardSx('10X', formState.objective === '10X')}
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
            sx={turretCardSx('CENTER', formState.objective === 'IND')}
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
            sx={turretCardSx('40X', formState.objective === '40X')}
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
          value={formState.lightness}
          disabled={!connected}
          onDrag={handleLightnessDrag}
          onCommit={handleLightnessCommit}
        />

        <Typography sx={SETTING_LABEL_SX}>Objective</Typography>
        <FormControl size="small">
          <Select
            value={formState.objective}
            displayEmpty
            renderValue={(value) => (value ? String(value) : '—')}
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
        <Box sx={HV_CARDS_GRID_SX}>
          {/* HV card */}
          <Box sx={KPI_CARD_SX}>
            <Box sx={kpiStripSx('info.main')} />
            <Box sx={KPI_BODY_SX}>
              <Typography sx={kpiLabelSx('info.main')}>HV</Typography>
              <Box sx={KPI_VALUE_ROW_SX} title={bottomHvDisplay}>
                <Typography component="span" sx={KPI_VALUE_SX}>
                  {bottomHvDisplay}
                </Typography>
                <Typography component="span" sx={KPI_UNIT_SX}>
                  HV
                </Typography>
              </Box>
            </Box>
            <Box sx={KPI_FOOTER_SX}>
              <Box sx={KPI_FOOTER_LEFT_SX}>
                <AccessTimeOutlinedIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
                <Typography sx={KPI_FOOTER_LABEL_SX}>Last Measurement</Typography>
              </Box>
              <Typography sx={KPI_FOOTER_TIME_SX}>{bottomTimestamp}</Typography>
            </Box>
          </Box>

          {/* HARDNESS card */}
          <Box sx={KPI_CARD_SX}>
            <Box sx={kpiStripSx('success.main')} />
            <Box sx={KPI_BODY_SX}>
              <Typography sx={kpiLabelSx('success.main')}>HARDNESS</Typography>
              <Box sx={KPI_VALUE_ROW_SX} title={`${bottomHardnessDisplay} ${bottomHvTypeDisplay}`}>
                <Typography component="span" sx={KPI_VALUE_SX}>
                  {bottomHardnessDisplay}
                </Typography>
                <Typography component="span" sx={KPI_UNIT_SX}>
                  {bottomHvTypeDisplay}
                </Typography>
              </Box>
              <FormControl size="small" sx={KPI_CONVERT_SELECT_SX}>
                <Select
                  value={bottomHvTypeDisplay}
                  disabled={convertDisabled}
                  displayEmpty
                  renderValue={(value) => {
                    const v = (value as string | undefined) ?? '';
                    return bottomConvertOptions.includes(v) ? v : 'HV';
                  }}
                  onChange={(event: SelectChangeEvent<string>) => {
                    onConvertTypeChange?.(event.target.value);
                  }}
                >
                  {bottomConvertOptions.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            <Box sx={KPI_FOOTER_SX}>
              <Box sx={KPI_FOOTER_LEFT_SX}>
                <HardnessStatusIcon sx={{ fontSize: 15, color: hardnessStatus.color }} />
                <Typography sx={{ ...(KPI_FOOTER_LABEL_SX as object), color: hardnessStatus.color, fontWeight: 600 }}>
                  {hardnessStatus.label}
                </Typography>
              </Box>
              <Typography sx={KPI_FOOTER_TIME_SX}>{bottomTimestamp}</Typography>
            </Box>
          </Box>
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
