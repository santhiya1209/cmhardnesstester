import type { RootState } from '@/store';
import type { MultipointState, ProgramMeta } from '@/types/multipoint';
import type { FreePoint, PatternGenerationRequest, PatternMode, PatternPoint } from '@/types/patternProgram';

// Stable empty reference so `selectFreePoints` never returns a fresh [] (which
// would re-render every consumer each dispatch). config.freePoints is itself a
// stored array reference, stable until it actually changes.
const EMPTY_FREE_POINTS: FreePoint[] = [];

// Direct slice/field accessors are already referentially stable (they return an
// existing state reference, never a freshly-built object), so they need no
// Reselect memoization. Reach for `createSelector` only for derived values that
// build new objects/arrays.
export const selectMultipointState = (state: RootState): MultipointState => state.multipoint;
export const selectPatternMode = (state: RootState): PatternMode => state.multipoint.mode;
export const selectPatternConfig = (state: RootState): PatternGenerationRequest => state.multipoint.config;
export const selectGeneratedPoints = (state: RootState): PatternPoint[] => state.multipoint.generatedPoints;
export const selectSelectedPointIds = (state: RootState): string[] => state.multipoint.selectedPointIds;
export const selectIsGenerating = (state: RootState): boolean => state.multipoint.isGenerating;
export const selectProgramMeta = (state: RootState): ProgramMeta => state.multipoint.programMeta;
export const selectActivePointId = (state: RootState): string | null => state.multipoint.activePointId;
export const selectCompletedPointIds = (state: RootState): string[] => state.multipoint.completedPointIds;
export const selectFailedPointIds = (state: RootState): string[] => state.multipoint.failedPointIds;
export const selectCameraPointPhase = (state: RootState) => state.multipoint.cameraPointPhase;
export const selectCameraPointTarget = (state: RootState) => state.multipoint.cameraPointTarget;
export const selectReferencePicked = (state: RootState): boolean => state.multipoint.referencePicked;
export const selectRefX = (state: RootState): number | null => state.multipoint.config.refX ?? null;
export const selectRefY = (state: RootState): number | null => state.multipoint.config.refY ?? null;
export const selectFreePoints = (state: RootState): FreePoint[] =>
  state.multipoint.config.freePoints ?? EMPTY_FREE_POINTS;
