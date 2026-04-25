import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { colors } from '@/theme/theme';

const ROOT_SX: SxProps<Theme> = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  bgcolor: colors.background,
};

const VIEW_SX: SxProps<Theme> = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
  bgcolor: colors.panel,
  border: 1,
  borderColor: colors.border,
  m: 1,
};

const COORD_BAR_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  px: 2,
  py: 0.25,
  bgcolor: colors.panel,
  fontSize: 12,
  borderTop: 1,
  borderColor: colors.border,
};

const COORD_VALUE_SX: SxProps<Theme> = {
  fontFamily:
    "'Cascadia Mono', 'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace",
  fontVariantNumeric: 'tabular-nums',
  fontSize: 12,
  color: colors.textPrimary,
  letterSpacing: 0.2,
};

type Props = {
  x?: number;
  y?: number;
};

function CameraWindowImpl({ x = 570, y = 339 }: Props) {
  return (
    <Box sx={ROOT_SX}>
      <Box sx={VIEW_SX} />
      <Box sx={COORD_BAR_SX}>
        <Typography component="span" sx={COORD_VALUE_SX}>X: {x}</Typography>
        <Typography component="span" sx={COORD_VALUE_SX}>Y: {y}</Typography>
      </Box>
    </Box>
  );
}

export default memo(CameraWindowImpl);
