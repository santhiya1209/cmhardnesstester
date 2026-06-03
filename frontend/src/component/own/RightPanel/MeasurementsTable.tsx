import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import type { Measurement } from '@/types/measurement';
import { tokens } from '@/theme/theme';
import { formatMicrometerValue } from '@/utils/formatMicrometerValue';
import { getHardnessColor } from '@/utils/hardnessColor';

const COLUMNS = [
  '#',
  'D1(um)',
  'D2(um)',
  'Davg(um)',
  'Hardness',
  'Objective',
  'HvType',
  'Convert Type',
  'Convert Value',
  'Qualified',
  'Depth',
] as const;

const TABLE_WRAP_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 200,
  maxHeight: 260,
  borderTop: 1,
  borderBottom: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
};
// The global theme sets `.MuiTableHead-root .MuiTableCell-head` to navy on
// white â€” to override industrial-light headers here, sx must beat that
// specificity. `&.MuiTableCell-head` raises this rule to (0,2,1) which
// outranks the theme's (0,2,0) descendant selector.
const TABLE_HEAD_CELL_SX: SxProps<Theme> = {
  '&.MuiTableCell-head': {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.3,
    textTransform: 'none',
    color: tokens.accent.base,
    backgroundColor: '#F1F4F9',
    py: 0.75,
    px: 1,
    whiteSpace: 'nowrap',
    cursor: 'default',
    borderBottom: `1px solid ${tokens.border.default}`,
  },
  '&.MuiTableCell-head:hover': {
    backgroundColor: '#E8EDF4',
  },
};
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.5, px: 1 };
const EMPTY_CELL_SX: SxProps<Theme> = { border: 0, py: 6, px: 1 };
const EMPTY_STATE_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 1,
  color: 'text.disabled',
};
const EMPTY_TEXT_SX: SxProps<Theme> = {
  fontSize: 13,
  color: 'text.secondary',
};
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
  registerInputRef?: (measurementId: string, el: HTMLInputElement | null) => void;
  onFocusSibling?: (currentId: string, direction: 'next' | 'prev') => void;
};

function DepthCell({
  measurement,
  micrometerEnabled,
  onManualDepthChange,
  registerInputRef,
  onFocusSibling,
}: DepthCellProps) {
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

  const inputElRef = useRef<HTMLInputElement | null>(null);
  const setInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      inputElRef.current = el;
      registerInputRef?.(measurement.id, el);
    },
    [measurement.id, registerInputRef]
  );

  const commit = useCallback((): boolean => {
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (trimmed !== '' && !Number.isFinite(next)) {
      // Reject non-numeric input â€” restore last persisted value.
      setDraft(persistedManual === null ? '' : String(persistedManual));
      return false;
    }
    if (next === persistedManual) return true;
    onManualDepthChange?.(measurement.id, next);
    return true;
  }, [draft, measurement.id, onManualDepthChange, persistedManual]);

  if (micrometerEnabled) {
    return <>{formatDepth(deviceDisplay)}</>;
  }
  return (
    <TextField
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => {
      }}
      onBlur={() => {
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (commit()) onFocusSibling?.(measurement.id, 'next');
        } else if (event.key === 'Tab') {
          // Prevent the browser from tabbing into the next table cell (a
          // non-input <td>) â€” we move focus to the next Depth input instead.
          event.preventDefault();
          if (commit()) {
            onFocusSibling?.(measurement.id, event.shiftKey ? 'prev' : 'next');
          }
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(persistedManual === null ? '' : String(persistedManual));
          inputElRef.current?.blur();
        }
      }}
      onClick={(event) => event.stopPropagation()}
      size="small"
      variant="standard"
      inputRef={setInputRef}
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
  // Stable ref map + latest-measurements ref so the Enter/Tab handler can
  // resolve the next row even when the user edits during a refetch.
  const depthInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const measurementsRef = useRef(measurements);
  useEffect(() => {
    measurementsRef.current = measurements;
  }, [measurements]);

  const registerDepthInput = useCallback(
    (measurementId: string, el: HTMLInputElement | null) => {
      if (el) depthInputRefs.current[measurementId] = el;
      else delete depthInputRefs.current[measurementId];
    },
    []
  );

  const focusDepthSibling = useCallback(
    (currentId: string, direction: 'next' | 'prev') => {
      const list = measurementsRef.current;
      const idx = list.findIndex((m) => m.id === currentId);
      if (idx < 0) {
        return;
      }
      const target = direction === 'next' ? list[idx + 1] : list[idx - 1];
      if (!target) {
        return;
      }
      const nextId = target.id;
      requestAnimationFrame(() => {
        const el = depthInputRefs.current[nextId];
        if (!el) {
          return;
        }
        el.focus();
        el.select?.();
      });
    },
    []
  );

  useEffect(() => {
    const first = measurements[0];
    if (first) {
      // Per-column binding so we can prove which raw measurement field each
      // table cell reads from. If the measurement-row-save-success log shows
      // d1Um=84.5 but [row-table-bind] column=D1(um) value=- prints, the bug
      // is in the table mapping; otherwise the row never carried d1Um.
    }
  }, [measurements]);

  return (
    <TableContainer sx={TABLE_WRAP_SX}>
      <Table size="small" stickyHeader>
        <TableHead sx={{ '&.MuiTableHead-root': { backgroundColor: '#F1F4F9' } }}>
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
                <Box sx={EMPTY_STATE_SX}>
                  <Typography sx={EMPTY_TEXT_SX}>No measurements yet</Typography>
                </Box>
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
                  <TableCell sx={BODY_CELL_SX}>{format3(d1Um)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{format3(d2Um)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{format3(davgUm)}</TableCell>
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
                  <TableCell sx={BODY_CELL_SX}>{hardnessType}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{convertType}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{convertValue}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{qualified}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>
                    <DepthCell
                      measurement={measurement}
                      micrometerEnabled={micrometerEnabled}
                      onManualDepthChange={onManualDepthChange}
                      registerInputRef={registerDepthInput}
                      onFocusSibling={focusDepthSibling}
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
