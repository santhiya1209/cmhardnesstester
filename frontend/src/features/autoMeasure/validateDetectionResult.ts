import type { VickersAutoMeasureResult } from '@/types/autoMeasure';
import type { ObjectiveForMeasure } from '@/types/autoMeasureSettings';
import {
  formatAutoMeasureNumber,
  logAutoMeasurePhase,
  resolveAutoMeasureDetection,
} from './autoMeasureHelpers';

export type ValidateDetectionResultArgs = {
  nativeResult: VickersAutoMeasureResult;
  liveObjectiveForNative: ObjectiveForMeasure;
  runSmoothing: number;
  runThreshold: number;
};

export type ValidateDetectionResultOutput = {
  nativeObjective: string;
  resolvedDetection: ReturnType<typeof resolveAutoMeasureDetection>;
};

// Pure result-shape inspection: reads the native debug envelope, emits the
// `auto-measure-contours` log, and runs the shared resolver/geometry validator
// against the raw native result. Side-effect free — no overlay clears, no
// status messages, no session/objective guards (those stay in App so the
// downstream branching paths keep their ownership).
export function validateDetectionResult({
  nativeResult,
  liveObjectiveForNative,
  runSmoothing,
  runThreshold,
}: ValidateDetectionResultArgs): ValidateDetectionResultOutput {
  const debugObj = (nativeResult.debug ?? {}) as {
    objectiveForMeasure?: unknown;
    contourCount?: unknown;
    selectedContourArea?: unknown;
    selectedValidationArea?: unknown;
    confidence?: unknown;
  };
  const nativeObjective =
    typeof debugObj.objectiveForMeasure === 'string'
      ? debugObj.objectiveForMeasure
      : '';
  logAutoMeasurePhase('auto-measure-contours', {
    objective: liveObjectiveForNative,
    smoothing: runSmoothing,
    threshold: runThreshold,
    method: nativeResult.ok ? 'refined' : 'rough',
    d1Px: nativeResult.ok ? nativeResult.d1Pixels : null,
    d2Px: nativeResult.ok ? nativeResult.d2Pixels : null,
    center: nativeResult.ok
      ? {
          x:
            ((nativeResult.corners.left.x + nativeResult.corners.right.x) / 2 +
              (nativeResult.corners.top.x + nativeResult.corners.bottom.x) / 2) /
            2,
          y:
            ((nativeResult.corners.left.y + nativeResult.corners.right.y) / 2 +
              (nativeResult.corners.top.y + nativeResult.corners.bottom.y) / 2) /
            2,
        }
      : null,
    reason: nativeResult.ok ? 'native-result' : nativeResult.reason,
    extra: `contourCount=${Number(debugObj.contourCount) || 0} selectedArea=${formatAutoMeasureNumber(Number(debugObj.selectedContourArea))} validationArea=${formatAutoMeasureNumber(Number(debugObj.selectedValidationArea))} confidence=${nativeResult.ok ? nativeResult.confidence.toFixed(3) : '0.000'}`,
  });
  const resolvedDetection = resolveAutoMeasureDetection(nativeResult, {
    objective: liveObjectiveForNative,
    smoothing: runSmoothing,
    threshold: runThreshold,
  });
  return { nativeObjective, resolvedDetection };
}
