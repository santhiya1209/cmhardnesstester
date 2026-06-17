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

// Reference X/Y are READ-ONLY and shown in the SAME frame as the XYZ Platform
// Position panel (physical center = 0, +X right, +Y up — no sign flip), at a fixed
// 5 dp. Until the operator picks a reference on the camera, the field TRACKS the
// live stage position (so it reads identically to the Platform); after a pick it
// shows the picked location. The hook (useMultipoint.referenceDisplay) already
// resolves + normalizes the value — the form only formats it.
const REF_DP = 5;

type Props = {
  config: PatternGenerationRequest;
  disabled: boolean;
  stageReady: boolean;
  /** True while THIS form's reference camera-pick is in flight (waiting for a click). */
  picking: boolean;
  /** Live, Platform-frame reference value (physical-center relative, +Y up). */
  referenceX: number;
  referenceY: number;
  /** Enter camera point-selection to set the reference from a click (overrides live tracking). */
  onBeginPick: () => void;
  /** Cancel an in-flight reference pick. */
  onCancelPick: () => void;
  onConfigChange: (patch: Partial<PatternGenerationRequest>) => void;
};

function LinearPatternFormImpl({ config, disabled, stageReady, picking, referenceX, referenceY, onBeginPick, onCancelPick, onConfigChange }: Props) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={REF_ROW_SX}>
        <Typography sx={LABEL_SX}>Reference Point</Typography>
        <TextField
          size="small"
          label="X"
          value={referenceX.toFixed(REF_DP)}
          slotProps={{ input: { readOnly: true } }}
        />
        <TextField
          size="small"
          label="Y"
          value={referenceY.toFixed(REF_DP)}
          slotProps={{ input: { readOnly: true } }}
        />
        {/* Add Point = enter camera point-selection; the next camera click sets the
            reference (no stage-position capture, no typing). Click again to cancel. */}
        <Tooltip title={picking ? 'Cancel — Select Reference Point on camera' : stageReady ? 'Add Point — pick the reference on the live camera' : 'Stage position unknown'}>
          <span>
            <IconButton
              size="small"
              color={picking ? 'warning' : 'primary'}
              disabled={!picking && (disabled || !stageReady)}
              onClick={picking ? onCancelPick : onBeginPick}
            >
              <MyLocationIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      {picking ? <Typography sx={{ ...LABEL_SX, color: 'warning.main' }}>Select Reference Point — click the feature in the live camera.</Typography> : null}

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
