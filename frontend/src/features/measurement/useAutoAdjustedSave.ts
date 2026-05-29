import { useCallback, useEffect, useRef } from 'react';
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
import { getLastPaintedFrameId } from '@/hooks/useCameraStream';
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

export type UseAutoAdjustedSaveArgs = {
  // Overlay state (read + setters)
  previewAutoMeasureOverlay: AutoMeasureGraphics | null;
  setPreviewAutoMeasureOverlay: React.Dispatch<
    React.SetStateAction<AutoMeasureGraphics | null>
  >;
  setCommittedAutoMeasureOverlay: React.Dispatch<
    React.SetStateAction<AutoMeasureGraphics | null>
  >;
  displayedAutoMeasureGraphicsRef: React.MutableRefObject<AutoMeasureGraphics | null>;
  // Refs read
  activeObjectiveRef: React.MutableRefObject<string | null>;
  autoMeasurementIdRef: React.MutableRefObject<string | null>;
  calibrationManualModeRef: React.MutableRefObject<boolean>;
  committedFingerprintsRef: React.MutableRefObject<CommittedAutoMeasureFingerprint[]>;
  // Refs written
  manualMeasurementIdRef: React.MutableRefObject<string | null>;
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

// Live recompute when the user drags edges/corners on the auto-measure
// overlay. We coalesce rapid drag events with a 90ms trailing debounce so the
// DB save and refetch don't fire 60×/sec while the overlay/graphics still
// update in real time on every move. The cleanup effect cancels a pending
// trailing save when the component unmounts.
export function useAutoAdjustedSave({
  previewAutoMeasureOverlay,
  setPreviewAutoMeasureOverlay,
  setCommittedAutoMeasureOverlay,
  displayedAutoMeasureGraphicsRef,
  activeObjectiveRef,
  autoMeasurementIdRef,
  calibrationManualModeRef,
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
}: UseAutoAdjustedSaveArgs) {
  const adjustSaveTimerRef = useRef<number | null>(null);
  const lastAdjustedCornersRef = useRef<AutoMeasureCorners | null>(null);

  const handleAutoMeasureAdjusted = useCallback(
    (newCorners: AutoMeasureCorners) => {
      lastAdjustedCornersRef.current = newCorners;
      // Update graphics immediately so the overlay & any downstream readers
      // see the new corners on the next frame.
      const applyAdjustedCorners = (current: AutoMeasureGraphics | null) =>
        current ? { ...current, corners: newCorners } : current;
      if (previewAutoMeasureOverlay) {
        setPreviewAutoMeasureOverlay(applyAdjustedCorners);
      } else {
        setCommittedAutoMeasureOverlay(applyAdjustedCorners);
      }

      // Calibration mode: the calibration panel's Pixel X / Pixel Y inputs
      // are bound to latestManualPixels. Push the new diagonals through
      // immediately so the form reflects every drag, and skip the
      // measurement-row debounce below — calibration must not create a row
      // until the user clicks Add Calibration.
      if (calibrationManualModeRef.current) {
        const d1Px = Math.hypot(
          newCorners.right.x - newCorners.left.x,
          newCorners.right.y - newCorners.left.y
        );
        const d2Px = Math.hypot(
          newCorners.bottom.x - newCorners.top.x,
          newCorners.bottom.y - newCorners.top.y
        );
        setLatestManualPixels({ d1Px, d2Px });
        if (adjustSaveTimerRef.current !== null) {
          window.clearTimeout(adjustSaveTimerRef.current);
          adjustSaveTimerRef.current = null;
        }
        return;
      }

      if (adjustSaveTimerRef.current !== null) {
        window.clearTimeout(adjustSaveTimerRef.current);
      }
      adjustSaveTimerRef.current = window.setTimeout(() => {
        adjustSaveTimerRef.current = null;
        const corners = lastAdjustedCornersRef.current;
        if (!corners) return;
        void (async () => {
          try {
            const machineState = await getMachineStateSnapshot();
            // Same single source of truth as Auto Measure / Manual Measure.
            // No dialog-default silent fallback.
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

            // Line drag must NEVER create a new row — that's how depth was
            // silently being lost. Fall back to the active row id so an
            // empty autoMeasurementIdRef (cross-flow edge case) still

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
            // Deterministic finalize for the adjusted-corners save too.
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
            // Depth + conversion fields must survive a line drag. The backend's
            // buildUpdateSchema injects `null` defaults for fields missing from
            // the PUT body, so an "omit depth" payload would wipe depthMm /
            // depthSource / deviceDepthMm / manualDepthMm / convertType /
            // convertValue to null on every adjust. Pass them through from the
            // existing row when we're updating (not creating).
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
      calibrationManualModeRef,
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
