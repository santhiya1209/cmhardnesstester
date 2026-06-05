export type ToolId =
  | 'pointer'
  | 'manualMeasure'
  | 'measureLength'
  | 'measureAngle'
  | 'magnifier';

export type MeasureSelection = 'auto' | 'manual' | null;

export type ToolbarActionId =
  | 'config:calibration'
  | 'config:camera'
  | 'file:open'
  | 'file:save'
  | 'device:openCamera'
  | 'device:closeCamera'
  | 'tools:pointer'
  | 'tools:manualMeasure'
  | 'tools:measureLength'
  | 'tools:measureAngle'
  | 'tools:magnifier'
  | 'tools:autoMeasure'
  | 'tools:autoSearchEdge'
  | 'tools:panoramicScan'
  | 'tools:clearGraphics'
  | 'tools:trimMeasure'
  | 'tools:centerCrossLine'
  | 'tools:resumeImage'
  | 'tools:zoomIn'
  | 'tools:zoomOut'
  | 'tools:lineThin'
  | 'tools:lineNormal'
  | 'tools:lineThick';

export type Point = { x: number; y: number };

export type LengthShape = {
  id: string;
  kind: 'length';
  a: Point;
  b: Point;
};

export type AngleShape = {
  id: string;
  kind: 'angle';
  vertex: Point;
  a: Point;
  b: Point;
  coordinateSpace?: 'display' | 'image';
};

export type OverlayShape = LengthShape | AngleShape;

export type OverlayShapeInput =
  | Omit<LengthShape, 'id'>
  | Omit<AngleShape, 'id'>;

export const TOOL_ACTION_TO_TOOL: Partial<Record<ToolbarActionId, ToolId>> = {
  'tools:pointer': 'pointer',
  'tools:manualMeasure': 'manualMeasure',
  'tools:measureLength': 'measureLength',
  'tools:measureAngle': 'measureAngle',
};
