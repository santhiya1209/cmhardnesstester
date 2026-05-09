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
  useCameraStream,
  waitForFreshCameraFrame,
} from '@/hooks/useCameraStream';
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

type ImageSize = { width: number; height: number };

function keepImageSizeIfSame(current: ImageSize | null, next: ImageSize | null): ImageSize | null {
  if (!next) return current === null ? current : null;
  return current?.width === next.width && current.height === next.height ? current : next;
}

type Props = {
  activeTool: ToolId;
  overlayShapes: OverlayShape[];
  autoMeasureGraphics: AutoMeasureGraphics | null;
  autoMeasureGraphicsSource?: 'auto' | 'preview' | 'save';
  crossLineVisible: boolean;
  onAddShape: (shape: OverlayShapeInput) => void;
  manualMeasureResetKey: number;
  manualMeasureObjective?: string | null;
  /**
   * Bumps every time the machine confirms a new objective via L<n>OK RX.
   * CameraWindow uses it to clear the live canvas + frozen snapshot so the
   * next worker frame draws fresh at the new magnification — no stale pixels
   * from the previous lens, no cached transform.
   */
  objectiveRefreshKey?: number;
  onManualMeasurementUpdated: (result: ManualMeasureDragResult) => void;
  onAutoMeasureAdjusted?: (corners: import('@/types/autoMeasure').AutoMeasureCorners) => void;
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
    pixelFormat: 'rgb32';
    bits: 8;
    source: 'live-camera' | 'uploaded-image';
  } | { ok: false; error: string };
  loadImageFromBuffer: (buffer: ArrayBufferLike) => Promise<{ ok: boolean; error?: string }>;
  exportImageBlob: (mimeType?: string) => Promise<Blob | null>;
  captureThumbnailDataUrl: (options?: {
    maxWidth?: number;
    mimeType?: string;
    quality?: number;
  }) => string | null;
  refetchStatus: () => Promise<void>;
  clearLiveCanvas: () => void;
  clearLiveImage: () => void;
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
    crossLineVisible,
    onAddShape,
    manualMeasureResetKey,
    manualMeasureObjective,
    objectiveRefreshKey,
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
  // Industrial-software behavior: coordinate readout is always visible. Init
  // to (1024, 1024) on startup, updates live while the cursor is over the
  // image, and stays at the last valid value when the cursor leaves.
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
  // Set whenever the live canvas is cleared (objective change). If the next
  // worker frame hasn't arrived yet, captureDisplayedFrame would otherwise
  // hand the native addon a transparent/black image and detection silently
  // fails — gate the capture on a fresh frame after this timestamp.
  const liveCanvasClearedAtRef = useRef<number>(0);

  const toggleFreeze = useCallback(() => {
    const live = canvasRef.current;
    const snap = freezeCanvasRef.current;
    if (!live || !snap) return false;
    if (frozen) {
      const ctx = snap.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, snap.width, snap.height);
      imageSourceRef.current = 'live-camera';
      setFrozen(false);
      setImageSize((current) =>
        keepImageSizeIfSame(
          current,
          live.width > 0 && live.height > 0
            ? { width: live.width, height: live.height }
            : null
        )
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
    setImageSize((current) =>
      keepImageSizeIfSame(current, { width: live.width, height: live.height })
    );
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

    // Live source: if the canvas was cleared by an objective change and no
    // worker frame has actually PAINTED onto it since (epoch-tagged round
    // trip through the worker), the pixels are still transparent or carry
    // pre-clear stale content. Refuse to capture so callers can await a
    // fresh post-clear frame instead of shipping a stale image to the
    // native detector. Note: paint-time, not IPC-arrival time — the IPC
    // body is forwarded to the worker before any pixels land on the canvas.
    if (
      source === live &&
      liveCanvasClearedAtRef.current > 0 &&
      (getLastPaintEpoch() < getCurrentFrameEpoch() ||
        getLastCameraFramePaintAt() <= liveCanvasClearedAtRef.current)
    ) {
      // eslint-disable-next-line no-console
      console.log(
        `[camera-frame-guard] reason=awaiting-fresh-frame currentEpoch=${getCurrentFrameEpoch()} lastPaintEpoch=${getLastPaintEpoch()} lastPaintAt=${getLastCameraFramePaintAt()} clearedAt=${liveCanvasClearedAtRef.current}`
      );
      return { ok: false, error: 'awaiting-fresh-frame' };
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
        // eslint-disable-next-line no-console
        console.log('[opencv-auto] frame captured');
      }

      // eslint-disable-next-line no-console
      console.log('[frame] captured timestamp=', Date.now(), 'source=', sourceType, 'size=', source.width, 'x', source.height);

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

  const captureThumbnailDataUrl = useCallback<CameraWindowHandle['captureThumbnailDataUrl']>(
    (options) => {
      const maxWidth = options?.maxWidth ?? 320;
      const mimeType = options?.mimeType ?? 'image/jpeg';
      const quality = options?.quality ?? 0.75;
      const live = canvasRef.current;
      const snap = freezeCanvasRef.current;
      const source = frozen && snap && snap.width > 0 && snap.height > 0 ? snap : live;
      if (!source || source.width <= 0 || source.height <= 0) {
        // eslint-disable-next-line no-console
        console.warn('[album] snapshot capture skipped — no source frame', {
          source: source ? 'live-or-snap' : 'null',
          width: source?.width ?? 0,
          height: source?.height ?? 0,
        });
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
        // eslint-disable-next-line no-console
        console.warn('[album] snapshot capture failed — no 2d context');
        return null;
      }
      ctx.drawImage(source, 0, 0, w, h);

      // Compose overlay canvases (yellow Auto/Manual Measure lines, markers,
      // ImageOverlay shapes) on top of the camera frame so the album thumbnail
      // matches what the user sees in the live viewport.
      const viewport = viewportRef.current;
      let overlayCount = 0;
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
              overlayCount += 1;
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('[album] overlay compose failed', err);
            }
          }
        }
      }

      try {
        const dataUrl = out.toDataURL(mimeType, quality);
        // eslint-disable-next-line no-console
        console.log(
          '[album] snapshot captured width=', w,
          'height=', h,
          'overlays=', overlayCount,
          'bytes=', dataUrl.length
        );
        return dataUrl;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[album] snapshot toDataURL failed', err);
        return null;
      }
    },
    [frozen, imageSize]
  );

  const clearLiveCanvas = useCallback(() => {
    const live = canvasRef.current;
    if (!live) return;
    const ctx = live.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, live.width, live.height);
    liveCanvasClearedAtRef.current = Date.now();
    // Bump epoch so any frame already in the worker queue (decoded but not
    // yet painted on the main thread) is dropped on arrival instead of
    // repainting stale previous-objective pixels onto the cleared canvas.
    const newEpoch = bumpFrameEpochOnCanvasClear();
    // eslint-disable-next-line no-console
    console.log(
      `[camera-frame-clear] reason=objective-change clearedAt=${liveCanvasClearedAtRef.current} newEpoch=${newEpoch}`
    );
    // Why: do NOT null imageSize here. The camera resolution is unchanged on
    // objective change — the magnification is optical, not pixel. Nulling
    // imageSize unmounts/blanks the AutoMeasureOverlay and the next overlay
    // commit fails to render until status polls a width/height change (which
    // never happens because the camera frame size is constant).
  }, []);

  // Used by Close Camera: also drop any frozen snapshot and exit the frozen
  // state so the user actually sees an empty viewport. clearLiveCanvas alone
  // leaves a stale freeze-canvas overlay visible if the camera was frozen
  // (e.g. via Auto Measure) at the moment of close.
  const clearLiveImage = useCallback(() => {
    const snap = freezeCanvasRef.current;
    const snapCtx = snap?.getContext('2d');
    if (snap && snapCtx) snapCtx.clearRect(0, 0, snap.width, snap.height);
    imageSourceRef.current = 'live-camera';
    setFrozen(false);
    clearLiveCanvas();
  }, [clearLiveCanvas]);

  const waitForFreshFrame = useCallback(async (timeoutMs = 1500) => {
    const fresh = await waitForFreshCameraFrame(timeoutMs);
    if (fresh) {
      liveCanvasClearedAtRef.current = 0;
      // eslint-disable-next-line no-console
      console.log(
        `[camera-frame-fresh] paintEpoch=${getLastPaintEpoch()} currentEpoch=${getCurrentFrameEpoch()} paintAt=${getLastCameraFramePaintAt()}`
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `[camera-watchdog] no-frame timeoutMs=${timeoutMs} currentEpoch=${getCurrentFrameEpoch()} lastPaintEpoch=${getLastPaintEpoch()}`
      );
    }
    return fresh;
  }, []);

  // React to a machine-confirmed objective change by invalidating any cached
  // viewport state so the next live frame is drawn fresh at the new mag.
  // Skip the first render (initial value) so we don't clear on mount.
  const lastSeenObjectiveRefreshKeyRef = useRef<number | undefined>(objectiveRefreshKey);
  useEffect(() => {
    if (objectiveRefreshKey === undefined) return;
    if (lastSeenObjectiveRefreshKeyRef.current === objectiveRefreshKey) return;
    lastSeenObjectiveRefreshKeyRef.current = objectiveRefreshKey;

    // eslint-disable-next-line no-console
    console.log(
      `[camera-objective-sync] objective=${manualMeasureObjective ?? 'unknown'}`
    );
    // eslint-disable-next-line no-console
    console.log('[camera-refresh] reason=objective-change');

    // Drop any frozen snapshot — it was captured under the previous objective.
    if (frozen) {
      const snap = freezeCanvasRef.current;
      const ctx = snap?.getContext('2d');
      if (snap && ctx) ctx.clearRect(0, 0, snap.width, snap.height);
      imageSourceRef.current = 'live-camera';
      setFrozen(false);
    }
    // Clear the live canvas so the next worker frame paints onto a clean
    // surface — no stale pixels from the previous magnification.
    clearLiveCanvas();

    // eslint-disable-next-line no-console
    console.log(
      `[viewport-refresh] completed objective=${manualMeasureObjective ?? 'unknown'}`
    );
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

  // Attach the canvas to the worker exactly once when the element mounts.
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
        // Hide the magnifier marker but keep the last coordinate readout
        // — industrial UI never blanks the X/Y display.
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
    // Only hide the magnifier marker. Last valid X/Y stays on the coord bar.
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
          source={autoMeasureGraphicsSource}
          onAdjusted={onAutoMeasureAdjusted}
        />
        <ManualMeasureOverlay
          active={activeTool === 'manualMeasure'}
          imageSize={imageSize}
          resetKey={manualMeasureResetKey}
          objective={manualMeasureObjective}
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
