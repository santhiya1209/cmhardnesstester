import { memo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableContainer from '@mui/material/TableContainer';
import type { SxProps, Theme } from '@mui/material/styles';

const COLUMNS = ['#', 'Pattern Name', 'Number Of Points', 'Checked'];
type Row = { id: number; name: string; points: number; checked: boolean };
const EMPTY_ROWS: Row[] = [];

const SECTION_SX: SxProps<Theme> = { px: 1.5, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1 };
const TABLE_WRAP_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 180,
  maxHeight: 260,
  border: 1,
  borderColor: 'divider',
};
const HEAD_CELL_SX: SxProps<Theme> = {
  fontSize: 11,
  fontWeight: 600,
  color: 'text.secondary',
  py: 0.5,
  px: 1,
  whiteSpace: 'nowrap',
};
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.5, px: 1 };
const EMPTY_CELL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 6 };
const BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1 };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };

function PatternListTabImpl() {
  return (
    <Box sx={SECTION_SX}>
      <TableContainer sx={TABLE_WRAP_SX}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {COLUMNS.map((c) => (
                <TableCell key={c} sx={HEAD_CELL_SX}>{c}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {EMPTY_ROWS.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} sx={EMPTY_CELL_SX}>No patterns</TableCell>
              </TableRow>
            ) : (
              EMPTY_ROWS.map((r) => (
                <TableRow key={r.id}>
                  <TableCell sx={BODY_CELL_SX}>{r.id}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.name}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{r.points}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>
                    <Checkbox size="small" checked={r.checked} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={BTN_ROW_SX}>
        <Button variant="outlined" size="small" sx={BTN_SX}>Delete</Button>
        <Button variant="outlined" size="small" sx={BTN_SX}>Clear</Button>
      </Box>
    </Box>
  );
}

export default memo(PatternListTabImpl);
