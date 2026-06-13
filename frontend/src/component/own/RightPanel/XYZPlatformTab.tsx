import { memo, useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import NorthWestIcon from '@mui/icons-material/NorthWest';
import NorthIcon from '@mui/icons-material/North';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import WestIcon from '@mui/icons-material/West';
import ControlCameraIcon from '@mui/icons-material/ControlCamera';
import EastIcon from '@mui/icons-material/East';
import SouthWestIcon from '@mui/icons-material/SouthWest';
import SouthIcon from '@mui/icons-material/South';
import SouthEastIcon from '@mui/icons-material/SouthEast';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import SettingsIcon from '@mui/icons-material/Settings';
import HomeIcon from '@mui/icons-material/Home';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import HeightIcon from '@mui/icons-material/Height';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import type { SxProps, Theme } from '@mui/material/styles';
import { useDialog } from '@/contexts/DialogContext';
import { useXyzPlatformHardware } from '@/features/xyzPlatform/useXyzPlatformHardware';
import { useXyzPlatformStateSync } from '@/features/xyzPlatform/useXyzPlatformStateSync';
import { useXyzStageState } from '@/hooks/queries/useXyzStageState';
import { useSerialPortSetting } from '@/hooks/queries/useSerialPortSetting';
import type { FocusMode, XySpeed, ZSpeed } from '@/types/xyzPlatformState';
import type { XyzDirection, ZDirection } from '@/types/xyzPlatform';

// Premium industrial control surface for the XYZ Platform, scaled to the
// right-panel tab width (~430px): a status bar, an action toolbar, and a 60/40
// pair of control cards (X/Y D-pad + position panel, Z controls). Only the
// visual layer changed here — every control, handler, IPC path and state read in
// the component body below is unchanged. Colour/typography are localised to this
// screen (one-off design spec) rather than the global theme.
const PALETTE = {
  primary: '#0F4C81',
  primaryHover: '#1565A9',
  success: '#16A34A',
  successHover: '#15803D',
  danger: '#DC2626',
  dangerHover: '#B91C1C',
  bg: '#F4F7FB',
  card: '#FFFFFF',
  sunken: '#F1F5FB',
  border: '#DCE3EE',
  text: '#1F2937',
  muted: '#64748B',
  hoverTint: '#EAF2FB',
  pressTint: '#DCE9F7',
  disabledBg: '#F3F5F9',
  disabledFg: '#A9B4C4',
} as const;

const SHADOW_SOFT = '0 1px 3px rgba(15,23,42,0.06)';
const SHADOW_CARD = '0 2px 10px rgba(15,23,42,0.06)';
const SHADOW_BTN = '0 2px 8px rgba(0,0,0,0.08)';
const SHADOW_PRESS = 'inset 0 2px 5px rgba(15,23,42,0.18)';

const ROOT_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 0.75,
  p: 0.75,
  bgcolor: PALETTE.bg,
  overflowY: 'auto',
  overflowX: 'hidden',
};

// ---- Top status bar -------------------------------------------------------
const STATUS_BAR_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1.5,
  px: 1.5,
  minHeight: 60,
  bgcolor: PALETTE.card,
  border: `1px solid ${PALETTE.border}`,
  borderRadius: '12px',
  boxShadow: SHADOW_SOFT,
};
const STATUS_COL_SX: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 };
const STATUS_LINE_SX: SxProps<Theme> = { display: 'flex', gap: 0.75, alignItems: 'baseline', minWidth: 0 };
const STATUS_LABEL_SX: SxProps<Theme> = { fontSize: 11.5, fontWeight: 700, color: PALETTE.text, lineHeight: 1.5 };
const STATUS_VALUE_SX: SxProps<Theme> = {
  fontSize: 11.5,
  fontWeight: 500,
  color: PALETTE.muted,
  fontFamily: 'Consolas, "Cascadia Mono", monospace',
};
const CONNECT_BTN_SX: SxProps<Theme> = {
  height: 34,
  minWidth: 0,
  px: 1.5,
  borderRadius: '10px',
  textTransform: 'none',
  fontSize: 12,
  fontWeight: 600,
  boxShadow: SHADOW_BTN,
  bgcolor: PALETTE.primary,
  color: '#FFFFFF',
  '& .MuiButton-startIcon': { mr: 0.5 },
  '&:hover': { bgcolor: PALETTE.primaryHover, boxShadow: '0 4px 12px rgba(15,76,129,0.28)' },
  '&:active': { boxShadow: SHADOW_PRESS },
  '&.Mui-disabled': { bgcolor: '#C7D2E0', color: '#FFFFFF', boxShadow: 'none' },
};
const DISCONNECT_BTN_SX: SxProps<Theme> = {
  height: 34,
  minWidth: 0,
  px: 1.5,
  borderRadius: '10px',
  textTransform: 'none',
  fontSize: 12,
  fontWeight: 600,
  border: `1px solid ${PALETTE.border}`,
  color: PALETTE.text,
  bgcolor: PALETTE.card,
  '& .MuiButton-startIcon': { mr: 0.5 },
  '&:hover': { borderColor: PALETTE.danger, color: PALETTE.danger, bgcolor: '#FEF2F2' },
  '&:active': { boxShadow: SHADOW_PRESS },
  '&.Mui-disabled': { color: PALETTE.disabledFg, borderColor: PALETTE.border },
};
const INDICATOR_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 0.5 };
const INDICATOR_LABEL_SX: SxProps<Theme> = { fontSize: 11, fontWeight: 600, color: PALETTE.text };

// ---- Action toolbar -------------------------------------------------------
const TOOLBAR_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 1,
  px: 1.25,
  py: 0.5,
  bgcolor: PALETTE.card,
  border: `1px solid ${PALETTE.border}`,
  borderRadius: '12px',
  boxShadow: SHADOW_SOFT,
};
const TOOLBAR_BTN_SX: SxProps<Theme> = {
  height: 40,
  minWidth: 0,
  px: 1.5,
  borderRadius: '10px',
  textTransform: 'none',
  fontSize: 12,
  fontWeight: 600,
  border: `1px solid ${PALETTE.border}`,
  color: PALETTE.text,
  bgcolor: PALETTE.card,
  boxShadow: SHADOW_BTN,
  '& .MuiButton-startIcon': { mr: 0.5 },
  '&:hover': { borderColor: PALETTE.primary, color: PALETTE.primary, bgcolor: PALETTE.hoverTint, boxShadow: '0 3px 8px rgba(15,23,42,0.12)' },
  '&:active': { boxShadow: SHADOW_PRESS },
  '&.Mui-disabled': { color: PALETTE.disabledFg, borderColor: PALETTE.border, bgcolor: PALETTE.disabledBg, boxShadow: 'none' },
};
const SETTINGS_ICON_SX: SxProps<Theme> = {
  width: 40,
  height: 40,
  borderRadius: '10px',
  border: `1px solid ${PALETTE.border}`,
  color: PALETTE.muted,
  bgcolor: PALETTE.card,
  '&:hover': { borderColor: PALETTE.primary, color: PALETTE.primary, bgcolor: PALETTE.hoverTint },
};

// ---- Control cards (60 / 40 split) ---------------------------------------
const CARDS_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'stretch', minWidth: 0 };
const CARD_BASE_SX = {
  bgcolor: PALETTE.card,
  border: `1px solid ${PALETTE.border}`,
  borderRadius: '14px',
  boxShadow: SHADOW_CARD,
  p: 1.25,
  display: 'flex',
  flexDirection: 'column',
  gap: 0.75,
  minWidth: 0,
} as const;
const XY_CARD_SX: SxProps<Theme> = { ...CARD_BASE_SX, flex: '3 1 0' };
const Z_CARD_SX: SxProps<Theme> = { ...CARD_BASE_SX, flex: '2 1 0' };
const CARD_TITLE_SX: SxProps<Theme> = { fontSize: 14, fontWeight: 700, color: PALETTE.text, lineHeight: 1.2 };
const SECTION_LABEL_SX: SxProps<Theme> = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  color: PALETTE.muted,
};
const RADIO_GROUP_SX: SxProps<Theme> = {
  flexWrap: 'nowrap',
  justifyContent: 'space-between',
  '& .MuiFormControlLabel-root': { mr: 0, ml: 0 },
  '& .MuiFormControlLabel-label': { fontSize: 11.5, fontWeight: 500, color: PALETTE.text },
  '& .MuiRadio-root': { p: 0.25, color: PALETTE.border, '&.Mui-checked': { color: PALETTE.primary } },
};

// ---- D-pad + side actions -------------------------------------------------
const XY_BODY_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'stretch' };
const DPAD_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gridTemplateRows: 'repeat(3, 46px)',
  gap: 0.75,
  flex: '0 0 150px',
};
const SIDE_COL_SX: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: 0.75, flex: 1, minWidth: 0 };
const ARROW_BTN_SX = {
  minWidth: 0,
  width: '100%',
  height: '100%',
  p: 0,
  borderRadius: '10px',
  border: `1px solid ${PALETTE.border}`,
  bgcolor: PALETTE.card,
  color: PALETTE.primary,
  boxShadow: '0 1px 2px rgba(15,23,42,0.05)',
  '& svg': { fontSize: 22 },
  '&:hover': { bgcolor: PALETTE.hoverTint, borderColor: PALETTE.primary, boxShadow: '0 2px 6px rgba(15,23,42,0.14)' },
  '&:active': { bgcolor: PALETTE.pressTint, boxShadow: SHADOW_PRESS },
  '&.Mui-disabled': { bgcolor: PALETTE.disabledBg, color: '#B7C2D2', borderColor: PALETTE.border, boxShadow: 'none' },
} as const;
const CENTER_BTN_SX: SxProps<Theme> = {
  minWidth: 0,
  width: '100%',
  height: '100%',
  p: 0,
  borderRadius: '10px',
  border: `1px solid ${PALETTE.primary}`,
  bgcolor: PALETTE.primary,
  color: '#FFFFFF',
  boxShadow: '0 1px 3px rgba(15,76,129,0.3)',
  '& svg': { fontSize: 22 },
  '&:hover': { bgcolor: PALETTE.primaryHover, borderColor: PALETTE.primaryHover, boxShadow: '0 2px 8px rgba(15,76,129,0.35)' },
  '&:active': { boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.28)' },
  '&.Mui-disabled': { bgcolor: '#C7D2E0', color: '#FFFFFF', borderColor: '#C7D2E0', boxShadow: 'none' },
};
const PANEL_BTN_BASE = {
  minWidth: 0,
  width: '100%',
  borderRadius: '10px',
  textTransform: 'none',
  fontSize: 11.5,
  fontWeight: 600,
  lineHeight: 1.15,
  px: 0.5,
  boxShadow: SHADOW_BTN,
  border: `1px solid ${PALETTE.border}`,
  bgcolor: PALETTE.card,
  color: PALETTE.text,
  '& .MuiButton-startIcon': { mr: 0.5 },
  '&:hover': { bgcolor: PALETTE.hoverTint, borderColor: PALETTE.primary, boxShadow: '0 3px 8px rgba(15,23,42,0.12)' },
  '&:active': { boxShadow: SHADOW_PRESS },
  '&.Mui-disabled': { bgcolor: PALETTE.disabledBg, color: PALETTE.disabledFg, borderColor: PALETTE.border, boxShadow: 'none' },
} as const;
const BTN_ACTIVE_SUCCESS = {
  bgcolor: PALETTE.success,
  color: '#FFFFFF',
  borderColor: PALETTE.success,
  '&:hover': { bgcolor: PALETTE.successHover, borderColor: PALETTE.successHover, boxShadow: '0 3px 10px rgba(22,163,74,0.3)' },
} as const;
const BTN_ACTIVE_DANGER = {
  bgcolor: PALETTE.danger,
  color: '#FFFFFF',
  borderColor: PALETTE.danger,
  '&:hover': { bgcolor: PALETTE.dangerHover, borderColor: PALETTE.dangerHover, boxShadow: '0 3px 10px rgba(220,38,38,0.3)' },
} as const;
const BTN_ACTIVE_PRIMARY = {
  bgcolor: PALETTE.primary,
  color: '#FFFFFF',
  borderColor: PALETTE.primary,
  '&:hover': { bgcolor: PALETTE.primaryHover, borderColor: PALETTE.primaryHover, boxShadow: '0 3px 10px rgba(15,76,129,0.3)' },
} as const;
const SIDE_BTN_SX = { ...PANEL_BTN_BASE, flex: 1, minHeight: 0, fontSize: 11 } as const;

// ---- Position panel -------------------------------------------------------
const POSITION_SX: SxProps<Theme> = {
  mt: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  px: 1.25,
  py: 1,
  bgcolor: PALETTE.sunken,
  border: `1px solid ${PALETTE.border}`,
  borderRadius: '10px',
};
const COORD_CHIP_SX: SxProps<Theme> = { display: 'flex', alignItems: 'baseline', gap: 0.5 };
const COORD_AXIS_SX: SxProps<Theme> = { fontSize: 12, fontWeight: 700, color: PALETTE.primary };
const COORD_VALUE_SX: SxProps<Theme> = {
  fontFamily: 'Consolas, "Cascadia Mono", monospace',
  fontSize: 16,
  fontWeight: 600,
  color: PALETTE.text,
  fontVariantNumeric: 'tabular-nums',
};
const COORD_UNIT_SX: SxProps<Theme> = { fontSize: 10, fontWeight: 500, color: PALETTE.muted };

// ---- Z card body ----------------------------------------------------------
const Z_GRID_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 };
const Z_BTN_SX = { ...PANEL_BTN_BASE, height: 46 } as const;
const Z_ARROW_BTN_SX = { ...ARROW_BTN_SX, height: 46 } as const;

const ALERT_SX: SxProps<Theme> = { py: 0.25, fontSize: 11.5, borderRadius: '10px', alignItems: 'center' };

function formatCoordinate(value: number): string {
  return value.toFixed(3);
}

// Map a raw service error CODE to an operator-facing sentence. The backend now
// sets friendly text on most failures, but command paths that return a bare code
// (e.g. a move while unlocked) are normalised here too. Anything already written
// as a sentence (or a backend friendly message) passes through unchanged.
function friendlyXyzError(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  switch (raw) {
    case 'XYZ_STAGE_PREEMPTED':
      // Expected jog control flow (a #0B stop interrupting an in-flight command) —
      // never an operator-facing error. Traced internally via [xyz-preempt].
      return undefined;
    case 'XYZ_STAGE_XY_UNLOCKED':
      return 'Lock the X/Y stage before moving.';
    case 'XYZ_STAGE_NOT_CONNECTED':
      return 'XYZ stage is not connected. Connect the stage and try again.';
    case 'XYZ_STAGE_NO_POSITION':
      return 'Cannot read the stage position. Check connection and try again.';
    case 'XYZ_STAGE_INVALID_SPEED':
      return 'That speed is not available.';
    default:
      return raw;
  }
}

function XYZPlatformTabImpl() {
  // The ONLY source of truth for everything rendered here is the backend
  // service snapshot. Every value below comes from `live`; no handler mutates
  // a displayed value before a validated hardware (or software-interlock) RX.
  const live = useXyzStageState();
  const hardware = useXyzPlatformHardware();
  const { persist } = useXyzPlatformStateSync();
  const { data: serialSetting } = useSerialPortSetting();
  // Z Axis Settings dialog is shared app-wide (also reachable from Configuration →
  // Z Axis Setting). Open the single instance via the dialog context — no local
  // open-state mirror, no second mount.
  const { setActiveDialog } = useDialog();

  // Operator-selected stage ports from Serial Port Setting — the single source for
  // which COM each axis connects on. No hardcoded COM number here. Z is a SEPARATE
  // connection on its own configured port.
  const savedXyPort = serialSetting?.xyPortName?.trim() || null;
  const savedZPort = serialSetting?.zPortName?.trim() || null;

  const isBusy = hardware.busy;
  const errorMessage = friendlyXyzError(hardware.error ?? live.lastError ?? undefined);
  // Movement is only allowed once the service reports a live connection (which
  // can only happen after an X/Y port is configured and Connect succeeds).
  const movementDisabled = isBusy || !live.connected;
  const connectionStatus = live.connected ? 'Connected' : live.lastError ? 'Error' : 'Disconnected';

  // Backend snapshot (`live.xyLocked`) is the SOLE source of the lock state shown
  // here — no local UI lock flag. Log every backend-driven change so the
  // enabled/disabled rendering is traceable to a confirmed state, not a click.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(`[xyz-ui-lock-state] locked=${live.xyLocked} source=backend-state`);
  }, [live.xyLocked]);

  // NOTE: speed preferences are NOT auto-replayed on connect — no setXySpeed/
  // setZSpeed is sent automatically when the stage connects. Speed is only set
  // when the operator changes the dropdown (handleXySpeedChange/handleZSpeedChange).

  // Persist a speed preference (only after the controller accepted it). Mirrors
  // the backend-owned snapshot for the other columns; only the speeds are ever
  // read back (on restore above).
  const persistSpeedPref = useCallback(
    (speeds: { xySpeed?: XySpeed; zSpeed?: ZSpeed }) => {
      void persist({
        xySpeed: speeds.xySpeed ?? live.xySpeed,
        zSpeed: speeds.zSpeed ?? live.zSpeed,
        platformX: live.position.x,
        platformY: live.position.y,
        platformZ: live.position.z,
        xyLocked: live.xyLocked,
        zLocked: live.zLocked,
        focusMode: live.focusMode,
        lastAction: live.lastAction,
      });
    },
    [persist, live]
  );

  const handleXySpeedChange = useCallback(
    async (value: XySpeed) => {
      // eslint-disable-next-line no-console
      console.log(`[xyz-ui-action] action=set-xy-speed value=${value}`);
      const result = await hardware.setXySpeed(value);
      if (result.ok) persistSpeedPref({ xySpeed: value });
    },
    [hardware, persistSpeedPref]
  );

  const handleZSpeedChange = useCallback(
    async (value: ZSpeed) => {
      const result = await hardware.setZSpeed(value);
      if (result.ok) persistSpeedPref({ zSpeed: value });
    },
    [hardware, persistSpeedPref]
  );

  // Arrow gesture = TAP vs HOLD. A press shorter than HOLD_THRESHOLD_MS is a quick
  // TAP (one configured step → moveStep). A press held past the threshold becomes a
  // continuous JOG (moveStage), stopped by #0B on release. `pressRef` is UI-ONLY
  // press tracking (a ref, never rendered) — NOT movement state; the authoritative
  // `moving`/position come only from the backend `xyz-platform:state` broadcast.
  const HOLD_THRESHOLD_MS = 250;
  const pressRef = useRef<{
    pointerId: number;
    direction: XyzDirection;
    target: Element;
    startedAt: number;
    holdTimer: ReturnType<typeof setTimeout> | null;
    jogStarted: boolean;
    completed: boolean;
  } | null>(null);

  // STABILITY REFS. `useXyzPlatformHardware()` returns a FRESH object every render,
  // so a handler that closed over `hardware`/`live` directly would be recreated on
  // every state broadcast — which would re-run the safety effect below and fire its
  // cleanup (endPress) the instant the jog's own `moving=true` broadcast arrived,
  // stopping the jog immediately. Reading the latest values through refs lets the
  // handlers stay STABLE (empty deps), so the effect mounts once and the jog holds.
  const hardwareRef = useRef(hardware);
  hardwareRef.current = hardware;
  const xyLockedRef = useRef(live.xyLocked);
  xyLockedRef.current = live.xyLocked;

  // End the active press exactly once (`completed` guard makes duplicate/safety calls
  // a no-op). If the jog actually started → ONE stopStage (#0B). If it never started
  // → a quick TAP (one moveStep), unless this is an ABORT (blur/unmount/direction-
  // change) where intent is unclear, in which case NOTHING is sent.
  const endPress = useCallback((reason: string) => {
    const active = pressRef.current;
    if (!active || active.completed) return;
    active.completed = true;
    pressRef.current = null;
    if (active.holdTimer) clearTimeout(active.holdTimer);
    try {
      if (active.target.hasPointerCapture(active.pointerId)) {
        active.target.releasePointerCapture(active.pointerId);
      }
    } catch {
      // capture may already be gone (element lost the pointer) — ignore
    }
    const durationMs = Date.now() - active.startedAt;
    if (active.jogStarted) {
      // eslint-disable-next-line no-console
      console.log(`[xyz-jog-stop-ui] direction=${active.direction} reason=${reason} durationMs=${durationMs}`);
      void hardwareRef.current.stopStage(); // exactly one #0B!; position updates from RX only
      return;
    }
    // Jog never started → this was a quick tap (or an abort). Never send stopStage.
    if (reason === 'blur' || reason === 'unmount' || reason === 'direction-change') {
      // eslint-disable-next-line no-console
      console.log(`[xyz-stop-suppressed] reason=${reason}`);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[xyz-tap] direction=${active.direction} durationMs=${durationMs}`);
    // eslint-disable-next-line no-console
    console.log(`[xyz-stop-suppressed] reason=quick-tap-no-jog`);
    void hardwareRef.current.moveStep(active.direction); // one configured step; position from RX only
  }, []);

  const startPress = useCallback(
    (direction: XyzDirection, event: ReactPointerEvent<HTMLButtonElement>) => {
      // Defense-in-depth: arrows are already disabled while unlocked, but never
      // dispatch a move unless the servo is engaged — movement requires xyLocked.
      if (!xyLockedRef.current) {
        // eslint-disable-next-line no-console
        console.warn(`[xyz-jog-blocked] reason=xy-unlocked direction=${direction}`);
        return;
      }
      // Any press already active (different pointer/direction) → end it first so two
      // gestures are never in flight at once.
      if (pressRef.current) endPress('direction-change');
      // Capture the pointer so a release OUTSIDE the small arrow button still
      // delivers pointerup/pointercancel here — no missed stop, no mid-hold stop.
      const target = event.currentTarget;
      const pointerId = event.pointerId;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // capture unsupported/failed — the global safety listeners still end it
      }
      // eslint-disable-next-line no-console
      console.log(`[xyz-pointer-down] direction=${direction} pointerId=${pointerId}`);
      // DO NOT move yet. Only after the hold threshold elapses with the pointer still
      // down does this become a jog (moveStage). A release before then is a tap.
      const holdTimer = setTimeout(() => {
        const current = pressRef.current;
        if (!current || current.completed || current.pointerId !== pointerId) return;
        // eslint-disable-next-line no-console
        console.log(`[xyz-hold-threshold] direction=${current.direction}`);
        current.jogStarted = true;
        current.holdTimer = null;
        // eslint-disable-next-line no-console
        console.log(`[xyz-jog-start-ui] direction=${current.direction}`);
        void hardwareRef.current.moveStage(current.direction); // continuous jog (large move + #0B on release)
      }, HOLD_THRESHOLD_MS);
      pressRef.current = {
        pointerId,
        direction,
        target,
        startedAt: Date.now(),
        holdTimer,
        jogStarted: false,
        completed: false,
      };
    },
    [endPress]
  );

  // Safety ends for a missed release: a global pointerup/pointercancel, window blur,
  // and unmount. `endPress` is STABLE (empty deps via refs), so this effect mounts
  // ONCE and its cleanup runs only on real unmount — never on a re-render, which is
  // what previously stopped the jog the moment it started.
  useEffect(() => {
    const onSafetyEnd = () => endPress('safety');
    const onBlurEnd = () => endPress('blur');
    window.addEventListener('pointerup', onSafetyEnd);
    window.addEventListener('pointercancel', onSafetyEnd);
    window.addEventListener('blur', onBlurEnd);
    return () => {
      window.removeEventListener('pointerup', onSafetyEnd);
      window.removeEventListener('pointercancel', onSafetyEnd);
      window.removeEventListener('blur', onBlurEnd);
      endPress('unmount');
    };
  }, [endPress]);

  // Per-arrow pointer handlers. pointerdown starts the press; pointerup/cancel end it
  // (tap or stop). pointerleave ends ONLY a jog that already started (and only when
  // capture is inactive) — a leave during a pending press is ignored so normal
  // movement inside the button is never mistaken for a stop.
  const jogHandlers = useCallback(
    (direction: XyzDirection) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => startPress(direction, event),
      onPointerUp: () => {
        const active = pressRef.current;
        if (active) {
          // eslint-disable-next-line no-console
          console.log(`[xyz-pointer-up] direction=${active.direction} jogStarted=${active.jogStarted}`);
        }
        endPress('release');
      },
      onPointerCancel: () => endPress('cancel'),
      onPointerLeave: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const active = pressRef.current;
        if (active && active.jogStarted) endPress('leave');
      },
    }),
    [startPress, endPress]
  );

  // Z arrow gesture mirrors X/Y: a quick TAP (<HOLD_THRESHOLD_MS) sends one
  // configured step (moveZ → #±Z nnnn#); a HOLD becomes a continuous jog
  // (startZJog → #±S#) stopped by stopZJog on release. Refs keep the handlers
  // STABLE (see the X/Y note above) so the safety effect mounts once. Z movement
  // requires the drive LOCKED (#LK# enables motion) — gated in startZPress.
  const zLockedRef = useRef(live.zLocked);
  zLockedRef.current = live.zLocked;
  const zSpeedRef = useRef(live.zSpeed);
  zSpeedRef.current = live.zSpeed;
  const zPressRef = useRef<{
    pointerId: number;
    direction: ZDirection;
    target: Element;
    startedAt: number;
    holdTimer: ReturnType<typeof setTimeout> | null;
    jogStarted: boolean;
    completed: boolean;
  } | null>(null);

  const endZPress = useCallback((reason: string) => {
    const active = zPressRef.current;
    if (!active || active.completed) return;
    active.completed = true;
    zPressRef.current = null;
    if (active.holdTimer) clearTimeout(active.holdTimer);
    try {
      if (active.target.hasPointerCapture(active.pointerId)) {
        active.target.releasePointerCapture(active.pointerId);
      }
    } catch {
      // capture may already be gone — ignore
    }
    const durationMs = Date.now() - active.startedAt;
    if (active.jogStarted) {
      // eslint-disable-next-line no-console
      console.log(`[xyz-z-jog-stop-ui] direction=${active.direction} reason=${reason} durationMs=${durationMs}`);
      void hardwareRef.current.stopZJog();
      return;
    }
    if (reason === 'blur' || reason === 'unmount' || reason === 'direction-change') {
      // eslint-disable-next-line no-console
      console.log(`[xyz-z-stop-suppressed] reason=${reason}`);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[xyz-z-tap] direction=${active.direction} durationMs=${durationMs}`);
    void hardwareRef.current.moveZ(active.direction, zSpeedRef.current);
  }, []);

  const startZPress = useCallback(
    (direction: ZDirection, event: ReactPointerEvent<HTMLButtonElement>) => {
      // #LK# enables Z motion — never dispatch unless the drive is locked.
      if (!zLockedRef.current) {
        // eslint-disable-next-line no-console
        console.warn(`[xyz-z-jog-blocked] reason=z-unlocked direction=${direction}`);
        return;
      }
      if (zPressRef.current) endZPress('direction-change');
      const target = event.currentTarget;
      const pointerId = event.pointerId;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // capture unsupported/failed — global safety listeners still end it
      }
      // eslint-disable-next-line no-console
      console.log(`[xyz-z-pointer-down] direction=${direction} pointerId=${pointerId}`);
      const holdTimer = setTimeout(() => {
        const current = zPressRef.current;
        if (!current || current.completed || current.pointerId !== pointerId) return;
        current.jogStarted = true;
        current.holdTimer = null;
        // eslint-disable-next-line no-console
        console.log(`[xyz-z-jog-start-ui] direction=${current.direction}`);
        void hardwareRef.current.startZJog(current.direction);
      }, HOLD_THRESHOLD_MS);
      zPressRef.current = {
        pointerId,
        direction,
        target,
        startedAt: Date.now(),
        holdTimer,
        jogStarted: false,
        completed: false,
      };
    },
    [endZPress]
  );

  // Safety ends for a missed Z release — mirrors the X/Y safety effect.
  useEffect(() => {
    const onSafetyEnd = () => endZPress('safety');
    const onBlurEnd = () => endZPress('blur');
    window.addEventListener('pointerup', onSafetyEnd);
    window.addEventListener('pointercancel', onSafetyEnd);
    window.addEventListener('blur', onBlurEnd);
    return () => {
      window.removeEventListener('pointerup', onSafetyEnd);
      window.removeEventListener('pointercancel', onSafetyEnd);
      window.removeEventListener('blur', onBlurEnd);
      endZPress('unmount');
    };
  }, [endZPress]);

  const zJogHandlers = useCallback(
    (direction: ZDirection) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => startZPress(direction, event),
      onPointerUp: () => endZPress('release'),
      onPointerCancel: () => endZPress('cancel'),
      onPointerLeave: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const active = zPressRef.current;
        if (active && active.jogStarted) endZPress('leave');
      },
    }),
    [startZPress, endZPress]
  );

  const handleXyLock = useCallback(
    (locked: boolean) => {
      // eslint-disable-next-line no-console
      console.log(`[xyz-ui-action] action=${locked ? 'lock-xy' : 'unlock-xy'}`);
      void (locked ? hardware.lockXy() : hardware.unlockXy());
    },
    [hardware]
  );

  const handleZLock = useCallback(
    (locked: boolean) => {
      void (locked ? hardware.lockZ() : hardware.unlockZ());
    },
    [hardware]
  );

  const handleFocusMode = useCallback(
    (mode: FocusMode) => {
      void hardware.setFocusMode(mode);
      // Cfocus = coarse jog speed (Fast), Ffocus = fine jog speed (Slow). The
      // press-hold ↑/↓ jog runs at the active zSpeed, so selecting the focus mode
      // also selects how fast a held jog travels — and the Speed radio reflects it.
      // The #VZnnnn# speed write needs the Z port, so it's best-effort: focus mode
      // itself is pure software and always applies.
      if (live.zConnected) {
        void handleZSpeedChange(mode === 'cFocus' ? 'fast' : 'slow');
      }
    },
    [hardware, live.zConnected, handleZSpeedChange]
  );

  // Both buttons move to the FIXED physical center (settings physicalCenter pulses,
  // default 40000,40000). ⊕ Center goes there from the current position; Relocation
  // ALWAYS homes (#12!) first, then moves to the physical center (the original
  // Home → Center workflow, enforced in the backend). Not the operator optical center.
  const handleCenter = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[xyz-ui-action] action=move-center');
    void hardware.moveToCenter();
  }, [hardware]);

  const handleRelocation = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[xyz-ui-action] action=relocation');
    void hardware.locateCenter();
  }, [hardware]);

  // Teach the optical center from the current position (operator jogs the stage
  // to the camera center first, then clicks Set Center).
  const handleSetCenter = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log(`[xyz-set-center-click] uiX=${live.positionKnown ? live.position.x : 'unknown'} uiY=${live.positionKnown ? live.position.y : 'unknown'} uiCenterX=${live.centerX ?? 'unset'} uiCenterY=${live.centerY ?? 'unset'}`);
    void hardware.setCenter();
  }, [hardware, live.positionKnown, live.position.x, live.position.y, live.centerX, live.centerY]);

  // Dedicated hardware home (#12!) — homes to the controller's zero and stops
  // there (Relocation also homes, but then continues on to the physical center).
  const handleHome = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[xyz-ui-action] action=home');
    void hardware.home();
  }, [hardware]);

  // Connect/disconnect fire the IPC bridge for BOTH axes (each on its own
  // configured port); the connected/error state shown below comes from the service
  // via the live subscription. Each connect is independent — one may succeed while
  // the other has no port configured.
  const handleConnect = useCallback(() => {
    if (savedXyPort) void hardware.connect(savedXyPort);
    if (savedZPort) void hardware.connectZ(savedZPort);
  }, [hardware, savedXyPort, savedZPort]);

  const handleDisconnect = useCallback(() => {
    void hardware.disconnect();
    void hardware.disconnectZ();
  }, [hardware]);

  // Displayed coordinates are MILLIMETRES — the backend-converted positionMm (pulses
  // / pulsePerMm) from the real #11 RX frame. Never the raw pulses, never computed here.
  const pos = live.positionMm;
  // X/Y movement requires the stage to be LOCKED (servo engaged): locked ⇒ arrows
  // enabled + movement allowed; unlocked ⇒ arrows greyed + movement blocked.
  const xyMoveDisabled = movementDisabled || !live.xyLocked;
  // Z is a SEPARATE connection: gate on zConnected (NOT the X/Y `connected`). Per
  // the Z controller, #LK# (Lock) ENABLES motion — so arrows are live only when the
  // Z drive is connected AND locked.
  const zMoveDisabled = isBusy || !live.zConnected || !live.zLocked;
  const zLockDisabled = isBusy || !live.zConnected;

  // Connect/Disconnect drive BOTH axes (each on its own port). Connect is enabled
  // while at least one configured port is still unconnected; Disconnect while at
  // least one axis is connected.
  const xyConnectDone = !savedXyPort || live.connected;
  const zConnectDone = !savedZPort || live.zConnected;
  const connectDisabled = isBusy || (!savedXyPort && !savedZPort) || (xyConnectDone && zConnectDone);
  const disconnectDisabled = isBusy || (!live.connected && !live.zConnected);
  const zConnectionStatus = live.zConnected ? `Connected (${live.zPort ?? savedZPort})` : savedZPort ? 'Disconnected' : 'not configured';

  return (
    <Box sx={ROOT_SX}>
      {/* ---------------- TOP STATUS BAR ---------------- */}
      <Box sx={STATUS_BAR_SX}>
        {/* Left: configured ports for each axis */}
        <Box sx={STATUS_COL_SX}>
          <Box sx={STATUS_LINE_SX}>
            <Typography sx={STATUS_LABEL_SX}>X/Y</Typography>
            <Typography sx={STATUS_VALUE_SX} noWrap>
              {savedXyPort ?? 'Not configured'}
            </Typography>
          </Box>
          <Box sx={STATUS_LINE_SX}>
            <Typography sx={STATUS_LABEL_SX}>Z</Typography>
            <Typography sx={STATUS_VALUE_SX} noWrap>
              {savedZPort ?? 'Not configured'}
            </Typography>
          </Box>
        </Box>

        {/* Center: connect / disconnect (drive BOTH axes, each on its own port) */}
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          <Button
            sx={CONNECT_BTN_SX}
            disabled={connectDisabled}
            onClick={handleConnect}
            startIcon={<PowerSettingsNewIcon sx={{ fontSize: 16 }} />}
          >
            Connect
          </Button>
          <Button
            sx={DISCONNECT_BTN_SX}
            disabled={disconnectDisabled}
            onClick={handleDisconnect}
            startIcon={<LinkOffIcon sx={{ fontSize: 16 }} />}
          >
            Disconnect
          </Button>
        </Box>

        {/* Right: live connection indicators (green = connected, red = not) */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-end', minWidth: 0 }}>
          <Box sx={INDICATOR_ROW_SX}>
            <FiberManualRecordIcon sx={{ fontSize: 11, color: live.connected ? PALETTE.success : PALETTE.danger }} />
            <Typography sx={INDICATOR_LABEL_SX}>X/Y</Typography>
            <Typography
              sx={{ fontSize: 10.5, fontWeight: 600, color: live.connected ? PALETTE.success : PALETTE.danger, maxWidth: 130 }}
              noWrap
            >
              {connectionStatus}
            </Typography>
          </Box>
          <Box sx={INDICATOR_ROW_SX}>
            <FiberManualRecordIcon sx={{ fontSize: 11, color: live.zConnected ? PALETTE.success : PALETTE.danger }} />
            <Typography sx={INDICATOR_LABEL_SX}>Z</Typography>
            <Typography
              sx={{ fontSize: 10.5, fontWeight: 600, color: live.zConnected ? PALETTE.success : PALETTE.danger, maxWidth: 130 }}
              noWrap
            >
              {zConnectionStatus}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* ---------------- ACTION TOOLBAR ---------------- */}
      <Box sx={TOOLBAR_SX}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            sx={TOOLBAR_BTN_SX}
            disabled={movementDisabled}
            onClick={handleSetCenter}
            startIcon={<MyLocationIcon sx={{ fontSize: 18 }} />}
          >
            Set Center
          </Button>
          <Button
            sx={TOOLBAR_BTN_SX}
            disabled={movementDisabled}
            onClick={handleHome}
            startIcon={<HomeIcon sx={{ fontSize: 18 }} />}
          >
            Home
          </Button>
          <Button
            sx={TOOLBAR_BTN_SX}
            onClick={() => setActiveDialog('zAxis')}
            startIcon={<HeightIcon sx={{ fontSize: 18 }} />}
          >
            Z Settings
          </Button>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <IconButton sx={SETTINGS_ICON_SX} onClick={() => setActiveDialog('xyPlatform')} aria-label="XY platform settings">
            <SettingsIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>
      </Box>

      {/* ---------------- CONTROL CARDS (60 / 40) ---------------- */}
      <Box sx={CARDS_ROW_SX}>
        {/* X/Y CONTROL CARD */}
        <Box sx={XY_CARD_SX}>
          <Typography sx={CARD_TITLE_SX}>X/Y Control</Typography>

          <Box>
            <Typography sx={SECTION_LABEL_SX}>Speed</Typography>
            <RadioGroup
              row
              value={live.xySpeed}
              onChange={(event) => handleXySpeedChange(event.target.value as XySpeed)}
              sx={RADIO_GROUP_SX}
            >
              <FormControlLabel value="slow" control={<Radio size="small" />} label="Slow" />
              <FormControlLabel value="mid" control={<Radio size="small" />} label="Mid" />
              <FormControlLabel value="fast" control={<Radio size="small" />} label="Fast" />
              <FormControlLabel value="ultra" control={<Radio size="small" />} label="Ultra" />
            </RadioGroup>
          </Box>

          <Box sx={XY_BODY_SX}>
            {/* Direction pad: ↖ ↑ ↗ / ← ◎ → / ↙ ↓ ↘ */}
            <Box sx={DPAD_SX}>
              <Button sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('forward-left')}>
                <NorthWestIcon />
              </Button>
              <Button sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('forward')}>
                <NorthIcon />
              </Button>
              <Button sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('forward-right')}>
                <NorthEastIcon />
              </Button>

              <Button sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('left')}>
                <WestIcon />
              </Button>
              <Button sx={CENTER_BTN_SX} disabled={xyMoveDisabled} onClick={handleCenter}>
                <ControlCameraIcon />
              </Button>
              <Button sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('right')}>
                <EastIcon />
              </Button>

              <Button sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('back-left')}>
                <SouthWestIcon />
              </Button>
              <Button sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('back')}>
                <SouthIcon />
              </Button>
              <Button sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('back-right')}>
                <SouthEastIcon />
              </Button>
            </Box>

            {/* Side actions: Lock / Unlock / Relocation */}
            <Box sx={SIDE_COL_SX}>
              <Button
                sx={live.xyLocked ? { ...SIDE_BTN_SX, ...BTN_ACTIVE_SUCCESS } : SIDE_BTN_SX}
                disabled={isBusy}
                onClick={() => handleXyLock(true)}
                startIcon={<LockIcon sx={{ fontSize: 16 }} />}
              >
                Lock
              </Button>
              <Button
                sx={!live.xyLocked ? { ...SIDE_BTN_SX, ...BTN_ACTIVE_DANGER } : SIDE_BTN_SX}
                disabled={isBusy}
                onClick={() => handleXyLock(false)}
                startIcon={<LockOpenIcon sx={{ fontSize: 16 }} />}
              >
                Unlock
              </Button>
              <Button sx={SIDE_BTN_SX} disabled={xyMoveDisabled} onClick={handleRelocation}>
                Relocation
              </Button>
            </Box>
          </Box>

          {/* Position panel */}
          <Box sx={POSITION_SX}>
            <Typography sx={SECTION_LABEL_SX}>Position</Typography>
            <Box sx={{ display: 'flex', gap: 2, flex: 1, justifyContent: 'flex-end' }}>
              <Box sx={COORD_CHIP_SX}>
                <Typography sx={COORD_AXIS_SX}>X</Typography>
                <Typography sx={COORD_VALUE_SX}>{live.positionKnown ? formatCoordinate(pos.x) : '--'}</Typography>
                <Typography sx={COORD_UNIT_SX}>mm</Typography>
              </Box>
              <Box sx={COORD_CHIP_SX}>
                <Typography sx={COORD_AXIS_SX}>Y</Typography>
                <Typography sx={COORD_VALUE_SX}>{live.positionKnown ? formatCoordinate(pos.y) : '--'}</Typography>
                <Typography sx={COORD_UNIT_SX}>mm</Typography>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Z CONTROL CARD */}
        <Box sx={Z_CARD_SX}>
          <Typography sx={CARD_TITLE_SX}>Z Control</Typography>

          <Box>
            <Typography sx={SECTION_LABEL_SX}>Speed</Typography>
            <RadioGroup
              row
              value={live.zSpeed}
              onChange={(event) => handleZSpeedChange(event.target.value as ZSpeed)}
              sx={RADIO_GROUP_SX}
            >
              <FormControlLabel value="fast" control={<Radio size="small" />} label="Fast" />
              <FormControlLabel value="slow" control={<Radio size="small" />} label="Slow" />
            </RadioGroup>
          </Box>

          <Box sx={Z_GRID_SX}>
            {/* Row 1: Lock | Unlock (require the Z connection; #LK# enables motion) */}
            <Button
              sx={live.zLocked ? { ...Z_BTN_SX, ...BTN_ACTIVE_SUCCESS } : Z_BTN_SX}
              disabled={zLockDisabled}
              onClick={() => handleZLock(true)}
              startIcon={<LockIcon sx={{ fontSize: 16 }} />}
            >
              Lock
            </Button>
            <Button
              sx={Z_BTN_SX}
              disabled={zLockDisabled}
              onClick={() => handleZLock(false)}
              startIcon={<LockOpenIcon sx={{ fontSize: 16 }} />}
            >
              Unlock
            </Button>

            {/* Row 2: Cfocus | ↑ */}
            <Button
              sx={live.focusMode === 'cFocus' ? { ...Z_BTN_SX, ...BTN_ACTIVE_PRIMARY } : Z_BTN_SX}
              disabled={isBusy}
              onClick={() => handleFocusMode('cFocus')}
            >
              Cfocus
            </Button>
            <Button sx={Z_ARROW_BTN_SX} disabled={zMoveDisabled} {...zJogHandlers('up')}>
              <ArrowUpwardIcon />
            </Button>

            {/* Row 3: Ffocus | ↓ */}
            <Button
              sx={live.focusMode === 'fFocus' ? { ...Z_BTN_SX, ...BTN_ACTIVE_PRIMARY } : Z_BTN_SX}
              disabled={isBusy}
              onClick={() => handleFocusMode('fFocus')}
            >
              Ffocus
            </Button>
            <Button sx={Z_ARROW_BTN_SX} disabled={zMoveDisabled} {...zJogHandlers('down')}>
              <ArrowDownwardIcon />
            </Button>
          </Box>

          {/* Live status — Motion + Focus mode. No Z position: the Z controller
              reports no absolute position, so showing one would be fabricated. */}
          <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between' }}>
            <Typography sx={SECTION_LABEL_SX}>
              Motion: {live.zMoving ? 'Moving' : 'Idle'}
            </Typography>
            <Typography sx={SECTION_LABEL_SX}>
              Focus: {live.focusMode === 'cFocus' ? 'Coarse' : live.focusMode === 'fFocus' ? 'Fine' : 'None'}
            </Typography>
          </Box>
        </Box>
      </Box>

      {errorMessage ? (
        <Alert severity="error" sx={ALERT_SX}>
          {errorMessage}
        </Alert>
      ) : null}
    </Box>
  );
}

export default memo(XYZPlatformTabImpl);
