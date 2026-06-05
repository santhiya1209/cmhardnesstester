import { useCallback, useEffect, useRef, useState } from 'react';
import { applyObjectiveBrightness } from '@/api/machine';
import type { CameraWindowHandle } from '@/component/own/CameraWindow';
import { objectiveForMeasureFromObjective } from '@/features/autoMeasure/autoMeasureHelpers';
import type { MachineState } from '@/types/machine';

export type ObjectiveCommitSource = 'ack';

export type UseObjectiveSyncArgs = {
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

  const handleCenterCommit = useCallback(() => {
    objectiveCommitSeqRef.current += 1;
    activeObjectiveRef.current = null;
    lastSyncedObjectiveRef.current = null;
    setObjectiveChangeInProgressState(false);
    setActiveObjective((current) => (current === null ? current : null));
    // eslint-disable-next-line no-console
    console.log('[machine-objective-commit] objective=CENTER source=ack');
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
