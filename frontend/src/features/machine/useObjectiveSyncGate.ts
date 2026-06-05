import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  applyAutoMeasureObjectiveProfile,
  autoMeasureDefaultsForObjective,
  autoMeasureSettingsEqual,
  type AutoMeasureDetectionSnapshot,
  type CapturedAutoMeasureFrame,
} from '@/features/autoMeasure/autoMeasureHelpers';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';
import type { AutoMeasureSettingsPayload } from '@/types/autoMeasureSettings';
import type { AutoMeasureStatusState } from '@/component/own/StatusBar';

export type UseObjectiveSyncGateArgs = {
  activeObjective: string | null;
  shouldPreserveAfterImpressOverlay: () => boolean;
  setAutoMeasurePreviewSettings: Dispatch<SetStateAction<AutoMeasureSettingsPayload>>;
  latestAutoMeasurePreviewSettingsRef: MutableRefObject<AutoMeasureSettingsPayload>;
  suppressAutoMeasurePreviewRef: MutableRefObject<boolean>;
  setCommittedAutoMeasureOverlay: Dispatch<SetStateAction<AutoMeasureGraphics | null>>;
  setPreviewAutoMeasureOverlay: Dispatch<SetStateAction<AutoMeasureGraphics | null>>;
  autoMeasurePreviewSnapshotRef: MutableRefObject<AutoMeasureDetectionSnapshot | null>;
  committedAutoMeasureFrameRef: MutableRefObject<CapturedAutoMeasureFrame | null>;
  previewMeasurementRef: MutableRefObject<{
    d1Pixels: number;
    d2Pixels: number;
    confidence: number;
  } | null>;
  setAutoMeasureSessionActive: Dispatch<SetStateAction<boolean>>;
  setAutoMeasureCapturedFrameId: Dispatch<SetStateAction<number | null>>;
  setAutoMeasureSessionId: Dispatch<SetStateAction<number>>;
  autoMeasureSessionIdRef: MutableRefObject<number>;
  setAutoMeasureStatusState: Dispatch<SetStateAction<AutoMeasureStatusState>>;
  setAutoMeasureClearNonce: Dispatch<SetStateAction<number>>;
};

/**
 * Reacts to active-objective changes: snaps Auto Measure smoothing/threshold
 * to the new objective's tuned defaults (so the Settings dialog and next
 * detection pick them up) and clears any visible Auto Measure overlay/session
 * so async results from the prior objective can't paint. `activeObjective`
 * itself stays owned by App (read by JSX, Auto Measure, and useObjectiveSync).
 */
export function useObjectiveSyncGate({
  activeObjective,
  shouldPreserveAfterImpressOverlay,
  setAutoMeasurePreviewSettings,
  latestAutoMeasurePreviewSettingsRef,
  suppressAutoMeasurePreviewRef,
  setCommittedAutoMeasureOverlay,
  setPreviewAutoMeasureOverlay,
  autoMeasurePreviewSnapshotRef,
  committedAutoMeasureFrameRef,
  previewMeasurementRef,
  setAutoMeasureSessionActive,
  setAutoMeasureCapturedFrameId,
  setAutoMeasureSessionId,
  autoMeasureSessionIdRef,
  setAutoMeasureStatusState,
  setAutoMeasureClearNonce,
}: UseObjectiveSyncGateArgs): void {
  useEffect(() => {
    const defaults = autoMeasureDefaultsForObjective(activeObjective);
    if (!defaults) return;
    const objectiveUpper = String(activeObjective).trim().toUpperCase();
    // eslint-disable-next-line no-console
    console.log(
      `[auto-measure-settings-sync] objective=${objectiveUpper} smoothing=${defaults.smoothing} threshold=${defaults.threshold}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[auto-measure-profile] objective=${objectiveUpper} smoothing=${defaults.smoothing} threshold=${defaults.threshold}`
    );
    setAutoMeasurePreviewSettings((prev) => {
      const next = applyAutoMeasureObjectiveProfile(prev, activeObjective);
      if (autoMeasureSettingsEqual(next, prev)) {
        latestAutoMeasurePreviewSettingsRef.current = prev;
        return prev;
      }
      latestAutoMeasurePreviewSettingsRef.current = next;
      return next;
    });
    if (shouldPreserveAfterImpressOverlay()) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[auto-measure-overlay-cleared] reason=objective-sync-gate objective=${String(activeObjective).trim().toUpperCase()}`);
    suppressAutoMeasurePreviewRef.current = true;
    setCommittedAutoMeasureOverlay(null);
    setPreviewAutoMeasureOverlay(null);
    autoMeasurePreviewSnapshotRef.current = null;
    committedAutoMeasureFrameRef.current = null;
    previewMeasurementRef.current = null;
    setAutoMeasureSessionActive(false);
    setAutoMeasureCapturedFrameId(null);
    setAutoMeasureSessionId((id) => {
      const next = id + 1;
      autoMeasureSessionIdRef.current = next;
      return next;
    });
    setAutoMeasureStatusState('idle');
    setAutoMeasureClearNonce((n) => n + 1);
  }, [activeObjective, shouldPreserveAfterImpressOverlay]);
}
