import { memo, useCallback, useEffect, useRef } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
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
import StopIcon from '@mui/icons-material/Stop';
import type { SxProps, Theme } from '@mui/material/styles';
import { useXyzPlatformHardware } from '@/features/xyzPlatform/useXyzPlatformHardware';
import { useXyzPlatformStateSync } from '@/features/xyzPlatform/useXyzPlatformStateSync';
import { useXyzStageState } from '@/hooks/queries/useXyzStageState';
import type { FocusMode, XySpeed, ZSpeed } from '@/types/xyzPlatformState';
import type { XyzDirection, ZDirection } from '@/types/xyzPlatform';

const SECTION_SX: SxProps<Theme> = { px: 1.5, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1 };
const HEADER_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 };
const GROUP_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary', fontWeight: 600 };
const RADIO_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 };
const RADIO_GROUP_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'row',
  gap: 0,
  '& .MuiFormControlLabel-root': { mr: 1.5 },
  '& .MuiFormControlLabel-label': { fontSize: 12 },
  '& .MuiRadio-root': { p: 0.25 },
};
const GRIDS_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 };
const PAD_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5 };
const PAD_BTN_SX: SxProps<Theme> = {
  minWidth: 0,
  height: 32,
  textTransform: 'none',
  fontSize: 11,
  py: 0,
  px: 0.5,
};
const STOP_BTN_SX: SxProps<Theme> = { height: 30, textTransform: 'none', fontSize: 12 };
const COORD_ROW_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  pt: 1,
  borderTop: 1,
  borderColor: 'divider',
};
const COORD_SX: SxProps<Theme> = {
  fontSize: 12,
  color: 'text.secondary',
  fontFamily: 'Consolas, monospace',
};
const STATUS_ROW_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1,
  flexWrap: 'wrap',
  pt: 0.5,
};
const STATUS_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const ALERT_SX: SxProps<Theme> = { mt: 1 };

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function XYZPlatformTabImpl() {
  // The ONLY source of truth for everything rendered here is the backend
  // service snapshot. Every value below comes from `live`; no handler mutates
  // a displayed value before a validated hardware (or software-interlock) RX.
  const live = useXyzStageState();
  const hardware = useXyzPlatformHardware();
  const { persistedState, persist } = useXyzPlatformStateSync();

  const isBusy = hardware.busy;
  const errorMessage = hardware.error ?? live.lastError ?? undefined;

  // Restore the operator's saved X/Y + Z speed PREFERENCES once, by replaying
  // them as real setXySpeed/setZSpeed commands. The UI never sets speed itself;
  // `live.xySpeed/zSpeed` still reflect only what the controller accepted.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !live.connected || !persistedState) return;
    restoredRef.current = true;
    void hardware.setXySpeed(persistedState.xySpeed);
    void hardware.setZSpeed(persistedState.zSpeed);
  }, [live.connected, persistedState, hardware]);

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

  const handleStop = useCallback(() => {
    void hardware.stopStage();
    void hardware.stopZ();
  }, [hardware]);

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

  const pos = live.position;

  return (
    <Box sx={SECTION_SX}>
      <Box sx={HEADER_ROW_SX}>
        <Typography sx={GROUP_LABEL_SX}>X/Y</Typography>
        <Typography sx={GROUP_LABEL_SX}>Z</Typography>
      </Box>

      <Box sx={RADIO_ROW_SX}>
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
        <RadioGroup
          row
          value={live.zSpeed}
          onChange={(event) => handleZSpeedChange(event.target.value as ZSpeed)}
          sx={RADIO_GROUP_SX}
        >
          <FormControlLabel value="ultra" control={<Radio size="small" />} label="Ultra" />
          <FormControlLabel value="fast" control={<Radio size="small" />} label="Fast" />
          <FormControlLabel value="slow" control={<Radio size="small" />} label="Slow" />
        </RadioGroup>
      </Box>

      <Box sx={GRIDS_SX}>
        <Box sx={PAD_SX}>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || live.xyLocked}
            onClick={() => handleMove('forward-left')}
          >
            <NorthWestIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || live.xyLocked}
            onClick={() => handleMove('forward')}
          >
            <NorthIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || live.xyLocked}
            onClick={() => handleMove('forward-right')}
          >
            <NorthEastIcon fontSize="small" />
          </Button>

          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || live.xyLocked}
            onClick={() => handleMove('left')}
          >
            <WestIcon fontSize="small" />
          </Button>
          <Button variant="outlined" sx={PAD_BTN_SX} disabled={isBusy} onClick={handleCenter}>
            <ControlCameraIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || live.xyLocked}
            onClick={() => handleMove('right')}
          >
            <EastIcon fontSize="small" />
          </Button>

          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || live.xyLocked}
            onClick={() => handleMove('back-left')}
          >
            <SouthWestIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || live.xyLocked}
            onClick={() => handleMove('back')}
          >
            <SouthIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || live.xyLocked}
            onClick={() => handleMove('back-right')}
          >
            <SouthEastIcon fontSize="small" />
          </Button>
        </Box>

        <Box sx={PAD_SX}>
          <Button
            variant={live.xyLocked ? 'contained' : 'outlined'}
            sx={PAD_BTN_SX}
            disabled={isBusy}
            onClick={() => handleXyLock(true)}
          >
            Lock
          </Button>
          <Button
            variant={live.zLocked ? 'contained' : 'outlined'}
            sx={PAD_BTN_SX}
            disabled={isBusy}
            onClick={() => handleZLock(true)}
          >
            Lock
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy}
            onClick={() => handleZLock(false)}
          >
            Unlock
          </Button>

          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy}
            onClick={() => handleXyLock(false)}
          >
            Unlock
          </Button>
          <Button
            variant={live.focusMode === 'cFocus' ? 'contained' : 'outlined'}
            sx={PAD_BTN_SX}
            disabled={isBusy}
            onClick={() => handleFocusMode('cFocus')}
          >
            Cfocus
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || live.zLocked}
            onClick={() => handleZMove('up')}
          >
            <ArrowUpwardIcon fontSize="small" />
          </Button>

          <Button variant="outlined" sx={PAD_BTN_SX} disabled={isBusy} onClick={handleRelocation}>
            Relocatio
          </Button>
          <Button
            variant={live.focusMode === 'fFocus' ? 'contained' : 'outlined'}
            sx={PAD_BTN_SX}
            disabled={isBusy}
            onClick={() => handleFocusMode('fFocus')}
          >
            Ffocus
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || live.zLocked}
            onClick={() => handleZMove('down')}
          >
            <ArrowDownwardIcon fontSize="small" />
          </Button>
        </Box>
      </Box>

      <Button
        variant="outlined"
        color="error"
        sx={STOP_BTN_SX}
        startIcon={<StopIcon fontSize="small" />}
        onClick={handleStop}
      >
        Stop
      </Button>

      <Box sx={COORD_ROW_SX}>
        <Typography sx={COORD_SX}>X: {formatCoordinate(pos.x)}</Typography>
        <Typography sx={COORD_SX}>Y: {formatCoordinate(pos.y)}</Typography>
        <Typography sx={COORD_SX}>Z: {formatCoordinate(pos.z)}</Typography>
      </Box>

      <Box sx={STATUS_ROW_SX}>
        <Typography sx={STATUS_TEXT_SX}>{live.lastAction}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isBusy ? <CircularProgress size={12} /> : null}
          <Typography sx={STATUS_TEXT_SX}>
            {`${live.connected ? 'Stage connected' : 'Stage offline'} | ${
              live.xyLocked ? 'XY locked' : 'XY unlocked'
            } | ${live.zLocked ? 'Z locked' : 'Z unlocked'} | Focus: ${live.focusMode}`}
          </Typography>
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
