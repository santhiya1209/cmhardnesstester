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
import type { SxProps, Theme } from '@mui/material/styles';
import { useSaveXyzPlatformState } from '@/hooks/mutations/useSaveXyzPlatformState';
import { useXyzPlatformState } from '@/hooks/queries/useXyzPlatformState';
import type {
  FocusMode,
  XySpeed,
  XYZPlatformState,
  XYZPlatformStatePayload,
  ZSpeed,
} from '@/types/xyzPlatformState';

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

const XY_STEP_MAP: Record<XySpeed, number> = {
  slow: 1,
  mid: 5,
  fast: 10,
};

const Z_STEP_MAP: Record<ZSpeed, number> = {
  slow: 1,
  fast: 5,
  ultra: 10,
};

const DEFAULT_FORM_STATE: XYZPlatformStatePayload = {
  xySpeed: 'slow',
  zSpeed: 'fast',
  platformX: 0,
  platformY: 0,
  platformZ: 0,
  xyLocked: false,
  zLocked: false,
  focusMode: 'manual',
  lastAction: 'Ready for mock platform control.',
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
  const { data: xyzPlatformState, error: loadError, loading, refetch } = useXyzPlatformState();
  const { error: saveError, saveXyzPlatformState, saving } = useSaveXyzPlatformState();
  const [formState, setFormState] = useState<XYZPlatformStatePayload>(DEFAULT_FORM_STATE);

  const persistedFormState = useMemo(() => toFormState(xyzPlatformState), [xyzPlatformState]);
  const isBusy = loading || saving;
  const errorMessage = loadError ?? saveError;

  useEffect(() => {
    if (!loading) {
      setFormState(persistedFormState);
    }
  }, [loading, persistedFormState]);

  const persistState = useCallback(
    async (nextState: XYZPlatformStatePayload) => {
      setFormState(nextState);
      await saveXyzPlatformState({
        id: xyzPlatformState?.id,
        values: nextState,
      });
      await refetch();
    },
    [refetch, saveXyzPlatformState, xyzPlatformState?.id]
  );

  const handleXySpeedChange = useCallback(
    (value: XySpeed) => {
      void persistState({
        ...formState,
        xySpeed: value,
        lastAction: `X/Y speed set to ${value}.`,
      });
    },
    [formState, persistState]
  );

  const handleZSpeedChange = useCallback(
    (value: ZSpeed) => {
      void persistState({
        ...formState,
        zSpeed: value,
        lastAction: `Z speed set to ${value}.`,
      });
    },
    [formState, persistState]
  );

  const handleMove = useCallback(
    (deltaX: number, deltaY: number, lastAction: string) => {
      if (formState.xyLocked) {
        return;
      }

      const step = XY_STEP_MAP[formState.xySpeed];

      void persistState({
        ...formState,
        platformX: formState.platformX + deltaX * step,
        platformY: formState.platformY + deltaY * step,
        lastAction,
      });
    },
    [formState, persistState]
  );

  const handleZMove = useCallback(
    (deltaZ: number, lastAction: string) => {
      if (formState.zLocked) {
        return;
      }

      const step = Z_STEP_MAP[formState.zSpeed];

      void persistState({
        ...formState,
        platformZ: formState.platformZ + deltaZ * step,
        lastAction,
      });
    },
    [formState, persistState]
  );

  const handleLockChange = useCallback(
    (field: 'xyLocked' | 'zLocked', value: boolean, lastAction: string) => {
      void persistState({
        ...formState,
        [field]: value,
        lastAction,
      });
    },
    [formState, persistState]
  );

  const handleFocusModeChange = useCallback(
    (focusMode: FocusMode, lastAction: string) => {
      void persistState({
        ...formState,
        focusMode,
        lastAction,
      });
    },
    [formState, persistState]
  );

  const handleCenter = useCallback(() => {
    void persistState({
      ...formState,
      platformX: 0,
      platformY: 0,
      lastAction: 'Centered X/Y platform (mock).',
    });
  }, [formState, persistState]);

  const handleRelocation = useCallback(() => {
    void persistState({
      ...formState,
      platformX: 0,
      platformY: 0,
      platformZ: 0,
      lastAction: 'Relocation complete (mock reset to origin).',
    });
  }, [formState, persistState]);

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
            onClick={() => handleMove(-1, 1, 'Moved north-west (mock).')}
          >
            <NorthWestIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove(0, 1, 'Moved north (mock).')}
          >
            <NorthIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove(1, 1, 'Moved north-east (mock).')}
          >
            <NorthEastIcon fontSize="small" />
          </Button>

          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove(-1, 0, 'Moved west (mock).')}
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
            onClick={() => handleMove(1, 0, 'Moved east (mock).')}
          >
            <EastIcon fontSize="small" />
          </Button>

          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove(-1, -1, 'Moved south-west (mock).')}
          >
            <SouthWestIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove(0, -1, 'Moved south (mock).')}
          >
            <SouthIcon fontSize="small" />
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.xyLocked}
            onClick={() => handleMove(1, -1, 'Moved south-east (mock).')}
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
            onClick={() => handleFocusModeChange('cFocus', 'Continuous focus enabled (mock).')}
          >
            Cfocus
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.zLocked}
            onClick={() => handleZMove(1, 'Moved Z axis upward (mock).')}
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
            onClick={() => handleFocusModeChange('fFocus', 'Fine focus enabled (mock).')}
          >
            Ffocus
          </Button>
          <Button
            variant="outlined"
            sx={PAD_BTN_SX}
            disabled={isBusy || formState.zLocked}
            onClick={() => handleZMove(-1, 'Moved Z axis downward (mock).')}
          >
            <ArrowDownwardIcon fontSize="small" />
          </Button>
        </Box>
      </Box>

      <Box sx={COORD_ROW_SX}>
        <Typography sx={COORD_SX}>X: {formatCoordinate(formState.platformX)}</Typography>
        <Typography sx={COORD_SX}>Y: {formatCoordinate(formState.platformY)}</Typography>
        <Typography sx={COORD_SX}>Z: {formatCoordinate(formState.platformZ)}</Typography>
      </Box>

      <Box sx={STATUS_ROW_SX}>
        <Typography sx={STATUS_TEXT_SX}>{formState.lastAction}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isBusy ? <CircularProgress size={12} /> : null}
          <Typography sx={STATUS_TEXT_SX}>
            {`${formState.xyLocked ? 'XY locked' : 'XY unlocked'} | ${
              formState.zLocked ? 'Z locked' : 'Z unlocked'
            } | Focus: ${formState.focusMode}`}
          </Typography>
        </Box>
      </Box>

      <Typography sx={STATUS_TEXT_SX}>{formatUpdatedAt(xyzPlatformState?.updatedAt)}</Typography>

      {errorMessage ? (
        <Alert severity="error" sx={ALERT_SX}>
          {errorMessage}
        </Alert>
      ) : null}
    </Box>
  );
}

export default memo(XYZPlatformTabImpl);
