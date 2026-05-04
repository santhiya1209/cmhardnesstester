import { memo, useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useCameraStatus } from '@/hooks/queries/useCameraStatus';
import { useCameraStream } from '@/hooks/useCameraStream';
import { colors } from '@/theme/theme';
import ImageOverlay from '@/component/own/ImageOverlay';
import AutoMeasureOverlay from '@/component/own/AutoMeasureOverlay';
import MagnifierLens from '@/component/own/MagnifierLens';
import ManualMeasureOverlay from '@/component/own/ManualMeasureOverlay';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';
import type { ManualMeasureDragResult } from '@/types/manualMeasure';
import type { OverlayShape, OverlayShapeInput, Point, ToolId } from '@/types/tool';
import { displayToImage, getImagePlacement } from '@/utils/manualMeasure';

const ROOT_SX: SxProps<Theme> = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  bgcolor: colors.background,
};

const VIEW_SX: SxProps<Theme> = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
  bgcolor: '#000',
  border: 1,
  borderColor: colors.border,
  m: 1,
};

const COORD_BAR_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  px: 2,
  py: 0.25,
  bgcolor: colors.panel,
  fontSize: 12,
  borderTop: 1,
  borderColor: colors.border,
};

const COORD_VALUE_SX: SxProps<Theme> = {
  fontFamily:
    "'Cascadia Mono', 'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace",
  fontVariantNumeric: 'tabular-nums',
  fontSize: 12,
  color: colors.textPrimary,
  letterSpacing: 0.2,
};

const CANVAS_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
  objectFit: 'contain',
  imageRendering: 'pixelated',
};

type Props = {
  activeTool: ToolId;
  overlayShapes: OverlayShape[];
  autoMeasureGraphics: AutoMeasureGraphics | null;
  crossLineVisible: boolean;
  onAddShape: (shape: OverlayShapeInput) => void;
  manualMeasureResetKey: number;
  onManualMeasurementUpdated: (result: ManualMeasureDragResult) => void;
  onAutoMeasureAdjusted?: (corners: import('@/types/autoMeasure').AutoMeasureCorners) => void;
};

export type CameraWindowHandle = {
  toggleFreeze: () => boolean;
  zoomIn: () => number;
  zoomOut: () => number;
  captureDisplayedFrame: () => {
    ok: true;
    buffer: ArrayBuffer;
    width: number;
    height: number;
    pixelFormat: 'rgb32';
    bits: 8;
    source: 'live-camera' | 'uploaded-image';
  } | { ok: false; error: string };
  loadImageFromBuffer: (buffer: ArrayBufferLike) => Promise<{ ok: boolean; error?: string }>;
  exportImageBlob: (mimeType?: string) => Promise<Blob | null>;
  refetchStatus: () => Promise<void>;
  clearLiveCanvas: () => void;
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;
const COORDINATE_SCALE = 1024;

function statusLabel(o: { sdkLoaded: boolean; open: boolean; streaming: boolean }) {
  if (!o.sdkLoaded) return { label: 'SDK not loaded', color: 'warning' as const };
  if (o.streaming) return { label: 'Streaming', color: 'success' as const };
  if (o.open) return { label: 'Connected', color: 'primary' as const };
  return { label: 'Idle', color: 'default' as const };
}

function CameraWindowImpl(
  {
    activeTool,
    overlayShapes,
    autoMeasureGraphics,
    crossLineVisible,
    onAddShape,
    manualMeasureResetKey,
    onManualMeasurementUpdated,
    onAutoMeasureAdjusted,
  }: Props,
  ref: React.Ref<CameraWindowHandle>
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const freezeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { attachCanvas } = useCameraStream();
  const { status, refetch: refetchStatus } = useCameraStatus();
  const [cursorCoordinate, setCursorCoordinate] = useState<Point | null>(null);
  const [cursorDisplay, setCursorDisplay] = useState<Point | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const imageSourceRef = useRef<'live-camera' | 'uploaded-image'>('live-camera');

  const toggleFreeze = useCallback(() => {
    const live = canvasRef.current;
    const snap = freezeCanvasRef.current;
    if (!live || !snap) return false;
    if (frozen) {
      const ctx = snap.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, snap.width, snap.height);
      imageSourceRef.current = 'live-camera';
      setFrozen(false);
      setImageSize(
        live.width > 0 && live.height > 0
          ? { width: live.width, height: live.height }
          : null
      );
      return false;
    }
    if (live.width === 0 || live.height === 0) return false;
    snap.width = live.width;
    snap.height = live.height;
    const ctx = snap.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(live, 0, 0);
    imageSourceRef.current = 'live-camera';
    setImageSize({ width: live.width, height: live.height });
    setFrozen(true);
    return true;
  }, [frozen]);

  const zoomIn = useCallback(() => {
    let next = 1;
    setZoom((z) => {
      next = Math.min(ZOOM_MAX, +(z * ZOOM_STEP).toFixed(3));
      return next;
    });
    return next;
  }, []);
  const zoomOut = useCallback(() => {
    let next = 1;
    setZoom((z) => {
      next = Math.max(ZOOM_MIN, +(z / ZOOM_STEP).toFixed(3));
      return next;
    });
    return next;
  }, []);

  const captureDisplayedFrame = useCallback<CameraWindowHandle['captureDisplayedFrame']>(() => {
    const live = canvasRef.current;
    const snap = freezeCanvasRef.current;
    const source = frozen && snap && snap.width > 0 && snap.height > 0 ? snap : live;
    if (!source || source.width <= 0 || source.height <= 0) {
      return { ok: false, error: 'no displayed image' };
    }

    const ctx = source.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return { ok: false, error: 'no 2d context' };
    }

    try {
      const imageData = ctx.getImageData(0, 0, source.width, source.height);
      const data = imageData.data;
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const sourceType = frozen ? imageSourceRef.current : 'live-camera';

      if (!frozen && source === live && snap) {
        snap.width = source.width;
        snap.height = source.height;
        const snapCtx = snap.getContext('2d');
        if (snapCtx) {
          snapCtx.putImageData(imageData, 0, 0);
          imageSourceRef.current = 'live-camera';
          setImageSize({ width: source.width, height: source.height });
          setFrozen(true);
        }
      }

      return {
        ok: true,
        buffer,
        width: source.width,
        height: source.height,
        pixelFormat: 'rgb32',
        bits: 8,
        source: sourceType,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [frozen]);

  const loadImageFromBuffer = useCallback(
    async (buffer: ArrayBufferLike): Promise<{ ok: boolean; error?: string }> => {
      const snap = freezeCanvasRef.current;
      if (!snap) return { ok: false, error: 'no-canvas' };
      try {
        const u8 = new Uint8Array(buffer as ArrayBuffer).slice();
        const blob = new Blob([u8]);
        const bitmap = await createImageBitmap(blob);
        snap.width = bitmap.width;
        snap.height = bitmap.height;
        setImageSize({ width: bitmap.width, height: bitmap.height });
        const ctx = snap.getContext('2d');
        if (!ctx) {
          bitmap.close();
          return { ok: false, error: 'no-2d-context' };
        }
        ctx.clearRect(0, 0, snap.width, snap.height);
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        imageSourceRef.current = 'uploaded-image';
        setFrozen(true);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    []
  );

  const exportImageBlob = useCallback(
    (mimeType: string = 'image/png'): Promise<Blob | null> => {
      const live = canvasRef.current;
      const snap = freezeCanvasRef.current;
      const source = frozen && snap && snap.width > 0 ? snap : live;
      if (!source || source.width === 0 || source.height === 0) {
        return Promise.resolve(null);
      }
      // Compose source + overlay shapes onto a fresh canvas matching source pixels.
      const out = document.createElement('canvas');
      out.width = source.width;
      out.height = source.height;
      const ctx = out.getContext('2d');
      if (!ctx) return Promise.resolve(null);
      ctx.drawImage(source, 0, 0);
      return new Promise((resolve) => {
        out.toBlob((blob) => resolve(blob), mimeType);
      });
    },
    [frozen]
  );

  const clearLiveCanvas = useCallback(() => {
    const live = canvasRef.current;
    if (!live) return;
    const ctx = live.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, live.width, live.height);
    if (!frozen) {
      setImageSize(null);
    }
  }, [frozen]);

  useImperativeHandle(
    ref,
    () => ({
      toggleFreeze,
      zoomIn,
      zoomOut,
      captureDisplayedFrame,
      loadImageFromBuffer,
      exportImageBlob,
      refetchStatus,
      clearLiveCanvas,
    }),
    [
      toggleFreeze,
      zoomIn,
      zoomOut,
      captureDisplayedFrame,
      loadImageFromBuffer,
      exportImageBlob,
      refetchStatus,
      clearLiveCanvas,
    ]
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const apply = () => {
      const rect = el.getBoundingClientRect();
      setViewportSize({ w: rect.width, h: rect.height });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Attach the canvas to the worker exactly once when the element mounts.
  useEffect(() => {
    if (canvasRef.current) attachCanvas(canvasRef.current);
  }, [attachCanvas]);

  useEffect(() => {
    if (frozen) {
      return;
    }

    if (status.width > 0 && status.height > 0) {
      setImageSize({ width: status.width, height: status.height });
    }
  }, [frozen, status.height, status.width]);

  const updateCursorFromPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!viewport || !imageSize) {
        setCursorCoordinate(null);
        setCursorDisplay(null);
        return;
      }

      const rect = viewport.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setCursorCoordinate(null);
        setCursorDisplay(null);
        return;
      }

      const displayPoint: Point = {
        x: ((event.clientX - rect.left) / rect.width) * viewport.clientWidth,
        y: ((event.clientY - rect.top) / rect.height) * viewport.clientHeight,
      };
      const placement = getImagePlacement(viewport.clientWidth, viewport.clientHeight, imageSize);
      if (
        !placement ||
        displayPoint.x < placement.offsetX ||
        displayPoint.x > placement.offsetX + placement.width ||
        displayPoint.y < placement.offsetY ||
        displayPoint.y > placement.offsetY + placement.height
      ) {
        setCursorCoordinate(null);
        setCursorDisplay(null);
        return;
      }

      setCursorDisplay(displayPoint);
      const imagePoint = displayToImage(displayPoint, placement, imageSize);
      setCursorCoordinate({
        x: Math.max(
          0,
          Math.min(COORDINATE_SCALE, (imagePoint.x / imageSize.width) * COORDINATE_SCALE)
        ),
        y: Math.max(
          0,
          Math.min(COORDINATE_SCALE, (imagePoint.y / imageSize.height) * COORDINATE_SCALE)
        ),
      });
    },
    [imageSize]
  );

  const clearCursor = useCallback(() => {
    setCursorCoordinate(null);
    setCursorDisplay(null);
  }, []);

  const tag = statusLabel(status);

  return (
    <Box sx={ROOT_SX}>
      <Box sx={VIEW_SX}>
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >
          <Chip size="small" label={tag.label} color={tag.color} variant="filled" />
          {status.width > 0 ? (
            <Typography
              variant="caption"
              sx={{ color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}
            >
              {status.width}×{status.height}
            </Typography>
          ) : null}
        </Box>
        <Box
          ref={viewportRef}
          sx={{
            position: 'absolute',
            inset: 0,
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
            transition: 'transform 120ms ease-out',
          }}
          onPointerMoveCapture={updateCursorFromPointer}
          onPointerLeave={clearCursor}
        >
        <canvas ref={canvasRef} style={CANVAS_STYLE} />
        <canvas
          ref={freezeCanvasRef}
          style={{
            ...CANVAS_STYLE,
            position: 'absolute',
            inset: 0,
            display: frozen ? 'block' : 'none',
            pointerEvents: 'none',
          }}
        />
        <ImageOverlay
          activeTool={activeTool}
          shapes={overlayShapes}
          crossLineVisible={crossLineVisible}
          onAddShape={onAddShape}
        />
        <AutoMeasureOverlay
          graphics={autoMeasureGraphics}
          imageSize={imageSize}
          interactive={activeTool === 'pointer'}
          onAdjusted={onAutoMeasureAdjusted}
        />
        <ManualMeasureOverlay
          active={activeTool === 'manualMeasure'}
          imageSize={imageSize}
          resetKey={manualMeasureResetKey}
          onMeasurementUpdated={onManualMeasurementUpdated}
        />
        {activeTool === 'magnifier' ? (
          <MagnifierLens
            source={frozen ? freezeCanvasRef.current : canvasRef.current}
            cursor={cursorDisplay}
            containerWidth={viewportSize.w}
            containerHeight={viewportSize.h}
          />
        ) : null}
        </Box>
        {frozen ? (
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              px: 1,
              py: 0.25,
              bgcolor: 'rgba(0,0,0,0.55)',
              color: '#FFEB3B',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.4,
              borderRadius: 0.5,
              pointerEvents: 'none',
            }}
          >
            FROZEN
          </Box>
        ) : null}
        {zoom !== 1 ? (
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              px: 1,
              py: 0.25,
              bgcolor: 'rgba(0,0,0,0.55)',
              color: '#FFFFFF',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.4,
              borderRadius: 0.5,
              pointerEvents: 'none',
            }}
          >
            {`${Math.round(zoom * 100)}%`}
          </Box>
        ) : null}
      </Box>

      <Box sx={COORD_BAR_SX}>
        <Typography component="span" sx={COORD_VALUE_SX}>
          X: {cursorCoordinate ? Math.round(cursorCoordinate.x) : '—'}
        </Typography>
        <Typography component="span" sx={COORD_VALUE_SX}>
          Y: {cursorCoordinate ? Math.round(cursorCoordinate.y) : '—'}
        </Typography>
      </Box>
    </Box>
  );
}

export default memo(forwardRef<CameraWindowHandle, Props>(CameraWindowImpl));
