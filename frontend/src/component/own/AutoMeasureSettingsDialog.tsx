import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

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

const PANEL_WIDTH = 560;
const DRAG_LOG_THROTTLE_MS = 100;

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
  // Initial position: top-right area, matching the previous Dialog placement so
  // muscle memory is preserved. Stays at this anchor until the user drags.
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    lastLogAt: number;
  } | null>(null);

  const busy = loading || saving;
  const errorMessage = loadError ?? saveError;

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line no-console
      console.log('[auto-measure-settings-open]');
      void refetch();
    } else {
      // eslint-disable-next-line no-console
      console.log('[auto-measure-settings-close]');
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
        // eslint-disable-next-line no-console
        console.log('[auto-measure-settings-preview-update]');
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

  // Drag handlers — pointer events give us automatic capture across the entire
  // window, so we don't need a global mousemove listener and the panel keeps
  // tracking the cursor even if it briefly leaves the header.
  const handleHeaderPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const panel = event.currentTarget.parentElement as HTMLElement | null;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      lastLogAt: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    // Convert anchored position to absolute on first drag so subsequent moves
    // are stable and don't fight CSS `right` anchoring.
    setPosition({ x: rect.left, y: rect.top });
  }, []);

  const handleHeaderPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const maxX = window.innerWidth - 80; // keep at least a slice on screen
    const maxY = window.innerHeight - 40;
    const nextX = Math.max(0, Math.min(maxX, event.clientX - drag.offsetX));
    const nextY = Math.max(0, Math.min(maxY, event.clientY - drag.offsetY));
    setPosition({ x: nextX, y: nextY });
    const now = performance.now();
    if (now - drag.lastLogAt > DRAG_LOG_THROTTLE_MS) {
      drag.lastLogAt = now;
      // eslint-disable-next-line no-console
      console.log(`[auto-measure-settings-drag] x=${Math.round(nextX)} y=${Math.round(nextY)}`);
    }
  }, []);

  const handleHeaderPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  if (!open) return null;

  const anchoredStyle: React.CSSProperties = position
    ? { left: position.x, top: position.y }
    : { right: 2, top: 11 };

  const sliderRow = (
    label: string,
    field: SliderField,
    min: number,
    max: number
  ) => (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
      <Typography variant="body2" sx={{ minWidth: 160 }}>
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
      <Typography
        variant="body2"
        sx={{ minWidth: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
      >
        {form[field]}
      </Typography>
    </Stack>
  );

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        ...anchoredStyle,
        width: PANEL_WIDTH,
        maxWidth: 'calc(100vw - 32px)',
        zIndex: (theme) => theme.zIndex.modal,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        // Important: no backdrop, no scrim. The live camera below stays at
        // full brightness — only this panel's own pointer events are captured.
      }}
    >
      <Box
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          bgcolor: colors.headingPrimary,
          color: '#FFFFFF',
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicatorIcon fontSize="small" sx={{ opacity: 0.85 }} />
        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>
          Auto Measure Setting
        </Typography>
        <IconButton
          size="small"
          onClick={handleCancel}
          disabled={busy}
          sx={{ color: '#FFFFFF' }}
          aria-label="Close auto measure settings"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ p: 2, overflowY: 'auto', maxHeight: 'calc(100vh - 120px)' }}>
        <Typography
          variant="subtitle2"
          sx={{ color: colors.headingSecondary, fontWeight: 600, mb: 1 }}
        >
          Auto Measure Correct
        </Typography>

        {sliderRow('Smoothing', 'smoothing', SMOOTHING_MIN, SMOOTHING_MAX)}
        {sliderRow('Threshold', 'threshold', THRESHOLD_MIN, THRESHOLD_MAX)}

        <Typography
          variant="subtitle2"
          sx={{ color: colors.headingSecondary, fontWeight: 600, mt: 2, mb: 1 }}
        >
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
          <Typography variant="body2" sx={{ minWidth: 160 }}>
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
      </Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 2, py: 1.25, borderTop: 1, borderColor: 'divider', alignItems: 'center' }}
      >
        <Button onClick={handleDefault} disabled={busy} size="small">
          Default
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={() => void handleSave()} disabled={busy} size="small">
          Save
        </Button>
        <Button onClick={handleCancel} disabled={busy} size="small">
          Cancel
        </Button>
      </Stack>
    </Paper>
  );
}

export default memo(AutoMeasureSettingsDialogImpl);
