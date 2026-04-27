import type {
  CameraDevice,
  CameraFrameMeta,
  CameraReply,
  CameraStatus,
} from './camera';

export type AppInfo = {
  name: string;
  version: string;
  electron: string;
  node: string;
  platform: string;
  env: string;
};

export type PingResponse = {
  pong: true;
  received: unknown;
  at: number;
};

export type IpcInvokeChannel =
  | 'app:getInfo'
  | 'app:ping'
  | 'camera:open'
  | 'camera:close'
  | 'camera:start-stream'
  | 'camera:stop-stream'
  | 'camera:get-frame'
  | 'camera:get-status'
  | 'camera:set-exposure'
  | 'camera:set-gain'
  | 'camera:set-trigger-mode';

export type IpcEventChannel = 'app:status' | 'camera:frame' | 'camera:status';

export type IpcInvokeMap = {
  'app:getInfo': { request: void; response: AppInfo };
  'app:ping': { request: unknown; response: PingResponse };
  'camera:open': {
    request: { index?: number } | void;
    response: CameraReply<CameraStatus & { devices: CameraDevice[]; alreadyOpen?: boolean }>;
  };
  'camera:close': { request: void; response: CameraReply<CameraStatus> };
  'camera:start-stream': { request: void; response: CameraReply<CameraStatus> };
  'camera:stop-stream': { request: void; response: CameraReply<CameraStatus> };
  'camera:get-frame': {
    request: { timeoutMs?: number } | void;
    response: CameraReply<CameraFrameMeta>;
  };
  'camera:get-status': { request: void; response: CameraReply<CameraStatus> };
  'camera:set-exposure': {
    request: { valueUs: number };
    response: CameraReply<{ exposureUs: number }>;
  };
  'camera:set-gain': {
    request: { value: number };
    response: CameraReply<{ applied: Record<string, number> }>;
  };
  'camera:set-trigger-mode': {
    request: { value: boolean };
    response: CameraReply<{ triggerState: boolean }>;
  };
};

export type IpcEventPayloadMap = {
  'app:status': [unknown];
  'camera:frame': [CameraFrameMeta, ArrayBufferLike];
  'camera:status': [Partial<CameraStatus>];
};

export interface ElectronApi {
  invoke<C extends IpcInvokeChannel>(
    channel: C,
    payload?: IpcInvokeMap[C]['request']
  ): Promise<IpcInvokeMap[C]['response']>;
  on<C extends IpcEventChannel>(
    channel: C,
    listener: (...args: IpcEventPayloadMap[C]) => void
  ): () => void;
  platform: 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32';
}
