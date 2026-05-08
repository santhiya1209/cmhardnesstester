import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useDeleteMeasurement } from '@/hooks/mutations/useDeleteMeasurement';
import type { Measurement } from '@/types/measurement';
import MeasurementsTable from './MeasurementsTable';
import MicrometerDisplay from '@/component/own/MicrometerDisplay';
import ExportReportDialog from '@/component/own/ExportReportDialog';

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

const SECTION_SX: SxProps<Theme> = { px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 1 };
const SUMMARY_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' };
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
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 0.75,
  px: 1.5,
  py: 1,
};
const ACTION_BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5 };
const STATUS_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1, px: 1.5, pb: 1 };
const STATUS_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const ALERT_SX: SxProps<Theme> = { mx: 1.5, mb: 1 };

type Props = {
  measurements: Measurement[];
  loading: boolean;
  error: string | null;
  onOpenStatisticsTab: () => void;
  onOpenTestRecords: (measurementIds: string[]) => void;
  refetch: () => Promise<void>;
};

function formatNumber(value: number | null | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(2);
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
  const [convertType, setConvertType] = useState<(typeof CONVERT_TYPE_OPTIONS)[number]>('HV');
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const selectedMeasurement = useMemo(
    () => measurements.find((measurement) => measurement.id === selectedMeasurementId) ?? null,
    [measurements, selectedMeasurementId]
  );
  const latestMeasurement = measurements[0] ?? null;
  const displayedMeasurement = selectedMeasurement ?? latestMeasurement;
  const mutationError = error ?? deleteError;
  const busy = loading || deleting;

  useEffect(() => {
    if (selectedMeasurementId && !selectedMeasurement) {
      setSelectedMeasurementId(null);
    }
  }, [selectedMeasurement, selectedMeasurementId]);

  const handleSelectMeasurement = useCallback((measurementId: string) => {
    setSelectedMeasurementId((current) => (current === measurementId ? null : measurementId));
  }, []);

  const handleDelete = useCallback(async () => {
    if (!selectedMeasurement) {
      return;
    }

    await removeMeasurement(selectedMeasurement.id);
    setSelectedMeasurementId(null);
    await refetch();
  }, [refetch, removeMeasurement, selectedMeasurement]);

  const handleClear = useCallback(async () => {
    if (measurements.length === 0) {
      setSelectedMeasurementId(null);
      return;
    }

    for (const measurement of measurements) {
      await removeMeasurement(measurement.id);
    }
    setSelectedMeasurementId(null);
    await refetch();
  }, [measurements, refetch, removeMeasurement]);

  const statusMessage = useMemo(() => {
    if (deleting) {
      return 'Deleting measurement...';
    }

    if (loading) {
      return 'Loading measurements...';
    }

    return measurements.length === 0 ? 'No measurements saved yet.' : `Loaded ${measurements.length} measurements.`;
  }, [deleting, loading, measurements.length]);

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
        <Button
          variant="outlined"
          size="small"
          sx={ACTION_BTN_SX}
          disabled={busy || measurements.length === 0}
          onClick={() => {
            void handleClear();
          }}
        >
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
          onClick={() => {
            void onOpenTestRecords;
            setReportOpen(true);
          }}
        >
          Report
        </Button>
      </Box>
      <ExportReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        measurements={measurements}
        cameraImageDataUrl={(displayedMeasurement?.imageDataUrl ?? null) || null}
      />

      <Stack direction="row" sx={STATUS_ROW_SX}>
        {busy ? <CircularProgress size={14} /> : null}
        <Typography sx={STATUS_TEXT_SX}>{statusMessage}</Typography>
      </Stack>
    </>
  );
}

export default memo(MeasurementsWorkspaceImpl);
