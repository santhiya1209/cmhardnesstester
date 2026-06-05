import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import type { AutoMeasureCorners, AutoMeasureGraphics } from '@/types/autoMeasure';
import { displayToImage, getImagePlacement, imageToDisplay } from '@/utils/manualMeasure';
import {
  clampPointToImage,
  drawManualMeasureOverlay,
  type ManualMeasureImageSize,
} from '@/utils/manualMeasureOverlayCanvas';
import type { Point } from '@/types/tool';
import { autoMeasureCornersKey } from '@/utils/autoMeasureOverlayKey';
import { useRenderCount } from '@/utils/renderStats';


type CornerKey = keyof AutoMeasureCorners;
type LineKey = 'left' | 'right' | 'top' | 'bottom';

const CORNER_KEYS: CornerKey[] = ['top', 'right', 'bottom', 'left'];
const VERTICAL_LINES: LineKey[] = ['left', 'right'];
const HORIZONTAL_LINES: LineKey[] = ['top', 'bottom'];

const CORNER_HIT_RADIUS = 12;
const CENTER_HIT_RADIUS = 10;
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
  /** Hard render gate. When false, the overlay clears its canvas and skips
   *  drawing on every redraw pass — defends against stale yellow lines
   *  surviving a Close Camera while a rAF was already queued. */
  cameraOpen?: boolean;
  /** Fired AFTER the canvas actually paints lines for a set of corners,
   *  carrying their stable key. Lets the album capture wait for the final
   *  refined overlay deterministically instead of a blind rAF delay. */
  onOverlayDrawn?: (cornersKey: string) => void;
  /** Selected guide line, rendered white + thicker. Driven by mouse click
   *  and keyboard (Tab/arrows) editing handled inside this overlay. */
  selectedLine?: 'top' | 'right' | 'bottom' | 'left' | null;
  /** Called when a line is selected (mouse or keyboard); null clears it. */
  onLineSelected?: (line: 'top' | 'right' | 'bottom' | 'left' | null) => void;
  /** When true, Tab/Arrow/Enter/Escape edit the selected guide line. The
   *  parent owns the gate (camera open, pointer tool, no blocking dialog). */
  keyboardActive?: boolean;
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


type DragKind = 'line' | 'corner' | 'center';

type DragState = {
  kind: DragKind;
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

const cornersKey = autoMeasureCornersKey;

function AutoMeasureOverlayImpl({
  graphics,
  imageSize,
  interactive: interactiveProp = true,
  source = 'auto',
  onAdjusted,
  strokeWidth,
  activeObjective = null,
  clearNonce = 0,
  cameraOpen = true,
  onOverlayDrawn,
  selectedLine = null,
  onLineSelected,
  keyboardActive = false,
}: Props) {
  useRenderCount('AutoMeasureOverlay');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastDrawKeyRef = useRef('');
  const tweenFrameRef = useRef<number | null>(null);
  const [localCorners, setLocalCorners] = useState<AutoMeasureCorners | null>(null);
  const localCornersRef = useRef<AutoMeasureCorners | null>(null);
  const [hover, setHover] = useState<{ kind: DragKind; line: LineKey } | null>(null);

  const selectedLineRef = useRef(selectedLine);
  const keyboardActiveRef = useRef(keyboardActive);
  const onAdjustedRef = useRef(onAdjusted);
  const onLineSelectedRef = useRef(onLineSelected);
  const cornersKbRef = useRef<AutoMeasureCorners | null>(null);
  const applyLineDeltaKbRef = useRef<
    ((line: LineKey, dx: number, dy: number, base: AutoMeasureCorners) => AutoMeasureCorners) | null
  >(null);
  const originalCornersRef = useRef<AutoMeasureCorners | null>(null);
  const prevGraphicsForKbRef = useRef<AutoMeasureGraphics | null>(null);

  const writeCorners = useCallback((c: AutoMeasureCorners | null) => {
    localCornersRef.current = c;
    setLocalCorners(c);
  }, []);

  useEffect(() => {
    if (dragRef.current) return;
    const target = graphics ? cloneCorners(graphics.corners) : null;
    const current = localCornersRef.current;
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
    if (!target || !current) {
      writeCorners(target);
      return;
    }
    if (source !== 'preview') {
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

  const forceClearCanvas = useCallback((_reason: string) => {
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
  }, []);

  useEffect(() => {
    if (cameraOpen) return;
    forceClearCanvas('camera-close');
  }, [cameraOpen, forceClearCanvas]);

  useEffect(() => {
    if (clearNonce === 0) return;
    forceClearCanvas(`clear-nonce-${clearNonce}`);
  }, [clearNonce, forceClearCanvas]);

  useEffect(() => {
    if (graphics !== null) return;
    forceClearCanvas('graphics-null');
  }, [graphics, forceClearCanvas]);

  useEffect(() => {
    const prev = prevGraphicsForKbRef.current;
    prevGraphicsForKbRef.current = graphics;
    if (graphics && !prev) {
      originalCornersRef.current = cloneCorners(graphics.corners);
    } else if (!graphics) {
      originalCornersRef.current = null;
      onLineSelectedRef.current?.(null);
    }
  }, [graphics]);

  const draw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;

      if (!cameraOpen) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        lastDrawKeyRef.current = '';
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      const targetW = Math.round(width * dpr);
      const targetH = Math.round(height * dpr);
      const sizeChanged = canvas.width !== targetW || canvas.height !== targetH;
      const imageSizeKey = imageSize ? `${imageSize.width}x${imageSize.height}` : 'none';
      const hoverKey = hover ? hover.line : 'none';
      const dragKey = dragRef.current ? dragRef.current.line : 'none';
      const selectedKey = selectedLine ?? 'none';
      const overlayObjectiveKey = (graphics?.objective ?? '').trim().toUpperCase() || 'unknown';
      const activeObjectiveKey = (activeObjective ?? '').trim().toUpperCase() || 'unknown';
      const drawKey = `${targetW}x${targetH}@${dpr}|${imageSizeKey}|${cornersKey(corners)}|${hoverKey}|${dragKey}|${selectedKey}|${overlayObjectiveKey}|${activeObjectiveKey}`;

      if (!sizeChanged && lastDrawKeyRef.current === drawKey) {
        return;
      }
      lastDrawKeyRef.current = drawKey;

      const normalize = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
      const overlayObjective = normalize(graphics?.objective);
      const liveObjective = normalize(activeObjective);
      const objectiveMismatch =
        overlayObjective && liveObjective && overlayObjective !== liveObjective;
      if (objectiveMismatch) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const dragHandle = dragRef.current && dragRef.current.kind === 'line'
        ? (dragRef.current.line as 'left' | 'right' | 'top' | 'bottom')
        : null;
      const hoverHandle = hover && hover.kind === 'line'
        ? (hover.line as 'left' | 'right' | 'top' | 'bottom')
        : null;
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
        hoverGuide: hoverHandle,
        dragGuide: dragHandle,
        selectedGuide: selectedLine,
        strokeWidth,
        lineLayout: 'four-guides',
      });
      if (corners && imageSize) {
        onOverlayDrawn?.(cornersKey(corners));
      }
    });
  }, [corners, imageSize, source, hover, selectedLine, strokeWidth, graphics?.lineLayout, graphics?.objective, graphics?.frameId, activeObjective, cameraOpen, onOverlayDrawn]);

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

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!keyboardActiveRef.current) return;
      const cs = cornersKbRef.current;
      if (!cs) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase() ?? '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      const { key, shiftKey, ctrlKey } = event;

      if (key === 'Tab') {
        event.preventDefault();
        const current = selectedLineRef.current;
        let next: LineKey;
        if (current == null) {
          next = shiftKey ? CORNER_KEYS[CORNER_KEYS.length - 1] : CORNER_KEYS[0];
        } else {
          const idx = CORNER_KEYS.indexOf(current);
          const nextIdx = shiftKey
            ? (idx - 1 + CORNER_KEYS.length) % CORNER_KEYS.length
            : (idx + 1) % CORNER_KEYS.length;
          next = CORNER_KEYS[nextIdx];
        }
        // eslint-disable-next-line no-console
        console.log(`[auto-measure-edit] selected=${next}-line source=keyboard`);
        onLineSelectedRef.current?.(next);
        return;
      }

      const line = selectedLineRef.current;
      if (!line) return;

      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();
        const step = ctrlKey ? 10 : shiftKey ? 5 : 1;
        let dx = 0;
        let dy = 0;
        if (key === 'ArrowUp') dy = -step;
        else if (key === 'ArrowDown') dy = step;
        else if (key === 'ArrowLeft') dx = -step;
        else dx = step;

        const apply = applyLineDeltaKbRef.current;
        if (!apply) return;
        const next = apply(line, dx, dy, cs);
        const d1Px = next.right.x - next.left.x;
        const d2Px = next.bottom.y - next.top.y;
        const davgPx = (d1Px + d2Px) / 2;
        // eslint-disable-next-line no-console
        console.log(`[auto-measure-key] key=${key} element=${line}-line deltaX=${dx} deltaY=${dy}`);
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-recalculate] D1=${d1Px.toFixed(1)}px D2=${d2Px.toFixed(1)}px Davg=${davgPx.toFixed(1)}px HV=pending(debounce)`
        );
        writeCorners(next);
        onAdjustedRef.current?.(next);
        return;
      }

      if (key === 'Enter') {
        event.preventDefault();
        onAdjustedRef.current?.(cs);
        // eslint-disable-next-line no-console
        console.log('[auto-measure-confirm] source=keyboard');
        onLineSelectedRef.current?.(null);
        return;
      }

      if (key === 'Escape') {
        event.preventDefault();
        const original = originalCornersRef.current;
        if (original) {
          writeCorners(original);
          onAdjustedRef.current?.(original);
        }
        // eslint-disable-next-line no-console
        console.log('[auto-measure-cancel] restored=originalDetectedGeometry');
        onLineSelectedRef.current?.(null);
        return;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [writeCorners]);

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

      for (const key of CORNER_KEYS) {
        const p = handles[key];
        if (Math.hypot(display.x - p.x, display.y - p.y) <= CORNER_HIT_RADIUS) {
          return { kind: 'corner', line: key };
        }
      }

      const lineCandidates: Array<{ key: LineKey; dist: number }> = [
        { key: 'left', dist: Math.abs(display.x - left.x) },
        { key: 'right', dist: Math.abs(display.x - right.x) },
        { key: 'top', dist: Math.abs(display.y - top.y) },
        { key: 'bottom', dist: Math.abs(display.y - bottom.y) },
      ];
      const nearestLine = lineCandidates.reduce((best, c) => (c.dist < best.dist ? c : best));
      if (nearestLine.dist <= LINE_BODY_HIT_DISTANCE) {
        return { kind: 'line', line: nearestLine.key };
      }

      if (!isTwoDiagonals) {
        const cx = (left.x + right.x) / 2;
        const cy = (top.y + bottom.y) / 2;
        if (Math.hypot(display.x - cx, display.y - cy) <= CENTER_HIT_RADIUS) {
          return { kind: 'center', line: 'left' };
        }
      }

      return null;
    },
    [corners, imageSize, isTwoDiagonals]
  );

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
      const { point: clamped, clamped: _wasClamped } = clampPointToImage(requested, imageSize);
      next[line] = clamped;
      return next;
    },
    [imageSize]
  );

  const applyLineDelta = useCallback(
    (line: LineKey, dxImg: number, dyImg: number, base: AutoMeasureCorners): AutoMeasureCorners => {
      const next = cloneCorners(base);
      const w = imageSize?.width ?? Number.POSITIVE_INFINITY;
      const h = imageSize?.height ?? Number.POSITIVE_INFINITY;

      if (line === 'left') {
        next.left.x = Math.max(0, Math.min(w, base.left.x + dxImg));
      } else if (line === 'right') {
        next.right.x = Math.max(0, Math.min(w, base.right.x + dxImg));
      } else if (line === 'top') {
        next.top.y = Math.max(0, Math.min(h, base.top.y + dyImg));
      } else if (line === 'bottom') {
        next.bottom.y = Math.max(0, Math.min(h, base.bottom.y + dyImg));
      }
      return next;
    },
    [imageSize]
  );

  selectedLineRef.current = selectedLine;
  keyboardActiveRef.current = keyboardActive;
  onAdjustedRef.current = onAdjusted;
  onLineSelectedRef.current = onLineSelected;
  cornersKbRef.current = corners;
  applyLineDeltaKbRef.current = applyLineDelta;

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
        } else if (drag.kind === 'corner') {
          next = applyCornerDelta2D(drag.line, dx, dy, drag.startCorners);
        } else {
          next = applyLineDelta(drag.line, dx, dy, drag.startCorners);
        }
        writeCorners(next);
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
      dragRef.current = {
        kind: hit.kind,
        line: hit.line,
        pointerId: event.pointerId,
        startCorners: cloneCorners(corners),
        startPointerImage,
      };
      onLineSelected?.(hit.line);
      // eslint-disable-next-line no-console
      console.log(`[auto-measure-edit] selected=${hit.line}-line source=mouse`);
      draw();
    },
    [corners, draw, getDisplayPoint, hitTest, onLineSelected, toImagePoint]
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
        const startPt = drag.startCorners[drag.line];
        const endPt = finalCorners[drag.line];
        const totalDx = endPt.x - startPt.x;
        const totalDy = endPt.y - startPt.y;
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-mouse] element=${drag.line}-line deltaX=${totalDx.toFixed(1)} deltaY=${totalDy.toFixed(1)}`
        );
        const d1Px = finalCorners.right.x - finalCorners.left.x;
        const d2Px = finalCorners.bottom.y - finalCorners.top.y;
        const davgPx = (d1Px + d2Px) / 2;
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-recalculate] D1=${d1Px.toFixed(1)}px D2=${d2Px.toFixed(1)}px Davg=${davgPx.toFixed(1)}px HV=pending(debounce)`
        );
        onAdjusted?.(finalCorners);
      }
    },
    [draw, localCorners, onAdjusted]
  );

  const cursor = (() => {
    const dragKind = dragRef.current?.kind ?? null;
    const hoverKind = hover?.kind ?? null;
    if (dragKind === 'center' || hoverKind === 'center') return 'move';
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
