import { memo } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { toNumberOrNull } from '@/utils/inputNumber';
import type { PatternGenerationRequest } from '@/types/patternProgram';

const REF_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 1fr', alignItems: 'center', gap: 1 };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 96px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };

type Props = {
  config: PatternGenerationRequest;
  disabled: boolean;
  onConfigChange: (patch: Partial<PatternGenerationRequest>) => void;
};

function MatrixPatternFormImpl({ config, disabled, onConfigChange }: Props) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={REF_ROW_SX}>
        <Typography sx={LABEL_SX}>Reference Point</Typography>
        <TextField
          size="small"
          label="X"
          defaultValue={config.refX ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ refX: toNumberOrNull(event.target.value) })}
        />
        <TextField
          size="small"
          label="Y"
          defaultValue={config.refY ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ refY: toNumberOrNull(event.target.value) })}
        />
      </Box>

      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>Interval X</Typography>
        <TextField
          size="small"
          defaultValue={config.interval ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ interval: toNumberOrNull(event.target.value) })}
        />
        <Typography sx={LABEL_SX}>Interval Y</Typography>
        <TextField
          size="small"
          defaultValue={config.intervalY ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ intervalY: toNumberOrNull(event.target.value) })}
        />
      </Box>

      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>Rows</Typography>
        <TextField
          size="small"
          type="number"
          defaultValue={config.rows ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ rows: toNumberOrNull(event.target.value) })}
        />
        <Typography sx={LABEL_SX}>Columns</Typography>
        <TextField
          size="small"
          type="number"
          defaultValue={config.columns ?? ''}
          disabled={disabled}
          onChange={(event) => onConfigChange({ columns: toNumberOrNull(event.target.value) })}
        />
      </Box>
    </Box>
  );
}

export default memo(MatrixPatternFormImpl);
