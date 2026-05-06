import { memo, useCallback, useEffect, useState } from 'react';
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
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useAutoMeasureSettings } from '@/hooks/queries/useAutoMeasureSettings';
import { useSaveAutoMeasureSettings } from '@/hooks/mutations/useSaveAutoMeasureSettings';
import {
  DEFAULT_AUTO_MEASURE_SETTINGS,
  OBJECTIVE_FOR_MEASURE_OPTIONS,
  SMOOTHING_MAX,
  SMOOTHING_MIN,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  normalizeAutoMeasureSettings,
  type AutoMeasureSettings,
  type AutoMeasureSettingsPayload,
  type ObjectiveForMeasure,
} from '@/types/autoMeasureSettings';
import { colors } from '@/theme/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  onPreviewChange?: (settings: AutoMeasureSettingsPayload) => void;
  onSaved?: (settings: AutoMeasureSettingsPayload) => void;
  onStatusChange?: (message: string) => void;
};

function toFormState(settings: AutoMeasureSettings | null): AutoMeasureSettingsPayload {
  return normalizeAutoMeasureSettings(settings);
}

const TITLE_SX = { bgcolor: colors.headingPrimary, color: '#FFFFFF', py: 1.25 };
const SECTION_HEADING_SX = { color: colors.headingSecondary, fontWeight: 600, mb: 1 };
const ROW_LABEL_SX = { minWidth: 160 };
const SLIDER_VALUE_SX = {
  minWidth: 40,
  textAlign: 'right' as const,
  fontVariantNumeric: 'tabular-nums',
};
const RIGHT_PANEL_DIALOG_PAPER_SX: SxProps<Theme> = {
  position: 'fixed',
  top: 11,
  right: 2,
  m: 0,
  width: 560,
  maxWidth: 'calc(100vw - 32px)',
};

type SliderField = 'smoothing' | 'threshold';

function AutoMeasureSettingsDialogImpl({
  open,
  onClose,
  onPreviewChange,
  onSaved,
  onStatusChange,
}: Props) {
  const { data, error: loadError, loading, refetch } = useAutoMeasureSettings();
  const { error: saveError, saveAutoMeasureSettings, saving } = useSaveAutoMeasureSettings();
  const [form, setForm] = useState<AutoMeasureSettingsPayload>(DEFAULT_AUTO_MEASURE_SETTINGS);
  const [savedBaseline, setSavedBaseline] = useState<AutoMeasureSettingsPayload>(
    DEFAULT_AUTO_MEASURE_SETTINGS
  );

  const busy = loading || saving;
  const errorMessage = loadError ?? saveError;

  useEffect(() => {
    if (open) {
      void refetch();
    }
  }, [open, refetch]);

  useEffect(() => {
    if (open && !loading) {
      const next = toFormState(data);
      setForm(next);
      setSavedBaseline(next);
    }
  }, [data, loading, open]);

  const updateForm = useCallback(
    (updater: (current: AutoMeasureSettingsPayload) => AutoMeasureSettingsPayload) => {
      setForm((current) => {
        const next = normalizeAutoMeasureSettings(updater(current));
        onPreviewChange?.(next);
        return next;
      });
    },
    [onPreviewChange]
  );

  const handleObjectiveChange = useCallback(
    (event: SelectChangeEvent) => {
      updateForm((current) => ({
        ...current,
        objectiveForMeasure: event.target.value as ObjectiveForMeasure,
      }));
    },
    [updateForm]
  );

  const handleSliderChange = useCallback(
    (field: SliderField) => (_e: Event, value: number | number[]) => {
      const next = Array.isArray(value) ? value[0] : value;
      updateForm((current) => ({ ...current, [field]: next }));
    },
    [updateForm]
  );

  const handleCheckboxChange = useCallback(
    (field: 'turretAfterImpress' | 'measureAfterImpress') =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const checked = event.target.checked;
        updateForm((current) => ({ ...current, [field]: checked }));
      },
    [updateForm]
  );

  const handleDefault = useCallback(() => {
    setForm(DEFAULT_AUTO_MEASURE_SETTINGS);
    onPreviewChange?.(DEFAULT_AUTO_MEASURE_SETTINGS);
  }, [onPreviewChange]);

  const handleCancel = useCallback(() => {
    setForm(savedBaseline);
    onClose();
  }, [onClose, savedBaseline]);

  const handleSave = useCallback(async () => {
    try {
      const finalValues = normalizeAutoMeasureSettings(form);
      await saveAutoMeasureSettings({ id: data?.id, values: finalValues });
      setSavedBaseline(finalValues);
      onSaved?.(finalValues);
      onStatusChange?.('Auto measure settings saved.');
      onClose();
    } catch {
      // surfaced via saveError
    }
  }, [data?.id, form, onClose, onSaved, onStatusChange, saveAutoMeasureSettings]);

  const sliderRow = (
    label: string,
    field: SliderField,
    min: number,
    max: number
  ) => (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
      <Typography variant="body2" sx={ROW_LABEL_SX}>
        {label}
      </Typography>
      <Slider
        value={form[field]}
        min={min}
        max={max}
        step={1}
        onChange={handleSliderChange(field)}
        disabled={busy}
        sx={{ flex: 1 }}
      />
      <Typography variant="body2" sx={SLIDER_VALUE_SX}>
        {form[field]}
      </Typography>
    </Stack>
  );

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : handleCancel}
      maxWidth={false}
      slotProps={{ paper: { sx: RIGHT_PANEL_DIALOG_PAPER_SX } }}
    >
      <DialogTitle sx={TITLE_SX}>Auto Measure Setting</DialogTitle>
      <DialogContent dividers>
        <Typography variant="subtitle2" sx={SECTION_HEADING_SX}>
          Auto Measure Correct
        </Typography>

        {sliderRow('Smoothing', 'smoothing', SMOOTHING_MIN, SMOOTHING_MAX)}
        {sliderRow('Threshold', 'threshold', THRESHOLD_MIN, THRESHOLD_MAX)}

        <Typography variant="subtitle2" sx={{ ...SECTION_HEADING_SX, mt: 2 }}>
          Auto Measure
        </Typography>
        <Stack direction="row" spacing={2} sx={{ pl: 1, mb: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={form.turretAfterImpress}
                onChange={handleCheckboxChange('turretAfterImpress')}
                disabled={busy}
              />
            }
            label="Turret After Impress"
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={form.measureAfterImpress}
                onChange={handleCheckboxChange('measureAfterImpress')}
                disabled={busy}
              />
            }
            label="Measure After Impress"
          />
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={ROW_LABEL_SX}>
            Objective For Measure
          </Typography>
          <FormControl size="small" sx={{ flex: 1 }}>
            <Select
              value={form.objectiveForMeasure}
              onChange={handleObjectiveChange}
              disabled={busy}
            >
              {OBJECTIVE_FOR_MEASURE_OPTIONS.map((opt) => (
                <MenuItem key={opt} value={opt}>
                  {opt}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        {errorMessage ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleDefault} disabled={busy}>
          Default
        </Button>
        <Box sx={{ flex: 1 }} />
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

export default memo(AutoMeasureSettingsDialogImpl);
