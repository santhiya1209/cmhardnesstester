import { memo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import type { SxProps, Theme } from '@mui/material/styles';

const SECTION_SX: SxProps<Theme> = { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 280 };
const PREVIEW_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 200,
  border: 1,
  borderColor: 'divider',
  m: 1.5,
  bgcolor: 'background.paper',
};
const ACTION_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 2, px: 1.5, pb: 1.5 };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const CHECK_SX: SxProps<Theme> = { '& .MuiFormControlLabel-label': { fontSize: 12 } };

function DepthImageTabImpl() {
  const [hardnessImage, setHardnessImage] = useState(false);

  return (
    <Box sx={SECTION_SX}>
      <Box sx={PREVIEW_SX} />
      <Box sx={ACTION_ROW_SX}>
        <Button variant="outlined" size="small" sx={BTN_SX}>Fresh</Button>
        <Button variant="outlined" size="small" sx={BTN_SX}>Save Image</Button>
        <FormControlLabel
          control={<Checkbox size="small" checked={hardnessImage} onChange={(e) => setHardnessImage(e.target.checked)} />}
          label="HardnessImage"
          sx={CHECK_SX}
        />
      </Box>
    </Box>
  );
}

export default memo(DepthImageTabImpl);
