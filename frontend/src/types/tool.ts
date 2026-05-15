export type ToolId =
  | 'pointer'
  | 'manualMeasure'
  | 'measureLength'
  | 'measureAngle'
  | 'magnifier';

export type ToolbarActionId =
  // file
  | 'file:open'
  | 'file:save'
  // device (camera IPC)
  | 'device:openCamera'
  | 'device:closeCamera'
  // measurement modes (set activeTool)
  | 'tools:pointer'
  | 'tools:manualMeasure'
  | 'tools:measureLength'
  | 'tools:measureAngle'
  | 'tools:magnifier'
  // one-shot commands (do not change activeTool)
  | 'tools:autoMeasure'
  | 'tools:autoSearchEdge'
  | 'tools:panoramicScan'
  | 'tools:clearGraphics'
  | 'tools:trimMeasure'
  | 'tools:centerCrossLine'
  | 'tools:resumeImage'
  | 'tools:zoomIn'
  | 'tools:zoomOut'
  // yellow measurement-line thickness (shared across Auto + Manual overlays)
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
  // Note: 'tools:magnifier' is intentionally NOT a mode-switch. Magnifier is
  // now an independent overlay toggle (see App.tsx `magnifierEnabled`) so it
  // can coexist with Manual Measure as a precision-placement helper.
};
