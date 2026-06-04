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
import { radii, tokens } from '@/theme/theme';
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
// Dark navy header with white text. The global theme styles
// `.MuiTableHead-root .MuiTableCell-head` (0,2,0); `&.MuiTableCell-head`
// raises this to (0,2,1) so it wins.
const TABLE_HEAD_CELL_SX: SxProps<Theme> = {
  '&.MuiTableCell-head': {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.3,
    textTransform: 'none',
    color: tokens.text.onInverse,
    backgroundColor: tokens.accent.base,
    py: 0.75,
    px: 1,
    whiteSpace: 'nowrap',
    cursor: 'default',
    borderBottom: 'none',
  },
};
// Zebra striping (very light blue on even rows), light sky-blue selected row
// with a small blue left indicator, and thin row separators.
const ZEBRA_EVEN_BG = '#F4F8FD';
const SELECTED_ROW_BG = tokens.accentSecondary.soft;
const SELECTED_ROW_INDICATOR = tokens.accentSecondary.base;
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.5, px: 1 };
const QUALIFIED_PILL_BASE_SX: SxProps<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  px: 1,
  borderRadius: radii.pill,
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1,
};
const QUALIFIED_YES_SX: SxProps<Theme> = {
  ...(QUALIFIED_PILL_BASE_SX as object),
  color: tokens.status.success,
  backgroundColor: '#E3F3EE',
};
const QUALIFIED_NO_SX: SxProps<Theme> = {
  ...(QUALIFIED_PILL_BASE_SX as object),
  color: tokens.status.error,
  backgroundColor: '#FBE9E9',
};
const OBJECTIVE_CELL_SX: SxProps<Theme> = { display: 'inline-flex', alignItems: 'center', gap: 0.75 };
const objectiveDot = (color: string): SxProps<Theme> => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  bgcolor: color,
  flexShrink: 0,
});
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
const BODY_ROW_SX: SxProps<Theme> = {
  cursor: 'pointer',
  // Thin separators between rows.
  '& > .MuiTableCell-root': {
    borderBottom: `1px solid ${tokens.border.subtle}`,
  },
  // Zebra: odd rows white, even rows very light blue.
  '&:nth-of-type(odd)': { backgroundColor: tokens.surface.raised },
  '&:nth-of-type(even)': { backgroundColor: ZEBRA_EVEN_BG },
  '&:hover': { backgroundColor: 'action.hover' },
  // Selected: light sky-blue background (beats zebra via the extra class
  // specificity) with a small blue left indicator on the first cell.
  '&.Mui-selected': { backgroundColor: SELECTED_ROW_BG },
  '&.Mui-selected:hover': { backgroundColor: SELECTED_ROW_BG },
  '&.Mui-selected > .MuiTableCell-root:first-of-type': {
    boxShadow: `inset 3px 0 0 0 ${SELECTED_ROW_INDICATOR}`,
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

// Objective indicator dot: 10X => orange, 40X => blue, anything else (IND,
// legacy values) => no dot.
function objectiveDotColor(objective: string | null | undefined): string | null {
  const key = String(objective ?? '').trim().toUpperCase();
  if (key === '10X') return tokens.status.warning;
  if (key === '40X') return tokens.accentSecondary.base;
  return null;
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
        <TableHead sx={{ '&.MuiTableHead-root': { backgroundColor: tokens.accent.base } }}>
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

              const isSelected = measurement.id === selectedMeasurementId;
              const hardnessTargetColor = getHardnessColor(
                measurement.hv,
                targetMinHv,
                targetMaxHv
              ).color;
              // Target band color (red in-range / blue out-of-range) takes
              // priority; with no target set, the selected row's hardness shows
              // blue as the active indicator, otherwise inherits normal text.
              const hardnessColor =
                hardnessTargetColor !== 'inherit'
                  ? hardnessTargetColor
                  : isSelected
                    ? tokens.accentSecondary.base
                    : 'inherit';
              const dotColor = objectiveDotColor(measurement.objective);

              return (
                <TableRow
                  key={measurement.id}
                  hover
                  selected={isSelected}
                  sx={BODY_ROW_SX}
                  onClick={() => onSelect(measurement.id)}
                >
                  <TableCell sx={BODY_CELL_SX}>{index + 1}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{format3(d1Um)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{format3(d2Um)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{format3(davgUm)}</TableCell>
                  <TableCell
                    sx={{
                      ...(BODY_CELL_SX as object),
                      color: hardnessColor,
                      fontWeight: 600,
                    }}
                  >
                    {formatHardness(measurement.hv)}
                  </TableCell>
                  <TableCell sx={BODY_CELL_SX}>
                    <Box component="span" sx={OBJECTIVE_CELL_SX}>
                      {dotColor ? <Box component="span" sx={objectiveDot(dotColor)} /> : null}
                      <span>{measurement.objective ?? '-'}</span>
                    </Box>
                  </TableCell>
                  <TableCell sx={BODY_CELL_SX}>{hardnessType}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{convertType}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{convertValue}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>
                    <Box component="span" sx={qualified === 'YES' ? QUALIFIED_YES_SX : QUALIFIED_NO_SX}>
                      {qualified}
                    </Box>
                  </TableCell>
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
