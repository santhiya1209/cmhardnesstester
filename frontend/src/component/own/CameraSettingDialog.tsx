import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useCameraSetting } from '@/hooks/queries/useCameraSetting';
import { useSaveCameraSetting } from '@/hooks/mutations/useSaveCameraSetting';
import { useCameraStatus } from '@/hooks/queries/useCameraStatus';
import {
  ANALOG_GAIN_MAX,
  ANALOG_GAIN_MIN,
  ANALOG_GAIN_STEP,
  DEFAULT_ANALOG_GAIN,
  DEFAULT_EXPOSURE_TIME_MS,
  EXPOSURE_TIME_MAX_MS,
  EXPOSURE_TIME_MIN_MS,
  EXPOSURE_TIME_STEP_MS,
} from '@/types/cameraSetting';
import { colors } from '@/theme/theme';

type Range = { min: number; max: number; step: number };

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
};

function CameraSettingDialogImpl({ open, onClose, onStatusChange }: Props) {
  const { data, error: loadError, loading, refetch } = useCameraSetting();
  const { saveCameraSetting, saving, error: saveError } = useSaveCameraSetting();
  const { status, refetch: refetchStatus } = useCameraStatus();

  const [analogGain, setAnalogGain] = useState<number>(DEFAULT_ANALOG_GAIN);
  const [exposureMs, setExposureMs] = useState<number>(DEFAULT_EXPOSURE_TIME_MS);
  const [liveApplyError, setLiveApplyError] = useState<string | null>(null);
  const [gainRange, setGainRange] = useState<Range>({
    min: ANALOG_GAIN_MIN,
    max: ANALOG_GAIN_MAX,
    step: ANALOG_GAIN_STEP,
  });
  const [exposureRange, setExposureRange] = useState<Range>({
    min: EXPOSURE_TIME_MIN_MS,
    max: EXPOSURE_TIME_MAX_MS,
    step: EXPOSURE_TIME_STEP_MS,
  });

  const liveAvailable = status.open || status.streaming;
  const busy = loading || saving;
  const errorMessage = loadError ?? saveError ?? liveApplyError;

  // Throttle live-apply: skip new emissions while one is still in flight,
  // but always re-send the most recent value once the in-flight call settles.
  const gainInFlightRef = useRef(false);
  const gainPendingRef = useRef<number | null>(null);
  const exposureInFlightRef = useRef(false);
  const exposurePendingRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setLiveApplyError(null);
      void refetch();
      void refetchStatus();
    }
  }, [open, refetch, refetchStatus]);

  // Pull SDK exposure/gain ranges whenever the dialog opens against an open
  // camera. Falls back silently to hardcoded defaults if the SDK is offline.
  useEffect(() => {
    if (!open || !status.open) return;
    let cancelled = false;
    void (async () => {
      try {
        const [er, gr] = await Promise.all([
          window.hardnessCamera.getExposureRange(),
          window.hardnessCamera.getGainRange(),
        ]);
        // eslint-disable-next-line no-console
        console.log('[camera-settings][frontend] exposure range:', er);
        // eslint-disable-next-line no-console
        console.log('[camera-settings][frontend] gain range:', gr);
        if (cancelled) return;
        if (er.ok && er.min !== undefined && er.max !== undefined) {
          const step = er.step !== undefined && er.step > 0 ? er.step : EXPOSURE_TIME_STEP_MS;
          setExposureRange({ min: er.min, max: er.max, step });
          if (typeof er.current === 'number' && Number.isFinite(er.current)) {
            setExposureMs(clamp(er.current, er.min, er.max));
          }
        } else if (!er.ok) {
          setLiveApplyError(er.message ?? er.error ?? 'Failed to read exposure range.');
        }
        if (gr.ok && gr.min !== undefined && gr.max !== undefined) {
          const step = gr.step !== undefined && gr.step > 0 ? gr.step : ANALOG_GAIN_STEP;
          setGainRange({ min: gr.min, max: gr.max, step });
          if (typeof gr.current === 'number' && Number.isFinite(gr.current)) {
            setAnalogGain(clamp(gr.current, gr.min, gr.max));
          }
        } else if (!gr.ok) {
          setLiveApplyError(gr.message ?? gr.error ?? 'Failed to read gain range.');
        }
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.error('[camera-settings][frontend] range fetch threw:', err);
          setLiveApplyError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, status.open]);

  useEffect(() => {
    if (open && !loading && !liveAvailable) {
      setAnalogGain(data?.analogGain ?? DEFAULT_ANALOG_GAIN);
      setExposureMs(data?.exposureTimeMs ?? DEFAULT_EXPOSURE_TIME_MS);
    }
  }, [data, liveAvailable, loading, open]);

  const sendGain = useCallback(
    async (rawValue: number) => {
      const value = clamp(rawValue, gainRange.min, gainRange.max);
      // eslint-disable-next-line no-console
      console.log('[camera-settings][frontend] gain changed:', value);
      try {
        const reply = await window.hardnessCamera.setGain(value);
        // eslint-disable-next-line no-console
        console.log('[camera-settings][frontend] setGain reply:', reply);
        if (!reply.ok) {
          // eslint-disable-next-line no-console
          console.error('[camera-settings][frontend] setGain failed:', reply);
          setLiveApplyError(reply.message ?? reply.error ?? 'Failed to apply gain.');
        } else {
          if (typeof reply.gain === 'number' && Number.isFinite(reply.gain)) {
            setAnalogGain(reply.gain);
          }
          setLiveApplyError(null);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[camera-settings][frontend] setGain threw:', err);
        setLiveApplyError(err instanceof Error ? err.message : String(err));
      }
    },
    [gainRange.min, gainRange.max]
  );

  const sendExposure = useCallback(
    async (rawValueMs: number) => {
      const valueMs = clamp(rawValueMs, exposureRange.min, exposureRange.max);
      // eslint-disable-next-line no-console
      console.log('[camera-settings][frontend] exposure changed:', valueMs);
      try {
        const reply = await window.hardnessCamera.setExposure(valueMs);
        // eslint-disable-next-line no-console
        console.log('[camera-settings][frontend] setExposure reply:', reply);
        if (!reply.ok) {
          // eslint-disable-next-line no-console
          console.error('[camera-settings][frontend] setExposure failed:', reply);
          setLiveApplyError(reply.message ?? reply.error ?? 'Failed to apply exposure.');
        } else {
          if (typeof reply.exposureMs === 'number' && Number.isFinite(reply.exposureMs)) {
            setExposureMs(reply.exposureMs);
          }
          setLiveApplyError(null);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[camera-settings][frontend] setExposure threw:', err);
        setLiveApplyError(err instanceof Error ? err.message : String(err));
      }
    },
    [exposureRange.min, exposureRange.max]
  );

  const applyGainLive = useCallback(
    (value: number) => {
      if (!liveAvailable) return;
      if (gainInFlightRef.current) {
        gainPendingRef.current = value;
        return;
      }
      gainInFlightRef.current = true;
      void (async () => {
        let next: number | null = value;
        while (next !== null) {
          const v = next;
          next = null;
          await sendGain(v);
          if (gainPendingRef.current !== null) {
            next = gainPendingRef.current;
            gainPendingRef.current = null;
          }
        }
        gainInFlightRef.current = false;
      })();
    },
    [liveAvailable, sendGain]
  );

  const applyExposureLive = useCallback(
    (valueMs: number) => {
      if (!liveAvailable) return;
      if (exposureInFlightRef.current) {
        exposurePendingRef.current = valueMs;
        return;
      }
      exposureInFlightRef.current = true;
      void (async () => {
        let next: number | null = valueMs;
        while (next !== null) {
          const v = next;
          next = null;
          await sendExposure(v);
          if (exposurePendingRef.current !== null) {
            next = exposurePendingRef.current;
            exposurePendingRef.current = null;
          }
        }
        exposureInFlightRef.current = false;
      })();
    },
    [liveAvailable, sendExposure]
  );

  const handleGainChange = useCallback(
    (_: Event, value: number | number[]) => {
      if (typeof value !== 'number') return;
      setAnalogGain(value);
      applyGainLive(value);
    },
    [applyGainLive]
  );

  const handleGainCommit = useCallback(
    (_: unknown, value: number | number[]) => {
      if (typeof value === 'number') applyGainLive(value);
    },
    [applyGainLive]
  );

  const handleExposureChange = useCallback(
    (_: Event, value: number | number[]) => {
      if (typeof value !== 'number') return;
      setExposureMs(value);
      applyExposureLive(value);
    },
    [applyExposureLive]
  );

  const handleExposureCommit = useCallback(
    (_: unknown, value: number | number[]) => {
      if (typeof value === 'number') applyExposureLive(value);
    },
    [applyExposureLive]
  );

  const handleSave = useCallback(async () => {
    try {
      await saveCameraSetting({
        id: data?.id,
        values: { analogGain, exposureTimeMs: exposureMs },
      });
      if (liveAvailable) {
        await sendGain(analogGain);
        await sendExposure(exposureMs);
      }
      onStatusChange?.(
        liveAvailable
          ? 'Camera settings saved and applied.'
          : 'Camera settings saved (camera not live).'
      );
      onClose();
    } catch {
      // surfaced via saveError
    }
  }, [
    analogGain,
    data?.id,
    exposureMs,
    liveAvailable,
    onClose,
    onStatusChange,
    saveCameraSetting,
    sendExposure,
    sendGain,
  ]);

  const handleCancel = useCallback(() => {
    if (liveAvailable && data) {
      void window.hardnessCamera.setGain(data.analogGain).catch(() => {});
      void window.hardnessCamera.setExposure(data.exposureTimeMs).catch(() => {});
    }
    onClose();
  }, [data, liveAvailable, onClose]);

  return (
    <Dialog open={open} onClose={busy ? undefined : handleCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ bgcolor: colors.headingPrimary, color: '#FFFFFF', py: 1.25 }}>
        Camera Setting
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Box>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.5 }}>
              <Typography variant="body2" sx={{ minWidth: 110 }}>
                Analog Gain
              </Typography>
              <Slider
                value={clamp(analogGain, gainRange.min, gainRange.max)}
                min={gainRange.min}
                max={gainRange.max}
                step={gainRange.step}
                onChange={handleGainChange}
                onChangeCommitted={handleGainCommit}
                disabled={busy}
                size="small"
                sx={{ flex: 1 }}
              />
              <Typography
                variant="body2"
                sx={{ minWidth: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
              >
                {analogGain.toFixed(3)}
              </Typography>
            </Stack>
          </Box>

          <Box>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.5 }}>
              <Typography variant="body2" sx={{ minWidth: 110 }}>
                Exposure Time
              </Typography>
              <Slider
                value={clamp(exposureMs, exposureRange.min, exposureRange.max)}
                min={exposureRange.min}
                max={exposureRange.max}
                step={exposureRange.step}
                onChange={handleExposureChange}
                onChangeCommitted={handleExposureCommit}
                disabled={busy}
                size="small"
                sx={{ flex: 1 }}
              />
              <Typography
                variant="body2"
                sx={{ minWidth: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
              >
                {Math.round(exposureMs)} ms
              </Typography>
            </Stack>
          </Box>

          {!liveAvailable ? (
            <Alert severity="info" sx={{ py: 0.5 }}>
              Camera is not live. Settings will be saved but not applied until the camera is opened.
            </Alert>
          ) : null}

          {errorMessage ? (
            <Alert severity="error" sx={{ py: 0.5 }}>
              {errorMessage}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={() => void handleSave()} disabled={busy}>
          Save
        </Button>
        <Button onClick={handleCancel} disabled={busy}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(CameraSettingDialogImpl);
