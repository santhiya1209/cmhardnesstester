import { memo } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import type { SxProps, Theme } from '@mui/material/styles';
import { toNumberOrNull } from '@/utils/inputNumber';
import type { FreePoint, PatternGenerationRequest } from '@/types/patternProgram';
import ReferenceSlotRow from './ReferenceSlotRow';

const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const FIELD_SX: SxProps<Theme> = { '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } };
const ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 0.5 };
const ADD_COL_SX: SxProps<Theme> = { width: 32, flexShrink: 0 };

// Equidistant always presents at least Reference Point 1 and 2; the inline "+"
// appends more. The hook seeds two slots on mode entry, so in practice `refs`
// already has ≥ 2 — the padding here only guards a freshly-loaded program that
// somehow carried fewer.
const MIN_SLOTS = 2;

type Props = {
  config: PatternGenerationRequest;
  disabled: boolean;
  stageReady: boolean;
  onCaptureReference: (slot: number) => void;
  onReferenceChange: (slot: number, patch: Partial<FreePoint>) => void;
  onAddReference: () => void;
  onConfigChange: (patch: Partial<PatternGenerationRequest>) => void;
};

function EquidistantMultipointFormImpl({
  config,
  disabled,
  stageReady,
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

      {slots.map((pt, i) => (
        <Box key={pt.id} sx={ROW_SX}>
          <Box sx={{ flex: 1 }}>
            <ReferenceSlotRow
              slot={i}
              label={i === 0 ? 'Reference' : ''}
              point={pt}
              disabled={disabled}
              canCapture={stageReady}
              onCapture={onCaptureReference}
              onChange={onReferenceChange}
            />
          </Box>
          <Box sx={ADD_COL_SX}>
            {i === 0 ? (
              <IconButton
                size="small"
                aria-label="Add reference point"
                title="Add reference point"
                disabled={disabled}
                onClick={onAddReference}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            ) : null}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export default memo(EquidistantMultipointFormImpl);
