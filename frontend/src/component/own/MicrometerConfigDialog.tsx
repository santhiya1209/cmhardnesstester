import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useMicrometerConfig } from '@/hooks/queries/useMicrometerConfig';
import { useSaveMicrometerConfig } from '@/hooks/mutations/useSaveMicrometerConfig';
import { DEFAULT_MICROMETER_CONFIG } from '@/types/micrometerConfig';
import { listSerialPorts } from '@/api/serialPort';
import type { SerialPortInfo } from '@/types/serial';
import { tokens } from '@/theme/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
  onSaved?: (enabled: boolean) => void;
};

function MicrometerConfigDialogImpl({ open, onClose, onStatusChange, onSaved }: Props) {
  const { data, error: loadError, loading, refetch } = useMicrometerConfig();
  const { saveMicrometerConfig, saving, error: saveError } = useSaveMicrometerConfig();
  const [enabled, setEnabled] = useState<boolean>(DEFAULT_MICROMETER_CONFIG.enabled);
  const [comPort, setComPort] = useState<string>('');
  const [availablePorts, setAvailablePorts] = useState<SerialPortInfo[]>([]);
  const [portsError, setPortsError] = useState<string | null>(null);
  // Drag offset relative to the dialog's centered default position. Reset on
  // every open so the popup re-centers if the user closes and re-opens.
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);
  const paperRef = useRef<HTMLDivElement | null>(null);

  const busy = loading || saving;
  const errorMessage = loadError ?? saveError;

  useEffect(() => {
    if (open) {
      void refetch();
      setDragOffset({ x: 0, y: 0 });
      void listSerialPorts().then((reply) => {
        if (reply.ok) {
          setAvailablePorts(reply.ports);
          setPortsError(null);
        } else {
          setAvailablePorts([]);
          setPortsError(reply.error || 'Failed to enumerate serial ports.');
        }
      });
    }
  }, [open, refetch]);

  useEffect(() => {
    if (open && !loading) {
      setEnabled(data?.enabled ?? DEFAULT_MICROMETER_CONFIG.enabled);
      setComPort(data?.comPort ?? '');
    }
  }, [data, loading, open]);

  // Surface a clear hint when the saved port no longer exists in the live
  // OS-reported list (operator unplugged the USB-serial cable, swapped
  // adapters, etc.). Otherwise the silent fall-through looks like the
  // setting was lost.
  const savedPortMissing =
    enabled && !!comPort && availablePorts.length > 0 &&
    !availablePorts.some((port) => port.path === comPort);

  const clampOffset = useCallback((nextX: number, nextY: number) => {
    const paper = paperRef.current;
    if (!paper) return { x: nextX, y: nextY };
    const rect = paper.getBoundingClientRect();
    // Translate is applied on top of the MUI-centered position, so the
    // current rect already reflects (centeredX + dragOffset.x). To clamp we
    // bound the delta against the viewport: how far can the rect move in
    // each direction before its edge leaves the window?
    const currentLeft = rect.left;
    const currentTop = rect.top;
    const deltaX = nextX - dragOffset.x;
    const deltaY = nextY - dragOffset.y;
    const projectedLeft = currentLeft + deltaX;
    const projectedTop = currentTop + deltaY;
    const minLeft = 0;
    const minTop = 0;
    const maxLeft = window.innerWidth - rect.width;
    const maxTop = window.innerHeight - rect.height;
    const clampedLeft = Math.min(Math.max(projectedLeft, minLeft), Math.max(minLeft, maxLeft));
    const clampedTop = Math.min(Math.max(projectedTop, minTop), Math.max(minTop, maxTop));
    return {
      x: nextX + (clampedLeft - projectedLeft),
      y: nextY + (clampedTop - projectedTop),
    };
  }, [dragOffset.x, dragOffset.y]);

  const handleTitlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // Don't start a drag from interactive elements that may live in the
      // header in the future (close button, etc.). Only the title bar's own
      // surface should grab the pointer.
      const target = event.target as HTMLElement;
      if (target.closest('button, input, a, [role="button"]')) return;
      dragStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffsetX: dragOffset.x,
        startOffsetY: dragOffset.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [dragOffset.x, dragOffset.y]
  );

  const handleTitlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const nextX = state.startOffsetX + (event.clientX - state.startClientX);
      const nextY = state.startOffsetY + (event.clientY - state.startClientY);
      const clamped = clampOffset(nextX, nextY);
      setDragOffset(clamped);
    },
    [clampOffset]
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      dragStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [dragOffset.x, dragOffset.y]
  );

  const handleSave = useCallback(async () => {
    try {
      const trimmedPort = comPort.trim();
      const persistedPort = trimmedPort.length > 0 ? trimmedPort : null;
      await saveMicrometerConfig({
        id: data?.id,
        values: {
          enabled,
          comPort: persistedPort,
        },
      });
      onStatusChange?.(
        enabled
          ? persistedPort
            ? `Micrometer enabled on ${persistedPort}.`
            : 'Micrometer enabled â€” select a COM port to connect.'
          : 'Micrometer disabled.'
      );
      onSaved?.(enabled);
      onClose();
    } catch {
      // surfaced via saveError
    }
  }, [comPort, data?.id, enabled, onClose, onSaved, onStatusChange, saveMicrometerConfig]);

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          ref: paperRef,
          style: {
            transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
          },
        },
      }}
    >
      <DialogTitle
        onPointerDown={handleTitlePointerDown}
        onPointerMove={handleTitlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        sx={{
          bgcolor: tokens.accent.base,
          color: '#FFFFFF',
          py: 1.25,
          cursor: dragStateRef.current ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        Micrometer Setting
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={2}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={enabled}
                  onChange={(event) => {
                    if (event.target.checked) setEnabled(true);
                  }}
                  disabled={busy}
                />
              }
              label="Enable"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={!enabled}
                  onChange={(event) => {
                    if (event.target.checked) setEnabled(false);
                  }}
                  disabled={busy}
                />
              }
              label="Disable"
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Enable: the live micrometer reading is frozen into each measurement row at save time.
            Disable: the Depth column accepts manual entry per row.
          </Typography>
          <FormControl size="small" sx={{ flex: 1 }} disabled={busy || !enabled}>
            <InputLabel id="micrometer-com-port-label">COM Port</InputLabel>
            <Select
              labelId="micrometer-com-port-label"
              label="COM Port"
              value={comPort}
              displayEmpty
              onChange={(event: SelectChangeEvent) => setComPort(event.target.value)}
            >
              <MenuItem value="">
                <em>(none)</em>
              </MenuItem>
              {comPort && !availablePorts.some((port) => port.path === comPort) ? (
                <MenuItem value={comPort}>{`${comPort} â€” not detected`}</MenuItem>
              ) : null}
              {availablePorts.map((port) => (
                <MenuItem key={port.path} value={port.path}>
                  {port.friendlyName
                    ? `${port.path} â€” ${port.friendlyName}`
                    : port.manufacturer
                      ? `${port.path} â€” ${port.manufacturer}`
                      : port.path}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {enabled && !comPort ? (
            <Alert severity="info" sx={{ py: 0.5 }}>
              Select micrometer COM port.
            </Alert>
          ) : null}
          {savedPortMissing ? (
            <Alert severity="warning" sx={{ py: 0.5 }}>
              {`Micrometer port missing: ${comPort} not detected.`}
            </Alert>
          ) : null}
          {portsError ? (
            <Alert severity="warning" sx={{ py: 0.5 }}>
              {`Port list unavailable: ${portsError}`}
            </Alert>
          ) : null}
        </Stack>

        {errorMessage ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={() => void handleSave()} disabled={busy}>
          Save
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(MicrometerConfigDialogImpl);
