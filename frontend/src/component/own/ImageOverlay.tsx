import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type {
  OverlayShape,
  OverlayShapeInput,
  Point,
  ToolId,
} from '@/types/tool';

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

const STROKE = '#FFFF00';
const STROKE_ANGLE = '#00E5FF';
const STROKE_CROSS = 'rgba(255,255,255,0.85)';
const TEXT_BG = 'rgba(0,0,0,0.55)';
const FONT = '12px Consolas, ui-monospace, monospace';

function dist(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleDeg(vertex: Point, a: Point, b: Point) {
  const v1x = a.x - vertex.x, v1y = a.y - vertex.y;
  const v2x = b.x - vertex.x, v2y = b.y - vertex.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, at: Point) {
  ctx.font = FONT;
  const metrics = ctx.measureText(text);
  const padX = 4, padY = 2;
  const w = metrics.width + padX * 2;
  const h = 14 + padY * 2;
  ctx.fillStyle = TEXT_BG;
  ctx.fillRect(at.x + 6, at.y + 6, w, h);
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'top';
  ctx.fillText(text, at.x + 6 + padX, at.y + 6 + padY);
}

function drawShape(ctx: CanvasRenderingContext2D, s: OverlayShape) {
  ctx.lineWidth = 1.5;
  if (s.kind === 'length') {
    ctx.strokeStyle = STROKE;
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
    const px = dist(s.a, s.b);
    drawLabel(ctx, `${px.toFixed(1)} px`, s.b);
    return;
  }
  // angle
  ctx.strokeStyle = STROKE_ANGLE;
  ctx.beginPath();
  ctx.moveTo(s.a.x, s.a.y);
  ctx.lineTo(s.vertex.x, s.vertex.y);
  ctx.lineTo(s.b.x, s.b.y);
  ctx.stroke();
  drawLabel(ctx, `${angleDeg(s.vertex, s.a, s.b).toFixed(1)}°`, s.vertex);
}

function drawCross(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = STROKE_CROSS;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
}

type DraftLength = { kind: 'length'; a: Point; b: Point };
type DraftAngle =
  | { kind: 'angle'; step: 'a'; vertex: Point; a: Point }
  | { kind: 'angle'; step: 'b'; vertex: Point; a: Point; b: Point };
type Draft = DraftLength | DraftAngle | null;

type Props = {
  activeTool: ToolId;
  shapes: OverlayShape[];
  crossLineVisible: boolean;
  onAddShape: (shape: OverlayShapeInput) => void;
  onCursor?: (p: Point | null) => void;
  // Called by the overlay when a new length/angle draft starts so the host
  // can drop previously-completed shapes of the same kind. Keeps the camera
  // window from accumulating stale measurement lines across iterations.
  onClearKind?: (kind: OverlayShape['kind']) => void;
};

function ImageOverlayImpl({
  activeTool,
  shapes,
  crossLineVisible,
  onAddShape,
  onCursor,
  onClearKind,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [hover, setHover] = useState<Point | null>(null);

  // Resize the bitmap to match the wrapper size to keep crisp drawing.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const apply = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.max(1, Math.round(rect.width * dpr));
      const targetH = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    };
    apply();

    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Redraw whenever shapes / draft / crossline / hover changes.
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

    if (crossLineVisible) drawCross(ctx, wCss, hCss);

    for (const s of shapes) drawShape(ctx, s);

    if (draft && hover) {
      if (draft.kind === 'length') {
        drawShape(ctx, { id: '_draft', kind: 'length', a: draft.a, b: hover });
      } else if (draft.kind === 'angle') {
        if (draft.step === 'a') {
          ctx.strokeStyle = STROKE_ANGLE;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(hover.x, hover.y);
          ctx.lineTo(draft.vertex.x, draft.vertex.y);
          ctx.stroke();
        } else {
          drawShape(ctx, {
            id: '_draft',
            kind: 'angle',
            vertex: draft.vertex,
            a: draft.a,
            b: hover,
          });
        }
      }
    }
  }, [shapes, draft, hover, crossLineVisible]);

  // Lifecycle: announce open when entering a drawing tool and reset on exit.
  useEffect(() => {
    if (activeTool === 'measureLength') {
      // eslint-disable-next-line no-console
      console.log('[measure-length-open]');
    }
    setDraft((prev) => {
      if (prev) {
        // eslint-disable-next-line no-console
        console.log('[measure-length-reset] reason=tool-switch');
      }
      return null;
    });
  }, [activeTool]);

  // Throttle the per-move length log to ~10Hz so the console isn't flooded.
  const lastLengthLogAtRef = useRef(0);

  const localPoint = useCallback((e: React.PointerEvent): Point => {
    const wrap = wrapRef.current;
    if (!wrap) return { x: 0, y: 0 };
    const rect = wrap.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const isDrawingTool =
    activeTool === 'measureLength' ||
    activeTool === 'measureAngle';

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = localPoint(e);
      setHover(p);
      onCursor?.(p);
      if (draft && draft.kind === 'length') {
        const now = Date.now();
        if (now - lastLengthLogAtRef.current >= 100) {
          lastLengthLogAtRef.current = now;
          const lengthPx = dist(draft.a, p);
          // eslint-disable-next-line no-console
          console.log(
            `[measure-length-update] lengthPx=${lengthPx.toFixed(2)} lengthUm=n/a`
          );
        }
      }
    },
    [draft, localPoint, onCursor]
  );

  const handlePointerLeave = useCallback(() => {
    setHover(null);
    onCursor?.(null);
  }, [onCursor]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (!isDrawingTool) return;
      const p = localPoint(e);

      if (activeTool === 'measureLength') {
        if (!draft) {
          // First click of a new length: drop any previous length shape so
          // only the most recent measurement is visible.
          onClearKind?.('length');
          setDraft({ kind: 'length', a: p, b: p });
          // eslint-disable-next-line no-console
          console.log('[measure-length-start]');
        } else if (draft.kind === 'length') {
          onAddShape({ kind: 'length', a: draft.a, b: p });
          setDraft(null);
          // eslint-disable-next-line no-console
          console.log('[measure-length-complete]');
          // eslint-disable-next-line no-console
          console.log('[measure-length-reset] reason=complete');
        }
        return;
      }
      if (activeTool === 'measureAngle') {
        if (!draft) {
          onClearKind?.('angle');
          setDraft({ kind: 'angle', step: 'a', vertex: p, a: p });
        } else if (draft.kind === 'angle' && draft.step === 'a') {
          setDraft({ kind: 'angle', step: 'b', vertex: draft.vertex, a: p, b: p });
        } else if (draft.kind === 'angle' && draft.step === 'b') {
          onAddShape({ kind: 'angle', vertex: draft.vertex, a: draft.a, b: p });
          setDraft(null);
        }
      }
    },
    [activeTool, draft, isDrawingTool, localPoint, onAddShape, onClearKind]
  );

  // Right-click cancels the in-progress draft.
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (draft) {
        e.preventDefault();
        if (draft.kind === 'length') {
          // eslint-disable-next-line no-console
          console.log('[measure-length-reset] reason=escape');
        }
        setDraft(null);
      }
    },
    [draft]
  );

  // Escape key also cancels an in-progress draft.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setDraft((prev) => {
        if (prev && prev.kind === 'length') {
          // eslint-disable-next-line no-console
          console.log('[measure-length-reset] reason=escape');
        }
        return null;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      onPointerLeave={handlePointerLeave}
      onContextMenu={handleContextMenu}
    >
      <canvas ref={canvasRef} style={CANVAS_STYLE} />
    </Box>
  );
}

export default memo(ImageOverlayImpl);
