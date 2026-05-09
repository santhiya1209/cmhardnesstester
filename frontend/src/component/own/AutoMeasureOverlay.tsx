import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import type { AutoMeasureCorners, AutoMeasureGraphics } from '@/types/autoMeasure';
import { displayToImage, getImagePlacement, imageToDisplay } from '@/utils/manualMeasure';
import {
  drawManualMeasureOverlay,
  type ManualMeasureImageSize,
} from '@/utils/manualMeasureOverlayCanvas';
import type { Point } from '@/types/tool';

// Frozen auto-measure overlay: detected Vickers tips are displayed using the
// same guide-line style as Manual Measure.

type CornerKey = keyof AutoMeasureCorners;
type LineKey = 'left' | 'right' | 'top' | 'bottom';

const CORNER_KEYS: CornerKey[] = ['top', 'right', 'bottom', 'left'];
const VERTICAL_LINES: LineKey[] = ['left', 'right'];
const HORIZONTAL_LINES: LineKey[] = ['top', 'bottom'];

const CORNER_HIT_RADIUS = 12;

export type AutoMeasureOverlaySource = 'auto' | 'preview' | 'save';

type Props = {
  graphics: AutoMeasureGraphics | null;
  imageSize: ManualMeasureImageSize | null;
  interactive?: boolean;
  /** Where the active graphics came from — used only for telemetry logs. */
  source?: AutoMeasureOverlaySource;
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

// 120ms cubic ease-out keeps slider preview transitions feeling industrial
// (smooth, not jumpy) without leaving a perceptible lag after the user
// stops scrolling. Bounded animation; settles via the skip-redraw guard.
const TWEEN_DURATION_MS = 120;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function lerpCorners(a: AutoMeasureCorners, b: AutoMeasureCorners, t: number): AutoMeasureCorners {
  return {
    top: lerpPoint(a.top, b.top, t),
    right: lerpPoint(a.right, b.right, t),
    bottom: lerpPoint(a.bottom, b.bottom, t),
    left: lerpPoint(a.left, b.left, t),
  };
}

function pointKey(p: Point): string {
  return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
}

function cornersKey(c: AutoMeasureCorners | null): string {
  if (!c) return 'none';
  return [
    pointKey(c.top),
    pointKey(c.right),
    pointKey(c.bottom),
    pointKey(c.left),
  ].join('|');
}

function AutoMeasureOverlayImpl({
  graphics,
  imageSize,
  interactive: interactiveProp = true,
  source = 'auto',
  onAdjusted,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastDrawKeyRef = useRef('');
  const tweenFrameRef = useRef<number | null>(null);
  const [localCorners, setLocalCorners] = useState<AutoMeasureCorners | null>(null);
  const localCornersRef = useRef<AutoMeasureCorners | null>(null);
  const [hover, setHover] = useState<{ kind: 'line' | 'corner'; line: LineKey } | null>(null);

  const writeCorners = useCallback((c: AutoMeasureCorners | null) => {
    localCornersRef.current = c;
    setLocalCorners(c);
  }, []);

  useEffect(() => {
    if (dragRef.current) return;
    if (tweenFrameRef.current !== null) {
      window.cancelAnimationFrame(tweenFrameRef.current);
      tweenFrameRef.current = null;
    }
    const target = graphics ? cloneCorners(graphics.corners) : null;
    const current = localCornersRef.current;
    if (source === 'auto' && target) {
      // eslint-disable-next-line no-console
      console.log(`[auto-measure-detected] corners=${cornersKey(target)}`);
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure][detected] points={left:(${target.left.x.toFixed(1)},${target.left.y.toFixed(1)}),right:(${target.right.x.toFixed(1)},${target.right.y.toFixed(1)}),top:(${target.top.x.toFixed(1)},${target.top.y.toFixed(1)}),bottom:(${target.bottom.x.toFixed(1)},${target.bottom.y.toFixed(1)})}`
      );
    }
    if (source === 'preview' && target) {
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-preview-update] corners=${cornersKey(target)}`
      );
      // eslint-disable-next-line no-console
      console.log(`[overlay-refine] source=preview from=${cornersKey(current)} to=${cornersKey(target)}`);
    }
    if (source === 'save' && target) {
      // eslint-disable-next-line no-console
      console.log(`[overlay-final-save] corners=${cornersKey(target)}`);
      // eslint-disable-next-line no-console
      console.log(`[overlay-save-final] corners=${cornersKey(target)}`);
    }
    // Snap on appear/disappear — a fade-from-nothing tween isn't meaningful.
    if (!target || !current) {
      writeCorners(target);
      return;
    }
    const from = cloneCorners(current);
    const to = target;
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / TWEEN_DURATION_MS);
      writeCorners(t >= 1 ? to : lerpCorners(from, to, easeOutCubic(t)));
      if (t < 1) {
        tweenFrameRef.current = window.requestAnimationFrame(step);
      } else {
        tweenFrameRef.current = null;
      }
    };
    tweenFrameRef.current = window.requestAnimationFrame(step);
  }, [graphics, source, writeCorners]);

  useEffect(() => {
    return () => {
      if (tweenFrameRef.current !== null) {
        window.cancelAnimationFrame(tweenFrameRef.current);
        tweenFrameRef.current = null;
      }
    };
  }, []);

  const corners = localCorners ?? graphics?.corners ?? null;

  const draw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;

      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      const targetW = Math.round(width * dpr);
      const targetH = Math.round(height * dpr);
      const sizeChanged = canvas.width !== targetW || canvas.height !== targetH;
      const imageSizeKey = imageSize ? `${imageSize.width}x${imageSize.height}` : 'none';
      const hoverKey = hover ? hover.line : 'none';
      const dragKey = dragRef.current ? dragRef.current.line : 'none';
      const drawKey = `${targetW}x${targetH}@${dpr}|${imageSizeKey}|${cornersKey(corners)}|${hoverKey}|${dragKey}`;

      if (!sizeChanged && lastDrawKeyRef.current === drawKey) {
        // eslint-disable-next-line no-console
        console.log('[overlay] skipped-redraw-no-change');
        // eslint-disable-next-line no-console
        console.log('[overlay-skipped-no-change]');
        return;
      }
      lastDrawKeyRef.current = drawKey;

      // eslint-disable-next-line no-console
      console.log('[overlay] draw-start');
      // eslint-disable-next-line no-console
      console.log(`[overlay-redraw] source=${source}`);

      // Reuse Manual Measure's clean rendering pipeline: two solid yellow
      // corner-to-corner D1/D2 lines + 4 corner dots + labels. No dashed or
      // full-extent guides. Auto-detected diamond tips map to:
      //   leftX/rightX = left/right tips, topY/bottomY = top/bottom tips.
      const guides = corners
        ? {
            leftX: corners.left.x,
            rightX: corners.right.x,
            topY: corners.top.y,
            bottomY: corners.bottom.y,
          }
        : null;
      drawManualMeasureOverlay({
        canvas,
        wrap,
        active: !!corners && !!imageSize,
        imageSize,
        guides,
        hoverGuide: hover ? hover.line : null,
        dragGuide: dragRef.current ? dragRef.current.line : null,
      });

      // eslint-disable-next-line no-console
      console.log(`[overlay] draw-complete source=${source} lines=2 points=4`);
    });
  }, [corners, imageSize, source, hover]);

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

      const top = imageToDisplay(corners.top, placement);
      const right = imageToDisplay(corners.right, placement);
      const bottom = imageToDisplay(corners.bottom, placement);
      const left = imageToDisplay(corners.left, placement);
      const handles: Record<LineKey, Point> = {
        left,
        right,
        top,
        bottom,
      };

      // Handles win over guide lines when overlapping.
      for (const key of CORNER_KEYS) {
        const p = handles[key];
        if (Math.hypot(display.x - p.x, display.y - p.y) <= CORNER_HIT_RADIUS) {
          return { kind: 'corner', line: key };
        }
      }

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
        writeCorners(next);
        const d1 = Math.hypot(next.right.x - next.left.x, next.right.y - next.left.y);
        const d2 = Math.hypot(next.bottom.x - next.top.x, next.bottom.y - next.top.y);
        // eslint-disable-next-line no-console
        console.log(
          `[overlay-drag-move] corner=${drag.line} dx=${dx.toFixed(2)} dy=${dy.toFixed(2)}`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[overlay-recalculate] d1=${d1.toFixed(2)}px d2=${d2.toFixed(2)}px davg=${((d1 + d2) / 2).toFixed(2)}px`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure][drag-update] handle=${drag.line} d1Px=${d1.toFixed(2)} d2Px=${d2.toFixed(2)}`
        );
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
      // eslint-disable-next-line no-console
      console.log(`[overlay-drag-start] corner=${hit.line} from=${cornersKey(corners)}`);
      // eslint-disable-next-line no-console
      console.log(`[auto-measure][drag-start] handle=${hit.line}`);
      dragRef.current = {
        kind: hit.kind,
        line: hit.line,
        pointerId: event.pointerId,
        startCorners: cloneCorners(corners),
        startPointerImage,
      };
      draw();
    },
    [corners, draw, getDisplayPoint, hitTest, toImagePoint]
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
      draw();
      const finalCorners = localCorners;
      if (finalCorners) {
        const before = drag.startCorners;
        const beforeD1 = Math.hypot(before.right.x - before.left.x, before.right.y - before.left.y);
        const beforeD2 = Math.hypot(before.bottom.x - before.top.x, before.bottom.y - before.top.y);
        const afterD1 = Math.hypot(
          finalCorners.right.x - finalCorners.left.x,
          finalCorners.right.y - finalCorners.left.y
        );
        const afterD2 = Math.hypot(
          finalCorners.bottom.x - finalCorners.top.x,
          finalCorners.bottom.y - finalCorners.top.y
        );
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
        // eslint-disable-next-line no-console
        console.log(
          `[overlay-drag-end] corner=${drag.line} d1=${afterD1.toFixed(2)}px d2=${afterD2.toFixed(2)}px`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[overlay-recalculate] d1=${afterD1.toFixed(2)}px d2=${afterD2.toFixed(2)}px davg=${((afterD1 + afterD2) / 2).toFixed(2)}px final=true`
        );
        // eslint-disable-next-line no-console
        console.log(`[auto-measure][drag-complete] corrected=true handle=${drag.line}`);
        onAdjusted?.(finalCorners);
      }
    },
    [draw, localCorners, onAdjusted]
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
