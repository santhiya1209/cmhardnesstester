import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
import { useXyzPlatformHardware } from '@/hooks/mutations/useXyzPlatformHardware';
import { useXyzPlatformStateSync } from '@/hooks/mutations/useXyzPlatformStateSync';
import { useXyzPositionSubscription } from '@/hooks/queries/useXyzPositionSubscription';
import type {
  FocusMode,
  XySpeed,
  XYZPlatformState,
  XYZPlatformStatePayload,
  ZSpeed,
} from '@/types/xyzPlatformState';
import type { XyzCommandResult, XyzDirection, ZDirection } from '@/types/xyzPlatform';

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

const DEFAULT_FORM_STATE: XYZPlatformStatePayload = {
  xySpeed: 'slow',
  zSpeed: 'fast',
  platformX: 0,
  platformY: 0,
  platformZ: 0,
  xyLocked: false,
  zLocked: false,
  focusMode: 'manual',
  lastAction: 'Ready for platform control.',
};

function toFormState(state: XYZPlatformState | null): XYZPlatformStatePayload {
  if (!state) {
    return DEFAULT_FORM_STATE;
  }

  return {
    xySpeed: state.xySpeed,
    zSpeed: state.zSpeed,
    platformX: state.platformX,
    platformY: state.platformY,
    platformZ: state.platformZ,
    xyLocked: state.xyLocked,
    zLocked: state.zLocked,
    focusMode: state.focusMode,
    lastAction: state.lastAction,
  };
}

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatUpdatedAt(value: string | undefined): string {
  if (!value) {
    return 'No saved XYZ platform state yet.';
  }

  return `Last synced ${new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))}.`;
}

function XYZPlatformTabImpl() {
  const { persistedState, error: syncError, loading, saving, persist } = useXyzPlatformStateSync();
  const hardware = useXyzPlatformHardware();
  const live = useXyzPositionSubscription();
  const [formState, setFormState] = useState<XYZPlatformStatePayload>(DEFAULT_FORM_STATE);

  const persistedFormState = useMemo(() => toFormState(persistedState), [persistedState]);
  const isBusy = loading || saving || hardware.busy;
  const errorMessage = syncError ?? hardware.error ?? live.lastError ?? undefined;

  useEffect(() => {
    if (!loading) {
      setFormState(persistedFormState);
    }
  }, [loading, persistedFormState]);

  const commit = useCallback(
    (next: XYZPlatformStatePayload) => {
      setFormState(next);
      void persist(next);
    },
    [persist]
  );

  const persistMoveResult = useCallback(
    (result: XyzCommandResult, intent: string) => {
      if (result.ok && result.position) {
        commit({
          ...formState,
          platformX: result.position.x,
          platformY: result.position.y,
          platformZ: result.position.z,
          lastAction: intent,
        });
      } else if (result.ok) {
        commit({ ...formState, lastAction: intent });
      } else {
        commit({ ...formState, lastAction: `${intent} — failed: ${result.error}` });
      }
    },
    [commit, formState]
  );

  const handleXySpeedChange = useCallback(
    (value: XySpeed) => {
      commit({ ...formState, xySpeed: value, lastAction: `X/Y speed set to ${value}.` });
      void hardware.setXySpeed(value);
    },
    [commit, formState, hardware]
  );

  const handleZSpeedChange = useCallback(
    (value: ZSpeed) => {
      commit({ ...formState, zSpeed: value, lastAction: `Z speed set to ${value}.` });
      void hardware.setZSpeed(value);
    },
    [commit, formState, hardware]
  );

  const handleMove = useCallback(
    async (direction: XyzDirection, intent: string) => {
      if (formState.xyLocked) {
        return;
      }
      const result = await hardware.moveStage(direction, formState.xySpeed);
      persistMoveResult(result, intent);
    },
    [formState.xyLocked, formState.xySpeed, hardware, persistMoveResult]
  );

  const handleZMove = useCallback(
    async (direction: ZDirection, intent: string) => {
      if (formState.zLocked) {
        return;
      }
      const result = await hardware.moveZ(direction, formState.zSpeed);
      persistMoveResult(result, intent);
    },
    [formState.zLocked, formState.zSpeed, hardware, persistMoveResult]
  );

  const handleStop = useCallback(() => {
    void hardware.stopStage();
    void hardware.stopZ();
    commit({ ...formState, lastAction: 'Stop requested.' });
  }, [commit, formState, hardware]);

  const handleLockChange = useCallback(
    (field: 'xyLocked' | 'zLocked', value: boolean, lastAction: string) => {
      commit({ ...formState, [field]: value, lastAction });
      if (field === 'zLocked') {
        void (value ? hardware.lockZ() : hardware.unlockZ());
      }
    },
    [commit, formState, hardware]
  );

  const handleFocusModeChange = useCallback(
    (focusMode: FocusMode, lastAction: string) => {
      commit({ ...formState, focusMode, lastAction });
    },
    [commit, formState]
  );

  const handleCenter = useCallback(async () => {
    const result = await hardware.moveToCenter();
    persistMoveResult(result, 'Centered X/Y platform.');
  }, [hardware, persistMoveResult]);

  const handleRelocation = useCallback(async () => {
    const result = await hardware.locateCenter();
    persistMoveResult(result, 'Relocation (locate center).');
  }, [hardware, persistMoveResult]);

  const displayPos = live.position ?? {
    x: formState.platformX,
    y: formState.platformY,
    z: formState.platformZ,
  };

  return (
    <Box sx={SECTION_SX}>
      <Box sx={HEADER_ROW_SX}>
        <Typography sx={GROUP_LABEL_SX}>X/Y</Typography>
        <Typography sx={GROUP_LABEL_SX}>Z</Typography>
      </Box>

      <Box sx={RADIO_ROW_SX}>
        <RadioGroup
          row
          value={formState.xySpeed}
          onChange={(event) => handleXySpeedChange(event.target.value as XySpeed)}
          sx={RADIO_GROUP_SX}
        >
          <FormControlLabel value="slow" control={<Radio size="small" />} label="Slow" />
          <FormControlLabel value="mid" control={<Radio size="small" />} label="Mid" />
          <FormControlLabel value="fast" control={<Radio size="small" />} label="Fast" />
        </RadioGroup>
        <RadioGroup
          row
          value={formState.zSpeed}
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
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove('forward-left', 'Moved north-west.')}
          >
            <NorthWestIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove('forward', 'Moved north.')}
          >
            <NorthIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove('forward-right', 'Moved north-east.')}
          >
            <NorthEastIcon fontSize="small" />
          </Button>

          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove('left', 'Moved west.')}
          >
            <WestIcon fontSize="small" />
          </Button>
          <Button variant="outlined" sx={PAD_BTN_SX} disabled={isBusy} onClick={handleCenter}>
            <ControlCameraIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove('right', 'Moved east.')}
          >
            <EastIcon fontSize="small" />
          </Button>

          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove('back-left', 'Moved south-west.')}
          >
            <SouthWestIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove('back', 'Moved south.')}
          >
            <SouthIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove('back-right', 'Moved south-east.')}
          >
            <SouthEastIcon fontSize="small" />
          </Button>
        </Box>

        <Box sx={PAD_SX}>
          <Button
            variant={formState.xyLocked ? 'contained' : 'outlined'}
            sx={PAD_BTN_SX}
            disabled={isBusy}
            onClick={() => handleLockChange('xyLocked', true, 'X/Y platform locked.')}
          >
            Lock
          </Button>
          <Button
            variant={formState.zLocked ? 'contained' : 'outlined'}
            sx={PAD_BTN_SX}
            disabled={isBusy}
            onClick={() => handleLockChange('zLocked', true, 'Z axis locked.')}
          >
            Lock
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy}
            onClick={() => handleLockChange('zLocked', false, 'Z axis unlocked.')}
          >
            Unlock
          </Button>

          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy}
            onClick={() => handleLockChange('xyLocked', false, 'X/Y platform unlocked.')}
          >
            Unlock
          </Button>
          <Button
            variant={formState.focusMode === 'cFocus' ? 'contained' : 'outlined'}
            sx={PAD_BTN_SX}
            disabled={isBusy}
            onClick={() => handleFocusModeChange('cFocus', 'Continuous focus enabled.')}
          >
            Cfocus
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.zLocked}
            onClick={() => handleZMove('up', 'Moved Z axis upward.')}
          >
            <ArrowUpwardIcon fontSize="small" />
          </Button>

          <Button variant="outlined" sx={PAD_BTN_SX} disabled={isBusy} onClick={handleRelocation}>
            Relocatio
          </Button>
          <Button
            variant={formState.focusMode === 'fFocus' ? 'contained' : 'outlined'}
            sx={PAD_BTN_SX}
            disabled={isBusy}
            onClick={() => handleFocusModeChange('fFocus', 'Fine focus enabled.')}
          >
            Ffocus
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.zLocked}
            onClick={() => handleZMove('down', 'Moved Z axis downward.')}
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
        <Typography sx={COORD_SX}>X: {formatCoordinate(displayPos.x)}</Typography>
        <Typography sx={COORD_SX}>Y: {formatCoordinate(displayPos.y)}</Typography>
        <Typography sx={COORD_SX}>Z: {formatCoordinate(displayPos.z)}</Typography>
      </Box>

      <Box sx={STATUS_ROW_SX}>
        <Typography sx={STATUS_TEXT_SX}>{formState.lastAction}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isBusy ? <CircularProgress size={12} /> : null}
          <Typography sx={STATUS_TEXT_SX}>
            {`${live.connected ? 'Stage connected' : 'Stage offline'} | ${
              formState.xyLocked ? 'XY locked' : 'XY unlocked'
            } | ${formState.zLocked ? 'Z locked' : 'Z unlocked'} | Focus: ${formState.focusMode}`}
          </Typography>
        </Box>
      </Box>

      <Typography sx={STATUS_TEXT_SX}>{formatUpdatedAt(persistedState?.updatedAt)}</Typography>

      {errorMessage ? (
        <Alert severity="error" sx={ALERT_SX}>
          {errorMessage}
        </Alert>
      ) : null}
    </Box>
  );
}

export default memo(XYZPlatformTabImpl);
