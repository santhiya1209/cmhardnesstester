import { memo, useEffect, useRef, useState } from 'react';
import TextField from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';
import { useMicrometerReading } from '@/hooks/useMicrometerReading';

type Props = {
  sx?: SxProps<Theme>;
};

function MicrometerDisplayImpl({ sx }: Props) {
  const { connected, status, value, displayText, lastError, rawHex, updatedAt } =
    useMicrometerReading();

  // Latch the most recent valid reading so transient publishes (status="waiting"
  // between frames, brief disconnects, deduped re-emits) don't blank the UI back
  // to "Waiting for data...". The latched value is replaced as soon as a new
  // valid reading arrives from the device.
  const [latched, setLatched] = useState<string | null>(null);
  const lastValueRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === 'valid' && value !== null && Number.isFinite(value)) {
      lastValueRef.current = value;
      setLatched(displayText);
      // eslint-disable-next-line no-console
      console.log(`[micrometer-live] value=${value}`);
    } else if (!connected) {
      lastValueRef.current = null;
      setLatched(null);
    }
  }, [status, value, displayText, connected]);

  const compact = latched ?? 'Waiting for data...';

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
