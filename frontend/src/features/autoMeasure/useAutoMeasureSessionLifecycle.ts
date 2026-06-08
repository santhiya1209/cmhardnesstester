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
  /**
   * When true, a paint-confirmation is in flight for the freshly committed
   * overlay. Clears are refused (logged + skipped) so a transient/stale clear
   * can't wipe the latest auto-measure overlay before it is confirmed painted.
   */
  overlayPaintPendingRef: MutableRefObject<boolean>;
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
  overlayPaintPendingRef,
}: UseAutoMeasureSessionLifecycleArgs): UseAutoMeasureSessionLifecycle {
  const clearAutoMeasureOverlay = useCallback((reason: string) => {
    if (overlayPaintPendingRef.current) {
      // Do NOT clear the latest auto-measure overlay while its paint is still
      // being confirmed — clearing here is the stale path that hid the lines.
      // eslint-disable-next-line no-console
      console.log(`[auto-measure-overlay-cleared] reason=${reason} skipped=paint-pending`);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[auto-overlay-clear] reason=${reason}`);
    // eslint-disable-next-line no-console
    console.log(`[auto-measure-overlay-cleared] reason=${reason}`);
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
    autoMeasurePendingPreviewRef.current = null;
    autoMeasureSettingsOpenRef.current = false;
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
