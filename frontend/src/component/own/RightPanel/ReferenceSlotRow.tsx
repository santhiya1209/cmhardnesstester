import { memo, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import type { SxProps, Theme } from '@mui/material/styles';
import type { FreePoint } from '@/types/patternProgram';

const REF_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '110px 1fr 1fr 40px', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const FIELD_SX: SxProps<Theme> = { '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } };

// Empty / unparseable → NaN so the generation engine's Number.isFinite guard
// reports the incomplete point; the field keeps the operator's raw text via the
// local buffers below.
function parseCoord(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return NaN;
  const value = Number(trimmed);
  return Number.isNaN(value) ? NaN : value;
}

type Props = {
  slot: number;
  label: string;
  point: FreePoint | undefined;
  disabled: boolean;
  canCapture: boolean;
  onCapture: (slot: number) => void;
  onChange: (slot: number, patch: Partial<FreePoint>) => void;
};

/**
 * One reference slot: coordinates are captured from the live stage via the
 * crosshair button; the X/Y fields fine-tune an already-captured point. Local
 * string buffers (seeded once from the point) keep typing/clearing smooth, and
 * the consumer keys this row by `point.id` so a fresh capture remounts it with
 * the new values — no controlled-input churn, no stale buffer.
 */
function ReferenceSlotRowImpl({ slot, label, point, disabled, canCapture, onCapture, onChange }: Props) {
  const [x, setX] = useState(point && Number.isFinite(point.x) ? String(point.x) : '');
  const [y, setY] = useState(point && Number.isFinite(point.y) ? String(point.y) : '');
  const editable = !disabled && point !== undefined;

  return (
    <Box sx={REF_ROW_SX}>
      <Typography sx={LABEL_SX}>{label}</Typography>
      <TextField
        size="small"
        label="X"
        sx={FIELD_SX}
        value={x}
        disabled={!editable}
        onChange={(event) => {
          setX(event.target.value);
          onChange(slot, { x: parseCoord(event.target.value) });
        }}
      />
      <TextField
        size="small"
        label="Y"
        sx={FIELD_SX}
        value={y}
        disabled={!editable}
        onChange={(event) => {
          setY(event.target.value);
          onChange(slot, { y: parseCoord(event.target.value) });
        }}
      />
      <IconButton
        size="small"
        aria-label={`Capture ${label} from stage`}
        title="Capture current stage position"
        disabled={disabled || !canCapture}
        onClick={() => onCapture(slot)}
      >
        <MyLocationIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

export default memo(ReferenceSlotRowImpl);
