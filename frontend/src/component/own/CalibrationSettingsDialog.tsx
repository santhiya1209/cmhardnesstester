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
import { useSaveCalibrationSettings } from '@/hooks/mutations/useSaveCalibrationSettings';
import { useCalibrationSettings } from '@/hooks/queries/useCalibrationSettings';
import type {
  CalibrationSettings,
  CalibrationSettingsSavePayload,
} from '@/types/calibrationSettings';

const OBJECTIVE_OPTIONS = ['2.5X', '5X', '10X', '20X', '40X', '50X'] as const;

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
};

type FormState = {
  objective: string;
  pixelToMicron: string;
};

const DEFAULT_FORM_STATE: FormState = {
  objective: '10X',
  pixelToMicron: '1',
};

function toFormState(settings: CalibrationSettings | null): FormState {
  if (!settings) {
    return DEFAULT_FORM_STATE;
  }

  return {
    objective: settings.objective,
    pixelToMicron: String(settings.pixelToMicron),
  };
}

function toPayload(formState: FormState): CalibrationSettingsSavePayload | null {
  const pixelToMicron = Number(formState.pixelToMicron.trim());

  if (!Number.isFinite(pixelToMicron) || pixelToMicron <= 0) {
    return null;
  }

  return {
    objective: formState.objective,
    pixelToMicron,
  };
}

function CalibrationSettingsDialogImpl({ open, onClose, onStatusChange }: Props) {
  const { data, error: loadError, loading, refetch } = useCalibrationSettings();
  const { error: saveError, saveCalibrationSettings, saving } = useSaveCalibrationSettings();
  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM_STATE);
  const [showValidationError, setShowValidationError] = useState(false);

  const persistedFormState = useMemo(() => toFormState(data), [data]);
  const payload = useMemo(() => toPayload(formState), [formState]);
  const validationError =
    showValidationError && payload === null
      ? 'Please enter a valid calibration value before saving.'
      : null;
  const errorMessage = loadError ?? saveError ?? validationError;
  const busy = loading || saving;

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

  const handleObjectiveChange = useCallback((event: SelectChangeEvent) => {
    const value = event.target.value;
    setShowValidationError(false);
    setFormState((current) => ({
      ...current,
      objective: value,
    }));
  }, []);

  const handlePixelToMicronChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setShowValidationError(false);
    setFormState((current) => ({
      ...current,
      pixelToMicron: value,
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!payload) {
      setShowValidationError(true);
      return;
    }

    await saveCalibrationSettings({
      id: data?.id,
      values: payload,
    });

    onStatusChange?.('Calibration settings saved.');
    onClose();
  }, [data?.id, onClose, onStatusChange, payload, saveCalibrationSettings]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Calibration</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 6 }}>
            <Typography variant="caption">Objective</Typography>
            <FormControl fullWidth size="small">
              <Select value={formState.objective} disabled={busy} onChange={handleObjectiveChange}>
                {OBJECTIVE_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6 }}>
            <Typography variant="caption">Pixel To Micron</Typography>
            <TextField
              fullWidth
              size="small"
              type="number"
              value={formState.pixelToMicron}
              disabled={busy}
              onChange={handlePixelToMicronChange}
              slotProps={{ htmlInput: { min: 0, step: 'any' } }}
            />
          </Grid>
        </Grid>

        {data?.calibrationDate ? (
          <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'text.secondary' }}>
            Last calibrated on{' '}
            {new Intl.DateTimeFormat('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(data.calibrationDate))}
            .
          </Typography>
        ) : null}

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

export default memo(CalibrationSettingsDialogImpl);
