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
  /** Auto→Manual handoff: the current Auto-detected corners (as guide lines) to
   *  initialize from, so Manual Measure starts on the exact same four points as
   *  Auto. Null when no Auto result is displayed → a default diamond is used. */
  seedGuides?: ManualGuideLines | null;
  onCursor?: (point: Point | null) => void;
  onMeasurementUpdated: (result: ManualMeasureDragResult) => void;
  /** Latest guide lines (image space) — mirrored up so the magnifier lens can
   *  re-render them thin. Null while inactive / unseeded. */
  onGuidesChange?: (guides: ManualGuideLines | null) => void;
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
  seedGuides,
  onCursor,
  onMeasurementUpdated,
  onGuidesChange,
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
  // Keyboard-adjustment selection: which endpoint the arrow keys move. A single
  // click selects one (see handlePointerDown); the document-level keydown
  // listener reads selectedGuideRef. Ref-only (not state) — the selection is no
  // longer drawn (plain 4 yellow lines, like Auto), so it needs no re-render.
  const selectedGuideRef = useRef<ManualGuideLineKey | null>(null);
  const activeRef = useRef(active);
  const imageSizeRef = useRef(imageSize);
  const emitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    guidesRef.current = guides;
  }, [guides]);

  // Mirror the live guide lines to the magnifier (thin re-render). Emit null
  // whenever the tool is inactive so a stale diamond never lingers in the lens.
  useEffect(() => {
    onGuidesChange?.(active ? guides : null);
  }, [active, guides, onGuidesChange]);

  useEffect(() => {
    activeRef.current = active;
    imageSizeRef.current = imageSize;
  }, [active, imageSize]);

  const selectGuide = useCallback((key: ManualGuideLineKey | null) => {
    selectedGuideRef.current = key;
  }, []);

  // Manual Measure is a document-level, ref-gated listener (like Auto Measure) —
  // no element focus needed, so arrow keys work the instant a point is selected.
  // Deselecting when the tool deactivates keeps re-entry clean and stops arrows
  // from leaking into other tools.
  useEffect(() => {
    if (!active) {
      selectGuide(null);
    }
  }, [active, selectGuide]);

  useEffect(() => {
    setGuides(null);
    guidesRef.current = null;
    setHoverGuide(null);
    setDragGuide(null);
    dragGuideRef.current = null;
    dragMovedRef.current = false;
    selectedGuideRef.current = null;
    // First-click diagnostics: a resetKey bump nulls the guides. If this fires
    // AFTER activation (async objective-sync / turret gate), it opens a window
    // where the overlay is interactive but hitTest has no guides → the first
    // pointerdown is dropped. See useObjectiveSync/useTurretMotionGate.
    mlog('manual-guides', { event: 'reset', resetKey });
  }, [resetKey]);

  useEffect(() => {
    if (!active || !imageSize || guidesRef.current) {
      return;
    }

    // Auto→Manual handoff: adopt the exact Auto-detected corners when present so
    // Manual Measure starts on the same four points — unmoved, it feeds the same
    // d1Px/d2Px into the shared pipeline and yields the identical HV. Only when
    // no Auto result exists does Manual fall back to a centered default diamond.
    const initialGuides =
      seedGuides != null
        ? normalizeGuides(seedGuides, imageSize)
        : createDefaultManualGuideLines(imageSize, objective);
    guidesRef.current = initialGuides;
    setGuides(initialGuides);
    mlog('manual-guides', {
      event: 'seed',
      source: seedGuides != null ? 'auto-handoff' : 'default',
    });
    // resetKey MUST be a dependency: a reset nulls the guides (effect above), and
    // without re-running here the diamond stays gone until an unrelated dep
    // (objective/seedGuides) happens to change — leaving a window where the
    // overlay is interactive but hitTest has no guides, so the first pointerdown
    // is silently dropped ("click twice to drag"). Re-seeding on resetKey closes
    // that window immediately. Guarded by !active so intentional clear-and-blank
    // resets (which drop to the pointer tool) do not re-seed.
  }, [active, imageSize, objective, seedGuides, resetKey]);

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
        // Plain 4 yellow lines: no endpoint handles, and no white "selected"
        // tint — every guide renders the same yellow (selectedGuide omitted).
        // Keyboard selection still works internally; it just isn't drawn.
        selectedGuide: null,
        imageSize,
        wrap,
        strokeWidth,
        endpointHandles: false,
        // Crisp device-pixel-aligned hairlines when idle; render the raw
        // sub-pixel position DURING a drag so movement stays perfectly smooth.
        // Measurement is unaffected either way (it uses image coordinates).
        snapToDevicePixels: dragGuide === null,
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

  // Keyboard nudges recompute HV through the SAME emit path a drag uses, but a
  // held/rapid arrow burst shouldn't fire one async DB save per keystroke — the
  // overlay/diagonal render instantly (setGuides below), while the table save is
  // debounced to the last position on settle. Mirrors Auto's handleAutoMeasureAdjusted.
  const scheduleEmit = useCallback(() => {
    if (emitTimerRef.current !== null) {
      window.clearTimeout(emitTimerRef.current);
    }
    emitTimerRef.current = window.setTimeout(() => {
      emitTimerRef.current = null;
      emitMeasurement();
    }, 120);
  }, [emitMeasurement]);

  useEffect(
    () => () => {
      if (emitTimerRef.current !== null) {
        window.clearTimeout(emitTimerRef.current);
        emitTimerRef.current = null;
      }
    },
    []
  );

  // Move the selected endpoint by a sub-pixel-capable delta. Left/right tips
  // live on the horizontal diagonal (X only); top/bottom on the vertical (Y
  // only) — so orthogonal arrows are no-ops for that tip. Floating-point coords
  // preserve sub-pixel (Ctrl 0.25px / Alt 0.5px) fine adjustment.
  const nudgeSelected = useCallback(
    (key: ManualGuideLineKey, dx: number, dy: number) => {
      const size = imageSizeRef.current;
      const current = guidesRef.current;
      if (!size || !current) {
        return;
      }

      let imagePoint: Point;
      if (key === 'left') {
        if (dx === 0) return;
        imagePoint = { x: current.leftX + dx, y: 0 };
      } else if (key === 'right') {
        if (dx === 0) return;
        imagePoint = { x: current.rightX + dx, y: 0 };
      } else if (key === 'top') {
        if (dy === 0) return;
        imagePoint = { x: 0, y: current.topY + dy };
      } else {
        if (dy === 0) return;
        imagePoint = { x: 0, y: current.bottomY + dy };
      }

      const next = updateGuide(current, key, imagePoint, size);
      guidesRef.current = next;
      setGuides(next);

      // Center the magnifier (if enabled) on the endpoint being moved.
      const centerX = (next.leftX + next.rightX) / 2;
      const centerY = (next.topY + next.bottomY) / 2;
      const tip: Point =
        key === 'left'
          ? { x: next.leftX, y: centerY }
          : key === 'right'
            ? { x: next.rightX, y: centerY }
            : key === 'top'
              ? { x: centerX, y: next.topY }
              : { x: centerX, y: next.bottomY };
      onCursor?.(tip);

      scheduleEmit();
    },
    [onCursor, scheduleEmit]
  );

  useEffect(() => {
    const ARROWS = new Set([
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
    ]);

    const handleKeyDown = (event: KeyboardEvent) => {
      // Constraint: only act while Manual Measure is active AND an endpoint is
      // selected — otherwise arrows must fall through to whatever else is focused
      // (live view, other tools) untouched.
      if (!activeRef.current) return;
      const selected = selectedGuideRef.current;
      if (selected === null) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.key === 'Escape') {
        selectGuide(null);
        event.preventDefault();
        return;
      }

      if (!ARROWS.has(event.key)) return;

      // Block the page/scroll default for arrows while adjusting.
      event.preventDefault();

      const step = event.shiftKey
        ? 10
        : event.ctrlKey || event.metaKey
          ? 0.25
          : event.altKey
            ? 0.5
            : 1;

      let dx = 0;
      let dy = 0;
      if (event.key === 'ArrowLeft') dx = -step;
      else if (event.key === 'ArrowRight') dx = step;
      else if (event.key === 'ArrowUp') dy = -step;
      else if (event.key === 'ArrowDown') dy = step;

      nudgeSelected(selected, dx, dy);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nudgeSelected, selectGuide]);

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
        mlog('manual-pointerdown', {
          result: 'guard-fail',
          active,
          imageSize: imageSize ? 'set' : 'null',
          button: event.button,
        });
        return;
      }

      const nextDragGuide = hitTest(event);
      if (nextDragGuide === null) {
        // Either the click was >10px from every guide line, OR the guides were
        // momentarily null (post-activation resetKey churn) so there was nothing
        // to hit. `guides` distinguishes the two — the crux of the "first click
        // ignored" report.
        mlog('manual-pointerdown', {
          result: 'no-hit',
          guides: guidesRef.current ? 'present' : 'null',
        });
        return;
      }

      mlog('manual-pointerdown', { result: 'drag-start', guide: nextDragGuide });

      // A single click selects this endpoint for keyboard adjustment; a drag
      // (down→move→up) also moves it. Either way the clicked endpoint is now the
      // one the arrow keys control.
      selectGuide(nextDragGuide);
      event.currentTarget.setPointerCapture(event.pointerId);
      dragGuideRef.current = nextDragGuide;
      dragMovedRef.current = false;
      setDragGuide(nextDragGuide);
      event.preventDefault();
    },
    [active, hitTest, imageSize, selectGuide]
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
