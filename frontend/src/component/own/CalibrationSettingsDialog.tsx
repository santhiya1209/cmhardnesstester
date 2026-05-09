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
import { findCalibrationForObjective, normalizeObjectiveName } from '@/utils/manualMeasure';
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

function toFormState(settings: CalibrationSettings | null, fallbackObjective: string): FormState {
  if (!settings) {
    return { objective: fallbackObjective, pixelToMicron: '' };
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
    objective: normalizeObjectiveName(formState.objective),
    pixelToMicron,
    umPerPixel: pixelToMicron,
    pixelPerMm: 1000 / pixelToMicron,
    active: true,
  };
}

function CalibrationSettingsDialogImpl({ open, onClose, onStatusChange }: Props) {
  const { items, error: loadError, loading, refetch } = useCalibrationSettings();
  const { error: saveError, saveCalibrationSettings, saving } = useSaveCalibrationSettings();
  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM_STATE);
  const [showValidationError, setShowValidationError] = useState(false);

  const recordForObjective = useMemo(
    () => findCalibrationForObjective(items, formState.objective),
    [items, formState.objective]
  );

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
      // When dialog opens, prefer the most-recently-edited record's objective
      // so the user lands on whatever they last calibrated.
      const last = [...items].sort(
        (l, r) => Date.parse(r.updatedAt) - Date.parse(l.updatedAt)
      )[0] ?? null;
      setFormState(toFormState(last, DEFAULT_FORM_STATE.objective));
      setShowValidationError(false);
    }
  }, [items, loading, open]);

  const handleObjectiveChange = useCallback(
    (event: SelectChangeEvent) => {
      const value = event.target.value;
      setShowValidationError(false);
      const existing = findCalibrationForObjective(items, value);
      setFormState({
        objective: value,
        pixelToMicron: existing ? String(existing.pixelToMicron) : '',
      });
    },
    [items]
  );

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

    // Update the existing record FOR THIS OBJECTIVE only — never touch another
    // objective's record. If none exists, create a fresh one.
    await saveCalibrationSettings({
      id: recordForObjective?.id,
      values: payload,
    });

    // eslint-disable-next-line no-console
    console.log(
      `[calibration-save] objective=${payload.objective} umPerPixel=${payload.pixelToMicron}`
    );

    onStatusChange?.(`Calibration saved for ${payload.objective}.`);
    await refetch();
    onClose();
  }, [onClose, onStatusChange, payload, recordForObjective?.id, refetch, saveCalibrationSettings]);

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
            <Typography variant="caption">Microns Per Pixel</Typography>
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

        {recordForObjective?.calibrationDate ? (
          <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'text.secondary' }}>
            {recordForObjective.objective} last calibrated on{' '}
            {new Intl.DateTimeFormat('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(recordForObjective.calibrationDate))}
            .
          </Typography>
        ) : (
          <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'warning.main' }}>
            No calibration saved yet for {formState.objective}.
          </Typography>
        )}

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
