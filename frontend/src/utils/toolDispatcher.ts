import {
  TOOL_ACTION_TO_TOOL,
  type ToolId,
  type ToolbarActionId,
} from '@/types/tool';
import type { LineThickness } from '@/types/lineThickness';

export type ToolDispatchContext = {
  setActiveTool: (tool: ToolId) => void;
  setStatus: (message: string) => void;
  notifyUnavailable: (label: string) => void;
  clearGraphics?: () => void;
  trimLastMeasurement?: () => void;
  openTrimMeasure?: () => void;
  toggleCenterCrossLine?: () => void;
  autoMeasure?: () => void;
  toggleMagnifier?: () => void;
  setLineThickness?: (thickness: LineThickness) => void;
  resumeImage?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  openCalibration?: () => void;
  openCameraSettings?: () => void;
  openImage?: () => void;
  saveImage?: () => void;
  openCameraDevice?: () => void;
  closeCameraDevice?: () => void;
};

const FRIENDLY_LABEL: Record<ToolbarActionId, string> = {
  'config:calibration': 'Calibration',
  'config:camera': 'Camera Settings',
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
  'tools:lineThin': 'Thin Line',
  'tools:lineNormal': 'Normal Line',
  'tools:lineThick': 'Thick Line',
};

export function dispatchToolbarAction(
  action: ToolbarActionId,
  ctx: ToolDispatchContext
): void {
  const label = FRIENDLY_LABEL[action] ?? action;

  const tool = TOOL_ACTION_TO_TOOL[action];
  if (tool) {
    ctx.setActiveTool(tool);
    ctx.setStatus(`${label} mode`);
    return;
  }

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
      if (ctx.openTrimMeasure) {
        ctx.openTrimMeasure();
        ctx.setStatus(`${label} opened`);
      } else {
        ctx.notifyUnavailable(label);
      }
      return;
    case 'tools:centerCrossLine':
      ctx.toggleCenterCrossLine?.();
      ctx.setStatus(`${label} toggled`);
      return;
    case 'tools:autoMeasure':
      if (ctx.autoMeasure) {
        ctx.autoMeasure();
        ctx.setStatus(`${label} requested`);
      } else {
        ctx.notifyUnavailable(label);
      }
      return;
    case 'tools:magnifier':
      if (ctx.toggleMagnifier) {
        ctx.toggleMagnifier();
        ctx.setStatus(`${label} toggled`);
      } else {
        ctx.notifyUnavailable(label);
      }
      return;
    case 'tools:lineThin':
    case 'tools:lineNormal':
    case 'tools:lineThick':
      if (ctx.setLineThickness) {
        const next: LineThickness =
          action === 'tools:lineThin' ? 'thin' : action === 'tools:lineThick' ? 'thick' : 'normal';
        ctx.setLineThickness(next);
        ctx.setStatus(`${label} applied`);
      } else {
        ctx.notifyUnavailable(label);
      }
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
    case 'config:calibration':
      if (ctx.openCalibration) {
        ctx.openCalibration();
        ctx.setStatus(`${label} opened`);
      } else {
        ctx.notifyUnavailable(label);
      }
      return;
    case 'config:camera':
      if (ctx.openCameraSettings) {
        ctx.openCameraSettings();
        ctx.setStatus(`${label} opened`);
      } else {
        ctx.notifyUnavailable(label);
      }
      return;

    case 'tools:autoSearchEdge':
    case 'tools:panoramicScan':
      ctx.notifyUnavailable(label);
      return;

    default:
      ctx.setStatus(`Unknown action: ${action satisfies string}`);
  }
}
