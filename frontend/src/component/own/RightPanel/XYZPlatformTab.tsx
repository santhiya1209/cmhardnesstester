import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
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
import type { SxProps, Theme } from '@mui/material/styles';
import { useDialog } from '@/contexts/DialogContext';
import { useXyzPlatformHardware } from '@/features/xyzPlatform/useXyzPlatformHardware';
import { useXyzPlatformStateSync } from '@/features/xyzPlatform/useXyzPlatformStateSync';
import { useXyzStageState } from '@/hooks/queries/useXyzStageState';
import { useSerialPortSetting } from '@/hooks/queries/useSerialPortSetting';
import type { FocusMode, XySpeed, ZSpeed } from '@/types/xyzPlatformState';
import type { XyzDirection, ZDirection } from '@/types/xyzPlatform';

// Industrial light-grey, thin-bordered, compact layout mirroring the old
// software's XYZ Platform Control panel. No card shadows, rectangular buttons,
// blue arrow glyphs. Two side-by-side group boxes: X/Y (left) and Z (right).
const SECTION_SX: SxProps<Theme> = { px: 1, py: 1, display: 'flex', flexDirection: 'column', gap: 0.75 };
const CONNECT_ROW_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.75,
  flexWrap: 'wrap',
  pb: 0.75,
  borderBottom: 1,
  borderColor: 'divider',
};
const CONNECT_BTN_SX: SxProps<Theme> = {
  height: 24,
  textTransform: 'none',
  fontSize: 11,
  py: 0,
  px: 1,
  minWidth: 0,
};
const STATUS_TEXT_SX: SxProps<Theme> = { fontSize: 11, color: 'text.secondary' };
const GROUPS_ROW_SX: SxProps<Theme> = { display: 'flex', width: '100%', gap: 0.75, alignItems: 'flex-start' };
const GROUP_BOX_SX = {
  border: '1px solid',
  borderColor: 'grey.400',
  borderRadius: 0.5,
  bgcolor: 'grey.50',
  p: 0.75,
  display: 'flex',
  flexDirection: 'column',
  gap: 0.5,
  boxShadow: 'none',
} as const;
// X/Y is the main area (wider); Z sits to its right (narrower). Both grow to
// fill the panel so no empty space is left on the right.
const XY_GROUP_SX: SxProps<Theme> = { ...GROUP_BOX_SX, flex: '2 1 0', minWidth: 0 };
const Z_GROUP_SX: SxProps<Theme> = { ...GROUP_BOX_SX, flex: '1 1 0', minWidth: 0 };
const GROUP_TITLE_SX: SxProps<Theme> = { fontSize: 12, fontWeight: 600, color: 'text.primary', lineHeight: 1 };
const RADIO_GROUP_SX: SxProps<Theme> = {
  flexWrap: 'nowrap',
  '& .MuiFormControlLabel-root': { mr: 0.5, ml: 0 },
  '& .MuiFormControlLabel-label': { fontSize: 11 },
  '& .MuiRadio-root': { p: 0.125 },
};
// X/Y body: 3 square arrow columns + 1 auto-width text column (Lock/Unlock/Relocatio).
const XY_GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: '38px 38px 38px auto',
  gap: 0.5,
};
// Z body: 2 equal columns.
const Z_GRID_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 };
const ARROW_BTN_SX: SxProps<Theme> = {
  minWidth: 0,
  width: '100%',
  height: 34,
  p: 0,
  borderColor: 'grey.500',
  color: 'primary.main',
  '& svg': { fontSize: 20 },
};
const TEXT_BTN_SX: SxProps<Theme> = {
  minWidth: 0,
  width: '100%',
  height: 34,
  px: 0.5,
  py: 0,
  fontSize: 10.5,
  lineHeight: 1.1,
  textTransform: 'none',
  borderColor: 'grey.500',
  color: 'text.primary',
};
const HOME_FIRST_SX: SxProps<Theme> = {
  m: 0,
  '& .MuiFormControlLabel-label': { fontSize: 11, color: 'text.secondary' },
  '& .MuiCheckbox-root': { p: 0.25 },
};
const COORD_ROW_SX: SxProps<Theme> = {
  display: 'flex',
  gap: 1.5,
  pt: 0.5,
  borderTop: 1,
  borderColor: 'grey.300',
};
const COORD_SX: SxProps<Theme> = { fontSize: 11, color: 'text.primary', fontFamily: 'Consolas, monospace' };
const ALERT_SX: SxProps<Theme> = { mt: 0.5, py: 0, fontSize: 11 };

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
    },
    [hardware]
  );

  // Optional: home (#12!) first, then move to center. Default OFF (a UI control
  // input, not movement state). Passed to the backend per relocate call.
  const [homeBeforeRelocation, setHomeBeforeRelocation] = useState(false);

  // Both the ⊕ Center button and the Relocation button move to the taught
  // optical center (NOT hardware home, unless homeBeforeRelocation is checked).
  // If the center has not been taught the backend returns "XY center offset not
  // configured", surfaced in the Alert.
  const handleCenter = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log(`[xyz-ui-action] action=move-center homeBeforeRelocation=${homeBeforeRelocation}`);
    void hardware.moveToCenter({ homeBeforeRelocation });
  }, [hardware, homeBeforeRelocation]);

  const handleRelocation = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log(`[xyz-ui-action] action=relocation homeBeforeRelocation=${homeBeforeRelocation}`);
    void hardware.locateCenter({ homeBeforeRelocation });
  }, [hardware, homeBeforeRelocation]);

  // Teach the optical center from the current position (operator jogs the stage
  // to the camera center first, then clicks Set Center).
  const handleSetCenter = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log(`[xyz-set-center-click] uiX=${live.positionKnown ? live.position.x : 'unknown'} uiY=${live.positionKnown ? live.position.y : 'unknown'} uiCenterX=${live.centerX ?? 'unset'} uiCenterY=${live.centerY ?? 'unset'}`);
    void hardware.setCenter();
  }, [hardware, live.positionKnown, live.position.x, live.position.y, live.centerX, live.centerY]);

  // Dedicated hardware home (#12!) — the controller's zero, separate from
  // Relocation so homing is an explicit, deliberate action.
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
    <Box sx={SECTION_SX}>
      {/* Compact connect/status strip (not in the old reference, but auto-connect
          can fail, so a manual fallback + honest status stays). */}
      <Box sx={CONNECT_ROW_SX}>
        <Typography sx={STATUS_TEXT_SX}>
          {savedXyPort ? `X/Y: ${savedXyPort}` : 'X/Y port is not configured'}
          {' · '}
          {savedZPort ? `Z: ${savedZPort}` : 'Z port not configured'}
        </Typography>
        <Button
          variant="contained"
          size="small"
          sx={CONNECT_BTN_SX}
          disabled={connectDisabled}
          onClick={handleConnect}
        >
          Connect
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={CONNECT_BTN_SX}
          disabled={disconnectDisabled}
          onClick={handleDisconnect}
        >
          Disconnect
        </Button>
        <Typography sx={STATUS_TEXT_SX}>
          X/Y: {connectionStatus} · Z: {zConnectionStatus}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {/* Utility controls not part of the reference's two groups, kept here so no
            functionality is lost. Set Center teaches the optical center Relocation
            targets (#10!); Home is the controller zero (#12!); Z Settings opens the
            shared Z Axis dialog. All keep their existing IPC wiring. */}
        <Button variant="outlined" size="small" sx={CONNECT_BTN_SX} disabled={movementDisabled} onClick={handleSetCenter}>
          Set Center
        </Button>
        <Button variant="outlined" size="small" sx={CONNECT_BTN_SX} disabled={movementDisabled} onClick={handleHome}>
          Home
        </Button>
        <Button variant="outlined" size="small" sx={CONNECT_BTN_SX} onClick={() => setActiveDialog('zAxis')}>
          Z Settings…
        </Button>
        <FormControlLabel
          sx={HOME_FIRST_SX}
          control={
            <Checkbox
              size="small"
              checked={homeBeforeRelocation}
              onChange={(event) => setHomeBeforeRelocation(event.target.checked)}
            />
          }
          label="Home before relocation"
        />
        <IconButton
          size="small"
          onClick={() => setActiveDialog('xyPlatform')}
          aria-label="XY platform settings"
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={GROUPS_ROW_SX}>
        {/* ---------------- LEFT GROUP: X/Y ---------------- */}
        <Box sx={XY_GROUP_SX}>
          <Typography sx={GROUP_TITLE_SX}>X/Y</Typography>
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

          <Box sx={XY_GRID_SX}>
            {/* Row 1: ↖ ↑ ↗ | Lock */}
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('forward-left')}>
              <NorthWestIcon />
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('forward')}>
              <NorthIcon />
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('forward-right')}>
              <NorthEastIcon />
            </Button>
            <Button
              variant={live.xyLocked ? 'contained' : 'outlined'}
              sx={TEXT_BTN_SX}
              disabled={isBusy}
              onClick={() => handleXyLock(true)}
            >
              Lock
            </Button>

            {/* Row 2: ← ⊕ → | Unlock */}
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('left')}>
              <WestIcon />
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} onClick={handleCenter}>
              <ControlCameraIcon />
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('right')}>
              <EastIcon />
            </Button>
            <Button
              variant={!live.xyLocked ? 'contained' : 'outlined'}
              sx={TEXT_BTN_SX}
              disabled={isBusy}
              onClick={() => handleXyLock(false)}
            >
              Unlock
            </Button>

            {/* Row 3: ↙ ↓ ↘ | Relocatio */}
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('back-left')}>
              <SouthWestIcon />
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('back')}>
              <SouthIcon />
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} {...jogHandlers('back-right')}>
              <SouthEastIcon />
            </Button>
            <Button variant="outlined" sx={TEXT_BTN_SX} disabled={xyMoveDisabled} onClick={handleRelocation}>
              Relocation
            </Button>
          </Box>

          <Box sx={COORD_ROW_SX}>
            <Typography sx={COORD_SX}>X: {live.positionKnown ? formatCoordinate(pos.x) : '--'}</Typography>
            <Typography sx={COORD_SX}>Y: {live.positionKnown ? formatCoordinate(pos.y) : '--'}</Typography>
          </Box>
        </Box>

        {/* ---------------- RIGHT GROUP: Z ---------------- */}
        <Box sx={Z_GROUP_SX}>
          <Typography sx={GROUP_TITLE_SX}>Z</Typography>
          <RadioGroup
            row
            value={live.zSpeed}
            onChange={(event) => handleZSpeedChange(event.target.value as ZSpeed)}
            sx={RADIO_GROUP_SX}
          >
            <FormControlLabel value="fast" control={<Radio size="small" />} label="Fast" />
            <FormControlLabel value="slow" control={<Radio size="small" />} label="Slow" />
          </RadioGroup>

          <Box sx={Z_GRID_SX}>
            {/* Row 1: Lock | Unlock (require the Z connection; #LK# enables motion) */}
            <Button
              variant={live.zLocked ? 'contained' : 'outlined'}
              sx={TEXT_BTN_SX}
              disabled={zLockDisabled}
              onClick={() => handleZLock(true)}
            >
              Lock
            </Button>
            <Button variant="outlined" sx={TEXT_BTN_SX} disabled={zLockDisabled} onClick={() => handleZLock(false)}>
              Unlock
            </Button>

            {/* Row 2: Cfocus | ↑ */}
            <Button
              variant={live.focusMode === 'cFocus' ? 'contained' : 'outlined'}
              sx={TEXT_BTN_SX}
              disabled={isBusy}
              onClick={() => handleFocusMode('cFocus')}
            >
              Cfocus
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={zMoveDisabled} {...zJogHandlers('up')}>
              <ArrowUpwardIcon />
            </Button>

            {/* Row 3: Ffocus | ↓ */}
            <Button
              variant={live.focusMode === 'fFocus' ? 'contained' : 'outlined'}
              sx={TEXT_BTN_SX}
              disabled={isBusy}
              onClick={() => handleFocusMode('fFocus')}
            >
              Ffocus
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={zMoveDisabled} {...zJogHandlers('down')}>
              <ArrowDownwardIcon />
            </Button>
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
