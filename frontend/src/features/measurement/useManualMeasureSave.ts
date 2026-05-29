import { useCallback } from 'react';
import type { CameraWindowHandle } from '@/component/own/CameraWindow';
import type { CalibrationSettings } from '@/types/calibrationSettings';
import type { Calibration } from '@/types/calibration';
import type { MachineState } from '@/types/machine';
import type { ManualMeasureDragResult } from '@/types/manualMeasure';
import type {
  Measurement,
  MeasurementSavePayload,
} from '@/types/measurement';
import { getLastPaintedFrameId } from '@/hooks/useCameraStream';
import {
  calculateManualDiagonalsFromPixels,
  calculateVickersFromPixels,
  parseForceKgf,
} from '@/utils/manualMeasure';
import {
  buildNewRowDepthPayload,
  deriveQualifiedForRow,
  waitForOverlayPaint,
  type DepthSavePayload,
} from '@/features/measurement/measurementRowHelpers';

type SaveMeasurementInput = {
  id?: string;
  values: MeasurementSavePayload;
};

export type UseManualMeasureSaveArgs = {
  // Refs read
  activeObjectiveRef: React.MutableRefObject<string | null>;
  manualMeasurementIdRef: React.MutableRefObject<string | null>;
  calibrationManualModeRef: React.MutableRefObject<boolean>;
  micrometerEnabledRef: React.MutableRefObject<boolean>;
  // Refs written
  autoMeasurementIdRef: React.MutableRefObject<string | null>;
  activeMeasurementMethodRef: React.MutableRefObject<string | null>;
  // Closure state
  measurements: Measurement[];
  calibrationSettings: CalibrationSettings | null;
  calibrations: Calibration[];
  calibrationSettingsList: CalibrationSettings[];
  cameraRef: React.RefObject<CameraWindowHandle | null>;
  // Setters
  setUnavailableMsg: React.Dispatch<React.SetStateAction<string | null>>;
  setStatusMessage: (message: string) => void;
  setLatestManualPixels: (pixels: { d1Px: number; d2Px: number } | null) => void;
  // Hook-provided callbacks
  getMachineStateSnapshot: () => Promise<MachineState | null>;
  getActiveMeasurementId: () => string | undefined;
  setActiveMeasurement: (id: string, frameId: number | null, reason: string) => void;
  saveManualMeasurement: (input: SaveMeasurementInput) => Promise<Measurement>;
  refetchMeasurements: () => Promise<unknown> | unknown;
};

export function useManualMeasureSave({
  activeObjectiveRef,
  manualMeasurementIdRef,
  calibrationManualModeRef,
  micrometerEnabledRef,
  autoMeasurementIdRef,
  activeMeasurementMethodRef,
  measurements,
  calibrationSettings,
  calibrations,
  calibrationSettingsList,
  cameraRef,
  setUnavailableMsg,
  setStatusMessage,
  setLatestManualPixels,
  getMachineStateSnapshot,
  getActiveMeasurementId,
  setActiveMeasurement,
  saveManualMeasurement,
  refetchMeasurements,
}: UseManualMeasureSaveArgs) {
  const handleManualMeasurementUpdated = useCallback(
    (result: ManualMeasureDragResult) => {
      // Spec-format drag trace: fires every time the manual overlay emits a
      // new diagonal — i.e. on every handle drag commit. Coordinates are in
      // image-space (the manual overlay already maps client→image).
      void (async () => {
        try {
          const machineState = await getMachineStateSnapshot();
          const timestamp = new Date().toISOString();
          // "New" means there's no row to update — neither the manual id
          // nor the cross-flow active id. Without this, dragging a Manual
          // line after an Auto save re-reads the micrometer and clobbers
          // the existing row's depth.
          const manualPreflightActiveId = getActiveMeasurementId();
          const isNewManualMeasurement =
            manualMeasurementIdRef.current === null && !manualPreflightActiveId;
          const manualDepthCapture: DepthSavePayload | null = isNewManualMeasurement
            ? await buildNewRowDepthPayload(micrometerEnabledRef.current)
            : null;
          const manualExistingRowId =
            manualMeasurementIdRef.current ?? manualPreflightActiveId ?? null;
          const manualExistingRow = manualExistingRowId
            ? measurements.find((m) => m.id === manualExistingRowId) ?? null
            : null;
          // For an updated row (line drag, re-measure) we must echo back the
          // saved depth + conversion fields. The backend's buildUpdateSchema
          // injects null defaults for fields missing from the PUT body, so
          // omitting them would wipe depthMm / depthSource / device + manual
          // depth / convertType / convertValue. New rows freeze the device
          // value (or none, if disabled) via manualDepthCapture.
          const depthPayload = manualDepthCapture
            ? {
                depthMm: manualDepthCapture.depthMm,
                depthSource: manualDepthCapture.depthSource,
                deviceDepthMm: manualDepthCapture.deviceDepthMm,
                manualDepthMm: manualDepthCapture.manualDepthMm,
              }
            : manualExistingRow
              ? {
                  depthMm: manualExistingRow.depthMm ?? null,
                  depthSource: manualExistingRow.depthSource ?? null,
                  deviceDepthMm: manualExistingRow.deviceDepthMm ?? null,
                  manualDepthMm: manualExistingRow.manualDepthMm ?? null,
                  convertType: manualExistingRow.convertType ?? null,
                  convertValue:
                    typeof manualExistingRow.convertValue === 'number'
                      ? manualExistingRow.convertValue
                      : null,
                }
              : {};
          if (isNewManualMeasurement && manualDepthCapture) {
          }
          const pixelValues = calculateManualDiagonalsFromPixels(
            result.d1Px,
            result.d2Px,
            1
          );

          if (!pixelValues) {
            // eslint-disable-next-line no-console
            console.warn(
              `[measurement-commit-blocked] method=Manual reason=invalid-pixel-values d1Px=${result.d1Px} d2Px=${result.d2Px}`
            );
            setUnavailableMsg('Manual Measure requires valid D1/D2 values greater than 0.');
            return;
          }

          // Stash the most recent manual pixel diagonals so the Calibration
          // dialog can auto-fill Pixel Length X / Y without the user having
          // to retype what they just measured on the live image.
          if (Number.isFinite(result.d1Px) && Number.isFinite(result.d2Px) && result.d1Px > 0 && result.d2Px > 0) {
            setLatestManualPixels({ d1Px: result.d1Px, d2Px: result.d2Px });
          }

          // Calibration mode: the manual diamond is being used to PICK pixel
          // diagonals for calibration only. Do NOT save a measurement row —
          // calibration auto/manual must not pollute the measurement table.
          // The pixel values are already captured into latestManualPixels.
          if (calibrationManualModeRef.current) {
            // eslint-disable-next-line no-console
            console.warn(
              '[measurement-commit-blocked] method=Manual reason=calibration-manual-mode flag=true — drag is for calibration, no row created. (Closes when Add Calibration succeeds or dialog closes.)'
            );
            return;
          }

          const targetObjective = activeObjectiveRef.current?.trim() || null;
          if (!targetObjective) {
            // eslint-disable-next-line no-console
            console.warn(
              '[measurement-commit-blocked] method=Manual reason=no-active-objective activeObjective=null'
            );
            setUnavailableMsg(
              'No active objective. Please click 10X or 40X in Machine Control before measuring.'
            );
            return;
          }
          const machineStateForManual = machineState
            ? { ...machineState, objective: targetObjective }
            : null;
          const forceKgf = parseForceKgf(machineState?.force);
          const conversion = calculateVickersFromPixels({
            calibrationSettings,
            calibrations,
            machineState: machineStateForManual,
            d1Px: result.d1Px,
            d2Px: result.d2Px,
            forceKgf,
            objective: targetObjective,
            targetObjective,
            calibrationSettingsList,
          });


          if (!conversion.ok) {
            // eslint-disable-next-line no-console
            console.warn(
              `[measurement-commit-blocked] method=Manual reason=conversion-failed detail="${conversion.reason}" objective=${targetObjective}`
            );
            setUnavailableMsg(conversion.reason);
            setStatusMessage(`System Status: Manual Measure blocked: ${conversion.reason}`);
            return;
          }

          const values = conversion.value;


          await waitForOverlayPaint();
          const imageDataUrl = cameraRef.current?.captureThumbnailDataUrl() ?? undefined;
          if (imageDataUrl) {
          } else {
            // eslint-disable-next-line no-console
            console.warn('[album] missing image for measurementId=', manualMeasurementIdRef.current ?? 'new');
          }
          const rowPayload = {
            d1: values.d1Um,
            d2: values.d2Um,
            d1Px: values.d1Px,
            d2Px: values.d2Px,
            d1Um: values.d1Um,
            d2Um: values.d2Um,
            averageUm: values.avgDUm,
            averageMm: values.avgDMm,
            hv: values.hv,
            hardnessType: 'HV' as const,
            qualified: deriveQualifiedForRow(values.hv),
            micronPerPixel: values.umPerPixel,
            calibrationName: values.calibrationName,
            objective: values.normalizedObjective,
            testForceKgf: values.forceKgf,
            ...depthPayload,
            method: 'Manual' as const,
            unit: 'um' as const,
            timestamp,
            imageDataUrl,
          };
          const manualFrameId = getLastPaintedFrameId();
          const manualReuseId =
            manualMeasurementIdRef.current ?? getActiveMeasurementId();
          if (manualReuseId && manualMeasurementIdRef.current === null) {
          }
          const saved = await saveManualMeasurement({
            id: manualReuseId ?? undefined,
            values: rowPayload,
          });
          const savedManualMethod = saved.method ?? 'Manual';
          if (isNewManualMeasurement && manualDepthCapture) {
          } else if (!isNewManualMeasurement) {
          }
          setActiveMeasurement(saved.id, manualFrameId, 'manual-save');
          activeMeasurementMethodRef.current = savedManualMethod;
          autoMeasurementIdRef.current = saved.id;

          manualMeasurementIdRef.current = saved.id;
          // eslint-disable-next-line no-console
          console.warn(`[measurement-add] objective=${saved.objective ?? values.normalizedObjective ?? 'null'}`);
          await refetchMeasurements();
          setStatusMessage(
            `System Status: Manual measurement updated: HV ${values.hv ?? 'n/a (force missing)'}`
          );
        } catch (err) {
          // Surface the real backend error (axios response body / zod issues)
          // to the console — without this the user sees only the popup and we
          // have no way to diagnose validation rejections.
          // eslint-disable-next-line no-console
          console.error('[measurement-row-save-error] method=Manual', err);
          // Cast to a loose shape to avoid a hard import of axios types here.
          const ax = err as { response?: { status?: number; data?: unknown } };
          if (ax.response) {
            // eslint-disable-next-line no-console
            console.error(
              `[measurement-row-save-error] http=${ax.response.status} body=${JSON.stringify(ax.response.data)}`
            );
          }
          setUnavailableMsg(
            `Manual Measure failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      })();
    },
    [
      activeMeasurementMethodRef,
      activeObjectiveRef,
      autoMeasurementIdRef,
      calibrationManualModeRef,
      calibrationSettings,
      calibrationSettingsList,
      calibrations,
      cameraRef,
      getActiveMeasurementId,
      getMachineStateSnapshot,
      manualMeasurementIdRef,
      measurements,
      micrometerEnabledRef,
      refetchMeasurements,
      saveManualMeasurement,
      setActiveMeasurement,
      setLatestManualPixels,
      setStatusMessage,
      setUnavailableMsg,
    ]
  );

  return { handleManualMeasurementUpdated };
}
