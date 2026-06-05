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
  if (line === 'left') next.left.x = Math.max(0, corners.left.x + dx);
  else if (line === 'right') next.right.x = Math.max(0, corners.right.x + dx);
  else if (line === 'top') next.top.y = Math.max(0, corners.top.y + dy);
  else if (line === 'bottom') next.bottom.y = Math.max(0, corners.bottom.y + dy);
  return next;
}

type Args = {
  selectedLine: ManualGuideLineKey | null;
  setSelectedLine: (line: ManualGuideLineKey | null) => void;
  committedAutoMeasureOverlay: AutoMeasureGraphics | null;
  setCommittedAutoMeasureOverlay: React.Dispatch<React.SetStateAction<AutoMeasureGraphics | null>>;
  onAdjusted: (corners: AutoMeasureCorners) => void;
  isActive: boolean;
  calibrationMeasureModeRef?: React.MutableRefObject<CalibrationMeasureMode>;
};

export function useAutoMeasureKeyboardAdjust({
  selectedLine,
  setSelectedLine,
  committedAutoMeasureOverlay,
  setCommittedAutoMeasureOverlay,
  onAdjusted,
  isActive,
  calibrationMeasureModeRef,
}: Args): void {
  const selectedLineRef = useRef<ManualGuideLineKey | null>(selectedLine);
  selectedLineRef.current = selectedLine;

  const committedOverlayRef = useRef<AutoMeasureGraphics | null>(committedAutoMeasureOverlay);
  committedOverlayRef.current = committedAutoMeasureOverlay;

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const onAdjustedRef = useRef(onAdjusted);
  onAdjustedRef.current = onAdjusted;

  const originalCornersRef = useRef<AutoMeasureCorners | null>(null);
  const prevOverlayRef = useRef<AutoMeasureGraphics | null>(null);

  useEffect(() => {
    const prev = prevOverlayRef.current;
    prevOverlayRef.current = committedAutoMeasureOverlay;

    if (committedAutoMeasureOverlay && !prev) {
      originalCornersRef.current = cloneCorners(committedAutoMeasureOverlay.corners);
      // eslint-disable-next-line no-console
      console.log('[auto-measure-edit] initialized editable=true');
    }

    if (!committedAutoMeasureOverlay) {
      originalCornersRef.current = null;
      setSelectedLine(null);
    }
  }, [committedAutoMeasureOverlay, setSelectedLine]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isActiveRef.current) return;
      if (!committedOverlayRef.current) return;

      const tag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase() ?? '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      const { key, shiftKey, ctrlKey } = event;

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

      const line = selectedLineRef.current;
      if (!line) return;

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
