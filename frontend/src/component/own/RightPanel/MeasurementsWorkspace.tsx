import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { updateMeasurement } from '@/api/updateMeasurement';
import type { Measurement } from '@/types/measurement';
import MeasurementsTable from './MeasurementsTable';
import MicrometerDisplay from '@/component/own/MicrometerDisplay';
import ExportReportDialog from '@/component/own/ExportReportDialog';
import { convertVickers, type ConvertTargetType } from '@/utils/hardnessConvert';

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
// Top HV value box: bold, larger, accent colour so the latest hardness result
// reads at a glance from across the bench. Industrial-clean — no chip,
// no shadow — just typography weight + theme-aware accent.
const HV_DISPLAY_SX: SxProps<Theme> = {
  flex: 1,
  minWidth: 80,
  minHeight: 34,
  px: 1,
  py: 0.5,
  fontSize: 18,
  fontWeight: 800,
  letterSpacing: 0.3,
  color: 'primary.main',
  fontVariantNumeric: 'tabular-nums',
  border: 1,
  borderColor: 'divider',
  borderRadius: 0.5,
  bgcolor: 'background.paper',
  display: 'flex',
  alignItems: 'center',
};
// Top HV-type Select: same vertical rhythm, bold value text. Compact
// industrial dropdown — uses theme tokens for dark/light.
const HV_FIELD_SX: SxProps<Theme> = {
  flex: 1,
  minWidth: 80,
  '& .MuiSelect-select': {
    fontWeight: 700,
    fontSize: 14,
    letterSpacing: 0.5,
  },
};
// Companion "Convert Value" display next to the type dropdown — keeps the
// converted hardness visible separately so the original HV is never
// replaced visually.
const CONVERT_VALUE_DISPLAY_SX: SxProps<Theme> = {
  flex: 1,
  minWidth: 80,
  minHeight: 34,
  px: 1,
  py: 0.5,
  fontSize: 14,
  fontWeight: 600,
  color: 'text.primary',
  fontVariantNumeric: 'tabular-nums',
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
  const [convertSyncError, setConvertSyncError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[measurement-ui-style-update] section=hv-display');
  }, []);

  // Tracks the most recent measurement we've seen so we can emit the
  // [hardness-original-set] trace when a fresh Auto/Manual result lands.
  const lastSeenMeasurementIdRef = useRef<string | null>(null);
  useEffect(() => {
    const latest = measurements[0];
    if (!latest) return;
    if (lastSeenMeasurementIdRef.current === latest.id) return;
    lastSeenMeasurementIdRef.current = latest.id;
    if (typeof latest.hv === 'number' && Number.isFinite(latest.hv)) {
      // eslint-disable-next-line no-console
      console.log(`[hardness-original-set] hv=${latest.hv}`);
    }
  }, [measurements]);

  const selectedMeasurement = useMemo(
    () => measurements.find((measurement) => measurement.id === selectedMeasurementId) ?? null,
    [measurements, selectedMeasurementId]
  );
  const latestMeasurement = measurements[0] ?? null;
  const displayedMeasurement = selectedMeasurement ?? latestMeasurement;
  const mutationError = error ?? deleteError ?? convertSyncError;
  const busy = loading || deleting;

  // Sync the dropdown to whichever row is being shown so switching selection
  // reflects that row's saved convertType. Empty/legacy rows show 'HV'.
  useEffect(() => {
    const saved = displayedMeasurement?.convertType;
    if (saved && CONVERT_TYPE_OPTIONS.includes(saved as (typeof CONVERT_TYPE_OPTIONS)[number])) {
      setConvertType(saved as (typeof CONVERT_TYPE_OPTIONS)[number]);
    } else {
      setConvertType('HV');
    }
  }, [displayedMeasurement?.id, displayedMeasurement?.convertType]);

  const handleConvertTypeChange = useCallback(
    async (next: (typeof CONVERT_TYPE_OPTIONS)[number]) => {
      // eslint-disable-next-line no-console
      console.log(`[convert-type-ui] selected=${next}`);
      setConvertType(next);
      // eslint-disable-next-line no-console
      console.log(`[convert-type-state] value=${next}`);
      const target = displayedMeasurement;
      if (!target) {
        // eslint-disable-next-line no-console
        console.log('[measurement-convert] no target row — dropdown only');
        return;
      }
      // Original HV is the row's existing hv — it is NEVER overwritten by
      // the conversion path below. The convertValue is a derived/companion
      // field stored alongside.
      const originalHv = typeof target.hv === 'number' && Number.isFinite(target.hv) ? target.hv : null;
      // eslint-disable-next-line no-console
      console.log(`[hardness-original] hv=${originalHv ?? '-'}`);
      // eslint-disable-next-line no-console
      console.log(`[hardness-convert-start] originalHv=${originalHv ?? '-'} targetType=${next}`);
      // Analytical Vickers→target conversion (see utils/hardnessConvert.ts).
      // These are widely-used approximations for hardened/soft steel, NOT
      // ISO 18265 / E140 table-grade values. Returns `null` when the input
      // HV falls outside the target scale's reasonable range — the UI then
      // renders a dash, which is the correct industrial behaviour (don't
      // fabricate a number you can't justify).
      const convertValue = convertVickers(originalHv, next as ConvertTargetType);
      // eslint-disable-next-line no-console
      console.log(
        `[hardness-convert-result] originalHv=${originalHv ?? '-'} convertType=${next} convertValue=${convertValue ?? '-'}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[hardness-convert] originalHv=${originalHv ?? '-'} convertType=${next} convertValue=${convertValue ?? '-'}`
      );
      try {
        // IMPORTANT: We must explicitly forward every nullable-with-default
        // field from the existing row. Reason: the backend's
        // `UpdateMeasurementSchema` is built via `buildUpdateSchema(...).partial()`,
        // but the underlying `MeasurementPayloadSchema` declares many fields
        // as `.nullable().default(null)`. Zod's `.partial()` does NOT strip
        // the `.default(null)`, so any nullable field absent from the request
        // body is parsed as `null` (not `undefined`). The service's
        // `updateEntity` then reads `input.hv === undefined ? current.hv : input.hv`
        // and stores `null`, wiping the original Vickers value.
        //
        // Until the schema is fixed properly (rebuild buildUpdateSchema to
        // strip defaults), this row passes through every preservable field
        // so partial updates here are non-destructive.
        await updateMeasurement(target.id, {
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
        });
        // eslint-disable-next-line no-console
        console.log(
          `[measurement-row-update-conversion] rowId=${target.id} hardness=${originalHv ?? '-'} convertType=${next} convertValue=${convertValue ?? '-'}`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[measurement-row-update] hardness=${originalHv ?? '-'} hardnessType=HV convertType=${next} convertValue=${convertValue ?? '-'}`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[measurement-save] rowId=${target.id} convertType=${next} convertValue=${convertValue ?? '-'}`
        );
        setConvertSyncError(null);
        await refetch();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(`[measurement-convert] save failed reason=${message}`);
        setConvertSyncError(`Failed to update convert type: ${message}`);
      }
    },
    [displayedMeasurement, refetch]
  );

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
                void handleConvertTypeChange(
                  event.target.value as (typeof CONVERT_TYPE_OPTIONS)[number]
                )
              }
            >
              {CONVERT_TYPE_OPTIONS.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box sx={CONVERT_VALUE_DISPLAY_SX}>
            {formatNumber(
              typeof displayedMeasurement?.convertValue === 'number'
                ? displayedMeasurement.convertValue
                : null
            )}
          </Box>
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
