import { memo, useEffect, useRef } from 'react';
import { DEFAULT_CROSSHAIR_CONFIG, type CrosshairConfig } from '@/types/crosshair';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';
import type { ManualGuideLines } from '@/types/manualMeasure';
import type { OverlayShape, Point } from '@/types/tool';
import { getImagePlacement } from '@/utils/manualMeasure';
import { drawLensOverlays } from '@/utils/magnifierOverlay';
import { useRenderCount } from '@/utils/renderStats';

const LENS_SIZE = 140;
const EMPTY_SHAPES: OverlayShape[] = [];

type Props = {
  /** Live camera canvas (native-resolution backing, drawn `objectFit: contain`). */
  liveCanvas: HTMLCanvasElement | null;
  /** Frozen snapshot canvas (same placement as the live canvas). */
  freezeCanvas: HTMLCanvasElement | null;
  /** Which image canvas is the active background right now. */
  frozen: boolean;
  /** Viewport element hosting the stacked layers — read for its client size so
   *  the lens samples in the exact coordinate space the cursor lives in. */
  overlayHost: HTMLDivElement | null;
  /** Cursor position in `overlayHost` client (CSS content) coordinates. */
  cursor: Point | null;
  containerWidth: number;
  containerHeight: number;
  imageSize: { width: number; height: number } | null;
  /** Magnification factor (2 / 4 / 8 / 16). */
  zoom: number;
  /**
   * When true the lens re-samples every animation frame so a live camera feed
   * stays real-time even while the cursor is still. When false (frozen / still
   * image) it draws once per change.
   */
  animate: boolean;
  // Overlay geometry — re-rendered thin (constant screen-space stroke) so the
  // magnifier enlarges the image content without thickening overlay lines.
  crossLineVisible: boolean;
  crosshairConfig?: CrosshairConfig;
  shapes?: OverlayShape[];
  auto?: AutoMeasureGraphics | null;
  manualGuides?: ManualGuideLines | null;
};

function MagnifierLensImpl({
  liveCanvas,
  freezeCanvas,
  frozen,
  overlayHost,
  cursor,
  containerWidth,
  containerHeight,
  imageSize,
  zoom,
  animate,
  crossLineVisible,
  crosshairConfig = DEFAULT_CROSSHAIR_CONFIG,
  shapes = EMPTY_SHAPES,
  auto = null,
  manualGuides = null,
}: Props) {
  useRenderCount('MagnifierLens');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const imageSource = frozen ? freezeCanvas : liveCanvas;

  useEffect(() => {
    const out = canvasRef.current;
    if (!out || !overlayHost || !cursor || !imageSize || !imageSource) return;
    if (imageSource.width === 0 || imageSource.height === 0) return;

    const clearLens = () => {
      const ctx = out.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, out.width, out.height);
    };

    const draw = () => {
      const cw = overlayHost.clientWidth;
      const ch = overlayHost.clientHeight;
      if (cw === 0 || ch === 0) {
        clearLens();
        return;
      }
      // Placement is computed from the SAME client-space the cursor lives in, so
      // the sampled region lines up with what is under the pointer on screen.
      const placement = getImagePlacement(cw, ch, imageSize);
      if (!placement) {
        clearLens();
        return;
      }
      // Only magnify while the cursor is over the displayed image.
      if (
        cursor.x < placement.offsetX ||
        cursor.x > placement.offsetX + placement.width ||
        cursor.y < placement.offsetY ||
        cursor.y > placement.offsetY + placement.height
      ) {
        clearLens();
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(LENS_SIZE * dpr);
      const targetH = Math.round(LENS_SIZE * dpr);
      if (out.width !== targetW || out.height !== targetH) {
        out.width = targetW;
        out.height = targetH;
      }
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, LENS_SIZE, LENS_SIZE);

      // 1. Magnified camera image. Sample a `winCss`-px square (display space)
      //    centred on the cursor and blit it up to the lens. Nearest-neighbour
      //    keeps the pixels exact for precise edge inspection.
      const winCss = LENS_SIZE / zoom;
      const regionLeft = cursor.x - winCss / 2;
      const regionTop = cursor.y - winCss / 2;
      const backScaleX = imageSource.width / imageSize.width;
      const backScaleY = imageSource.height / imageSize.height;
      const imgLeft = (regionLeft - placement.offsetX) / placement.scale;
      const imgTop = (regionTop - placement.offsetY) / placement.scale;
      const imgWin = winCss / placement.scale;
      ctx.imageSmoothingEnabled = false;
      if (imgWin > 0) {
        try {
          ctx.drawImage(
            imageSource,
            imgLeft * backScaleX,
            imgTop * backScaleY,
            imgWin * backScaleX,
            imgWin * backScaleY,
            0,
            0,
            LENS_SIZE,
            LENS_SIZE
          );
        } catch {
          // Source rect fully out of bounds near an edge — nothing to blit.
        }
      }

      // 2. Overlays — re-rendered as thin AA vectors, positions magnified with
      //    the image but strokes at a constant screen-space width.
      drawLensOverlays({
        ctx,
        size: LENS_SIZE,
        cursor,
        placement,
        zoom,
        crossLineVisible,
        crosshairConfig,
        shapes,
        auto,
        manualGuides,
      });

      // 3. Lens reticle — marks the exact cursor point at the centre.
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, LENS_SIZE / 2);
      ctx.lineTo(LENS_SIZE, LENS_SIZE / 2);
      ctx.moveTo(LENS_SIZE / 2, 0);
      ctx.lineTo(LENS_SIZE / 2, LENS_SIZE);
      ctx.stroke();
    };

    const loop = () => {
      draw();
      if (animate) rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [
    imageSource,
    overlayHost,
    cursor,
    imageSize,
    zoom,
    animate,
    crossLineVisible,
    crosshairConfig,
    shapes,
    auto,
    manualGuides,
  ]);

  if (!cursor) return null;

  const offset = 16;
  let left = cursor.x + offset;
  let top = cursor.y + offset;
  if (left + LENS_SIZE > containerWidth) left = cursor.x - LENS_SIZE - offset;
  if (top + LENS_SIZE > containerHeight) top = cursor.y - LENS_SIZE - offset;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: LENS_SIZE,
        height: LENS_SIZE,
        borderRadius: '50%',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
        border: '2px solid rgba(255,255,255,0.9)',
        pointerEvents: 'none',
        background: '#000',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}

export default memo(MagnifierLensImpl);
