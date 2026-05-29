import { useEffect, useRef } from 'react';
import type { Measurement } from '@/types/measurement';
import type { CommittedAutoMeasureFingerprint } from './autoMeasureHelpers';

// Duplicate-measurement guard for every committed Auto Measure row in the
// current measurement session. It survives overlay clears and repeat Auto
// Measure clicks; only table clear, new image/session resets, or row removal
// prune it. The hook also prunes entries whose rowId no longer exists in the
// measurements list — handles row deletion from the table without leaking
// stale fingerprints into the duplicate-detection path.
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
