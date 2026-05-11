// Yellow measurement-line thickness preference shared between Auto Measure
// and Manual Measure overlays. Persisted client-side via localStorage so the
// user's choice survives app restarts without introducing a new backend table.
//
// Active (hovered/dragged) lines render at 1.25× the base width to keep the
// drag affordance visible regardless of the base setting.

export type LineThickness = 'thin' | 'normal' | 'thick';

export const LINE_THICKNESS_PX: Record<LineThickness, number> = {
  thin: 1,
  normal: 2,
  thick: 4,
};

export const DEFAULT_LINE_THICKNESS: LineThickness = 'normal';

export const LINE_THICKNESS_STORAGE_KEY = 'hardness-tester.lineThickness.v1';

export function isLineThickness(value: unknown): value is LineThickness {
  return value === 'thin' || value === 'normal' || value === 'thick';
}
