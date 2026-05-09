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

type DrawArgs = {
  canvas: HTMLCanvasElement;
  wrap: HTMLDivElement;
  active: boolean;
  imageSize: ManualMeasureImageSize | null;
  guides: ManualGuideLines | null;
  hoverGuide: ManualGuideLineKey | null;
  dragGuide: ManualGuideLineKey | null;
};

const HIT_DISTANCE = 10;
const YELLOW = '#FFFF00';
const LINE_WIDTH = 2;
const LINE_WIDTH_ACTIVE = 2.5;

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

  const lineWidth = (key: ManualGuideLineKey) =>
    key === hoverGuide || key === dragGuide ? LINE_WIDTH_ACTIVE : LINE_WIDTH;

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
