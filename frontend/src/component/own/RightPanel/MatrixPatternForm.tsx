import { memo, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { toNumberOrNull } from '@/utils/inputNumber';
import type { PatternGenerationRequest } from '@/types/patternProgram';

const REF_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 1fr', alignItems: 'center', gap: 1 };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 96px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
// Platform-frame display precision while tracking (matches the Position panel).
const REF_DP = 3;

// One editable reference axis. The reference is shown in the SAME frame as the XYZ
// Platform Position panel (physical center = 0, +Y up). While `tracking` (the
// operator has not typed a value yet) the field MIRRORS the live stage position;
// the first keystroke commits a value and the field becomes the operator's to edit
// freely (the parent flips `tracking` off, so the live sync stops). A local buffer
// keeps partial input ("-", "1.") from being clobbered by reformatting.
type RefAxisProps = {
  label: 'X' | 'Y';
  liveDisplay: number;
  tracking: boolean;
  disabled: boolean;
  onCommit: (text: string) => void;
};

function MatrixRefAxis({ label, liveDisplay, tracking, disabled, onCommit }: RefAxisProps) {
  const [text, setText] = useState<string>(() => liveDisplay.toFixed(REF_DP));
  useEffect(() => {
    if (tracking) setText(liveDisplay.toFixed(REF_DP));
  }, [tracking, liveDisplay]);
  return (
    <TextField
      size="small"
      label={label}
      value={text}
      disabled={disabled}
      onChange={(event) => {
        setText(event.target.value);
        onCommit(event.target.value);
      }}
    />
  );
}

type Props = {
  config: PatternGenerationRequest;
  disabled: boolean;
  /** Platform-frame reference value (physical-center relative, +Y up) shown while tracking. */
  referenceX: number;
  referenceY: number;
  /** True while the reference still mirrors the live stage (no value typed yet). */
  tracking: boolean;
  /** Commit a typed reference axis (display value → absolute mm + establish) in the hook. */
  onEditReference: (axis: 'x' | 'y', text: string) => void;
  onConfigChange: (patch: Partial<PatternGenerationRequest>) => void;
};

function MatrixPatternFormImpl({ config, disabled, referenceX, referenceY, tracking, onEditReference, onConfigChange }: Props) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={REF_ROW_SX}>
        <Typography sx={LABEL_SX}>Reference Point</Typography>
        <MatrixRefAxis label="X" liveDisplay={referenceX} tracking={tracking} disabled={disabled} onCommit={(text) => onEditReference('x', text)} />
        <MatrixRefAxis label="Y" liveDisplay={referenceY} tracking={tracking} disabled={disabled} onCommit={(text) => onEditReference('y', text)} />
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
