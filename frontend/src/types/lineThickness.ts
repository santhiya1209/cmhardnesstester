
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
