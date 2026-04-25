import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import type { SxProps, Theme } from '@mui/material/styles';
import { useSaveMachineSettings } from '@/hooks/mutations/useSaveMachineSettings';
import { useMachineSettings } from '@/hooks/queries/useMachineSettings';
import type { MachineSettings, MachineSettingsPayload } from '@/types/machineSettings';

const FORCE_OPTIONS = ['0.01kgf', '0.025kgf', '0.05kgf', '0.1kgf', '0.2kgf', '0.3kgf', '0.5kgf', '1kgf'];
const OBJECTIVE_OPTIONS = ['2.5X', '5X', '10X', '20X', '40X', '50X'];
const HARDNESS_LEVEL_OPTIONS = ['Low', 'Middle', 'High'];
const NUMBER_INPUT_PROPS = { min: 0 } as const;

type MachineSettingsFormState = {
  force: string;
  lightness: string;
  loadTime: string;
  objective: string;
  hardnessLevel: string;
};

const DEFAULT_FORM_STATE: MachineSettingsFormState = {
  force: '0.5kgf',
  lightness: '5',
  loadTime: '5',
  objective: '10X',
  hardnessLevel: 'Middle',
};

const INDENTER_SECTION_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: '160px 1fr',
  gap: 1.5,
  px: 1.5,
  py: 1.5,
  alignItems: 'center',
};
const INDENT_BUTTON_SX: SxProps<Theme> = {
  width: 160,
  height: 90,
  textTransform: 'none',
  fontSize: 14,
  fontWeight: 500,
};
const INDENTER_RIGHT_SX: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: 1 };
const ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1 };
const FIELD_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary', width: 100, flexShrink: 0 };
const READONLY_VALUE_SX: SxProps<Theme> = {
  px: 1,
  py: 0.5,
  fontSize: 12,
  border: 1,
  borderColor: 'divider',
  borderRadius: 0.5,
  minWidth: 64,
  textAlign: 'center',
};
const LENS_BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, minWidth: 56, py: 0.25 };

const SETTINGS_GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto 1fr',
  rowGap: 1,
  columnGap: 1,
  alignItems: 'center',
  px: 1.5,
  py: 1.5,
  borderTop: 1,
  borderColor: 'divider',
};
const SETTING_LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const ACTION_SECTION_SX: SxProps<Theme> = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1,
  px: 1.5,
  py: 1.5,
  borderTop: 1,
  borderColor: 'divider',
};
const ACTION_GROUP_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1 };
const STATUS_GROUP_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1 };
const STATUS_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const ALERT_SX: SxProps<Theme> = { mx: 1.5, mb: 1.5 };

function toFormState(machineSettings: MachineSettings | null): MachineSettingsFormState {
  if (!machineSettings) {
    return DEFAULT_FORM_STATE;
  }

  return {
    force: machineSettings.force,
    lightness: String(machineSettings.lightness),
    loadTime: String(machineSettings.loadTime),
    objective: machineSettings.objective,
    hardnessLevel: machineSettings.hardnessLevel,
  };
}

function parseNonNegativeNumber(value: string): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function toPayload(formState: MachineSettingsFormState): MachineSettingsPayload | null {
  const lightness = parseNonNegativeNumber(formState.lightness);
  const loadTime = parseNonNegativeNumber(formState.loadTime);

  if (lightness === null || loadTime === null) {
    return null;
  }

  return {
    force: formState.force,
    lightness,
    loadTime,
    objective: formState.objective,
    hardnessLevel: formState.hardnessLevel,
  };
}

function areFormStatesEqual(left: MachineSettingsFormState, right: MachineSettingsFormState): boolean {
  return (
    left.force === right.force &&
    left.lightness === right.lightness &&
    left.loadTime === right.loadTime &&
    left.objective === right.objective &&
    left.hardnessLevel === right.hardnessLevel
  );
}

function formatUpdatedAt(value: string | undefined): string {
  if (!value) {
    return 'No saved machine settings yet.';
  }

  return `Last saved ${new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))}.`;
}

function MachineControlTabImpl() {
  const { data: machineSettings, error: loadError, loading, refetch } = useMachineSettings();
  const { error: saveError, saveMachineSettings, saving } = useSaveMachineSettings();
  const [formState, setFormState] = useState<MachineSettingsFormState>(DEFAULT_FORM_STATE);

  const persistedFormState = useMemo(() => toFormState(machineSettings), [machineSettings]);
  const payload = useMemo(() => toPayload(formState), [formState]);
  const isDirty = useMemo(
    () => !areFormStatesEqual(formState, persistedFormState),
    [formState, persistedFormState]
  );
  const isBusy = loading || saving;
  const isLightnessInvalid = parseNonNegativeNumber(formState.lightness) === null;
  const isLoadTimeInvalid = parseNonNegativeNumber(formState.loadTime) === null;
  const validationError = payload === null ? 'Lightness and Load Time must be valid non-negative numbers.' : null;
  const errorMessage = loadError ?? saveError ?? validationError;

  useEffect(() => {
    if (!loading) {
      setFormState(persistedFormState);
    }
  }, [loading, persistedFormState]);

  const handleSelectFieldChange = useCallback(
    (field: 'force' | 'objective' | 'hardnessLevel') =>
      (event: SelectChangeEvent) => {
        const value = event.target.value;
        setFormState((current) => ({
          ...current,
          [field]: value,
        }));
      },
    []
  );

  const handleInputFieldChange = useCallback(
    (field: 'lightness' | 'loadTime') =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setFormState((current) => ({
          ...current,
          [field]: value,
        }));
      },
    []
  );

  const handleLensClick = useCallback((objective: '10X' | '40X') => {
    setFormState((current) => ({
      ...current,
      objective,
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!payload) {
      return;
    }

    await saveMachineSettings({
      id: machineSettings?.id,
      values: payload,
    });

    await refetch();
  }, [machineSettings?.id, payload, refetch, saveMachineSettings]);

  const handleReset = useCallback(() => {
    setFormState(persistedFormState);
  }, [persistedFormState]);

  const handleReload = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const statusMessage = useMemo(() => {
    if (saving) {
      return 'Saving machine settings...';
    }

    if (loading) {
      return 'Loading machine settings...';
    }

    if (isDirty) {
      return 'Unsaved changes.';
    }

    return formatUpdatedAt(machineSettings?.updatedAt);
  }, [isDirty, loading, machineSettings?.updatedAt, saving]);

  return (
    <>
      <Box sx={INDENTER_SECTION_SX}>
        <Button variant="outlined" sx={INDENT_BUTTON_SX} disabled={isBusy}>Indent</Button>

        <Box sx={INDENTER_RIGHT_SX}>
          <Box sx={ROW_SX}>
            <Typography sx={FIELD_LABEL_SX}>Indenter</Typography>
            <Typography sx={READONLY_VALUE_SX}>HV</Typography>
          </Box>
          <Box sx={ROW_SX}>
            <Typography sx={FIELD_LABEL_SX}>Objective Lens</Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant={formState.objective === '10X' ? 'contained' : 'outlined'}
                size="small"
                sx={LENS_BTN_SX}
                disabled={isBusy}
                onClick={() => handleLensClick('10X')}
              >
                10X
              </Button>
              <Button
                variant={formState.objective === '40X' ? 'contained' : 'outlined'}
                size="small"
                sx={LENS_BTN_SX}
                disabled={isBusy}
                onClick={() => handleLensClick('40X')}
              >
                40X
              </Button>
            </Stack>
          </Box>
        </Box>
      </Box>

      <Divider />

      <Box sx={SETTINGS_GRID_SX}>
        <Typography sx={SETTING_LABEL_SX}>Force</Typography>
        <FormControl size="small">
          <Select value={formState.force} disabled={isBusy} onChange={handleSelectFieldChange('force')}>
            {FORCE_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>{o}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography sx={SETTING_LABEL_SX}>Lightness</Typography>
        <TextField
          size="small"
          type="number"
          value={formState.lightness}
          error={isLightnessInvalid}
          disabled={isBusy}
          onChange={handleInputFieldChange('lightness')}
          slotProps={{ htmlInput: NUMBER_INPUT_PROPS }}
        />

        <Typography sx={SETTING_LABEL_SX}>Objective</Typography>
        <FormControl size="small">
          <Select
            value={formState.objective}
            disabled={isBusy}
            onChange={handleSelectFieldChange('objective')}
          >
            {OBJECTIVE_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>{o}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography sx={SETTING_LABEL_SX}>Load Time(s)</Typography>
        <TextField
          size="small"
          type="number"
          value={formState.loadTime}
          error={isLoadTimeInvalid}
          disabled={isBusy}
          onChange={handleInputFieldChange('loadTime')}
          slotProps={{ htmlInput: NUMBER_INPUT_PROPS }}
        />

        <Typography sx={SETTING_LABEL_SX}>Hardness Level</Typography>
        <FormControl size="small">
          <Select
            value={formState.hardnessLevel}
            disabled={isBusy}
            onChange={handleSelectFieldChange('hardnessLevel')}
          >
            {HARDNESS_LEVEL_OPTIONS.map((o) => (
              <MenuItem key={o} value={o}>{o}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box />
        <Box />
      </Box>

      <Box sx={ACTION_SECTION_SX}>
        <Box sx={ACTION_GROUP_SX}>
          <Button
            variant="contained"
            size="small"
            disabled={isBusy || !isDirty || payload === null}
            onClick={() => {
              void handleSave();
            }}
          >
            Save Settings
          </Button>
          <Button
            variant="outlined"
            size="small"
            disabled={isBusy || !isDirty}
            onClick={handleReset}
          >
            Reset
          </Button>
          <Button
            variant="outlined"
            size="small"
            disabled={isBusy}
            onClick={() => {
              void handleReload();
            }}
          >
            Reload
          </Button>
        </Box>

        <Box sx={STATUS_GROUP_SX}>
          {isBusy ? <CircularProgress size={14} /> : null}
          <Typography sx={STATUS_TEXT_SX}>{statusMessage}</Typography>
        </Box>
      </Box>

      {errorMessage ? (
        <Alert severity="error" sx={ALERT_SX}>
          {errorMessage}
        </Alert>
      ) : null}
    </>
  );
}

export default memo(MachineControlTabImpl);
