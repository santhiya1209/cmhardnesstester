import type { RootState } from '@/store';
import type { EnginePhase, PointExecState } from '@/types/multipointExecution';

export const selectExecPhase = (s: RootState): EnginePhase => s.multipointExecution.phase;
export const selectExecRunId = (s: RootState): string | null => s.multipointExecution.runId;
export const selectExecCurrentPointId = (s: RootState): string | null =>
  s.multipointExecution.currentPointId;
export const selectExecCurrentPointNo = (s: RootState): number | null =>
  s.multipointExecution.currentPointNo;
export const selectExecPass = (s: RootState): 1 | 2 | null => s.multipointExecution.pass;
export const selectExecTotal = (s: RootState): number => s.multipointExecution.total;
export const selectExecCompletedCount = (s: RootState): number =>
  s.multipointExecution.completedCount;
export const selectExecPoints = (s: RootState): Record<string, PointExecState> =>
  s.multipointExecution.points;
export const selectExecStatusMessage = (s: RootState): string =>
  s.multipointExecution.statusMessage;
export const selectExecErrorMessage = (s: RootState): string | null =>
  s.multipointExecution.errorMessage;
export const selectExecStartedAtMs = (s: RootState): number | null =>
  s.multipointExecution.startedAtMs;
export const selectExecFinishedAtMs = (s: RootState): number | null =>
  s.multipointExecution.finishedAtMs;
