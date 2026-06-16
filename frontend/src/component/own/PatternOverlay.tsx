import { memo, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { useAppSelector } from '@/store/hooks';
import {
  selectActivePointId,
  selectCompletedPointIds,
  selectFreePoints,
  selectGeneratedPoints,
  selectRefX,
  selectRefY,
  selectReferencePicked,
  selectSelectedPointIds,
} from '@/store/slices/multipoint.selectors';
import { selectExecPhase } from '@/store/slices/multipointExecution.selectors';
import { useXyzStageState } from '@/hooks/queries/useXyzStageState';
import { getImagePlacement } from '@/utils/manualMeasure';
import { tokens } from '@/theme/theme';

/**
 * Live multipoint overlay painted on top of the camera image. It draws:
 *  - connecting lines along the generated execution order, and
 *  - the generated pattern points as numbered dots in their execution tri-state
 *    (current = red, completed = green, pending = white; an amber ring marks a
 *    preview-table selection).
 *
 * It deliberately draws no centre/current-position marker — the crosshair
 * reticle (ImageOverlay.drawCross) is the sole image-centre reference, keeping
 * the crosshair and pattern overlays visually independent.
 *
 * Coordinate model — the optical axis is FIXED and the sample moves on the XY
 * stage, so the point currently under the objective is always the centre of the
 * live image. A pattern point at absolute stage position Q therefore appears
 * offset from the image centre by (Q − currentStagePosition), in mm, converted
 * to image pixels via the active objective's calibration (`umPerPixel`) and then
 * to display pixels via the letterbox `placement.scale`. Because the offset is
 * measured against the live `positionMm`, every dot tracks in real time while
 * jogging, during move-to-point, and during pattern execution.
 *
 * Stage→screen axis orientation is hardware-dependent and cannot be derived from
 * code. The generator's convention is "X grows right, Y grows up"; canvas Y
 * grows down, so Y is negated. The two signs below are the single place to flip
 * after a hardware check if a pattern previews mirrored/upside-down.
 */
// Exported as the single source of truth for the stage↔screen axis convention:
// the camera-click point-selection conversion (useCameraPointSelect) inverts the
// SAME signs, so a click maps to where a dot would be drawn. Flip here after a
// hardware check if a pattern previews mirrored/upside-down.
export const STAGE_X_TO_SCREEN = 1; // stage +X → screen +X (right)
export const STAGE_Y_TO_SCREEN = -1; // stage +Y → screen −Y (up)

const POINT_RADIUS = 4;
const ACTIVE_RING_RADIUS = 8;

const ROOT_SX: SxProps<Theme> = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
};

const CANVAS_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
};

const WARNING_SX: SxProps<Theme> = {
  position: 'absolute',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  maxWidth: '90%',
  pointerEvents: 'none',
};

type ImageSize = { width: number; height: number };

type Props = {
  /** Native size of the live camera image (same value CameraWindow feeds the other overlays). */
  imageSize: ImageSize | null;
  /** Active objective calibration in microns per IMAGE pixel; null when uncalibrated. */
  umPerPixel?: number | null;
  /**
   * When false the pattern dots are not drawn (the canvas is wiped) so the
   * multipoint overlay never mixes with an exclusive measurement mode such as
   * Manual Measure. The generated pattern stays in Redux — only the paint is
   * suppressed — so returning to the Multipoint tab shows it again.
   */
  active?: boolean;
};

let lastDiagKey = '';

function PatternOverlayImpl({ imageSize, umPerPixel = null, active = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [resizeTick, setResizeTick] = useState(0);

  const points = useAppSelector(selectGeneratedPoints);
  const freePoints = useAppSelector(selectFreePoints);
  const selectedIds = useAppSelector(selectSelectedPointIds);
  const activePointId = useAppSelector(selectActivePointId);
  const completedIds = useAppSelector(selectCompletedPointIds);
  const referencePicked = useAppSelector(selectReferencePicked);
  const refX = useAppSelector(selectRefX);
  const refY = useAppSelector(selectRefY);
  // Execution phase is read ONLY for the diagnostic log + to prove the overlay's
  // visibility is NOT gated on it — the dots/lines render from `points`
  // (generatedPoints), so a Completed run never hides them.
  const phase = useAppSelector(selectExecPhase);
  const { positionMm, positionKnown } = useXyzStageState();

  // Retain the last valid calibration scale. The pattern (points, connecting
  // lines, labels) needs a mm→pixel scale to be placed, so it is drawn only when
  // a `umPerPixel` is known. That value can transiently drop to null while the
  // objective/turret/calibration state churns — notably the end-of-cycle turret
  // return — which would otherwise blank an intact pattern the instant a run
  // completes. Holding the last good scale keeps points/lines/labels visible
  // across such a blip; a genuine objective change replaces it with the new
  // valid value on the next render.
  const [stableUmPerPixel, setStableUmPerPixel] = useState<number | null>(null);
  useEffect(() => {
    if (umPerPixel && umPerPixel > 0) setStableUmPerPixel(umPerPixel);
  }, [umPerPixel]);
  const effectiveUmPerPixel = umPerPixel && umPerPixel > 0 ? umPerPixel : stableUmPerPixel;

  // Requested diagnostic: prove the point list survives every status transition
  // (Generate → Running → Completed all keep the same length; only Reset/Clear
  // empties it). Logged on change of count or phase, not per frame.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[OVERLAY] generatedPoints', points.length);
    // eslint-disable-next-line no-console
    console.log('[OVERLAY] status', phase);
  }, [points.length, phase]);

  // DPR-aware backing store, matching ImageOverlay so dots stay crisp and the
  // canvas never blurs on monitor-scale changes or window resize.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const apply = () => {
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.max(1, Math.round(wrap.clientWidth * dpr));
      const targetH = Math.max(1, Math.round(wrap.clientHeight * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        setResizeTick((t) => t + 1);
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const wCss = canvas.width / dpr;
    const hCss = canvas.height / dpr;
    ctx.clearRect(0, 0, wCss, hCss);

    if (!active) return;
    if (!positionKnown || !imageSize || imageSize.width <= 0 || imageSize.height <= 0) return;
    const placement = getImagePlacement(wCss, hCss, imageSize);
    if (!placement) return;

    const centerX = placement.offsetX + placement.width / 2;
    const centerY = placement.offsetY + placement.height / 2;
    // mm → display px: image px per mm × letterbox scale. Uses the retained scale
    // so a transient null (e.g. objective churn at run completion) does not blank
    // the pattern; the points themselves come from `points` regardless.
    const dispPxPerMm =
      effectiveUmPerPixel && effectiveUmPerPixel > 0 ? (1000 / effectiveUmPerPixel) * placement.scale : null;

    // Clip to the displayed image rect so dots outside the field of view don't
    // bleed onto the black letterbox padding.
    ctx.save();
    ctx.beginPath();
    ctx.rect(placement.offsetX, placement.offsetY, placement.width, placement.height);
    ctx.clip();

    let firstScreen: { x: number; y: number } | null = null;
    if (dispPxPerMm !== null) {
      const selected = new Set(selectedIds);
      const completed = new Set(completedIds);
      const screen = points.map((p) => ({
        p,
        x: centerX + STAGE_X_TO_SCREEN * (p.x - positionMm.x) * dispPxPerMm,
        y: centerY + STAGE_Y_TO_SCREEN * (p.y - positionMm.y) * dispPxPerMm,
      }));
      if (screen.length > 0) firstScreen = { x: screen[0].x, y: screen[0].y };

      ctx.font = '10px sans-serif';
      ctx.textBaseline = 'middle';

      // Connectors grouped by source line, drawn first so the dots sit on top.
      // Points with no `line` (every non-multiline mode) share one group, so the
      // single-polyline behaviour is preserved; MultiLine Composite breaks the
      // path between lines and tags each line head with an "L<n>" label.
      let groupStart = 0;
      while (groupStart < screen.length) {
        const lineId = screen[groupStart].p.line;
        let groupEnd = groupStart + 1;
        while (groupEnd < screen.length && screen[groupEnd].p.line === lineId) groupEnd += 1;
        if (groupEnd - groupStart > 1) {
          ctx.beginPath();
          ctx.moveTo(screen[groupStart].x, screen[groupStart].y);
          for (let k = groupStart + 1; k < groupEnd; k += 1) ctx.lineTo(screen[k].x, screen[k].y);
          ctx.strokeStyle = tokens.overlay.patternConnector;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (lineId !== undefined) {
          ctx.fillStyle = tokens.overlay.patternPointPending;
          ctx.fillText(`L${lineId}`, screen[groupStart].x - 20, screen[groupStart].y);
        }
        groupStart = groupEnd;
      }
      for (const { p, x: sx, y: sy } of screen) {
        const isActive = p.id === activePointId;
        // Execution tri-state: current (red) overrides completed (green) overrides pending (white).
        const fill = isActive
          ? tokens.overlay.patternPointCurrent
          : completed.has(p.id)
            ? tokens.overlay.patternPointCompleted
            : tokens.overlay.patternPointPending;

        ctx.beginPath();
        ctx.arc(sx, sy, POINT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();

        // Amber ring marks a preview-table selection; red ring marks the current point.
        if (selected.has(p.id)) {
          ctx.beginPath();
          ctx.arc(sx, sy, ACTIVE_RING_RADIUS, 0, Math.PI * 2);
          ctx.strokeStyle = tokens.overlay.patternPointSelected;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (isActive) {
          ctx.beginPath();
          ctx.arc(sx, sy, ACTIVE_RING_RADIUS, 0, Math.PI * 2);
          ctx.strokeStyle = tokens.overlay.patternPointCurrent;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.fillStyle = tokens.overlay.patternPointPending;
        ctx.fillText(String(p.no), sx + POINT_RADIUS + 2, sy - POINT_RADIUS - 2);
      }

      // Camera-clicked reference points ("Add Point") — persistent yellow markers
      // at each captured LOCATION. Same absolute-mm → screen transform as the dots
      // (p − live position), so they stay pinned to the sample while the stage
      // jogs. They live in config.freePoints, so a row delete/clear removes them.
      for (const fp of freePoints) {
        if (!Number.isFinite(fp.x) || !Number.isFinite(fp.y)) continue;
        const fx = centerX + STAGE_X_TO_SCREEN * (fp.x - positionMm.x) * dispPxPerMm;
        const fy = centerY + STAGE_Y_TO_SCREEN * (fp.y - positionMm.y) * dispPxPerMm;
        ctx.beginPath();
        ctx.arc(fx, fy, POINT_RADIUS + 1, 0, Math.PI * 2);
        ctx.fillStyle = tokens.overlay.cameraPoint;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.stroke();
      }

      // Camera-picked REFERENCE point (Horizontal/Vertical "Add Point") — the
      // origin every generated point is offset from. Drawn only once a reference
      // has actually been picked this session (referencePicked), so the un-picked
      // 0,0 placeholder shows nothing. A yellow ringed dot + crosshair + "REF"
      // label, pinned to the sample via the same (ref − live position) transform.
      if (referencePicked && refX != null && refY != null && Number.isFinite(refX) && Number.isFinite(refY)) {
        const rx = centerX + STAGE_X_TO_SCREEN * (refX - positionMm.x) * dispPxPerMm;
        const ry = centerY + STAGE_Y_TO_SCREEN * (refY - positionMm.y) * dispPxPerMm;
        ctx.strokeStyle = tokens.overlay.cameraPoint;
        ctx.fillStyle = tokens.overlay.cameraPoint;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rx - ACTIVE_RING_RADIUS, ry);
        ctx.lineTo(rx + ACTIVE_RING_RADIUS, ry);
        ctx.moveTo(rx, ry - ACTIVE_RING_RADIUS);
        ctx.lineTo(rx, ry + ACTIVE_RING_RADIUS);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rx, ry, ACTIVE_RING_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText('REF', rx + ACTIVE_RING_RADIUS + 2, ry - ACTIVE_RING_RADIUS);
      }
    }

    // The image centre = current stage position, but no centre marker is drawn
    // here — the crosshair reticle (ImageOverlay.drawCross) is the sole centre
    // reference, so the pattern layer paints points/lines only.
    ctx.restore();

    // Deduped diagnostic trace (no per-frame spam): position, scale, computed pixels.
    const diagKey = [
      points.length,
      positionMm.x.toFixed(3),
      positionMm.y.toFixed(3),
      umPerPixel ?? 'null',
      Math.round(centerX),
      Math.round(centerY),
      firstScreen ? `${Math.round(firstScreen.x)},${Math.round(firstScreen.y)}` : 'none',
      Math.round(wCss),
      Math.round(hCss),
    ].join('|');
    if (diagKey !== lastDiagKey) {
      lastDiagKey = diagKey;
      // eslint-disable-next-line no-console
      console.log(
        `[pattern-overlay] points=${points.length} posMm=(${positionMm.x.toFixed(3)},${positionMm.y.toFixed(3)}) umPerPixel=${umPerPixel ?? 'null'} dispPxPerMm=${dispPxPerMm?.toFixed(3) ?? 'n/a'} center=(${Math.round(centerX)},${Math.round(centerY)}) firstPx=${firstScreen ? `(${Math.round(firstScreen.x)},${Math.round(firstScreen.y)})` : 'none'} canvas=${Math.round(wCss)}x${Math.round(hCss)} active=${activePointId ?? 'none'}`
      );
    }
  }, [active, points, freePoints, selectedIds, activePointId, completedIds, referencePicked, refX, refY, positionMm.x, positionMm.y, positionKnown, imageSize, effectiveUmPerPixel, resizeTick]);

  // The mm→pixel transform needs the active objective's calibration; without it
  // dispPxPerMm is null and no dots are painted. Surface that explicitly so a
  // populated preview table next to a blank camera reads as "calibrate first",
  // not "broken". Only shown when dots would otherwise be drawn.
  const showCalibrationWarning =
    active &&
    points.length > 0 &&
    positionKnown &&
    !!imageSize &&
    imageSize.width > 0 &&
    imageSize.height > 0 &&
    !(effectiveUmPerPixel && effectiveUmPerPixel > 0);

  return (
    <Box ref={wrapRef} sx={ROOT_SX}>
      <canvas ref={canvasRef} style={CANVAS_STYLE} />
      {showCalibrationWarning ? (
        <Alert severity="warning" variant="filled" sx={WARNING_SX}>
          Calibrate the active objective/force to display the pattern on the camera overlay.
        </Alert>
      ) : null}
    </Box>
  );
}

export default memo(PatternOverlayImpl);
