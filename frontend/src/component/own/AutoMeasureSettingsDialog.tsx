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
  type AutoMeasureSettings,
  type AutoMeasureSettingsPayload,
  type ImageType,
  type ObjectiveForMeasure,
} from '@/types/autoMeasureSettings';
import { colors } from '@/theme/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
};

function toFormState(settings: AutoMeasureSettings | null): AutoMeasureSettingsPayload {
  if (!settings) return DEFAULT_AUTO_MEASURE_SETTINGS;
  return {
    imageType: settings.imageType,
    erosion: settings.erosion,
    dilation: settings.dilation,
    factor: settings.factor,
    turretAfterImpress: settings.turretAfterImpress,
    measureAfterImpress: settings.measureAfterImpress,
    objectiveForMeasure: settings.objectiveForMeasure,
  };
}

const TITLE_SX = { bgcolor: colors.headingPrimary, color: '#FFFFFF', py: 1.25 };
const SECTION_HEADING_SX = { color: colors.headingSecondary, fontWeight: 600, mb: 1 };
const ROW_LABEL_SX = { minWidth: 110 };
const SLIDER_VALUE_SX = {
  minWidth: 32,
  textAlign: 'right' as const,
  fontVariantNumeric: 'tabular-nums',
};

function AutoMeasureSettingsDialogImpl({ open, onClose, onStatusChange }: Props) {
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

  const handleImageTypeChange = useCallback((event: SelectChangeEvent) => {
    setForm((current) => ({ ...current, imageType: event.target.value as ImageType }));
  }, []);

  const handleObjectiveChange = useCallback((event: SelectChangeEvent) => {
    setForm((current) => ({
      ...current,
      objectiveForMeasure: event.target.value as ObjectiveForMeasure,
    }));
  }, []);

  const handleSliderChange = useCallback(
    (field: 'erosion' | 'dilation' | 'factor') => (_e: Event, value: number | number[]) => {
      const next = Array.isArray(value) ? value[0] : value;
      setForm((current) => ({ ...current, [field]: next }));
    },
    []
  );

  const handleCheckboxChange = useCallback(
    (field: 'turretAfterImpress' | 'measureAfterImpress') =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const checked = event.target.checked;
        setForm((current) => ({ ...current, [field]: checked }));
      },
    []
  );

  const handleDefault = useCallback(() => {
    setForm(DEFAULT_AUTO_MEASURE_SETTINGS);
  }, []);

  const handleSave = useCallback(async () => {
    try {
      await saveAutoMeasureSettings({ id: data?.id, values: form });
      onStatusChange?.('Auto measure settings saved.');
      onClose();
    } catch {
      // surfaced via saveError
    }
  }, [data?.id, form, onClose, onStatusChange, saveAutoMeasureSettings]);

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
            Erosion
          </Typography>
          <Slider
            value={form.erosion}
            min={0}
            max={100}
            onChange={handleSliderChange('erosion')}
            disabled={busy}
            sx={{ flex: 1 }}
          />
          <Typography variant="body2" sx={SLIDER_VALUE_SX}>
            {form.erosion}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="body2" sx={ROW_LABEL_SX}>
            Dilation
          </Typography>
          <Slider
            value={form.dilation}
            min={0}
            max={100}
            onChange={handleSliderChange('dilation')}
            disabled={busy}
            sx={{ flex: 1 }}
          />
          <Typography variant="body2" sx={SLIDER_VALUE_SX}>
            {form.dilation}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
          <Typography variant="body2" sx={ROW_LABEL_SX}>
            Factor
          </Typography>
          <Slider
            value={form.factor}
            min={0}
            max={100}
            onChange={handleSliderChange('factor')}
            disabled={busy}
            sx={{ flex: 1 }}
          />
          <Typography variant="body2" sx={SLIDER_VALUE_SX}>
            {form.factor}
          </Typography>
        </Stack>

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
