import { memo, useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import {
  useCreateXyzPlatformSettingsMutation,
  useGetXyzPlatformSettingsQuery,
  useUpdateXyzPlatformSettingsMutation,
} from '@/store/api/settingsApi';
import {
  DEFAULT_XYZ_PLATFORM_SETTINGS,
  toXyzSettingsForm,
  XY_SPEED_MODES,
  type XYZPlatformSettingsPayload,
  type XySpeedMode,
  type XyzEmptyTrip,
  type XyzSpeedProfile,
} from '@/types/xyzPlatformSettings';

type Props = { open: boolean; onClose: () => void };

const SECTION_TITLE_SX: SxProps<Theme> = { fontWeight: 600, mt: 2, mb: 1 };
const NUM_SX: SxProps<Theme> = { width: 96 };
// Speed grid: mode label + 5 numeric columns.
const SPEED_GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: '64px repeat(5, 1fr)',
  gap: 1,
  alignItems: 'center',
};
const GRID_HEAD_SX: SxProps<Theme> = { fontSize: 11, color: 'text.secondary' };

const EMPTY_TRIP_FIELDS: Array<[keyof XyzEmptyTrip, string]> = [
  ['forward', 'Forward'],
  ['backward', 'Backward'],
  ['leftward', 'Leftward'],
  ['rightward', 'Rightward'],
];

const PROFILE_FIELDS: Array<[keyof XyzSpeedProfile, string, number | 'any']> = [
  ['stepDistanceMm', 'Step (mm)', 'any'],
  ['beginSpeedMmS', 'Begin (mm/s)', 'any'],
  ['accelerationMmS2', 'Accel (mm/s²)', 'any'],
  ['finalSpeedMmS', 'Final (mm/s)', 'any'],
  ['registerValue', 'Register', 1],
];

function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number | 'any';
  onChange: (n: number) => void;
}) {
  return (
    <TextField
      label={label}
      type="number"
      size="small"
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      slotProps={{ htmlInput: { step, min: 0 } }}
      sx={NUM_SX}
    />
  );
}

function XYPlatformSettingsDialogImpl({ open, onClose }: Props) {
  const { data, isFetching, refetch } = useGetXyzPlatformSettingsQuery(undefined, { skip: !open });
  const [createSettings, createState] = useCreateXyzPlatformSettingsMutation();
  const [updateSettings, updateState] = useUpdateXyzPlatformSettingsMutation();

  const current = data?.[0];
  const [form, setForm] = useState<XYZPlatformSettingsPayload>(DEFAULT_XYZ_PLATFORM_SETTINGS);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form from the backend-owned settings each time the dialog opens.
  useEffect(() => {
    if (open) {
      setForm(toXyzSettingsForm(current));
      setError(null);
    }
  }, [open, current]);

  const saving = createState.isLoading || updateState.isLoading;
  const busy = isFetching || saving;

  const setGeneral = useCallback(
    <K extends 'runningByNewThread' | 'hasEmptyTrip' | 'reverseXAxis' | 'reverseYAxis' | 'pulsePerMm'>(
      key: K,
      value: XYZPlatformSettingsPayload[K]
    ) => setForm((f) => ({ ...f, [key]: value })),
    []
  );

  const setEmptyTrip = useCallback(
    (key: keyof XyzEmptyTrip, value: number) =>
      setForm((f) => ({ ...f, emptyTrip: { ...f.emptyTrip, [key]: value } })),
    []
  );

  const setProfile = useCallback(
    (mode: XySpeedMode, key: keyof XyzSpeedProfile, value: number) =>
      setForm((f) => ({
        ...f,
        speedProfiles: {
          ...f.speedProfiles,
          [mode]: { ...f.speedProfiles[mode], [key]: value },
        },
      })),
    []
  );

  // Cancel: close WITHOUT saving. The form re-seeds from backend on next open.
  const handleCancel = useCallback(() => {
    // eslint-disable-next-line no-console
    console.warn('[xyz-settings-cancel]');
    onClose();
  }, [onClose]);

  // Confirm: persist via the backend (create the singleton if none exists yet,
  // else update it). The backend service then owns the active settings.
  const handleConfirm = useCallback(async () => {
    setError(null);
    try {
      if (current?.id) {
        await updateSettings({ id: current.id, values: form }).unwrap();
      } else {
        await createSettings(form).unwrap();
      }
      // eslint-disable-next-line no-console
      console.log('[xyz-settings-save] saved=true');
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to save XY platform settings.';
      setError(message);
    }
  }, [createSettings, current?.id, form, onClose, updateSettings]);

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth="md" fullWidth>
      <DialogTitle>XY Platform Settings</DialogTitle>
      <DialogContent dividers>
        <Typography variant="subtitle2" sx={{ ...SECTION_TITLE_SX, mt: 0 }}>
          General
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={form.runningByNewThread}
                onChange={(e) => setGeneral('runningByNewThread', e.target.checked)}
              />
            }
            label="Running by new thread"
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={form.hasEmptyTrip}
                onChange={(e) => setGeneral('hasEmptyTrip', e.target.checked)}
              />
            }
            label="Has empty trip"
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={form.reverseXAxis}
                onChange={(e) => setGeneral('reverseXAxis', e.target.checked)}
              />
            }
            label="Reverse X axis"
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={form.reverseYAxis}
                onChange={(e) => setGeneral('reverseYAxis', e.target.checked)}
              />
            }
            label="Reverse Y axis"
          />
          <NumberField
            label="Pulse / mm"
            value={form.pulsePerMm}
            step={1}
            onChange={(n) => setGeneral('pulsePerMm', Math.round(n))}
          />
        </Box>

        <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
          Empty Trip (mm)
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {EMPTY_TRIP_FIELDS.map(([key, label]) => (
            <NumberField
              key={key}
              label={label}
              value={form.emptyTrip[key]}
              step="any"
              onChange={(n) => setEmptyTrip(key, n)}
            />
          ))}
        </Box>

        <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
          Speed Profiles
        </Typography>
        <Box sx={SPEED_GRID_SX}>
          <Typography sx={GRID_HEAD_SX} />
          {PROFILE_FIELDS.map(([key, label]) => (
            <Typography key={key} sx={GRID_HEAD_SX}>
              {label}
            </Typography>
          ))}
          {XY_SPEED_MODES.map((mode) => (
            <Box key={mode} sx={{ display: 'contents' }}>
              <Typography sx={{ textTransform: 'capitalize', fontSize: 13 }}>{mode}</Typography>
              {PROFILE_FIELDS.map(([key, , step]) => (
                <NumberField
                  key={key}
                  label=""
                  value={form.speedProfiles[mode][key]}
                  step={step}
                  onChange={(n) =>
                    setProfile(mode, key, key === 'registerValue' ? Math.round(n) : n)
                  }
                />
              ))}
            </Box>
          ))}
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          mm/s values are configuration only — physical speed is not calibrated. The Register value
          (controller units) is what is written to the speed registers.
        </Typography>

        {error ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => void refetch()} disabled={busy} size="small">
          Reload
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={handleCancel} disabled={saving} size="small">
          Cancel
        </Button>
        <Button onClick={() => void handleConfirm()} disabled={busy} variant="contained" size="small">
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(XYPlatformSettingsDialogImpl);
