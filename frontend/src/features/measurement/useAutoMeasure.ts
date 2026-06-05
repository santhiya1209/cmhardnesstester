import { useCallback, useEffect, useRef } from 'react';
import type { CalibrationMeasureMode } from '@/features/manualMeasure/useCalibrationManualMeasure';
import type { CameraWindowHandle } from '@/component/own/CameraWindow';
import type { CalibrationSettings } from '@/types/calibrationSettings';
import type { Calibration } from '@/types/calibration';
import type { MachineState } from '@/types/machine';
import type {
  AutoMeasureCorners,
  AutoMeasureGraphics,
} from '@/types/autoMeasure';
import type {
  Measurement,
  MeasurementSavePayload,
} from '@/types/measurement';
import { getLastPaintedFrameId } from '@/hooks/cameraStreamManager';
import {
  buildAutoMeasureFingerprintKey,
  cloneAutoMeasureGraphics,
  normalizeAutoMeasureFingerprintObjective,
  roundAutoMeasurePixel,
  upsertCommittedAutoMeasureFingerprint,
  type CommittedAutoMeasureFingerprint,
} from '@/features/autoMeasure/autoMeasureHelpers';
import { autoMeasureCornersKey } from '@/utils/autoMeasureOverlayKey';
import {
  calculateVickersFromPixels,
  parseForceKgf,
} from '@/utils/manualMeasure';
import {
  deriveQualifiedForRow,
  waitForOverlayPaint,
} from '@/features/measurement/measurementRowHelpers';

type SaveMeasurementInput = {
  id?: string;
  values: MeasurementSavePayload;
};

export type UseAutoMeasureArgs = {
  previewAutoMeasureOverlay: AutoMeasureGraphics | null;
  setPreviewAutoMeasureOverlay: React.Dispatch<
    React.SetStateAction<AutoMeasureGraphics | null>
  >;
  setCommittedAutoMeasureOverlay: React.Dispatch<
    React.SetStateAction<AutoMeasureGraphics | null>
  >;
  displayedAutoMeasureGraphicsRef: React.MutableRefObject<AutoMeasureGraphics | null>;
  activeObjectiveRef: React.MutableRefObject<string | null>;
  autoMeasurementIdRef: React.MutableRefObject<string | null>;
  autoMeasureSelectedLineRef: React.MutableRefObject<'top' | 'right' | 'bottom' | 'left' | null>;
  calibrationManualModeRef: React.MutableRefObject<boolean>;
  calibrationMeasureModeRef: React.MutableRefObject<CalibrationMeasureMode>;
  committedFingerprintsRef: React.MutableRefObject<CommittedAutoMeasureFingerprint[]>;
  manualMeasurementIdRef: React.MutableRefObject<string | null>;
  activeMeasurementMethodRef: React.MutableRefObject<string | null>;
  measurements: Measurement[];
  calibrationSettings: CalibrationSettings | null;
  calibrations: Calibration[];
  calibrationSettingsList: CalibrationSettings[];
  cameraRef: React.RefObject<CameraWindowHandle | null>;
  setUnavailableMsg: React.Dispatch<React.SetStateAction<string | null>>;
  setStatusMessage: (message: string) => void;
  setLatestManualPixels: (pixels: { d1Px: number; d2Px: number } | null) => void;
  getMachineStateSnapshot: () => Promise<MachineState | null>;
  getActiveMeasurementId: () => string | undefined;
  setActiveMeasurement: (id: string, frameId: number | null, reason: string) => void;
  saveManualMeasurement: (input: SaveMeasurementInput) => Promise<Measurement>;
  refetchMeasurements: () => Promise<unknown> | unknown;
};

export function useAutoMeasure({
  previewAutoMeasureOverlay,
  setPreviewAutoMeasureOverlay,
  setCommittedAutoMeasureOverlay,
  displayedAutoMeasureGraphicsRef,
  activeObjectiveRef,
  autoMeasurementIdRef,
  autoMeasureSelectedLineRef,
  calibrationManualModeRef,
  calibrationMeasureModeRef,
  committedFingerprintsRef,
  manualMeasurementIdRef,
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
}: UseAutoMeasureArgs) {
  const adjustSaveTimerRef = useRef<number | null>(null);
  const lastAdjustedCornersRef = useRef<AutoMeasureCorners | null>(null);

  const handleAutoMeasureAdjusted = useCallback(
    (newCorners: AutoMeasureCorners) => {
      lastAdjustedCornersRef.current = newCorners;
      // Debounce every React-state + save effect. A drag/keyboard burst calls
      // this per pixel; the overlay already shows the live corners via its own
      // local state, so the source-of-truth sync, HV recompute and save run once
      // the move settles instead of re-rendering the whole panel on each step.
      if (adjustSaveTimerRef.current !== null) {
        window.clearTimeout(adjustSaveTimerRef.current);
      }
      adjustSaveTimerRef.current = window.setTimeout(() => {
        adjustSaveTimerRef.current = null;
        const corners = lastAdjustedCornersRef.current;
        if (!corners) return;

        const applyAdjustedCorners = (current: AutoMeasureGraphics | null) =>
          current ? { ...current, corners } : current;
        if (previewAutoMeasureOverlay) {
          setPreviewAutoMeasureOverlay(applyAdjustedCorners);
        } else {
          setCommittedAutoMeasureOverlay(applyAdjustedCorners);
        }

        if (calibrationManualModeRef.current) {
          const d1Px = Math.hypot(
            corners.right.x - corners.left.x,
            corners.right.y - corners.left.y
          );
          const d2Px = Math.hypot(
            corners.bottom.x - corners.top.x,
            corners.bottom.y - corners.top.y
          );
          setLatestManualPixels({ d1Px, d2Px });
          return;
        }

        if (calibrationMeasureModeRef.current === 'auto') {
          const d1Px = Math.abs(corners.right.x - corners.left.x);
          const d2Px = Math.abs(corners.bottom.y - corners.top.y);
          setLatestManualPixels({ d1Px, d2Px });
          // eslint-disable-next-line no-console
          console.log(
            `[calibration-line-drag] line=${autoMeasureSelectedLineRef.current ?? 'unknown'} pixelX=${d1Px.toFixed(2)} pixelY=${d2Px.toFixed(2)}`
          );
          return;
        }

        void (async () => {
          try {
            const machineState = await getMachineStateSnapshot();
            const objectiveForCalibration = activeObjectiveRef.current?.trim() || null;
            if (!objectiveForCalibration) {
              setStatusMessage('System Status: Auto (Adjusted) blocked: no active objective');
              return;
            }
            const machineStateForAuto = machineState
              ? { ...machineState, objective: objectiveForCalibration }
              : null;
            const forceKgf = parseForceKgf(machineState?.force);

            const d1Px = Math.hypot(
              corners.right.x - corners.left.x,
              corners.right.y - corners.left.y
            );
            const d2Px = Math.hypot(
              corners.bottom.x - corners.top.x,
              corners.bottom.y - corners.top.y
            );

            const targetId =
              autoMeasurementIdRef.current ?? getActiveMeasurementId() ?? undefined;
            const timestamp = new Date().toISOString();
            const targetExisting = targetId
              ? measurements.find((m) => m.id === targetId)
              : null;

            const conversion = calculateVickersFromPixels({
              calibrationSettings,
              calibrationSettingsList,
              calibrations,
              d1Px,
              d2Px,
              forceKgf,
              machineState: machineStateForAuto,
              objective: objectiveForCalibration,
              targetObjective: objectiveForCalibration,
            });
            if (!conversion.ok) {
              setUnavailableMsg(conversion.reason);
              setStatusMessage(`System Status: Auto (Adjusted) blocked: ${conversion.reason}`);
              return;
            }
            const values = conversion.value;

            await waitForOverlayPaint();
            const adjustedCornersKey = autoMeasureCornersKey(corners);
            // eslint-disable-next-line no-console
            console.log(`[auto-measure-final-corners] source=adjusted key=${adjustedCornersKey}`);
            // eslint-disable-next-line no-console
            console.log(`[album-overlay-source] source=adjusted-final key=${adjustedCornersKey}`);
            const imageDataUrl =
              (await cameraRef.current?.captureFinalizedThumbnail(adjustedCornersKey)) ?? undefined;
            if (imageDataUrl) {
              // eslint-disable-next-line no-console
              console.log(`[album-overlay-save] source=adjusted key=${adjustedCornersKey}`);
            } else {
              // eslint-disable-next-line no-console
              console.warn('[album] missing image for measurementId=', targetId ?? 'new');
            }
            const preservedConvertValue =
              typeof targetExisting?.convertValue === 'number'
                ? targetExisting.convertValue
                : null;
            const preserveFields = targetExisting
              ? {
                  depthMm: targetExisting.depthMm ?? null,
                  depthSource: targetExisting.depthSource ?? null,
                  deviceDepthMm: targetExisting.deviceDepthMm ?? null,
                  manualDepthMm: targetExisting.manualDepthMm ?? null,
                  convertType: targetExisting.convertType ?? null,
                  convertValue: preservedConvertValue,
                }
              : {};
            const saved = await saveManualMeasurement({
              id: targetId,
              values: {
                d1: values.d1Um,
                d2: values.d2Um,
                d1Px: values.d1Px,
                d2Px: values.d2Px,
                d1Um: values.d1Um,
                d2Um: values.d2Um,
                averageUm: values.avgDUm,
                averageMm: values.avgDMm,
                hv: values.hv,
                hardnessType: 'HV',
                qualified: deriveQualifiedForRow(values.hv),
                micronPerPixel: values.umPerPixel,
                calibrationName: values.calibrationName,
                objective: values.normalizedObjective,
                testForceKgf: values.forceKgf,
                ...preserveFields,
                method: 'Auto (Adjusted)',
                unit: 'um',
                timestamp,
                imageDataUrl,
              },
            });
            autoMeasurementIdRef.current = saved.id;
            manualMeasurementIdRef.current = saved.id;
            // eslint-disable-next-line no-console
            console.warn(`[measurement-add] objective=${saved.objective ?? values.normalizedObjective ?? 'null'}`);
            {
              const adjFrameId = getLastPaintedFrameId();
              const savedAdjMethod = saved.method ?? 'Auto (Adjusted)';
              setActiveMeasurement(saved.id, adjFrameId, 'auto-adjust-save');
              activeMeasurementMethodRef.current = savedAdjMethod;
            }
            const centerX = (corners.left.x + corners.right.x) / 2;
            const centerY = (corners.top.y + corners.bottom.y) / 2;
            const stableCenterX = roundAutoMeasurePixel(centerX);
            const stableCenterY = roundAutoMeasurePixel(centerY);
            const fingerprintObjective = normalizeAutoMeasureFingerprintObjective(objectiveForCalibration);
            const fingerprintKey = buildAutoMeasureFingerprintKey({
              objective: fingerprintObjective,
              centerX: stableCenterX,
              centerY: stableCenterY,
              d1Px: values.d1Px,
              d2Px: values.d2Px,
            });
            const baseGraphics = displayedAutoMeasureGraphicsRef.current;
            if (baseGraphics) {
              const committedGraphics = cloneAutoMeasureGraphics({ ...baseGraphics, corners });
              committedFingerprintsRef.current = upsertCommittedAutoMeasureFingerprint(
                committedFingerprintsRef.current,
                {
                  objective: fingerprintObjective,
                  frameId:
                    typeof baseGraphics.frameId === 'number' && Number.isFinite(baseGraphics.frameId)
                      ? baseGraphics.frameId
                      : null,
                  d1Px: values.d1Px,
                  d2Px: values.d2Px,
                  centerX: stableCenterX,
                  centerY: stableCenterY,
                  hv:
                    typeof saved.hv === 'number' && Number.isFinite(saved.hv)
                      ? saved.hv
                      : values.hv,
                  d1Um: values.d1Um,
                  d2Um: values.d2Um,
                  avgDUm: values.avgDUm,
                  avgDMm: values.avgDMm,
                  rowId: saved.id,
                  fingerprintKey,
                  corners: committedGraphics.corners,
                  graphics: committedGraphics,
                }
              );
            }
            await refetchMeasurements();
            setStatusMessage(
              saved.hv
                ? `System Status: Auto (Adjusted) updated: HV ${saved.hv}`
                : `System Status: Auto (Adjusted) updated: ${values.d1Um} µm / ${values.d2Um} µm`
            );
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[auto-measure] adjust save failed:', err);
          }
        })();
      }, 90);
    },
    [
      activeMeasurementMethodRef,
      activeObjectiveRef,
      autoMeasurementIdRef,
      autoMeasureSelectedLineRef,
      calibrationManualModeRef,
      calibrationMeasureModeRef,
      calibrationSettings,
      calibrationSettingsList,
      calibrations,
      cameraRef,
      committedFingerprintsRef,
      displayedAutoMeasureGraphicsRef,
      getActiveMeasurementId,
      getMachineStateSnapshot,
      manualMeasurementIdRef,
      measurements,
      previewAutoMeasureOverlay,
      refetchMeasurements,
      saveManualMeasurement,
      setActiveMeasurement,
      setCommittedAutoMeasureOverlay,
      setLatestManualPixels,
      setPreviewAutoMeasureOverlay,
      setStatusMessage,
      setUnavailableMsg,
    ]
  );

  useEffect(() => {
    return () => {
      if (adjustSaveTimerRef.current !== null) {
        window.clearTimeout(adjustSaveTimerRef.current);
      }
    };
  }, []);

  return { handleAutoMeasureAdjusted };
}
