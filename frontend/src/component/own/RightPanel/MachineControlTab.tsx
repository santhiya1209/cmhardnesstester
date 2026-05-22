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
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Paper from '@mui/material/Paper';
import Slider from '@mui/material/Slider';
import { alpha, type SxProps, type Theme } from '@mui/material/styles';
import Brightness5Icon from '@mui/icons-material/Brightness5';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import TouchAppIcon from '@mui/icons-material/TouchApp';
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
import type { ToolId, ToolbarActionId } from '@/types/tool';

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
  /**
   * Reuses the main toolbar's dispatcher so the quick-action icons below the
   * HV/HARDNESS boxes behave exactly like clicking the toolbar buttons — no
   * duplicate logic, no separate measurement path.
   */
  onToolbarAction?: (action: ToolbarActionId) => void;
  activeTool?: ToolId;
  /** Disable the measure quick-action icons when no camera frame is ready. */
  cameraReady?: boolean;
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
const TOP_ROW_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 1.25,
  px: 1.5,
  pt: 1.25,
  pb: 0.75,
};
function topCardSx(opts: { interactive: boolean; accentColor: 'info' | 'primary' }): SxProps<Theme> {
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
      borderRadius: 2,
      border: 1,
      borderColor: 'divider',
      bgcolor: 'background.paper',
      color: accent.main,
      textTransform: 'none' as const,
      boxShadow: `0 1px 2px ${alpha(theme.palette.common.black, 0.05)}`,
      transition: theme.transitions.create(
        ['background-color', 'border-color', 'box-shadow', 'transform'],
        { duration: 180 }
      ),
      '&.Mui-disabled': {
        color: 'text.disabled',
        bgcolor: 'background.paper',
        borderColor: 'divider',
        boxShadow: 'none',
      },
    };
    if (!opts.interactive) {
      return { ...base, cursor: 'default' };
    }
    return {
      ...base,
      '&:hover': {
        borderColor: accent.main,
        bgcolor: alpha(accent.main, 0.05),
        boxShadow: `0 4px 14px ${alpha(accent.main, 0.18)}`,
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
  gap: 1.25,
  px: 1.5,
  pb: 1,
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
    return {
      position: 'relative',
      width: '100%',
      minWidth: 0,
      height: 92,
      px: 1,
      pt: 1,
      pb: 1.5,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 2,
      border: 1,
      borderColor: active ? alpha(accent, 0.5) : 'divider',
      bgcolor: 'background.paper',
      color: 'text.primary',
      boxShadow: active
        ? `0 2px 8px ${alpha(accent, 0.25)}`
        : `0 1px 2px ${alpha(theme.palette.common.black, 0.05)}`,
      textTransform: 'none',
      overflow: 'hidden',
      transition: theme.transitions.create(
        ['background-color', 'box-shadow', 'transform', 'border-color'],
        { duration: 180 }
      ),
      // Bottom accent glow strip: yellow for 10X, blue for 40X, neutral for Center.
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
        boxShadow:
          variant === 'CENTER'
            ? active
              ? `0 0 6px ${alpha(accent, 0.55)}`
              : 'none'
            : `0 0 8px ${alpha(accent, 0.55)}`,
        transition: 'background-color 180ms ease, box-shadow 180ms ease, opacity 180ms ease',
      },
      '&:hover': {
        bgcolor: alpha(accent, 0.06),
        borderColor: accent,
        transform: 'translateY(-1px)',
        boxShadow: `0 4px 12px ${alpha(accent, 0.25)}`,
        '&::after': {
          opacity: 1,
          backgroundColor: accent,
          boxShadow: `0 0 8px ${alpha(accent, 0.55)}`,
        },
      },
      '&:active': {
        transform: 'translateY(0)',
      },
      '&.Mui-disabled': {
        bgcolor: 'background.paper',
        color: 'text.disabled',
        borderColor: 'divider',
        boxShadow: 'none',
        '&::after': { backgroundColor: 'transparent', boxShadow: 'none', opacity: 0 },
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
  gap: 1.25,
  alignItems: 'stretch',
};
const HV_COMPACT_CARD_SX: SxProps<Theme> = (theme) => ({
  minWidth: 0,
  overflow: 'hidden',
  display: 'grid',
  gridTemplateRows: `${theme.spacing(3.25)} ${theme.spacing(8)}`,
  borderRadius: 2,
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  boxShadow: `0 1px 2px ${alpha(theme.palette.common.black, 0.05)}`,
});
const HV_COMPACT_TITLE_SX: SxProps<Theme> = (theme) => ({
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  px: 1,
  bgcolor: alpha(theme.palette.info.main, 0.12),
  borderBottom: 1,
  borderColor: alpha(theme.palette.info.main, 0.3),
  color: theme.palette.info.dark,
});
const HV_COMPACT_TITLE_TEXT_SX: SxProps<Theme> = {
  color: 'inherit',
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: 1,
  lineHeight: 1,
  textTransform: 'uppercase',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const HV_COMPACT_VALUE_SX: SxProps<Theme> = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'center',
  gap: 0.75,
  px: 1,
  bgcolor: 'background.paper',
  color: 'info.main',
};
const HV_COMPACT_VALUE_TEXT_SX: SxProps<Theme> = {
  color: 'info.main',
  fontSize: (theme) => theme.typography.pxToRem(30),
  fontWeight: 700,
  lineHeight: 1,
  letterSpacing: 0,
  fontVariantNumeric: 'tabular-nums',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const HV_COMPACT_UNIT_TEXT_SX: SxProps<Theme> = {
  color: 'text.secondary',
  fontSize: (theme) => theme.typography.pxToRem(12),
  fontWeight: 500,
  lineHeight: 1,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};
const ALERT_SX: SxProps<Theme> = { mx: 1.5, mb: 1.5 };
const QUICK_ACTION_ROW_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 1.25,
  mt: 1.25,
};
const quickActionButtonSx = (active: boolean): SxProps<Theme> => (theme) => ({
  width: '100%',
  minHeight: 56,
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 1,
  px: 1.25,
  py: 1,
  borderRadius: 2,
  border: 1,
  borderColor: active ? theme.palette.info.main : 'divider',
  bgcolor: active ? alpha(theme.palette.info.main, 0.08) : 'background.paper',
  color: active ? theme.palette.info.main : theme.palette.info.dark,
  textTransform: 'none',
  lineHeight: 1.1,
  boxShadow: active
    ? `0 0 0 2px ${alpha(theme.palette.info.main, 0.18)}`
    : `0 1px 2px ${alpha(theme.palette.common.black, 0.05)}`,
  transition: 'background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
  '&:hover': {
    bgcolor: alpha(theme.palette.info.main, 0.06),
    borderColor: theme.palette.info.main,
    boxShadow: `0 4px 12px ${alpha(theme.palette.info.main, 0.18)}`,
  },
  '&.Mui-disabled': {
    bgcolor: 'background.paper',
    color: 'text.disabled',
    borderColor: 'divider',
    boxShadow: 'none',
  },
});
const QUICK_ACTION_LABEL_SX: SxProps<Theme> = {
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.2,
  color: 'inherit',
};
const QUICK_ACTION_ICON_SX: SxProps<Theme> = {
  fontSize: 22,
  color: 'inherit',
};

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

type CompactHvCardProps = {
  title: string;
  value: string;
  unit: string;
  // Small accent icon rendered top-right inside the title strip. Optional so
  // future cards can opt out without code branches.
  accent?: 'target' | 'hv';
};

const HV_ACCENT_WRAP_SX: SxProps<Theme> = (theme) => ({
  position: 'absolute',
  top: 4,
  right: 6,
  width: 18,
  height: 18,
  borderRadius: '50%',
  bgcolor: alpha(theme.palette.info.main, 0.18),
  border: `1px solid ${alpha(theme.palette.info.main, 0.5)}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: theme.palette.info.dark,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 0.4,
  lineHeight: 1,
});

function CompactHvCard({ title, value, unit, accent }: CompactHvCardProps) {
  const showUnit = value !== 'N/A' && unit.length > 0;
  const titleText = `${value}${showUnit ? ` ${unit}` : ''}`;
  return (
    <Paper elevation={0} sx={HV_COMPACT_CARD_SX}>
      <Box sx={HV_COMPACT_TITLE_SX}>
        <Typography variant="overline" sx={HV_COMPACT_TITLE_TEXT_SX}>
          {title}
        </Typography>
        {accent === 'target' ? (
          <Box sx={HV_ACCENT_WRAP_SX} aria-hidden>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                border: '1.5px solid currentColor',
                position: 'relative',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  inset: 2,
                  borderRadius: '50%',
                  backgroundColor: 'currentColor',
                },
              }}
            />
          </Box>
        ) : null}
        {accent === 'hv' ? (
          <Box sx={HV_ACCENT_WRAP_SX} aria-hidden>
            HV
          </Box>
        ) : null}
      </Box>
      <Box sx={HV_COMPACT_VALUE_SX} title={titleText}>
        <Typography component="span" sx={HV_COMPACT_VALUE_TEXT_SX}>
          {value}
        </Typography>
        {showUnit ? (
          <Typography component="span" sx={HV_COMPACT_UNIT_TEXT_SX}>
            {unit}
          </Typography>
        ) : null}
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
  onToolbarAction,
  activeTool,
  cameraReady = false,
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
  }, [machineState?.lightness]);

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

  const handleLoadTimeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      if (value.trim() !== '' && isValidNumberField('loadTime', value)) {
        void pushChange('loadTime', value);
      } else if (value.trim() !== '') {
        // eslint-disable-next-line no-console
        console.warn(`[machine-ui] rejected invalid loadTime=${value}`);
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
      // eslint-disable-next-line no-console
      console.log(`[machine-lightness-send] value=${value}`);
      void pushChange('lightness', value)
        .then((state) => {
          // eslint-disable-next-line no-console
          console.log(`[machine-lightness-ack] ok=${state ? 'true' : 'false'}`);
        })
        .catch(() => {
          // eslint-disable-next-line no-console
          console.log(`[machine-lightness-ack] ok=false`);
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
      // eslint-disable-next-line no-console
      console.log(`[machine-lightness-ui] value=${value}`);
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
    // eslint-disable-next-line no-console
    console.log(
      `[impress-command-sent] objective=${objectiveForCommand} force=${formState.force} loadTime=${formState.loadTime}`
    );
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
      <Box sx={TOP_ROW_SX}>
        <Button
          variant="text"
          sx={topCardSx({ interactive: true, accentColor: 'info' })}
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
            Keeps the visual symmetry of the reference UI without taking over the
            turret-rotation action — that still lives in the 10X / Center / 40X
            cards below. */}
        <Box
          sx={topCardSx({ interactive: false, accentColor: 'primary' })}
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
          <CompactHvCard title="HV" value={bottomHvDisplay} unit="HV" accent="target" />
          <CompactHvCard
            title="HARDNESS"
            value={bottomHardnessDisplay}
            unit={bottomHvTypeDisplay}
            accent="hv"
          />
        </Box>
        <Box sx={QUICK_ACTION_ROW_SX}>
          <Button
            disableRipple
            sx={quickActionButtonSx(false)}
            disabled={!cameraReady || !onToolbarAction}
            onClick={() => onToolbarAction?.('tools:autoMeasure')}
            aria-label="Auto Measure"
          >
            <CenterFocusStrongIcon sx={QUICK_ACTION_ICON_SX} />
            <Typography sx={QUICK_ACTION_LABEL_SX}>Auto Measure</Typography>
          </Button>
          <Button
            disableRipple
            sx={quickActionButtonSx(activeTool === 'manualMeasure')}
            disabled={!cameraReady || !onToolbarAction}
            onClick={() => onToolbarAction?.('tools:manualMeasure')}
            aria-label="Manual Measure"
            aria-pressed={activeTool === 'manualMeasure'}
          >
            <TouchAppIcon sx={QUICK_ACTION_ICON_SX} />
            <Typography sx={QUICK_ACTION_LABEL_SX}>Manual Measure</Typography>
          </Button>
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
