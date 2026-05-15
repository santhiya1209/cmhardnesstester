import { memo } from 'react';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const HV_DISPLAY_SX: SxProps<Theme> = {
  flex: 1,
  minWidth: 80,
  minHeight: 34,
  px: 1,
  py: 0.5,
  fontSize: 18,
  fontWeight: 800,
  letterSpacing: 0.3,
  color: 'primary.main',
  fontVariantNumeric: 'tabular-nums',
  border: 1,
  borderColor: 'divider',
  borderRadius: 0.5,
  bgcolor: 'background.paper',
  display: 'flex',
  alignItems: 'center',
};
const HV_FIELD_SX: SxProps<Theme> = {
  flex: 1,
  minWidth: 80,
  '& .MuiSelect-select': {
    fontWeight: 700,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  '& .MuiInputBase-root.Mui-disabled': {
    color: 'text.primary',
    bgcolor: 'background.paper',
  },
  '& .MuiSelect-select.Mui-disabled': {
    WebkitTextFillColor: 'var(--mui-palette-text-primary)',
  },
  '& .MuiSelect-icon.Mui-disabled': {
    color: 'text.secondary',
  },
};
const HARDNESS_DISPLAY_SX: SxProps<Theme> = {
  flex: 1,
  minWidth: 80,
  minHeight: 34,
  px: 1,
  py: 0.5,
  fontSize: 14,
  fontWeight: 600,
  color: 'text.primary',
  fontVariantNumeric: 'tabular-nums',
  border: 1,
  borderColor: 'divider',
  borderRadius: 0.5,
  bgcolor: 'background.paper',
  display: 'flex',
  alignItems: 'center',
};

type Props = {
  hvDisplay: string;
  hvType: string;
  hardnessDisplay: string;
  hvTypeOptions?: readonly string[];
  disabled?: boolean;
  readOnly?: boolean;
  onHvTypeChange?: (value: string) => void;
};

function HvSummaryRowImpl({
  hvDisplay,
  hvType,
  hardnessDisplay,
  hvTypeOptions = [],
  disabled = false,
  readOnly = false,
  onHvTypeChange,
}: Props) {
  const options = hvTypeOptions.includes(hvType) ? hvTypeOptions : [hvType, ...hvTypeOptions];

  return (
    <>
      <Typography sx={LABEL_SX}>HV</Typography>
      <Box sx={HV_DISPLAY_SX}>{hvDisplay}</Box>
      <FormControl size="small" sx={HV_FIELD_SX}>
        <Select
          value={hvType}
          disabled={disabled || readOnly}
          displayEmpty
          renderValue={(value) => {
            const v = (value as string | undefined) ?? '';
            return options.includes(v) ? v : 'HV';
          }}
          onChange={(event: SelectChangeEvent<string>) => {
            onHvTypeChange?.(event.target.value);
          }}
        >
          {options.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Box sx={HARDNESS_DISPLAY_SX}>{hardnessDisplay}</Box>
    </>
  );
}

export default memo(HvSummaryRowImpl);
