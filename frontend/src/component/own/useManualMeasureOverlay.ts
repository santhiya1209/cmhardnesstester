import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ManualGuideLineKey,
  ManualGuideLines,
  ManualMeasureDragResult,
} from '@/types/manualMeasure';
import type { Point } from '@/types/tool';
import {
  createDefaultManualGuideLines,
  distancePx,
  guideLinesToPoints,
} from '@/utils/manualMeasure';
import {
  drawManualMeasureOverlay,
  hitTestManualGuideLine,
  pointerToImagePoint,
  type ManualMeasureImageSize,
} from '@/utils/manualMeasureOverlayCanvas';
import { mlog } from '@/utils/measureDebug';

type Args = {
  active: boolean;
  imageSize: ManualMeasureImageSize | null;
  resetKey: number;
  /** Live machine objective (e.g. "10X" / "40X") so the initial diamond
   *  defaults to roughly indent-sized at the current magnification. */
  objective?: string | null;
  onCursor?: (point: Point | null) => void;
  onMeasurementUpdated: (result: ManualMeasureDragResult) => void;
  strokeWidth?: number;
};

function normalizeGuides(
  guides: ManualGuideLines,
  imageSize: ManualMeasureImageSize
): ManualGuideLines {
  const leftX = Math.max(0, Math.min(imageSize.width, guides.leftX));
  const rightX = Math.max(0, Math.min(imageSize.width, guides.rightX));
  const topY = Math.max(0, Math.min(imageSize.height, guides.topY));
  const bottomY = Math.max(0, Math.min(imageSize.height, guides.bottomY));

  return {
    leftX: Math.min(leftX, rightX),
    rightX: Math.max(leftX, rightX),
    topY: Math.min(topY, bottomY),
    bottomY: Math.max(topY, bottomY),
  };
}

function updateGuide(
  guides: ManualGuideLines,
  key: ManualGuideLineKey,
  imagePoint: Point,
  imageSize: ManualMeasureImageSize
): ManualGuideLines {
  const next = { ...guides };

  if (key === 'left') next.leftX = imagePoint.x;
  if (key === 'right') next.rightX = imagePoint.x;
  if (key === 'top') next.topY = imagePoint.y;
  if (key === 'bottom') next.bottomY = imagePoint.y;

  return normalizeGuides(next, imageSize);
}

export function useManualMeasureOverlay({
  active,
  imageSize,
  resetKey,
  objective,
  onCursor,
  onMeasurementUpdated,
  strokeWidth,
}: Args) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const guidesRef = useRef<ManualGuideLines | null>(null);
  const dragGuideRef = useRef<ManualGuideLineKey | null>(null);
  const dragMovedRef = useRef(false);
  const [guides, setGuides] = useState<ManualGuideLines | null>(null);
  const [hoverGuide, setHoverGuide] = useState<ManualGuideLineKey | null>(null);
  const [dragGuide, setDragGuide] = useState<ManualGuideLineKey | null>(null);

  useEffect(() => {
    guidesRef.current = guides;
  }, [guides]);

  useEffect(() => {
    setGuides(null);
    guidesRef.current = null;
    setHoverGuide(null);
    setDragGuide(null);
    dragGuideRef.current = null;
    dragMovedRef.current = false;
  }, [resetKey]);

  useEffect(() => {
    if (!active || !imageSize || guidesRef.current) {
      return;
    }

    const initialGuides = createDefaultManualGuideLines(imageSize, objective);
    guidesRef.current = initialGuides;
    setGuides(initialGuides);
  }, [active, imageSize, objective]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) {
        return;
      }

      drawManualMeasureOverlay({
        active,
        canvas,
        dragGuide,
        guides: guidesRef.current,
        hoverGuide,
        imageSize,
        wrap,
        strokeWidth,
      });
    });
  }, [active, dragGuide, hoverGuide, imageSize, strokeWidth]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }

    scheduleDraw();
    const resizeObserver = new ResizeObserver(scheduleDraw);
    resizeObserver.observe(wrap);

    return () => {
      resizeObserver.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [scheduleDraw]);

  useEffect(() => {
    scheduleDraw();
  }, [guides, scheduleDraw]);

  const emitMeasurement = useCallback(() => {
    const current = guidesRef.current;
    if (!current) {
      return;
    }

    const points = guideLinesToPoints(current);
    const d1Px = distancePx(points[1], points[3]);
    const d2Px = distancePx(points[0], points[2]);
    mlog('manual-measure', {
      d1Px,
      d2Px,
      imageW: imageSize?.width ?? -1,
      imageH: imageSize?.height ?? -1,
      guides: `L${Math.round(current.leftX)} R${Math.round(current.rightX)} T${Math.round(current.topY)} B${Math.round(current.bottomY)}`,
    });
    onMeasurementUpdated({ points, d1Px, d2Px });
  }, [imageSize, onMeasurementUpdated]);

  const hitTest = useCallback(
    (event: React.PointerEvent): ManualGuideLineKey | null => {
      const wrap = wrapRef.current;
      const current = guidesRef.current;
      if (!wrap || !imageSize || !current) {
        return null;
      }

      return hitTestManualGuideLine(event, wrap, imageSize, current);
    },
    [imageSize]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!active || !imageSize || event.button !== 0) {
        return;
      }

      const nextDragGuide = hitTest(event);
      if (nextDragGuide === null) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      dragGuideRef.current = nextDragGuide;
      dragMovedRef.current = false;
      setDragGuide(nextDragGuide);
      event.preventDefault();
    },
    [active, hitTest, imageSize]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current;
      if (!active || !imageSize || !wrap) {
        return;
      }

      const imagePoint = pointerToImagePoint(event, wrap, imageSize);
      if (!imagePoint) {
        return;
      }

      onCursor?.(imagePoint);
      setHoverGuide(hitTest(event));

      const currentDragGuide = dragGuideRef.current;
      if (currentDragGuide === null) {
        return;
      }

      setGuides((current) => {
        if (!current) {
          return current;
        }

        const next = updateGuide(current, currentDragGuide, imagePoint, imageSize);
        if (
          Math.abs(next.leftX - current.leftX) < 0.5 &&
          Math.abs(next.rightX - current.rightX) < 0.5 &&
          Math.abs(next.topY - current.topY) < 0.5 &&
          Math.abs(next.bottomY - current.bottomY) < 0.5
        ) {
          return current;
        }

        dragMovedRef.current = true;
        guidesRef.current = next;
        return next;
      });
    },
    [active, hitTest, imageSize, onCursor]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragGuideRef.current !== null) {
        dragGuideRef.current = null;
        setDragGuide(null);
        if (dragMovedRef.current) {
          emitMeasurement();
        }
        dragMovedRef.current = false;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [emitMeasurement]
  );

  const handlePointerLeave = useCallback(() => {
    if (dragGuideRef.current === null) {
      setHoverGuide(null);
      onCursor?.(null);
    }
  }, [onCursor]);

  return {
    canvasRef,
    cursor: dragGuide !== null ? 'grabbing' : hoverGuide !== null ? 'grab' : 'crosshair',
    handlePointerDown,
    handlePointerLeave,
    handlePointerMove,
    handlePointerUp,
    wrapRef,
  };
}
