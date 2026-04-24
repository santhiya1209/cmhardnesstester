import { memo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import type { SxProps, Theme } from '@mui/material/styles';

const FORCE_OPTIONS = ['0.01kgf', '0.025kgf', '0.05kgf', '0.1kgf', '0.2kgf', '0.3kgf', '0.5kgf', '1kgf'];
const OBJECTIVE_OPTIONS = ['2.5X', '5X', '10X', '20X', '40X', '50X'];
const HARDNESS_LEVEL_OPTIONS = ['Low', 'Middle', 'High'];

const INDENTER_SECTION_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: '160px 1fr',
  gap: 1.5,
  px: 1.5,
  py: 1.5,
  alignItems: 'center',
};
const INDENT_BUTTON_SX: SxProps<Theme> = {
  width: 160,
  height: 90,
  textTransform: 'none',
  fontSize: 14,
  fontWeight: 500,
};
const INDENTER_RIGHT_SX: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: 1 };
const ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1 };
const FIELD_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary', width: 100, flexShrink: 0 };
const READONLY_VALUE_SX: SxProps<Theme> = {
  px: 1,
  py: 0.5,
  fontSize: 12,
  border: 1,
  borderColor: 'divider',
  borderRadius: 0.5,
  minWidth: 64,
  textAlign: 'center',
};
const LENS_BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, minWidth: 56, py: 0.25 };

const SETTINGS_GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto 1fr',
  rowGap: 1,
  columnGap: 1,
  alignItems: 'center',
  px: 1.5,
  py: 1.5,
  borderTop: 1,
  borderColor: 'divider',
};
const SETTING_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };

function MachineControlTabImpl() {
  const [force, setForce] = useState('0.5kgf');
  const [objective, setObjective] = useState('10X');
  const [hardnessLevel, setHardnessLevel] = useState('Middle');
  const [lightness, setLightness] = useState('5');
  const [loadTime, setLoadTime] = useState('5');
  const [activeLens, setActiveLens] = useState<'10X' | '40X'>('10X');

  return (
    <>
      <Box sx={INDENTER_SECTION_SX}>
        <Button variant="outlined" sx={INDENT_BUTTON_SX}>Indent</Button>

        <Box sx={INDENTER_RIGHT_SX}>
          <Box sx={ROW_SX}>
            <Typography sx={FIELD_LABEL_SX}>Indenter</Typography>
            <Typography sx={READONLY_VALUE_SX}>HV</Typography>
          </Box>
          <Box sx={ROW_SX}>
            <Typography sx={FIELD_LABEL_SX}>Objective Lens</Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant={activeLens === '10X' ? 'contained' : 'outlined'}
                size="small"
                sx={LENS_BTN_SX}
                onClick={() => setActiveLens('10X')}
              >
                10X
              </Button>
              <Button
                variant={activeLens === '40X' ? 'contained' : 'outlined'}
                size="small"
                sx={LENS_BTN_SX}
                onClick={() => setActiveLens('40X')}
              >
                40X
              </Button>
            </Stack>
          </Box>
        </Box>
      </Box>

      <Divider />

      <Box sx={SETTINGS_GRID_SX}>
        <Typography sx={SETTING_LABEL_SX}>Force</Typography>
        <FormControl size="small">
          <Select value={force} onChange={(e: SelectChangeEvent) => setForce(e.target.value)}>
            {FORCE_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>{o}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography sx={SETTING_LABEL_SX}>Lightness</Typography>
        <TextField size="small" type="number" value={lightness} onChange={(e) => setLightness(e.target.value)} />

        <Typography sx={SETTING_LABEL_SX}>Objective</Typography>
        <FormControl size="small">
          <Select value={objective} onChange={(e: SelectChangeEvent) => setObjective(e.target.value)}>
            {OBJECTIVE_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>{o}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography sx={SETTING_LABEL_SX}>Load Time(s)</Typography>
        <TextField size="small" type="number" value={loadTime} onChange={(e) => setLoadTime(e.target.value)} />

        <Typography sx={SETTING_LABEL_SX}>Hardness Level</Typography>
        <FormControl size="small">
          <Select value={hardnessLevel} onChange={(e: SelectChangeEvent) => setHardnessLevel(e.target.value)}>
            {HARDNESS_LEVEL_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>{o}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box />
        <Box />
      </Box>
    </>
  );
}

export default memo(MachineControlTabImpl);
