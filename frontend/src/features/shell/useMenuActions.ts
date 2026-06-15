import { useCallback } from 'react';
import type { DialogKey } from '@/contexts/DialogContext';
import { dispatchMenuAction } from '@/utils/menuDispatcher';
import type { ToolDispatchContext } from '@/utils/toolDispatcher';
import type { ConfigDialogId, MenuActionId } from '@/types/menu';

export interface UseMenuActionsInput {
  openCalibrationPanel: (source: 'menu' | 'toolbar' | 'snackbar') => void;
  openCameraSettingsPanel: () => void;
  openTestRecordsDialog: (measurementIds: string[]) => void;
  setActiveDialog: (next: DialogKey | ((prev: DialogKey) => DialogKey)) => void;
  setExitConfirmOpen: (open: boolean) => void;
  buildSharedCtx: () => ToolDispatchContext;
}

export interface MenuActionsApi {
  handleMenuSelect: (action: MenuActionId) => void;
}

export function useMenuActions(input: UseMenuActionsInput): MenuActionsApi {
  const {
    openCalibrationPanel,
    openCameraSettingsPanel,
    openTestRecordsDialog,
    setActiveDialog,
    setExitConfirmOpen,
    buildSharedCtx,
  } = input;

  const openConfigDialog = useCallback(
    (id: ConfigDialogId) => {
      if (id === 'config:calibration') {
        openCalibrationPanel('menu');
        return;
      }
      if (id === 'config:camera') {
        openCameraSettingsPanel();
        return;
      }

      const map: Record<Exclude<ConfigDialogId, 'config:calibration' | 'config:camera'>, DialogKey> = {
        'config:lineColor': 'lineColor',
        'config:autoMeasure': 'autoMeasure',
        'config:micrometer': 'micrometer',
        'config:serialPort': 'serialPort',
        'config:generic': 'generic',
        'config:other': 'other',
        'config:restoreFactory': 'restoreFactory',
        'config:zAxis': 'zAxis',
        'config:xyPlatform': 'xyPlatform',
        'config:crosshair': 'crosshair',
      };
      setActiveDialog(map[id]);
    },
    [openCalibrationPanel, openCameraSettingsPanel, setActiveDialog]
  );

  const handleMenuSelect = useCallback(
    (action: MenuActionId) => {
      dispatchMenuAction(action, {
        ...buildSharedCtx(),
        openConfigDialog,
        openSampleInfo: () => openTestRecordsDialog([]),
        exitApplication: () => setExitConfirmOpen(true),
      });
    },
    [buildSharedCtx, openConfigDialog, openTestRecordsDialog, setExitConfirmOpen]
  );

  return { handleMenuSelect };
}
