import { memo } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import type { SxProps, Theme } from '@mui/material/styles';
import { toNumberOrNull } from '@/utils/inputNumber';
import type { PatternGenerationRequest } from '@/types/patternProgram';

const REF_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 1fr auto', alignItems: 'center', gap: 1 };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 96px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };

// Reference fields seed from the captured value. An un-captured reference reads as
// a clean "0.00000"; a captured one shows its exact coordinate. (Uncontrolled
// inputs — this only seeds the initial text; the remount on capture re-seeds it.)
function formatRef(value: number | null): string {
  return value != null && Number.isFinite(value) && value !== 0 ? String(value) : '0.00000';
}

type Props = {
  config: PatternGenerationRequest;
  disabled: boolean;
  stageReady: boolean;
  onCapture: () => void;
  onConfigChange: (patch: Partial<PatternGenerationRequest>) => void;
};

function LinearPatternFormImpl({ config, disabled, stageReady, onCapture, onConfigChange }: Props) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={REF_ROW_SX}>
        <Typography sx={LABEL_SX}>Reference Point</Typography>
        <TextField
          size="small"
          label="X"
          defaultValue={formatRef(config.refX)}
          disabled={disabled}
          onChange={(event) => onConfigChange({ refX: toNumberOrNull(event.target.value) })}
        />
        <TextField
          size="small"
          label="Y"
          defaultValue={formatRef(config.refY)}
          disabled={disabled}
          onChange={(event) => onConfigChange({ refY: toNumberOrNull(event.target.value) })}
        />
        <Tooltip title={stageReady ? 'Add point from current stage position' : 'Stage position unknown'}>
          <span>
            <IconButton size="small" color="primary" disabled={disabled || !stageReady} onClick={onCapture}>
              <MyLocationIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>Interval</Typography>
        <TextField
          size="small"
          defaultValue={config.interval ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ interval: toNumberOrNull(event.target.value) })}
        />
        <Typography sx={LABEL_SX}>Offset</Typography>
        <TextField
          size="small"
          defaultValue={config.offset ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ offset: toNumberOrNull(event.target.value) })}
        />
      </Box>

      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>First Offset</Typography>
        <TextField
          size="small"
          defaultValue={config.firstOffset ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ firstOffset: toNumberOrNull(event.target.value) })}
        />
        <Typography sx={LABEL_SX}>Number</Typography>
        <TextField
          size="small"
          type="number"
          defaultValue={config.number ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ number: toNumberOrNull(event.target.value) })}
        />
      </Box>
    </Box>
  );
}

export default memo(LinearPatternFormImpl);
