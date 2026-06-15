import { memo, useCallback, useMemo, useState, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddLocationAltIcon from '@mui/icons-material/AddLocationAlt';
import type { SxProps, Theme } from '@mui/material/styles';
import type { FreePoint } from '@/types/patternProgram';
import { useXyzStageState } from '@/hooks/queries/useXyzStageState';

const BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const HINT_SX: SxProps<Theme> = { fontSize: 11, color: 'text.disabled' };
const TABLE_WRAP_SX: SxProps<Theme> = { maxHeight: 240, border: 1, borderColor: 'divider', borderRadius: 0 };
const HEAD_CELL_SX: SxProps<Theme> = { fontSize: 11, fontWeight: 600, color: 'text.secondary', py: 0.5, px: 1 };
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.25, px: 1 };
const EMPTY_CELL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 4 };
const FIELD_SX: SxProps<Theme> = { '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } };

// Reference-point readout card — the centre-relative live position the operator
// captures with Add Point.
const READOUT_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr 1fr',
  alignItems: 'center',
  gap: 1,
  px: 1.5,
  py: 1,
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  bgcolor: 'background.default',
};
const READOUT_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary', fontWeight: 600 };
const READOUT_VALUE_SX: SxProps<Theme> = {
  fontFamily: "'Cascadia Mono', Consolas, ui-monospace, monospace",
  fontVariantNumeric: 'tabular-nums',
  fontSize: 13,
  color: 'text.primary',
};

const COORD_DP = 5;

function parseCoord(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return Number.NaN;
  const value = Number(trimmed);
  return Number.isNaN(value) ? Number.NaN : value;
}

/**
 * Live centre-relative position under the reticle centre. Owns its own stage
 * subscription so only this leaf re-renders as the stage moves — the form and
 * its table inputs stay put. displayX/Y = positionMm − relocation origin, which
 * reads 0.000, 0.000 at the relocation centre. Never shows raw machine mm.
 */
function LiveReferenceReadoutImpl({ originX, originY }: { originX: number; originY: number }) {
  const { positionMm, positionKnown } = useXyzStageState();
  const x = positionKnown ? (positionMm.x - originX).toFixed(COORD_DP) : '--';
  const y = positionKnown ? (positionMm.y - originY).toFixed(COORD_DP) : '--';
  return (
    <Box sx={READOUT_SX}>
      <Typography sx={READOUT_LABEL_SX}>Reference Point</Typography>
      <Typography sx={READOUT_VALUE_SX}>X: {x}</Typography>
      <Typography sx={READOUT_VALUE_SX}>Y: {y}</Typography>
    </Box>
  );
}
const LiveReferenceReadout = memo(LiveReferenceReadoutImpl);

type RowProps = {
  point: FreePoint;
  index: number;
  selected: boolean;
  disabled: boolean;
  originX: number;
  originY: number;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<FreePoint>) => void;
};

// Centre-relative editable row. The local string buffer keeps typing smooth; the
// stored coordinate stays absolute (buffer value + origin), matching the table
// display convention used across multipoint modes.
function CaptureRowImpl({ point, index, selected, disabled, originX, originY, onSelect, onChange }: RowProps) {
  const [x, setX] = useState(Number.isFinite(point.x) ? String(point.x - originX) : '');
  const [y, setY] = useState(Number.isFinite(point.y) ? String(point.y - originY) : '');
  return (
    <TableRow hover selected={selected} onClick={() => onSelect(point.id)}>
      <TableCell sx={BODY_CELL_SX}>P{index + 1}</TableCell>
      <TableCell sx={BODY_CELL_SX}>
        <TextField
          size="small"
          sx={FIELD_SX}
          value={x}
          disabled={disabled}
          onChange={(event) => {
            setX(event.target.value);
            onChange(point.id, { x: parseCoord(event.target.value) + originX });
          }}
        />
      </TableCell>
      <TableCell sx={BODY_CELL_SX}>
        <TextField
          size="small"
          sx={FIELD_SX}
          value={y}
          disabled={disabled}
          onChange={(event) => {
            setY(event.target.value);
            onChange(point.id, { y: parseCoord(event.target.value) + originY });
          }}
        />
      </TableCell>
    </TableRow>
  );
}
const CaptureRow = memo(CaptureRowImpl);

type Props = {
  points: FreePoint[];
  disabled: boolean;
  stageReady: boolean;
  /** Relocation-centre origin (absolute mm) for centre-relative display; null = show absolute. */
  origin?: { x: number; y: number } | null;
  /** Add Point: append the current stage position (the reticle centre) — no move, no camera click. */
  onCapture: () => void;
  onUpdate: (id: string, patch: Partial<FreePoint>) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
};

function HorizontalCaptureFormImpl({
  points,
  disabled,
  stageReady,
  origin = null,
  onCapture,
  onUpdate,
  onDelete,
  onClear,
}: Props) {
  const originX = origin?.x ?? 0;
  const originY = origin?.y ?? 0;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveSelectedId = useMemo(
    () => (points.some((point) => point.id === selectedId) ? selectedId : null),
    [points, selectedId]
  );

  const handleDeleteSelected = useCallback(() => {
    if (effectiveSelectedId) onDelete(effectiveSelectedId);
  }, [effectiveSelectedId, onDelete]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).tagName === 'INPUT') return;
      if (points.length === 0) return;
      const currentIndex = points.findIndex((point) => point.id === effectiveSelectedId);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = currentIndex < 0 ? 0 : Math.min(points.length - 1, currentIndex + 1);
        setSelectedId(points[next].id);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prev = currentIndex < 0 ? points.length - 1 : Math.max(0, currentIndex - 1);
        setSelectedId(points[prev].id);
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && effectiveSelectedId) {
        event.preventDefault();
        onDelete(effectiveSelectedId);
      }
    },
    [points, effectiveSelectedId, onDelete]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <LiveReferenceReadout originX={originX} originY={originY} />

      <Box sx={BTN_ROW_SX}>
        {/* Add Point = capture the current stage position (the reticle centre).
            No stage move, no camera click — stores exactly what the readout shows. */}
        <Button
          variant="contained"
          color="primary"
          size="small"
          sx={BTN_SX}
          startIcon={<AddLocationAltIcon />}
          disabled={disabled || !stageReady}
          onClick={onCapture}
        >
          Add Point
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={disabled || !effectiveSelectedId}
          onClick={handleDeleteSelected}
        >
          Delete
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={disabled || points.length === 0}
          onClick={onClear}
        >
          Clear
        </Button>
        {!stageReady ? <Typography sx={HINT_SX}>Stage position unknown — connect/home to capture.</Typography> : null}
      </Box>

      <TableContainer sx={TABLE_WRAP_SX} tabIndex={0} onKeyDown={handleKeyDown}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={HEAD_CELL_SX}>Point</TableCell>
              <TableCell sx={HEAD_CELL_SX}>X (mm)</TableCell>
              <TableCell sx={HEAD_CELL_SX}>Y (mm)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {points.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} sx={EMPTY_CELL_SX}>
                  No reference points. Move the stage so the feature is under the reticle, then Add Point.
                </TableCell>
              </TableRow>
            ) : (
              points.map((point, index) => (
                <CaptureRow
                  key={point.id}
                  point={point}
                  index={index}
                  selected={point.id === effectiveSelectedId}
                  disabled={disabled}
                  originX={originX}
                  originY={originY}
                  onSelect={setSelectedId}
                  onChange={onUpdate}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export default memo(HorizontalCaptureFormImpl);
