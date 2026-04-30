import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { colors } from '@/theme/theme';
import { useMicrometer } from '@/hooks/useMicrometer';

const BAR_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  height: 24,
  px: 1.5,
  bgcolor: colors.headingPrimary,
  borderTop: 1,
  borderColor: colors.border,
  fontSize: 12,
  gap: 2,
};

const MESSAGE_SX: SxProps<Theme> = {
  fontSize: 12,
  color: 'common.white',
};

const READOUT_SX: SxProps<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  ml: 'auto',
};

const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'common.white', opacity: 0.7 };
const VALUE_SX: SxProps<Theme> = {
  fontSize: 12,
  color: 'common.white',
  fontVariantNumeric: 'tabular-nums',
};
const CONNECTION_SX: SxProps<Theme> = {
  fontSize: 12,
  color: 'common.white',
  opacity: 0.86,
};

type Props = {
  message?: string;
};

function MicrometerReadoutImpl() {
  const { connected, displayValue, updatedAt } = useMicrometer();
  const title = updatedAt ? new Date(updatedAt).toLocaleTimeString() : undefined;

  return (
    <>
      <Typography component="span" sx={LABEL_SX}>
        Micrometer:
      </Typography>
      <Typography component="span" sx={VALUE_SX} title={title}>
        {displayValue}
      </Typography>
      <Typography component="span" sx={CONNECTION_SX}>
        {connected ? 'Connected' : 'Disconnected'}
      </Typography>
    </>
  );
}
const MicrometerReadout = memo(MicrometerReadoutImpl);

function StatusBarImpl({ message = 'System Status: Failed To Load Hardness Tester' }: Props) {
  return (
    <Box component="footer" sx={BAR_SX}>
      <Typography sx={MESSAGE_SX}>{message}</Typography>
      <Box sx={READOUT_SX}>
        <MicrometerReadout />
      </Box>
    </Box>
  );
}

export default memo(StatusBarImpl);
