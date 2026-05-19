import { memo, useCallback, useEffect, useState } from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';
import type { Measurement } from '@/types/measurement';
import { colors } from '@/theme/theme';
import { formatMicrometerValue } from '@/utils/formatMicrometerValue';
import { getHardnessColor } from '@/utils/hardnessColor';

const COLUMNS = [
  '#',
  'Hardness',
  'Objective',
  'Method',
  'Hardness Type',
  'Qualified',
  'D1(um)',
  'D2(um)',
  'Davg(um)',
  'Convert Type',
  'Convert Value',
  'Depth',
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
  micrometerEnabled: boolean;
  onManualDepthChange?: (measurementId: string, depthMm: number | null) => void;
  targetMinHv: number | null;
  targetMaxHv: number | null;
};

type DepthCellProps = {
  measurement: Measurement;
  micrometerEnabled: boolean;
  onManualDepthChange?: (measurementId: string, depthMm: number | null) => void;
};

function DepthCell({ measurement, micrometerEnabled, onManualDepthChange }: DepthCellProps) {
  // Device branch: read the frozen device value (falling back to depthMm for
  // rows saved before deviceDepthMm existed). Manual branch: read manualDepthMm
  // (falling back to depthMm). depthMm is always the effective display value
  // for legacy rows.
  const deviceDisplay =
    typeof measurement.deviceDepthMm === 'number' && Number.isFinite(measurement.deviceDepthMm)
      ? measurement.deviceDepthMm
      : measurement.depthMm ?? null;
  const persistedManual =
    typeof measurement.manualDepthMm === 'number' && Number.isFinite(measurement.manualDepthMm)
      ? measurement.manualDepthMm
      : measurement.depthSource === 'manual'
        ? measurement.depthMm ?? null
        : null;
  const [draft, setDraft] = useState<string>(
    persistedManual === null ? '' : String(persistedManual)
  );
  // Keep the input in sync when the row's persisted manual value changes from
  // outside (e.g. a different row was edited and the list refetched).
  useEffect(() => {
    setDraft(persistedManual === null ? '' : String(persistedManual));
  }, [persistedManual]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (trimmed !== '' && !Number.isFinite(next)) {
      // Reject non-numeric input — restore last persisted value.
      setDraft(persistedManual === null ? '' : String(persistedManual));
      return;
    }
    if (next === persistedManual) return;
    onManualDepthChange?.(measurement.id, next);
  }, [draft, measurement.id, onManualDepthChange, persistedManual]);

  if (micrometerEnabled) {
    return <>{formatDepth(deviceDisplay)}</>;
  }
  return (
    <TextField
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          (event.target as HTMLInputElement).blur();
        }
      }}
      onClick={(event) => event.stopPropagation()}
      size="small"
      variant="standard"
      slotProps={{
        htmlInput: { inputMode: 'decimal', style: { fontSize: 12, padding: 0 } },
      }}
      sx={{ width: 80 }}
      placeholder="--"
    />
  );
}

function format3(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '-'
    : value.toFixed(3);
}

function formatBlank(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  return s.trim() === '' ? '' : s;
}

function formatHardness(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatQualified(value: unknown): 'YES' | 'NO' {
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'yes' || v === 'pass' || v === 'true' || v === '1' || v === 'qualified') return 'YES';
    return 'NO';
  }
  if (typeof value === 'number') return value > 0 ? 'YES' : 'NO';
  return 'NO';
}

function formatDepth(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '--'
    : formatMicrometerValue(value);
}

function MeasurementsTableImpl({
  measurements,
  loading,
  selectedMeasurementId,
  onSelect,
  micrometerEnabled,
  onManualDepthChange,
  targetMinHv,
  targetMaxHv,
}: Props) {
  useEffect(() => {
    const first = measurements[0];
    const firstD1Um = first ? first.d1Um ?? (first.unit === 'um' ? first.d1 : null) : null;
    const firstD2Um = first ? first.d2Um ?? (first.unit === 'um' ? first.d2 : null) : null;
    const firstDavgUm = first
      ? first.averageUm ??
        (first.unit === 'um' ? first.average : null) ??
        (firstD1Um !== null && firstD2Um !== null ? (firstD1Um + firstD2Um) / 2 : null)
      : null;
    // eslint-disable-next-line no-console
    console.log(
      `[measurement-table-render] rowCount=${measurements.length} firstRow={ id:${first?.id ?? '-'}, d1Um:${firstD1Um ?? '-'}, d2Um:${firstD2Um ?? '-'}, davgUm:${firstDavgUm ?? '-'}, hv:${first?.hv ?? '-'}, objective:${first?.objective ?? '-'} }`
    );
    if (first) {
      // Per-column binding so we can prove which raw measurement field each
      // table cell reads from. If the measurement-row-save-success log shows
      // d1Um=84.5 but [row-table-bind] column=D1(um) value=- prints, the bug
      // is in the table mapping; otherwise the row never carried d1Um.
      // eslint-disable-next-line no-console
      console.log(`[row-table-bind] column=D1(um) value=${firstD1Um ?? '-'} source=d1Um|unit=um?d1`);
      // eslint-disable-next-line no-console
      console.log(`[row-table-bind] column=D2(um) value=${firstD2Um ?? '-'} source=d2Um|unit=um?d2`);
      // eslint-disable-next-line no-console
      console.log(`[row-table-bind] column=Davg(um) value=${firstDavgUm ?? '-'} source=averageUm|unit=um?average|fallback`);
      // eslint-disable-next-line no-console
      console.log(`[row-table-bind] column=Hardness value=${first.hv ?? '-'} source=hv`);
      // eslint-disable-next-line no-console
      console.log(`[row-table-bind] column=Objective value=${first.objective ?? '-'} source=objective`);
    }
    measurements.forEach((m, i) => {
      const depth =
        typeof m.depthMm === 'number' && Number.isFinite(m.depthMm) ? m.depthMm : '-';
      const convertType = m.convertType ?? '-';
      const convertValue =
        typeof m.convertValue === 'number' && Number.isFinite(m.convertValue)
          ? m.convertValue
          : '-';
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-table] row=${i + 1} id=${m.id} depth=${depth} convertType=${convertType} convertValue=${convertValue}`
      );
      const d1Um = m.d1Um ?? (m.unit === 'um' ? m.d1 : null);
      const d2Um = m.d2Um ?? (m.unit === 'um' ? m.d2 : null);
      const davgUm =
        m.averageUm ??
        (m.unit === 'um' ? m.average : null) ??
        (d1Um !== null && d2Um !== null ? (d1Um + d2Um) / 2 : null);
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-table-display] row=${i + 1} objective=${m.objective ?? '-'} d1Um=${d1Um ?? '-'} d2Um=${d2Um ?? '-'} davgUm=${davgUm ?? '-'} hardness=${m.hv ?? '-'}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-table-render] hardness=${m.hv ?? '-'} convertType=${m.convertType ?? '-'} convertValue=${m.convertValue ?? '-'}`
      );
    });
  }, [measurements]);

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
              const d1Um = measurement.d1Um ?? (measurement.unit === 'um' ? measurement.d1 : null);
              const d2Um = measurement.d2Um ?? (measurement.unit === 'um' ? measurement.d2 : null);
              const davgUm =
                measurement.averageUm ??
                (measurement.unit === 'um' ? measurement.average : null) ??
                (d1Um !== null && d2Um !== null ? (d1Um + d2Um) / 2 : null);

              const hardnessType = formatBlank(measurement.hardnessType) || 'HV';
              // eslint-disable-next-line no-console
              console.log(
                `[measurement-table-render] rowId=${measurement.id} hardnessType=${measurement.hardnessType ?? 'null'} hvType=${hardnessType}`
              );
              const qualified = formatQualified(measurement.qualified);
              const convertType =
                formatBlank(measurement.convertType) || hardnessType || 'NONE';
              let convertValueNum: number | null = null;
              if (typeof measurement.convertValue === 'number' && Number.isFinite(measurement.convertValue)) {
                convertValueNum = measurement.convertValue;
              } else if (typeof measurement.convertValue === 'string' && measurement.convertValue.trim() !== '') {
                const parsed = Number(measurement.convertValue);
                if (Number.isFinite(parsed)) convertValueNum = parsed;
              }
              const convertTypeIsHv = convertType === 'HV' || convertType === 'NONE';
              if (
                convertValueNum === null &&
                convertTypeIsHv &&
                typeof measurement.hv === 'number' &&
                Number.isFinite(measurement.hv)
              ) {
                convertValueNum = measurement.hv;
              }
              const convertValue =
                convertValueNum !== null
                  ? `${formatHardness(convertValueNum)} ${convertType}`
                  : convertTypeIsHv
                    ? '--'
                    : `N/A ${convertType}`;

              return (
                <TableRow
                  key={measurement.id}
                  hover
                  selected={measurement.id === selectedMeasurementId}
                  sx={SELECTED_ROW_SX}
                  onClick={() => onSelect(measurement.id)}
                >
                  <TableCell sx={BODY_CELL_SX}>{index + 1}</TableCell>
                  <TableCell
                    sx={{
                      ...(BODY_CELL_SX as object),
                      color: getHardnessColor(measurement.hv, targetMinHv, targetMaxHv).color,
                      fontWeight: 600,
                    }}
                  >
                    {formatHardness(measurement.hv)}
                  </TableCell>
                  <TableCell sx={BODY_CELL_SX}>{measurement.objective ?? '-'}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{measurement.method}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{hardnessType}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{qualified}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{format3(d1Um)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{format3(d2Um)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{format3(davgUm)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{convertType}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{convertValue}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>
                    <DepthCell
                      measurement={measurement}
                      micrometerEnabled={micrometerEnabled}
                      onManualDepthChange={onManualDepthChange}
                    />
                  </TableCell>
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
