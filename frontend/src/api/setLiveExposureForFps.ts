import { setCameraExposure } from './setCameraExposure';

/**
 * Live-mode exposure helper. The DVP SDK exposes no SetFrameRate; the only
 * way to raise live FPS is to lower exposure. This converts a target FPS
 * into an exposure value and applies it via the existing setCameraExposure
 * API.
 *
 * Use only for live preview. Auto Measure / snapshot capture has its own
 * frame path (`measureVickersAuto` → `cameraGetFrame`) and is unaffected
 * by this call.
 *
 * Note: the actual FPS attained is bounded ALSO by sensor readout + USB
 * bandwidth at the configured ROI. Setting target=30 does not guarantee
 * 30 FPS; cross-check with the `[camera-sdk-fps-confirmed]` and
 * `[camera-native-send-loop]` log lines.
 */
export function setLiveExposureForFps(targetFps: number) {
  if (!Number.isFinite(targetFps) || targetFps <= 0) {
    return Promise.reject(new Error(`targetFps must be > 0 (got ${targetFps})`));
  }
  const exposureMs = 1000 / targetFps;
  return setCameraExposure(exposureMs);
}
