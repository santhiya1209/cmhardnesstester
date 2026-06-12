import { memo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import type { SxProps, Theme } from '@mui/material/styles';
import { toNumberOrNull } from '@/utils/inputNumber';
import type { FreePoint, PatternGenerationRequest } from '@/types/patternProgram';

const BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const INTERVAL_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 120px', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const HINT_SX: SxProps<Theme> = { fontSize: 11, color: 'text.disabled' };
const TABLE_WRAP_SX: SxProps<Theme> = { maxHeight: 240, border: 1, borderColor: 'divider', borderRadius: 0 };
const HEAD_CELL_SX: SxProps<Theme> = { fontSize: 11, fontWeight: 600, color: 'text.secondary', py: 0.5, px: 0.75 };
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.25, px: 0.75 };
const EMPTY_CELL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 4 };
const FIELD_SX: SxProps<Theme> = { '& .MuiInputBase-input': { fontSize: 12, py: 0.5, px: 0.75, width: 56 } };

// Empty / unparseable → NaN so the generation engine's Number.isFinite guard
// reports the incomplete cell; the field keeps the operator's raw text via the
// local buffer below. (Matches FreePatternForm / ReferenceSlotRow.)
function parseCoord(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return Number.NaN;
  const value = Number(trimmed);
  return Number.isNaN(value) ? Number.NaN : value;
}

type Trio = [FreePoint, FreePoint, FreePoint];

type RowProps = {
  row: number;
  trio: Trio;
  disabled: boolean;
  onUpdateCell: (row: number, pointInRow: number, patch: Partial<FreePoint>) => void;
  onDeleteRow: (row: number) => void;
};

// One table row = three reference points (P1, P2, P3). Six local string buffers
// keep typing/clearing smooth while committing parsed numbers to the Redux config
// on every change. The parent keys this row by P1's id (stable across cell edits),
// and remounts the whole form via `formKey` on Load/Reset so the buffers reseed.
function ThreePointRowImpl({ row, trio, disabled, onUpdateCell, onDeleteRow }: RowProps) {
  const seed = (value: number) => (Number.isFinite(value) ? String(value) : '');
  const [buf, setBuf] = useState<string[]>([
    seed(trio[0].x), seed(trio[0].y),
    seed(trio[1].x), seed(trio[1].y),
    seed(trio[2].x), seed(trio[2].y),
  ]);

  const handleChange = (cell: number, text: string) => {
    setBuf((prev) => prev.map((v, i) => (i === cell ? text : v)));
    const pointInRow = Math.floor(cell / 2);
    const axis = cell % 2 === 0 ? 'x' : 'y';
    onUpdateCell(row, pointInRow, { [axis]: parseCoord(text) });
  };

  return (
    <TableRow hover>
      <TableCell sx={BODY_CELL_SX}>{row + 1}</TableCell>
      {buf.map((value, cell) => (
        <TableCell key={cell} sx={BODY_CELL_SX}>
          <TextField
            size="small"
            sx={FIELD_SX}
            value={value}
            disabled={disabled}
            onChange={(event) => handleChange(cell, event.target.value)}
          />
        </TableCell>
      ))}
      <TableCell sx={BODY_CELL_SX}>
        <IconButton
          size="small"
          aria-label={`Delete row ${row + 1}`}
          title="Delete row"
          disabled={disabled}
          onClick={() => onDeleteRow(row)}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </TableCell>
    </TableRow>
  );
}

const ThreePointRow = memo(ThreePointRowImpl);

const HEADERS = ['No', 'X1(mm)', 'Y1(mm)', 'X2(mm)', 'Y2(mm)', 'X3(mm)', 'Y3(mm)'];

type Props = {
  config: PatternGenerationRequest;
  disabled: boolean;
  multiset: boolean;
  onAddRow: () => void;
  onUpdateCell: (row: number, pointInRow: number, patch: Partial<FreePoint>) => void;
  onDeleteRow: (row: number) => void;
  onClear: () => void;
  onConfigChange: (patch: Partial<PatternGenerationRequest>) => void;
};

function EquidistantThreePointFormImpl({
  config,
  disabled,
  multiset,
  onAddRow,
  onUpdateCell,
  onDeleteRow,
  onClear,
  onConfigChange,
}: Props) {
  const refs = config.referencePoints ?? [];
  const rows: Trio[] = [];
  // referencePoints stores three slots per row; a trailing partial group (e.g.
  // values carried over from another reference mode) is ignored here.
  for (let i = 0; i + 2 < refs.length; i += 3) {
    rows.push([refs[i], refs[i + 1], refs[i + 2]]);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={INTERVAL_ROW_SX}>
        <Typography sx={LABEL_SX}>Interval (mm)</Typography>
        <TextField
          size="small"
          type="number"
          sx={FIELD_SX}
          defaultValue={config.interval ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ interval: toNumberOrNull(event.target.value) })}
        />
      </Box>

      <Box sx={BTN_ROW_SX}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<AddIcon fontSize="small" />}
          sx={BTN_SX}
          disabled={disabled}
          onClick={onAddRow}
        >
          Add Row
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={disabled || rows.length === 0}
          onClick={onClear}
        >
          Clear
        </Button>
      </Box>

      <TableContainer sx={TABLE_WRAP_SX}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {HEADERS.map((header) => (
                <TableCell key={header} sx={HEAD_CELL_SX}>{header}</TableCell>
              ))}
              <TableCell sx={HEAD_CELL_SX} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={HEADERS.length + 1} sx={EMPTY_CELL_SX}>
                  No rows. Use Add Row to add a three-point entry.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((trio, index) => (
                <ThreePointRow
                  key={trio[0].id}
                  row={index}
                  trio={trio}
                  disabled={disabled}
                  onUpdateCell={onUpdateCell}
                  onDeleteRow={onDeleteRow}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography sx={HINT_SX}>
        {multiset
          ? 'Multiset: each row’s legs P1→P2 and P2→P3 are kept as separate segments.'
          : 'Each row is one chained path P1→P2→P3; points are spaced by Interval with the row’s endpoints always indented.'}
      </Typography>
    </Box>
  );
}

export default memo(EquidistantThreePointFormImpl);
