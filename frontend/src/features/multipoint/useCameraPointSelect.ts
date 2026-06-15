import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { selectCameraPointPhase } from '@/store/slices/multipoint.selectors';
import { appendFreePoint, endCameraPointSelect } from '@/store/slices/multipoint.slice';
import { useXyzStageState } from '@/hooks/queries/useXyzStageState';
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
  /** Centered hint shown on the camera while selecting; null when idle. */
  hint: string | null;
  /** Handle one in-bounds camera click: convert px→mm → compute clicked coordinate → append point. */
  handlePick: (imagePoint: Point, imageSize: ImageSize) => void;
};

/**
 * Camera-click point-selection orchestration (Multipoint "Add Point").
 * Drives the shared `cameraPointPhase` the right-panel button arms:
 *
 *   selecting → (camera click) → convert px→mm → add (currentStagePos + offset)
 *   as an ABSOLUTE free point → idle
 *
 * The optical axis is FIXED and the sample moves, so the feature under the
 * objective is always the image centre at the live stage position. A click at
 * image-pixel offset (dx, dy) from the centre therefore corresponds to the stage
 * coordinate `positionMm + (dx, dy)→mm`, using the SAME stage→screen axis
 * convention the overlay draws with (so the click maps to where a dot would be).
 * The stage is NOT moved — the stored coordinate is the clicked LOCATION, not the
 * current stage position. Coordinates are absolute mm, consistent with every other
 * reference/free row; the table renders them relative to the relocation centre.
 */
export function useCameraPointSelect({ umPerPixel, setStatusMessage }: Args): CameraPointSelect {
  const dispatch = useAppDispatch();
  const phase = useAppSelector(selectCameraPointPhase);
  const stage = useXyzStageState();

  const handlePick = useCallback(
    (imagePoint: Point, imageSize: ImageSize) => {
      if (phase !== 'selecting') return;
      if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) return;

      if (umPerPixel == null || !(umPerPixel > 0)) {
        // eslint-disable-next-line no-console
        console.warn('[camera-click] reason=no-calibration — cannot convert pixels to mm');
        setStatusMessage('Camera is not calibrated for the active objective — cannot convert the click to a coordinate.');
        dispatch(endCameraPointSelect());
        return;
      }
      // The clicked coordinate is anchored to the live stage position; without a
      // known position there is no absolute frame to place the point in.
      if (!stage.positionKnown) {
        // eslint-disable-next-line no-console
        console.warn('[camera-click] reason=position-unknown — cannot anchor the clicked coordinate');
        setStatusMessage('Stage position unknown — connect and home the platform first.');
        dispatch(endCameraPointSelect());
        return;
      }

      const dxPx = imagePoint.x - imageSize.width / 2;
      const dyPx = imagePoint.y - imageSize.height / 2;
      // eslint-disable-next-line no-console
      console.log(`[camera-click] pixelX=${Math.round(imagePoint.x)} pixelY=${Math.round(imagePoint.y)}`);

      // Same stage→screen signs the overlay draws with: a feature drawn at screen
      // offset s sits at stage offset s/STAGE_*_TO_SCREEN from the image centre.
      const offsetXmm = (dxPx / STAGE_X_TO_SCREEN) * (umPerPixel / 1000);
      const offsetYmm = (dyPx / STAGE_Y_TO_SCREEN) * (umPerPixel / 1000);
      // eslint-disable-next-line no-console
      console.log(`[pixel-to-mm] offsetX=${offsetXmm.toFixed(5)} offsetY=${offsetYmm.toFixed(5)}`);

      // Clicked LOCATION = live stage centre + pixel offset (absolute mm). No move.
      const x = stage.positionMm.x + offsetXmm;
      const y = stage.positionMm.y + offsetYmm;
      const point = { id: createCameraPointId(), x, y };
      dispatch(appendFreePoint(point));
      // eslint-disable-next-line no-console
      console.log(`[point-added] x=${x.toFixed(5)} y=${y.toFixed(5)} source=camera-click stagePos=(${stage.positionMm.x.toFixed(5)},${stage.positionMm.y.toFixed(5)})`);
      setStatusMessage(`Added point at the selected location (${offsetXmm.toFixed(5)}, ${offsetYmm.toFixed(5)} mm from centre).`);
      dispatch(endCameraPointSelect());
    },
    [phase, umPerPixel, stage.positionKnown, stage.positionMm.x, stage.positionMm.y, dispatch, setStatusMessage]
  );

  const hint = useMemo(
    () => (phase === 'selecting' ? 'Click a location in the camera' : null),
    [phase]
  );

  return { selecting: phase === 'selecting', hint, handlePick };
}
