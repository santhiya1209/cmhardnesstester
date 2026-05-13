import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import type { AutoMeasureCorners, AutoMeasureGraphics } from '@/types/autoMeasure';
import { displayToImage, getImagePlacement, imageToDisplay } from '@/utils/manualMeasure';
import {
  clampPointToImage,
  drawManualMeasureOverlay,
  drawTwoIndependentLines,
  type ManualMeasureImageSize,
  type TwoLinesHandle,
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
// Small radius around the diamond centroid that grabs the whole cross and
// translates it. Kept smaller than CORNER_HIT_RADIUS so it never wins against
// a corner handle on a tiny detection.
const CENTER_HIT_RADIUS = 10;
// Perpendicular hit distance from a D1/D2 line body (10X two-diagonals
// layout). Kept slightly larger than the corner radius so the user can grab
// a line on its midsection without precise aim.
const LINE_BODY_HIT_DISTANCE = 8;

export type AutoMeasureOverlaySource = 'auto' | 'preview' | 'save';

type Props = {
  graphics: AutoMeasureGraphics | null;
  imageSize: ManualMeasureImageSize | null;
  interactive?: boolean;
  /** Where the active graphics came from — used only for telemetry logs. */
  source?: AutoMeasureOverlaySource;
  /** Called while/after the user drags. Corners are in IMAGE coords. */
  onAdjusted?: (corners: AutoMeasureCorners) => void;
  /** Yellow-line base stroke width in CSS px. Shared with Manual Measure. */
  strokeWidth?: number;
  /** Currently selected objective (10X/40X). Used as the in-draw render
   *  guard: if the overlay's own `graphics.objective` doesn't match this,
   *  we clear the canvas instead of drawing — defends against stale lines
   *  surviving an objective switch. */
  activeObjective?: string | null;
  /** Bump this number to force an imperative `clearRect` on the canvas
   *  regardless of React render scheduling or skip-redraw caches. */
  clearNonce?: number;
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

type DragHandle = LineKey | 'center' | 'd1-body' | 'd2-body';

type DragKind = 'line' | 'corner' | 'center' | 'd1-body' | 'd2-body';

type DragState = {
  kind: DragKind;
  line: LineKey;
  pointerId: number;
  startCorners: AutoMeasureCorners;
  startPointerImage: Point;
};

// Perpendicular distance from point P to segment AB (display coords).
function distancePointToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * vx;
  const cy = a.y + t * vy;
  return Math.hypot(p.x - cx, p.y - cy);
}

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
  strokeWidth,
  activeObjective = null,
  clearNonce = 0,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastDrawKeyRef = useRef('');
  const tweenFrameRef = useRef<number | null>(null);
  const [localCorners, setLocalCorners] = useState<AutoMeasureCorners | null>(null);
  const localCornersRef = useRef<AutoMeasureCorners | null>(null);
  const [hover, setHover] = useState<{ kind: DragKind; line: LineKey } | null>(null);

  const writeCorners = useCallback((c: AutoMeasureCorners | null) => {
    localCornersRef.current = c;
    setLocalCorners(c);
  }, []);

  useEffect(() => {
    if (dragRef.current) return;
    const target = graphics ? cloneCorners(graphics.corners) : null;
    const current = localCornersRef.current;
    // Same-values fast path. If the parent re-renders and passes a new
    // `graphics` object reference with identical corner values, do NOT
    // restart the tween — restarting would call writeCorners every rAF tick
    // for 120ms, mutating state with a fresh object each frame, which
    // causes the `draw` useCallback to recreate and the redraw useEffect to
    // re-fire. Net effect: overlay redrew at 60fps whenever the parent
    // re-rendered, even though no visual change was needed.
    if (
      target &&
      current &&
      tweenFrameRef.current === null &&
      cornersKey(target) === cornersKey(current)
    ) {
      return;
    }
    if (tweenFrameRef.current !== null) {
      window.cancelAnimationFrame(tweenFrameRef.current);
      tweenFrameRef.current = null;
    }
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

  // Imperative force-clear of the overlay canvas. Triggered when the parent
  // bumps clearNonce (e.g. objective change) or whenever `graphics` becomes
  // null. React state nulling alone is not reliable here — a rAF queued by
  // a prior render can repaint stale yellow lines AFTER state has cleared,
  // and the skip-redraw cache (`lastDrawKeyRef`) can short-circuit the next
  // legitimate draw. Calling clearRect synchronously plus invalidating the
  // skip cache guarantees the canvas is visually blank within the same tick.
  const forceClearCanvas = useCallback((reason: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    lastDrawKeyRef.current = '';
    if (tweenFrameRef.current !== null) {
      window.cancelAnimationFrame(tweenFrameRef.current);
      tweenFrameRef.current = null;
    }
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    localCornersRef.current = null;
    // eslint-disable-next-line no-console
    console.log(`[overlay-canvas-force-clear] reason=${reason}`);
  }, []);

  useEffect(() => {
    if (clearNonce === 0) return;
    forceClearCanvas(`clear-nonce-${clearNonce}`);
  }, [clearNonce, forceClearCanvas]);

  useEffect(() => {
    if (graphics !== null) return;
    forceClearCanvas('graphics-null');
  }, [graphics, forceClearCanvas]);

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
      const overlayObjectiveKey = (graphics?.objective ?? '').trim().toUpperCase() || 'unknown';
      const activeObjectiveKey = (activeObjective ?? '').trim().toUpperCase() || 'unknown';
      const drawKey = `${targetW}x${targetH}@${dpr}|${imageSizeKey}|${cornersKey(corners)}|${hoverKey}|${dragKey}|${overlayObjectiveKey}|${activeObjectiveKey}`;

      if (!sizeChanged && lastDrawKeyRef.current === drawKey) {
        // eslint-disable-next-line no-console
        console.log('[overlay] skipped-redraw-no-change');
        // eslint-disable-next-line no-console
        console.log('[overlay-skipped-no-change]');
        return;
      }
      lastDrawKeyRef.current = drawKey;

      // Final render guard at the actual draw point. The parent component
      // (App.tsx) already gates `displayedAutoMeasureGraphics` by objective,
      // but this canvas is a render target shared by preview + committed +
      // settings-save sources, so we re-verify here. On mismatch we still
      // call clearRect (it's already the first thing the draw fns do via
      // active=false), but skip drawing any lines.
      const normalize = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
      const overlayObjective = normalize(graphics?.objective);
      const liveObjective = normalize(activeObjective);
      const objectiveMismatch =
        overlayObjective && liveObjective && overlayObjective !== liveObjective;
      // eslint-disable-next-line no-console
      console.log(
        `[overlay-draw-source] source=${source} objective=${overlayObjective || 'unknown'} activeObjective=${liveObjective || 'unknown'} frameId=${graphics?.frameId ?? 'n/a'} visible=${objectiveMismatch || !corners ? 'false' : 'true'}`
      );
      if (objectiveMismatch) {
        // eslint-disable-next-line no-console
        console.log(
          `[overlay-render-guard] visible=false reason=objective-mismatch overlayObjective=${overlayObjective} activeObjective=${liveObjective}`
        );
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      // eslint-disable-next-line no-console
      console.log('[overlay] draw-start');
      // eslint-disable-next-line no-console
      console.log(`[overlay-redraw] source=${source}`);

      if (graphics?.lineLayout === 'two-diagonals') {
        // 10X: two independent yellow segments — D1 (left tip ↔ right tip)
        // and D2 (top tip ↔ bottom tip). Endpoints carry their own (x, y)
        // so neither line is forced through the other's midpoint, and each
        // line is independently translatable.
        const dragHandle = dragRef.current
          ? (dragRef.current.kind === 'd1-body'
              ? 'd1-body'
              : dragRef.current.kind === 'd2-body'
              ? 'd2-body'
              : (dragRef.current.line as TwoLinesHandle))
          : null;
        const hoverHandle = hover
          ? (hover.kind === 'd1-body'
              ? 'd1-body'
              : hover.kind === 'd2-body'
              ? 'd2-body'
              : (hover.line as TwoLinesHandle))
          : null;
        drawTwoIndependentLines({
          canvas,
          wrap,
          active: !!corners && !!imageSize,
          imageSize,
          d1Start: corners?.left ?? null,
          d1End: corners?.right ?? null,
          d2Start: corners?.top ?? null,
          d2End: corners?.bottom ?? null,
          hover: hoverHandle,
          drag: dragHandle,
          strokeWidth,
        });
      } else {
        // 40X+: four full-extent guides + 4 corner handles (legacy layout).
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
          strokeWidth,
          lineLayout: graphics?.lineLayout,
        });
      }

      // eslint-disable-next-line no-console
      console.log(`[overlay] draw-complete source=${source} lines=2 points=4`);
    });
  }, [corners, imageSize, source, hover, strokeWidth, graphics?.lineLayout, graphics?.objective, graphics?.frameId, activeObjective]);

  // Latest `draw` reference for the ResizeObserver callback. The observer
  // is installed once with `[]` deps; without this ref it would either
  // capture a stale closure or have to be reinstalled every time `draw`'s
  // identity changed (which was the original cause of the redraw spam).
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  // Redraw when visual deps change. The rAF skip-gate inside `draw` still
  // bails out if drawKey is unchanged, so this is harmless even when called
  // with no real change.
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

  const isTwoDiagonals = graphics?.lineLayout === 'two-diagonals';

  const hitTest = useCallback(
    (display: Point): { kind: DragKind; line: LineKey } | null => {
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

      // Corner handles always win.
      for (const key of CORNER_KEYS) {
        const p = handles[key];
        if (Math.hypot(display.x - p.x, display.y - p.y) <= CORNER_HIT_RADIUS) {
          return { kind: 'corner', line: key };
        }
      }

      if (isTwoDiagonals) {
        // 10X: D1-body and D2-body translate their own line only. No center
        // handle in this layout — D1 and D2 are independent objects.
        const d1Dist = distancePointToSegment(display, left, right);
        const d2Dist = distancePointToSegment(display, top, bottom);
        if (d1Dist <= LINE_BODY_HIT_DISTANCE && d1Dist <= d2Dist) {
          return { kind: 'd1-body', line: 'left' };
        }
        if (d2Dist <= LINE_BODY_HIT_DISTANCE) {
          return { kind: 'd2-body', line: 'top' };
        }
        return null;
      }

      // 40X: center hit zone — translates all 4 tips together.
      const cx = (left.x + right.x) / 2;
      const cy = (top.y + bottom.y) / 2;
      if (Math.hypot(display.x - cx, display.y - cy) <= CENTER_HIT_RADIUS) {
        return { kind: 'center', line: 'left' };
      }

      return null;
    },
    [corners, imageSize, isTwoDiagonals]
  );

  // Translate all 4 corners by (dxImg, dyImg), clamped so no corner exits
  // the image bounds. Used by the center-drag handle to slide the whole
  // D1/D2 cross over the diamond without changing the diagonals.
  const applyCenterDelta = useCallback(
    (dxImg: number, dyImg: number, base: AutoMeasureCorners): AutoMeasureCorners => {
      const w = imageSize?.width ?? Number.POSITIVE_INFINITY;
      const h = imageSize?.height ?? Number.POSITIVE_INFINITY;
      const xs = [base.left.x, base.right.x, base.top.x, base.bottom.x];
      const ys = [base.left.y, base.right.y, base.top.y, base.bottom.y];
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      let ddx = dxImg;
      let ddy = dyImg;
      if (minX + ddx < 0) ddx = -minX;
      if (maxX + ddx > w) ddx = w - maxX;
      if (minY + ddy < 0) ddy = -minY;
      if (maxY + ddy > h) ddy = h - maxY;
      const next = cloneCorners(base);
      next.left.x += ddx; next.left.y += ddy;
      next.right.x += ddx; next.right.y += ddy;
      next.top.x += ddx; next.top.y += ddy;
      next.bottom.x += ddx; next.bottom.y += ddy;
      return next;
    },
    [imageSize]
  );

  // Two-diagonals (10X) corner drag: move the chosen tip freely in 2D and
  // clamp to image bounds. D1 and D2 share no axis — left.y is not coupled
  // to right.y, top.x not coupled to bottom.x. Emits [line-clamp] when the
  // requested position is outside the image and was pulled back.
  const applyCornerDelta2D = useCallback(
    (line: LineKey, dxImg: number, dyImg: number, base: AutoMeasureCorners): AutoMeasureCorners => {
      const next = cloneCorners(base);
      if (!imageSize) {
        const target = base[line];
        next[line] = { x: target.x + dxImg, y: target.y + dyImg };
        return next;
      }
      const target = base[line];
      const requested = { x: target.x + dxImg, y: target.y + dyImg };
      const { point: clamped, clamped: wasClamped } = clampPointToImage(requested, imageSize);
      if (wasClamped) {
        const lineLabel = line === 'left' || line === 'right' ? 'D1' : 'D2';
        // eslint-disable-next-line no-console
        console.log(
          `[line-clamp] line=${lineLabel} endpoint=${line} before=(${requested.x.toFixed(2)},${requested.y.toFixed(2)}) after=(${clamped.x.toFixed(2)},${clamped.y.toFixed(2)})`
        );
      }
      next[line] = clamped;
      return next;
    },
    [imageSize]
  );

  // Two-diagonals line-body drag: translate D1 (left+right) or D2 (top+bottom)
  // together without touching the other line. Clamps the translation so no
  // endpoint exits the image bounds.
  const applyLineBodyDelta = useCallback(
    (
      which: 'd1' | 'd2',
      dxImg: number,
      dyImg: number,
      base: AutoMeasureCorners
    ): AutoMeasureCorners => {
      const next = cloneCorners(base);
      const w = imageSize?.width ?? Number.POSITIVE_INFINITY;
      const h = imageSize?.height ?? Number.POSITIVE_INFINITY;
      const a = which === 'd1' ? base.left : base.top;
      const b = which === 'd1' ? base.right : base.bottom;
      let ddx = dxImg;
      let ddy = dyImg;
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      if (minX + ddx < 0) ddx = -minX;
      if (maxX + ddx > w) ddx = w - maxX;
      if (minY + ddy < 0) ddy = -minY;
      if (maxY + ddy > h) ddy = h - maxY;
      if (which === 'd1') {
        next.left = { x: a.x + ddx, y: a.y + ddy };
        next.right = { x: b.x + ddx, y: b.y + ddy };
      } else {
        next.top = { x: a.x + ddx, y: a.y + ddy };
        next.bottom = { x: b.x + ddx, y: b.y + ddy };
      }
      return next;
    },
    [imageSize]
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
        let next: AutoMeasureCorners;
        if (drag.kind === 'center') {
          next = applyCenterDelta(dx, dy, drag.startCorners);
        } else if (drag.kind === 'd1-body') {
          next = applyLineBodyDelta('d1', dx, dy, drag.startCorners);
        } else if (drag.kind === 'd2-body') {
          next = applyLineBodyDelta('d2', dx, dy, drag.startCorners);
        } else if (isTwoDiagonals && drag.kind === 'corner') {
          next = applyCornerDelta2D(drag.line, dx, dy, drag.startCorners);
        } else {
          next = applyLineDelta(drag.line, dx, dy, drag.startCorners);
        }
        writeCorners(next);
        const d1 = Math.hypot(next.right.x - next.left.x, next.right.y - next.left.y);
        const d2 = Math.hypot(next.bottom.x - next.top.x, next.bottom.y - next.top.y);
        const handleLabel: DragHandle =
          drag.kind === 'center'
            ? 'center'
            : drag.kind === 'd1-body'
            ? 'd1-body'
            : drag.kind === 'd2-body'
            ? 'd2-body'
            : drag.line;
        if (isTwoDiagonals) {
          const lineLabel =
            drag.kind === 'd1-body' || (drag.kind === 'corner' && (drag.line === 'left' || drag.line === 'right'))
              ? 'D1'
              : 'D2';
          // eslint-disable-next-line no-console
          console.log(
            `[line-adjust-update] line=${lineLabel} d1Px=${d1.toFixed(2)} d2Px=${d2.toFixed(2)}`
          );
        }
        // eslint-disable-next-line no-console
        console.log(
          `[overlay-drag-move] corner=${handleLabel} dx=${dx.toFixed(2)} dy=${dy.toFixed(2)}`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[overlay-recalculate] d1=${d1.toFixed(2)}px d2=${d2.toFixed(2)}px davg=${((d1 + d2) / 2).toFixed(2)}px`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure][drag-update] handle=${handleLabel} d1Px=${d1.toFixed(2)} d2Px=${d2.toFixed(2)}`
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
    [
      applyCenterDelta,
      applyCornerDelta2D,
      applyLineBodyDelta,
      applyLineDelta,
      getDisplayPoint,
      hitTest,
      hover,
      isTwoDiagonals,
      onAdjusted,
      toImagePoint,
    ]
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
      const handleLabel: DragHandle =
        hit.kind === 'center'
          ? 'center'
          : hit.kind === 'd1-body'
          ? 'd1-body'
          : hit.kind === 'd2-body'
          ? 'd2-body'
          : hit.line;
      // eslint-disable-next-line no-console
      console.log('[auto-measure] adjust start', {
        kind: hit.kind,
        line: handleLabel,
        corners,
      });
      // eslint-disable-next-line no-console
      console.log(`[overlay-drag-start] corner=${handleLabel} from=${cornersKey(corners)}`);
      // eslint-disable-next-line no-console
      console.log(`[auto-measure][drag-start] handle=${handleLabel}`);
      // Mirror for the calibration flow — App.tsx gates calibration-mode
      // behavior on calibrationManualModeRef, but the start event originates
      // here; emitting this log unconditionally keeps the overlay component
      // simple (no calibration-mode prop) and the log is cheap.
      // eslint-disable-next-line no-console
      console.log(`[calibration-cross-adjust-start] handle=${handleLabel}`);
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
    const dragKind = dragRef.current?.kind ?? null;
    const hoverKind = hover?.kind ?? null;
    if (
      dragKind === 'center' ||
      hoverKind === 'center' ||
      dragKind === 'd1-body' ||
      hoverKind === 'd1-body' ||
      dragKind === 'd2-body' ||
      hoverKind === 'd2-body'
    ) return 'move';
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
