import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { DialogKey } from '@/contexts/DialogContext';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';
import type { ToolId } from '@/types/tool';

type UseOverlayLifecycleParams = {
  cameraOpen: boolean;
  activeDialog: DialogKey;
  turretMoving: boolean;
  objectiveChangeInProgress: boolean;
  activeObjective: string | null;
  /**
   * Active toolbar tool. The Auto/Calibration overlay and the Manual Measure
   * overlay are separate canvas layers; this gate makes them mutually
   * exclusive. While Manual Measure is the active tool the auto/calibration
   * overlay must never paint, so a lingering committed overlay (e.g. one whose
   * imperative clear was skipped by the paint-pending guard) can't mix with the
   * manual measurement lines.
   */
  activeTool: ToolId;
};

type UseOverlayLifecycleResult = {
  committedAutoMeasureOverlay: AutoMeasureGraphics | null;
  setCommittedAutoMeasureOverlay: Dispatch<SetStateAction<AutoMeasureGraphics | null>>;
  previewAutoMeasureOverlay: AutoMeasureGraphics | null;
  setPreviewAutoMeasureOverlay: Dispatch<SetStateAction<AutoMeasureGraphics | null>>;
  autoMeasureClearNonce: number;
  setAutoMeasureClearNonce: Dispatch<SetStateAction<number>>;
  autoMeasureSessionActive: boolean;
  setAutoMeasureSessionActive: Dispatch<SetStateAction<boolean>>;
  autoMeasureCapturedFrameId: number | null;
  setAutoMeasureCapturedFrameId: Dispatch<SetStateAction<number | null>>;
  displayedAutoMeasureGraphics: AutoMeasureGraphics | null;
  displayedAutoMeasureSource: 'auto' | 'preview' | 'save';
  displayedAutoMeasureGraphicsRef: React.MutableRefObject<AutoMeasureGraphics | null>;
};

export function useOverlayLifecycle({
  cameraOpen,
  activeDialog,
  turretMoving,
  objectiveChangeInProgress,
  activeObjective,
  activeTool,
}: UseOverlayLifecycleParams): UseOverlayLifecycleResult {
  const [committedAutoMeasureOverlay, setCommittedAutoMeasureOverlay] =
    useState<AutoMeasureGraphics | null>(null);
  const [previewAutoMeasureOverlay, setPreviewAutoMeasureOverlay] =
    useState<AutoMeasureGraphics | null>(null);
  const [autoMeasureClearNonce, setAutoMeasureClearNonce] = useState(0);
  const [autoMeasureSessionActive, setAutoMeasureSessionActive] = useState(false);
  const [autoMeasureCapturedFrameId, setAutoMeasureCapturedFrameId] = useState<number | null>(null);

  const displayedAutoMeasureGraphicsRef = useRef<AutoMeasureGraphics | null>(null);

  const rawDisplayedAutoMeasureGraphics =
    activeDialog === 'autoMeasure'
      ? previewAutoMeasureOverlay ?? committedAutoMeasureOverlay
      : committedAutoMeasureOverlay;
  const turretMovingGuardedGraphics = turretMoving ? null : rawDisplayedAutoMeasureGraphics;
  const displayedAutoMeasureSource: 'auto' | 'preview' | 'save' =
    activeDialog === 'autoMeasure' && previewAutoMeasureOverlay ? 'preview' : 'auto';

  const lastOverlayRenderLogRef = useRef<string | null>(null);
  const displayedAutoMeasureGraphics = (() => {
    if (!cameraOpen) return null;
    if (activeTool === 'manualMeasure') {
      // Manual Measure owns the overlay layer; never paint the auto/calibration
      // lines on top of it.
      return null;
    }
    if (turretMoving) {
      return null;
    }
    if (objectiveChangeInProgress) {
      return null;
    }
    if (!turretMovingGuardedGraphics) return null;
    if (!autoMeasureSessionActive) {
      return null;
    }
    const overlayObjective = (turretMovingGuardedGraphics.objective ?? '').trim().toUpperCase();
    const liveObjective = (activeObjective ?? '').trim().toUpperCase();
    const referenceObjective = liveObjective;
    if (overlayObjective && referenceObjective && overlayObjective !== referenceObjective) {
      return null;
    }
    const overlayFrameId = turretMovingGuardedGraphics.frameId ?? null;
    if (
      overlayFrameId !== null &&
      autoMeasureCapturedFrameId !== null &&
      overlayFrameId !== autoMeasureCapturedFrameId
    ) {
      return null;
    }
    const renderKey = `${overlayObjective || 'unknown'}|${overlayFrameId ?? 'n/a'}`;
    if (lastOverlayRenderLogRef.current !== renderKey) {
      lastOverlayRenderLogRef.current = renderKey;
    }
    return turretMovingGuardedGraphics;
  })();

  useEffect(() => {
    displayedAutoMeasureGraphicsRef.current = displayedAutoMeasureGraphics;
  }, [displayedAutoMeasureGraphics]);

  return {
    committedAutoMeasureOverlay,
    setCommittedAutoMeasureOverlay,
    previewAutoMeasureOverlay,
    setPreviewAutoMeasureOverlay,
    autoMeasureClearNonce,
    setAutoMeasureClearNonce,
    autoMeasureSessionActive,
    setAutoMeasureSessionActive,
    autoMeasureCapturedFrameId,
    setAutoMeasureCapturedFrameId,
    displayedAutoMeasureGraphics,
    displayedAutoMeasureSource,
    displayedAutoMeasureGraphicsRef,
  };
}
