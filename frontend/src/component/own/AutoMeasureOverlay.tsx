import { memo, useCallback, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { colors } from '@/theme/theme';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';
import { getImagePlacement, imageToDisplay } from '@/utils/manualMeasure';
import type { ManualMeasureImageSize } from '@/utils/manualMeasureOverlayCanvas';
import type { Point } from '@/types/tool';

type Props = {
  graphics: AutoMeasureGraphics | null;
  imageSize: ManualMeasureImageSize | null;
};

const ROOT_SX: SxProps<Theme> = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
};

const CANVAS_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
};

const LABEL_BG = 'rgba(0, 0, 0, 0.68)';
const HANDLE_STROKE = 'rgba(0, 0, 0, 0.9)';
const FONT = '12px Consolas, ui-monospace, monospace';

function drawHandle(ctx: CanvasRenderingContext2D, point: Point) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = colors.autoMeasureLine;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = HANDLE_STROKE;
  ctx.stroke();
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, at: Point) {
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(text).width;
  const x = at.x + 8;
  const y = at.y - 8;

  ctx.fillStyle = LABEL_BG;
  ctx.fillRect(x - 4, y - 9, textWidth + 8, 18);
  ctx.fillStyle = colors.autoMeasureLine;
  ctx.fillText(text, x, y);
}

function AutoMeasureOverlayImpl({ graphics, imageSize }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;

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

      if (!graphics || !imageSize || graphics.lines.length !== 4) {
        return;
      }

      const placement = getImagePlacement(width, height, imageSize);
      if (!placement) {
        return;
      }

      ctx.strokeStyle = colors.autoMeasureLine;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const top = imageToDisplay(graphics.corners.top, placement);
      const right = imageToDisplay(graphics.corners.right, placement);
      const bottom = imageToDisplay(graphics.corners.bottom, placement);
      const left = imageToDisplay(graphics.corners.left, placement);

      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(left.x, 0);
      ctx.lineTo(left.x, height);
      ctx.moveTo(right.x, 0);
      ctx.lineTo(right.x, height);
      ctx.moveTo(0, top.y);
      ctx.lineTo(width, top.y);
      ctx.moveTo(0, bottom.y);
      ctx.lineTo(width, bottom.y);
      ctx.stroke();

      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();
      ctx.setLineDash([]);

      [top, right, bottom, left].forEach((point) => {
        drawHandle(ctx, point);
      });

      drawLabel(ctx, 'D1', {
        x: (left.x + right.x) / 2,
        y: (left.y + right.y) / 2 + 12,
      });
      drawLabel(ctx, 'D2', {
        x: top.x,
        y: top.y + (bottom.y - top.y) * 0.35,
      });
    });
  }, [graphics, imageSize]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    draw();
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(wrap);
    return () => {
      resizeObserver.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <Box ref={wrapRef} sx={ROOT_SX}>
      <canvas ref={canvasRef} style={CANVAS_STYLE} />
    </Box>
  );
}

export default memo(AutoMeasureOverlayImpl);
