import { memo, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import type { SxProps, Theme } from '@mui/material/styles';
import { toNumberOrNull } from '@/utils/inputNumber';
import type { FreePoint, PatternGenerationRequest } from '@/types/patternProgram';

const ORIGIN = 0;
const DIRECTION = 1;

const HEADER_SX: SxProps<Theme> = { fontSize: 12, fontWeight: 600, color: 'text.secondary', mt: 0.5 };
const REF_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '110px 1fr 1fr 40px', alignItems: 'center', gap: 1 };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 96px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const HINT_SX: SxProps<Theme> = { fontSize: 11, color: 'text.disabled' };
const FIELD_SX: SxProps<Theme> = { '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } };

type Props = {
  config: PatternGenerationRequest;
  disabled: boolean;
  stageReady: boolean;
  onCaptureReference: (slot: typeof ORIGIN | typeof DIRECTION) => void;
  onReferenceChange: (slot: number, patch: Partial<FreePoint>) => void;
  onConfigChange: (patch: Partial<PatternGenerationRequest>) => void;
};

function parseCoord(text: string): number {
  // Empty / unparseable → NaN so the engine's Number.isFinite guard reports the
  // incomplete reference point; the field keeps the operator's raw text via the
  // local buffer below.
  const trimmed = text.trim();
  if (trimmed === '') return NaN;
  const value = Number(trimmed);
  return Number.isNaN(value) ? NaN : value;
}

type SlotProps = {
  slot: typeof ORIGIN | typeof DIRECTION;
  label: string;
  point: FreePoint | undefined;
  disabled: boolean;
  canCapture: boolean;
  onCapture: (slot: typeof ORIGIN | typeof DIRECTION) => void;
  onChange: (slot: number, patch: Partial<FreePoint>) => void;
};

// One fixed reference slot (Origin or Direction). Coordinates are captured from
// the stage; the X/Y fields fine-tune an already-captured point (local string
// buffers seeded from the point, so typing/clearing stays smooth). The row is
// keyed by point id upstream, so a fresh capture remounts it with new values.
function ReferenceSlotRowImpl({ slot, label, point, disabled, canCapture, onCapture, onChange }: SlotProps) {
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

const ReferenceSlotRow = memo(ReferenceSlotRowImpl);

function CaseDepthPatternFormImpl({
  config,
  disabled,
  stageReady,
  onCaptureReference,
  onReferenceChange,
  onConfigChange,
}: Props) {
  const referencePoints = config.referencePoints ?? [];
  const origin = referencePoints[ORIGIN];
  const direction = referencePoints[DIRECTION];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Typography sx={HEADER_SX}>Reference</Typography>

      <ReferenceSlotRow
        key={origin?.id ?? 'origin-empty'}
        slot={ORIGIN}
        label="Origin Point"
        point={origin}
        disabled={disabled}
        canCapture={stageReady}
        onCapture={onCaptureReference}
        onChange={onReferenceChange}
      />
      <ReferenceSlotRow
        key={direction?.id ?? 'direction-empty'}
        slot={DIRECTION}
        label="Direction Point"
        point={direction}
        disabled={disabled}
        canCapture={stageReady && origin !== undefined}
        onCapture={onCaptureReference}
        onChange={onReferenceChange}
      />

      {!stageReady ? (
        <Typography sx={HINT_SX}>Stage position unknown — connect/home the platform to capture.</Typography>
      ) : origin === undefined ? (
        <Typography sx={HINT_SX}>Capture the Origin point, then the Direction point, to set the traverse line.</Typography>
      ) : null}

      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>Interval</Typography>
        <TextField
          size="small"
          sx={FIELD_SX}
          defaultValue={config.interval ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ interval: toNumberOrNull(event.target.value) })}
        />
        <Typography sx={LABEL_SX}>Offset</Typography>
        <TextField
          size="small"
          sx={FIELD_SX}
          defaultValue={config.offset ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ offset: toNumberOrNull(event.target.value) })}
        />
      </Box>

      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>First Offset</Typography>
        <TextField
          size="small"
          sx={FIELD_SX}
          defaultValue={config.firstOffset ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ firstOffset: toNumberOrNull(event.target.value) })}
        />
        <Typography sx={LABEL_SX}>Number</Typography>
        <TextField
          size="small"
          type="number"
          sx={FIELD_SX}
          defaultValue={config.number ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ number: toNumberOrNull(event.target.value) })}
        />
      </Box>
    </Box>
  );
}

export default memo(CaseDepthPatternFormImpl);
