import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

import { useCameraSetting } from '@/hooks/queries/useCameraSetting';
import { useSaveCameraSetting } from '@/hooks/mutations/useSaveCameraSetting';
import { useCameraStatus } from '@/hooks/queries/useCameraStatus';
import { dropPendingCameraFrames } from '@/hooks/useCameraStream';
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
import { tokens } from '@/theme/theme';

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

  const gainInFlightRef = useRef(false);
  const gainPendingRef = useRef<number | null>(null);
  const gainLastSentValueRef = useRef<number | null>(null);
  const exposureInFlightRef = useRef(false);
  const exposurePendingRef = useRef<number | null>(null);
  const exposureDraggingRef = useRef(false);
  const exposureThrottleTimerRef = useRef<number | null>(null);
  const exposureLastSentValueRef = useRef<number | null>(null);
  const exposureLastSentAtRef = useRef<number>(0);
  const EXPOSURE_DRAG_THROTTLE_MS = 100;
  const appliedGainRef = useRef<number | null>(null);
  const appliedExposureMsRef = useRef<number | null>(null);

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    lastLogAt: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setLiveApplyError(null);
      void refetch();
      void refetchStatus();
    } else {
    }
  }, [open, refetch, refetchStatus]);

  useEffect(() => {
    if (!open || !status.open) return;
    let cancelled = false;
    void (async () => {
      try {
        const [er, gr] = await Promise.all([
          window.hardnessCamera.getExposureRange(),
          window.hardnessCamera.getGainRange(),
        ]);
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
    if (!open) return;
    if (data) {
      appliedGainRef.current = data.analogGain ?? null;
      appliedExposureMsRef.current = data.exposureTimeMs ?? null;
    }
    if (!loading && !liveAvailable) {
      // eslint-disable-next-line no-console
      console.log(
        `[camera-settings-load] popup gain=${data?.analogGain ?? DEFAULT_ANALOG_GAIN} exposureMs=${data?.exposureTimeMs ?? DEFAULT_EXPOSURE_TIME_MS}`
      );
      setAnalogGain(data?.analogGain ?? DEFAULT_ANALOG_GAIN);
      setExposureMs(data?.exposureTimeMs ?? DEFAULT_EXPOSURE_TIME_MS);
    }
  }, [data, liveAvailable, loading, open]);

  const sendGain = useCallback(
    async (rawValue: number) => {
      const value = clamp(rawValue, gainRange.min, gainRange.max);
      if (appliedGainRef.current !== null && value === appliedGainRef.current) {
        return;
      }
      const previousAppliedGain = appliedGainRef.current;
      appliedGainRef.current = value;
      // eslint-disable-next-line no-console
      console.log('[camera-ui][settings-change] gain=' + value);
      try {
        dropPendingCameraFrames('gain-change');
        const reply = await window.hardnessCamera.setGain(value);
        if (!reply.ok) {
          appliedGainRef.current = previousAppliedGain;
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
        appliedGainRef.current = previousAppliedGain;
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
      if (appliedExposureMsRef.current !== null && valueMs === appliedExposureMsRef.current) {
        return;
      }
      const previousAppliedExposure = appliedExposureMsRef.current;
      appliedExposureMsRef.current = valueMs;
      // eslint-disable-next-line no-console
      console.log('[camera-ui][settings-change] exposureMs=' + valueMs);
      try {
        dropPendingCameraFrames('exposure-change');
        const reply = await window.hardnessCamera.setExposure(valueMs);
        if (!reply.ok) {
          appliedExposureMsRef.current = previousAppliedExposure;
          // eslint-disable-next-line no-console
          console.error('[camera-settings][frontend] setExposure failed:', reply);
          setLiveApplyError(reply.message ?? reply.error ?? 'Failed to apply exposure.');
        } else {
          if (
            typeof reply.exposureMs === 'number' &&
            Number.isFinite(reply.exposureMs) &&
            !exposureDraggingRef.current
          ) {
            setExposureMs(reply.exposureMs);
          }
          setLiveApplyError(null);
        }
      } catch (err) {
        appliedExposureMsRef.current = previousAppliedExposure;
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
      if (
        gainLastSentValueRef.current === value &&
        gainPendingRef.current === null
      ) {
        return;
      }
      if (gainInFlightRef.current) {
        if (gainLastSentValueRef.current === value) return;
        gainPendingRef.current = value;
        return;
      }
      gainInFlightRef.current = true;
      gainLastSentValueRef.current = value;
      void (async () => {
        let next: number | null = value;
        while (next !== null) {
          const v = next;
          next = null;
          await sendGain(v);
          if (gainPendingRef.current !== null) {
            next = gainPendingRef.current;
            gainPendingRef.current = null;
            gainLastSentValueRef.current = next;
          }
        }
        gainInFlightRef.current = false;
      })();
    },
    [liveAvailable, sendGain]
  );

  const flushExposureLive = useCallback(
    (valueMs: number) => {
      if (exposureInFlightRef.current) {
        if (exposureLastSentValueRef.current === valueMs) return;
        exposurePendingRef.current = valueMs;
        return;
      }
      if (exposureLastSentValueRef.current === valueMs) {
        return;
      }
      exposureInFlightRef.current = true;
      exposureLastSentValueRef.current = valueMs;
      exposureLastSentAtRef.current = Date.now();
      void (async () => {
        let next: number | null = valueMs;
        while (next !== null) {
          const v = next;
          next = null;
          await sendExposure(v);
          if (exposurePendingRef.current !== null) {
            next = exposurePendingRef.current;
            exposurePendingRef.current = null;
            exposureLastSentValueRef.current = next;
            exposureLastSentAtRef.current = Date.now();
          }
        }
        exposureInFlightRef.current = false;
      })();
    },
    [sendExposure]
  );

  const applyExposureLive = useCallback(
    (valueMs: number) => {
      if (!liveAvailable) return;
      if (exposureDraggingRef.current) {
        const sinceLast = Date.now() - exposureLastSentAtRef.current;
        if (sinceLast < EXPOSURE_DRAG_THROTTLE_MS) {
          exposurePendingRef.current = valueMs;
          if (exposureThrottleTimerRef.current === null) {
            const wait = EXPOSURE_DRAG_THROTTLE_MS - sinceLast;
            exposureThrottleTimerRef.current = window.setTimeout(() => {
              exposureThrottleTimerRef.current = null;
              const pending = exposurePendingRef.current;
              exposurePendingRef.current = null;
              if (pending !== null) flushExposureLive(pending);
            }, wait);
          }
          return;
        }
      }
      flushExposureLive(valueMs);
    },
    [liveAvailable, flushExposureLive]
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
      exposureDraggingRef.current = true;
      setExposureMs(value);
      applyExposureLive(value);
    },
    [applyExposureLive]
  );

  const handleExposureCommit = useCallback(
    (_: unknown, value: number | number[]) => {
      exposureDraggingRef.current = false;
      if (typeof value !== 'number') return;
      if (exposureThrottleTimerRef.current !== null) {
        window.clearTimeout(exposureThrottleTimerRef.current);
        exposureThrottleTimerRef.current = null;
      }
      exposurePendingRef.current = null;
      flushExposureLive(value);
    },
    [flushExposureLive]
  );

  useEffect(() => {
    return () => {
      if (exposureThrottleTimerRef.current !== null) {
        window.clearTimeout(exposureThrottleTimerRef.current);
        exposureThrottleTimerRef.current = null;
      }
    };
  }, []);

  const handleSave = useCallback(async () => {
    if (!liveAvailable) {
      // eslint-disable-next-line no-console
      console.log(`[camera-settings-persist][apply-skip] reason=camera-not-open key=gain value=${analogGain}`);
      // eslint-disable-next-line no-console
      console.log(`[camera-settings-persist][apply-skip] reason=camera-not-open key=exposure value=${exposureMs}`);
      setLiveApplyError('Camera is not connected — open the camera before saving.');
      return;
    }
    setLiveApplyError(null);
    // eslint-disable-next-line no-console
    console.log(`[camera-settings-persist][apply-ready] key=gain value=${analogGain}`);
    // eslint-disable-next-line no-console
    console.log(`[camera-settings-persist][apply-ready] key=exposure value=${exposureMs}`);
    try {
      dropPendingCameraFrames('gain-change');
      const gainReply = await window.hardnessCamera.setGain(analogGain);
      if (!gainReply.ok) {
        // eslint-disable-next-line no-console
        console.error('[camera-settings-error] gain apply failed:', gainReply);
        setLiveApplyError(gainReply.message ?? gainReply.error ?? 'Failed to apply gain.');
        return;
      }
      dropPendingCameraFrames('exposure-change');
      const exposureReply = await window.hardnessCamera.setExposure(exposureMs);
      if (!exposureReply.ok) {
        // eslint-disable-next-line no-console
        console.error('[camera-settings-error] exposure apply failed:', exposureReply);
        setLiveApplyError(
          exposureReply.message ?? exposureReply.error ?? 'Failed to apply exposure.'
        );
        return;
      }
      const confirmedGain = gainReply.gain;
      const confirmedExposureMs = exposureReply.exposureMs;
      if (
        typeof confirmedGain !== 'number' ||
        !Number.isFinite(confirmedGain) ||
        typeof confirmedExposureMs !== 'number' ||
        !Number.isFinite(confirmedExposureMs)
      ) {
        // eslint-disable-next-line no-console
        console.error('[camera-settings-error] SDK returned no confirmed values:', {
          gainReply,
          exposureReply,
        });
        setLiveApplyError('Camera did not confirm applied values — not saved.');
        return;
      }
      // eslint-disable-next-line no-console
      console.log(`[camera-settings-persist][verify] key=gain value=${confirmedGain}`);
      // eslint-disable-next-line no-console
      console.log(`[camera-settings-persist][verify] key=exposure value=${confirmedExposureMs}`);
      setAnalogGain(confirmedGain);
      setExposureMs(confirmedExposureMs);
      appliedGainRef.current = confirmedGain;
      appliedExposureMsRef.current = confirmedExposureMs;
      // eslint-disable-next-line no-console
      console.log(`[camera-settings-save] gain=${confirmedGain} exposure=${confirmedExposureMs}`);
      await saveCameraSetting({
        id: data?.id,
        values: { analogGain: confirmedGain, exposureTimeMs: confirmedExposureMs },
      });
      // eslint-disable-next-line no-console
      console.log(`[camera-settings-persist][save] key=gain value=${confirmedGain}`);
      // eslint-disable-next-line no-console
      console.log(`[camera-settings-persist][save] key=exposure value=${confirmedExposureMs}`);
      onStatusChange?.('Camera settings saved and applied.');
      onClose();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[camera-settings-error] save flow threw:', err);
      setLiveApplyError(err instanceof Error ? err.message : String(err));
    }
  }, [analogGain, data?.id, exposureMs, liveAvailable, onClose, onStatusChange, saveCameraSetting]);

  const handleCancel = useCallback(() => {
    if (liveAvailable && data) {
      void sendGain(data.analogGain);
      void sendExposure(data.exposureTimeMs);
    }
    onClose();
  }, [data, liveAvailable, onClose, sendGain, sendExposure]);

  const handleHeaderPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target && target.closest('button')) return;
    const panel = event.currentTarget.parentElement as HTMLElement | null;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      lastLogAt: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPosition({ x: rect.left, y: rect.top });
  }, []);

  const handleHeaderPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 40;
    const nextX = Math.max(0, Math.min(maxX, event.clientX - drag.offsetX));
    const nextY = Math.max(0, Math.min(maxY, event.clientY - drag.offsetY));
    setPosition({ x: nextX, y: nextY });
    const now = performance.now();
    if (now - drag.lastLogAt > 100) {
      drag.lastLogAt = now;
    }
  }, []);

  const handleHeaderPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  if (!open) return null;

  const anchoredStyle: React.CSSProperties = position
    ? { left: position.x, top: position.y }
    : { right: 24, top: 80 };

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        ...anchoredStyle,
        width: 420,
        maxWidth: 'calc(100vw - 32px)',
        zIndex: (theme) => theme.zIndex.modal,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Box
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          bgcolor: tokens.accent.base,
          color: '#FFFFFF',
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicatorIcon fontSize="small" sx={{ opacity: 0.85 }} />
        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>
          Camera Setting
        </Typography>
        <IconButton
          size="small"
          onClick={handleCancel}
          disabled={busy}
          sx={{ color: '#FFFFFF' }}
          aria-label="Close camera settings"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ p: 2, overflowY: 'auto', maxHeight: 'calc(100vh - 160px)' }}>
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
              Camera is not connected. Open the camera to apply and save settings.
            </Alert>
          ) : null}

          {errorMessage ? (
            <Alert severity="error" sx={{ py: 0.5 }}>
              {errorMessage}
            </Alert>
          ) : null}
        </Stack>
      </Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 2, py: 1.25, borderTop: 1, borderColor: 'divider', justifyContent: 'flex-end' }}
      >
        <Button
          variant="contained"
          size="small"
          onClick={() => void handleSave()}
          disabled={busy || !liveAvailable}
        >
          Save
        </Button>
        <Button onClick={handleCancel} disabled={busy} size="small">
          Cancel
        </Button>
      </Stack>
    </Paper>
  );
}

export default memo(CameraSettingDialogImpl);
