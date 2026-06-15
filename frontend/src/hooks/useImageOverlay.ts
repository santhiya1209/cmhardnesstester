import { useCallback, useMemo, useState } from 'react';
import type { OverlayShape, OverlayShapeInput } from '@/types/tool';
import { DEFAULT_CROSSHAIR_CONFIG, type CrosshairConfig } from '@/types/crosshair';

let _seq = 0;
const nextId = () => `s_${Date.now().toString(36)}_${(_seq++).toString(36)}`;

export type ImageOverlayApi = {
  shapes: OverlayShape[];
  crossLineVisible: boolean;
  crosshairConfig: CrosshairConfig;
  addShape: (shape: OverlayShapeInput) => void;
  updateShape: (id: string, next: OverlayShapeInput) => void;
  clearAll: () => void;
  clearByKind: (kind: OverlayShape['kind']) => void;
  trimLast: () => void;
  toggleCrossLine: () => void;
  setCrosshairConfig: (next: Partial<CrosshairConfig>) => void;
  /**
   * Force the reticle on and pin it (locked) — used by modes that require a
   * permanent reticle (Horizontal Capture). While locked, toggle/clear cannot
   * hide it; passing false releases the pin (the reticle stays as-is).
   */
  lockCrossLine: (locked: boolean) => void;
};

export function useImageOverlay(): ImageOverlayApi {
  const [shapes, setShapes] = useState<OverlayShape[]>([]);
  const [crossLineVisible, setCrossLineVisible] = useState(false);
  const [crossLineLocked, setCrossLineLocked] = useState(false);
  const [crosshairConfig, setCrosshairConfigState] =
    useState<CrosshairConfig>(DEFAULT_CROSSHAIR_CONFIG);

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
    // Keep a locked reticle visible — Clear Graphics must not hide a mode-required reticle.
    setCrossLineVisible((wasVisible) => (crossLineLocked ? wasVisible : false));
  }, [crossLineLocked]);

  const clearByKind = useCallback((kind: OverlayShape['kind']) => {
    setShapes((prev) => (prev.some((s) => s.kind === kind) ? prev.filter((s) => s.kind !== kind) : prev));
  }, []);

  const trimLast = useCallback(() => {
    setShapes((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
  }, []);

  const toggleCrossLine = useCallback(() => {
    // Pinned on while locked: the toggle can't hide a mode-required reticle.
    setCrossLineVisible((v) => (crossLineLocked ? true : !v));
  }, [crossLineLocked]);

  const lockCrossLine = useCallback((locked: boolean) => {
    setCrossLineLocked(locked);
    if (locked) setCrossLineVisible(true);
  }, []);

  const setCrosshairConfig = useCallback((next: Partial<CrosshairConfig>) => {
    setCrosshairConfigState((prev) => ({ ...prev, ...next }));
  }, []);

  return useMemo(
    () => ({ shapes, crossLineVisible, crosshairConfig, addShape, updateShape, clearAll, clearByKind, trimLast, toggleCrossLine, setCrosshairConfig, lockCrossLine }),
    [shapes, crossLineVisible, crosshairConfig, addShape, updateShape, clearAll, clearByKind, trimLast, toggleCrossLine, setCrosshairConfig, lockCrossLine]
  );
}
