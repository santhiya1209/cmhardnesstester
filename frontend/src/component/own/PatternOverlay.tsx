import { memo, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { useAppSelector } from '@/store/hooks';
import {
  selectActivePointId,
  selectGeneratedPoints,
  selectSelectedPointIds,
} from '@/store/slices/multipoint.selectors';
import { useXyzStageState } from '@/hooks/queries/useXyzStageState';
import { getImagePlacement } from '@/utils/manualMeasure';
import { tokens } from '@/theme/theme';

/**
 * Live multipoint overlay painted on top of the camera image. It draws:
 *  - the generated pattern points (cyan dots; selected = amber; the point being
 *    moved to during Start = green ring), and
 *  - a distinct "current stage position" marker.
 *
 * Coordinate model — the optical axis is FIXED and the sample moves on the XY
 * stage, so the point currently under the objective is always the centre of the
 * live image. A pattern point at absolute stage position Q therefore appears
 * offset from the image centre by (Q − currentStagePosition), in mm, converted
 * to image pixels via the active objective's calibration (`umPerPixel`) and then
 * to display pixels via the letterbox `placement.scale`. Because the offset is
 * measured against the live `positionMm`, every dot tracks in real time while
 * jogging, during move-to-point, and during pattern execution — and the current
 * position marker stays at the centre by construction.
 *
 * Stage→screen axis orientation is hardware-dependent and cannot be derived from
 * code. The generator's convention is "X grows right, Y grows up"; canvas Y
 * grows down, so Y is negated. The two signs below are the single place to flip
 * after a hardware check if a pattern previews mirrored/upside-down.
 */
const STAGE_X_TO_SCREEN = 1; // stage +X → screen +X (right)
const STAGE_Y_TO_SCREEN = -1; // stage +Y → screen −Y (up)

const POINT_RADIUS = 4;
const ACTIVE_RING_RADIUS = 8;
const LIVE_MARKER_RADIUS = 9;
const LIVE_CROSS_HALF = 14;

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

type ImageSize = { width: number; height: number };

type Props = {
  /** Native size of the live camera image (same value CameraWindow feeds the other overlays). */
  imageSize: ImageSize | null;
  /** Active objective calibration in microns per IMAGE pixel; null when uncalibrated. */
  umPerPixel?: number | null;
};

let lastDiagKey = '';

function PatternOverlayImpl({ imageSize, umPerPixel = null }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [resizeTick, setResizeTick] = useState(0);

  const points = useAppSelector(selectGeneratedPoints);
  const selectedIds = useAppSelector(selectSelectedPointIds);
  const activePointId = useAppSelector(selectActivePointId);
  const { positionMm, positionKnown } = useXyzStageState();

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

    if (!positionKnown || !imageSize || imageSize.width <= 0 || imageSize.height <= 0) return;
    const placement = getImagePlacement(wCss, hCss, imageSize);
    if (!placement) return;

    const centerX = placement.offsetX + placement.width / 2;
    const centerY = placement.offsetY + placement.height / 2;
    // mm → display px: image px per mm × letterbox scale.
    const dispPxPerMm =
      umPerPixel && umPerPixel > 0 ? (1000 / umPerPixel) * placement.scale : null;

    // Clip to the displayed image rect so dots outside the field of view don't
    // bleed onto the black letterbox padding.
    ctx.save();
    ctx.beginPath();
    ctx.rect(placement.offsetX, placement.offsetY, placement.width, placement.height);
    ctx.clip();

    let firstScreen: { x: number; y: number } | null = null;
    if (dispPxPerMm !== null) {
      const selected = new Set(selectedIds);
      for (const p of points) {
        const sx = centerX + STAGE_X_TO_SCREEN * (p.x - positionMm.x) * dispPxPerMm;
        const sy = centerY + STAGE_Y_TO_SCREEN * (p.y - positionMm.y) * dispPxPerMm;
        if (firstScreen === null) firstScreen = { x: sx, y: sy };

        const isActive = p.id === activePointId;
        ctx.beginPath();
        ctx.arc(sx, sy, POINT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = selected.has(p.id)
          ? tokens.overlay.patternPointSelected
          : tokens.overlay.patternPoint;
        ctx.fill();

        if (isActive) {
          ctx.beginPath();
          ctx.arc(sx, sy, ACTIVE_RING_RADIUS, 0, Math.PI * 2);
          ctx.strokeStyle = tokens.overlay.patternPointActive;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    // Current stage position — always the centre of the live image.
    ctx.strokeStyle = tokens.overlay.livePosition;
    ctx.fillStyle = tokens.overlay.livePosition;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - LIVE_CROSS_HALF, centerY);
    ctx.lineTo(centerX + LIVE_CROSS_HALF, centerY);
    ctx.moveTo(centerX, centerY - LIVE_CROSS_HALF);
    ctx.lineTo(centerX, centerY + LIVE_CROSS_HALF);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, centerY, LIVE_MARKER_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
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
  }, [points, selectedIds, activePointId, positionMm.x, positionMm.y, positionKnown, imageSize, umPerPixel, resizeTick]);

  return (
    <Box ref={wrapRef} sx={ROOT_SX}>
      <canvas ref={canvasRef} style={CANVAS_STYLE} />
    </Box>
  );
}

export default memo(PatternOverlayImpl);
