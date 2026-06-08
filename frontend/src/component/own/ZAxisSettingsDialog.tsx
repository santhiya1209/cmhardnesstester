import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import {
  previewZAxisImageSelection,
  revertZAxisSettings,
  saveZAxisSettings,
} from '@/api/xyzPlatform';
import { useZAxisSettings } from '@/hooks/queries/useZAxisSettings';
import {
  IMAGE_SELECTION_OPTIONS,
  type ImageSelection,
  type ZAxisSettings,
  type ZAxisSettingsPayload,
} from '@/types/zAxisSettings';
import { tokens } from '@/theme/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
};

// Numeric fields are kept as strings while editing (clean typing); they are
// parsed + validated on Preview/Confirm. Booleans/selection stay typed.
type FormState = {
  reverseDirection: boolean;
  pulsePerMm: string;
  stepDistanceMm: string;
  hasEmptyTrip: boolean;
  upwardEmptyTripMm: string;
  downwardEmptyTripMm: string;
  imageSelection: ImageSelection;
};

function toFormState(settings: ZAxisSettings): FormState {
  return {
    reverseDirection: settings.reverseDirection,
    pulsePerMm: String(settings.pulsePerMm),
    stepDistanceMm: String(settings.stepDistanceMm),
    hasEmptyTrip: settings.hasEmptyTrip,
    upwardEmptyTripMm: String(settings.upwardEmptyTripMm),
    downwardEmptyTripMm: String(settings.downwardEmptyTripMm),
    imageSelection: settings.imageSelection,
  };
}

// Mirror the backend zod constraints so the user gets immediate feedback; the
// backend remains the authoritative validator.
function toPayload(form: FormState): ZAxisSettingsPayload | { error: string } {
  const pulsePerMm = Number(form.pulsePerMm);
  const stepDistanceMm = Number(form.stepDistanceMm);
  const upwardEmptyTripMm = Number(form.upwardEmptyTripMm);
  const downwardEmptyTripMm = Number(form.downwardEmptyTripMm);

  if (!Number.isInteger(pulsePerMm) || pulsePerMm <= 0) {
    return { error: 'Pulse Per mm must be a positive integer.' };
  }
  if (!Number.isFinite(stepDistanceMm) || stepDistanceMm <= 0) {
    return { error: 'Step Distance (mm) must be greater than 0.' };
  }
  if (!Number.isFinite(upwardEmptyTripMm) || upwardEmptyTripMm < 0) {
    return { error: 'Upward Empty Trip (mm) must be 0 or greater.' };
  }
  if (!Number.isFinite(downwardEmptyTripMm) || downwardEmptyTripMm < 0) {
    return { error: 'Downward Empty Trip (mm) must be 0 or greater.' };
  }
  return {
    reverseDirection: form.reverseDirection,
    pulsePerMm,
    stepDistanceMm,
    hasEmptyTrip: form.hasEmptyTrip,
    upwardEmptyTripMm,
    downwardEmptyTripMm,
    imageSelection: form.imageSelection,
  };
}

const TITLE_SX = { bgcolor: tokens.accent.base, color: '#FFFFFF', py: 1.25 };
const SECTION_PAPER_SX = { p: 2, mb: 1.5 };
const SECTION_TITLE_SX = { color: tokens.status.success, fontWeight: 600, mb: 1 };
const FIELD_LABEL_SX = { minWidth: 150 };

function ZAxisSettingsDialogImpl({ open, onClose, onStatusChange }: Props) {
  const { data, loading, error: loadError, refetch } = useZAxisSettings();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Whether an in-memory preview was applied to the backend during this session,
  // so Cancel knows to revert it.
  const previewAppliedRef = useRef(false);

  const errorMessage = actionError ?? loadError;

  useEffect(() => {
    if (open) {
      previewAppliedRef.current = false;
      void refetch();
    }
  }, [open, refetch]);

  useEffect(() => {
    if (open && data) {
      setForm(toFormState(data));
      setActionError(null);
    }
  }, [data, open]);

  const handleBool = useCallback(
    (field: 'reverseDirection' | 'hasEmptyTrip') => (_e: unknown, checked: boolean) => {
      setForm((current) => (current ? { ...current, [field]: checked } : current));
    },
    []
  );

  const handleNumber = useCallback(
    (field: 'pulsePerMm' | 'stepDistanceMm' | 'upwardEmptyTripMm' | 'downwardEmptyTripMm') =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setActionError(null);
        setForm((current) => (current ? { ...current, [field]: value } : current));
      },
    []
  );

  const handleImageSelection = useCallback((event: SelectChangeEvent<number>) => {
    const value = Number(event.target.value) as ImageSelection;
    setForm((current) => (current ? { ...current, imageSelection: value } : current));
  }, []);

  // Preview applies ONLY the image-selection to the backend (in-memory). It never
  // moves Z hardware or sends a serial command.
  const handlePreview = useCallback(async () => {
    if (!form) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await previewZAxisImageSelection(form.imageSelection);
      if (result.ok) {
        previewAppliedRef.current = true;
        onStatusChange?.(`Z image selection preview: ${form.imageSelection}%.`);
      } else {
        setActionError(result.message ?? result.error ?? 'Preview failed.');
      }
    } finally {
      setBusy(false);
    }
  }, [form, onStatusChange]);

  const handleConfirm = useCallback(async () => {
    if (!form) return;
    const payload = toPayload(form);
    if ('error' in payload) {
      setActionError(payload.error);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result = await saveZAxisSettings(payload);
      if (result.ok) {
        previewAppliedRef.current = false;
        onStatusChange?.('Z Axis settings saved.');
        onClose();
      } else {
        setActionError(result.message ?? result.error ?? 'Save failed.');
      }
    } finally {
      setBusy(false);
    }
  }, [form, onClose, onStatusChange]);

  const handleCancel = useCallback(async () => {
    // Discard any in-memory preview so the backend reverts to the last saved state.
    if (previewAppliedRef.current) {
      previewAppliedRef.current = false;
      await revertZAxisSettings();
    }
    onClose();
  }, [onClose]);

  const disabled = busy || loading || !form;

  return (
    <Dialog open={open} onClose={disabled ? undefined : () => void handleCancel()} fullWidth maxWidth="sm">
      <DialogTitle sx={TITLE_SX}>Z Axis Settings</DialogTitle>
      <DialogContent dividers>
        <Paper variant="outlined" sx={SECTION_PAPER_SX}>
          <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
            Z Axis
          </Typography>
          <Stack spacing={1.5}>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={form?.reverseDirection ?? false}
                  onChange={handleBool('reverseDirection')}
                  disabled={disabled}
                />
              }
              label="Reverse Direction"
            />
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" sx={FIELD_LABEL_SX}>
                Pulse Per mm
              </Typography>
              <TextField
                fullWidth
                size="small"
                type="number"
                value={form?.pulsePerMm ?? ''}
                onChange={handleNumber('pulsePerMm')}
                disabled={disabled}
                slotProps={{ htmlInput: { min: 1, step: 1 } }}
              />
            </Stack>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" sx={FIELD_LABEL_SX}>
                Step Distance (mm)
              </Typography>
              <TextField
                fullWidth
                size="small"
                type="number"
                value={form?.stepDistanceMm ?? ''}
                onChange={handleNumber('stepDistanceMm')}
                disabled={disabled}
                slotProps={{ htmlInput: { min: 0, step: 0.001 } }}
              />
            </Stack>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={SECTION_PAPER_SX}>
          <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
            Empty Trip
          </Typography>
          <Stack spacing={1.5}>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={form?.hasEmptyTrip ?? false}
                  onChange={handleBool('hasEmptyTrip')}
                  disabled={disabled}
                />
              }
              label="Has Empty Trip"
            />
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" sx={FIELD_LABEL_SX}>
                Upward Empty Trip (mm)
              </Typography>
              <TextField
                fullWidth
                size="small"
                type="number"
                value={form?.upwardEmptyTripMm ?? ''}
                onChange={handleNumber('upwardEmptyTripMm')}
                disabled={disabled}
                slotProps={{ htmlInput: { min: 0, step: 0.0001 } }}
              />
            </Stack>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" sx={FIELD_LABEL_SX}>
                Downward Empty Trip (mm)
              </Typography>
              <TextField
                fullWidth
                size="small"
                type="number"
                value={form?.downwardEmptyTripMm ?? ''}
                onChange={handleNumber('downwardEmptyTripMm')}
                disabled={disabled}
                slotProps={{ htmlInput: { min: 0, step: 0.0001 } }}
              />
            </Stack>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={SECTION_PAPER_SX}>
          <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
            Image Selection
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={FIELD_LABEL_SX}>
              Image Selection
            </Typography>
            <FormControl size="small" sx={{ flex: 1 }}>
              <Select
                value={form?.imageSelection ?? 40}
                onChange={handleImageSelection}
                disabled={disabled}
              >
                {IMAGE_SELECTION_OPTIONS.map((opt) => (
                  <MenuItem key={opt} value={opt}>
                    {opt}%
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Paper>

        {errorMessage ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {errorMessage}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={() => void handlePreview()} disabled={disabled}>
          Preview
        </Button>
        <Button variant="contained" onClick={() => void handleConfirm()} disabled={disabled}>
          Confirm
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={() => void handleCancel()} disabled={busy}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(ZAxisSettingsDialogImpl);
