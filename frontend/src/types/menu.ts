import type { ToolbarActionId } from './tool';

export type ConfigDialogId =
  | 'config:lineColor'
  | 'config:calibration'
  | 'config:autoMeasure'
  | 'config:micrometer'
  | 'config:serialPort'
  | 'config:camera'
  | 'config:generic'
  | 'config:other'
  | 'config:restoreFactory';

export type ConfigUnavailableId =
  | 'config:xyPlatform'
  | 'config:zAxis';

export type FileMenuId =
  | 'file:open'
  | 'file:save'
  | 'file:saveOriginal'
  | 'file:exit';

export type DataMenuId = 'data:sampleInfo';

export type DeviceMenuId = 'device:openCamera' | 'device:closeCamera';

export type MenuActionId =
  | FileMenuId
  | DeviceMenuId
  | DataMenuId
  | ToolbarActionId
  | ConfigDialogId
  | ConfigUnavailableId;
