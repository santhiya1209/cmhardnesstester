import { memo } from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import type { SxProps, Theme } from '@mui/material/styles';
import type { Measurement } from '@/types/measurement';

const COLUMNS = [
  '#',
  'X(mm)',
  'Y(mm)',
  'Hardness',
  'Hardness Type',
  'Qualified',
  'D1(um)',
  'D2(um)',
  'Davg(um)',
  'Convert Type',
  'Convert Value',
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
  color: 'text.secondary',
  py: 0.5,
  px: 1,
  whiteSpace: 'nowrap',
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

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function MeasurementsTableImpl({ measurements, loading, selectedMeasurementId, onSelect }: Props) {
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
            measurements.map((measurement, index) => (
              <TableRow
                key={measurement.id}
                hover
                selected={measurement.id === selectedMeasurementId}
                sx={SELECTED_ROW_SX}
                onClick={() => onSelect(measurement.id)}
              >
                <TableCell sx={BODY_CELL_SX}>{index + 1}</TableCell>
                <TableCell sx={BODY_CELL_SX}>-</TableCell>
                <TableCell sx={BODY_CELL_SX}>-</TableCell>
                <TableCell sx={BODY_CELL_SX}>{formatNumber(measurement.hv)}</TableCell>
                <TableCell sx={BODY_CELL_SX}>HV</TableCell>
                <TableCell sx={BODY_CELL_SX}>-</TableCell>
                <TableCell sx={BODY_CELL_SX}>{formatNumber(measurement.d1)}</TableCell>
                <TableCell sx={BODY_CELL_SX}>{formatNumber(measurement.d2)}</TableCell>
                <TableCell sx={BODY_CELL_SX}>{formatNumber(measurement.average)}</TableCell>
                <TableCell sx={BODY_CELL_SX}>HV</TableCell>
                <TableCell sx={BODY_CELL_SX}>{formatNumber(measurement.hv)}</TableCell>
                <TableCell sx={BODY_CELL_SX}>-</TableCell>
                <TableCell sx={BODY_CELL_SX}>{formatTimestamp(measurement.timestamp)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default memo(MeasurementsTableImpl);
