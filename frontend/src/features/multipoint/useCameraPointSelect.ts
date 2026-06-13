import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { selectCameraPointPhase } from '@/store/slices/multipoint.selectors';
import {
  appendFreePoint,
  endCameraPointSelect,
  setCameraPointMoving,
} from '@/store/slices/multipoint.slice';
import { useXyzPlatformHardware } from '@/features/xyzPlatform/useXyzPlatformHardware';
import { STAGE_X_TO_SCREEN, STAGE_Y_TO_SCREEN } from '@/component/own/PatternOverlay';

// Stable per-point id (selection + React keys); local counter, session-unique —
// same scheme as useMultipoint's captured/entered points.
let cameraPointIdCounter = 0;
function createCameraPointId(): string {
  cameraPointIdCounter += 1;
  return `cp-${Date.now().toString(36)}-${cameraPointIdCounter}`;
}

type Point = { x: number; y: number };
type ImageSize = { width: number; height: number };

type Args = {
  /** Active objective calibration in microns per IMAGE pixel; null when uncalibrated. */
  umPerPixel: number | null;
  /** Global status-bar setter so move/error feedback reaches the operator. */
  setStatusMessage: (message: string) => void;
};

export type CameraPointSelect = {
  /** True only while waiting for a camera click (crosshair + click capture on). */
  selecting: boolean;
  /** Centered hint shown on the camera while selecting / moving; null when idle. */
  hint: string | null;
  /** Handle one in-bounds camera click: convert → move (RX-gated) → capture actual position. */
  handlePick: (imagePoint: Point, imageSize: ImageSize) => Promise<void>;
};

/**
 * Camera-click point-selection orchestration (Free/Midpoint "Pick on Camera").
 * Drives the shared `cameraPointPhase` state machine the right-panel button arms:
 *
 *   selecting → (camera click) → convert px→mm → moveByOffsetMm (RX-gated) →
 *   read ACTUAL landed mm → append free point → idle
 *
 * The optical axis is FIXED and the sample moves, so a click at image-pixel offset
 * (dx, dy) from the image centre is brought to the objective by nudging the stage
 * the equivalent mm in the inverse of the overlay's stage→screen axis convention.
 * Movement reuses the existing backend relocation engine (no new protocol); the
 * stored coordinate is the real post-move position, never the theoretical target.
 */
export function useCameraPointSelect({ umPerPixel, setStatusMessage }: Args): CameraPointSelect {
  const dispatch = useAppDispatch();
  const phase = useAppSelector(selectCameraPointPhase);
  const hardware = useXyzPlatformHardware();

  const handlePick = useCallback(
    async (imagePoint: Point, imageSize: ImageSize) => {
      if (phase !== 'selecting') return;
      if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) return;

      if (umPerPixel == null || !(umPerPixel > 0)) {
        // eslint-disable-next-line no-console
        console.warn('[camera-click] reason=no-calibration — cannot convert pixels to mm');
        setStatusMessage('Camera is not calibrated for the active objective — cannot convert the click to a stage move.');
        dispatch(endCameraPointSelect());
        return;
      }

      const dxPx = imagePoint.x - imageSize.width / 2;
      const dyPx = imagePoint.y - imageSize.height / 2;
      // eslint-disable-next-line no-console
      console.log(`[camera-click] pixelX=${Math.round(imagePoint.x)} pixelY=${Math.round(imagePoint.y)}`);

      // Invert the overlay's stage→screen signs: a feature seen at +dxPx (right of
      // centre) is centred by moving the stage so the scene shifts left, etc.
      const offsetXmm = (dxPx / STAGE_X_TO_SCREEN) * (umPerPixel / 1000);
      const offsetYmm = (dyPx / STAGE_Y_TO_SCREEN) * (umPerPixel / 1000);
      // eslint-disable-next-line no-console
      console.log(`[pixel-to-mm] offsetX=${offsetXmm.toFixed(4)} offsetY=${offsetYmm.toFixed(4)}`);

      dispatch(setCameraPointMoving());
      setStatusMessage('Moving stage to the selected location…');
      // eslint-disable-next-line no-console
      console.log(`[move-to-point] targetX=${offsetXmm.toFixed(4)} targetY=${offsetYmm.toFixed(4)} (mm delta from current position)`);

      try {
        const result = await hardware.moveByOffsetMm(offsetXmm, offsetYmm);
        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.warn(`[camera-click] move failed error=${JSON.stringify(result.error)} message=${JSON.stringify(result.message ?? null)}`);
          setStatusMessage(`Stage move failed: ${result.message ?? result.error}`);
          return;
        }
        // eslint-disable-next-line no-console
        console.log('[motion-complete]');
        // Store the ACTUAL landed position (backend-derived mm), never the target.
        const mm = result.positionMm;
        if (!mm) {
          setStatusMessage('Stage moved, but the landed position was unavailable — point not added.');
          return;
        }
        const point = { id: createCameraPointId(), x: mm.x, y: mm.y };
        dispatch(appendFreePoint(point));
        // eslint-disable-next-line no-console
        console.log(`[point-added] x=${mm.x} y=${mm.y}`);
        setStatusMessage(`Added point at (${mm.x.toFixed(3)}, ${mm.y.toFixed(3)}).`);
      } finally {
        dispatch(endCameraPointSelect());
      }
    },
    [phase, umPerPixel, hardware, dispatch, setStatusMessage]
  );

  const hint = useMemo(
    () =>
      phase === 'selecting'
        ? 'Click a location in the camera'
        : phase === 'moving'
          ? 'Moving stage…'
          : null,
    [phase]
  );

  return { selecting: phase === 'selecting', hint, handlePick };
}
