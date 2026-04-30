import {
  TOOL_ACTION_TO_TOOL,
  type ToolId,
  type ToolbarActionId,
} from '@/types/tool';

export type ToolDispatchContext = {
  setActiveTool: (tool: ToolId) => void;
  setStatus: (message: string) => void;
  notifyUnavailable: (label: string) => void;
  // overlay commands — wired in Phase 2/3
  clearGraphics?: () => void;
  trimLastMeasurement?: () => void;
  toggleCenterCrossLine?: () => void;
  resumeImage?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  // file/camera — wired in Phase 5
  openImage?: () => void;
  saveImage?: () => void;
  openCameraDevice?: () => void;
  closeCameraDevice?: () => void;
};

const FRIENDLY_LABEL: Record<ToolbarActionId, string> = {
  'file:open': 'Open Image',
  'file:save': 'Save Image',
  'device:openCamera': 'Open Device',
  'device:closeCamera': 'Close Device',
  'tools:pointer': 'Pointer',
  'tools:manualMeasure': 'Manual Measure',
  'tools:measureLength': 'Measure Length',
  'tools:measureAngle': 'Measure Angle',
  'tools:magnifier': 'Magnifier',
  'tools:autoMeasure': 'Auto Measure',
  'tools:autoSearchEdge': 'Auto Search Edge',
  'tools:panoramicScan': 'Panoramic Scan',
  'tools:clearGraphics': 'Clear Graphics',
  'tools:trimMeasure': 'Trim Measure',
  'tools:centerCrossLine': 'Center Cross Line',
  'tools:resumeImage': 'Resume Image',
  'tools:zoomIn': 'Zoom In',
  'tools:zoomOut': 'Zoom Out',
};

export function dispatchToolbarAction(
  action: ToolbarActionId,
  ctx: ToolDispatchContext
): void {
  const label = FRIENDLY_LABEL[action] ?? action;

  // 1) Mode-switching tools — set activeTool only, no side effects.
  const tool = TOOL_ACTION_TO_TOOL[action];
  if (tool) {
    ctx.setActiveTool(tool);
    ctx.setStatus(`${label} mode`);
    return;
  }

  // 2) One-shot commands.
  switch (action) {
    case 'file:open':
      ctx.openImage?.();
      ctx.setStatus(label);
      return;
    case 'file:save':
      ctx.saveImage?.();
      ctx.setStatus(label);
      return;

    case 'device:openCamera':
      if (ctx.openCameraDevice) {
        ctx.openCameraDevice();
        ctx.setStatus(`${label} requested`);
      } else {
        ctx.notifyUnavailable(label);
      }
      return;
    case 'device:closeCamera':
      if (ctx.closeCameraDevice) {
        ctx.closeCameraDevice();
        ctx.setStatus(`${label} requested`);
      } else {
        ctx.notifyUnavailable(label);
      }
      return;

    case 'tools:clearGraphics':
      ctx.clearGraphics?.();
      ctx.setStatus(label);
      return;
    case 'tools:trimMeasure':
      ctx.trimLastMeasurement?.();
      ctx.setStatus(label);
      return;
    case 'tools:centerCrossLine':
      ctx.toggleCenterCrossLine?.();
      ctx.setStatus(`${label} toggled`);
      return;
    case 'tools:resumeImage':
      ctx.resumeImage?.();
      ctx.setStatus(label);
      return;
    case 'tools:zoomIn':
      ctx.zoomIn?.();
      ctx.setStatus(label);
      return;
    case 'tools:zoomOut':
      ctx.zoomOut?.();
      ctx.setStatus(label);
      return;

    case 'tools:autoMeasure':
    case 'tools:autoSearchEdge':
    case 'tools:panoramicScan':
      ctx.notifyUnavailable(label);
      return;

    default:
      ctx.setStatus(`Unknown action: ${action satisfies string}`);
  }
}
