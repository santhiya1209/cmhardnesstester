import { memo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import type { SxProps, Theme } from '@mui/material/styles';
import { toNumberOrNull } from '@/utils/inputNumber';
import type { FreePoint, PatternGenerationRequest } from '@/types/patternProgram';
import ReferenceSlotRow from './ReferenceSlotRow';

const HEADER_SX: SxProps<Theme> = { fontSize: 12, fontWeight: 600, color: 'text.secondary', mt: 0.5 };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 96px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const HINT_SX: SxProps<Theme> = { fontSize: 11, color: 'text.disabled' };
const FIELD_SX: SxProps<Theme> = { '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } };
const ADD_BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, alignSelf: 'flex-start' };

// Equidistant always presents at least Reference Point 1 and 2; "Add Point"
// appends more. The hook seeds two slots on mode entry, so in practice `refs`
// already has ≥ 2 — the padding here only guards a freshly-loaded program that
// somehow carried fewer.
const MIN_SLOTS = 2;

type Props = {
  config: PatternGenerationRequest;
  disabled: boolean;
  stageReady: boolean;
  multiset: boolean;
  onCaptureReference: (slot: number) => void;
  onReferenceChange: (slot: number, patch: Partial<FreePoint>) => void;
  onAddReference: () => void;
  onConfigChange: (patch: Partial<PatternGenerationRequest>) => void;
};

function EquidistantMultipointFormImpl({
  config,
  disabled,
  stageReady,
  multiset,
  onCaptureReference,
  onReferenceChange,
  onAddReference,
  onConfigChange,
}: Props) {
  const refs = config.referencePoints ?? [];
  const slots: FreePoint[] =
    refs.length >= MIN_SLOTS
      ? refs
      : [
          ...refs,
          ...Array.from({ length: MIN_SLOTS - refs.length }, (_, i) => ({
            id: `eq-pad-${refs.length + i}`,
            x: NaN,
            y: NaN,
          })),
        ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Typography sx={HEADER_SX}>Reference</Typography>

      {slots.map((pt, i) => (
        <ReferenceSlotRow
          key={pt.id}
          slot={i}
          label={`Reference Point ${i + 1}`}
          point={pt}
          disabled={disabled}
          canCapture={stageReady}
          onCapture={onCaptureReference}
          onChange={onReferenceChange}
        />
      ))}

      <Button
        size="small"
        variant="outlined"
        startIcon={<AddIcon fontSize="small" />}
        sx={ADD_BTN_SX}
        disabled={disabled}
        onClick={onAddReference}
      >
        Add Point
      </Button>

      <Typography sx={HINT_SX}>
        Type coordinates directly, or use the crosshair to capture the live stage position.
      </Typography>

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
        <Box sx={{ gridColumn: '3 / span 2' }}>
          <Typography sx={HINT_SX}>
            {multiset
              ? 'Multiset: each consecutive pair (P1→P2, P3→P4…) is its own equidistant line of "Number" points.'
              : 'Points are distributed equally along P1→P2→… ("Number" per segment, endpoints included).'}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

export default memo(EquidistantMultipointFormImpl);
