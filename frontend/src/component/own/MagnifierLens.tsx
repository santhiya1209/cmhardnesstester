import { memo, useEffect, useRef } from 'react';
import type { Point } from '@/types/tool';
import { getImagePlacement } from '@/utils/manualMeasure';
import { useRenderCount } from '@/utils/renderStats';

const LENS_SIZE = 140;

type Props = {
  /** Live camera canvas (native-resolution backing, drawn `objectFit: contain`). */
  liveCanvas: HTMLCanvasElement | null;
  /** Frozen snapshot canvas (same placement as the live canvas). */
  freezeCanvas: HTMLCanvasElement | null;
  /** Which image canvas is the active background right now. */
  frozen: boolean;
  /**
   * The viewport element that hosts every stacked canvas layer (image + all
   * overlay canvases). The lens enumerates these to composite the FINAL rendered
   * scene under the cursor — not just the raw image.
   */
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
   * (and any overlay animating on top of it) stays real-time even while the
   * cursor is still. When false (frozen / still image) it draws once per change.
   */
  animate: boolean;
};

/**
 * drawImage that tolerates a source rectangle straying outside the source
 * canvas (happens when the cursor nears an image edge). Per the canvas spec the
 * intersection is clipped to the source and scaled into the proportional
 * destination sub-rect, so the sampled content stays perfectly aligned with the
 * lens centre — out-of-bounds slivers simply render transparent.
 */
function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number
) {
  if (!(sw > 0) || !(sh > 0)) return;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
  try {
    ctx.drawImage(layer, sx, sy, sw, sh, 0, 0, LENS_SIZE, LENS_SIZE);
  } catch {
    // Fully out-of-bounds source rect on some engines — nothing to draw.
  }
}

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
      // Only magnify while the cursor is over the displayed image (not the
      // letterbox padding).
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
      // Nearest-neighbour: keeps the zoom pixel-exact so a 1px overlay line
      // becomes exactly `zoom` px, edges stay crisp, and every layer aligns.
      ctx.imageSmoothingEnabled = false;

      // The lens shows a square window of the on-screen scene, `winCss` display
      // px per side, magnified up to LENS_SIZE — so magnification == `zoom`
      // relative to the live view. Centred on the cursor.
      const winCss = LENS_SIZE / zoom;
      const regionLeft = cursor.x - winCss / 2;
      const regionTop = cursor.y - winCss / 2;

      // Composite every stacked layer in DOM (= visual stacking) order so the
      // lens mirrors the final rendered canvas: image first, then each overlay
      // (crosshair, ROI, calibration, auto/manual measure lines, corner markers)
      // exactly as painted on top of it.
      const layers = overlayHost.querySelectorAll('canvas');
      layers.forEach((layer) => {
        if (layer === out) return; // the lens's own canvas
        if (layer.width === 0 || layer.height === 0) return;

        if (layer === imageSource) {
          // Image canvas: `objectFit: contain`, backing store = native frame.
          // Map the display-space region → image px → native backing px.
          const backScaleX = layer.width / imageSize.width;
          const backScaleY = layer.height / imageSize.height;
          const imgLeft = (regionLeft - placement.offsetX) / placement.scale;
          const imgTop = (regionTop - placement.offsetY) / placement.scale;
          const imgWin = winCss / placement.scale;
          drawLayer(
            ctx,
            layer,
            imgLeft * backScaleX,
            imgTop * backScaleY,
            imgWin * backScaleX,
            imgWin * backScaleY
          );
          return;
        }

        // The inactive image canvas (live while frozen, or the empty freeze
        // canvas) — skip; only the active background is drawn above.
        if (layer === liveCanvas || layer === freezeCanvas) return;

        // Overlay canvas: CSS-fills the viewport, backing store = client × dpr.
        // Map the display-space region straight into its backing store.
        const backScaleX = layer.width / cw;
        const backScaleY = layer.height / ch;
        drawLayer(
          ctx,
          layer,
          regionLeft * backScaleX,
          regionTop * backScaleY,
          winCss * backScaleX,
          winCss * backScaleY
        );
      });

      // Lens reticle — marks the exact cursor point at the centre.
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
      // Live feed: keep the loupe in sync with incoming frames/overlays under a
      // still cursor. Static source (frozen / image): one draw is enough.
      if (animate) rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [
    imageSource,
    liveCanvas,
    freezeCanvas,
    overlayHost,
    cursor,
    imageSize,
    zoom,
    animate,
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
