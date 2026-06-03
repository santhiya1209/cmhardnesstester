import { useCallback, useEffect, useRef } from 'react';
import type { AutoMeasureCorners, AutoMeasureGraphics } from '@/types/autoMeasure';
import type { CalibrationMeasureMode } from '@/features/manualMeasure/useCalibrationManualMeasure';
import type { ManualGuideLineKey } from '@/types/manualMeasure';

const LINE_ORDER: ManualGuideLineKey[] = ['top', 'right', 'bottom', 'left'];

function cloneCorners(c: AutoMeasureCorners): AutoMeasureCorners {
  return {
    top: { ...c.top },
    right: { ...c.right },
    bottom: { ...c.bottom },
    left: { ...c.left },
  };
}

function applyLineDelta(
  line: ManualGuideLineKey,
  dx: number,
  dy: number,
  corners: AutoMeasureCorners
): AutoMeasureCorners {
  const next = cloneCorners(corners);
  // Each guide line owns exactly one axis: vertical lines own x, horizontal
  // lines own y. Moving the opposite axis has no effect on D1/D2.
  if (line === 'left') next.left.x = Math.max(0, corners.left.x + dx);
  else if (line === 'right') next.right.x = Math.max(0, corners.right.x + dx);
  else if (line === 'top') next.top.y = Math.max(0, corners.top.y + dy);
  else if (line === 'bottom') next.bottom.y = Math.max(0, corners.bottom.y + dy);
  return next;
}

type Args = {
  // Shared selection state owned by App.tsx so mouse click and keyboard Tab
  // both update the same highlighted line.
  selectedLine: ManualGuideLineKey | null;
  setSelectedLine: (line: ManualGuideLineKey | null) => void;
  committedAutoMeasureOverlay: AutoMeasureGraphics | null;
  setCommittedAutoMeasureOverlay: React.Dispatch<React.SetStateAction<AutoMeasureGraphics | null>>;
  onAdjusted: (corners: AutoMeasureCorners) => void;
  // Gate: false when a dialog is open, camera is closed, or tool is not pointer.
  isActive: boolean;
  // When provided and === 'auto', the overlay is the Calibration panel's
  // detected lines: emit calibration telemetry alongside the normal logs. The
  // movement engine itself is unchanged — calibration reuses it as-is.
  calibrationMeasureModeRef?: React.MutableRefObject<CalibrationMeasureMode>;
};

// Keyboard-based fine adjustment of the committed Auto Measure overlay.
// Arrow keys move the selected guide line 1/5/10 image pixels (plain/Shift/Ctrl).
// Tab/Shift+Tab cycle through lines. Enter confirms. Esc restores the original.
// Selection state is shared with mouse-click selection via setSelectedLine so
// both input methods control the same highlighted line.
export function useAutoMeasureKeyboardAdjust({
  selectedLine,
  setSelectedLine,
  committedAutoMeasureOverlay,
  setCommittedAutoMeasureOverlay,
  onAdjusted,
  isActive,
  calibrationMeasureModeRef,
}: Args): void {
  // Live refs — updated synchronously in render so the stable event listener
  // always reads the current value without being recreated on state changes.
  const selectedLineRef = useRef<ManualGuideLineKey | null>(selectedLine);
  selectedLineRef.current = selectedLine;

  const committedOverlayRef = useRef<AutoMeasureGraphics | null>(committedAutoMeasureOverlay);
  committedOverlayRef.current = committedAutoMeasureOverlay;

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const onAdjustedRef = useRef(onAdjusted);
  onAdjustedRef.current = onAdjusted;

  // Snapshot of corners at detection time — restored on Esc.
  // Saved when the overlay first appears (null → non-null), NOT when Tab is
  // pressed, so Esc works even if the user started adjusting with the mouse.
  const originalCornersRef = useRef<AutoMeasureCorners | null>(null);
  const prevOverlayRef = useRef<AutoMeasureGraphics | null>(null);

  useEffect(() => {
    const prev = prevOverlayRef.current;
    prevOverlayRef.current = committedAutoMeasureOverlay;

    if (committedAutoMeasureOverlay && !prev) {
      // New detection result — save original for Esc restore.
      originalCornersRef.current = cloneCorners(committedAutoMeasureOverlay.corners);
      // eslint-disable-next-line no-console
      console.log('[auto-measure-edit] initialized editable=true');
    }

    if (!committedAutoMeasureOverlay) {
      // Overlay cleared (objective change, new session, etc.) — reset edit state.
      originalCornersRef.current = null;
      setSelectedLine(null);
    }
  }, [committedAutoMeasureOverlay, setSelectedLine]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isActiveRef.current) return;
      if (!committedOverlayRef.current) return;

      // Never intercept while the user is typing in a form field.
      const tag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase() ?? '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      const { key, shiftKey, ctrlKey } = event;

      // ── Tab / Shift+Tab: cycle through lines ──────────────────────────────
      if (key === 'Tab') {
        event.preventDefault();
        const current = selectedLineRef.current;
        let next: ManualGuideLineKey;
        if (current === null) {
          next = shiftKey ? LINE_ORDER[LINE_ORDER.length - 1] : LINE_ORDER[0];
        } else {
          const idx = LINE_ORDER.indexOf(current);
          const nextIdx = shiftKey
            ? (idx - 1 + LINE_ORDER.length) % LINE_ORDER.length
            : (idx + 1) % LINE_ORDER.length;
          next = LINE_ORDER[nextIdx];
        }
        // eslint-disable-next-line no-console
        console.log(`[auto-measure-edit] selected=${next}-line source=keyboard`);
        if (calibrationMeasureModeRef?.current === 'auto') {
          // eslint-disable-next-line no-console
          console.log(`[calibration-line-select] line=${next}`);
        }
        setSelectedLine(next);
        return;
      }

      // All remaining keys require an active selection.
      const line = selectedLineRef.current;
      if (!line) return;

      // ── Arrow keys: move selected line ────────────────────────────────────
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();
        const step = ctrlKey ? 10 : shiftKey ? 5 : 1;
        let dx = 0;
        let dy = 0;
        if (key === 'ArrowUp') dy = -step;
        else if (key === 'ArrowDown') dy = step;
        else if (key === 'ArrowLeft') dx = -step;
        else if (key === 'ArrowRight') dx = step;

        // eslint-disable-next-line no-console
        console.log(`[auto-measure-key] key=${key} element=${line}-line deltaX=${dx} deltaY=${dy}`);

        const overlay = committedOverlayRef.current;
        if (!overlay) return;

        const next = applyLineDelta(line, dx, dy, overlay.corners);

        // Log updated diagonal measurements in image pixels.
        const d1Px = next.right.x - next.left.x;
        const d2Px = next.bottom.y - next.top.y;
        const davgPx = (d1Px + d2Px) / 2;
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-recalculate] D1=${d1Px.toFixed(1)}px D2=${d2Px.toFixed(1)}px Davg=${davgPx.toFixed(1)}px HV=pending(debounce)`
        );

        if (calibrationMeasureModeRef?.current === 'auto') {
          // eslint-disable-next-line no-console
          console.log(
            `[calibration-line-keyboard] line=${line} key=${key} step=${step} pixelX=${Math.abs(d1Px).toFixed(2)} pixelY=${Math.abs(d2Px).toFixed(2)}`
          );
        }

        setCommittedAutoMeasureOverlay({ ...overlay, corners: next });
        onAdjustedRef.current(next);
        return;
      }

      // ── Enter: confirm current position ───────────────────────────────────
      if (key === 'Enter') {
        event.preventDefault();
        const overlay = committedOverlayRef.current;
        if (overlay) {
          onAdjustedRef.current(overlay.corners);
        }
        // eslint-disable-next-line no-console
        console.log('[auto-measure-confirm] source=keyboard');
        setSelectedLine(null);
        return;
      }

      // ── Esc: restore original auto-measure result ─────────────────────────
      if (key === 'Escape') {
        event.preventDefault();
        const original = originalCornersRef.current;
        const overlay = committedOverlayRef.current;
        if (original && overlay) {
          setCommittedAutoMeasureOverlay({ ...overlay, corners: original });
          onAdjustedRef.current(original);
        }
        // eslint-disable-next-line no-console
        console.log('[auto-measure-cancel] restored=originalDetectedGeometry');
        setSelectedLine(null);
        return;
      }
    },
    [calibrationMeasureModeRef, setCommittedAutoMeasureOverlay, setSelectedLine]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
