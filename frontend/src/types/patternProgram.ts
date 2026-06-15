export type PatternOption = 'Line' | 'Rectangle' | 'Circle' | 'Custom';

export type PatternMode =
  | 'Horizontal Mode'
  | 'Horizontal Capture Mode'
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
  // MultiLine Composite: the per-line definitions. Persisted verbatim so the
  // whole multi-line layout round-trips on Load. Empty for every other mode.
  lines: CompositeLine[];
  // Equidistant Triangle: the per-triangle vertex definitions. Empty for every
  // other mode. Incomplete triangles are dropped on Save (see toPayload).
  triangles: TriangleDefinition[];
  // The generated points, persisted so Load restores the preview/overlay/run
  // list without re-running Generate. Optional for older programs (the backend
  // defaults it to []); restored into Redux `generatedPoints`, not `config`.
  points?: PatternPoint[];
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

/** Travel direction for a MultiLine Composite line; constrains which axis varies. */
export type CompositeMove = 'Horizontal' | 'Vertical' | 'Diagonal' | 'Custom';

/**
 * One line of a MultiLine Composite pattern. Points run from Start toward End in
 * `interval`-mm steps (count derived from the Start→End span, not entered). For
 * Horizontal/Vertical the relevant End axis sets the extent; for Diagonal/Custom
 * the full Start→End vector is used. `offset` + `firstOffset` push the first
 * point away from Start along the travel direction.
 */
export type CompositeLine = {
  id: string;
  move: CompositeMove;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  interval: number;
  offset: number;
  firstOffset: number;
};

/**
 * One triangle of an Equidistant Triangle pattern, defined by three explicit
 * vertices (mm). Edited as a single table row (X1/Y1/X2/Y2/X3/Y3); the stable
 * `id` tracks row selection independent of array position.
 */
export type TriangleDefinition = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
};

/** A single generated indentation coordinate, in millimetres. */
export type PatternPoint = {
  /** Stable id for preview-table selection and deletion. */
  id: string;
  /** 1-based sequence number in the generated order. */
  no: number;
  x: number;
  y: number;
  /** 1-based source line number — set only by MultiLine Composite generation. */
  line?: number;
  /** 1-based source triangle number — set only by Equidistant Triangle generation. */
  triangle?: number;
};

/** Per-point execution state shown in the preview table's Move column. */
export type MoveStatus = 'Pending' | 'Moving' | 'Done' | 'Failed';

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
  /** Second reference point for two-point modes (Case Depth, Equidistant*). */
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
  /** MultiLine Composite per-line definitions; empty for every other mode. */
  lines: CompositeLine[];
  /** Equidistant Triangle per-triangle vertex definitions; empty for every other mode. */
  triangles: TriangleDefinition[];
};

export type PatternGenerationResult = {
  success: boolean;
  points: PatternPoint[];
  error?: string;
};
