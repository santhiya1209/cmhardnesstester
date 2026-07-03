import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import BarChartIcon from '@mui/icons-material/BarChart';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import type { SxProps, Theme } from '@mui/material/styles';
import { tokens } from '@/theme/theme';
import { useDeleteMeasurement } from '@/hooks/mutations/useDeleteMeasurement';
import { useClearMeasurements } from '@/hooks/mutations/useClearMeasurements';
import { useSaveMeasurement } from '@/hooks/mutations/useSaveMeasurement';
import type { Measurement } from '@/types/measurement';
import MeasurementsTable from './MeasurementsTable';
import ExportReportDialog from '@/component/own/ExportReportDialog';
import { convertVickers, type ConvertTargetType } from '@/utils/hardnessConvert';
import { getHardnessColor } from '@/utils/hardnessColor';

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

const ACTION_ROW_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 1,
  px: 1.5,
  pt: 1,
  pb: 1,
};
const ACTION_BTN_SX: SxProps<Theme> = {
  textTransform: 'none',
  fontSize: 12,
  fontWeight: 500,
  py: 0.75,
  gap: 0.5,
  borderRadius: 1.5,
  color: 'text.primary',
  borderColor: 'divider',
  bgcolor: 'background.paper',
  boxShadow: '0 1px 2px rgba(15, 42, 71, 0.04)',
  '&:hover': {
    borderColor: tokens.accentSecondary.base,
    color: tokens.accentSecondary.base,
    bgcolor: tokens.accentSecondary.soft,
  },
};
const ACTION_BTN_ACTIVE_SX: SxProps<Theme> = {
  ...ACTION_BTN_SX,
  borderColor: tokens.accentSecondary.base,
  color: tokens.accentSecondary.base,
  bgcolor: tokens.accentSecondary.soft,
  boxShadow: `0 0 0 2px rgba(14, 165, 233, 0.18)`,
};
const STATUS_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1, px: 1.5, pb: 0.75 };
const STATUS_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const ALERT_SX: SxProps<Theme> = { mx: 1.5, mb: 0.75 };

type Props = {
  measurements: Measurement[];
  loading: boolean;
  error: string | null;
  onOpenStatisticsTab: () => void;
  onOpenTestRecords: (measurementIds: string[]) => void;
  onMeasurementsCleared?: () => void;
  onDisplayValuesChange?: (values: MeasurementDisplayValues) => void;
  micrometerEnabled: boolean;
  targetMinHv: number | null;
  targetMaxHv: number | null;
  chdTargetInput: string;
  onChdTargetInputChange: (value: string) => void;
};

export type MeasurementDisplayValues = {
  hvDisplay: string;
  hvType: string;
  hardnessValue: string;
  hvTargetColor: string;
  qualified: string | null;
  timestamp: string | null;
  convertDisabled: boolean;
  convertOptions: readonly string[];
  onConvertTypeChange: (value: string) => void;
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
  onMeasurementsCleared,
  onDisplayValuesChange,
  micrometerEnabled,
  targetMinHv,
  targetMaxHv,
  chdTargetInput,
  onChdTargetInputChange,
}: Props) {
  const { error: deleteError, deleting, removeMeasurement } = useDeleteMeasurement();
  const { error: clearError, clearing, clearMeasurements } = useClearMeasurements();
  const { saveMeasurement } = useSaveMeasurement();
  // Keep a ref to the latest measurements so handleManualDepthChange can stay
  // referentially stable — otherwise every measurements update would change the
  // callback identity and re-render every memoized row in the table.
  const measurementsRef = useRef(measurements);
  useEffect(() => {
    measurementsRef.current = measurements;
  }, [measurements]);
  const [convertType, setConvertType] = useState<(typeof CONVERT_TYPE_OPTIONS)[number]>('HV');
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [convertSyncError, setConvertSyncError] = useState<string | null>(null);

  useEffect(() => {
  }, []);

  const selectedMeasurement = useMemo(
    () => measurements.find((measurement) => measurement.id === selectedMeasurementId) ?? null,
    [measurements, selectedMeasurementId]
  );
  const latestMeasurement = measurements[0] ?? null;
  const displayedMeasurement = selectedMeasurement ?? latestMeasurement;
  const displayedHvText = formatNumber(displayedMeasurement?.hv);
  const displayedHvType = CONVERT_TYPE_OPTIONS.includes(convertType) ? convertType : 'HV';
  const mutationError = error ?? deleteError ?? clearError ?? convertSyncError;
  const busy = loading || deleting || clearing;

  const hvTargetColor = useMemo(
    () =>
      getHardnessColor(
        typeof displayedMeasurement?.hv === 'number' ? displayedMeasurement.hv : null,
        targetMinHv,
        targetMaxHv
      ).color,
    [displayedMeasurement, targetMinHv, targetMaxHv]
  );

  const displayConvertValue = useMemo<string>(() => {
    const hv =
      typeof displayedMeasurement?.hv === 'number' && Number.isFinite(displayedMeasurement.hv)
        ? displayedMeasurement.hv
        : null;
    const activeType: ConvertTargetType = CONVERT_TYPE_OPTIONS.includes(convertType)
      ? convertType
      : 'HV';

    let rawValue: number | null;
    if (hv === null) {
      rawValue = null;
    } else if (activeType === 'HV') {
      rawValue = hv;
    } else {
      rawValue = convertVickers(hv, activeType);
    }

    const display = rawValue === null ? 'N/A' : formatNumber(rawValue);
    return display;
  }, [displayedMeasurement, convertType]);

  useEffect(() => {
    const saved = displayedMeasurement?.convertType;
    if (saved && CONVERT_TYPE_OPTIONS.includes(saved as (typeof CONVERT_TYPE_OPTIONS)[number])) {
      setConvertType(saved as (typeof CONVERT_TYPE_OPTIONS)[number]);
    } else {
      setConvertType('HV');
      if (displayedMeasurement) {
      }
    }
  }, [displayedMeasurement?.id, displayedMeasurement?.convertType, displayedMeasurement]);

  const handleConvertTypeChange = useCallback(
    async (next: (typeof CONVERT_TYPE_OPTIONS)[number]) => {
      setConvertType(next);
      const target = displayedMeasurement;
      if (!target) {
        return;
      }
      const originalHv = typeof target.hv === 'number' && Number.isFinite(target.hv) ? target.hv : null;
      const convertValue = convertVickers(originalHv, next as ConvertTargetType);
      try {
        await saveMeasurement({
          id: target.id,
          values: {
            d1: target.d1,
            d2: target.d2,
            hv: target.hv ?? null,
            d1Px: target.d1Px ?? null,
            d2Px: target.d2Px ?? null,
            d1Um: target.d1Um ?? null,
            d2Um: target.d2Um ?? null,
            averageUm: target.averageUm ?? null,
            averageMm: target.averageMm ?? null,
            micronPerPixel: target.micronPerPixel ?? null,
            calibrationName: target.calibrationName ?? null,
            objective: target.objective ?? null,
            testForceKgf: target.testForceKgf ?? null,
            depthMm: target.depthMm ?? null,
            convertType: next,
            convertValue,
          },
        });
        setConvertSyncError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(`[measurement-convert] save failed reason=${message}`);
        setConvertSyncError(`Failed to update convert type: ${message}`);
      }
    },
    [displayedMeasurement, saveMeasurement]
  );

  const handleConvertTypeChangeValue = useCallback(
    (value: string) => {
      void handleConvertTypeChange(value as (typeof CONVERT_TYPE_OPTIONS)[number]);
    },
    [handleConvertTypeChange]
  );

  useEffect(() => {
    onDisplayValuesChange?.({
      hvDisplay: displayedHvText,
      hvType: displayedHvType,
      hardnessValue: displayConvertValue,
      hvTargetColor,
      qualified: displayedMeasurement?.qualified ?? null,
      timestamp: displayedMeasurement?.timestamp ?? null,
      convertDisabled: busy,
      convertOptions: CONVERT_TYPE_OPTIONS,
      onConvertTypeChange: handleConvertTypeChangeValue,
    });
  }, [
    displayConvertValue,
    displayedHvText,
    displayedHvType,
    hvTargetColor,
    displayedMeasurement?.qualified,
    displayedMeasurement?.timestamp,
    busy,
    handleConvertTypeChangeValue,
    onDisplayValuesChange,
  ]);

  useEffect(() => {
    if (selectedMeasurementId && !selectedMeasurement) {
      setSelectedMeasurementId(null);
    }
  }, [selectedMeasurement, selectedMeasurementId]);

  const handleSelectMeasurement = useCallback((measurementId: string) => {
    setSelectedMeasurementId((current) => (current === measurementId ? null : measurementId));
  }, []);

  const handleManualDepthChange = useCallback(
    async (measurementId: string, depthMm: number | null) => {
      const target = measurementsRef.current.find((m) => m.id === measurementId);
      if (!target) return;
      const convertValue =
        typeof target.convertValue === 'number' ? target.convertValue : null;
      try {
        await saveMeasurement({
          id: measurementId,
          values: {
            d1: target.d1,
            d2: target.d2,
            hv: target.hv ?? null,
            d1Px: target.d1Px ?? null,
            d2Px: target.d2Px ?? null,
            d1Um: target.d1Um ?? null,
            d2Um: target.d2Um ?? null,
            averageUm: target.averageUm ?? null,
            averageMm: target.averageMm ?? null,
            micronPerPixel: target.micronPerPixel ?? null,
            calibrationName: target.calibrationName ?? null,
            objective: target.objective ?? null,
            testForceKgf: target.testForceKgf ?? null,
            hardnessType: target.hardnessType ?? null,
            convertType: target.convertType ?? null,
            convertValue,
            depthMm,
            depthSource: 'manual',
            deviceDepthMm: target.deviceDepthMm ?? null,
            manualDepthMm: depthMm,
          },
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[manual-depth-save-error]', err);
      }
    },
    [saveMeasurement]
  );

  const handleDelete = useCallback(async () => {
    if (!selectedMeasurement) {
      return;
    }

    await removeMeasurement(selectedMeasurement.id);
    setSelectedMeasurementId(null);
  }, [removeMeasurement, selectedMeasurement]);

  const handleClear = useCallback(async () => {
    if (measurements.length === 0) {
      setSelectedMeasurementId(null);
      return;
    }

    // One bulk DELETE + one LIST invalidation → the table refetches to empty in a
    // single render, instead of one delete/refetch per row.
    await clearMeasurements();
    setSelectedMeasurementId(null);
    onMeasurementsCleared?.();
  }, [clearMeasurements, measurements.length, onMeasurementsCleared]);

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
        micrometerEnabled={micrometerEnabled}
        onManualDepthChange={handleManualDepthChange}
        targetMinHv={targetMinHv}
        targetMaxHv={targetMaxHv}
      />

      <Box sx={ACTION_ROW_SX}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<DeleteOutlineIcon fontSize="small" />}
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
          startIcon={<ClearAllIcon fontSize="small" />}
          sx={ACTION_BTN_SX}
          disabled={busy || measurements.length === 0}
          onClick={() => setConfirmClearOpen(true)}
        >
          Clear
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<BarChartIcon fontSize="small" />}
          sx={ACTION_BTN_ACTIVE_SX}
          disabled={busy}
          onClick={onOpenStatisticsTab}
        >
          Statistics
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<ArticleOutlinedIcon fontSize="small" />}
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
      <Dialog open={confirmClearOpen} onClose={() => setConfirmClearOpen(false)} maxWidth="xs">
        <DialogTitle>Clear current inspection?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This removes all {measurements.length} measurement
            {measurements.length === 1 ? '' : 's'}, session images, overlays and
            live values, returning the app to a ready state for a new inspection.
            Calibration, settings and saved reports are not affected.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClearOpen(false)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disableElevation
            sx={{ textTransform: 'none' }}
            onClick={() => {
              setConfirmClearOpen(false);
              void handleClear();
            }}
          >
            Clear
          </Button>
        </DialogActions>
      </Dialog>

      <ExportReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        measurements={measurements}
        cameraImageDataUrl={(displayedMeasurement?.imageDataUrl ?? null) || null}
        targetMinHv={targetMinHv}
        targetMaxHv={targetMaxHv}
        chdTargetInput={chdTargetInput}
        onChdTargetInputChange={onChdTargetInputChange}
      />

      <Stack direction="row" sx={STATUS_ROW_SX}>
        {busy ? <CircularProgress size={14} /> : null}
        <Typography sx={STATUS_TEXT_SX}>{statusMessage}</Typography>
      </Stack>
    </>
  );
}

export default memo(MeasurementsWorkspaceImpl);
