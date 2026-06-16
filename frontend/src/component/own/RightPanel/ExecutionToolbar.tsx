import { memo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import CenterFocusStrongRoundedIcon from '@mui/icons-material/CenterFocusStrongRounded';
import type { SxProps, Theme } from '@mui/material/styles';
import type { EnginePhase } from '@/types/multipointExecution';
import { ACTIVE_PHASES } from '@/types/multipointExecution';

const ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 88 };

type Props = {
  phase: EnginePhase;
  running: boolean;
  awaitingDecision: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSkip: () => void;
  onRetry: () => void;
  onRemeasure: () => void;
};

function ExecutionToolbarImpl({
  phase,
  running,
  awaitingDecision,
  onStart,
  onPause,
  onResume,
  onStop,
  onSkip,
  onRetry,
  onRemeasure,
}: Props) {
  const active = ACTIVE_PHASES.has(phase);
  const paused = phase === 'paused';
  const canStart = !running && (phase === 'idle' || phase === 'completed' || phase === 'stopped' || phase === 'error');

  return (
    <Box sx={ROW_SX}>
      <Button
        variant="contained"
        color="primary"
        size="small"
        sx={BTN_SX}
        startIcon={<PlayArrowRoundedIcon />}
        disabled={!canStart}
        onClick={onStart}
      >
        Start
      </Button>
      <Button
        variant="outlined"
        size="small"
        sx={BTN_SX}
        startIcon={<PauseRoundedIcon />}
        disabled={!active || paused}
        onClick={onPause}
      >
        Pause
      </Button>
      <Button
        variant="outlined"
        size="small"
        sx={BTN_SX}
        startIcon={<PlayArrowRoundedIcon />}
        disabled={!paused || awaitingDecision}
        onClick={onResume}
      >
        Resume
      </Button>
      <Button
        variant="outlined"
        color="error"
        size="small"
        sx={BTN_SX}
        startIcon={<StopRoundedIcon />}
        disabled={!running}
        onClick={onStop}
      >
        Stop
      </Button>
      <Button
        variant="outlined"
        size="small"
        sx={BTN_SX}
        startIcon={<SkipNextRoundedIcon />}
        disabled={!awaitingDecision}
        onClick={onSkip}
      >
        Skip
      </Button>
      <Button
        variant="outlined"
        size="small"
        sx={BTN_SX}
        startIcon={<ReplayRoundedIcon />}
        disabled={!awaitingDecision}
        onClick={onRetry}
      >
        Retry
      </Button>
      <Button
        variant="outlined"
        size="small"
        sx={BTN_SX}
        startIcon={<CenterFocusStrongRoundedIcon />}
        disabled={!awaitingDecision}
        onClick={onRemeasure}
      >
        Re-measure
      </Button>
    </Box>
  );
}

export default memo(ExecutionToolbarImpl);
