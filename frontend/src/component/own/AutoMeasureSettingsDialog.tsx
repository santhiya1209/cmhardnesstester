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

import { useAutoMeasureSettings } from '@/hooks/queries/useAutoMeasureSettings';
import { useSaveAutoMeasureSettings } from '@/hooks/mutations/useSaveAutoMeasureSettings';
import {
  DEFAULT_AUTO_MEASURE_SETTINGS,
  IMAGE_TYPE_OPTIONS,
  OBJECTIVE_FOR_MEASURE_OPTIONS,
  THRESHOLD_MODE_OPTIONS,
  normalizeAutoMeasureSettings,
  type AutoMeasureSettings,
  type AutoMeasureSettingsPayload,
  type ImageType,
  type ObjectiveForMeasure,
  type ThresholdMode,
} from '@/types/autoMeasureSettings';
import { colors } from '@/theme/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  onPreviewChange?: (settings: AutoMeasureSettingsPayload) => void;
  onSaved?: () => void;
  onStatusChange?: (message: string) => void;
};

function toFormState(settings: AutoMeasureSettings | null): AutoMeasureSettingsPayload {
  return normalizeAutoMeasureSettings(settings);
}

const TITLE_SX = { bgcolor: colors.headingPrimary, color: '#FFFFFF', py: 1.25 };
const SECTION_HEADING_SX = { color: colors.headingSecondary, fontWeight: 600, mb: 1 };
const ROW_LABEL_SX = { minWidth: 110 };
const SLIDER_VALUE_SX = {
  minWidth: 32,
  textAlign: 'right' as const,
  fontVariantNumeric: 'tabular-nums',
};

type SliderField =
  | 'erosionIterations'
  | 'dilationIterations'
  | 'morphologyKernelSize'
  | 'manualThreshold'
  | 'edgeFactor'
  | 'minContourArea'
  | 'maxContourArea'
  | 'centerBias'
  | 'sideFitRoiWidth'
  | 'gradientStrengthFactor';

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

  const busy = loading || saving;
  const errorMessage = loadError ?? saveError;

  useEffect(() => {
    if (open) {
      void refetch();
    }
  }, [open, refetch]);

  useEffect(() => {
    if (open && !loading) {
      setForm(toFormState(data));
    }
  }, [data, loading, open]);

  const updateForm = useCallback(
    (updater: (current: AutoMeasureSettingsPayload) => AutoMeasureSettingsPayload) => {
      setForm((current) => {
        const next = updater(current);
        onPreviewChange?.(next);
        return next;
      });
    },
    [onPreviewChange]
  );

  const handleImageTypeChange = useCallback((event: SelectChangeEvent) => {
    updateForm((current) => ({ ...current, imageType: event.target.value as ImageType }));
  }, [updateForm]);

  const handleObjectiveChange = useCallback((event: SelectChangeEvent) => {
    updateForm((current) => ({
      ...current,
      objectiveForMeasure: event.target.value as ObjectiveForMeasure,
    }));
  }, [updateForm]);

  const handleThresholdModeChange = useCallback((event: SelectChangeEvent) => {
    updateForm((current) => ({
      ...current,
      thresholdMode: event.target.value as ThresholdMode,
    }));
  }, [updateForm]);

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

  const handleSave = useCallback(async () => {
    try {
      await saveAutoMeasureSettings({ id: data?.id, values: form });
      onSaved?.();
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
    max: number,
    step = 1,
    valueLabel?: string
  ) => (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
      <Typography variant="body2" sx={ROW_LABEL_SX}>
        {label}
      </Typography>
      <Slider
        value={form[field]}
        min={min}
        max={max}
        step={step}
        onChange={handleSliderChange(field)}
        disabled={busy}
        sx={{ flex: 1 }}
      />
      <Typography variant="body2" sx={SLIDER_VALUE_SX}>
        {valueLabel ?? form[field]}
      </Typography>
    </Stack>
  );

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={TITLE_SX}>Auto Measure Setting</DialogTitle>
      <DialogContent dividers>
        <Typography variant="h6" sx={{ color: colors.headingPrimary, mb: 1.5 }}>
          Select Irregular Image Type
        </Typography>

        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
          <Typography variant="body2" sx={ROW_LABEL_SX}>
            Image Type
          </Typography>
          <FormControl size="small" sx={{ flex: 1 }}>
            <Select value={form.imageType} onChange={handleImageTypeChange} disabled={busy}>
              {IMAGE_TYPE_OPTIONS.map((opt) => (
                <MenuItem key={opt} value={opt}>
                  {opt}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="body2" sx={ROW_LABEL_SX}>
            Threshold
          </Typography>
          <FormControl size="small" sx={{ flex: 1 }}>
            <Select
              value={form.thresholdMode}
              onChange={handleThresholdModeChange}
              disabled={busy}
            >
              {THRESHOLD_MODE_OPTIONS.map((opt) => (
                <MenuItem key={opt} value={opt}>
                  {opt.toUpperCase()}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        {sliderRow('Manual Threshold', 'manualThreshold', 0, 255)}
        {sliderRow('Erosion Iter.', 'erosionIterations', 0, 8)}
        {sliderRow('Dilation Iter.', 'dilationIterations', 0, 8)}
        {sliderRow('Morph Kernel', 'morphologyKernelSize', 1, 41, 2)}
        {sliderRow('Edge Factor', 'edgeFactor', 0, 100)}
        {sliderRow('Gradient Factor', 'gradientStrengthFactor', 0, 100)}
        {sliderRow('Side Fit ROI', 'sideFitRoiWidth', 4, 90)}
        {sliderRow('Min Area %', 'minContourArea', 0.001, 10, 0.001, form.minContourArea.toFixed(3))}
        {sliderRow('Max Area %', 'maxContourArea', 0.01, 70, 0.01, form.maxContourArea.toFixed(2))}
        {sliderRow('Center Bias', 'centerBias', 0, 100)}

        <Typography variant="subtitle2" sx={SECTION_HEADING_SX}>
          Auto Measure
        </Typography>
        <Box sx={{ pl: 1, mb: 2 }}>
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
          <Box />
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
        </Box>

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
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(AutoMeasureSettingsDialogImpl);
