import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useMicrometerConfig } from '@/hooks/queries/useMicrometerConfig';
import { useSaveMicrometerConfig } from '@/hooks/mutations/useSaveMicrometerConfig';
import { DEFAULT_MICROMETER_CONFIG } from '@/types/micrometerConfig';
import { colors } from '@/theme/theme';

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
    }
  }, [open, refetch]);

  useEffect(() => {
    if (open && !loading) {
      setEnabled(data?.enabled ?? DEFAULT_MICROMETER_CONFIG.enabled);
    }
  }, [data, loading, open]);

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
      // eslint-disable-next-line no-console
      console.log(
        `[micrometer-dialog-drag-start] clientX=${event.clientX} clientY=${event.clientY} offsetX=${dragOffset.x} offsetY=${dragOffset.y}`
      );
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
      // eslint-disable-next-line no-console
      console.log(
        `[micrometer-dialog-drag-move] x=${clamped.x.toFixed(0)} y=${clamped.y.toFixed(0)}`
      );
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
      // eslint-disable-next-line no-console
      console.log(
        `[micrometer-dialog-drag-end] x=${dragOffset.x.toFixed(0)} y=${dragOffset.y.toFixed(0)}`
      );
    },
    [dragOffset.x, dragOffset.y]
  );

  const handleSave = useCallback(async () => {
    try {
      await saveMicrometerConfig({ id: data?.id, values: { enabled } });
      // eslint-disable-next-line no-console
      console.log(`[micrometer-config] enabled=${enabled}`);
      onStatusChange?.(`Micrometer ${enabled ? 'enabled' : 'disabled'}.`);
      onSaved?.(enabled);
      onClose();
    } catch {
      // surfaced via saveError
    }
  }, [data?.id, enabled, onClose, onSaved, onStatusChange, saveMicrometerConfig]);

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
          bgcolor: colors.headingPrimary,
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
