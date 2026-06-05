import { useCallback } from 'react';
import type { CameraWindowHandle } from '@/component/own/CameraWindow';
import type {
  Measurement,
  MeasurementSavePayload,
} from '@/types/measurement';
import type {
  Calibration,
  CalibrationSavePayload,
} from '@/types/calibration';
import type { CalibrationSettings } from '@/types/calibrationSettings';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';
import { getLastPaintedFrameId } from '@/hooks/cameraStreamManager';
import {
  findCalibrationForObjective,
  normalizeObjectiveName,
  parseForceKgf,
} from '@/utils/manualMeasure';
import {
  deriveQualifiedForRow,
  readLatestMicrometerDepthMm,
  waitForOverlayPaint,
} from '@/features/measurement/measurementRowHelpers';

type SaveMeasurementInput = {
  id?: string;
  values: MeasurementSavePayload;
};

export type UseCalibrationArgs = {
  activeObjectiveRef: React.MutableRefObject<string | null>;
  calibrationMeasureModeRef: React.MutableRefObject<'none' | 'auto' | 'manual'>;
  manualMeasurementIdRef: React.MutableRefObject<string | null>;
  autoMeasurementIdRef: React.MutableRefObject<string | null>;
  activeMeasurementMethodRef: React.MutableRefObject<string | null>;
  calibrationSettingsList: CalibrationSettings[];
  cameraRef: React.RefObject<CameraWindowHandle | null>;
  setUnavailableMsg: React.Dispatch<React.SetStateAction<string | null>>;
  setStatusMessage: (message: string) => void;
  setCommittedAutoMeasureOverlay: React.Dispatch<
    React.SetStateAction<AutoMeasureGraphics | null>
  >;
  setPreviewAutoMeasureOverlay: React.Dispatch<
    React.SetStateAction<AutoMeasureGraphics | null>
  >;
  setManualMeasureResetKey: React.Dispatch<React.SetStateAction<number>>;
  getActiveMeasurementId: () => string | undefined;
  setActiveMeasurement: (id: string, frameId: number | null, reason: string) => void;
  saveManualMeasurement: (input: SaveMeasurementInput) => Promise<Measurement>;
  refetchMeasurements: () => Promise<unknown> | unknown;
};

export type CalibrationRowSaveArgs = {
  savedCalibration: Calibration;
  payload: CalibrationSavePayload;
};

export function useCalibration({
  activeObjectiveRef,
  calibrationMeasureModeRef,
  manualMeasurementIdRef,
  autoMeasurementIdRef,
  activeMeasurementMethodRef,
  calibrationSettingsList,
  cameraRef,
  setUnavailableMsg,
  setStatusMessage,
  setCommittedAutoMeasureOverlay,
  setPreviewAutoMeasureOverlay,
  setManualMeasureResetKey,
  getActiveMeasurementId,
  setActiveMeasurement,
  saveManualMeasurement,
  refetchMeasurements,
}: UseCalibrationArgs) {
  const handleCalibrationAutoCreateRow = useCallback(
    async ({
      payload,
    }: CalibrationRowSaveArgs) => {
      const d1Px = payload.pixelLengthX;
      const d2Px = payload.pixelLengthY;
      const targetObjective = activeObjectiveRef.current?.trim() || null;
      const forceKgf = parseForceKgf(payload.force);

      if (!targetObjective) {
        // eslint-disable-next-line no-console
        console.warn('[calibration-auto-row-blocked] reason=no-active-objective activeObjective=null');
        setUnavailableMsg('No active objective. Please click 10X or 40X in Machine Control before adding a row.');
        return;
      }

      const settingsMatch = findCalibrationForObjective(
        calibrationSettingsList,
        targetObjective
      );
      const umPerPixelFromSettings =
        settingsMatch?.umPerPixel ?? settingsMatch?.pixelToMicron ?? 0;
      const knownReferenceUm =
        typeof payload.realDistanceX === 'number' && payload.realDistanceX > 0
          ? payload.realDistanceX
          : typeof payload.realDistanceY === 'number' && payload.realDistanceY > 0
            ? payload.realDistanceY
            : 0;
      const xUmPerPixel =
        umPerPixelFromSettings > 0
          ? umPerPixelFromSettings
          : d1Px > 0 && knownReferenceUm > 0
            ? knownReferenceUm / d1Px
            : 0;
      const yUmPerPixel =
        umPerPixelFromSettings > 0
          ? umPerPixelFromSettings
          : d2Px > 0 && knownReferenceUm > 0
            ? knownReferenceUm / d2Px
            : 0;

      if (!Number.isFinite(d1Px) || !Number.isFinite(d2Px) || d1Px <= 0 || d2Px <= 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[calibration-auto-row-blocked] reason=invalid-pixel-values d1Px=${d1Px} d2Px=${d2Px}`
        );
        setUnavailableMsg('D1/D2 pixel values are zero. Run Manual or Auto Measure first.');
        return;
      }

      if (xUmPerPixel <= 0 || yUmPerPixel <= 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[calibration-auto-row-blocked] reason=known-reference-missing-or-zero objective=${targetObjective} knownReferenceUm=${knownReferenceUm} settingsMatch=${settingsMatch ? 'yes' : 'no'}`
        );
        setUnavailableMsg(
          'Calibration saved, but Known Reference (µm) is zero — cannot derive xUmPerPixel / yUmPerPixel for the row.'
        );
        setStatusMessage(
          'System Status: Calibration saved. Auto row blocked: known-reference-missing-or-zero'
        );
        return;
      }

      const d1UmExact = d1Px * xUmPerPixel;
      const d2UmExact = d2Px * yUmPerPixel;
      const davgUmExact = (d1UmExact + d2UmExact) / 2;
      const davgMmExact = davgUmExact / 1000;
      const hvExact =
        forceKgf && forceKgf > 0 && davgMmExact > 0
          ? (1.8544 * forceKgf) / (davgMmExact * davgMmExact)
          : null;

      const round = (value: number, digits: number): number =>
        Number(value.toFixed(digits));

      const d1Um = round(d1UmExact, 3);
      const d2Um = round(d2UmExact, 3);
      const averageUm = round(davgUmExact, 3);
      const averageMm = round(davgMmExact, 6);
      const hv = hvExact === null ? null : round(hvExact, 2);

      if (d1Um <= 0 || d2Um <= 0 || averageUm <= 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[calibration-auto-row-blocked] reason=converted-values-non-positive d1Um=${d1Um} d2Um=${d2Um} averageUm=${averageUm}`
        );
        setUnavailableMsg('Computed µm values are zero — calibration coefficient is too small.');
        return;
      }
      if (hv !== null && hv <= 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[calibration-auto-row-blocked] reason=hv-non-positive hv=${hv} hvExact=${hvExact} davgMm=${davgMmExact}`
        );
        setUnavailableMsg(
          'Computed HV is non-positive — check force / calibration coefficient.'
        );
        return;
      }

      const normalizedObjective = normalizeObjectiveName(targetObjective);

      let depthMm: number | null = null;
      try {
        depthMm = await readLatestMicrometerDepthMm();
      } catch {
        depthMm = null;
      }
      await waitForOverlayPaint();
      const imageDataUrl = cameraRef.current?.captureThumbnailDataUrl() ?? undefined;

      const calibrationMode = calibrationMeasureModeRef.current;
      const resolvedMethod: 'Auto' | 'Manual' =
        calibrationMode === 'auto' ? 'Auto' : 'Manual';
      const rowPayload = {
        d1: d1Um,
        d2: d2Um,
        d1Px: round(d1Px, 2),
        d2Px: round(d2Px, 2),
        d1Um,
        d2Um,
        averageUm,
        averageMm,
        hv,
        hardnessType: 'HV' as const,
        qualified: deriveQualifiedForRow(hv),
        micronPerPixel: round((xUmPerPixel + yUmPerPixel) / 2, 6),
        calibrationName: settingsMatch?.objective ?? `${payload.zoomTime} ${payload.force} ${payload.hardnessLevel}`,
        objective: normalizedObjective,
        testForceKgf: forceKgf,
        depthMm,
        method: resolvedMethod,
        unit: 'um' as const,
        timestamp: new Date().toISOString(),
        imageDataUrl,
      };

      try {
        const calibrationFrameId = getLastPaintedFrameId();
        const reuseId = getActiveMeasurementId();
        if (reuseId) {
        }
        const saved = await saveManualMeasurement({ id: reuseId, values: rowPayload });
        setActiveMeasurement(saved.id, calibrationFrameId, 'calibration-save');
        manualMeasurementIdRef.current = saved.id;
        autoMeasurementIdRef.current = saved.id;
        // eslint-disable-next-line no-console
        console.warn(`[measurement-add] objective=${saved.objective ?? normalizedObjective ?? 'null'}`);
        const savedMethod = saved.method ?? resolvedMethod;
        activeMeasurementMethodRef.current = savedMethod;
        await refetchMeasurements();
        setCommittedAutoMeasureOverlay(null);
        setPreviewAutoMeasureOverlay(null);
        setManualMeasureResetKey((current) => current + 1);
        setStatusMessage(
          `System Status: Calibration saved. Measurement row added: HV ${hv ?? 'n/a (force missing)'}`
        );
      } catch (saveErr) {
        const ax = saveErr as { response?: { status?: number; data?: unknown } };
        // eslint-disable-next-line no-console
        console.warn(
          `[calibration-auto-row-blocked] reason=row-save-failed http=${ax.response?.status ?? '?'} body=${JSON.stringify(ax.response?.data ?? null)} detail="${saveErr instanceof Error ? saveErr.message : String(saveErr)}"`
        );
        setUnavailableMsg(
          `Failed to save measurement row: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`
        );
      }
    },
    [
      activeMeasurementMethodRef,
      activeObjectiveRef,
      autoMeasurementIdRef,
      calibrationMeasureModeRef,
      calibrationSettingsList,
      cameraRef,
      getActiveMeasurementId,
      manualMeasurementIdRef,
      refetchMeasurements,
      saveManualMeasurement,
      setActiveMeasurement,
      setCommittedAutoMeasureOverlay,
      setManualMeasureResetKey,
      setPreviewAutoMeasureOverlay,
      setStatusMessage,
      setUnavailableMsg,
    ]
  );

  return { handleCalibrationAutoCreateRow };
}
