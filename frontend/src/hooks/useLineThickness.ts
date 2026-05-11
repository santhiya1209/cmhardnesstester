import { useCallback, useState } from 'react';
import {
  DEFAULT_LINE_THICKNESS,
  LINE_THICKNESS_PX,
  LINE_THICKNESS_STORAGE_KEY,
  isLineThickness,
  type LineThickness,
} from '@/types/lineThickness';

function readStored(): LineThickness {
  try {
    const value = window.localStorage.getItem(LINE_THICKNESS_STORAGE_KEY);
    if (isLineThickness(value)) {
      return value;
    }
  } catch {
    // localStorage may be blocked (private mode etc.) — fall through to default.
  }
  return DEFAULT_LINE_THICKNESS;
}

export type UseLineThicknessApi = {
  thickness: LineThickness;
  strokeWidth: number;
  setThickness: (next: LineThickness) => void;
};

export function useLineThickness(): UseLineThicknessApi {
  const [thickness, setThicknessState] = useState<LineThickness>(readStored);

  const setThickness = useCallback((next: LineThickness) => {
    setThicknessState((prev) => {
      if (prev === next) return prev;
      try {
        window.localStorage.setItem(LINE_THICKNESS_STORAGE_KEY, next);
      } catch {
        // Storage write blocked — UI still updates in-memory.
      }
      // eslint-disable-next-line no-console
      console.log(
        `[line-thickness-change] option=${next} strokeWidth=${LINE_THICKNESS_PX[next]}`
      );
      // eslint-disable-next-line no-console
      console.log('[overlay-redraw] reason=line-thickness-change');
      return next;
    });
  }, []);

  return {
    thickness,
    strokeWidth: LINE_THICKNESS_PX[thickness],
    setThickness,
  };
}
