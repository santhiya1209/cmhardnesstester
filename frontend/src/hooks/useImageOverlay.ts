import { useCallback, useMemo, useState } from 'react';
import type { OverlayShape, OverlayShapeInput } from '@/types/tool';

let _seq = 0;
const nextId = () => `s_${Date.now().toString(36)}_${(_seq++).toString(36)}`;

export type ImageOverlayApi = {
  shapes: OverlayShape[];
  crossLineVisible: boolean;
  addShape: (shape: OverlayShapeInput) => void;
  updateShape: (id: string, next: OverlayShapeInput) => void;
  clearAll: () => void;
  clearByKind: (kind: OverlayShape['kind']) => void;
  trimLast: () => void;
  toggleCrossLine: () => void;
};

export function useImageOverlay(): ImageOverlayApi {
  const [shapes, setShapes] = useState<OverlayShape[]>([]);
  const [crossLineVisible, setCrossLineVisible] = useState(false);

  const addShape = useCallback((shape: OverlayShapeInput) => {
    setShapes((prev) => [...prev, { ...shape, id: nextId() } as OverlayShape]);
  }, []);

  const updateShape = useCallback((id: string, next: OverlayShapeInput) => {
    setShapes((prev) =>
      prev.map((s) => (s.id === id ? ({ ...next, id } as OverlayShape) : s))
    );
  }, []);

  const clearAll = useCallback(() => {
    setShapes([]);
    setCrossLineVisible((wasVisible) => {
      if (wasVisible) {
      }
      return false;
    });
  }, []);

  const clearByKind = useCallback((kind: OverlayShape['kind']) => {
    setShapes((prev) => (prev.some((s) => s.kind === kind) ? prev.filter((s) => s.kind !== kind) : prev));
  }, []);

  const trimLast = useCallback(() => {
    setShapes((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
  }, []);

  const toggleCrossLine = useCallback(() => {
    setCrossLineVisible((v) => {
      const next = !v;
      return next;
    });
  }, []);

  return useMemo(
    () => ({ shapes, crossLineVisible, addShape, updateShape, clearAll, clearByKind, trimLast, toggleCrossLine }),
    [shapes, crossLineVisible, addShape, updateShape, clearAll, clearByKind, trimLast, toggleCrossLine]
  );
}
