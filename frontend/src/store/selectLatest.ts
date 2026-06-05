/** Pick the most-recently-updated row from a singleton-settings list. */
export function selectLatestByUpdatedAt<T extends { updatedAt: string }>(
  items: readonly T[]
): T | null {
  if (items.length === 0) return null;
  return [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}
