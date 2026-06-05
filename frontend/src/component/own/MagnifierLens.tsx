import { memo, useEffect, useRef } from 'react';
import type { Point } from '@/types/tool';
import { getImagePlacement } from '@/utils/manualMeasure';
import { useRenderCount } from '@/utils/renderStats';

const LENS_SIZE = 140;
const LENS_ZOOM = 2.5;

type Props = {
  source: HTMLCanvasElement | null;
  cursor: Point | null;
  containerWidth: number;
  containerHeight: number;
  imageSize: { width: number; height: number } | null;
};

function MagnifierLensImpl({ source, cursor, containerWidth, containerHeight, imageSize }: Props) {
  useRenderCount('MagnifierLens');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const out = canvasRef.current;
    if (!out || !source || !cursor || !imageSize) return;
    if (containerWidth === 0 || containerHeight === 0) return;
    if (source.width === 0 || source.height === 0) return;

    const placement = getImagePlacement(containerWidth, containerHeight, imageSize);
    if (!placement) return;

    if (
      cursor.x < placement.offsetX ||
      cursor.x > placement.offsetX + placement.width ||
      cursor.y < placement.offsetY ||
      cursor.y > placement.offsetY + placement.height
    ) {
      const ctx = out.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, out.width, out.height);
      return;
    }

    const draw = () => {
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

      const imgX = (cursor.x - placement.offsetX) / placement.scale;
      const imgY = (cursor.y - placement.offsetY) / placement.scale;
      const sx = (imgX / imageSize.width) * source.width;
      const sy = (imgY / imageSize.height) * source.height;
      const halfSrc = (LENS_SIZE / (2 * LENS_ZOOM)) * (source.width / placement.width);

      const sxClamped = Math.max(halfSrc, Math.min(source.width - halfSrc, sx));
      const syClamped = Math.max(halfSrc, Math.min(source.height - halfSrc, sy));

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        source,
        sxClamped - halfSrc,
        syClamped - halfSrc,
        halfSrc * 2,
        halfSrc * 2,
        0,
        0,
        LENS_SIZE,
        LENS_SIZE
      );

      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, LENS_SIZE / 2);
      ctx.lineTo(LENS_SIZE, LENS_SIZE / 2);
      ctx.moveTo(LENS_SIZE / 2, 0);
      ctx.lineTo(LENS_SIZE / 2, LENS_SIZE);
      ctx.stroke();
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [source, cursor, containerWidth, containerHeight, imageSize]);

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
