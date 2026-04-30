import { useCallback, useMemo, useState } from 'react';
import type { OverlayShape, OverlayShapeInput } from '@/types/tool';

let _seq = 0;
const nextId = () => `s_${Date.now().toString(36)}_${(_seq++).toString(36)}`;

export type ImageOverlayApi = {
  shapes: OverlayShape[];
  crossLineVisible: boolean;
  addShape: (shape: OverlayShapeInput) => void;
  clearAll: () => void;
  trimLast: () => void;
  toggleCrossLine: () => void;
};

export function useImageOverlay(): ImageOverlayApi {
  const [shapes, setShapes] = useState<OverlayShape[]>([]);
  const [crossLineVisible, setCrossLineVisible] = useState(false);

  const addShape = useCallback((shape: OverlayShapeInput) => {
    setShapes((prev) => [...prev, { ...shape, id: nextId() } as OverlayShape]);
  }, []);

  const clearAll = useCallback(() => {
    setShapes([]);
  }, []);

  const trimLast = useCallback(() => {
    setShapes((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
  }, []);

  const toggleCrossLine = useCallback(() => {
    setCrossLineVisible((v) => !v);
  }, []);

  return useMemo(
    () => ({ shapes, crossLineVisible, addShape, clearAll, trimLast, toggleCrossLine }),
    [shapes, crossLineVisible, addShape, clearAll, trimLast, toggleCrossLine]
  );
}
