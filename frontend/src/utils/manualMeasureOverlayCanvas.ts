import type {
  ManualGuideLineKey,
  ManualGuideLines,
} from '@/types/manualMeasure';
import type { Point } from '@/types/tool';
import {
  displayToImage,
  getImagePlacement,
  imageToDisplay,
} from '@/utils/manualMeasure';

export type ManualMeasureImageSize = {
  width: number;
  height: number;
};

/**
 * Layout for the yellow Auto-Measure / Manual-Measure overlay lines.
 *  - 'four-guides'   : four full-extent guides at leftX / rightX / topY / bottomY.
 *                      Used by Manual Measure and 40X+ Auto Measure.
 *  - 'two-diagonals' : two corner-to-corner diagonal segments — D1 from the
 *                      left tip (leftX, midY) to the right tip (rightX, midY),
 *                      and D2 from top tip (midX, topY) to bottom tip
 *                      (midX, bottomY). Used by 10X simplified Auto Measure
 *                      where full 4-corner edge refinement is unstable.
 */
export type OverlayLineLayout = 'four-guides' | 'two-diagonals';

type DrawArgs = {
  canvas: HTMLCanvasElement;
  wrap: HTMLDivElement;
  active: boolean;
  imageSize: ManualMeasureImageSize | null;
  guides: ManualGuideLines | null;
  /**
   * @deprecated Ignored — reference guides no longer change width or color on
   * hover/drag (the cursor conveys that). Still accepted so callers compile.
   */
  hoverGuide: ManualGuideLineKey | null;
  /** @deprecated Ignored — see `hoverGuide`. Drag is shown by the cursor. */
  dragGuide: ManualGuideLineKey | null;
  /**
   * Keyboard-selected guide line. Rendered in white (vs. yellow) — by COLOR
   * only, never extra width — so the operator sees which line the arrow keys
   * control without the line thickening over the indent edge.
   */
  selectedGuide?: ManualGuideLineKey | null;
  /**
   * @deprecated Ignored for reference guides — they always render at the shared
   * `MEASUREMENT_LINE_WIDTH` hairline, independent of the thin/normal/thick
   * toggle. Still accepted so existing callers compile.
   */
  strokeWidth?: number;
  /** Optional layout override; defaults to 'four-guides' for back-compat. */
  lineLayout?: OverlayLineLayout;
  /**
   * Manual Measure mode: draw thin hairline guides plus a small circular handle
   * at each of the four diagonal tips (hollow when idle, filled yellow with a
   * white outline when selected), and DON'T thicken the selected line — the
   * handle marks the selection so the line never covers the indent edge. Off by
   * default so the Auto Measure overlay (which shares this draw fn and renders
   * its own corner handles) is unaffected.
   */
  endpointHandles?: boolean;
  /**
   * Snap each guide's stroke to the device-pixel grid so a 1px hairline lands on
   * exactly one column/row of device pixels (crisp) instead of straddling two
   * (soft ~1.5px). This is a RENDER-only alignment — the underlying guide image
   * coordinates and the measured d1/d2 are never changed, so it is NOT a
   * measurement correction offset. Pass `true` only when idle: snapping quantizes
   * the drawn line in ≤1 device-px steps, so drag smoothness is preserved by
   * passing `false` while a drag is in progress. Off (sub-pixel) by default,
   * keeping Auto's rendering unchanged.
   */
  snapToDevicePixels?: boolean;
};

const HIT_DISTANCE = 10;
const YELLOW = '#FFFF00';
const DEFAULT_LINE_WIDTH = 2;

/**
 * The single shared stroke width (CSS px) for every measurement REFERENCE guide
 * — Manual, Auto, and keyboard-adjustment alike. A crisp 1px hairline so the
 * line never covers the indent edge (professional-tester convention). Fixed on
 * purpose: reference-line precision must not depend on the thin/normal/thick
 * annotation toggle, and it must never thicken on hover / drag / selection.
 */
export const MEASUREMENT_LINE_WIDTH = 1;

export type TwoLinesHandle = 'left' | 'right' | 'top' | 'bottom' | 'd1-body' | 'd2-body';

type DrawTwoIndependentLinesArgs = {
  canvas: HTMLCanvasElement;
  wrap: HTMLDivElement;
  active: boolean;
  imageSize: ManualMeasureImageSize | null;
  d1Start: Point | null;
  d1End: Point | null;
  d2Start: Point | null;
  d2End: Point | null;
  hover: TwoLinesHandle | null;
  drag: TwoLinesHandle | null;
  strokeWidth?: number;
};

export function drawTwoIndependentLines({
  canvas,
  wrap,
  active,
  imageSize,
  d1Start,
  d1End,
  d2Start,
  d2End,
  hover,
  drag,
  strokeWidth,
}: DrawTwoIndependentLinesArgs) {
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

  if (!active || !imageSize || !d1Start || !d1End || !d2Start || !d2End) {
    return;
  }

  const placement = getImagePlacement(width, height, imageSize);
  if (!placement) return;

  const baseWidth = typeof strokeWidth === 'number' && strokeWidth > 0 ? strokeWidth : DEFAULT_LINE_WIDTH;
  const activeWidth = baseWidth + 0.5;

  const dD1S = imageToDisplay(d1Start, placement);
  const dD1E = imageToDisplay(d1End, placement);
  const dD2S = imageToDisplay(d2Start, placement);
  const dD2E = imageToDisplay(d2End, placement);

  ctx.strokeStyle = YELLOW;
  ctx.fillStyle = YELLOW;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  const top = dD2S;
  const right = dD1E;
  const bottom = dD2E;
  const left = dD1S;
  const EXTEND_FACTOR = 0.7;
  const extendedEndpoints = (a: Point, b: Point): [Point, Point] => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return [a, b];
    const ex = (dx / len) * len * EXTEND_FACTOR;
    const ey = (dy / len) * len * EXTEND_FACTOR;
    return [
      { x: a.x - ex, y: a.y - ey },
      { x: b.x + ex, y: b.y + ey },
    ];
  };
  ctx.lineWidth = baseWidth;
  const strokeEdge = (a: Point, b: Point) => {
    const [pa, pb] = extendedEndpoints(a, b);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  };
  strokeEdge(top, right);
  strokeEdge(right, bottom);
  strokeEdge(bottom, left);
  strokeEdge(left, top);

  const diagonalWidth = Math.max(1, baseWidth - 0.6);
  ctx.lineWidth = hover === 'd1-body' || drag === 'd1-body' ? activeWidth : diagonalWidth;
  ctx.beginPath();
  ctx.moveTo(dD1S.x, dD1S.y);
  ctx.lineTo(dD1E.x, dD1E.y);
  ctx.stroke();

  ctx.lineWidth = hover === 'd2-body' || drag === 'd2-body' ? activeWidth : diagonalWidth;
  ctx.beginPath();
  ctx.moveTo(dD2S.x, dD2S.y);
  ctx.lineTo(dD2E.x, dD2E.y);
  ctx.stroke();

  const handleRadius = 4;
  const drawHandle = (p: Point, key: TwoLinesHandle) => {
    const r = hover === key || drag === key ? handleRadius + 1 : handleRadius;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  drawHandle(dD1S, 'left');
  drawHandle(dD1E, 'right');
  drawHandle(dD2S, 'top');
  drawHandle(dD2E, 'bottom');
}

export function clampPointToImage(
  p: Point,
  imageSize: ManualMeasureImageSize
): { point: Point; clamped: boolean } {
  const x = Math.max(0, Math.min(imageSize.width, p.x));
  const y = Math.max(0, Math.min(imageSize.height, p.y));
  return {
    point: { x, y },
    clamped: x !== p.x || y !== p.y,
  };
}

export function pointerToDisplayPoint(
  event: { clientX: number; clientY: number },
  wrap: HTMLDivElement
): Point | null {
  const rect = wrap.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    x: ((event.clientX - rect.left) / rect.width) * wrap.clientWidth,
    y: ((event.clientY - rect.top) / rect.height) * wrap.clientHeight,
  };
}

export function pointerToImagePoint(
  event: { clientX: number; clientY: number },
  wrap: HTMLDivElement,
  imageSize: ManualMeasureImageSize
): Point | null {
  const displayPoint = pointerToDisplayPoint(event, wrap);
  const placement = getImagePlacement(wrap.clientWidth, wrap.clientHeight, imageSize);

  if (!displayPoint || !placement) {
    return null;
  }

  return displayToImage(displayPoint, placement, imageSize);
}

export function getDisplayGuidePositions(
  guides: ManualGuideLines,
  wrap: HTMLDivElement,
  imageSize: ManualMeasureImageSize
): ManualGuideLines | null {
  const placement = getImagePlacement(wrap.clientWidth, wrap.clientHeight, imageSize);
  if (!placement) {
    return null;
  }

  return {
    leftX: imageToDisplay({ x: guides.leftX, y: 0 }, placement).x,
    rightX: imageToDisplay({ x: guides.rightX, y: 0 }, placement).x,
    topY: imageToDisplay({ x: 0, y: guides.topY }, placement).y,
    bottomY: imageToDisplay({ x: 0, y: guides.bottomY }, placement).y,
  };
}

export function hitTestManualGuideLine(
  event: { clientX: number; clientY: number },
  wrap: HTMLDivElement,
  imageSize: ManualMeasureImageSize,
  guides: ManualGuideLines
): ManualGuideLineKey | null {
  const displayPoint = pointerToDisplayPoint(event, wrap);
  const displayGuides = getDisplayGuidePositions(guides, wrap, imageSize);

  if (!displayPoint || !displayGuides) {
    return null;
  }

  const distances: Array<{ key: ManualGuideLineKey; distance: number }> = [
    { key: 'left', distance: Math.abs(displayPoint.x - displayGuides.leftX) },
    { key: 'right', distance: Math.abs(displayPoint.x - displayGuides.rightX) },
    { key: 'top', distance: Math.abs(displayPoint.y - displayGuides.topY) },
    { key: 'bottom', distance: Math.abs(displayPoint.y - displayGuides.bottomY) },
  ];
  const nearest = distances.reduce((best, item) =>
    item.distance < best.distance ? item : best
  );

  return nearest.distance <= HIT_DISTANCE ? nearest.key : null;
}

const YELLOW_SELECTED = '#FFFFFF';

export function drawManualMeasureOverlay({
  active,
  canvas,
  guides,
  selectedGuide,
  imageSize,
  wrap,
  lineLayout,
  endpointHandles,
  snapToDevicePixels,
}: DrawArgs) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

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

  if (!active || !imageSize || !guides) {
    return;
  }

  const displayGuides = getDisplayGuidePositions(guides, wrap, imageSize);
  if (!displayGuides) {
    return;
  }

  // Round caps/joins for crisp, professional reference lines.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  // One shared measurement-line style for Manual + Auto guides: a crisp 1px
  // hairline (MEASUREMENT_LINE_WIDTH) that NEVER thickens on hover / drag /
  // keyboard-selection. The selected line is marked by COLOR (white) and, in
  // Manual, the endpoint handle — not by extra width, so it never covers the
  // indent edge. Fixed width independent of the thin/normal/thick toggle.
  const baseWidth = MEASUREMENT_LINE_WIDTH;

  const lineWidth = (_key: ManualGuideLineKey) => baseWidth;
  const lineColor = (key: ManualGuideLineKey) =>
    key === selectedGuide ? YELLOW_SELECTED : YELLOW;

  if (lineLayout === 'two-diagonals') {
    const midX = (displayGuides.leftX + displayGuides.rightX) * 0.5;
    const midY = (displayGuides.topY + displayGuides.bottomY) * 0.5;

    const d1Width = Math.max(lineWidth('left'), lineWidth('right'));
    ctx.strokeStyle = lineColor('left');
    ctx.beginPath();
    ctx.lineWidth = d1Width;
    ctx.moveTo(displayGuides.leftX, midY);
    ctx.lineTo(displayGuides.rightX, midY);
    ctx.stroke();

    const d2Width = Math.max(lineWidth('top'), lineWidth('bottom'));
    ctx.strokeStyle = lineColor('top');
    ctx.beginPath();
    ctx.lineWidth = d2Width;
    ctx.moveTo(midX, displayGuides.topY);
    ctx.lineTo(midX, displayGuides.bottomY);
    ctx.stroke();
    return;
  }

  // Device-pixel snap for crisp hairlines (render-only; see snapToDevicePixels
  // doc). Aligns the stroke so its edge sits on a device-pixel boundary: for a
  // 1px line at dpr=1 this yields a half-integer center; at dpr=2, an integer.
  // Non-integer dpr (125%/150% scaling) is aligned best-effort. When off, the
  // raw sub-pixel float is used so a live drag stays perfectly smooth.
  const snap = (v: number): number => {
    if (!snapToDevicePixels) return v;
    const half = (baseWidth * dpr) / 2;
    return (Math.round(v * dpr - half) + half) / dpr;
  };
  const leftX = snap(displayGuides.leftX);
  const rightX = snap(displayGuides.rightX);
  const topY = snap(displayGuides.topY);
  const bottomY = snap(displayGuides.bottomY);

  ctx.strokeStyle = lineColor('left');
  ctx.beginPath();
  ctx.lineWidth = lineWidth('left');
  ctx.moveTo(leftX, 0);
  ctx.lineTo(leftX, height);
  ctx.stroke();

  ctx.strokeStyle = lineColor('right');
  ctx.beginPath();
  ctx.lineWidth = lineWidth('right');
  ctx.moveTo(rightX, 0);
  ctx.lineTo(rightX, height);
  ctx.stroke();

  ctx.strokeStyle = lineColor('top');
  ctx.beginPath();
  ctx.lineWidth = lineWidth('top');
  ctx.moveTo(0, topY);
  ctx.lineTo(width, topY);
  ctx.stroke();

  ctx.strokeStyle = lineColor('bottom');
  ctx.beginPath();
  ctx.lineWidth = lineWidth('bottom');
  ctx.moveTo(0, bottomY);
  ctx.lineTo(width, bottomY);
  ctx.stroke();

  if (endpointHandles) {
    // Small circular handle at each diagonal tip: hollow yellow when idle, a
    // filled yellow disc with a white outline when selected, so the operator
    // always sees which endpoint the arrow keys will move. Anchored on the same
    // (snapped) line coordinates so a handle always sits exactly on its line.
    const midX = (leftX + rightX) * 0.5;
    const midY = (topY + bottomY) * 0.5;
    const tips: Array<{ key: ManualGuideLineKey; x: number; y: number }> = [
      { key: 'left', x: leftX, y: midY },
      { key: 'right', x: rightX, y: midY },
      { key: 'top', x: midX, y: topY },
      { key: 'bottom', x: midX, y: bottomY },
    ];
    for (const tip of tips) {
      const selected = tip.key === selectedGuide;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, selected ? 5 : 4, 0, Math.PI * 2);
      if (selected) {
        ctx.fillStyle = YELLOW;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = YELLOW_SELECTED;
        ctx.stroke();
      } else {
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = YELLOW;
        ctx.stroke();
      }
    }
  }
}
