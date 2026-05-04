import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { colors } from '@/theme/theme';
import type { AutoMeasureCorners, AutoMeasureGraphics } from '@/types/autoMeasure';
import { displayToImage, getImagePlacement, imageToDisplay } from '@/utils/manualMeasure';
import type { ManualMeasureImageSize } from '@/utils/manualMeasureOverlayCanvas';
import type { Point } from '@/types/tool';

// Four long yellow guide lines, identical metaphor to ManualMeasureOverlay:
//   - vertical line at LEFT corner's x   (full height)
//   - vertical line at RIGHT corner's x  (full height)
//   - horizontal line at TOP corner's y  (full width)
//   - horizontal line at BOTTOM corner's y (full width)
// Each line has ONE degree of freedom; corner handles snap to their owning
// line. D1 = right.x - left.x (in image pixels), D2 = bottom.y - top.y.

type CornerKey = keyof AutoMeasureCorners;
type LineKey = 'left' | 'right' | 'top' | 'bottom';

const CORNER_KEYS: CornerKey[] = ['top', 'right', 'bottom', 'left'];
const VERTICAL_LINES: LineKey[] = ['left', 'right'];
const HORIZONTAL_LINES: LineKey[] = ['top', 'bottom'];

const HANDLE_RADIUS = 7;
const CORNER_HIT_RADIUS = 12;
const LINE_HIT_DISTANCE = 6;

type Props = {
  graphics: AutoMeasureGraphics | null;
  imageSize: ManualMeasureImageSize | null;
  interactive?: boolean;
  /** Called while/after the user drags. Corners are in IMAGE coords. */
  onAdjusted?: (corners: AutoMeasureCorners) => void;
};

const ROOT_SX: SxProps<Theme> = {
  position: 'absolute',
  inset: 0,
};

const CANVAS_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
};

const LABEL_BG = 'rgba(0, 0, 0, 0.68)';
const HANDLE_STROKE = 'rgba(0, 0, 0, 0.9)';
const FONT = '12px Consolas, ui-monospace, monospace';

type DragState = {
  kind: 'line' | 'corner';
  line: LineKey;
  pointerId: number;
  startCorners: AutoMeasureCorners;
  startPointerImage: Point;
};

function clonePoint(p: Point): Point {
  return { x: p.x, y: p.y };
}

function cloneCorners(c: AutoMeasureCorners): AutoMeasureCorners {
  return {
    top: clonePoint(c.top),
    right: clonePoint(c.right),
    bottom: clonePoint(c.bottom),
    left: clonePoint(c.left),
  };
}

function drawHandle(ctx: CanvasRenderingContext2D, point: Point, hot: boolean) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, HANDLE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = hot ? '#FFFFFF' : colors.autoMeasureLine;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = HANDLE_STROKE;
  ctx.stroke();
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, at: Point) {
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(text).width;
  const x = at.x + 8;
  const y = at.y - 8;
  ctx.fillStyle = LABEL_BG;
  ctx.fillRect(x - 4, y - 9, textWidth + 8, 18);
  ctx.fillStyle = colors.autoMeasureLine;
  ctx.fillText(text, x, y);
}

function AutoMeasureOverlayImpl({
  graphics,
  imageSize,
  interactive: interactiveProp = true,
  onAdjusted,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [localCorners, setLocalCorners] = useState<AutoMeasureCorners | null>(null);
  const [hover, setHover] = useState<{ kind: 'line' | 'corner'; line: LineKey } | null>(null);

  // Reset local override when upstream graphics replace (only if not dragging).
  useEffect(() => {
    if (dragRef.current) return;
    setLocalCorners(graphics ? cloneCorners(graphics.corners) : null);
  }, [graphics]);

  const corners = localCorners ?? graphics?.corners ?? null;

  const draw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      const targetW = Math.round(width * dpr);
      const targetH = Math.round(height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (!corners || !imageSize) return;
      const placement = getImagePlacement(width, height, imageSize);
      if (!placement) return;

      const top = imageToDisplay(corners.top, placement);
      const right = imageToDisplay(corners.right, placement);
      const bottom = imageToDisplay(corners.bottom, placement);
      const left = imageToDisplay(corners.left, placement);

      // 4 long yellow lines (manual-measure style).
      ctx.strokeStyle = colors.autoMeasureLine;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      // Verticals
      ctx.moveTo(left.x, 0);
      ctx.lineTo(left.x, height);
      ctx.moveTo(right.x, 0);
      ctx.lineTo(right.x, height);
      // Horizontals
      ctx.moveTo(0, top.y);
      ctx.lineTo(width, top.y);
      ctx.moveTo(0, bottom.y);
      ctx.lineTo(width, bottom.y);
      ctx.stroke();

      // Diagonals (subtle, dashed; informational only).
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(255, 235, 59, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Corner handles sit on their owning line (snapped to it visually too).
      drawHandle(ctx, top, hover?.kind === 'corner' && hover.line === 'top');
      drawHandle(ctx, right, hover?.kind === 'corner' && hover.line === 'right');
      drawHandle(ctx, bottom, hover?.kind === 'corner' && hover.line === 'bottom');
      drawHandle(ctx, left, hover?.kind === 'corner' && hover.line === 'left');

      drawLabel(ctx, 'D1', {
        x: (left.x + right.x) / 2,
        y: (left.y + right.y) / 2 + 12,
      });
      drawLabel(ctx, 'D2', {
        x: top.x,
        y: top.y + (bottom.y - top.y) * 0.35,
      });
    });
  }, [corners, hover, imageSize]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    draw();
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(wrap);
    return () => {
      resizeObserver.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  const getDisplayPoint = useCallback((event: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const toImagePoint = useCallback(
    (display: Point): Point | null => {
      if (!imageSize) return null;
      const wrap = wrapRef.current;
      if (!wrap) return null;
      const placement = getImagePlacement(wrap.clientWidth, wrap.clientHeight, imageSize);
      if (!placement) return null;
      return displayToImage(display, placement, imageSize);
    },
    [imageSize]
  );

  const hitTest = useCallback(
    (display: Point): { kind: 'line' | 'corner'; line: LineKey } | null => {
      if (!corners || !imageSize) return null;
      const wrap = wrapRef.current;
      if (!wrap) return null;
      const placement = getImagePlacement(wrap.clientWidth, wrap.clientHeight, imageSize);
      if (!placement) return null;

      // Corner handles win over lines when overlapping.
      for (const key of CORNER_KEYS) {
        const p = imageToDisplay(corners[key], placement);
        if (Math.hypot(display.x - p.x, display.y - p.y) <= CORNER_HIT_RADIUS) {
          return { kind: 'corner', line: key };
        }
      }
      const top = imageToDisplay(corners.top, placement);
      const right = imageToDisplay(corners.right, placement);
      const bottom = imageToDisplay(corners.bottom, placement);
      const left = imageToDisplay(corners.left, placement);
      if (Math.abs(display.x - left.x) <= LINE_HIT_DISTANCE) return { kind: 'line', line: 'left' };
      if (Math.abs(display.x - right.x) <= LINE_HIT_DISTANCE) return { kind: 'line', line: 'right' };
      if (Math.abs(display.y - top.y) <= LINE_HIT_DISTANCE) return { kind: 'line', line: 'top' };
      if (Math.abs(display.y - bottom.y) <= LINE_HIT_DISTANCE) return { kind: 'line', line: 'bottom' };
      return null;
    },
    [corners, imageSize]
  );

  // Apply a 1-D drag offset (image coords) to the chosen line, recomputing all
  // 4 corners so they stay snapped to their owning lines (Vickers geometry).
  const applyLineDelta = useCallback(
    (line: LineKey, dxImg: number, dyImg: number, base: AutoMeasureCorners): AutoMeasureCorners => {
      const next = cloneCorners(base);
      const w = imageSize?.width ?? Number.POSITIVE_INFINITY;
      const h = imageSize?.height ?? Number.POSITIVE_INFINITY;

      if (line === 'left') {
        const x = Math.max(0, Math.min(w, base.left.x + dxImg));
        next.left.x = x;
      } else if (line === 'right') {
        const x = Math.max(0, Math.min(w, base.right.x + dxImg));
        next.right.x = x;
      } else if (line === 'top') {
        const y = Math.max(0, Math.min(h, base.top.y + dyImg));
        next.top.y = y;
      } else if (line === 'bottom') {
        const y = Math.max(0, Math.min(h, base.bottom.y + dyImg));
        next.bottom.y = y;
      }

      // Re-snap diamond corners to the bounding-box centerline metaphor:
      // top/bottom share centerX; left/right share centerY.
      const centerX = (next.left.x + next.right.x) / 2;
      const centerY = (next.top.y + next.bottom.y) / 2;
      next.top.x = centerX;
      next.bottom.x = centerX;
      next.left.y = centerY;
      next.right.y = centerY;
      return next;
    },
    [imageSize]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const display = getDisplayPoint(event);
      const drag = dragRef.current;
      if (drag) {
        const nowImg = toImagePoint(display);
        if (!nowImg) return;
        const dx = nowImg.x - drag.startPointerImage.x;
        const dy = nowImg.y - drag.startPointerImage.y;
        const next = applyLineDelta(drag.line, dx, dy, drag.startCorners);
        setLocalCorners(next);
        onAdjusted?.(next);
        return;
      }

      const hit = hitTest(display);
      if (!hit) {
        if (hover) setHover(null);
        return;
      }
      if (!hover || hover.kind !== hit.kind || hover.line !== hit.line) {
        setHover({ kind: hit.kind, line: hit.line });
      }
    },
    [applyLineDelta, getDisplayPoint, hitTest, hover, onAdjusted, toImagePoint]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (!corners) return;
      const display = getDisplayPoint(event);
      const hit = hitTest(display);
      if (!hit) return;
      const startPointerImage = toImagePoint(display);
      if (!startPointerImage) return;
      event.preventDefault();
      wrapRef.current?.setPointerCapture(event.pointerId);
      // eslint-disable-next-line no-console
      console.log('[auto-measure] adjust start', {
        kind: hit.kind,
        line: hit.line,
        corners,
      });
      dragRef.current = {
        kind: hit.kind,
        line: hit.line,
        pointerId: event.pointerId,
        startCorners: cloneCorners(corners),
        startPointerImage,
      };
    },
    [corners, getDisplayPoint, hitTest, toImagePoint]
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const wrap = wrapRef.current;
      if (wrap?.hasPointerCapture(event.pointerId)) {
        wrap.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
      const finalCorners = localCorners;
      if (finalCorners) {
        const before = drag.startCorners;
        const beforeD1 = before.right.x - before.left.x;
        const beforeD2 = before.bottom.y - before.top.y;
        const afterD1 = finalCorners.right.x - finalCorners.left.x;
        const afterD2 = finalCorners.bottom.y - finalCorners.top.y;
        // eslint-disable-next-line no-console
        console.log('[auto-measure] adjust end', {
          line: drag.line,
          before,
          after: finalCorners,
          d1Delta: afterD1 - beforeD1,
          d2Delta: afterD2 - beforeD2,
          d1Px: afterD1,
          d2Px: afterD2,
        });
        onAdjusted?.(finalCorners);
      }
    },
    [localCorners, onAdjusted]
  );

  // Cursor: vertical lines → ew-resize, horizontal lines → ns-resize, corners →
  // resize indicator matching the line they belong to.
  const cursor = (() => {
    const active = dragRef.current ? { line: dragRef.current.line } : hover ? { line: hover.line } : null;
    if (!active) return 'default';
    if (VERTICAL_LINES.includes(active.line)) return 'ew-resize';
    if (HORIZONTAL_LINES.includes(active.line)) return 'ns-resize';
    return 'move';
  })();

  const interactive = corners !== null && interactiveProp;

  return (
    <Box
      ref={wrapRef}
      sx={{
        ...ROOT_SX,
        pointerEvents: interactive ? 'auto' : 'none',
        cursor,
      }}
      onPointerDown={interactive ? handlePointerDown : undefined}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerUp={interactive ? endDrag : undefined}
      onPointerCancel={interactive ? endDrag : undefined}
      onPointerLeave={interactive ? () => setHover(null) : undefined}
    >
      <canvas ref={canvasRef} style={CANVAS_STYLE} />
    </Box>
  );
}

export default memo(AutoMeasureOverlayImpl);
