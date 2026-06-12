import { memo, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
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
import { compositeLinePointCount } from '@/utils/patternGeneration';
import type { CompositeLine, CompositeMove } from '@/types/patternProgram';

const MOVE_OPTIONS: CompositeMove[] = ['Horizontal', 'Vertical', 'Diagonal', 'Custom'];

const BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 88 };
const HEADER_SX: SxProps<Theme> = { fontSize: 12, fontWeight: 600, color: 'text.secondary', mt: 0.5 };
const HINT_SX: SxProps<Theme> = { fontSize: 11, color: 'text.disabled' };
const TABLE_WRAP_SX: SxProps<Theme> = { maxHeight: 180, border: 1, borderColor: 'divider' };
const HEAD_CELL_SX: SxProps<Theme> = { fontSize: 11, fontWeight: 600, color: 'text.secondary', py: 0.5, px: 1 };
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.25, px: 1 };
const EMPTY_CELL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 3 };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '88px 1fr 88px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const FIELD_SX: SxProps<Theme> = { '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } };

type Props = {
  lines: CompositeLine[];
  disabled: boolean;
  onAddLine: () => void;
  onUpdateLine: (id: string, patch: Partial<CompositeLine>) => void;
  onDeleteLine: (id: string) => void;
  onMoveLine: (id: string, direction: 'up' | 'down') => void;
};

// MultiLine Composite form: a line table (Line No | Move | start X/Y) plus a
// configuration panel for the selected line. Each line is an independent
// Start→End/Move/Interval definition; generation concatenates them in order.
function MultiLineCompositeFormImpl({
  lines,
  disabled,
  onAddLine,
  onUpdateLine,
  onDeleteLine,
  onMoveLine,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Selection derives against the live list so delete/reset can't strand it.
  const selected = useMemo(
    () => lines.find((line) => line.id === selectedId) ?? null,
    [lines, selectedId]
  );
  const selectedIndex = selected ? lines.findIndex((line) => line.id === selected.id) : -1;
  const pointCount = selected ? compositeLinePointCount(selected) : 0;

  const commit = (field: keyof CompositeLine, raw: string) => {
    if (!selected) return;
    onUpdateLine(selected.id, { [field]: toNumberOrNull(raw) ?? 0 } as Partial<CompositeLine>);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography sx={HEADER_SX}>MultiLine Composite</Typography>

      <Box sx={BTN_ROW_SX}>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={disabled} onClick={onAddLine}>
          Add Line
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={disabled || !selected}
          onClick={() => selected && onDeleteLine(selected.id)}
        >
          Delete
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={disabled || selectedIndex <= 0}
          onClick={() => selected && onMoveLine(selected.id, 'up')}
        >
          Move Up
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={disabled || selectedIndex < 0 || selectedIndex >= lines.length - 1}
          onClick={() => selected && onMoveLine(selected.id, 'down')}
        >
          Move Down
        </Button>
      </Box>

      <TableContainer sx={TABLE_WRAP_SX}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={HEAD_CELL_SX}>Line No</TableCell>
              <TableCell sx={HEAD_CELL_SX}>Move</TableCell>
              <TableCell sx={HEAD_CELL_SX}>X (mm)</TableCell>
              <TableCell sx={HEAD_CELL_SX}>Y (mm)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} sx={EMPTY_CELL_SX}>No lines. Use Add Line.</TableCell>
              </TableRow>
            ) : (
              lines.map((line, index) => (
                <TableRow
                  key={line.id}
                  hover
                  selected={line.id === selectedId}
                  onClick={() => setSelectedId(line.id)}
                >
                  <TableCell sx={BODY_CELL_SX}>{index + 1}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{line.move}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{line.startX}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{line.startY}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {selected ? (
        // key remounts the uncontrolled inputs when the selected line changes so
        // each field reseeds from that line's stored value.
        <Box key={selected.id} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography sx={HEADER_SX}>{`Line ${selectedIndex + 1} configuration`}</Typography>

          <Box sx={TWO_COL_SX}>
            <Typography sx={LABEL_SX}>Move</Typography>
            <FormControl size="small">
              <Select
                value={selected.move}
                disabled={disabled}
                onChange={(event) => onUpdateLine(selected.id, { move: event.target.value as CompositeMove })}
              >
                {MOVE_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>{option}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography sx={LABEL_SX}>Interval</Typography>
            <TextField size="small" sx={FIELD_SX} defaultValue={String(selected.interval)} disabled={disabled}
              onChange={(event) => commit('interval', event.target.value)} />
          </Box>

          <Box sx={TWO_COL_SX}>
            <Typography sx={LABEL_SX}>Start X</Typography>
            <TextField size="small" sx={FIELD_SX} defaultValue={String(selected.startX)} disabled={disabled}
              onChange={(event) => commit('startX', event.target.value)} />
            <Typography sx={LABEL_SX}>Start Y</Typography>
            <TextField size="small" sx={FIELD_SX} defaultValue={String(selected.startY)} disabled={disabled}
              onChange={(event) => commit('startY', event.target.value)} />
          </Box>

          <Box sx={TWO_COL_SX}>
            <Typography sx={LABEL_SX}>End X</Typography>
            <TextField size="small" sx={FIELD_SX} defaultValue={String(selected.endX)} disabled={disabled}
              onChange={(event) => commit('endX', event.target.value)} />
            <Typography sx={LABEL_SX}>End Y</Typography>
            <TextField size="small" sx={FIELD_SX} defaultValue={String(selected.endY)} disabled={disabled}
              onChange={(event) => commit('endY', event.target.value)} />
          </Box>

          <Box sx={TWO_COL_SX}>
            <Typography sx={LABEL_SX}>First Offset</Typography>
            <TextField size="small" sx={FIELD_SX} defaultValue={String(selected.firstOffset)} disabled={disabled}
              onChange={(event) => commit('firstOffset', event.target.value)} />
            <Typography sx={LABEL_SX}>Offset</Typography>
            <TextField size="small" sx={FIELD_SX} defaultValue={String(selected.offset)} disabled={disabled}
              onChange={(event) => commit('offset', event.target.value)} />
          </Box>

          <Typography sx={HINT_SX}>
            {`Points on this line: ${pointCount} (End axis drives extent; Interval drives spacing).`}
          </Typography>
        </Box>
      ) : (
        <Typography sx={HINT_SX}>Select a line to edit its Start, End, Move and Interval.</Typography>
      )}
    </Box>
  );
}

export default memo(MultiLineCompositeFormImpl);
