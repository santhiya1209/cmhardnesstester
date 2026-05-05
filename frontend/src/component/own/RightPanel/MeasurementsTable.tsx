import { memo, useEffect, useState } from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import type { SxProps, Theme } from '@mui/material/styles';
import type { Measurement } from '@/types/measurement';
import { colors } from '@/theme/theme';
import { formatMicrometerValue } from '@/utils/formatMicrometerValue';
import { useMicrometerReading } from '@/hooks/useMicrometerReading';

const COLUMNS = [
  '#',
  'X(mm)',
  'Y(mm)',
  'Method',
  'Objective',
  'D1 px',
  'D2 px',
  'D1 µm',
  'D2 µm',
  'Avg µm',
  'Avg mm',
  'HV',
  'Force',
  'Calibration',
  'Depth',
  'Measure Time',
] as const;

const TABLE_WRAP_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 160,
  maxHeight: 220,
  borderTop: 1,
  borderBottom: 1,
  borderColor: 'divider',
};
const TABLE_HEAD_CELL_SX: SxProps<Theme> = {
  fontSize: 11,
  fontWeight: 600,
  color: '#FFFFFF',
  bgcolor: colors.headingPrimary,
  py: 0.5,
  px: 1,
  whiteSpace: 'nowrap',
  cursor: 'default',
  borderBottom: `2px solid ${colors.headingPrimary}`,
  transition:
    'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
  '&:hover': {
    bgcolor: '#475569',
    color: '#FFFFFF',
    borderBottomColor: '#FFFFFF',
  },
};
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.5, px: 1 };
const EMPTY_CELL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 4 };
const SELECTED_ROW_SX: SxProps<Theme> = {
  cursor: 'pointer',
  '&.Mui-selected': {
    bgcolor: 'action.selected',
  },
  '&.Mui-selected:hover': {
    bgcolor: 'action.selected',
  },
};

type Props = {
  measurements: Measurement[];
  loading: boolean;
  selectedMeasurementId: string | null;
  onSelect: (measurementId: string) => void;
};

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) {
    return '-';
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function formatDepth(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : formatMicrometerValue(value);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function MeasurementsTableImpl({ measurements, loading, selectedMeasurementId, onSelect }: Props) {
  const { connected, status, value, displayText } = useMicrometerReading();
  const [latchedDepth, setLatchedDepth] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'valid' && value !== null && Number.isFinite(value)) {
      setLatchedDepth(displayText);
    } else if (!connected) {
      setLatchedDepth(null);
    }
  }, [status, value, displayText, connected]);

  return (
    <TableContainer sx={TABLE_WRAP_SX}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {COLUMNS.map((column) => (
              <TableCell key={column} sx={TABLE_HEAD_CELL_SX}>
                {column}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={COLUMNS.length} sx={EMPTY_CELL_SX}>
                Loading measurements...
              </TableCell>
            </TableRow>
          ) : measurements.length === 0 ? (
            <TableRow>
              <TableCell colSpan={COLUMNS.length} sx={EMPTY_CELL_SX}>
                No measurements yet
              </TableCell>
            </TableRow>
          ) : (
            measurements.map((measurement, index) => {
              const d1Px = measurement.d1Px ?? (measurement.unit === 'px' ? measurement.d1 : null);
              const d2Px = measurement.d2Px ?? (measurement.unit === 'px' ? measurement.d2 : null);
              const d1Um = measurement.d1Um ?? (measurement.unit === 'um' ? measurement.d1 : null);
              const d2Um = measurement.d2Um ?? (measurement.unit === 'um' ? measurement.d2 : null);
              const averageUm =
                measurement.averageUm ?? (measurement.unit === 'um' ? measurement.average : null);

              return (
                <TableRow
                  key={measurement.id}
                  hover
                  selected={measurement.id === selectedMeasurementId}
                  sx={SELECTED_ROW_SX}
                  onClick={() => onSelect(measurement.id)}
                >
                  <TableCell sx={BODY_CELL_SX}>{index + 1}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>
                    {(measurement.xMm ?? 0).toFixed(4)}
                  </TableCell>
                  <TableCell sx={BODY_CELL_SX}>
                    {(measurement.yMm ?? 0).toFixed(4)}
                  </TableCell>
                  <TableCell sx={BODY_CELL_SX}>{measurement.method}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{measurement.objective ?? '-'}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{formatNumber(d1Px)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{formatNumber(d2Px)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{formatNumber(d1Um, 3)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{formatNumber(d2Um, 3)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{formatNumber(averageUm, 3)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{formatNumber(measurement.averageMm, 6)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{formatNumber(measurement.hv)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{formatNumber(measurement.testForceKgf, 3)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{measurement.calibrationName ?? '-'}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>
                    {measurement.depthMm !== null && measurement.depthMm !== undefined
                      ? formatDepth(measurement.depthMm)
                      : (latchedDepth ?? '—')}
                  </TableCell>
                  <TableCell sx={BODY_CELL_SX}>{formatTimestamp(measurement.timestamp)}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default memo(MeasurementsTableImpl);
