import { memo } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { toNumberOrNull } from '@/utils/inputNumber';
import type { FreePoint, PatternGenerationRequest } from '@/types/patternProgram';
import ReferenceSlotRow from './ReferenceSlotRow';

const CENTER = 0;
const EDGE = 1;

const HEADER_SX: SxProps<Theme> = { fontSize: 12, fontWeight: 600, color: 'text.secondary', mt: 0.5 };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 96px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const HINT_SX: SxProps<Theme> = { fontSize: 11, color: 'text.disabled' };
const FIELD_SX: SxProps<Theme> = { '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } };

type Props = {
  config: PatternGenerationRequest;
  disabled: boolean;
  stageReady: boolean;
  onCaptureCircle: (slot: number) => void;
  onReferenceChange: (slot: number, patch: Partial<FreePoint>) => void;
  onConfigChange: (patch: Partial<PatternGenerationRequest>) => void;
};

// Circle Mode form. The circle is defined by its Center plus one Reference point
// on the circumference (radius = distance between them); `Number` indents are
// placed starting at `Angle`° and stepped by `Interval`° around it. Center/edge
// reuse the shared referencePoints capture rows ([0]=center, [1]=edge).
function CirclePatternFormImpl({
  config,
  disabled,
  stageReady,
  onCaptureCircle,
  onReferenceChange,
  onConfigChange,
}: Props) {
  const referencePoints = config.referencePoints ?? [];
  const center = referencePoints[CENTER];
  const edge = referencePoints[EDGE];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Typography sx={HEADER_SX}>Circle</Typography>

      <ReferenceSlotRow
        key={center?.id ?? 'center-empty'}
        slot={CENTER}
        label="Circle Center"
        point={center}
        disabled={disabled}
        canCapture={stageReady}
        onCapture={onCaptureCircle}
        onChange={onReferenceChange}
      />
      <ReferenceSlotRow
        key={edge?.id ?? 'edge-empty'}
        slot={EDGE}
        label="Reference"
        point={edge}
        disabled={disabled}
        canCapture={stageReady && center !== undefined}
        onCapture={onCaptureCircle}
        onChange={onReferenceChange}
      />

      {!stageReady ? (
        <Typography sx={HINT_SX}>Stage position unknown — connect/home the platform to capture.</Typography>
      ) : center === undefined ? (
        <Typography sx={HINT_SX}>Capture the Circle Center, then a Reference point on the rim to set the radius.</Typography>
      ) : null}

      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>Angle</Typography>
        <TextField
          size="small"
          sx={FIELD_SX}
          defaultValue={config.angle ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ angle: toNumberOrNull(event.target.value) })}
        />
        <Typography sx={LABEL_SX}>Interval</Typography>
        <TextField
          size="small"
          sx={FIELD_SX}
          defaultValue={config.interval ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ interval: toNumberOrNull(event.target.value) })}
        />
      </Box>

      <Box sx={TWO_COL_SX}>
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

export default memo(CirclePatternFormImpl);
