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
  hoverGuide: ManualGuideLineKey | null;
  dragGuide: ManualGuideLineKey | null;
  /**
   * Base stroke width in CSS px for the yellow guide lines. Hover/drag lines
   * render at strokeWidth + 0.5 to preserve the existing affordance. Defaults
   * to 2 (legacy "normal").
   */
  strokeWidth?: number;
  /** Optional layout override; defaults to 'four-guides' for back-compat. */
  lineLayout?: OverlayLineLayout;
};

const HIT_DISTANCE = 10;
const YELLOW = '#FFFF00';
const DEFAULT_LINE_WIDTH = 2;

export type TwoLinesHandle = 'left' | 'right' | 'top' | 'bottom' | 'd1-body' | 'd2-body';

type DrawTwoIndependentLinesArgs = {
  canvas: HTMLCanvasElement;
  wrap: HTMLDivElement;
  active: boolean;
  imageSize: ManualMeasureImageSize | null;
  // All four endpoints in image coords. D1 = left↔right, D2 = top↔bottom.
  d1Start: Point | null;
  d1End: Point | null;
  d2Start: Point | null;
  d2End: Point | null;
  hover: TwoLinesHandle | null;
  drag: TwoLinesHandle | null;
  strokeWidth?: number;
};

// Renders two independent diagonal segments for the 10X simplified Auto
// Measure layout. Unlike `drawManualMeasureOverlay`, the endpoints carry
// their own (x, y) — D1 does not share midY with D2, and D2 does not share
// midX with D1. Each line and each endpoint is independently draggable.
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
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);

  // D1 segment
  ctx.lineWidth = hover === 'd1-body' || drag === 'd1-body' ? activeWidth : baseWidth;
  ctx.beginPath();
  ctx.moveTo(dD1S.x, dD1S.y);
  ctx.lineTo(dD1E.x, dD1E.y);
  ctx.stroke();

  // D2 segment
  ctx.lineWidth = hover === 'd2-body' || drag === 'd2-body' ? activeWidth : baseWidth;
  ctx.beginPath();
  ctx.moveTo(dD2S.x, dD2S.y);
  ctx.lineTo(dD2E.x, dD2E.y);
  ctx.stroke();

  // Endpoint handles
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

// Clamp a point to image bounds. Returns the clamped point and a flag
// indicating whether clamping actually moved the point.
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

export function drawManualMeasureOverlay({
  active,
  canvas,
  dragGuide,
  guides,
  hoverGuide,
  imageSize,
  wrap,
  strokeWidth,
  lineLayout,
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

  ctx.strokeStyle = YELLOW;
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);

  const baseWidth = typeof strokeWidth === 'number' && strokeWidth > 0 ? strokeWidth : DEFAULT_LINE_WIDTH;
  const activeWidth = baseWidth + 0.5;
  const lineWidth = (key: ManualGuideLineKey) =>
    key === hoverGuide || key === dragGuide ? activeWidth : baseWidth;

  if (lineLayout === 'two-diagonals') {
    // 10X simplified Auto Measure: draw only the D1 + D2 corner-to-corner
    // segments. D1 = (leftX, midY) ↔ (rightX, midY) — horizontal axis of
    // the diamond. D2 = (midX, topY) ↔ (midX, bottomY) — vertical axis.
    // Hover/drag-affordance still uses lineWidth(left|right|top|bottom).
    const midX = (displayGuides.leftX + displayGuides.rightX) * 0.5;
    const midY = (displayGuides.topY + displayGuides.bottomY) * 0.5;

    const d1Width = Math.max(lineWidth('left'), lineWidth('right'));
    ctx.beginPath();
    ctx.lineWidth = d1Width;
    ctx.moveTo(displayGuides.leftX, midY);
    ctx.lineTo(displayGuides.rightX, midY);
    ctx.stroke();

    const d2Width = Math.max(lineWidth('top'), lineWidth('bottom'));
    ctx.beginPath();
    ctx.lineWidth = d2Width;
    ctx.moveTo(midX, displayGuides.topY);
    ctx.lineTo(midX, displayGuides.bottomY);
    ctx.stroke();
    return;
  }

  // Four full-extent solid yellow guides framing the indentation —
  // matches the reference industrial Vickers overlay.
  ctx.beginPath();
  ctx.lineWidth = lineWidth('left');
  ctx.moveTo(displayGuides.leftX, 0);
  ctx.lineTo(displayGuides.leftX, height);
  ctx.stroke();

  ctx.beginPath();
  ctx.lineWidth = lineWidth('right');
  ctx.moveTo(displayGuides.rightX, 0);
  ctx.lineTo(displayGuides.rightX, height);
  ctx.stroke();

  ctx.beginPath();
  ctx.lineWidth = lineWidth('top');
  ctx.moveTo(0, displayGuides.topY);
  ctx.lineTo(width, displayGuides.topY);
  ctx.stroke();

  ctx.beginPath();
  ctx.lineWidth = lineWidth('bottom');
  ctx.moveTo(0, displayGuides.bottomY);
  ctx.lineTo(width, displayGuides.bottomY);
  ctx.stroke();
}
