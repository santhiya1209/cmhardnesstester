import { memo } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import type { SxProps, Theme } from '@mui/material/styles';
import { toNumberOrNull } from '@/utils/inputNumber';
import { normalizeCoordinate } from '@/utils/coordinate';
import type { PatternGenerationRequest } from '@/types/patternProgram';

const REF_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 1fr auto', alignItems: 'center', gap: 1 };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 96px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };

// The reference fields are READ-ONLY and shown CENTRE-RELATIVE (value − relocation
// origin) at a fixed 5 dp — the same frame and precision the legacy software used,
// so a centre pick reads "0.00000 / -0.00007"-style. The stored refX/refY stay
// ABSOLUTE full precision (generation reads those); this is display-only. An
// un-established reference (still the 0,0 placeholder) shows "0.00000". The real
// computed value is never snapped to zero beyond ordinary 5 dp rounding. The
// operator never types the reference — it comes only from a camera click.
const REF_DP = 5;
// `sign` applies the operator's DISPLAY axis convention: right = +X (sign +1),
// up = −Y (sign −1, image frame). The STORED refX/refY stay in the STAGE frame
// (+Y = up) — that drives stage motion and the overlay marker — so the negation is
// display-only and never touches what generation/moveToPoint consume.
function formatRef(value: number | null, origin: number, established: boolean, sign: number): string {
  if (!established || value == null || !Number.isFinite(value)) return (0).toFixed(REF_DP);
  // Snap sub-tolerance residue and -0 to a clean 0 so a centre pick reads
  // 0.00000, never -0.00007, while real off-centre values keep full precision.
  return normalizeCoordinate(sign * (value - origin)).toFixed(REF_DP);
}

type Props = {
  config: PatternGenerationRequest;
  disabled: boolean;
  stageReady: boolean;
  /** True while THIS form's reference camera-pick is in flight (waiting for a click). */
  picking: boolean;
  /** True once a reference has been picked/loaded — gates the placeholder vs the real value. */
  picked: boolean;
  /** Relocation-centre origin (absolute mm) so the readout is centre-relative; 0 if no relocation. */
  originX: number;
  originY: number;
  /** Enter camera point-selection to set the reference from a click (NOT stage position). */
  onBeginPick: () => void;
  /** Cancel an in-flight reference pick. */
  onCancelPick: () => void;
  onConfigChange: (patch: Partial<PatternGenerationRequest>) => void;
};

function LinearPatternFormImpl({ config, disabled, stageReady, picking, picked, originX, originY, onBeginPick, onCancelPick, onConfigChange }: Props) {
  // "Established" = a real reference exists (picked this session, or loaded with a
  // non-placeholder absolute coordinate). Until then the centre-relative readout
  // would show −origin, so the un-set state shows a clean 0.00000 instead.
  const established = picked || (config.refX ?? 0) !== 0 || (config.refY ?? 0) !== 0;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={REF_ROW_SX}>
        <Typography sx={LABEL_SX}>Reference Point</Typography>
        <TextField
          size="small"
          label="X"
          value={formatRef(config.refX, originX, established, 1)}
          slotProps={{ input: { readOnly: true } }}
        />
        <TextField
          size="small"
          label="Y"
          value={formatRef(config.refY, originY, established, -1)}
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
