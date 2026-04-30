import { memo } from 'react';
import TextField from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';
import { useMicrometerReading } from '@/hooks/useMicrometerReading';

type Props = {
  sx?: SxProps<Theme>;
};

function MicrometerDisplayImpl({ sx }: Props) {
  const { connected, status, value, displayText, lastError, rawHex, updatedAt } =
    useMicrometerReading();

  const compact =
    status === 'valid' && value !== null && Number.isFinite(value)
      ? displayText
      : 'Waiting for data...';

  const tooltip = !connected
    ? lastError ?? 'Disconnected'
    : status !== 'valid'
      ? `Connected${rawHex ? ` | hex: ${rawHex}` : ''}`
      : `${displayText} | Connected | Updated ${updatedAt ?? ''}`;

  return (
    <TextField
      size="small"
      value={compact}
      disabled
      title={tooltip}
      sx={sx}
    />
  );
}

export default memo(MicrometerDisplayImpl);
