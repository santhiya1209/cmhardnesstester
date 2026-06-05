import { measureVickersAuto, measureVickersAutoPreview } from '@/api/system';
import type { VickersAutoMeasureResult } from '@/types/autoMeasure';
import {
  OBJECTIVE_FOR_MEASURE_OPTIONS,
  type AutoMeasureSettingsPayload,
  type ObjectiveForMeasure,
} from '@/types/autoMeasureSettings';
import {
  logAutoMeasurePhase,
  type AutoMeasureCallSource,
  type CapturedAutoMeasureFrame,
} from './autoMeasureHelpers';

type CalibrationLike = { micronPerPixel: number } | null | undefined;

export type RunNativeDetectionArgs = {
  preview: boolean;
  callSource: AutoMeasureCallSource;
  settings: AutoMeasureSettingsPayload;
  objectiveForCalibration: string;
  displayedFrame: CapturedAutoMeasureFrame;
  capturedFrameIdForRun: number | null;
  calibration: CalibrationLike;
  forceKgf: number | null;
  minConfidence: number;
};

export type RunNativeDetectionResult = {
  nativeResult: VickersAutoMeasureResult;
  liveObjectiveForNative: ObjectiveForMeasure;
  runSmoothing: number;
  runThreshold: number;
};

export async function runNativeDetection({
  preview,
  callSource,
  settings,
  objectiveForCalibration,
  displayedFrame,
  capturedFrameIdForRun,
  calibration,
  forceKgf,
  minConfidence,
}: RunNativeDetectionArgs): Promise<RunNativeDetectionResult> {
  const runSmoothing = settings.smoothing;
  const runThreshold = settings.threshold;
  if (callSource === 'auto-click') {
    // eslint-disable-next-line no-console
    console.warn(
      `[auto-measure-profile] objective=${objectiveForCalibration ?? 'null'} smoothing=${runSmoothing} threshold=${runThreshold}`
    );
    // eslint-disable-next-line no-console
    console.warn(
      `[auto-measure-frame] objective=${objectiveForCalibration ?? 'null'} frameEpoch=${capturedFrameIdForRun ?? 'n/a'} source=${displayedFrame.source}`
    );
  }
  logAutoMeasurePhase('auto-measure-frame', {
    objective: objectiveForCalibration,
    smoothing: runSmoothing,
    threshold: runThreshold,
    method: 'refined',
    reason: 'captured',
    extra: `width=${displayedFrame.width} height=${displayedFrame.height} frameId=${capturedFrameIdForRun ?? 'n/a'} source=${displayedFrame.source}`,
  });

  const liveObjectiveCandidate = String(objectiveForCalibration ?? '')
    .trim()
    .toUpperCase();
  const liveObjectiveForNative: ObjectiveForMeasure =
    (OBJECTIVE_FOR_MEASURE_OPTIONS as readonly string[]).includes(liveObjectiveCandidate)
      ? (liveObjectiveCandidate as ObjectiveForMeasure)
      : settings.objectiveForMeasure;

  const measureFn = preview ? measureVickersAutoPreview : measureVickersAuto;
  logAutoMeasurePhase('auto-measure-preprocess', {
    objective: liveObjectiveForNative,
    smoothing: runSmoothing,
    threshold: runThreshold,
    method: 'refined',
    reason: 'clahe+adaptive-threshold+morphology',
  });
  const nativeResult = await measureFn({
    smoothing: runSmoothing,
    threshold: runThreshold,
    objectiveForMeasure: liveObjectiveForNative,
    frameBuffer: displayedFrame.buffer,
    width: displayedFrame.width,
    height: displayedFrame.height,
    pixelFormat: displayedFrame.pixelFormat,
    bits: displayedFrame.bits,
    source: displayedFrame.source,
    micronPerPixel: calibration?.micronPerPixel ?? null,
    pxPerMm: calibration ? 1000 / calibration.micronPerPixel : null,
    testForceKgf: forceKgf,
    minConfidence,
    timeoutMs: 4000,
    maxFrameAgeMs: 1200,
  });

  return { nativeResult, liveObjectiveForNative, runSmoothing, runThreshold };
}
