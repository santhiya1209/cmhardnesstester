import type {
  CameraDevice,
  CameraFrameMeta,
  CameraReply,
  CameraStatus,
} from './camera';
import type {
  VickersAutoMeasureParameters,
  VickersAutoMeasureResult,
} from './autoMeasure';
import type { OpenImageResult, SaveImageRequest, SaveImageResult } from './dialog';
import type {
  MicrometerCloseResult,
  MicrometerGetLatestReadingResult,
  MicrometerGetStateResult,
  MicrometerOpenResult,
  MicrometerState,
} from './micrometer';

export type DeviceOpenResponse = {
  ok: true;
  camera: {
    connected: boolean;
    streaming: boolean;
    error?: string;
    message?: string;
  };
  micrometer?: {
    connected: boolean;
    port: string;
    error?: string;
    message?: string;
  };
};

export type DeviceCloseResponse = {
  ok: true;
  camera: unknown;
  micrometer?: unknown;
};

export type CameraRange = {
  min: number;
  max: number;
  step: number;
  default: number;
  current: number;
};

export interface HardnessCameraApi {
  setExposure(valueMs: number): Promise<CameraReply<{ exposureMs: number }>>;
  setGain(value: number): Promise<CameraReply<{ gain: number }>>;
  getExposureRange(): Promise<CameraReply<CameraRange>>;
  getGainRange(): Promise<CameraReply<CameraRange>>;
  openDevice(payload?: { index?: number }): Promise<DeviceOpenResponse>;
  closeDevice(): Promise<DeviceCloseResponse>;
}

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
  | 'app:exit'
  | 'camera:open'
  | 'camera:close'
  | 'camera:start-stream'
  | 'camera:stop-stream'
  | 'camera:get-frame'
  | 'camera:get-status'
  | 'camera:set-exposure'
  | 'camera:set-gain'
  | 'camera:get-exposure-range'
  | 'camera:get-gain-range'
  | 'camera:set-trigger-mode'
  | 'camera:measure-vickers-auto'
  | 'device:open'
  | 'device:close'
  | 'dialog:openImage'
  | 'dialog:saveImage'
  | 'micrometer:open'
  | 'micrometer:close'
  | 'micrometer:get-state'
  | 'micrometer:get-latest-reading';

export type IpcEventChannel =
  | 'app:status'
  | 'camera:frame'
  | 'camera:status'
  | 'micrometer:state';

export type IpcInvokeMap = {
  'app:getInfo': { request: void; response: AppInfo };
  'app:ping': { request: unknown; response: PingResponse };
  'app:exit': { request: void; response: { ok: true } };
  'camera:open': {
    request: { index?: number } | void;
    response: CameraReply<CameraStatus & { devices: CameraDevice[]; alreadyOpen?: boolean }>;
  };
  'camera:close': { request: void; response: CameraReply<CameraStatus> };
  'camera:start-stream': { request: void; response: CameraReply<CameraStatus> };
  'camera:stop-stream': { request: void; response: CameraReply<CameraStatus> };
  'camera:get-frame': {
    request: { timeoutMs?: number } | void;
    response: CameraReply<CameraFrameMeta & { data: ArrayBufferLike }>;
  };
  'camera:get-status': { request: void; response: CameraReply<CameraStatus> };
  'camera:set-exposure': {
    request: { valueMs: number };
    response: CameraReply<{ exposureMs: number }>;
  };
  'camera:set-gain': {
    request: { value: number };
    response: CameraReply<{ applied: Record<string, number> }>;
  };
  'camera:set-trigger-mode': {
    request: { value: boolean };
    response: CameraReply<{ triggerState: boolean }>;
  };
  'camera:measure-vickers-auto': {
    request: VickersAutoMeasureParameters;
    response: VickersAutoMeasureResult;
  };
  'camera:get-exposure-range': {
    request: void;
    response: CameraReply<CameraRange>;
  };
  'camera:get-gain-range': {
    request: void;
    response: CameraReply<CameraRange>;
  };
  'device:open': {
    request: { index?: number; micrometerPort?: string } | void;
    response: DeviceOpenResponse;
  };
  'device:close': { request: void; response: DeviceCloseResponse };
  'dialog:openImage': { request: void; response: OpenImageResult };
  'dialog:saveImage': { request: SaveImageRequest | void; response: SaveImageResult };
  'micrometer:open': { request: { port?: string } | void; response: MicrometerOpenResult };
  'micrometer:close': { request: void; response: MicrometerCloseResult };
  'micrometer:get-state': { request: void; response: MicrometerGetStateResult };
  'micrometer:get-latest-reading': { request: void; response: MicrometerGetLatestReadingResult };
};

export type IpcEventPayloadMap = {
  'app:status': [unknown];
  'camera:frame': [CameraFrameMeta, ArrayBufferLike];
  'camera:status': [Partial<CameraStatus>];
  'micrometer:state': [MicrometerState];
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
