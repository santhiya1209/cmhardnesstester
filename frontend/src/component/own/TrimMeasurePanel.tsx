import { memo, useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CloseIcon from '@mui/icons-material/Close';
import type { SxProps, Theme } from '@mui/material/styles';

export type TrimSpeed = 'slow' | 'fast';
export type TrimDirection = 'up' | 'down' | 'left' | 'right';
export type TrimGroup = 'centerTop' | 'centerBottom' | 'left' | 'right';
export type TrimCorner = 'top' | 'right' | 'bottom' | 'left';

const SPEED_DELTA: Record<TrimSpeed, number> = {
  slow: 1,
  fast: 10,
};

type Props = {
  open: boolean;
  onClose: () => void;
  // Nudge an existing yellow auto-measure corner by (dx, dy). The parent
  // owns the auto-measure overlay state and applies the offset to the
  // corresponding existing line — Trim Measure does NOT draw new lines.
  onAdjust: (corner: TrimCorner, dx: number, dy: number) => void;
};

const PANEL_SX: SxProps<Theme> = {
  position: 'absolute',
  top: 8,
  right: 8,
  zIndex: 4,
  px: 1.5,
  py: 1.25,
  borderRadius: 1,
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  boxShadow: 3,
  width: 260,
};
const HEADER_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  mb: 1,
};
const TITLE_SX: SxProps<Theme> = { fontSize: 13, fontWeight: 600 };
const GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto',
  alignItems: 'center',
  columnGap: 2,
};
const SIDE_SX: SxProps<Theme> = { display: 'flex', flexDirection: 'row', gap: 0.75 };
const CENTER_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 0.75,
};
const ARROW_BTN_SX: SxProps<Theme> = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  bgcolor: 'background.paper',
  '&:hover': { bgcolor: 'action.hover' },
};
const SPEED_BTN_SX: SxProps<Theme> = {
  textTransform: 'none',
  minWidth: 70,
  fontWeight: 600,
};

// (group, direction) → which existing yellow corner moves and on which axis.
// Group → corner mapping per spec:
//   centerTop    → top corner    (vertical axis only)
//   centerBottom → bottom corner (vertical axis only)
//   left         → left corner   (horizontal axis only)
//   right        → right corner  (horizontal axis only)
function resolveAdjust(
  group: TrimGroup,
  direction: TrimDirection,
  speed: TrimSpeed
): { corner: TrimCorner; dx: number; dy: number } | null {
  const mag = SPEED_DELTA[speed];
  if (group === 'centerTop' || group === 'centerBottom') {
    if (direction !== 'up' && direction !== 'down') return null;
    const dy = (direction === 'up' ? -1 : 1) * mag;
    return { corner: group === 'centerTop' ? 'top' : 'bottom', dx: 0, dy };
  }
  if (direction !== 'left' && direction !== 'right') return null;
  const dx = (direction === 'left' ? -1 : 1) * mag;
  return { corner: group, dx, dy: 0 };
}

function TrimMeasurePanelImpl({ open, onClose, onAdjust }: Props) {
  const [speed, setSpeed] = useState<TrimSpeed>('slow');

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line no-console
    console.log('[trim-measure-ui] open location=right-panel');
    return () => {
      // eslint-disable-next-line no-console
      console.log('[trim-measure-ui] close');
    };
  }, [open]);

  const handleSpeedToggle = useCallback(() => {
    setSpeed((prev) => {
      const next: TrimSpeed = prev === 'slow' ? 'fast' : 'slow';
      // eslint-disable-next-line no-console
      console.log(`[trim-measure-ui] speed=${next}`);
      return next;
    });
  }, []);

  const handleClick = useCallback(
    (direction: TrimDirection, group: TrimGroup) => {
      const resolved = resolveAdjust(group, direction, speed);
      if (!resolved) return;
      const { corner, dx, dy } = resolved;
      const delta = dx !== 0 ? dx : dy;
      // eslint-disable-next-line no-console
      console.log(
        `[trim-measure-ui] direction=${direction} group=${group} speed=${speed} delta=${delta}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[trim-measure-ipc] command=trim-move direction=${direction} group=${group} speed=${speed}`
      );
      // eslint-disable-next-line no-console
      console.log('[trim-measure-machine] protocol=unknown no-tx');
      onAdjust(corner, dx, dy);
    },
    [speed, onAdjust]
  );

  if (!open) return null;

  return (
    <Paper sx={PANEL_SX} elevation={3}>
      <Box sx={HEADER_SX}>
        <Typography sx={TITLE_SX}>Trim Measure</Typography>
        <IconButton size="small" onClick={onClose} aria-label="Close Trim Measure">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={GRID_SX}>
        {/* Left group: ← → moves left corner along X */}
        <Stack sx={SIDE_SX}>
          <IconButton
            size="small"
            sx={ARROW_BTN_SX}
            onClick={() => handleClick('left', 'left')}
            aria-label="Trim left corner left"
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            sx={ARROW_BTN_SX}
            onClick={() => handleClick('right', 'left')}
            aria-label="Trim left corner right"
          >
            <ArrowForwardIcon fontSize="small" />
          </IconButton>
        </Stack>

        {/* Center: ↑ ↓ [Speed] ↑ ↓ */}
        <Box sx={CENTER_SX}>
          <IconButton
            size="small"
            sx={ARROW_BTN_SX}
            onClick={() => handleClick('up', 'centerTop')}
            aria-label="Trim top corner up"
          >
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            sx={ARROW_BTN_SX}
            onClick={() => handleClick('down', 'centerTop')}
            aria-label="Trim top corner down"
          >
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
          <Button
            size="small"
            variant={speed === 'fast' ? 'contained' : 'outlined'}
            color={speed === 'fast' ? 'warning' : 'primary'}
            sx={SPEED_BTN_SX}
            onClick={handleSpeedToggle}
          >
            {speed === 'slow' ? 'Slow' : 'Fast'}
          </Button>
          <IconButton
            size="small"
            sx={ARROW_BTN_SX}
            onClick={() => handleClick('up', 'centerBottom')}
            aria-label="Trim bottom corner up"
          >
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            sx={ARROW_BTN_SX}
            onClick={() => handleClick('down', 'centerBottom')}
            aria-label="Trim bottom corner down"
          >
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Right group: ← → moves right corner along X */}
        <Stack sx={SIDE_SX}>
          <IconButton
            size="small"
            sx={ARROW_BTN_SX}
            onClick={() => handleClick('left', 'right')}
            aria-label="Trim right corner left"
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            sx={ARROW_BTN_SX}
            onClick={() => handleClick('right', 'right')}
            aria-label="Trim right corner right"
          >
            <ArrowForwardIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Speed: {speed === 'slow' ? 'Slow (1 px)' : 'Fast (10 px)'}
      </Typography>
    </Paper>
  );
}

export default memo(TrimMeasurePanelImpl);
