import { memo } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import CameraWindow from '@/component/own/CameraWindow';

const PANEL_SX: SxProps<Theme> = {
  flex: 2.0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  bgcolor: 'background.paper',
  borderRight: 1,
  borderColor: 'divider',
  overflow: 'hidden',
};

function LeftPanelImpl() {
  return (
    <Box sx={PANEL_SX}>
      <CameraWindow />
    </Box>
  );
}

export default memo(LeftPanelImpl);
