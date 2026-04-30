import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useDeleteMeasurement } from '@/hooks/mutations/useDeleteMeasurement';
import { useSaveMeasurement } from '@/hooks/mutations/useSaveMeasurement';
import { getLatestMicrometerReading } from '@/api/getLatestMicrometerReading';
import type { Measurement, MeasurementSavePayload } from '@/types/measurement';
import MeasurementsTable from './MeasurementsTable';
import MicrometerDisplay from '@/component/own/MicrometerDisplay';

const CONVERT_TYPE_OPTIONS = [
  'HV',
  'HK',
  'HBW',
  'HRA',
  'HRB',
  'HRC',
  'HRD',
  'HRF',
  'HR15N',
  'HR30N',
  'HR45N',
  'HR15T',
  'HR30T',
  'HR45T',
] as const;

type MeasurementFormState = {
  d1: string;
  d2: string;
  hv: string;
};

const DEFAULT_FORM_STATE: MeasurementFormState = {
  d1: '',
  d2: '',
  hv: '',
};

const SECTION_SX: SxProps<Theme> = { px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 1 };
const SUMMARY_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' };
const INPUT_ROW_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: '32px 1fr 32px 1fr 32px 1fr auto auto',
  gap: 1,
  alignItems: 'center',
};
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const HV_FIELD_SX: SxProps<Theme> = { flex: 1, minWidth: 80 };
const HV_DISPLAY_SX: SxProps<Theme> = {
  flex: 1,
  minWidth: 80,
  minHeight: 30,
  px: 1,
  py: 0.5,
  fontSize: 12,
  border: 1,
  borderColor: 'divider',
  borderRadius: 0.5,
  bgcolor: 'background.paper',
  display: 'flex',
  alignItems: 'center',
};
const MICROMETER_FIELD_SX: SxProps<Theme> = { width: 130 };
const ACTION_ROW_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: 0.75,
  px: 1.5,
  py: 1,
};
const ACTION_BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5 };
const FORM_BUTTON_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, minWidth: 96 };
const STATUS_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1, px: 1.5, pb: 1 };
const STATUS_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const ALERT_SX: SxProps<Theme> = { mx: 1.5, mb: 1 };
const NUMBER_SLOT_PROPS = { htmlInput: { min: 0, step: 'any' } } as const;

type Props = {
  measurements: Measurement[];
  loading: boolean;
  error: string | null;
  onOpenStatisticsTab: () => void;
  onOpenTestRecords: (measurementIds: string[]) => void;
  refetch: () => Promise<void>;
};

function parsePositiveNumber(value: string): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function formatNumber(value: number | null | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function toFormState(measurement: Measurement | null): MeasurementFormState {
  if (!measurement) {
    return DEFAULT_FORM_STATE;
  }

  return {
    d1: String(measurement.d1),
    d2: String(measurement.d2),
    hv: measurement.hv === null ? '' : String(measurement.hv),
  };
}

function toPayload(formState: MeasurementFormState): MeasurementSavePayload | null {
  const d1 = parsePositiveNumber(formState.d1);
  const d2 = parsePositiveNumber(formState.d2);
  const hv = parsePositiveNumber(formState.hv);

  if (d1 === null || d2 === null || hv === null) {
    return null;
  }

  const averageUm = Number(((d1 + d2) / 2).toFixed(3));

  return {
    d1,
    d2,
    d1Um: Number(d1.toFixed(3)),
    d2Um: Number(d2.toFixed(3)),
    averageUm,
    averageMm: Number((averageUm / 1000).toFixed(6)),
    hv,
    method: 'Manual',
    unit: 'um',
  };
}

function isFormBlank(formState: MeasurementFormState): boolean {
  return !formState.d1.trim() && !formState.d2.trim() && !formState.hv.trim();
}

async function readLatestMicrometerDepthMm(): Promise<number | null> {
  try {
    const reply = await getLatestMicrometerReading();
    const value = reply.reading?.value ?? null;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function MeasurementsWorkspaceImpl({
  measurements,
  loading,
  error,
  onOpenStatisticsTab,
  onOpenTestRecords,
  refetch,
}: Props) {
  const { error: deleteError, deleting, removeMeasurement } = useDeleteMeasurement();
  const { saveMeasurement, saving, error: saveError } = useSaveMeasurement();
  const [convertType, setConvertType] = useState<(typeof CONVERT_TYPE_OPTIONS)[number]>('HV');
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  const [editingMeasurementId, setEditingMeasurementId] = useState<string | null>(null);
  const [formState, setFormState] = useState<MeasurementFormState>(DEFAULT_FORM_STATE);
  const [showValidationError, setShowValidationError] = useState(false);

  const selectedMeasurement = useMemo(
    () => measurements.find((measurement) => measurement.id === selectedMeasurementId) ?? null,
    [measurements, selectedMeasurementId]
  );
  const latestMeasurement = measurements[0] ?? null;
  const displayedMeasurement = selectedMeasurement ?? latestMeasurement;
  const payload = useMemo(() => toPayload(formState), [formState]);
  const validationError =
    showValidationError && payload === null ? 'D1, D2, and HV must be valid positive numbers.' : null;
  const mutationError = error ?? saveError ?? deleteError ?? validationError;
  const busy = loading || saving || deleting;
  const formBlank = useMemo(() => isFormBlank(formState), [formState]);

  useEffect(() => {
    if (selectedMeasurementId && !selectedMeasurement) {
      setSelectedMeasurementId(null);
    }
  }, [selectedMeasurement, selectedMeasurementId]);

  useEffect(() => {
    if (editingMeasurementId) {
      const editingMeasurement =
        measurements.find((measurement) => measurement.id === editingMeasurementId) ?? null;

      if (!editingMeasurement) {
        setEditingMeasurementId(null);
        setFormState(DEFAULT_FORM_STATE);
        setShowValidationError(false);
      }
    }
  }, [editingMeasurementId, measurements]);

  const handleFormFieldChange = useCallback(
    (field: keyof MeasurementFormState) =>
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

  const handleSelectMeasurement = useCallback((measurementId: string) => {
    setSelectedMeasurementId((current) => (current === measurementId ? null : measurementId));
  }, []);

  const handleEdit = useCallback(() => {
    if (!selectedMeasurement) {
      return;
    }

    setEditingMeasurementId(selectedMeasurement.id);
    setFormState(toFormState(selectedMeasurement));
    setShowValidationError(false);
  }, [selectedMeasurement]);

  const handleDelete = useCallback(async () => {
    if (!selectedMeasurement) {
      return;
    }

    await removeMeasurement(selectedMeasurement.id);
    setSelectedMeasurementId(null);
    setEditingMeasurementId((current) => (current === selectedMeasurement.id ? null : current));
    setFormState(DEFAULT_FORM_STATE);
    setShowValidationError(false);
    await refetch();
  }, [refetch, removeMeasurement, selectedMeasurement]);

  const handleClear = useCallback(() => {
    setSelectedMeasurementId(null);
    setEditingMeasurementId(null);
    setFormState(DEFAULT_FORM_STATE);
    setShowValidationError(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!payload) {
      setShowValidationError(true);
      return;
    }

    const values =
      editingMeasurementId === null
        ? { ...payload, depthMm: await readLatestMicrometerDepthMm() }
        : payload;

    const savedMeasurement = await saveMeasurement({
      id: editingMeasurementId ?? undefined,
      values,
    });

    await refetch();
    setSelectedMeasurementId(savedMeasurement.id);
    setEditingMeasurementId(null);
    setFormState(DEFAULT_FORM_STATE);
    setShowValidationError(false);
  }, [editingMeasurementId, payload, refetch, saveMeasurement]);

  const statusMessage = useMemo(() => {
    if (saving) {
      return editingMeasurementId ? 'Updating measurement...' : 'Saving measurement...';
    }

    if (deleting) {
      return 'Deleting measurement...';
    }

    if (loading) {
      return 'Loading measurements...';
    }

    if (editingMeasurementId) {
      return 'Editing selected measurement.';
    }

    return measurements.length === 0 ? 'No measurements saved yet.' : `Loaded ${measurements.length} measurements.`;
  }, [deleting, editingMeasurementId, loading, measurements.length, saving]);

  return (
    <>
      <Box sx={SECTION_SX}>
        <Box sx={SUMMARY_ROW_SX}>
          <Typography sx={LABEL_SX}>HV</Typography>
          <Box sx={HV_DISPLAY_SX}>{formatNumber(displayedMeasurement?.hv)}</Box>
          <FormControl size="small" sx={HV_FIELD_SX}>
            <Select
              value={convertType}
              disabled={busy}
              onChange={(event: SelectChangeEvent<(typeof CONVERT_TYPE_OPTIONS)[number]>) =>
                setConvertType(event.target.value as (typeof CONVERT_TYPE_OPTIONS)[number])
              }
            >
              {CONVERT_TYPE_OPTIONS.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography sx={LABEL_SX}>Micrometer</Typography>
          <MicrometerDisplay sx={MICROMETER_FIELD_SX} />
        </Box>

        <Box sx={INPUT_ROW_SX}>
          <Typography sx={LABEL_SX}>D1</Typography>
          <TextField
            size="small"
            type="number"
            value={formState.d1}
            disabled={busy}
            error={parsePositiveNumber(formState.d1) === null && formState.d1.length > 0}
            onChange={handleFormFieldChange('d1')}
            slotProps={{ htmlInput: NUMBER_SLOT_PROPS.htmlInput }}
          />
          <Typography sx={LABEL_SX}>D2</Typography>
          <TextField
            size="small"
            type="number"
            value={formState.d2}
            disabled={busy}
            error={parsePositiveNumber(formState.d2) === null && formState.d2.length > 0}
            onChange={handleFormFieldChange('d2')}
            slotProps={{ htmlInput: NUMBER_SLOT_PROPS.htmlInput }}
          />
          <Typography sx={LABEL_SX}>HV</Typography>
          <TextField
            size="small"
            type="number"
            value={formState.hv}
            disabled={busy}
            error={parsePositiveNumber(formState.hv) === null && formState.hv.length > 0}
            onChange={handleFormFieldChange('hv')}
            slotProps={{ htmlInput: NUMBER_SLOT_PROPS.htmlInput }}
          />
          <Button
            variant="contained"
            size="small"
            sx={FORM_BUTTON_SX}
            disabled={busy || payload === null}
            onClick={() => {
              void handleSave();
            }}
          >
            {editingMeasurementId ? 'Save Edit' : 'Add Measurement'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            sx={FORM_BUTTON_SX}
            disabled={busy || (!editingMeasurementId && formBlank)}
            onClick={handleClear}
          >
            Cancel
          </Button>
        </Box>
      </Box>

      {mutationError ? (
        <Alert severity="error" sx={ALERT_SX}>
          {mutationError}
        </Alert>
      ) : null}

      <MeasurementsTable
        measurements={measurements}
        loading={loading}
        selectedMeasurementId={selectedMeasurementId}
        onSelect={handleSelectMeasurement}
      />

      <Box sx={ACTION_ROW_SX}>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX} disabled={busy || !selectedMeasurement} onClick={handleEdit}>
          Edit
        </Button>
        <Button
          variant="outlined"
          size="small"
          color="error"
          sx={ACTION_BTN_SX}
          disabled={busy || !selectedMeasurement}
          onClick={() => {
            void handleDelete();
          }}
        >
          Delete
        </Button>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX} disabled={busy} onClick={handleClear}>
          Clear
        </Button>
        <Button variant="outlined" size="small" sx={ACTION_BTN_SX} disabled={busy} onClick={onOpenStatisticsTab}>
          Statistics
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={ACTION_BTN_SX}
          disabled={busy || measurements.length === 0}
          onClick={() => onOpenTestRecords(selectedMeasurement ? [selectedMeasurement.id] : measurements.map((measurement) => measurement.id))}
        >
          Report
        </Button>
      </Box>

      <Stack direction="row" sx={STATUS_ROW_SX}>
        {busy ? <CircularProgress size={14} /> : null}
        <Typography sx={STATUS_TEXT_SX}>{statusMessage}</Typography>
      </Stack>
    </>
  );
}

export default memo(MeasurementsWorkspaceImpl);
