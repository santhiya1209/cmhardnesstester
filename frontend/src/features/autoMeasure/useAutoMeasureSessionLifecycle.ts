import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  AutoMeasureDetectionSnapshot,
  CapturedAutoMeasureFrame,
} from '@/features/autoMeasure/autoMeasureHelpers';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';
import type { AutoMeasureSettingsPayload } from '@/types/autoMeasureSettings';

export type UseAutoMeasureSessionLifecycleArgs = {
  setCommittedAutoMeasureOverlay: Dispatch<SetStateAction<AutoMeasureGraphics | null>>;
  setPreviewAutoMeasureOverlay: Dispatch<SetStateAction<AutoMeasureGraphics | null>>;
  autoMeasurePreviewSnapshotRef: MutableRefObject<AutoMeasureDetectionSnapshot | null>;
  committedAutoMeasureFrameRef: MutableRefObject<CapturedAutoMeasureFrame | null>;
  previewMeasurementRef: MutableRefObject<{
    d1Pixels: number;
    d2Pixels: number;
    confidence: number;
  } | null>;
  autoMeasurementIdRef: MutableRefObject<string | null>;
  autoMeasurePendingPreviewRef: MutableRefObject<AutoMeasureSettingsPayload | null>;
  autoMeasureSettingsOpenRef: MutableRefObject<boolean>;
  setAutoMeasureSessionActive: Dispatch<SetStateAction<boolean>>;
  setAutoMeasureCapturedFrameId: Dispatch<SetStateAction<number | null>>;
  setAutoMeasureSessionId: Dispatch<SetStateAction<number>>;
  autoMeasureSessionIdRef: MutableRefObject<number>;
};

export type UseAutoMeasureSessionLifecycle = {
  clearAutoMeasureOverlay: (reason: string) => void;
};

/**
 * Owns the Auto Measure session-reset / overlay-cleanup orchestration. The
 * setters and refs are owned by App (and useOverlayLifecycle) because other
 * code paths — runAutoMeasure, JSX, the objective/turret gates — read them;
 * this hook only drives the cleanup sequence and hands back
 * `clearAutoMeasureOverlay` for those callers to invoke.
 */
export function useAutoMeasureSessionLifecycle({
  setCommittedAutoMeasureOverlay,
  setPreviewAutoMeasureOverlay,
  autoMeasurePreviewSnapshotRef,
  committedAutoMeasureFrameRef,
  previewMeasurementRef,
  autoMeasurementIdRef,
  autoMeasurePendingPreviewRef,
  autoMeasureSettingsOpenRef,
  setAutoMeasureSessionActive,
  setAutoMeasureCapturedFrameId,
  setAutoMeasureSessionId,
  autoMeasureSessionIdRef,
}: UseAutoMeasureSessionLifecycleArgs): UseAutoMeasureSessionLifecycle {
  // Clears Auto Measure overlay/session state without touching committed row
  // fingerprints. Duplicate suppression must survive overlay clears.
  const clearAutoMeasureOverlay = useCallback((reason: string) => {
    // eslint-disable-next-line no-console
    console.log(`[auto-overlay-clear] reason=${reason}`);
    setCommittedAutoMeasureOverlay((prev) => {
      if (!prev) {
      }
      return null;
    });
    setPreviewAutoMeasureOverlay(null);
    autoMeasurePreviewSnapshotRef.current = null;
    committedAutoMeasureFrameRef.current = null;
    previewMeasurementRef.current = null;
    autoMeasurementIdRef.current = null;
    // Cancel any pending coalesced trailing detection and mark the settings
    // dialog closed in the ref the in-flight finally block consults so a
    // queued preview run does not repaint after we just cleared.
    autoMeasurePendingPreviewRef.current = null;
    autoMeasureSettingsOpenRef.current = false;
    // End the current Auto Measure session: any in-flight detection callback
    // that observes the bumped sessionId will refuse to paint.
    setAutoMeasureSessionActive(false);
    setAutoMeasureCapturedFrameId(null);
    setAutoMeasureSessionId((id) => {
      const next = id + 1;
      autoMeasureSessionIdRef.current = next;
      return next;
    });
  }, []);

  return { clearAutoMeasureOverlay };
}
