import { useMemo } from 'react';
import { useMicrometer } from '@/hooks/useMicrometer';
import { formatMicrometerValue } from '@/utils/formatMicrometerValue';

export function useMicrometerReading() {
  const state = useMicrometer();

  return useMemo(
    () => ({
      ...state,
      displayText:
        state.value === null || !Number.isFinite(state.value)
          ? 'Waiting for data...'
          : formatMicrometerValue(state.value),
    }),
    [state]
  );
}
