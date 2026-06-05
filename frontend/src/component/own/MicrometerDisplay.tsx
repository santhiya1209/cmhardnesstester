import { memo, useEffect, useRef, useState } from 'react';
import TextField from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';
import { useMicrometerReading } from '@/hooks/useMicrometerReading';

type Props = {
  sx?: SxProps<Theme>;
  enabled?: boolean;
};

function MicrometerDisplayImpl({ sx, enabled = true }: Props) {
  const { connected, status, value, displayText, lastError, rawHex, updatedAt } =
    useMicrometerReading();

  const [latched, setLatched] = useState<string | null>(null);
  const lastValueRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === 'valid' && value !== null && Number.isFinite(value)) {
      lastValueRef.current = value;
      setLatched(displayText);
    } else if (!connected) {
      lastValueRef.current = null;
      setLatched(null);
    }
  }, [status, value, displayText, connected]);

  const compact = !enabled ? 'Manual Mode' : latched ?? 'Waiting for data...';

  useEffect(() => {
    console.log(`[micrometer][ui-display] value=${value} displayed="${compact}"`);
  }, [value, compact]);

  const tooltip = !enabled
    ? 'Micrometer disabled — depth is entered manually per row in the Measurements table.'
    : !connected
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
