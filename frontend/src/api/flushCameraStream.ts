/**
 * Tell the main process to mark all in-flight / pending frames as stale.
 * Used at objective change (10X/40X) so SDK-buffered frames captured before
 * the swap don't get rendered after the canvas clear.
 */
export function flushCameraStream(reason = 'objective-change'): void {
  void window.api.invoke('camera:flush-stream', { reason }).catch(() => {
    /* best-effort */
  });
}
