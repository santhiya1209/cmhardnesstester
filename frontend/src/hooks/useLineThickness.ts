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
      }
      return next;
    });
  }, []);

  return {
    thickness,
    strokeWidth: LINE_THICKNESS_PX[thickness],
    setThickness,
  };
}
