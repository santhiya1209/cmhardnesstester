/**
 * Fire-and-forget ack so the main process can release its in-flight slot
 * and send the next frame. Called from the camera stream paint handler
 * right after pixels land on the canvas.
 */
export function ackCameraFrame(frameId: number): void {
  if (!frameId) return;
  void window.api.invoke('camera:frame-ack', { frameId }).catch(() => {
    /* ack is best-effort; main process has a 200ms timeout fallback */
  });
}
