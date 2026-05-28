import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { DialogKey } from '@/contexts/DialogContext';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';

type UseOverlayLifecycleParams = {
  cameraOpen: boolean;
  activeDialog: DialogKey;
  turretMoving: boolean;
  objectiveChangeInProgress: boolean;
  activeObjective: string | null;
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

// Owns the Auto Measure overlay lifecycle state and the hard render gate that
// decides whether the yellow overlay paints. Deliberately does NOT own
// clearAutoMeasureOverlay — that teardown also nulls controller/measurement/
// camera-frame refs which stay in App.tsx, so it consumes the setters returned
// here instead. Behavior is identical to the previous in-App implementation.
export function useOverlayLifecycle({
  cameraOpen,
  activeDialog,
  turretMoving,
  objectiveChangeInProgress,
  activeObjective,
}: UseOverlayLifecycleParams): UseOverlayLifecycleResult {
  const [committedAutoMeasureOverlay, setCommittedAutoMeasureOverlay] =
    useState<AutoMeasureGraphics | null>(null);
  const [previewAutoMeasureOverlay, setPreviewAutoMeasureOverlay] =
    useState<AutoMeasureGraphics | null>(null);
  // Bump-counter that forces AutoMeasureOverlay to imperatively clearRect its
  // canvas (bypassing React state and the skip-redraw cache). Incremented on
  // every objective change so no stale yellow lines from the prior mag survive
  // into the next session.
  const [autoMeasureClearNonce, setAutoMeasureClearNonce] = useState(0);
  const [autoMeasureSessionActive, setAutoMeasureSessionActive] = useState(false);
  const [autoMeasureCapturedFrameId, setAutoMeasureCapturedFrameId] = useState<number | null>(null);

  const displayedAutoMeasureGraphicsRef = useRef<AutoMeasureGraphics | null>(null);

  const rawDisplayedAutoMeasureGraphics =
    activeDialog === 'autoMeasure'
      ? previewAutoMeasureOverlay ?? committedAutoMeasureOverlay
      : committedAutoMeasureOverlay;
  // Suppress overlay output entirely while the turret/objective is moving.
  // The state-clear in markTurretIntent already nulls the underlying
  // overlays, but a stale render (or an in-flight detection result landing
  // mid-motion) must not paint a yellow line on top of the moving image.
  const turretMovingGuardedGraphics = turretMoving ? null : rawDisplayedAutoMeasureGraphics;
  const displayedAutoMeasureSource: 'auto' | 'preview' | 'save' =
    activeDialog === 'autoMeasure' && previewAutoMeasureOverlay ? 'preview' : 'auto';

  // Hard render gate for the yellow Auto Measure overlay. Never show yellow
  // lines/dots unless the camera is streaming. Also drops graphics whose
  // detection-time objective no longer matches the live activeObjective so a
  // 40X overlay can never linger after a switch to 10X (and vice versa).
  const lastOverlayRenderLogRef = useRef<string | null>(null);
  const displayedAutoMeasureGraphics = (() => {
    if (!cameraOpen) return null;
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
