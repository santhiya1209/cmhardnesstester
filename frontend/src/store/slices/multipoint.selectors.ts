import type { RootState } from '@/store';
import type { MultipointState, ProgramMeta } from '@/types/multipoint';
import type { PatternGenerationRequest, PatternMode, PatternPoint } from '@/types/patternProgram';

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
