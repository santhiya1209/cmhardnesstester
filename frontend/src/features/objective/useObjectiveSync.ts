import { useCallback, useEffect, useRef, useState } from 'react';
import { applyObjectiveBrightness } from '@/api/machine';
import type { CameraWindowHandle } from '@/component/own/CameraWindow';
import { objectiveForMeasureFromObjective } from '@/features/autoMeasure/autoMeasureHelpers';
import type { MachineState } from '@/types/machine';

export type ObjectiveCommitSource = 'ack';

export type UseObjectiveSyncArgs = {
  // activeObjective state lives in App so useOverlayLifecycle (which renders
  // before this hook can be called) keeps reading it directly. activeObjectiveRef
  // is also App-owned because useAfterImpressFlow (called before useObjectiveSync
  // to break a circular dep) also reads through it; sharing the ref keeps a
  // single source of truth instead of mirroring it twice.
  activeObjective: string | null;
  setActiveObjective: React.Dispatch<React.SetStateAction<string | null>>;
  activeObjectiveRef: React.MutableRefObject<string | null>;
  cameraOpen: boolean;
  cameraRef: React.RefObject<CameraWindowHandle | null>;
  machineConfirmedObjective: string | null | undefined;
  activeTool: string;
  manualMeasureResetKey: number;
  getMachineStateSnapshot: () => Promise<MachineState | null>;
  refetchCalibrationSettings: () => unknown;
  shouldPreserveAfterImpressOverlay: () => boolean;
  clearAutoMeasureOverlay: (reason: string) => void;
  setObjectiveChangeInProgressState: (inProgress: boolean) => void;
};

export type UseObjectiveSyncResult = {
  objectiveRefreshKey: number;
  lastSyncedObjectiveRef: React.MutableRefObject<string | null>;
  commitActiveObjective: (
    objective: '10X' | '40X',
    source: ObjectiveCommitSource
  ) => Promise<void>;
  handleObjectiveChangeFromUI: (
    objective: '10X' | '40X',
    source: ObjectiveCommitSource
  ) => void;
  handleCenterCommit: () => void;
};

// SINGLE GLOBAL SOURCE OF TRUTH for the active objective lives in App as
// `activeObjective` state — this hook owns the orchestration around it:
// - commitActiveObjective: the only path that writes activeObjective after
//   machine ACK/RX. Used by Auto Measure, Manual Measure, calibration lookup,
//   and the measurement table row.
// - handleObjectiveChangeFromUI / handleCenterCommit: UI dispatchers.
// - confirmed-RX effect: watches machineConfirmedObjective and calls commit.
// - manual-measure-activates effect: re-syncs the objective when the user
//   toggles into Manual Measure so the initial diamond size matches the
//   magnification.
//
// There is NO silent fallback to a hardcoded default. If activeObjective is
// ever null at save time, callers must surface a warning instead of assuming.
//
// objectiveRefreshKey bumps every time the machine confirms a new objective via
// L1OK / L2OK RX. CameraWindow watches it to invalidate any per-objective
// caches and force a fresh draw — separate from activeObjective so we can
// trigger a refresh even when the confirmed value is identical (e.g. user
// re-selects same lens).
export function useObjectiveSync({
  activeObjective,
  setActiveObjective,
  activeObjectiveRef,
  cameraOpen,
  cameraRef,
  machineConfirmedObjective,
  activeTool,
  manualMeasureResetKey,
  getMachineStateSnapshot,
  refetchCalibrationSettings,
  shouldPreserveAfterImpressOverlay,
  clearAutoMeasureOverlay,
  setObjectiveChangeInProgressState,
}: UseObjectiveSyncArgs): UseObjectiveSyncResult {
  useEffect(() => {
    activeObjectiveRef.current = activeObjective;
  }, [activeObjective, activeObjectiveRef]);

  const [objectiveRefreshKey, setObjectiveRefreshKey] = useState<number>(0);
  const lastSyncedObjectiveRef = useRef<string | null>(null);
  const objectiveCommitSeqRef = useRef(0);

  const commitActiveObjective = useCallback(
    async (objective: '10X' | '40X', source: ObjectiveCommitSource) => {
      const normalized = objectiveForMeasureFromObjective(objective);
      if (!normalized) return;

      const commitSeq = objectiveCommitSeqRef.current + 1;
      objectiveCommitSeqRef.current = commitSeq;
      setObjectiveChangeInProgressState(true);

      void refetchCalibrationSettings();
      setObjectiveRefreshKey((key) => key + 1);
      // Do NOT clear the live camera canvas — the last frame stays visible
      // while the turret rotates. Only the Auto Measure overlay is cleared.
      // eslint-disable-next-line no-console
      console.log(
        `[camera-stream-state] reason=objective-change cameraOpen=${cameraOpen} streaming=true objective=${normalized}`
      );
      if (!shouldPreserveAfterImpressOverlay()) {
        clearAutoMeasureOverlay('objective-change-commit');
      }

      const camera = cameraRef.current;
      if (cameraOpen && camera) {
        const fresh = await camera.waitForFreshFrame(2500);
        if (objectiveCommitSeqRef.current !== commitSeq) return;
        if (!fresh) {
          // Live frame was slow to refresh after the turret move. Do NOT strand
          // the objective: commit anyway so activeObjective (the single source
          // of truth) updates and Auto Measure is unblocked — the live image
          // catches up on the next frame. Returning here is what left the
          // operator on "no active objective" after a valid 10X/40X selection.
          // eslint-disable-next-line no-console
          console.warn(
            `[camera-objective-sync] activeObjective=${normalized} note=frame-refresh-timeout-committing-anyway`
          );
        }
      }

      activeObjectiveRef.current = normalized;
      lastSyncedObjectiveRef.current = normalized;
      setActiveObjective((current) => (
        String(current ?? '').trim().toUpperCase() === normalized ? current : normalized
      ));
      // eslint-disable-next-line no-console
      console.log(`[machine-objective-commit] objective=${normalized} source=${source}`);
      // eslint-disable-next-line no-console
      console.log(`[camera-objective-sync] activeObjective=${normalized}`);
      // Authoritative objective changed → let the backend apply this lens's
      // saved brightness. Fire-and-forget: brightness must never block or fail
      // the objective commit.
      void applyObjectiveBrightness(normalized).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[machine-objective-brightness] apply failed objective=${normalized}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      });
      setObjectiveChangeInProgressState(false);
    },
    [
      cameraOpen,
      cameraRef,
      clearAutoMeasureOverlay,
      refetchCalibrationSettings,
      setActiveObjective,
      setObjectiveChangeInProgressState,
      shouldPreserveAfterImpressOverlay,
    ]
  );

  const handleObjectiveChangeFromUI = useCallback(
    (objective: '10X' | '40X', source: ObjectiveCommitSource) => {
      void commitActiveObjective(objective, source);
    },
    [commitActiveObjective]
  );

  // Center/indenter slot carries no measurement lens. Once the turret-front
  // command is handled, clear the active objective so the 10X/40X highlights
  // turn off, Center shows its own state, and Auto Measure blocks (truly no
  // active objective). Bumping the commit sequence cancels any in-flight 10X
  // objective commit so a stale 10X can't land after the operator moved to Center.
  const handleCenterCommit = useCallback(() => {
    objectiveCommitSeqRef.current += 1;
    activeObjectiveRef.current = null;
    lastSyncedObjectiveRef.current = null;
    setObjectiveChangeInProgressState(false);
    setActiveObjective((current) => (current === null ? current : null));
    // eslint-disable-next-line no-console
    console.log('[machine-objective-commit] objective=CENTER source=ack');
    // Center carries no measurement lens → tell the backend to stop attributing
    // lightness edits to a lens slot and leave the current brightness as-is.
    void applyObjectiveBrightness('IND').catch(() => {});
    if (!shouldPreserveAfterImpressOverlay()) {
      clearAutoMeasureOverlay('center-commit');
    }
  }, [
    clearAutoMeasureOverlay,
    setActiveObjective,
    setObjectiveChangeInProgressState,
    shouldPreserveAfterImpressOverlay,
  ]);

  // Camera/objective sync pipeline. Triggered ONLY by a confirmed L<n>OK RX
  // from the machine (machineConfirmedObjective), not by the OK-ACK or by the
  // user click — so the UI never reflects a magnification the turret hasn't
  // actually reached.
  useEffect(() => {
    const confirmed = objectiveForMeasureFromObjective(machineConfirmedObjective);
    if (!confirmed) return;
    if (
      lastSyncedObjectiveRef.current === confirmed &&
      activeObjectiveRef.current === confirmed
    ) {
      return;
    }
    void commitActiveObjective(confirmed, 'ack');
  }, [commitActiveObjective, machineConfirmedObjective]);

  // When Manual Measure activates, refresh the live objective so the initial
  // diamond size matches the magnification the user just toggled to.
  useEffect(() => {
    if (activeTool !== 'manualMeasure') return;
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await getMachineStateSnapshot();
        if (cancelled) return;
        const confirmed = objectiveForMeasureFromObjective(snapshot?.confirmedObjectiveFromMachine);
        if (confirmed && activeObjectiveRef.current !== confirmed) {
          void commitActiveObjective(confirmed, 'ack');
        }
      } catch {
        /* non-fatal — fall back to whatever objective we already have */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTool, commitActiveObjective, getMachineStateSnapshot, manualMeasureResetKey]);

  return {
    objectiveRefreshKey,
    lastSyncedObjectiveRef,
    commitActiveObjective,
    handleObjectiveChangeFromUI,
    handleCenterCommit,
  };
}
