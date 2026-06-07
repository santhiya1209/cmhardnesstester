import { memo, useCallback, useEffect } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
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
import type { SxProps, Theme } from '@mui/material/styles';
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
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function XYZPlatformTabImpl() {
  // The ONLY source of truth for everything rendered here is the backend
  // service snapshot. Every value below comes from `live`; no handler mutates
  // a displayed value before a validated hardware (or software-interlock) RX.
  const live = useXyzStageState();
  const hardware = useXyzPlatformHardware();
  const { persist } = useXyzPlatformStateSync();
  const { data: serialSetting } = useSerialPortSetting();

  // Operator-selected X/Y port from Serial Port Setting — the single source for
  // which COM the stage connects on. No hardcoded COM number here.
  const savedXyPort = serialSetting?.xyPortName?.trim() || null;

  const isBusy = hardware.busy;
  const errorMessage = hardware.error ?? live.lastError ?? undefined;
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

  const handleMove = useCallback(
    (direction: XyzDirection) => {
      void hardware.moveStage(direction, live.xySpeed);
    },
    [hardware, live.xySpeed]
  );

  const handleZMove = useCallback(
    (direction: ZDirection) => {
      void hardware.moveZ(direction, live.zSpeed);
    },
    [hardware, live.zSpeed]
  );

  const handleXyLock = useCallback(
    (locked: boolean) => {
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

  const handleCenter = useCallback(() => {
    void hardware.moveToCenter();
  }, [hardware]);

  const handleRelocation = useCallback(() => {
    void hardware.locateCenter();
  }, [hardware]);

  // Connect/disconnect ONLY fire the IPC bridge (COM4); the connected/error
  // state shown below comes from the service via the live subscription.
  const handleConnect = useCallback(() => {
    void hardware.connect(savedXyPort ?? '');
  }, [hardware, savedXyPort]);

  const handleDisconnect = useCallback(() => {
    void hardware.disconnect();
  }, [hardware]);

  const pos = live.position;
  // X/Y movement requires the stage to be LOCKED (servo engaged): locked ⇒ arrows
  // enabled + movement allowed; unlocked ⇒ arrows greyed + movement blocked.
  const xyMoveDisabled = movementDisabled || !live.xyLocked;
  const zMoveDisabled = movementDisabled || live.zLocked;

  return (
    <Box sx={SECTION_SX}>
      {/* Compact connect/status strip (not in the old reference, but auto-connect
          can fail, so a manual fallback + honest status stays). */}
      <Box sx={CONNECT_ROW_SX}>
        <Typography sx={STATUS_TEXT_SX}>
          {savedXyPort ? `Port: ${savedXyPort}` : 'X/Y port is not configured'}
        </Typography>
        <Button
          variant="contained"
          size="small"
          sx={CONNECT_BTN_SX}
          disabled={isBusy || live.connected || !savedXyPort}
          onClick={handleConnect}
        >
          Connect
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={CONNECT_BTN_SX}
          disabled={isBusy || !live.connected}
          onClick={handleDisconnect}
        >
          Disconnect
        </Button>
        <Typography sx={STATUS_TEXT_SX}>Status: {connectionStatus}</Typography>
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
          </RadioGroup>

          <Box sx={XY_GRID_SX}>
            {/* Row 1: ↖ ↑ ↗ | Lock */}
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} onClick={() => handleMove('forward-left')}>
              <NorthWestIcon />
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} onClick={() => handleMove('forward')}>
              <NorthIcon />
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} onClick={() => handleMove('forward-right')}>
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
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} onClick={() => handleMove('left')}>
              <WestIcon />
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} onClick={handleCenter}>
              <ControlCameraIcon />
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} onClick={() => handleMove('right')}>
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
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} onClick={() => handleMove('back-left')}>
              <SouthWestIcon />
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} onClick={() => handleMove('back')}>
              <SouthIcon />
            </Button>
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={xyMoveDisabled} onClick={() => handleMove('back-right')}>
              <SouthEastIcon />
            </Button>
            <Button variant="outlined" sx={TEXT_BTN_SX} disabled={xyMoveDisabled} onClick={handleRelocation}>
              Relocatio
            </Button>
          </Box>

          <Box sx={COORD_ROW_SX}>
            <Typography sx={COORD_SX}>X: {formatCoordinate(pos.x)}</Typography>
            <Typography sx={COORD_SX}>Y: {formatCoordinate(pos.y)}</Typography>
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
            {/* Row 1: Lock | Unlock */}
            <Button
              variant={live.zLocked ? 'contained' : 'outlined'}
              sx={TEXT_BTN_SX}
              disabled={isBusy}
              onClick={() => handleZLock(true)}
            >
              Lock
            </Button>
            <Button variant="outlined" sx={TEXT_BTN_SX} disabled={isBusy} onClick={() => handleZLock(false)}>
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
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={zMoveDisabled} onClick={() => handleZMove('up')}>
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
            <Button variant="outlined" sx={ARROW_BTN_SX} disabled={zMoveDisabled} onClick={() => handleZMove('down')}>
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
