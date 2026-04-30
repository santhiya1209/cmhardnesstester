import { memo } from 'react';
import TextField from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';
import { useMicrometer } from '@/hooks/useMicrometer';

type Props = {
  sx?: SxProps<Theme>;
};

function MicrometerDisplayImpl({ sx }: Props) {
  const { connected, status, value, displayValue, lastError, rawHex, updatedAt } =
    useMicrometer();

  const compact =
    status === 'valid' && value !== null && Number.isFinite(value)
      ? displayValue
      : 'Waiting for data...';

  const tooltip = !connected
    ? lastError ?? 'Disconnected'
    : status !== 'valid'
      ? `Connected${rawHex ? ` | hex: ${rawHex}` : ''}`
      : `${displayValue} | Connected | Updated ${updatedAt ?? ''}`;

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
