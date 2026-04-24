import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

const SECTION_SX: SxProps<Theme> = { px: 1.5, py: 2, display: 'flex', flexDirection: 'column', gap: 1 };
const GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr 1fr',
  gap: 1,
  alignItems: 'center',
};
const CELL_SX: SxProps<Theme> = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 0.5,
  py: 1,
  px: 1.5,
  fontSize: 12,
  textAlign: 'center',
  color: 'text.primary',
  bgcolor: 'background.paper',
};
const LABEL_SX: SxProps<Theme> = { ...CELL_SX, fontWeight: 500 };
const VALUE_SX: SxProps<Theme> = { ...CELL_SX, minHeight: 30, color: 'text.secondary' };

function StatisticsInfoTabImpl() {
  return (
    <Box sx={SECTION_SX}>
      <Box sx={GRID_SX}>
        <Typography sx={LABEL_SX}>Number</Typography>
        <Typography sx={VALUE_SX}>&nbsp;</Typography>
        <Typography sx={LABEL_SX}>Variance</Typography>
        <Typography sx={VALUE_SX}>&nbsp;</Typography>

        <Typography sx={LABEL_SX}>Min</Typography>
        <Typography sx={VALUE_SX}>&nbsp;</Typography>
        <Typography sx={LABEL_SX}>StdDev</Typography>
        <Typography sx={VALUE_SX}>&nbsp;</Typography>

        <Typography sx={LABEL_SX}>Max</Typography>
        <Typography sx={VALUE_SX}>&nbsp;</Typography>
        <Box />
        <Box />

        <Typography sx={LABEL_SX}>Average</Typography>
        <Typography sx={VALUE_SX}>&nbsp;</Typography>
        <Box />
        <Box />
      </Box>
    </Box>
  );
}

export default memo(StatisticsInfoTabImpl);
