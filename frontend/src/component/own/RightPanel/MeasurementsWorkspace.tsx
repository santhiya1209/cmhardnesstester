import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import BarChartIcon from '@mui/icons-material/BarChart';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import type { SxProps, Theme } from '@mui/material/styles';
import { colors } from '@/theme/theme';
import { useDeleteMeasurement } from '@/hooks/mutations/useDeleteMeasurement';
import { updateMeasurement } from '@/api/updateMeasurement';
import type { Measurement } from '@/types/measurement';
import MeasurementsTable from './MeasurementsTable';
import MicrometerDisplay from '@/component/own/MicrometerDisplay';
import ExportReportDialog from '@/component/own/ExportReportDialog';
import HvSummaryRow from './HvSummaryRow';
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

const SECTION_SX: SxProps<Theme> = { px: 1.5, py: 0.75, display: 'flex', flexDirection: 'column', gap: 0.75 };
const SUMMARY_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' };
const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const MICROMETER_FIELD_SX: SxProps<Theme> = { width: 130 };
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
    borderColor: colors.accentSkyBlue,
    color: colors.accentSkyBlue,
    bgcolor: colors.accentSkyBlueSoft,
  },
};
const ACTION_BTN_ACTIVE_SX: SxProps<Theme> = {
  ...ACTION_BTN_SX,
  borderColor: colors.accentSkyBlue,
  color: colors.accentSkyBlue,
  bgcolor: colors.accentSkyBlueSoft,
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
  refetch: () => Promise<void>;
  micrometerEnabled: boolean;
  targetMinHv: number | null;
  targetMaxHv: number | null;
};

export type MeasurementDisplayValues = {
  hvDisplay: string;
  hvType: string;
  hardnessValue: string;
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
  refetch,
  micrometerEnabled,
  targetMinHv,
  targetMaxHv,
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
      // eslint-disable-next-line no-console
      console.log(`[hv-value-set] hv=${latest.hv}`);
    }
  }, [measurements]);

  const selectedMeasurement = useMemo(
    () => measurements.find((measurement) => measurement.id === selectedMeasurementId) ?? null,
    [measurements, selectedMeasurementId]
  );
  const latestMeasurement = measurements[0] ?? null;
  const displayedMeasurement = selectedMeasurement ?? latestMeasurement;
  const displayedHvText = formatNumber(displayedMeasurement?.hv);
  const displayedHvType = CONVERT_TYPE_OPTIONS.includes(convertType) ? convertType : 'HV';
  const mutationError = error ?? deleteError ?? convertSyncError;
  const busy = loading || deleting;

  // Single source of truth for the convert-value box. Computed live from the
  // currently selected dropdown type + the displayed row's HV so the box
  // never goes blank between dropdown change and server refetch. Always
  // resolves to a non-empty string — "N/A" when conversion is unsupported
  // or out of range.
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
    // eslint-disable-next-line no-console
    console.log(
      `[hardness-convert-render] selectedType=${activeType} rawValue=${rawValue ?? 'null'} displayValue=${display}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[hardness-convert-ui-update] convertType=${activeType} convertValue=${display}`
    );
    return display;
  }, [displayedMeasurement, convertType]);

  useEffect(() => {
    onDisplayValuesChange?.({
      hvDisplay: displayedHvText,
      hvType: displayedHvType,
      hardnessValue: displayConvertValue,
    });
  }, [displayConvertValue, displayedHvText, displayedHvType, onDisplayValuesChange]);

  // Sync the dropdown to whichever row is being shown so switching selection
  // reflects that row's saved convertType. Empty/legacy rows show 'HV'.
  useEffect(() => {
    const saved = displayedMeasurement?.convertType;
    if (saved && CONVERT_TYPE_OPTIONS.includes(saved as (typeof CONVERT_TYPE_OPTIONS)[number])) {
      setConvertType(saved as (typeof CONVERT_TYPE_OPTIONS)[number]);
    } else {
      setConvertType('HV');
      // Emitted on every measurement-success path that ends up landing here
      // (Auto Measure, Manual Measure, calibration auto-row) because none of
      // those write convertType, so this branch is the auto-default.
      if (displayedMeasurement) {
        // eslint-disable-next-line no-console
        console.log('[hv-type-auto-set] value=HV reason=measurement-success');
      }
    }
  }, [displayedMeasurement?.id, displayedMeasurement?.convertType, displayedMeasurement]);

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

  const handleManualDepthChange = useCallback(
    async (measurementId: string, depthMm: number | null) => {
      const target = measurements.find((m) => m.id === measurementId);
      if (!target) return;
      // eslint-disable-next-line no-console
      console.log(
        `[manual-depth-update] rowId=${measurementId} value=${depthMm ?? 'null'}`
      );
      // eslint-disable-next-line no-console
      console.log(`[depth-source] source=manual value=${depthMm ?? 'null'}`);
      // The backend's buildUpdateSchema injects `null` defaults for fields
      // missing from the PUT body (same trap documented on the convertType
      // handler above). A naive `{depthMm, depthSource, manualDepthMm}` PUT
      // therefore wipes convertType/convertValue/hv to null. Pass every
      // preservable field through so the partial update is non-destructive.
      const convertValue =
        typeof target.convertValue === 'number' ? target.convertValue : null;
      // eslint-disable-next-line no-console
      console.log(
        `[convert-preserve-before] rowId=${measurementId} convertType=${target.convertType ?? 'null'} convertValue=${convertValue ?? 'null'} hv=${target.hv ?? 'null'}`
      );
      try {
        await updateMeasurement(measurementId, {
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
        });
        // eslint-disable-next-line no-console
        console.log(
          `[measurement-row-update] reason=manual-depth rowId=${measurementId} preserveConvert=true`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[convert-preserve-after] rowId=${measurementId} convertType=${target.convertType ?? 'null'} convertValue=${convertValue ?? 'null'} hv=${target.hv ?? 'null'}`
        );
        // eslint-disable-next-line no-console
        console.log(`[depth-freeze-save] rowId=${measurementId} value=${depthMm ?? 'null'}`);
        await refetch();
        const idx = measurements.findIndex((m) => m.id === measurementId);
        const nextRowId = idx >= 0 ? measurements[idx + 1]?.id ?? null : null;
        // eslint-disable-next-line no-console
        console.log(
          `[manual-depth-save-success] rowId=${measurementId} value=${depthMm ?? 'null'} nextRowId=${nextRowId ?? 'null'}`
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[manual-depth-save-error]', err);
      }
    },
    [measurements, refetch]
  );

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
    onMeasurementsCleared?.();
  }, [measurements, onMeasurementsCleared, refetch, removeMeasurement]);

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
          <HvSummaryRow
            hvDisplay={displayedHvText}
            hvType={displayedHvType}
            hardnessDisplay={displayConvertValue}
            hvTypeOptions={CONVERT_TYPE_OPTIONS}
            disabled={busy}
            hvColor={
              getHardnessColor(
                typeof displayedMeasurement?.hv === 'number' ? displayedMeasurement.hv : null,
                targetMinHv,
                targetMaxHv
              ).color
            }
            onHvTypeChange={(value) =>
              void handleConvertTypeChange(value as (typeof CONVERT_TYPE_OPTIONS)[number])
            }
          />
          {(() => {
            // Render-time fallback: if an HV value is showing but the
            // dropdown state somehow isn't one of the known options (race
            // during refetch, legacy row, etc.), force 'HV' so the box is
            // never visually blank next to a populated HV value.
            const hvShown =
              typeof displayedMeasurement?.hv === 'number' &&
              Number.isFinite(displayedMeasurement.hv);
            const displayedConvertType: (typeof CONVERT_TYPE_OPTIONS)[number] =
              CONVERT_TYPE_OPTIONS.includes(convertType) ? convertType : 'HV';
            // eslint-disable-next-line no-console
            console.log(
              `[hv-type-render] selectedHardnessType=${convertType || 'null'} displayed=${hvShown ? displayedConvertType : displayedConvertType}`
            );
            return null;
          })()}
          <Typography sx={LABEL_SX}>Micrometer</Typography>
          <MicrometerDisplay sx={MICROMETER_FIELD_SX} enabled={micrometerEnabled} />
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
          onClick={() => {
            void handleClear();
          }}
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
      <ExportReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        measurements={measurements}
        cameraImageDataUrl={(displayedMeasurement?.imageDataUrl ?? null) || null}
        targetMinHv={targetMinHv}
        targetMaxHv={targetMaxHv}
      />

      <Stack direction="row" sx={STATUS_ROW_SX}>
        {busy ? <CircularProgress size={14} /> : null}
        <Typography sx={STATUS_TEXT_SX}>{statusMessage}</Typography>
      </Stack>
    </>
  );
}

export default memo(MeasurementsWorkspaceImpl);
