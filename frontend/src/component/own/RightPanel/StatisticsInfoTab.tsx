import { memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import type { Measurement } from '@/types/measurement';
import { getHardnessColor } from '@/utils/hardnessColor';

const SECTION_SX: SxProps<Theme> = { flex: 1, minHeight: 0, px: 1.5, py: 2, display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', overflowX: 'hidden' };
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

type Props = {
  measurements?: Measurement[];
  targetMinHv?: number | null;
  targetMaxHv?: number | null;
};

function formatNumber(value: number | null): string {
  if (value === null) {
    return '-';
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function StatisticsInfoTabImpl({ measurements = [], targetMinHv = null, targetMaxHv = null }: Props) {
  const colorFor = (value: number | null): string =>
    getHardnessColor(value, targetMinHv, targetMaxHv).color;
  const stats = useMemo(() => {
    const hardnessValues = measurements
      .map((measurement) => measurement.hv)
      .filter((value): value is number => value !== null);

    if (hardnessValues.length === 0) {
      return {
        count: 0,
        min: null,
        max: null,
        average: null,
        variance: null,
        stdDev: null,
      };
    }

    const count = hardnessValues.length;
    const average = hardnessValues.reduce((sum, value) => sum + value, 0) / count;
    const variance =
      hardnessValues.reduce((sum, value) => sum + (value - average) ** 2, 0) / count;

    return {
      count,
      min: Math.min(...hardnessValues),
      max: Math.max(...hardnessValues),
      average,
      variance,
      stdDev: Math.sqrt(variance),
    };
  }, [measurements]);

  return (
    <Box sx={SECTION_SX}>
      <Box sx={GRID_SX}>
        <Typography sx={LABEL_SX}>Number</Typography>
        <Typography sx={VALUE_SX}>{stats.count === 0 ? '-' : stats.count}</Typography>
        <Typography sx={LABEL_SX}>Variance</Typography>
        <Typography sx={VALUE_SX}>{formatNumber(stats.variance)}</Typography>

        <Typography sx={LABEL_SX}>Min</Typography>
        <Typography sx={{ ...(VALUE_SX as object), color: colorFor(stats.min), fontWeight: 600 }}>
          {formatNumber(stats.min)}
        </Typography>
        <Typography sx={LABEL_SX}>StdDev</Typography>
        <Typography sx={VALUE_SX}>{formatNumber(stats.stdDev)}</Typography>

        <Typography sx={LABEL_SX}>Max</Typography>
        <Typography sx={{ ...(VALUE_SX as object), color: colorFor(stats.max), fontWeight: 600 }}>
          {formatNumber(stats.max)}
        </Typography>
        <Box />
        <Box />

        <Typography sx={LABEL_SX}>Average</Typography>
        <Typography sx={{ ...(VALUE_SX as object), color: colorFor(stats.average), fontWeight: 600 }}>
          {formatNumber(stats.average)}
        </Typography>
        <Box />
        <Box />
      </Box>
    </Box>
  );
}

export default memo(StatisticsInfoTabImpl);
