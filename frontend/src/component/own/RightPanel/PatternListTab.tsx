import { memo, useCallback, useMemo } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableContainer from '@mui/material/TableContainer';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useDeletePatternProgram } from '@/hooks/mutations/useDeletePatternProgram';
import { useSavePatternProgram } from '@/hooks/mutations/useSavePatternProgram';
import type { PatternProgram, PatternProgramPayload } from '@/types/patternProgram';

const COLUMNS = ['#', 'Pattern Name', 'Number Of Points', 'Checked'];

const SECTION_SX: SxProps<Theme> = { flex: 1, minHeight: 0, px: 1.5, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', overflowX: 'hidden' };
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
const STATUS_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 };
const STATUS_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };

type Props = {
  patternPrograms: PatternProgram[];
  patternProgramsError: string | null;
  patternProgramsLoading: boolean;
  refetchPatternPrograms: () => Promise<void>;
};

function toPayload(program: PatternProgram, checked: boolean): PatternProgramPayload {
  return {
    pattern: program.pattern,
    mode: program.mode,
    refX: program.refX,
    refY: program.refY,
    interval: program.interval,
    offset: program.offset,
    firstOffset: program.firstOffset,
    number: program.number,
    intervalY: program.intervalY,
    rows: program.rows,
    columns: program.columns,
    refX2: program.refX2,
    refY2: program.refY2,
    radius: program.radius,
    freePoints: program.freePoints,
    referencePoints: program.referencePoints,
    angle: program.angle,
    lines: program.lines ?? [],
    triangles: program.triangles ?? [],
    // Preserve persisted generated points on a checked-toggle re-save (omitting
    // them would let the backend default wipe the saved run list).
    points: program.points ?? [],
    multiset: program.multiset,
    focusAll: program.focusAll,
    impressMode: program.impressMode,
    checked,
  };
}

function PatternListTabImpl({
  patternPrograms,
  patternProgramsError,
  patternProgramsLoading,
  refetchPatternPrograms,
}: Props) {
  const { error: saveError, savePatternProgram, saving } = useSavePatternProgram();
  const { deleting, error: deleteError, removePatternProgram } = useDeletePatternProgram();

  const checkedPrograms = useMemo(
    () => patternPrograms.filter((program) => program.checked),
    [patternPrograms]
  );
  const errorMessage = patternProgramsError ?? saveError ?? deleteError;
  const isBusy = patternProgramsLoading || saving || deleting;

  const handleToggleChecked = useCallback(
    async (program: PatternProgram, checked: boolean) => {
      await savePatternProgram({
        id: program.id,
        values: toPayload(program, checked),
      });
      await refetchPatternPrograms();
    },
    [refetchPatternPrograms, savePatternProgram]
  );

  const handleDeleteChecked = useCallback(async () => {
    for (const program of checkedPrograms) {
      await removePatternProgram(program.id);
    }

    await refetchPatternPrograms();
  }, [checkedPrograms, refetchPatternPrograms, removePatternProgram]);

  const handleClear = useCallback(async () => {
    for (const program of patternPrograms) {
      await removePatternProgram(program.id);
    }

    await refetchPatternPrograms();
  }, [patternPrograms, refetchPatternPrograms, removePatternProgram]);

  return (
    <Box sx={SECTION_SX}>
      <TableContainer sx={TABLE_WRAP_SX}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {COLUMNS.map((column) => (
                <TableCell key={column} sx={HEAD_CELL_SX}>{column}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {patternPrograms.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} sx={EMPTY_CELL_SX}>No patterns</TableCell>
              </TableRow>
            ) : (
              patternPrograms.map((program, index) => (
                <TableRow key={program.id}>
                  <TableCell sx={BODY_CELL_SX}>{index + 1}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{program.patternName}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>{program.pointCount}</TableCell>
                  <TableCell sx={BODY_CELL_SX}>
                    <Checkbox
                      size="small"
                      checked={program.checked}
                      disabled={isBusy}
                      onChange={(event) => {
                        void handleToggleChecked(program, event.target.checked);
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={BTN_ROW_SX}>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={isBusy || checkedPrograms.length === 0}
          onClick={() => void handleDeleteChecked()}
        >
          Delete
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={isBusy || patternPrograms.length === 0}
          onClick={() => void handleClear()}
        >
          Clear
        </Button>
      </Box>

      <Box sx={STATUS_ROW_SX}>
        <Typography sx={STATUS_TEXT_SX}>
          {`${patternPrograms.length} program(s), ${checkedPrograms.length} checked.`}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isBusy ? <CircularProgress size={12} /> : null}
          <Typography sx={STATUS_TEXT_SX}>
            {patternProgramsLoading ? 'Loading pattern programs...' : 'Pattern list synced with backend.'}
          </Typography>
        </Box>
      </Box>

      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
    </Box>
  );
}

export default memo(PatternListTabImpl);
