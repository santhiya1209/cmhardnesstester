import type {
  ConfigDialogId,
  MenuActionId,
} from '@/types/menu';
import type { ToolbarActionId } from '@/types/tool';
import { dispatchToolbarAction, type ToolDispatchContext } from './toolDispatcher';

export type MenuDispatchContext = ToolDispatchContext & {
  openConfigDialog: (id: ConfigDialogId) => void;
  openSampleInfo: () => void;
  exitApplication: () => void;
  saveOriginalImage?: () => void;
};

const CONFIG_LABEL: Record<ConfigDialogId, string> = {
  'config:lineColor': 'Line Color Setting',
  'config:calibration': 'Calibration',
  'config:autoMeasure': 'Auto Measure Setting',
  'config:micrometer': 'Micrometer Setting',
  'config:serialPort': 'Serial Port Setting',
  'config:generic': 'Generic Setting',
  'config:other': 'Other Setting',
  'config:restoreFactory': 'Restore Factory Settings',
  'config:camera': 'Camera Setting',
  'config:xyPlatform': 'XY Platform Setting',
  'config:zAxis': 'Z Axis Setting',
};

const CONFIG_DIALOG_IDS = new Set<ConfigDialogId>([
  'config:lineColor',
  'config:calibration',
  'config:autoMeasure',
  'config:micrometer',
  'config:serialPort',
  'config:camera',
  'config:generic',
  'config:other',
  'config:restoreFactory',
  'config:zAxis',
  'config:xyPlatform',
]);

const TOOLBAR_PREFIXES = ['file:', 'device:', 'tools:'];

function isToolbarAction(action: string): action is ToolbarActionId {
  return TOOLBAR_PREFIXES.some((p) => action.startsWith(p));
}

export function dispatchMenuAction(action: MenuActionId, ctx: MenuDispatchContext): void {
  if (action === 'data:sampleInfo') {
    ctx.openSampleInfo();
    ctx.setStatus('Test Records opened');
    return;
  }

  if (action === 'file:exit') {
    ctx.exitApplication();
    return;
  }

  if (action === 'file:saveOriginal') {
    if (ctx.saveOriginalImage) {
      ctx.saveOriginalImage();
      ctx.setStatus('Save Original Image');
    } else {
      ctx.saveImage?.();
      ctx.setStatus('Save Original Image');
    }
    return;
  }

  if (CONFIG_DIALOG_IDS.has(action as ConfigDialogId)) {
    const id = action as ConfigDialogId;
    ctx.openConfigDialog(id);
    ctx.setStatus(`${CONFIG_LABEL[id]} opened`);
    return;
  }

  if (isToolbarAction(action)) {
    dispatchToolbarAction(action, ctx);
    return;
  }

  ctx.setStatus(`Unknown menu action: ${action satisfies string}`);
}
