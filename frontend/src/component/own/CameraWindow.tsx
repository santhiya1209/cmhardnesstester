import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { closeCamera } from '@/api/closeCamera';
import { openCamera } from '@/api/openCamera';
import { startCameraStream } from '@/api/startCameraStream';
import { stopCameraStream } from '@/api/stopCameraStream';
import { useCameraStatus } from '@/hooks/queries/useCameraStatus';
import { useCameraStream } from '@/hooks/useCameraStream';
import { colors } from '@/theme/theme';

const ROOT_SX: SxProps<Theme> = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  bgcolor: colors.background,
};

const VIEW_SX: SxProps<Theme> = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
  bgcolor: '#000',
  border: 1,
  borderColor: colors.border,
  m: 1,
};

const TOOLBAR_SX: SxProps<Theme> = {
  px: 1,
  py: 0.5,
  bgcolor: colors.panel,
  borderBottom: 1,
  borderColor: colors.border,
};

const COORD_BAR_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  px: 2,
  py: 0.25,
  bgcolor: colors.panel,
  fontSize: 12,
  borderTop: 1,
  borderColor: colors.border,
};

const COORD_VALUE_SX: SxProps<Theme> = {
  fontFamily:
    "'Cascadia Mono', 'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace",
  fontVariantNumeric: 'tabular-nums',
  fontSize: 12,
  color: colors.textPrimary,
  letterSpacing: 0.2,
};

const CANVAS_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
  objectFit: 'contain',
  imageRendering: 'pixelated',
};

type Props = {
  x?: number;
  y?: number;
};

function statusLabel(o: { sdkLoaded: boolean; open: boolean; streaming: boolean }) {
  if (!o.sdkLoaded) return { label: 'SDK not loaded', color: 'warning' as const };
  if (o.streaming) return { label: 'Streaming', color: 'success' as const };
  if (o.open) return { label: 'Connected', color: 'primary' as const };
  return { label: 'Idle', color: 'default' as const };
}

function CameraWindowImpl({ x = 570, y = 339 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { attachCanvas } = useCameraStream();
  const { status, refetch } = useCameraStatus();
  const [busy, setBusy] = useState<null | 'open' | 'close' | 'start' | 'stop'>(null);
  const [error, setError] = useState<string | null>(null);

  // Attach the canvas to the worker exactly once when the element mounts.
  useEffect(() => {
    if (canvasRef.current) attachCanvas(canvasRef.current);
  }, [attachCanvas]);

  const handle = useCallback(
    async (
      key: 'open' | 'close' | 'start' | 'stop',
      fn: () => Promise<{ ok: boolean; error?: string; message?: string }>
    ) => {
      setBusy(key);
      setError(null);
      try {
        const reply = await fn();
        if (!reply.ok) {
          setError(reply.error ? `${reply.error}: ${reply.message ?? ''}`.trim() : reply.message ?? 'Failed');
        }
        await refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [refetch]
  );

  const tag = statusLabel(status);

  return (
    <Box sx={ROOT_SX}>
      <Box sx={{ ...(TOOLBAR_SX as object), display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button
          size="small"
          variant="contained"
          onClick={() => void handle('open', () => openCamera(0))}
          disabled={busy !== null || status.open}
        >
          Open Device
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={() => void handle('close', closeCamera)}
          disabled={busy !== null || !status.open}
        >
          Close
        </Button>
        <Button
          size="small"
          variant="contained"
          color="success"
          onClick={() => void handle('start', startCameraStream)}
          disabled={busy !== null || !status.open || status.streaming}
        >
          Start Stream
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          onClick={() => void handle('stop', stopCameraStream)}
          disabled={busy !== null || !status.streaming}
        >
          Stop Stream
        </Button>
        <Box sx={{ flex: 1 }} />
        <Chip size="small" label={tag.label} color={tag.color} variant="outlined" />
        {status.width > 0 ? (
          <Typography variant="caption" sx={{ color: colors.textMuted }}>
            {status.width}×{status.height}
          </Typography>
        ) : null}
      </Box>

      <Box sx={VIEW_SX}>
        <canvas ref={canvasRef} style={CANVAS_STYLE} />
        {error ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              p: 2,
              color: '#fff',
              bgcolor: 'rgba(0,0,0,0.55)',
              textAlign: 'center',
            }}
          >
            <Typography variant="body2">{error}</Typography>
          </Box>
        ) : null}
      </Box>

      <Box sx={COORD_BAR_SX}>
        <Typography component="span" sx={COORD_VALUE_SX}>X: {x}</Typography>
        <Typography component="span" sx={COORD_VALUE_SX}>Y: {y}</Typography>
      </Box>
    </Box>
  );
}

export default memo(CameraWindowImpl);
