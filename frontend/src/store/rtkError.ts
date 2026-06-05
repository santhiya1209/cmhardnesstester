/**
 * Normalise an RTK Query error (FetchBaseQueryError | SerializedError) to the
 * same string-or-null shape the old hand-rolled hooks exposed, preferring the
 * backend's `{ message }` / `{ error }` body.
 */
export function rtkErrorMessage(error: unknown, fallback: string): string | null {
  if (!error) return null;
  if (typeof error === 'object') {
    const e = error as { data?: unknown; error?: unknown; message?: unknown };
    if (e.data && typeof e.data === 'object') {
      const body = e.data as { message?: unknown; error?: unknown };
      if (typeof body.message === 'string' && body.message.trim()) return body.message;
      if (typeof body.error === 'string' && body.error.trim()) return body.error;
    }
    if (typeof e.error === 'string' && e.error.trim()) return e.error;
    if (typeof e.message === 'string' && e.message.trim()) return e.message;
  }
  return fallback;
}
