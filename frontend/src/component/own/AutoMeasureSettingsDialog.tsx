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
  AUTO_MEASURE_DEFAULTS_BY_OBJECTIVE,
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
  // Currently active objective in the app. Drives the dropdown value and the
  // smoothing/threshold defaults so this panel never lags behind a machine- or
  // PC-initiated objective change.
  activeObjective?: string | null;
};

function normalizeObjectiveKey(value: string | null | undefined): ObjectiveForMeasure | null {
  const key = String(value ?? '').trim().toUpperCase();
  return (OBJECTIVE_FOR_MEASURE_OPTIONS as readonly string[]).includes(key)
    ? (key as ObjectiveForMeasure)
    : null;
}

function toFormState(settings: AutoMeasureSettings | null): AutoMeasureSettingsPayload {
  return normalizeAutoMeasureSettings(settings);
}

const PANEL_WIDTH = 560;
const DRAG_LOG_THROTTLE_MS = 100;
// Preview backend (native detection + overlay paint) is heavy. Hold the
// preview dispatch until the user pauses the slider for this long — the
// thumb/number remain fully decoupled and update on every tick.
// Live-preview cadence. The App-side coalescing (autoMeasurePendingPreviewRef)
// ensures only one detection runs at a time and the latest pending settings
// always wins, so a short debounce here gives a real-time slider feel without
// queuing a stack of detections. 80ms balances rAF-fluid motion against not
// spawning a fresh native run on every sub-pixel slider tick.
const PREVIEW_DEBOUNCE_MS = 80;

type SliderField = 'smoothing' | 'threshold';

function AutoMeasureSettingsDialogImpl({
  open,
  onClose,
  onPreviewChange,
  onSaved,
  onStatusChange,
  activeObjective,
}: Props) {
  const { data, error: loadError, loading, refetch } = useAutoMeasureSettings();
  const { error: saveError, saveAutoMeasureSettings, saving } = useSaveAutoMeasureSettings();
  const [form, setForm] = useState<AutoMeasureSettingsPayload>(DEFAULT_AUTO_MEASURE_SETTINGS);
  // formRef mirrors `form` so slider handlers see the latest value without
  // closure staleness — required because a drag fires onChange faster than
  // React batches the prior setState commit.
  const formRef = useRef<AutoMeasureSettingsPayload>(DEFAULT_AUTO_MEASURE_SETTINGS);
  const previewSeqRef = useRef(0);
  const previewDebounceRef = useRef<number | null>(null);
  // True while a slider is being actively dragged. Suppresses the
  // objective-default sync effect so a machine-driven objective tick can't
  // overwrite the user's in-progress slider value mid-drag.
  const sliderDraggingRef = useRef(false);
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
      const synced = normalizeObjectiveKey(activeObjective);
      if (synced) {
        const defaults = AUTO_MEASURE_DEFAULTS_BY_OBJECTIVE[synced];
        next.objectiveForMeasure = synced;
        next.smoothing = defaults.smoothing;
        next.threshold = defaults.threshold;
        // eslint-disable-next-line no-console
        console.log(`[auto-measure-settings-sync] objective=${synced}`);
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-defaults-load] objective=${synced} smoothing=${defaults.smoothing} threshold=${defaults.threshold}`
        );
      }
      formRef.current = next;
      setForm(next);
      setSavedBaseline(next);
    }
  }, [data, loading, open, activeObjective]);

  // Live sync: while the dialog is already open, react to objective changes
  // coming from the machine (L1OK/L2OK) or from a PC-driven toggle so the
  // operator never has to re-pick the objective by hand.
  useEffect(() => {
    if (!open) return;
    if (sliderDraggingRef.current) return;
    const synced = normalizeObjectiveKey(activeObjective);
    if (!synced) return;
    const defaults = AUTO_MEASURE_DEFAULTS_BY_OBJECTIVE[synced];
    const current = formRef.current;
    if (
      current.objectiveForMeasure === synced &&
      current.smoothing === defaults.smoothing &&
      current.threshold === defaults.threshold
    ) {
      return;
    }
    const next = normalizeAutoMeasureSettings({
      ...current,
      objectiveForMeasure: synced,
      smoothing: defaults.smoothing,
      threshold: defaults.threshold,
    });
    // eslint-disable-next-line no-console
    console.log(`[auto-measure-settings-sync] objective=${synced}`);
    // eslint-disable-next-line no-console
    console.log(
      `[auto-measure-defaults-load] objective=${synced} smoothing=${defaults.smoothing} threshold=${defaults.threshold}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[auto-measure-settings][settings-sync] objective=${synced} smoothing=${defaults.smoothing} threshold=${defaults.threshold}`
    );
    formRef.current = next;
    setForm(next);
    // Intentionally do NOT call onPreviewChange here. App-level state is
    // already mirroring the objective-driven defaults; firing a preview
    // through this path would repaint yellow lines on objective change,
    // which violates the "lines only on Auto Measure click" rule.
  }, [open, activeObjective]);

  // Local-only form write. Synchronous: updates ref + React state in the
  // same commit so the slider thumb and the numeric readout move together
  // with no preview-side coupling. Side effects (preview dispatch) MUST NOT
  // happen here — see schedulePreview / flushPreview below.
  const writeLocal = useCallback((patch: Partial<AutoMeasureSettingsPayload>) => {
    const next = normalizeAutoMeasureSettings({ ...formRef.current, ...patch });
    formRef.current = next;
    setForm(next);
    return next;
  }, []);

  const clearPreviewDebounce = useCallback((reason: string) => {
    if (previewDebounceRef.current === null) return;
    window.clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = null;
    // eslint-disable-next-line no-console
    console.log(`[auto-measure-settings][preview-debounce-clear] reason=${reason}`);
  }, []);

  // Commit the current form to the parent preview pipeline. Stamps a
  // monotonic sequence so the App-side stale guard (latestPreviewSettings)
  // discards an older detection finishing after a newer one was scheduled.
  const flushPreview = useCallback(
    (source: string) => {
      clearPreviewDebounce('flush');
      const snapshot = formRef.current;
      const seq = ++previewSeqRef.current;
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-settings][preview-commit] seq=${seq} source=${source} smoothing=${snapshot.smoothing} threshold=${snapshot.threshold}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-settings][preview-request] seq=${seq} source=${source} smoothing=${snapshot.smoothing} threshold=${snapshot.threshold}`
      );
      // eslint-disable-next-line no-console
      console.log('[auto-measure-settings-preview-update]');
      // eslint-disable-next-line no-console
      console.log(
        `[settings-preview-callback] smoothing=${snapshot.smoothing} threshold=${snapshot.threshold}`
      );
      onPreviewChange?.(snapshot);
    },
    [clearPreviewDebounce, onPreviewChange]
  );

  const schedulePreview = useCallback(
    (source: string) => {
      if (previewDebounceRef.current !== null) {
        window.clearTimeout(previewDebounceRef.current);
        // eslint-disable-next-line no-console
        console.log('[auto-measure-settings][preview-debounce-clear] reason=reschedule');
      }
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-settings][preview-debounce-schedule] source=${source} delayMs=${PREVIEW_DEBOUNCE_MS} smoothing=${formRef.current.smoothing} threshold=${formRef.current.threshold}`
      );
      previewDebounceRef.current = window.setTimeout(() => {
        previewDebounceRef.current = null;
        flushPreview(`${source}:debounced`);
      }, PREVIEW_DEBOUNCE_MS);
    },
    [flushPreview]
  );

  useEffect(() => {
    return () => {
      if (previewDebounceRef.current !== null) {
        window.clearTimeout(previewDebounceRef.current);
        previewDebounceRef.current = null;
      }
    };
  }, []);

  const handleObjectiveChange = useCallback(
    (event: SelectChangeEvent) => {
      writeLocal({ objectiveForMeasure: event.target.value as ObjectiveForMeasure });
      flushPreview('objective');
    },
    [flushPreview, writeLocal]
  );

  // Slider onChange: write LOCAL form only. Never run detection or call the
  // parent on the per-tick path — that's what made the slider feel sticky.
  // Preview dispatch is debounced (schedulePreview) and force-flushed on
  // release (handleSliderCommitted).
  const handleSliderChange = useCallback(
    (field: SliderField) => (_e: Event, value: number | number[]) => {
      const next = Array.isArray(value) ? value[0] : value;
      const prev = formRef.current[field];
      if (prev === next) return;
      sliderDraggingRef.current = true;
      writeLocal({ [field]: next } as Partial<AutoMeasureSettingsPayload>);
      // eslint-disable-next-line no-console
      console.log(`[settings-slider-change] name=${field} value=${next}`);
      // eslint-disable-next-line no-console
      console.log(`[auto-measure-slider-change] type=${field} value=${next}`);
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-settings][slider-change] field=${field} prev=${prev} next=${next}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-settings][slider-local-change] field=${field} value=${next}`
      );
      schedulePreview(`slider:${field}`);
    },
    [schedulePreview, writeLocal]
  );

  // Pointer/keyboard release: flush the debounced preview NOW so the user's
  // final value is reflected immediately on letting go.
  const handleSliderCommitted = useCallback(
    (field: SliderField) => (_e: React.SyntheticEvent | Event, value: number | number[]) => {
      const next = Array.isArray(value) ? value[0] : value;
      sliderDraggingRef.current = false;
      if (formRef.current[field] !== next) {
        writeLocal({ [field]: next } as Partial<AutoMeasureSettingsPayload>);
      }
      flushPreview(`slider-release:${field}`);
    },
    [flushPreview, writeLocal]
  );

  const handleCheckboxChange = useCallback(
    (field: 'turretAfterImpress' | 'measureAfterImpress') =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        writeLocal({ [field]: event.target.checked } as Partial<AutoMeasureSettingsPayload>);
        flushPreview(`checkbox:${field}`);
      },
    [flushPreview, writeLocal]
  );

  const handleDefault = useCallback(() => {
    formRef.current = DEFAULT_AUTO_MEASURE_SETTINGS;
    setForm(DEFAULT_AUTO_MEASURE_SETTINGS);
    flushPreview('default');
  }, [flushPreview]);

  const handleCancel = useCallback(() => {
    clearPreviewDebounce('cancel');
    formRef.current = savedBaseline;
    setForm(savedBaseline);
    onClose();
  }, [clearPreviewDebounce, onClose, savedBaseline]);

  const handleSave = useCallback(async () => {
    clearPreviewDebounce('save');
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
  }, [clearPreviewDebounce, data?.id, form, onClose, onSaved, onStatusChange, saveAutoMeasureSettings]);

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
        onChangeCommitted={handleSliderCommitted(field)}
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
