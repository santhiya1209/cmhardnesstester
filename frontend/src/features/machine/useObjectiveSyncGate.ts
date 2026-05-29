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
  // Whenever the active objective changes from machine confirmation, snap
  // Auto Measure smoothing/threshold to that objective's tuned defaults so
  // the Settings dialog and the next detection run pick them up. Also
  // emits the defaults log so we can verify in the console.
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
    // Objective changed — drop any visible Auto Measure lines, end the
    // current session (so async results from the old objective can't paint),
    // and arm the suppression ref so a settings-preview detection cannot
    // repaint yellow lines for the new magnification on its own. Lines
    // reappear only after the user clicks Auto Measure again.
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
    // Force AutoMeasureOverlay to imperatively clear its canvas — React state
    // nulling alone was leaving yellow lines on screen across objective swaps.
    setAutoMeasureClearNonce((n) => n + 1);
  }, [activeObjective, shouldPreserveAfterImpressOverlay]);
}
