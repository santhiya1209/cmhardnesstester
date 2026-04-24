import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

const BAR_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  height: 24,
  px: 1.5,
  bgcolor: '#BAE6FD',
  borderTop: 1,
  borderColor: '#38BDF8',
  fontSize: 12,
  gap: 2,
};

const MESSAGE_SX: SxProps<Theme> = {
  fontSize: 12,
  color: '#0C1E2B',
};

type Props = {
  message?: string;
};

function StatusBarImpl({ message = 'System Status: Failed To Load Hardness Tester' }: Props) {
  return (
    <Box component="footer" sx={BAR_SX}>
      <Typography sx={MESSAGE_SX}>{message}</Typography>
    </Box>
  );
}

export default memo(StatusBarImpl);
