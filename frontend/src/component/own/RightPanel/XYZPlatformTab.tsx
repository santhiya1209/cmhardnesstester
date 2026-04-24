import { memo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import NorthWestIcon from '@mui/icons-material/NorthWest';
import NorthIcon from '@mui/icons-material/North';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import WestIcon from '@mui/icons-material/West';
import ControlCameraIcon from '@mui/icons-material/ControlCamera';
import EastIcon from '@mui/icons-material/East';
import SouthWestIcon from '@mui/icons-material/SouthWest';
import SouthIcon from '@mui/icons-material/South';
import SouthEastIcon from '@mui/icons-material/SouthEast';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import type { SxProps, Theme } from '@mui/material/styles';

const SECTION_SX: SxProps<Theme> = { px: 1.5, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1 };
const HEADER_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 };
const GROUP_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary', fontWeight: 600 };
const RADIO_ROW_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 };
const RADIO_GROUP_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'row',
  gap: 0,
  '& .MuiFormControlLabel-root': { mr: 1.5 },
  '& .MuiFormControlLabel-label': { fontSize: 12 },
  '& .MuiRadio-root': { p: 0.25 },
};
const GRIDS_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 };
const PAD_SX: SxProps<Theme> = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5 };
const PAD_BTN_SX: SxProps<Theme> = {
  minWidth: 0,
  height: 32,
  textTransform: 'none',
  fontSize: 11,
  py: 0,
  px: 0.5,
};
const COORD_ROW_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  pt: 1,
  borderTop: 1,
  borderColor: 'divider',
};
const COORD_SX: SxProps<Theme> = {
  fontSize: 12,
  color: 'text.secondary',
  fontFamily: 'Consolas, monospace',
};

function XYZPlatformTabImpl() {
  const [xySpeed, setXySpeed] = useState<'slow' | 'mid' | 'fast'>('slow');
  const [zSpeed, setZSpeed] = useState<'ultra' | 'fast' | 'slow'>('fast');
  const [platformX] = useState('0');
  const [platformY] = useState('0');

  return (
    <Box sx={SECTION_SX}>
      <Box sx={HEADER_ROW_SX}>
        <Typography sx={GROUP_LABEL_SX}>X/Y</Typography>
        <Typography sx={GROUP_LABEL_SX}>Z</Typography>
      </Box>

      <Box sx={RADIO_ROW_SX}>
        <RadioGroup
          row
          value={xySpeed}
          onChange={(e) => setXySpeed(e.target.value as 'slow' | 'mid' | 'fast')}
          sx={RADIO_GROUP_SX}
        >
          <FormControlLabel value="slow" control={<Radio size="small" />} label="Slow" />
          <FormControlLabel value="mid" control={<Radio size="small" />} label="Mid" />
          <FormControlLabel value="fast" control={<Radio size="small" />} label="Fast" />
        </RadioGroup>
        <RadioGroup
          row
          value={zSpeed}
          onChange={(e) => setZSpeed(e.target.value as 'ultra' | 'fast' | 'slow')}
          sx={RADIO_GROUP_SX}
        >
          <FormControlLabel value="ultra" control={<Radio size="small" />} label="Ultra" />
          <FormControlLabel value="fast" control={<Radio size="small" />} label="Fast" />
          <FormControlLabel value="slow" control={<Radio size="small" />} label="Slow" />
        </RadioGroup>
      </Box>

      <Box sx={GRIDS_SX}>
        <Box sx={PAD_SX}>
          <Button variant="outlined" sx={PAD_BTN_SX}><NorthWestIcon fontSize="small" /></Button>
          <Button variant="outlined" sx={PAD_BTN_SX}><NorthIcon fontSize="small" /></Button>
          <Button variant="outlined" sx={PAD_BTN_SX}><NorthEastIcon fontSize="small" /></Button>

          <Button variant="outlined" sx={PAD_BTN_SX}><WestIcon fontSize="small" /></Button>
          <Button variant="outlined" sx={PAD_BTN_SX}><ControlCameraIcon fontSize="small" /></Button>
          <Button variant="outlined" sx={PAD_BTN_SX}><EastIcon fontSize="small" /></Button>

          <Button variant="outlined" sx={PAD_BTN_SX}><SouthWestIcon fontSize="small" /></Button>
          <Button variant="outlined" sx={PAD_BTN_SX}><SouthIcon fontSize="small" /></Button>
          <Button variant="outlined" sx={PAD_BTN_SX}><SouthEastIcon fontSize="small" /></Button>
        </Box>

        <Box sx={PAD_SX}>
          <Button variant="outlined" sx={PAD_BTN_SX}>Lock</Button>
          <Button variant="outlined" sx={PAD_BTN_SX}>Lock</Button>
          <Button variant="outlined" sx={PAD_BTN_SX}>Unlock</Button>

          <Button variant="outlined" sx={PAD_BTN_SX}>Unlock</Button>
          <Button variant="outlined" sx={PAD_BTN_SX}>Cfocus</Button>
          <Button variant="outlined" sx={PAD_BTN_SX}><ArrowUpwardIcon fontSize="small" /></Button>

          <Button variant="outlined" sx={PAD_BTN_SX}>Relocatio</Button>
          <Button variant="outlined" sx={PAD_BTN_SX}>Ffocus</Button>
          <Button variant="outlined" sx={PAD_BTN_SX}><ArrowDownwardIcon fontSize="small" /></Button>
        </Box>
      </Box>

      <Box sx={COORD_ROW_SX}>
        <Typography sx={COORD_SX}>X: {platformX}</Typography>
        <Typography sx={COORD_SX}>Y: {platformY}</Typography>
      </Box>
    </Box>
  );
}

export default memo(XYZPlatformTabImpl);
