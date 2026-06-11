import type { ExecutionImpressMode, MultipointExecutionRequest, ProgramMeta } from '@/types/multipoint';
import type { ImpressMode, PatternPoint } from '@/types/patternProgram';

const IMPRESS_DTO: Record<ImpressMode, ExecutionImpressMode> = {
  indenting: 'INDENTING',
  onePass: 'ONE_PASS_IMPRESS',
  twoPass: 'TWO_PASS_IMPRESS',
};

/**
 * Build the typed execution hand-off from already-generated points + program
 * meta. Pure mapping only — order is preserved and no motion is performed.
 */
export function buildMultipointExecutionRequest(
  points: PatternPoint[],
  meta: ProgramMeta
): MultipointExecutionRequest {
  return {
    points,
    focusAll: meta.focusAll,
    multiset: meta.multiset,
    impressMode: IMPRESS_DTO[meta.impressMode],
  };
}
