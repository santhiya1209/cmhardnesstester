export type PatternOption = 'Line' | 'Rectangle' | 'Circle' | 'Custom';

export type PatternMode =
  | 'Horizontal Mode'
  | 'Vertical Mode'
  | 'Case Depth Mode'
  | 'Free Mode'
  | 'Matrix Mode'
  | 'Circle Mode'
  | 'Midpoint Mode'
  | 'Equidistant Multipoint Mode'
  | 'Equidistant Three Point Mode'
  | 'Equidistant Triangle Mode'
  | 'Multiline Composite Pattern'
  | 'Vertical Line Free Points Mode';

export type ImpressMode = 'indenting' | 'onePass' | 'twoPass';

export type PatternProgramPayload = {
  pattern: PatternOption;
  mode: PatternMode;
  refX: number | null;
  refY: number | null;
  interval: number | null;
  offset: number | null;
  firstOffset: number | null;
  number: number | null;
  // Per-mode generation inputs — persisted so a saved program round-trips for
  // every PatternMode (Save → Load → Generate is identical).
  intervalY: number | null;
  rows: number | null;
  columns: number | null;
  refX2: number | null;
  refY2: number | null;
  radius: number | null;
  freePoints: FreePoint[];
  // Case Depth: the two reference points captured from the stage
  // ([0]=origin, [1]=direction). `angle` is a reserved persisted field — not
  // used by generation (the bearing comes from the two reference points).
  referencePoints: FreePoint[];
  angle: number | null;
  multiset: boolean;
  focusAll: boolean;
  impressMode: ImpressMode;
  checked: boolean;
};

export type PatternProgram = PatternProgramPayload & {
  id: string;
  patternName: string;
  pointCount: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * An operator-captured / user-entered coordinate pair, in millimetres. The
 * stable `id` lets the Free-mode editor track row selection and keyboard
 * navigation independent of array position; `No.` is still derived from index.
 */
export type FreePoint = { id: string; x: number; y: number };

/** A single generated indentation coordinate, in millimetres. */
export type PatternPoint = {
  /** Stable id for preview-table selection and deletion. */
  id: string;
  /** 1-based sequence number in the generated order. */
  no: number;
  x: number;
  y: number;
};

/**
 * Input to the pattern generation engine, and the full set of generation inputs
 * a saved program persists. Every field is required (nullable where a mode does
 * not use it) so the config is always fully specified — there are no implicit
 * defaults to reconstruct on Load.
 */
export type PatternGenerationRequest = {
  mode: PatternMode;
  refX: number | null;
  refY: number | null;
  interval: number | null;
  offset: number | null;
  firstOffset: number | null;
  number: number | null;
  /** Vertical spacing for grid / composite modes. */
  intervalY: number | null;
  rows: number | null;
  columns: number | null;
  /** Second reference point for two-point modes (Case Depth, Midpoint, Equidistant*). */
  refX2: number | null;
  refY2: number | null;
  /** Circle / triangle circumradius. */
  radius: number | null;
  /** Operator-captured points for Free / Vertical-Line-Free modes. */
  freePoints: FreePoint[];
  /** Case Depth reference points: [0]=traverse origin, [1]=direction target. */
  referencePoints: FreePoint[];
  /** Reserved/persisted Case Depth field — not used by generation (bearing comes from referencePoints). */
  angle: number | null;
};

export type PatternGenerationResult = {
  success: boolean;
  points: PatternPoint[];
  error?: string;
};
