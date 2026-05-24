import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { tokens } from '@/theme/theme';
import type {
  AngleShape,
  OverlayShape,
  OverlayShapeInput,
  Point,
  ToolId,
} from '@/types/tool';
import {
  displayToImage,
  formatMicronDisplay,
  getImagePlacement,
  imageToDisplay,
  pixelsToMicrons,
} from '@/utils/manualMeasure';
import type { ManualMeasureImageSize } from '@/utils/manualMeasureOverlayCanvas';

const ROOT_SX: SxProps<Theme> = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'auto',
};

const CANVAS_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
};

const STROKE_ANGLE = tokens.overlay.measureAngleLine;
const STROKE_CROSS = '#FF00FF';
const STROKE_LENGTH = '#E040FB';
const LENGTH_FONT = '600 15px "Cascadia Mono", Consolas, ui-monospace, monospace';
const ANGLE_FONT = '600 15px "Cascadia Mono", Consolas, ui-monospace, monospace';
const LENGTH_LINE_WIDTH = 2.25;
const ANGLE_LINE_WIDTH = 2.25;
const LENGTH_TICK_HALF = 7;
const LENGTH_ENDPOINT_HIT_RADIUS = 8;
const ANGLE_POINT_HIT_RADIUS = 9;
const ANGLE_HANDLE_RADIUS = 3;
// Halo (dark stroke under the label fill) for readability against the live
// camera image. Kept thin so the metrology-software look stays sharp.
const LABEL_HALO_COLOR = 'rgba(0, 0, 0, 0.75)';
const LABEL_HALO_WIDTH = 3;
const ANGLE_ARC_MIN_RADIUS = 18;
const ANGLE_ARC_MAX_RADIUS = 44;
const ANGLE_LOG_INTERVAL_MS = 100;

type ImagePlacement = NonNullable<ReturnType<typeof getImagePlacement>>;
type ImageRect = { x: number; y: number; width: number; height: number };
type AnglePointKey = 'vertex' | 'a' | 'b';
type AngleCoordinateSpace = NonNullable<AngleShape['coordinateSpace']>;

type DrawOptions = {
  imageScale: number | null;
  umPerPixel: number | null;
  placement: ImagePlacement | null;
  imageSize: ManualMeasureImageSize | null;
  imageRect: ImageRect | null;
};

type DraftLength = { kind: 'length'; a: Point };
type DraftAngle =
  | { kind: 'angle'; step: 'firstArm'; vertex: Point }
  | { kind: 'angle'; step: 'secondArm'; vertex: Point; a: Point };
type Draft = DraftLength | DraftAngle | null;

type AngleDrag = {
  id: string;
  point: AnglePointKey;
  pointerId: number;
  coordinateSpace: AngleCoordinateSpace;
  vertex: Point;
  a: Point;
  b: Point;
};

type LengthDrag = {
  id: string;
  endpoint: 'a' | 'b';
  pointerId: number;
  other: Point;
  live: Point;
};

const angleRenderLogKeys = new Map<string, string>();
const angleValueLogKeys = new Map<string, string>();
const lengthDisplayLogKeys = new Map<string, string>();
let lastCrossLogKey: string | null = null;

function dist(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function samePoint(a: Point | null, b: Point | null) {
  if (!a || !b) return a === b;
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

function copyPoint(p: Point): Point {
  return { x: p.x, y: p.y };
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return (min + max) / 2;
  return Math.max(min, Math.min(max, value));
}

function angleDeg(vertex: Point, a: Point, b: Point) {
  const v1x = a.x - vertex.x;
  const v1y = a.y - vertex.y;
  const v2x = b.x - vertex.x;
  const v2y = b.y - vertex.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function imageRectFromPlacement(placement: ImagePlacement): ImageRect {
  return {
    x: placement.offsetX,
    y: placement.offsetY,
    width: placement.width,
    height: placement.height,
  };
}

function getLengthDisplayInfo(
  displayPx: number,
  placementScale: number | null,
  umPerPixel: number | null
) {
  const imagePx = placementScale && placementScale > 0 ? displayPx / placementScale : displayPx;
  const um = pixelsToMicrons(imagePx, umPerPixel);
  return {
    imagePx,
    um,
    label: um !== null ? formatMicronDisplay(um) : null,
  };
}

function pointInRect(p: Point, rect: ImageRect) {
  return (
    p.x >= rect.x &&
    p.x <= rect.x + rect.width &&
    p.y >= rect.y &&
    p.y <= rect.y + rect.height
  );
}

function normalizedDelta(delta: number) {
  const full = Math.PI * 2;
  const next = delta % full;
  return next < 0 ? next + full : next;
}

function getSmallArc(vertex: Point, a: Point, b: Point) {
  const start = Math.atan2(a.y - vertex.y, a.x - vertex.x);
  const end = Math.atan2(b.y - vertex.y, b.x - vertex.x);
  const clockwise = normalizedDelta(end - start);
  if (clockwise <= Math.PI) {
    return {
      start,
      end,
      anticlockwise: false,
      span: clockwise,
      mid: start + clockwise / 2,
    };
  }
  const span = Math.PI * 2 - clockwise;
  return {
    start,
    end,
    anticlockwise: true,
    span,
    mid: start - span / 2,
  };
}

function logAngleRender(
  id: string,
  value: number | null,
  vertex: Point,
  a: Point,
  b: Point | null,
  source: string
) {
  const valueText = value === null ? 'n/a' : value.toFixed(1);
  const key = [
    source,
    valueText,
    vertex.x.toFixed(1),
    vertex.y.toFixed(1),
    a.x.toFixed(1),
    a.y.toFixed(1),
    b?.x.toFixed(1) ?? 'n/a',
    b?.y.toFixed(1) ?? 'n/a',
  ].join('|');
  if (angleRenderLogKeys.get(id) === key) return;
  angleRenderLogKeys.set(id, key);
}

function logAngleValue(id: string, value: number, source: string) {
  const valueText = value.toFixed(1);
  const key = `${source}|${valueText}`;
  if (angleValueLogKeys.get(id) === key) return;
  angleValueLogKeys.set(id, key);
}

function anglePointToDisplay(
  shape: AngleShape,
  key: AnglePointKey,
  placement: ImagePlacement | null
): Point | null {
  const point = shape[key];
  if (shape.coordinateSpace === 'image') {
    return placement ? imageToDisplay(point, placement) : null;
  }
  return point;
}

function angleShapeToDisplay(shape: AngleShape, placement: ImagePlacement | null) {
  const vertex = anglePointToDisplay(shape, 'vertex', placement);
  const a = anglePointToDisplay(shape, 'a', placement);
  const b = anglePointToDisplay(shape, 'b', placement);
  return vertex && a && b ? { vertex, a, b } : null;
}

function drawLengthShape(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  opts: { imageScale: number | null; umPerPixel: number | null },
  source = 'shape'
) {
  ctx.save();
  ctx.strokeStyle = STROKE_LENGTH;
  ctx.lineWidth = LENGTH_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len > 0.5) {
    const px = -dy / len;
    const py = dx / len;
    const h = LENGTH_TICK_HALF;
    ctx.beginPath();
    ctx.moveTo(a.x + px * h, a.y + py * h);
    ctx.lineTo(a.x - px * h, a.y - py * h);
    ctx.moveTo(b.x + px * h, b.y + py * h);
    ctx.lineTo(b.x - px * h, b.y - py * h);
    ctx.stroke();
  }

  const { imagePx, um, label } = getLengthDisplayInfo(len, opts.imageScale, opts.umPerPixel);
  const logKey = `${source}|${imagePx.toFixed(2)}|${opts.umPerPixel ?? 'null'}|${label}`;
  if (lengthDisplayLogKeys.get(source) !== logKey) {
    lengthDisplayLogKeys.set(source, logKey);
    if (um !== null) {
    } else {
    }
  }
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  let angle = Math.atan2(dy, dx);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
  ctx.font = LENGTH_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.translate(midX, midY);
  ctx.rotate(angle);
  if (label !== null) {
    ctx.lineWidth = LABEL_HALO_WIDTH;
    ctx.strokeStyle = LABEL_HALO_COLOR;
    ctx.lineJoin = 'round';
    ctx.strokeText(label, 0, -8);
    ctx.fillStyle = STROKE_LENGTH;
    ctx.fillText(label, 0, -8);
  }
  ctx.restore();
}

function drawAngleHandle(ctx: CanvasRenderingContext2D, point: Point, radius: number) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function clampAngleLabelPoint(
  ctx: CanvasRenderingContext2D,
  text: string,
  point: Point,
  rect: ImageRect | null
): Point {
  if (!rect) return point;
  const metrics = ctx.measureText(text);
  const halfWidth = metrics.width / 2 + 3;
  const halfHeight = 8;
  return {
    x: clamp(point.x, rect.x + halfWidth, rect.x + rect.width - halfWidth),
    y: clamp(point.y, rect.y + halfHeight, rect.y + rect.height - halfHeight),
  };
}

function drawAngleShape(
  ctx: CanvasRenderingContext2D,
  shape: AngleShape,
  opts: DrawOptions,
  source: 'shape' | 'preview' | 'drag' = 'shape'
) {
  const display = angleShapeToDisplay(shape, opts.placement);
  if (!display) return;
  const value = angleDeg(shape.vertex, shape.a, shape.b);
  const lenA = dist(display.vertex, display.a);
  const lenB = dist(display.vertex, display.b);

  ctx.save();
  if (opts.imageRect) {
    ctx.beginPath();
    ctx.rect(opts.imageRect.x, opts.imageRect.y, opts.imageRect.width, opts.imageRect.height);
    ctx.clip();
  }

  ctx.strokeStyle = STROKE_ANGLE;
  ctx.fillStyle = STROKE_ANGLE;
  ctx.lineWidth = ANGLE_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(display.vertex.x, display.vertex.y);
  ctx.lineTo(display.a.x, display.a.y);
  ctx.moveTo(display.vertex.x, display.vertex.y);
  ctx.lineTo(display.b.x, display.b.y);
  ctx.stroke();

  if (lenA > 1 && lenB > 1) {
    const arc = getSmallArc(display.vertex, display.a, display.b);
    const radius = Math.min(
      ANGLE_ARC_MAX_RADIUS,
      Math.max(ANGLE_ARC_MIN_RADIUS, Math.min(lenA, lenB) * 0.28)
    );
    ctx.beginPath();
    ctx.arc(display.vertex.x, display.vertex.y, radius, arc.start, arc.end, arc.anticlockwise);
    ctx.stroke();

    const label = `${value.toFixed(1)}Â°`;
    const labelRadius = radius + 19;
    ctx.font = ANGLE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelPoint = clampAngleLabelPoint(
      ctx,
      label,
      {
        x: display.vertex.x + Math.cos(arc.mid) * labelRadius,
        y: display.vertex.y + Math.sin(arc.mid) * labelRadius,
      },
      opts.imageRect
    );
    const prevLineWidth = ctx.lineWidth;
    const prevStroke = ctx.strokeStyle;
    const prevJoin = ctx.lineJoin;
    ctx.lineWidth = LABEL_HALO_WIDTH;
    ctx.strokeStyle = LABEL_HALO_COLOR;
    ctx.lineJoin = 'round';
    ctx.strokeText(label, labelPoint.x, labelPoint.y);
    ctx.fillStyle = STROKE_ANGLE;
    ctx.fillText(label, labelPoint.x, labelPoint.y);
    ctx.lineWidth = prevLineWidth;
    ctx.strokeStyle = prevStroke;
    ctx.lineJoin = prevJoin;
  }

  drawAngleHandle(ctx, display.vertex, ANGLE_HANDLE_RADIUS + 0.35);
  drawAngleHandle(ctx, display.a, ANGLE_HANDLE_RADIUS);
  drawAngleHandle(ctx, display.b, ANGLE_HANDLE_RADIUS);
  ctx.restore();

  logAngleRender(shape.id, value, display.vertex, display.a, display.b, source);
  logAngleValue(shape.id, value, source);
}

function drawAngleFirstArm(
  ctx: CanvasRenderingContext2D,
  vertexImage: Point,
  endpointImage: Point,
  opts: DrawOptions
) {
  if (!opts.placement) return;
  const vertex = imageToDisplay(vertexImage, opts.placement);
  const endpoint = imageToDisplay(endpointImage, opts.placement);
  ctx.save();
  if (opts.imageRect) {
    ctx.beginPath();
    ctx.rect(opts.imageRect.x, opts.imageRect.y, opts.imageRect.width, opts.imageRect.height);
    ctx.clip();
  }
  ctx.strokeStyle = STROKE_ANGLE;
  ctx.fillStyle = STROKE_ANGLE;
  ctx.lineWidth = ANGLE_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(vertex.x, vertex.y);
  ctx.lineTo(endpoint.x, endpoint.y);
  ctx.stroke();
  drawAngleHandle(ctx, vertex, ANGLE_HANDLE_RADIUS + 0.35);
  drawAngleHandle(ctx, endpoint, ANGLE_HANDLE_RADIUS);
  ctx.restore();
  logAngleRender('_draft_first_arm', null, vertex, endpoint, null, 'preview');
}

function drawShape(ctx: CanvasRenderingContext2D, s: OverlayShape, opts: DrawOptions) {
  if (s.kind === 'length') {
    drawLengthShape(ctx, s.a, s.b, opts, `shape:${s.id}`);
    return;
  }
  drawAngleShape(ctx, s, opts);
}

function drawCross(ctx: CanvasRenderingContext2D, rect: ImageRect) {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.strokeStyle = STROKE_CROSS;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x, centerY);
  ctx.lineTo(rect.x + rect.width, centerY);
  ctx.moveTo(centerX, rect.y);
  ctx.lineTo(centerX, rect.y + rect.height);
  ctx.stroke();
  ctx.restore();
  const key = `${rect.x.toFixed(1)},${rect.y.toFixed(1)},${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`;
  if (key !== lastCrossLogKey) {
    lastCrossLogKey = key;
  }
}

function hitTestAnglePoint(
  p: Point,
  shape: AngleShape,
  placement: ImagePlacement | null
): AnglePointKey | null {
  const display = angleShapeToDisplay(shape, placement);
  if (!display) return null;
  const candidates: Array<{ key: AnglePointKey; distance: number }> = [
    { key: 'vertex', distance: dist(p, display.vertex) },
    { key: 'a', distance: dist(p, display.a) },
    { key: 'b', distance: dist(p, display.b) },
  ];
  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0]?.distance <= ANGLE_POINT_HIT_RADIUS ? candidates[0].key : null;
}

type Props = {
  activeTool: ToolId;
  shapes: OverlayShape[];
  crossLineVisible: boolean;
  /**
   * Native size of the live camera image. Required to compute the centered
   * imageRect (offset + scaled dimensions) inside the wrapper so tools track
   * the displayed image, not the black letterbox padding.
   */
  imageSize: ManualMeasureImageSize | null;
  /** Active objective's calibration in um per IMAGE pixel. Used by Measure
   *  Length to render values as "X.XXum"; no pixel label is rendered when
   *  calibration is unavailable. */
  umPerPixel?: number | null;
  onAddShape: (shape: OverlayShapeInput) => void;
  onUpdateShape?: (id: string, next: OverlayShapeInput) => void;
  onCursor?: (p: Point | null) => void;
  onClearKind?: (kind: OverlayShape['kind']) => void;
};

function ImageOverlayImpl({
  activeTool,
  shapes,
  crossLineVisible,
  imageSize,
  umPerPixel = null,
  onAddShape,
  onUpdateShape,
  onCursor,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<Draft>(null);
  const hoverDisplayRef = useRef<Point | null>(null);
  const hoverImageRef = useRef<Point | null>(null);
  const lengthDragRef = useRef<LengthDrag | null>(null);
  const angleDragRef = useRef<AngleDrag | null>(null);
  const paintFrameRef = useRef<number | null>(null);
  const lastLengthLogAtRef = useRef(0);
  const lastAnglePreviewLogAtRef = useRef(0);
  const lastDragLogAtRef = useRef(0);
  const [resizeTick, setResizeTick] = useState(0);
  const [paintTick, setPaintTick] = useState(0);

  const requestPaint = useCallback(() => {
    if (paintFrameRef.current !== null) return;
    paintFrameRef.current = window.requestAnimationFrame(() => {
      paintFrameRef.current = null;
      setPaintTick((tick) => tick + 1);
    });
  }, []);

  useEffect(
    () => () => {
      if (paintFrameRef.current !== null) {
        window.cancelAnimationFrame(paintFrameRef.current);
        paintFrameRef.current = null;
      }
    },
    []
  );

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

  const getCurrentPlacement = useCallback((): ImagePlacement | null => {
    const wrap = wrapRef.current;
    if (!wrap || !imageSize || imageSize.width <= 0 || imageSize.height <= 0) return null;
    return getImagePlacement(wrap.clientWidth, wrap.clientHeight, imageSize);
  }, [imageSize]);

  const localPoint = useCallback((e: React.PointerEvent): Point => {
    const wrap = wrapRef.current;
    if (!wrap) return { x: 0, y: 0 };
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * wrap.clientWidth,
      y: ((e.clientY - rect.top) / rect.height) * wrap.clientHeight,
    };
  }, []);

  const pointerToImagePoint = useCallback(
    (e: React.PointerEvent, allowClamp: boolean) => {
      if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) return null;
      const placement = getCurrentPlacement();
      if (!placement) return null;
      const display = localPoint(e);
      const imageRect = imageRectFromPlacement(placement);
      if (!allowClamp && !pointInRect(display, imageRect)) return null;
      const image = displayToImage(display, placement, imageSize);
      return {
        image,
        display: imageToDisplay(image, placement),
        rawDisplay: display,
        placement,
        imageRect,
      };
    },
    [getCurrentPlacement, imageSize, localPoint]
  );

  const pointForDrag = useCallback(
    (e: React.PointerEvent, coordinateSpace: AngleCoordinateSpace): Point | null => {
      const hit = pointerToImagePoint(e, true);
      if (coordinateSpace === 'image') return hit?.image ?? null;
      return hit?.display ?? localPoint(e);
    },
    [localPoint, pointerToImagePoint]
  );

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

    const placement =
      imageSize && imageSize.width > 0 && imageSize.height > 0
        ? getImagePlacement(wCss, hCss, imageSize)
        : null;
    const imageRect = placement ? imageRectFromPlacement(placement) : null;

    if (crossLineVisible && imageRect) {
      drawCross(ctx, imageRect);
    }

    const drawOpts: DrawOptions = {
      imageScale: placement ? placement.scale : null,
      umPerPixel,
      placement,
      imageSize,
      imageRect,
    };
    const lengthDrag = lengthDragRef.current;
    const angleDrag = angleDragRef.current;

    for (const shape of shapes) {
      if (shape.kind === 'length' && lengthDrag && lengthDrag.id === shape.id) {
        const a = lengthDrag.endpoint === 'a' ? lengthDrag.live : lengthDrag.other;
        const b = lengthDrag.endpoint === 'b' ? lengthDrag.live : lengthDrag.other;
        drawLengthShape(ctx, a, b, drawOpts, `drag:${shape.id}`);
        continue;
      }
      if (shape.kind === 'angle' && angleDrag && angleDrag.id === shape.id) {
        drawAngleShape(
          ctx,
          {
            id: shape.id,
            kind: 'angle',
            vertex: angleDrag.vertex,
            a: angleDrag.a,
            b: angleDrag.b,
            coordinateSpace: angleDrag.coordinateSpace,
          },
          drawOpts,
          'drag'
        );
        continue;
      }
      drawShape(ctx, shape, drawOpts);
    }

    const draft = draftRef.current;
    if (draft?.kind === 'length' && hoverDisplayRef.current) {
      drawLengthShape(ctx, draft.a, hoverDisplayRef.current, drawOpts, 'preview');
    } else if (draft?.kind === 'angle' && hoverImageRef.current) {
      if (draft.step === 'firstArm') {
        drawAngleFirstArm(ctx, draft.vertex, hoverImageRef.current, drawOpts);
      } else {
        drawAngleShape(
          ctx,
          {
            id: '_draft',
            kind: 'angle',
            vertex: draft.vertex,
            a: draft.a,
            b: hoverImageRef.current,
            coordinateSpace: 'image',
          },
          drawOpts,
          'preview'
        );
      }
    }
  }, [shapes, crossLineVisible, imageSize, resizeTick, umPerPixel, paintTick]);

  useEffect(() => {
    if (activeTool === 'measureLength') {
    }
    if (activeTool === 'measureAngle') {
    }
    if (draftRef.current) {
      if (draftRef.current.kind === 'length') {
      }
      draftRef.current = null;
      hoverDisplayRef.current = null;
      hoverImageRef.current = null;
      requestPaint();
    }
  }, [activeTool, requestPaint]);

  const isDrawingTool = activeTool === 'measureLength' || activeTool === 'measureAngle';

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const display = localPoint(e);
      hoverDisplayRef.current = display;
      onCursor?.(display);

      const angleDrag = angleDragRef.current;
      if (angleDrag && angleDrag.pointerId === e.pointerId) {
        const next = pointForDrag(e, angleDrag.coordinateSpace);
        if (!next) return;
        angleDrag[angleDrag.point] = next;
        const value = angleDeg(angleDrag.vertex, angleDrag.a, angleDrag.b);
        requestPaint();
        const now = Date.now();
        if (now - lastDragLogAtRef.current >= ANGLE_LOG_INTERVAL_MS) {
          lastDragLogAtRef.current = now;
          logAngleValue(angleDrag.id, value, 'drag');
        }
        return;
      }

      const lengthDrag = lengthDragRef.current;
      if (lengthDrag && lengthDrag.pointerId === e.pointerId) {
        lengthDrag.live = display;
        requestPaint();
        const now = Date.now();
        if (now - lastDragLogAtRef.current >= ANGLE_LOG_INTERVAL_MS) {
          lastDragLogAtRef.current = now;
        }
        return;
      }

      const draft = draftRef.current;
      if (draft?.kind === 'angle') {
        const hit = pointerToImagePoint(e, true);
        if (!hit) return;
        if (!samePoint(hoverImageRef.current, hit.image)) {
          hoverImageRef.current = hit.image;
          hoverDisplayRef.current = hit.display;
          requestPaint();
        }
        if (draft.step === 'secondArm') {
          const value = angleDeg(draft.vertex, draft.a, hit.image);
          const now = Date.now();
          if (now - lastAnglePreviewLogAtRef.current >= ANGLE_LOG_INTERVAL_MS) {
            lastAnglePreviewLogAtRef.current = now;
            logAngleValue('_draft', value, 'preview');
          }
        }
        return;
      }

      if (draft?.kind === 'length') {
        requestPaint();
        const now = Date.now();
        if (now - lastLengthLogAtRef.current >= ANGLE_LOG_INTERVAL_MS) {
          lastLengthLogAtRef.current = now;
        }
      }
    },
    [getCurrentPlacement, localPoint, onCursor, pointForDrag, pointerToImagePoint, requestPaint, umPerPixel]
  );

  const handlePointerLeave = useCallback(() => {
    if (lengthDragRef.current || angleDragRef.current) return;
    hoverDisplayRef.current = null;
    hoverImageRef.current = null;
    onCursor?.(null);
    requestPaint();
  }, [onCursor, requestPaint]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const angleDrag = angleDragRef.current;
      if (angleDrag && angleDrag.pointerId === e.pointerId) {
        const wrap = wrapRef.current;
        if (wrap?.hasPointerCapture(e.pointerId)) {
          wrap.releasePointerCapture(e.pointerId);
        }
        const value = angleDeg(angleDrag.vertex, angleDrag.a, angleDrag.b);
        onUpdateShape?.(angleDrag.id, {
          kind: 'angle',
          vertex: copyPoint(angleDrag.vertex),
          a: copyPoint(angleDrag.a),
          b: copyPoint(angleDrag.b),
          coordinateSpace: angleDrag.coordinateSpace,
        });
        logAngleValue(angleDrag.id, value, 'drag');
        angleDragRef.current = null;
        requestPaint();
        e.preventDefault();
        return;
      }

      const lengthDrag = lengthDragRef.current;
      if (!lengthDrag || lengthDrag.pointerId !== e.pointerId) return;
      const wrap = wrapRef.current;
      if (wrap?.hasPointerCapture(e.pointerId)) {
        wrap.releasePointerCapture(e.pointerId);
      }
      const a = lengthDrag.endpoint === 'a' ? lengthDrag.live : lengthDrag.other;
      const b = lengthDrag.endpoint === 'b' ? lengthDrag.live : lengthDrag.other;
      onUpdateShape?.(lengthDrag.id, { kind: 'length', a, b });
      lengthDragRef.current = null;
      requestPaint();
    },
    [getCurrentPlacement, onUpdateShape, requestPaint, umPerPixel]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const display = localPoint(e);
      const draft = draftRef.current;

      if (!draft && (activeTool === 'pointer' || activeTool === 'measureLength' || activeTool === 'measureAngle')) {
        const placement = getCurrentPlacement();
        for (let i = shapes.length - 1; i >= 0; i--) {
          const shape = shapes[i];
          if (
            shape.kind === 'angle' &&
            (activeTool === 'pointer' || activeTool === 'measureAngle')
          ) {
            const point = hitTestAnglePoint(display, shape, placement);
            if (point) {
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              const coordinateSpace = shape.coordinateSpace ?? 'display';
              angleDragRef.current = {
                id: shape.id,
                point,
                pointerId: e.pointerId,
                coordinateSpace,
                vertex: copyPoint(shape.vertex),
                a: copyPoint(shape.a),
                b: copyPoint(shape.b),
              };
              const next = pointForDrag(e, coordinateSpace);
              if (next) {
                angleDragRef.current[point] = next;
              }
              requestPaint();
              e.preventDefault();
              return;
            }
          }

          if (
            shape.kind === 'length' &&
            (activeTool === 'pointer' || activeTool === 'measureLength')
          ) {
            const dA = dist(display, shape.a);
            const dB = dist(display, shape.b);
            const nearer = dA <= dB ? 'a' : 'b';
            const dHit = Math.min(dA, dB);
            if (dHit <= LENGTH_ENDPOINT_HIT_RADIUS) {
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              lengthDragRef.current = {
                id: shape.id,
                endpoint: nearer,
                pointerId: e.pointerId,
                other: nearer === 'a' ? shape.b : shape.a,
                live: display,
              };
              requestPaint();
              e.preventDefault();
              return;
            }
          }
        }
      }

      if (!isDrawingTool) return;

      if (activeTool === 'measureLength') {
        if (!draft) {
          draftRef.current = { kind: 'length', a: display };
          hoverDisplayRef.current = display;
          requestPaint();
        } else if (draft.kind === 'length') {
          onAddShape({ kind: 'length', a: draft.a, b: display });
          draftRef.current = null;
          hoverDisplayRef.current = null;
          requestPaint();
        }
        return;
      }

      if (activeTool === 'measureAngle') {
        const hit = pointerToImagePoint(e, false);
        if (!hit) return;

        if (!draft) {
          draftRef.current = { kind: 'angle', step: 'firstArm', vertex: hit.image };
          hoverImageRef.current = hit.image;
          hoverDisplayRef.current = hit.display;
          requestPaint();
          e.preventDefault();
          return;
        }

        if (draft.kind === 'angle' && draft.step === 'firstArm') {
          draftRef.current = {
            kind: 'angle',
            step: 'secondArm',
            vertex: draft.vertex,
            a: hit.image,
          };
          hoverImageRef.current = hit.image;
          hoverDisplayRef.current = hit.display;
          requestPaint();
          e.preventDefault();
          return;
        }

        if (draft.kind === 'angle' && draft.step === 'secondArm') {
          const value = angleDeg(draft.vertex, draft.a, hit.image);
          onAddShape({
            kind: 'angle',
            vertex: copyPoint(draft.vertex),
            a: copyPoint(draft.a),
            b: copyPoint(hit.image),
            coordinateSpace: 'image',
          });
          draftRef.current = null;
          hoverImageRef.current = null;
          hoverDisplayRef.current = null;
          requestPaint();
          logAngleValue('_finalize', value, 'finalize');
          e.preventDefault();
        }
      }
    },
    [
      activeTool,
      getCurrentPlacement,
      isDrawingTool,
      localPoint,
      onAddShape,
      pointerToImagePoint,
      pointForDrag,
      requestPaint,
      shapes,
      umPerPixel,
    ]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!draftRef.current) return;
      e.preventDefault();
      if (draftRef.current.kind === 'length') {
      }
      draftRef.current = null;
      hoverDisplayRef.current = null;
      hoverImageRef.current = null;
      requestPaint();
    },
    [requestPaint]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (draftRef.current?.kind === 'length') {
      }
      draftRef.current = null;
      hoverDisplayRef.current = null;
      hoverImageRef.current = null;
      requestPaint();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestPaint]);

  const cursor =
    activeTool === 'pointer'
      ? 'default'
      : activeTool === 'magnifier'
      ? 'zoom-in'
      : isDrawingTool
      ? 'crosshair'
      : 'default';

  return (
    <Box
      ref={wrapRef}
      sx={{ ...ROOT_SX, cursor }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onContextMenu={handleContextMenu}
    >
      <canvas ref={canvasRef} style={CANVAS_STYLE} />
    </Box>
  );
}

export default memo(ImageOverlayImpl);
