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

/**
 * Camera-click point-selection state machine (Free/Midpoint "Add Point"):
 * idle → selecting (waiting for a camera click) → idle. The click computes the
 * clicked LOCATION's coordinate in place — the stage is not moved.
 */
export type CameraPointPhase = 'idle' | 'selecting';

export interface MultipointState {
  mode: PatternMode;
  config: PatternGenerationRequest;
  generatedPoints: PatternPoint[];
  selectedPointIds: string[];
  isGenerating: boolean;
  programMeta: ProgramMeta;
  /** Id of the point currently being moved to during Start execution; null when idle. */
  activePointId: string | null;
  /** Ids of points already visited in the current Start run — drives the green "completed" overlay state. */
  completedPointIds: string[];
  /** Ids of points whose move failed in the current run — drives the "Failed" status in the preview table. */
  failedPointIds: string[];
  /** Camera-click point-selection phase; 'idle' unless the operator is picking a point on the live camera. */
  cameraPointPhase: CameraPointPhase;
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
