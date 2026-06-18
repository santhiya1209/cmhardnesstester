import { memo, useCallback, useMemo, useState, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import type { SxProps, Theme } from '@mui/material/styles';
import type { FreePoint } from '@/types/patternProgram';
import type { CameraPointPhase, CameraPointTarget } from '@/types/multipoint';

// Reference readout matches LinearPatternForm: read-only, physical-center frame
// (+Y up), fixed 5 dp; tracks the live stage until a pick. Free Mode's reference is
// an OPTIONAL visual datum — it does NOT affect the freePoints-only point list.
const REF_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 1fr auto', alignItems: 'center', gap: 1 };
const REF_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const REF_DP = 5;
const BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const HINT_SX: SxProps<Theme> = { fontSize: 11, color: 'text.disabled' };
const TABLE_WRAP_SX: SxProps<Theme> = { maxHeight: 240, border: 1, borderColor: 'divider', borderRadius: 0 };
const HEAD_CELL_SX: SxProps<Theme> = { fontSize: 11, fontWeight: 600, color: 'text.secondary', py: 0.5, px: 1 };
const BODY_CELL_SX: SxProps<Theme> = { fontSize: 12, py: 0.25, px: 1 };
const EMPTY_CELL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.disabled', textAlign: 'center', py: 4 };
const FIELD_SX: SxProps<Theme> = { '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } };

function parseCoord(text: string): number {
  // Empty / unparseable → NaN so the generation engine's Number.isFinite guard
  // reports the incomplete point; the field keeps the operator's raw text via
  // the local buffer below. (Matches CaseDepthPatternForm.)
  const trimmed = text.trim();
  if (trimmed === '') return Number.NaN;
  const value = Number(trimmed);
  return Number.isNaN(value) ? Number.NaN : value;
}

type RowProps = {
  point: FreePoint;
  index: number;
  selected: boolean;
  disabled: boolean;
  /** Relocation-centre origin (absolute mm). Cells DISPLAY value − origin so a
   *  camera-clicked point reads relative to the centre; stored values stay absolute. */
  originX: number;
  originY: number;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<FreePoint>) => void;
};

// Local string buffers keep typing/clearing smooth while committing parsed
// numbers to the Redux config on every change. Keyed by point id in the parent,
// so the buffer reseeds from the captured/loaded coordinate on Load/Reset. The
// buffer holds the CENTRE-RELATIVE value (absolute − origin); edits add the origin
// back before committing so the stored coordinate remains absolute.
function FreePointRowImpl({ point, index, selected, disabled, originX, originY, onSelect, onChange }: RowProps) {
  const [x, setX] = useState(Number.isFinite(point.x) ? String(point.x - originX) : '');
  const [y, setY] = useState(Number.isFinite(point.y) ? String(point.y - originY) : '');

  return (
    <TableRow hover selected={selected} onClick={() => onSelect(point.id)}>
      <TableCell sx={BODY_CELL_SX}>{index + 1}</TableCell>
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

const FreePointRow = memo(FreePointRowImpl);

type Props = {
  points: FreePoint[];
  disabled: boolean;
  stageReady: boolean;
  /** Camera-click point-selection phase (drives the Add Point/Cancel button). */
  pickPhase?: CameraPointPhase;
  /** Which target an in-flight pick is for — disambiguates Add Point vs Set Reference. */
  pickTarget?: CameraPointTarget | null;
  /** Live, Platform-frame reference value (physical-center relative, +Y up). */
  referenceX?: number;
  referenceY?: number;
  /** Arm the reference camera-pick (optional visual datum). When omitted, the
   *  reference row is hidden (e.g. Vertical-Line-Free, which has no camera pick). */
  onPickReference?: () => void;
  /** Relocation-centre origin (absolute mm) for centre-relative table display; null = show absolute. */
  origin?: { x: number; y: number } | null;
  /** Manual blank-row add. Used as "Add Point" ONLY when camera pick is unavailable
   *  (e.g. Vertical-Line-Free, which has no camera pick). */
  onAddPoint?: () => void;
  onCapture: () => void;
  /** Arm camera-click point selection. When provided (Free/Midpoint), "Add Point"
   *  becomes the camera pick: crosshair → click → marker + row (no stage move). */
  onPickOnCamera?: () => void;
  /** Cancel an in-flight camera point selection. */
  onCancelPick?: () => void;
  onUpdate: (id: string, patch: Partial<FreePoint>) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
};

function FreePatternFormImpl({
  points,
  disabled,
  stageReady,
  pickPhase = 'idle',
  pickTarget = null,
  referenceX,
  referenceY,
  onPickReference,
  origin = null,
  onAddPoint,
  onCapture,
  onPickOnCamera,
  onCancelPick,
  onUpdate,
  onDelete,
  onClear,
}: Props) {
  // A pick can target the free-point list or the reference datum — keep the two
  // buttons' active/cancel state independent so only the armed one shows "Cancel".
  const pointPicking = pickPhase === 'selecting' && pickTarget === 'freePoint';
  const refPicking = pickPhase === 'selecting' && pickTarget === 'reference';
  const showReference = onPickReference != null && referenceX != null && referenceY != null;
  const originX = origin?.x ?? 0;
  const originY = origin?.y ?? 0;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Selection lives locally (screen-scoped UI state, per CLAUDE §10.6) but is
  // derived against the Redux point list, so resetMultipoint / clear implicitly
  // invalidate it — no stale selection survives a reset.
  const effectiveSelectedId = useMemo(
    () => (points.some((point) => point.id === selectedId) ? selectedId : null),
    [points, selectedId]
  );

  const handleDeleteSelected = useCallback(() => {
    if (effectiveSelectedId) onDelete(effectiveSelectedId);
  }, [effectiveSelectedId, onDelete]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // Don't hijack arrows/Delete while editing a cell.
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
      {/* Optional reference datum (Free/Midpoint). Read-only, tracks the live stage
          until a camera pick, then shows the picked location and draws the REF
          marker on the overlay. Does NOT affect the freePoints point list. */}
      {showReference ? (
        <>
          <Box sx={REF_ROW_SX}>
            <Typography sx={REF_LABEL_SX}>Reference Point</Typography>
            <TextField size="small" label="X" value={referenceX!.toFixed(REF_DP)} slotProps={{ input: { readOnly: true } }} />
            <TextField size="small" label="Y" value={referenceY!.toFixed(REF_DP)} slotProps={{ input: { readOnly: true } }} />
            <Tooltip title={refPicking ? 'Cancel — Select Reference Point on camera' : stageReady ? 'Set Reference — pick the datum on the live camera' : 'Stage position unknown'}>
              <span>
                <IconButton
                  size="small"
                  color={refPicking ? 'warning' : 'primary'}
                  disabled={pointPicking || (!refPicking && (disabled || !stageReady))}
                  onClick={refPicking ? onCancelPick : onPickReference}
                >
                  <MyLocationIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          {refPicking ? <Typography sx={{ ...REF_LABEL_SX, color: 'warning.main' }}>Select Reference Point — click the feature in the live camera.</Typography> : null}
        </>
      ) : null}

      <Box sx={BTN_ROW_SX}>
        {/* Add Point. With a camera pick available (Free/Midpoint) it arms the
            click selection: crosshair → click → compute the clicked LOCATION (no
            stage move) → yellow marker + table row. Without one (Vertical-Line-Free)
            it falls back to a manual blank row. */}
        {onPickOnCamera ? (
          <Button
            variant={pointPicking ? 'contained' : 'outlined'}
            color={pointPicking ? 'warning' : 'primary'}
            size="small"
            sx={BTN_SX}
            startIcon={<MyLocationIcon />}
            disabled={refPicking || (!pointPicking && (disabled || !stageReady))}
            onClick={pointPicking ? onCancelPick : onPickOnCamera}
          >
            {pointPicking ? 'Cancel' : 'Add Point'}
          </Button>
        ) : (
          <Button variant="outlined" size="small" sx={BTN_SX} disabled={disabled} onClick={onAddPoint}>
            Add Point
          </Button>
        )}
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={disabled || !stageReady}
          onClick={onCapture}
        >
          Capture Position
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
              <TableCell sx={HEAD_CELL_SX}>No.</TableCell>
              <TableCell sx={HEAD_CELL_SX}>X (mm)</TableCell>
              <TableCell sx={HEAD_CELL_SX}>Y (mm)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {points.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} sx={EMPTY_CELL_SX}>
                  No points. Use Add Point (click on the camera) or Capture Position.
                </TableCell>
              </TableRow>
            ) : (
              points.map((point, index) => (
                <FreePointRow
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

export default memo(FreePatternFormImpl);
