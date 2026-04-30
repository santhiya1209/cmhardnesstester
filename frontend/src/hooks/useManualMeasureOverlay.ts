import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ManualMeasureDragResult,
  ManualMeasurePoints,
} from '@/types/manualMeasure';
import type { Point } from '@/types/tool';
import {
  createDefaultManualMeasurePoints,
  distancePx,
} from '@/utils/manualMeasure';
import {
  drawManualMeasureOverlay,
  hitTestManualMarker,
  pointerToImagePoint,
  type ManualMeasureImageSize,
} from '@/utils/manualMeasureOverlayCanvas';

type Args = {
  active: boolean;
  imageSize: ManualMeasureImageSize | null;
  resetKey: number;
  onCursor?: (point: Point | null) => void;
  onMeasurementUpdated: (result: ManualMeasureDragResult) => void;
};

export function useManualMeasureOverlay({
  active,
  imageSize,
  resetKey,
  onCursor,
  onMeasurementUpdated,
}: Args) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const markersRef = useRef<ManualMeasurePoints | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const [markers, setMarkers] = useState<ManualMeasurePoints | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  useEffect(() => {
    setMarkers(null);
    markersRef.current = null;
    setHoverIndex(null);
    setDragIndex(null);
    dragIndexRef.current = null;
    dragMovedRef.current = false;
  }, [resetKey]);

  useEffect(() => {
    if (!active || !imageSize || markersRef.current) {
      return;
    }

    const initialMarkers = createDefaultManualMeasurePoints(imageSize);
    markersRef.current = initialMarkers;
    setMarkers(initialMarkers);
  }, [active, imageSize]);

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
        dragIndex,
        hoverIndex,
        imageSize,
        markers: markersRef.current,
        wrap,
      });
    });
  }, [active, dragIndex, hoverIndex, imageSize]);

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
  }, [markers, scheduleDraw]);

  const emitMeasurement = useCallback(() => {
    const current = markersRef.current;
    if (!current) {
      return;
    }

    const d1Px = distancePx(current[0], current[2]);
    const d2Px = distancePx(current[1], current[3]);
    // eslint-disable-next-line no-console
    console.log('[manual-measure] markers updated', { points: current });
    onMeasurementUpdated({ points: current, d1Px, d2Px });
  }, [onMeasurementUpdated]);

  const hitTest = useCallback(
    (event: React.PointerEvent): number | null => {
      const wrap = wrapRef.current;
      const current = markersRef.current;
      if (!wrap || !imageSize || !current) {
        return null;
      }

      return hitTestManualMarker(event, wrap, imageSize, current);
    },
    [imageSize]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!active || !imageSize || event.button !== 0) {
        return;
      }

      const nextDragIndex = hitTest(event);
      if (nextDragIndex === null) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      dragIndexRef.current = nextDragIndex;
      dragMovedRef.current = false;
      setDragIndex(nextDragIndex);
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
      setHoverIndex(hitTest(event));

      const currentDragIndex = dragIndexRef.current;
      if (currentDragIndex === null) {
        return;
      }

      setMarkers((current) => {
        if (!current) {
          return current;
        }

        const currentPoint = current[currentDragIndex];
        if (distancePx(currentPoint, imagePoint) < 0.5) {
          return current;
        }

        dragMovedRef.current = true;
        const next = current.map((point, index) =>
          index === currentDragIndex ? imagePoint : point
        ) as ManualMeasurePoints;
        markersRef.current = next;
        return next;
      });
    },
    [active, hitTest, imageSize, onCursor]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragIndexRef.current !== null) {
        dragIndexRef.current = null;
        setDragIndex(null);
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
    if (dragIndexRef.current === null) {
      setHoverIndex(null);
      onCursor?.(null);
    }
  }, [onCursor]);

  return {
    canvasRef,
    cursor: dragIndex !== null ? 'grabbing' : hoverIndex !== null ? 'grab' : 'crosshair',
    handlePointerDown,
    handlePointerLeave,
    handlePointerMove,
    handlePointerUp,
    wrapRef,
  };
}
