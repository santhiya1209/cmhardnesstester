import { useCallback, useEffect, useState } from 'react';
import { getCameraStatus } from '@/api/getCameraStatus';
import type { CameraStatus } from '@/types/camera';

const INITIAL: CameraStatus = {
  sdkLoaded: false,
  open: false,
  streaming: false,
  width: 0,
  height: 0,
  lastError: null,
};

/**
 * Reads camera status once and stays subscribed to `camera:status` events.
 * Status changes infrequently (open/close/start/stop/errors) so React
 * re-rendering on each one is fine — frames do NOT come through here.
 */
export function useCameraStatus() {
  const [status, setStatus] = useState<CameraStatus>(INITIAL);

  const refetch = useCallback(async () => {
    const reply = await getCameraStatus();
    if (reply && reply.ok) {
      setStatus((prev) => ({ ...prev, ...(reply as unknown as Partial<CameraStatus>) }));
    }
  }, []);

  useEffect(() => {
    void refetch();
    const off = window.api.on('camera:status', (payload: Partial<CameraStatus>) => {
      setStatus((prev) => ({ ...prev, ...payload }));
    });
    return off;
  }, [refetch]);

  return { status, refetch };
}
