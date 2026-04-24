import { memo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import AddIcon from '@mui/icons-material/Add';
import type { SxProps, Theme } from '@mui/material/styles';

const PATTERN_OPTIONS = ['Line', 'Rectangle', 'Circle', 'Custom'];
const MODE_OPTIONS = [
  'Horizontal Mode',
  'Vertical Mode',
  'Case Depth Mode',
  'Free Mode',
  'Matrix Mode',
  'Circle Mode',
  'Midpoint Mode',
  'Equidistant Multipoint Mode',
  'Equidistant Three Point Mode',
  'Equidistant Triangle Mode',
  'Multiline Composite Pattern',
  'Vertical Line Free Points Mode',
];

const SECTION_SX: SxProps<Theme> = { px: 1.5, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 };
const ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 1fr auto', alignItems: 'center', gap: 1 };
const TWO_COL_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '96px 1fr 96px 1fr', alignItems: 'center', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const BTN_ROW_SX: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'center' };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const OPTION_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' };
const RADIO_SX: SxProps<Theme> = { '& .MuiFormControlLabel-label': { fontSize: 12 } };
const ADD_BTN_SX: SxProps<Theme> = { border: 1, borderColor: 'divider', borderRadius: 0.5, p: 0.25 };

function MultipointTabImpl() {
  const [pattern, setPattern] = useState('Line');
  const [mode, setMode] = useState('Horizontal Mode');
  const [refX, setRefX] = useState('');
  const [refY, setRefY] = useState('');
  const [interval, setInterval] = useState('');
  const [offset, setOffset] = useState('');
  const [firstOffset, setFirstOffset] = useState('');
  const [number, setNumber] = useState('');
  const [multiset, setMultiset] = useState(false);
  const [focusAll, setFocusAll] = useState(false);
  const [impressMode, setImpressMode] = useState('indenting');

  return (
    <Box sx={SECTION_SX}>
      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>Pattern</Typography>
        <FormControl size="small">
          <Select value={pattern} onChange={(e: SelectChangeEvent) => setPattern(e.target.value)}>
            {PATTERN_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>{o}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography sx={LABEL_SX}>Mode</Typography>
        <FormControl size="small">
          <Select value={mode} onChange={(e: SelectChangeEvent) => setMode(e.target.value)}>
            {MODE_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>{o}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Box sx={BTN_ROW_SX}>
        <Button variant="outlined" size="small" sx={BTN_SX}>Save Program</Button>
        <Button variant="outlined" size="small" sx={BTN_SX}>Load Program</Button>
      </Box>

      <Box sx={ROW_SX}>
        <Typography sx={LABEL_SX}>Reference Point</Typography>
        <TextField size="small" label="X" value={refX} onChange={(e) => setRefX(e.target.value)} />
        <TextField size="small" label="Y" value={refY} onChange={(e) => setRefY(e.target.value)} />
        <IconButton size="small" aria-label="Add reference point" sx={ADD_BTN_SX}>
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>Interval</Typography>
        <TextField size="small" value={interval} onChange={(e) => setInterval(e.target.value)} />
        <Typography sx={LABEL_SX}>Offset</Typography>
        <TextField size="small" value={offset} onChange={(e) => setOffset(e.target.value)} />
      </Box>

      <Box sx={TWO_COL_SX}>
        <Typography sx={LABEL_SX}>First Offset</Typography>
        <TextField size="small" value={firstOffset} onChange={(e) => setFirstOffset(e.target.value)} />
        <Typography sx={LABEL_SX}>Number</Typography>
        <TextField size="small" type="number" value={number} onChange={(e) => setNumber(e.target.value)} />
      </Box>

      <Box sx={BTN_ROW_SX}>
        <Button variant="outlined" size="small" sx={BTN_SX}>Start</Button>
        <Button variant="outlined" size="small" sx={BTN_SX}>Generate</Button>
        <FormControlLabel
          control={<Checkbox size="small" checked={multiset} onChange={(e) => setMultiset(e.target.checked)} />}
          label="Multiset"
          sx={RADIO_SX}
        />
      </Box>

      <Box sx={OPTION_ROW_SX}>
        <RadioGroup row value={impressMode} onChange={(e) => setImpressMode(e.target.value)}>
          <FormControlLabel value="indenting" control={<Radio size="small" />} label="Indenting" sx={RADIO_SX} />
          <FormControlLabel value="onePass" control={<Radio size="small" />} label="One Pass Impress" sx={RADIO_SX} />
          <FormControlLabel value="twoPass" control={<Radio size="small" />} label="Two Pass Impress" sx={RADIO_SX} />
        </RadioGroup>
        <FormControlLabel
          control={<Checkbox size="small" checked={focusAll} onChange={(e) => setFocusAll(e.target.checked)} />}
          label="FocusAll"
          sx={RADIO_SX}
        />
        <Button variant="outlined" size="small" sx={BTN_SX}>Reset</Button>
      </Box>
    </Box>
  );
}

export default memo(MultipointTabImpl);
