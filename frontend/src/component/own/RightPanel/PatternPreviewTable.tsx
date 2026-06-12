import { memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import type { PatternPoint } from '@/types/patternProgram';

const HEADER_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 };
const HEADER_SX: SxProps<Theme> = { fontSize: 12, fontWeight: 600, color: 'text.secondary' };
const BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1 };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.25, minWidth: 96 };
const TABLE_WRAP_SX: SxProps<Theme> = { maxHeight: 220, border: 1, borderColor: 'divider' };
const HEAD_CELL_SX: SxProps<Theme> = { fontSize: 11, fontWeight: 600, color: 'text.secondary', py: 0.5, px: 1 };
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.25, px: 1 };
const EMPTY_CELL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 4 };

type Props = {
  points: PatternPoint[];
  selectedIds: string[];
  onToggleSelect: (id: string, selected: boolean) => void;
  onToggleSelectAll: (selected: boolean) => void;
  onDeleteSelected: () => void;
  onClear: () => void;
};

function PatternPreviewTableImpl({
  points,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onDeleteSelected,
  onClear,
}: Props) {
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = points.length > 0 && selectedIds.length === points.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={HEADER_ROW_SX}>
        <Typography sx={HEADER_SX}>
          {`Preview (${points.length} point${points.length === 1 ? '' : 's'}, ${selectedIds.length} selected)`}
        </Typography>
        <Box sx={BTN_ROW_SX}>
          <Button
            variant="outlined"
            size="small"
            sx={BTN_SX}
            disabled={selectedIds.length === 0}
            onClick={onDeleteSelected}
          >
            Delete Selected
          </Button>
          <Button variant="outlined" size="small" sx={BTN_SX} disabled={points.length === 0} onClick={onClear}>
            Clear All
          </Button>
        </Box>
      </Box>

      <TableContainer sx={TABLE_WRAP_SX}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={HEAD_CELL_SX} padding="checkbox">
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={someSelected}
                  disabled={points.length === 0}
                  onChange={(event) => onToggleSelectAll(event.target.checked)}
                />
              </TableCell>
              <TableCell sx={HEAD_CELL_SX}>Line</TableCell>
              <TableCell sx={HEAD_CELL_SX}>No</TableCell>
              <TableCell sx={HEAD_CELL_SX}>X (mm)</TableCell>
              <TableCell sx={HEAD_CELL_SX}>Y (mm)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {points.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} sx={EMPTY_CELL_SX}>No generated points. Use Generate to preview.</TableCell>
              </TableRow>
            ) : (
              points.map((point) => (
                <TableRow key={point.id} selected={selected.has(point.id)}>
                  <TableCell sx={BODY_CELL_SX} padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selected.has(point.id)}
                      onChange={(event) => onToggleSelect(point.id, event.target.checked)}
                    />
                  </TableCell>
                  <TableCell sx={BODY_CELL_SX}>{point.line ?? '-'}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{point.no}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{point.x.toFixed(3)}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{point.y.toFixed(3)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export default memo(PatternPreviewTableImpl);
