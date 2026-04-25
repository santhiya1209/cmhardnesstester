import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useSaveAutoMeasureSettings } from '@/hooks/mutations/useSaveAutoMeasureSettings';
import { useAutoMeasureSettings } from '@/hooks/queries/useAutoMeasureSettings';
import type {
  AutoMeasureSettings,
  AutoMeasureSettingsPayload,
} from '@/types/autoMeasureSettings';

const THRESHOLD_MODE_OPTIONS = ['adaptive', 'otsu', 'manual'] as const;
const NUMBER_SLOT_PROPS = { htmlInput: { min: 0, step: 'any' } } as const;
const INTEGER_SLOT_PROPS = { htmlInput: { min: 1, step: 1 } } as const;

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
};

type FormState = {
  claheClipLimit: string;
  blurKernel: string;
  thresholdMode: string;
  morphKernel: string;
  minGradient: string;
  confidenceThreshold: string;
};

const DEFAULT_FORM_STATE: FormState = {
  claheClipLimit: '2.5',
  blurKernel: '3',
  thresholdMode: 'adaptive',
  morphKernel: '5',
  minGradient: '0.2',
  confidenceThreshold: '0.85',
};

function toFormState(settings: AutoMeasureSettings | null): FormState {
  if (!settings) {
    return DEFAULT_FORM_STATE;
  }

  return {
    claheClipLimit: String(settings.claheClipLimit),
    blurKernel: String(settings.blurKernel),
    thresholdMode: settings.thresholdMode,
    morphKernel: String(settings.morphKernel),
    minGradient: String(settings.minGradient),
    confidenceThreshold: String(settings.confidenceThreshold),
  };
}

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeNumber(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toPayload(formState: FormState): AutoMeasureSettingsPayload | null {
  const claheClipLimit = parsePositiveNumber(formState.claheClipLimit);
  const blurKernel = parsePositiveInteger(formState.blurKernel);
  const morphKernel = parsePositiveInteger(formState.morphKernel);
  const minGradient = parseNonNegativeNumber(formState.minGradient);
  const confidenceThreshold = Number(formState.confidenceThreshold.trim());

  if (
    claheClipLimit === null ||
    blurKernel === null ||
    morphKernel === null ||
    minGradient === null ||
    !Number.isFinite(confidenceThreshold) ||
    confidenceThreshold < 0 ||
    confidenceThreshold > 1
  ) {
    return null;
  }

  return {
    claheClipLimit,
    blurKernel,
    thresholdMode: formState.thresholdMode,
    morphKernel,
    minGradient,
    confidenceThreshold,
  };
}

function AutoMeasureSettingsDialogImpl({ open, onClose, onStatusChange }: Props) {
  const { data, error: loadError, loading, refetch } = useAutoMeasureSettings();
  const { error: saveError, saveAutoMeasureSettings, saving } = useSaveAutoMeasureSettings();
  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM_STATE);
  const [showValidationError, setShowValidationError] = useState(false);

  const persistedFormState = useMemo(() => toFormState(data), [data]);
  const payload = useMemo(() => toPayload(formState), [formState]);
  const validationError =
    showValidationError && payload === null
      ? 'Please enter valid auto measure settings values before saving.'
      : null;
  const errorMessage = loadError ?? saveError ?? validationError;

  useEffect(() => {
    if (open) {
      void refetch();
    }
  }, [open, refetch]);

  useEffect(() => {
    if (open && !loading) {
      setFormState(persistedFormState);
      setShowValidationError(false);
    }
  }, [loading, open, persistedFormState]);

  const handleFieldChange = useCallback(
    (field: keyof FormState) =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setShowValidationError(false);
        setFormState((current) => ({
          ...current,
          [field]: value,
        }));
      },
    []
  );

  const handleThresholdModeChange = useCallback((event: SelectChangeEvent) => {
    const value = event.target.value;
    setShowValidationError(false);
    setFormState((current) => ({
      ...current,
      thresholdMode: value,
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!payload) {
      setShowValidationError(true);
      return;
    }

    await saveAutoMeasureSettings({
      id: data?.id,
      values: payload,
    });

    onStatusChange?.('Auto measure settings saved.');
    onClose();
  }, [data?.id, onClose, onStatusChange, payload, saveAutoMeasureSettings]);

  const busy = loading || saving;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Auto Measure Setting</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 6 }}>
            <Typography variant="caption">CLAHE Clip Limit</Typography>
            <TextField
              fullWidth
              size="small"
              type="number"
              value={formState.claheClipLimit}
              disabled={busy}
              onChange={handleFieldChange('claheClipLimit')}
              slotProps={{ htmlInput: NUMBER_SLOT_PROPS.htmlInput }}
            />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <Typography variant="caption">Blur Kernel</Typography>
            <TextField
              fullWidth
              size="small"
              type="number"
              value={formState.blurKernel}
              disabled={busy}
              onChange={handleFieldChange('blurKernel')}
              slotProps={{ htmlInput: INTEGER_SLOT_PROPS.htmlInput }}
            />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <Typography variant="caption">Threshold Mode</Typography>
            <FormControl fullWidth size="small">
              <Select value={formState.thresholdMode} disabled={busy} onChange={handleThresholdModeChange}>
                {THRESHOLD_MODE_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6 }}>
            <Typography variant="caption">Morph Kernel</Typography>
            <TextField
              fullWidth
              size="small"
              type="number"
              value={formState.morphKernel}
              disabled={busy}
              onChange={handleFieldChange('morphKernel')}
              slotProps={{ htmlInput: INTEGER_SLOT_PROPS.htmlInput }}
            />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <Typography variant="caption">Min Gradient</Typography>
            <TextField
              fullWidth
              size="small"
              type="number"
              value={formState.minGradient}
              disabled={busy}
              onChange={handleFieldChange('minGradient')}
              slotProps={{ htmlInput: NUMBER_SLOT_PROPS.htmlInput }}
            />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <Typography variant="caption">Confidence Threshold</Typography>
            <TextField
              fullWidth
              size="small"
              type="number"
              value={formState.confidenceThreshold}
              disabled={busy}
              onChange={handleFieldChange('confidenceThreshold')}
              slotProps={{ htmlInput: { min: 0, max: 1, step: 'any' } }}
            />
          </Grid>
        </Grid>

        {errorMessage ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            void handleSave();
          }}
          disabled={busy}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(AutoMeasureSettingsDialogImpl);
