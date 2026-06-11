import type {
  ImpressMode,
  PatternGenerationRequest,
  PatternMode,
  PatternOption,
  PatternPoint,
} from './patternProgram';

/**
 * Program metadata that is saved with a pattern program but is not a pattern
 * generation input — kept alongside the generation `config` so Save/Load stay
 * whole without any duplicated component-local form state.
 */
export type ProgramMeta = {
  pattern: PatternOption;
  multiset: boolean;
  focusAll: boolean;
  impressMode: ImpressMode;
};

export interface MultipointState {
  mode: PatternMode;
  config: PatternGenerationRequest;
  generatedPoints: PatternPoint[];
  selectedPointIds: string[];
  isGenerating: boolean;
  programMeta: ProgramMeta;
  /** Id of the point currently being moved to during Start execution; null when idle. */
  activePointId: string | null;
}

/** Impress mode in the wire form the machine-control layer expects. */
export type ExecutionImpressMode = 'INDENTING' | 'ONE_PASS_IMPRESS' | 'TWO_PASS_IMPRESS';

/**
 * Typed hand-off the Start button prepares for the existing machine-control
 * architecture. The Multipoint UI only builds this DTO — it performs no serial
 * communication or stage motion itself.
 */
export interface MultipointExecutionRequest {
  points: PatternPoint[];
  focusAll: boolean;
  multiset: boolean;
  impressMode: ExecutionImpressMode;
}
