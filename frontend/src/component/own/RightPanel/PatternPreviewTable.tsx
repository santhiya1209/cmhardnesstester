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
import ScatterPlotOutlinedIcon from '@mui/icons-material/ScatterPlotOutlined';
import NearMeOutlinedIcon from '@mui/icons-material/NearMeOutlined';
import type { SxProps, Theme } from '@mui/material/styles';
import type { MoveStatus, PatternPoint } from '@/types/patternProgram';

const HEADER_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 };
const HEADER_SX: SxProps<Theme> = { fontSize: 12, fontWeight: 600, color: 'text.secondary' };
const BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1 };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.25, minWidth: 96 };
const TABLE_WRAP_SX: SxProps<Theme> = { maxHeight: 220, border: 1, borderColor: 'divider' };
const HEAD_CELL_SX: SxProps<Theme> = { fontSize: 11, fontWeight: 600, color: 'text.secondary', py: 0.5, px: 1 };
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.25, px: 1 };
const EMPTY_CELL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 4 };
const GO_BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 11, py: 0, px: 1, minWidth: 48 };

const STATUS_COLOR: Record<MoveStatus, string> = {
  Pending: 'text.disabled',
  Moving: 'warning.main',
  Done: 'success.main',
  Failed: 'error.main',
};

// The table shows X/Y in the SAME centre-relative frame as the Reference Point
// readout (LinearPatternForm.formatRef): X = value − origin, Y = −(value − origin)
// (image frame: up = −Y). This is why Point 1 reads exactly like the Reference
// field. The stored point.x/point.y stay ABSOLUTE — "Go" and stage motion consume
// those, so the conversion is display-only.
function relX(value: number, originX: number): string {
  return (value - originX).toFixed(3);
}
function relY(value: number, originY: number): string {
  return (-(value - originY)).toFixed(3);
}

type Props = {
  points: PatternPoint[];
  /** Relocation-centre origin (absolute mm) so the readout is centre-relative; 0 if no relocation. */
  originX: number;
  originY: number;
  selectedIds: string[];
  activeId: string | null;
  completedIds: string[];
  failedIds: string[];
  busy: boolean;
  onGo: (point: PatternPoint) => void;
  onToggleSelect: (id: string, selected: boolean) => void;
  onToggleSelectAll: (selected: boolean) => void;
  onDeleteSelected: () => void;
  onClear: () => void;
};

function PatternPreviewTableImpl({
  points,
  originX,
  originY,
  selectedIds,
  activeId,
  completedIds,
  failedIds,
  busy,
  onGo,
  onToggleSelect,
  onToggleSelectAll,
  onDeleteSelected,
  onClear,
}: Props) {
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const completed = useMemo(() => new Set(completedIds), [completedIds]);
  const failed = useMemo(() => new Set(failedIds), [failedIds]);
  const allSelected = points.length > 0 && selectedIds.length === points.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  // Derive the per-row Move status from the execution markers (same source the
  // camera overlay uses): completed wins over a stale failure, then the live
  // active target, then any failure, else not yet run.
  const statusFor = (id: string): MoveStatus =>
    completed.has(id) ? 'Done' : id === activeId ? 'Moving' : failed.has(id) ? 'Failed' : 'Pending';

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
              <TableCell sx={HEAD_CELL_SX}>Move</TableCell>
              <TableCell sx={HEAD_CELL_SX}>Hardness</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {points.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={EMPTY_CELL_SX}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                    <ScatterPlotOutlinedIcon sx={{ fontSize: 32, color: 'text.disabled', opacity: 0.6 }} />
                    No generated points. Use Generate to preview.
                  </Box>
                </TableCell>
              </TableRow>
            ) : (
              points.map((point) => {
                const status = statusFor(point.id);
                return (
                  <TableRow key={point.id} selected={selected.has(point.id) || point.id === activeId}>
                    <TableCell sx={BODY_CELL_SX} padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selected.has(point.id)}
                        onChange={(event) => onToggleSelect(point.id, event.target.checked)}
                      />
                    </TableCell>
                    <TableCell sx={BODY_CELL_SX}>{point.line ?? '-'}</TableCell>
                    <TableCell sx={BODY_CELL_SX}>{point.no}</TableCell>
                    <TableCell sx={BODY_CELL_SX}>{relX(point.x, originX)}</TableCell>
                    <TableCell sx={BODY_CELL_SX}>{relY(point.y, originY)}</TableCell>
                    <TableCell sx={BODY_CELL_SX}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          sx={GO_BTN_SX}
                          startIcon={<NearMeOutlinedIcon sx={{ fontSize: 14 }} />}
                          disabled={busy}
                          onClick={() => onGo(point)}
                        >
                          Go
                        </Button>
                        <Typography sx={{ fontSize: 11, color: STATUS_COLOR[status] }}>{status}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={BODY_CELL_SX}>-</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export default memo(PatternPreviewTableImpl);
