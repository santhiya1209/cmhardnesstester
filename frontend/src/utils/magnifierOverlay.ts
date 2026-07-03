import type { AutoMeasureGraphics } from '@/types/autoMeasure';
import type { CrosshairConfig } from '@/types/crosshair';
import type { ManualGuideLines } from '@/types/manualMeasure';
import type { OverlayShape, Point } from '@/types/tool';
import { getImagePlacement, guideLinesToPoints, imageToDisplay } from '@/utils/manualMeasure';
import { tokens } from '@/theme/theme';

type ImagePlacement = NonNullable<ReturnType<typeof getImagePlacement>>;

/**
 * Yellow used by both Manual and Auto measure guide lines (matches
 * manualMeasureOverlayCanvas / AutoMeasureOverlay).
 */
const YELLOW = '#FFFF00';
/** Magenta used by the Measure Length / Angle shapes (matches ImageOverlay). */
const SHAPE_COLOR = tokens.overlay.measureAngleLine;

/**
 * Constant SCREEN-space stroke width (CSS px) for every measurement overlay in
 * the lens. Deliberately NOT multiplied by `zoom` — the magnifier enlarges the
 * image content, the overlay strokes stay thin and crisp for precision edge
 * alignment, exactly like professional hardness-tester loupes.
 */
const MEASURE_STROKE = 1.5;
const HANDLE_RADIUS = 3;
const LENGTH_TICK_HALF = 5;

export type LensOverlayParams = {
  ctx: CanvasRenderingContext2D;
  /** Lens size in CSS px (the ctx is already dpr-scaled to this box). */
  size: number;
  /** Cursor position in display (viewport client) coordinates. */
  cursor: Point;
  /** Image→display placement (centred, letterboxed) for the on-screen view. */
  placement: ImagePlacement;
  /** Magnification factor (2 / 4 / 8 / 16). */
  zoom: number;
  crossLineVisible: boolean;
  crosshairConfig: CrosshairConfig;
  shapes: OverlayShape[];
  auto: AutoMeasureGraphics | null;
  manualGuides: ManualGuideLines | null;
};

/**
 * Re-renders every overlay as a thin vector inside the magnifier lens.
 *
 * The lens shows a `size/zoom`-px window of the on-screen scene centred on the
 * cursor, magnified up to `size`. So a point's lens position is its offset from
 * the cursor (in display px) multiplied by `zoom` — POSITION scales with the
 * image, while `ctx.lineWidth` stays a constant screen-space value. That is the
 * whole point: image content enlarges, overlay strokes do not thicken.
 *
 * All geometry goes through the same `imageToDisplay` / `guideLinesToPoints`
 * helpers the on-screen overlays use, so the lens can never drift from the real
 * measurement positions.
 */
export function drawLensOverlays(params: LensOverlayParams) {
  const {
    ctx,
    size,
    cursor,
    placement,
    zoom,
    crossLineVisible,
    crosshairConfig,
    shapes,
    auto,
    manualGuides,
  } = params;
  const center = size / 2;

  // Display-space point → lens-space point: magnify the offset from the cursor.
  const d2l = (d: Point): Point => ({
    x: (d.x - cursor.x) * zoom + center,
    y: (d.y - cursor.y) * zoom + center,
  });
  // Image-space point → lens-space point.
  const i2l = (p: Point): Point => d2l(imageToDisplay(p, placement));

  ctx.save();
  // Anti-aliased vector strokes: crisp, smooth, high-contrast thin lines.
  ctx.imageSmoothingEnabled = true;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  const hLine = (y: number, color: string, w: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  };
  const vLine = (x: number, color: string, w: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  };
  const seg = (a: Point, b: Point, color: string, w: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  const handle = (p: Point, color: string) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = color;
    ctx.stroke();
  };

  // 1. Crosshair reference lines — fixed at the image centre (optical axis).
  if (crossLineVisible) {
    const c = d2l({
      x: placement.offsetX + placement.width / 2,
      y: placement.offsetY + placement.height / 2,
    });
    hLine(c.y, crosshairConfig.color, crosshairConfig.thickness);
    vLine(c.x, crosshairConfig.color, crosshairConfig.thickness);
  }

  // 2. Auto Measure — yellow guide lines / diagonals + corner markers.
  if (auto?.corners) {
    const { top, right, bottom, left } = auto.corners;
    if (auto.lineLayout === 'two-diagonals') {
      seg(i2l(left), i2l(right), YELLOW, MEASURE_STROKE);
      seg(i2l(top), i2l(bottom), YELLOW, MEASURE_STROKE);
    } else {
      vLine(i2l(left).x, YELLOW, MEASURE_STROKE);
      vLine(i2l(right).x, YELLOW, MEASURE_STROKE);
      hLine(i2l(top).y, YELLOW, MEASURE_STROKE);
      hLine(i2l(bottom).y, YELLOW, MEASURE_STROKE);
    }
    for (const corner of [top, right, bottom, left]) handle(i2l(corner), YELLOW);
  }

  // 3. Manual Measure — four yellow guide lines + diagonal-tip handles.
  if (manualGuides) {
    vLine(i2l({ x: manualGuides.leftX, y: 0 }).x, YELLOW, MEASURE_STROKE);
    vLine(i2l({ x: manualGuides.rightX, y: 0 }).x, YELLOW, MEASURE_STROKE);
    hLine(i2l({ x: 0, y: manualGuides.topY }).y, YELLOW, MEASURE_STROKE);
    hLine(i2l({ x: 0, y: manualGuides.bottomY }).y, YELLOW, MEASURE_STROKE);
    for (const tip of guideLinesToPoints(manualGuides)) handle(i2l(tip), YELLOW);
  }

  // 4. Measure Length / Angle shapes (magenta).
  for (const shape of shapes) {
    if (shape.kind === 'length') {
      // Length endpoints are stored in display space.
      const a = d2l(shape.a);
      const b = d2l(shape.b);
      seg(a, b, SHAPE_COLOR, MEASURE_STROKE);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.5) {
        const px = (-dy / len) * LENGTH_TICK_HALF;
        const py = (dx / len) * LENGTH_TICK_HALF;
        seg({ x: a.x + px, y: a.y + py }, { x: a.x - px, y: a.y - py }, SHAPE_COLOR, MEASURE_STROKE);
        seg({ x: b.x + px, y: b.y + py }, { x: b.x - px, y: b.y - py }, SHAPE_COLOR, MEASURE_STROKE);
      }
      continue;
    }
    // Angle: points are image-space unless explicitly display-space.
    const toLens = shape.coordinateSpace === 'image' ? i2l : d2l;
    const vertex = toLens(shape.vertex);
    const a = toLens(shape.a);
    const b = toLens(shape.b);
    seg(vertex, a, SHAPE_COLOR, MEASURE_STROKE);
    seg(vertex, b, SHAPE_COLOR, MEASURE_STROKE);
    handle(vertex, SHAPE_COLOR);
    handle(a, SHAPE_COLOR);
    handle(b, SHAPE_COLOR);
  }

  ctx.restore();
}
