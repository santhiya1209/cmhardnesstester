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
