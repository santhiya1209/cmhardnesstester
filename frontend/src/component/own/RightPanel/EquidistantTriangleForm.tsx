import { memo, useCallback, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { toNumberOrNull } from '@/utils/inputNumber';
import { triangleIsValid } from '@/utils/patternGeneration';
import type { PatternGenerationRequest, TriangleDefinition } from '@/types/patternProgram';

const BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const HINT_SX: SxProps<Theme> = { fontSize: 11, color: 'text.disabled' };
const TABLE_WRAP_SX: SxProps<Theme> = { maxHeight: 240, border: 1, borderColor: 'divider', borderRadius: 0 };
const HEAD_CELL_SX: SxProps<Theme> = { fontSize: 11, fontWeight: 600, color: 'text.secondary', py: 0.5, px: 0.75 };
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.25, px: 0.75 };
const EMPTY_CELL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 4 };
const FIELD_SX: SxProps<Theme> = { width: 64, '& .MuiInputBase-input': { fontSize: 12, py: 0.5, px: 0.5 } };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const INVALID_SX: SxProps<Theme> = { fontSize: 11, color: 'error.main' };

// The six editable vertex coordinates, in table-column order.
const COORD_KEYS = ['x1', 'y1', 'x2', 'y2', 'x3', 'y3'] as const;
type CoordKey = (typeof COORD_KEYS)[number];

function parseCoord(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return Number.NaN;
  const value = Number(trimmed);
  return Number.isNaN(value) ? Number.NaN : value;
}

type RowProps = {
  triangle: TriangleDefinition;
  index: number;
  selected: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
  onChange: (id: string, patch: Partial<TriangleDefinition>) => void;
};

// Local string buffers (one per coordinate) keep typing/clearing smooth while
// committing parsed numbers to the Redux config. Keyed by triangle id in the
// parent, so buffers reseed from the loaded values on Load/Reset.
function TriangleRowImpl({ triangle, index, selected, disabled, onToggle, onChange }: RowProps) {
  const [buffers, setBuffers] = useState<Record<CoordKey, string>>(() =>
    COORD_KEYS.reduce((acc, key) => {
      acc[key] = Number.isFinite(triangle[key]) ? String(triangle[key]) : '';
      return acc;
    }, {} as Record<CoordKey, string>)
  );

  const complete = COORD_KEYS.every((k) => Number.isFinite(triangle[k]));
  const invalid = complete && !triangleIsValid(triangle);

  return (
    <TableRow hover selected={selected}>
      <TableCell padding="checkbox">
        <Checkbox size="small" checked={selected} disabled={disabled} onChange={() => onToggle(triangle.id)} />
      </TableCell>
      <TableCell sx={BODY_CELL_SX}>
        {index + 1}
        {invalid ? <Typography sx={INVALID_SX}>Invalid Triangle Geometry</Typography> : null}
      </TableCell>
      {COORD_KEYS.map((key) => (
        <TableCell key={key} sx={BODY_CELL_SX}>
          <TextField
            size="small"
            sx={FIELD_SX}
            value={buffers[key]}
            disabled={disabled}
            error={invalid}
            onChange={(event) => {
              const text = event.target.value;
              setBuffers((prev) => ({ ...prev, [key]: text }));
              onChange(triangle.id, { [key]: parseCoord(text) });
            }}
          />
        </TableCell>
      ))}
    </TableRow>
  );
}

const TriangleRow = memo(TriangleRowImpl);

type Props = {
  triangles: TriangleDefinition[];
  interval: number | null;
  disabled: boolean;
  multiset: boolean;
  onAddTriangle: () => void;
  onUpdateTriangle: (id: string, patch: Partial<TriangleDefinition>) => void;
  onDeleteTriangles: (ids: string[]) => void;
  onClearTriangles: () => void;
  onConfigChange: (patch: Partial<PatternGenerationRequest>) => void;
};

function EquidistantTriangleFormImpl({
  triangles,
  interval,
  disabled,
  multiset,
  onAddTriangle,
  onUpdateTriangle,
  onDeleteTriangles,
  onClearTriangles,
  onConfigChange,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Selection is screen-scoped UI state derived against the live triangle list,
  // so delete/clear/reset implicitly invalidate stale selections.
  const effectiveSelected = useMemo(
    () => selectedIds.filter((id) => triangles.some((t) => t.id === id)),
    [selectedIds, triangles]
  );

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }, []);

  const handleDelete = useCallback(() => {
    if (effectiveSelected.length === 0) return;
    onDeleteTriangles(effectiveSelected);
    setSelectedIds([]);
  }, [effectiveSelected, onDeleteTriangles]);

  const handleClear = useCallback(() => {
    onClearTriangles();
    setSelectedIds([]);
  }, [onClearTriangles]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>Interval (mm)</Typography>
        <TextField
          size="small"
          type="number"
          sx={{ '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
          defaultValue={interval ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ interval: toNumberOrNull(event.target.value) })}
        />
      </Box>

      <Box sx={BTN_ROW_SX}>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={disabled} onClick={onAddTriangle}>
          Add Triangle
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={disabled || effectiveSelected.length === 0}
          onClick={handleDelete}
        >
          Delete
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={disabled || triangles.length === 0}
          onClick={handleClear}
        >
          Clear
        </Button>
      </Box>

      <TableContainer sx={TABLE_WRAP_SX}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={HEAD_CELL_SX} />
              <TableCell sx={HEAD_CELL_SX}>No.</TableCell>
              <TableCell sx={HEAD_CELL_SX}>X1</TableCell>
              <TableCell sx={HEAD_CELL_SX}>Y1</TableCell>
              <TableCell sx={HEAD_CELL_SX}>X2</TableCell>
              <TableCell sx={HEAD_CELL_SX}>Y2</TableCell>
              <TableCell sx={HEAD_CELL_SX}>X3</TableCell>
              <TableCell sx={HEAD_CELL_SX}>Y3</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {triangles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} sx={EMPTY_CELL_SX}>
                  No triangles. Use Add Triangle.
                </TableCell>
              </TableRow>
            ) : (
              triangles.map((triangle, index) => (
                <TriangleRow
                  key={triangle.id}
                  triangle={triangle}
                  index={index}
                  selected={effectiveSelected.includes(triangle.id)}
                  disabled={disabled}
                  onToggle={toggle}
                  onChange={onUpdateTriangle}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography sx={HINT_SX}>
        {multiset
          ? 'Multiset: every triangle generates (edges sampled at the interval), numbered sequentially.'
          : 'Generates the first triangle only. Enable Multiset to generate all triangles.'}
      </Typography>
    </Box>
  );
}

export default memo(EquidistantTriangleFormImpl);
