/**
 * Parse a free-text numeric field into the engine's `number | null` shape.
 * Empty → null; unparseable → null (the generation engine in
 * `utils/patternGeneration.ts` owns the real validation, so this only converts).
 * Used by the uncontrolled pattern-mode form inputs.
 */
export function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}
