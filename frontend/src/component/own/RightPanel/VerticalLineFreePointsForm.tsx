import { memo } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import type { FreePoint } from '@/types/patternProgram';
import { arePointsVerticallyAligned } from '@/utils/patternGeneration';
import FreePatternForm from './FreePatternForm';

const HEADER_SX: SxProps<Theme> = { fontSize: 12, fontWeight: 600, color: 'text.secondary', mt: 0.5 };
const HINT_SX: SxProps<Theme> = { fontSize: 11, color: 'text.disabled' };
const OVERRIDE_SX: SxProps<Theme> = { '& .MuiFormControlLabel-label': { fontSize: 12 } };

type Props = {
  points: FreePoint[];
  disabled: boolean;
  stageReady: boolean;
  alignmentOverride: boolean;
  onAddPoint: () => void;
  onCapture: () => void;
  onUpdate: (id: string, patch: Partial<FreePoint>) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onAlignmentOverrideChange: (value: boolean) => void;
};

// Vertical Line Free Points form. The operator enters X and Y per row using the
// shared free-point editor; the only mode-specific behaviour is the vertical
// alignment guard — when the entered X values diverge, a warning offers an
// explicit override (the same flag `useMultipoint.generate` checks before it
// will generate). Generation itself sorts the points by ascending Y.
function VerticalLineFreePointsFormImpl({
  points,
  disabled,
  stageReady,
  alignmentOverride,
  onAddPoint,
  onCapture,
  onUpdate,
  onDelete,
  onClear,
  onAlignmentOverrideChange,
}: Props) {
  const misaligned = !arePointsVerticallyAligned(points);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography sx={HEADER_SX}>Vertical Line Free Points</Typography>
      <Typography sx={HINT_SX}>
        Enter X and Y for each point. X should stay constant; Generate runs them bottom→top (Y ascending).
      </Typography>

      <FreePatternForm
        points={points}
        disabled={disabled}
        stageReady={stageReady}
        onAddPoint={onAddPoint}
        onCapture={onCapture}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onClear={onClear}
      />

      {misaligned ? (
        <Alert severity="warning" sx={{ alignItems: 'center' }}>
          Points are not aligned vertically.
          <FormControlLabel
            sx={OVERRIDE_SX}
            control={
              <Checkbox
                size="small"
                checked={alignmentOverride}
                disabled={disabled}
                onChange={(event) => onAlignmentOverrideChange(event.target.checked)}
              />
            }
            label="Override alignment"
          />
        </Alert>
      ) : null}
    </Box>
  );
}

export default memo(VerticalLineFreePointsFormImpl);
