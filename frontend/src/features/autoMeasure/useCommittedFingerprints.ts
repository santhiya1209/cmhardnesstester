import { useEffect, useRef } from 'react';
import type { Measurement } from '@/types/measurement';
import type { CommittedAutoMeasureFingerprint } from './autoMeasureHelpers';

export function useCommittedFingerprints(
  measurements: Measurement[]
): React.MutableRefObject<CommittedAutoMeasureFingerprint[]> {
  const committedFingerprintsRef = useRef<CommittedAutoMeasureFingerprint[]>([]);
  useEffect(() => {
    const currentRowIds = new Set(measurements.map((measurement) => measurement.id));
    const next = committedFingerprintsRef.current.filter(
      (entry) => entry.rowId !== null && currentRowIds.has(entry.rowId)
    );
    if (next.length === committedFingerprintsRef.current.length) return;
    committedFingerprintsRef.current = next;
  }, [measurements]);
  return committedFingerprintsRef;
}
