import { memo, useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useCameraStatus } from '@/hooks/queries/useCameraStatus';
import {
  bumpFrameEpochOnCanvasClear,
  getCurrentFrameEpoch,
  getLastCameraFramePaintAt,
  getLastPaintEpoch,
  getLatestFullFrame,
  useCameraStream,
  waitForFreshCameraFrame,
} from '@/hooks/useCameraStream';
import { tokens } from '@/theme/theme';
import { useRenderCount } from '@/utils/renderStats';
import ImageOverlay from '@/component/own/ImageOverlay';
import AutoMeasureOverlay from '@/component/own/AutoMeasureOverlay';
import MagnifierLens from '@/component/own/MagnifierLens';
import ManualMeasureOverlay from '@/component/own/ManualMeasureOverlay';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';
import type { CameraPixelFormat } from '@/types/camera';
import type { ManualMeasureDragResult } from '@/types/manualMeasure';
import type { OverlayShape, OverlayShapeInput, Point, ToolId } from '@/types/tool';
import { displayToImage, getImagePlacement } from '@/utils/manualMeasure';

const ROOT_SX: SxProps<Theme> = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  bgcolor: tokens.surface.base,
};

const VIEW_SX: SxProps<Theme> = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
  bgcolor: '#000',
  ml: '2px',
};

const COORD_BAR_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  px: 2,
  py: 0.25,
  bgcolor: tokens.surface.raised,
  fontSize: 12,
  borderTop: 1,
  borderColor: tokens.border.default,
};

const COORD_VALUE_SX: SxProps<Theme> = {
  fontFamily:
    "'Cascadia Mono', 'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace",
  fontVariantNumeric: 'tabular-nums',
  fontSize: 12,
  color: tokens.text.primary,
  letterSpacing: 0.2,
};

const CANVAS_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
  objectFit: 'contain',
  imageRendering: 'auto',
};

type ImageSize = { width: number; height: number };

function keepImageSizeIfSame(current: ImageSize | null, next: ImageSize | null): ImageSize | null {
  if (!next) return current === null ? current : null;
  return current?.width === next.width && current.height === next.height ? current : next;
}

function toOwnedArrayBuffer(body: ArrayBufferLike): ArrayBuffer {
  if (body instanceof ArrayBuffer) return body;
  const possibleView = body as unknown;
  if (ArrayBuffer.isView(possibleView)) {
    return (possibleView as Uint8Array).slice().buffer as ArrayBuffer;
  }
  return new Uint8Array(body).slice().buffer as ArrayBuffer;
}

type Props = {
  activeTool: ToolId;
  overlayShapes: OverlayShape[];
  autoMeasureGraphics: AutoMeasureGraphics | null;
  autoMeasureGraphicsSource?: 'auto' | 'preview' | 'save';
  autoMeasureClearNonce?: number;
  crossLineVisible: boolean;
  onAddShape: (shape: OverlayShapeInput) => void;
  manualMeasureResetKey: number;
  manualMeasureObjective?: string | null;
  objectiveRefreshKey?: number;
  onManualMeasurementUpdated: (result: ManualMeasureDragResult) => void;
  onAutoMeasureAdjusted?: (corners: import('@/types/autoMeasure').AutoMeasureCorners) => void;
  magnifierEnabled: boolean;
  onClearShapeKind?: (kind: OverlayShape['kind']) => void;
  lineStrokeWidth?: number;
  turretMoving?: boolean;
  turretMovingTarget?: string | null;
  cameraOpen?: boolean;
  umPerPixel?: number | null;
  onUpdateShape?: (id: string, next: OverlayShapeInput) => void;
};

export type CameraWindowHandle = {
  toggleFreeze: () => boolean;
  zoomIn: () => number;
  zoomOut: () => number;
  captureDisplayedFrame: (options?: { freeze?: boolean }) => {
    ok: true;
    buffer: ArrayBuffer;
    width: number;
    height: number;
    pixelFormat: CameraPixelFormat;
    bits: 8 | 16;
    source: 'live-camera' | 'uploaded-image';
  } | { ok: false; error: string };
  loadImageFromBuffer: (buffer: ArrayBufferLike) => Promise<{ ok: boolean; error?: string }>;
  exportImageBlob: (mimeType?: string) => Promise<Blob | null>;
  captureThumbnailDataUrl: (options?: {
    maxWidth?: number;
    mimeType?: string;
    quality?: number;
  }) => string | null;
  captureFinalizedThumbnail: (
    expectedCornersKey: string,
    options?: { maxWidth?: number; mimeType?: string; quality?: number }
  ) => Promise<string | null>;
  refetchStatus: () => Promise<void>;
  clearLiveCanvas: (reason?: string) => void;
  clearLiveImage: (reason?: string) => void;
  waitForFreshFrame: (timeoutMs?: number) => Promise<boolean>;
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;
const COORDINATE_SCALE = 1024;
const DEFAULT_CAMERA_X = 1024;
const DEFAULT_CAMERA_Y = 1024;

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
    autoMeasureGraphicsSource = 'auto',
    autoMeasureClearNonce = 0,
    crossLineVisible,
    onAddShape,
    manualMeasureResetKey,
    manualMeasureObjective,
    objectiveRefreshKey,
    onManualMeasurementUpdated,
    onAutoMeasureAdjusted,
    magnifierEnabled,
    onClearShapeKind,
    lineStrokeWidth,
    turretMoving = false,
    turretMovingTarget = null,
    cameraOpen = true,
    umPerPixel = null,
    onUpdateShape,
  }: Props,
  ref: React.Ref<CameraWindowHandle>
) {
  useRenderCount('CameraWindow');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const freezeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { attachCanvas } = useCameraStream();
  const { status, refetch: refetchStatus } = useCameraStatus();
  const [cursorCoordinate, setCursorCoordinate] = useState<Point>({
    x: DEFAULT_CAMERA_X,
    y: DEFAULT_CAMERA_Y,
  });
  const [cursorDisplay, setCursorDisplay] = useState<Point | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const imageSourceRef = useRef<'live-camera' | 'uploaded-image'>('live-camera');
  const liveCanvasClearedAtRef = useRef<number>(0);

  const toggleFreeze = useCallback(() => {
    const live = canvasRef.current;
    const snap = freezeCanvasRef.current;
    if (!live || !snap) return false;
    const full = getLatestFullFrame();
    const measurementSize =
      full && full.width > 0 && full.height > 0
        ? { width: full.width, height: full.height }
        : live.width > 0 && live.height > 0
          ? { width: live.width, height: live.height }
          : null;
    if (frozen) {
      const ctx = snap.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, snap.width, snap.height);
      imageSourceRef.current = 'live-camera';
      setFrozen(false);
      setImageSize((current) => keepImageSizeIfSame(current, measurementSize));
      return false;
    }
    if (live.width === 0 || live.height === 0) return false;
    snap.width = live.width;
    snap.height = live.height;
    const ctx = snap.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(live, 0, 0);
    imageSourceRef.current = 'live-camera';
    setImageSize((current) => keepImageSizeIfSame(current, measurementSize));
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

  const captureDisplayedFrame = useCallback<CameraWindowHandle['captureDisplayedFrame']>((options) => {
    const live = canvasRef.current;
    const snap = freezeCanvasRef.current;
    const source = frozen && snap && snap.width > 0 && snap.height > 0 ? snap : live;
    if (!source || source.width <= 0 || source.height <= 0) {
      return { ok: false, error: 'no displayed image' };
    }

    if (
      source === live &&
      liveCanvasClearedAtRef.current > 0 &&
      (getLastPaintEpoch() < getCurrentFrameEpoch() ||
        getLastCameraFramePaintAt() <= liveCanvasClearedAtRef.current)
    ) {
      return { ok: false, error: 'awaiting-fresh-frame' };
    }

    if (imageSourceRef.current === 'live-camera') {
      const full = getLatestFullFrame();
      if (full && full.body) {
        const buffer = toOwnedArrayBuffer(full.body);
        if (options?.freeze) {
          if (snap && live && live.width > 0 && live.height > 0) {
            snap.width = live.width;
            snap.height = live.height;
            const snapCtx = snap.getContext('2d');
            if (snapCtx) {
              snapCtx.drawImage(live, 0, 0);
              imageSourceRef.current = 'live-camera';
              setFrozen(true);
            }
          }
        }
        return {
          ok: true,
          buffer,
          width: full.width,
          height: full.height,
          pixelFormat: full.pixelFormat,
          bits: full.bits,
          source: 'live-camera',
        };
      }
      return { ok: false, error: 'native-full-frame-not-available' };
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

      if (options?.freeze) {
        if (source === live && snap) {
          snap.width = source.width;
          snap.height = source.height;
          const snapCtx = snap.getContext('2d');
          if (snapCtx) {
            snapCtx.putImageData(imageData, 0, 0);
            imageSourceRef.current = 'live-camera';
            setImageSize((current) =>
              keepImageSizeIfSame(current, { width: source.width, height: source.height })
            );
            setFrozen(true);
          }
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
        setImageSize((current) =>
          keepImageSizeIfSame(current, { width: bitmap.width, height: bitmap.height })
        );
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

  const captureThumbnailDataUrl = useCallback<CameraWindowHandle['captureThumbnailDataUrl']>(
    (options) => {
      const maxWidth = options?.maxWidth ?? 320;
      const mimeType = options?.mimeType ?? 'image/jpeg';
      const quality = options?.quality ?? 0.75;
      const live = canvasRef.current;
      const snap = freezeCanvasRef.current;
      const source = frozen && snap && snap.width > 0 && snap.height > 0 ? snap : live;
      if (!source || source.width <= 0 || source.height <= 0) {
        return null;
      }
      const scale = source.width > maxWidth ? maxWidth / source.width : 1;
      const w = Math.max(1, Math.round(source.width * scale));
      const h = Math.max(1, Math.round(source.height * scale));
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d');
      if (!ctx) {
        return null;
      }
      ctx.drawImage(source, 0, 0, w, h);

      const viewport = viewportRef.current;
      if (viewport && imageSize && imageSize.width > 0 && imageSize.height > 0) {
        const placement = getImagePlacement(viewport.clientWidth, viewport.clientHeight, imageSize);
        const overlayCanvases = Array.from(viewport.querySelectorAll('canvas')).filter(
          (c) => c !== live && c !== snap && c.width > 0 && c.height > 0
        );
        if (placement) {
          for (const overlay of overlayCanvases) {
            const dprX = overlay.width / Math.max(1, viewport.clientWidth);
            const dprY = overlay.height / Math.max(1, viewport.clientHeight);
            const sx = placement.offsetX * dprX;
            const sy = placement.offsetY * dprY;
            const sw = placement.width * dprX;
            const sh = placement.height * dprY;
            if (sw <= 0 || sh <= 0) continue;
            try {
              ctx.drawImage(overlay, sx, sy, sw, sh, 0, 0, w, h);
            } catch {
              continue;
            }
          }
        }
      }

      try {
        return out.toDataURL(mimeType, quality);
      } catch {
        return null;
      }
    },
    [frozen, imageSize]
  );

  const overlayDrawnKeyRef = useRef<string>('');
  const handleOverlayDrawn = useCallback((key: string) => {
    overlayDrawnKeyRef.current = key;
  }, []);

  const captureFinalizedThumbnail = useCallback(
    async (
      expectedCornersKey: string,
      options?: { maxWidth?: number; mimeType?: string; quality?: number }
    ): Promise<string | null> => {
      const deadline = Date.now() + 600;
      if (expectedCornersKey && expectedCornersKey !== 'none') {
        while (
          overlayDrawnKeyRef.current !== expectedCornersKey &&
          Date.now() < deadline
        ) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
      }
      return captureThumbnailDataUrl(options);
    },
    [captureThumbnailDataUrl]
  );

  const clearLiveCanvas = useCallback((_reason: string = 'objective-change') => {
    const live = canvasRef.current;
    if (!live) return;
    const ctx = live.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, live.width, live.height);
    liveCanvasClearedAtRef.current = Date.now();
  }, []);

  const turretMovingPrevRef = useRef(false);
  useEffect(() => {
    const prev = turretMovingPrevRef.current;
    turretMovingPrevRef.current = turretMoving;
    if (turretMoving && !prev) {
      const live = canvasRef.current;
      if (live) {
        const ctx = live.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, live.width, live.height);
      }
      const snap = freezeCanvasRef.current;
      if (snap) {
        const snapCtx = snap.getContext('2d');
        if (snapCtx) snapCtx.clearRect(0, 0, snap.width, snap.height);
      }
      imageSourceRef.current = 'live-camera';
      setFrozen(false);
      liveCanvasClearedAtRef.current = Date.now();
      bumpFrameEpochOnCanvasClear();
      return;
    }
    if (!turretMoving && prev) {
      let cancelled = false;
      void waitForFreshCameraFrame(2500).then((fresh) => {
        if (cancelled) return;
        if (fresh) {
        } else {
        }
      });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [turretMoving]);

  const clearLiveImage = useCallback((reason: string = 'camera-close') => {
    const snap = freezeCanvasRef.current;
    const snapCtx = snap?.getContext('2d');
    if (snap && snapCtx) snapCtx.clearRect(0, 0, snap.width, snap.height);
    imageSourceRef.current = 'live-camera';
    setFrozen(false);
    setImageSize(null);
    clearLiveCanvas(reason);
  }, [clearLiveCanvas]);

  const waitForFreshFrame = useCallback(async (timeoutMs = 1500) => {
    const fresh = await waitForFreshCameraFrame(timeoutMs);
    if (fresh) {
      liveCanvasClearedAtRef.current = 0;
    } else {
    }
    return fresh;
  }, []);

  const lastSeenObjectiveRefreshKeyRef = useRef<number | undefined>(objectiveRefreshKey);
  useEffect(() => {
    if (objectiveRefreshKey === undefined) return;
    if (lastSeenObjectiveRefreshKeyRef.current === objectiveRefreshKey) return;
    lastSeenObjectiveRefreshKeyRef.current = objectiveRefreshKey;

    if (frozen) {
      const snap = freezeCanvasRef.current;
      const ctx = snap?.getContext('2d');
      if (snap && ctx) ctx.clearRect(0, 0, snap.width, snap.height);
      imageSourceRef.current = 'live-camera';
      setFrozen(false);
    }
    clearLiveCanvas();
  }, [objectiveRefreshKey, clearLiveCanvas, frozen, manualMeasureObjective]);

  useImperativeHandle(
    ref,
    () => ({
      toggleFreeze,
      zoomIn,
      zoomOut,
      captureDisplayedFrame,
      loadImageFromBuffer,
      exportImageBlob,
      captureThumbnailDataUrl,
      captureFinalizedThumbnail,
      refetchStatus,
      clearLiveCanvas,
      clearLiveImage,
      waitForFreshFrame,
    }),
    [
      toggleFreeze,
      zoomIn,
      zoomOut,
      captureDisplayedFrame,
      loadImageFromBuffer,
      exportImageBlob,
      captureThumbnailDataUrl,
      captureFinalizedThumbnail,
      refetchStatus,
      clearLiveCanvas,
      clearLiveImage,
      waitForFreshFrame,
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

  useEffect(() => {
    if (canvasRef.current) attachCanvas(canvasRef.current);
  }, [attachCanvas]);

  useEffect(() => {
    if (frozen) {
      return;
    }

    if (status.width > 0 && status.height > 0) {
      setImageSize((current) =>
        keepImageSizeIfSame(current, { width: status.width, height: status.height })
      );
    }
  }, [frozen, status.height, status.width]);

  const updateCursorFromPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!viewport || !imageSize) {
        setCursorDisplay(null);
        return;
      }

      const rect = viewport.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
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
          imageSize={imageSize}
          umPerPixel={umPerPixel}
          onAddShape={onAddShape}
          onUpdateShape={onUpdateShape}
          onClearKind={onClearShapeKind}
        />
        <AutoMeasureOverlay
          graphics={autoMeasureGraphics}
          imageSize={imageSize}
          interactive={activeTool === 'pointer'}
          source={autoMeasureGraphicsSource}
          onAdjusted={onAutoMeasureAdjusted}
          strokeWidth={lineStrokeWidth}
          activeObjective={manualMeasureObjective}
          clearNonce={autoMeasureClearNonce}
          cameraOpen={cameraOpen}
          onOverlayDrawn={handleOverlayDrawn}
        />
        <ManualMeasureOverlay
          active={activeTool === 'manualMeasure'}
          imageSize={imageSize}
          resetKey={manualMeasureResetKey}
          objective={manualMeasureObjective}
          onMeasurementUpdated={onManualMeasurementUpdated}
          strokeWidth={lineStrokeWidth}
        />
        {magnifierEnabled ? (
          <MagnifierLens
            source={frozen ? freezeCanvasRef.current : canvasRef.current}
            cursor={cursorDisplay}
            containerWidth={viewportSize.w}
            containerHeight={viewportSize.h}
            imageSize={imageSize}
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
        {turretMoving ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: '#000',
              color: '#FFEB3B',
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: 1,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            {turretMovingTarget ? `Turret moving to ${turretMovingTarget}...` : 'Turret moving...'}
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
          X: {Number.isFinite(cursorCoordinate.x) ? Math.round(cursorCoordinate.x) : DEFAULT_CAMERA_X}
        </Typography>
        <Typography component="span" sx={COORD_VALUE_SX}>
          Y: {Number.isFinite(cursorCoordinate.y) ? Math.round(cursorCoordinate.y) : DEFAULT_CAMERA_Y}
        </Typography>
      </Box>
    </Box>
  );
}

export default memo(forwardRef<CameraWindowHandle, Props>(CameraWindowImpl));
