import type { ManualMeasurePoints } from '@/types/manualMeasure';
import type { Point } from '@/types/tool';
import {
  displayToImage,
  distancePx,
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
  markers: ManualMeasurePoints | null;
  hoverIndex: number | null;
  dragIndex: number | null;
};

const HANDLE_RADIUS = 6;
const HIT_RADIUS = 14;
const YELLOW = '#FFFF00';
const LABEL_BG = 'rgba(0,0,0,0.58)';
const FONT = '12px Consolas, ui-monospace, monospace';

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, at: Point) {
  ctx.font = FONT;
  const width = ctx.measureText(text).width + 8;
  ctx.fillStyle = LABEL_BG;
  ctx.fillRect(at.x + 6, at.y + 6, width, 18);
  ctx.fillStyle = YELLOW;
  ctx.textBaseline = 'top';
  ctx.fillText(text, at.x + 10, at.y + 9);
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

export function hitTestManualMarker(
  event: { clientX: number; clientY: number },
  wrap: HTMLDivElement,
  imageSize: ManualMeasureImageSize,
  markers: ManualMeasurePoints
): number | null {
  const displayPoint = pointerToDisplayPoint(event, wrap);
  const placement = getImagePlacement(wrap.clientWidth, wrap.clientHeight, imageSize);

  if (!displayPoint || !placement) {
    return null;
  }

  let bestIndex: number | null = null;
  let bestDistance = HIT_RADIUS;
  markers.forEach((point, index) => {
    const displayMarker = imageToDisplay(point, placement);
    const distance = distancePx(displayPoint, displayMarker);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export function drawManualMeasureOverlay({
  active,
  canvas,
  dragIndex,
  hoverIndex,
  imageSize,
  markers,
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

  if (!active || !imageSize || !markers) {
    return;
  }

  const placement = getImagePlacement(width, height, imageSize);
  if (!placement) {
    return;
  }

  const displayPoints = markers.map((point) =>
    imageToDisplay(point, placement)
  ) as ManualMeasurePoints;

  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(displayPoints[0].x, displayPoints[0].y);
  ctx.lineTo(displayPoints[1].x, displayPoints[1].y);
  ctx.lineTo(displayPoints[2].x, displayPoints[2].y);
  ctx.lineTo(displayPoints[3].x, displayPoints[3].y);
  ctx.closePath();
  ctx.stroke();

  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(displayPoints[0].x, displayPoints[0].y);
  ctx.lineTo(displayPoints[2].x, displayPoints[2].y);
  ctx.moveTo(displayPoints[1].x, displayPoints[1].y);
  ctx.lineTo(displayPoints[3].x, displayPoints[3].y);
  ctx.stroke();
  ctx.setLineDash([]);

  drawLabel(ctx, 'D1', midpoint(displayPoints[0], displayPoints[2]));
  drawLabel(ctx, 'D2', midpoint(displayPoints[1], displayPoints[3]));

  displayPoints.forEach((point, index) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = YELLOW;
    ctx.fill();
    ctx.lineWidth = index === hoverIndex || index === dragIndex ? 2 : 1;
    ctx.strokeStyle = '#111111';
    ctx.stroke();
  });
}
