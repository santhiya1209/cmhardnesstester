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
import type {
  OpenImageResult,
  SaveImageRequest,
  SaveImageResult,
  SaveReportRequest,
  SaveReportResult,
} from './dialog';
import type { SerialPortListResult } from './serial';
import type {
  MicrometerCloseResult,
  MicrometerGetLatestReadingResult,
  MicrometerGetStateResult,
  MicrometerOpenResult,
  MicrometerState,
} from './micrometer';
import type {
  MachineApiResponse,
  MachineControlKey,
  MachineState,
  TurretDirection,
} from './machine';
import type {
  FocusMode,
  XyzCommandResult,
  XyzDiagnoseResult,
  XyzDirection,
  XyzLineControlResult,
  XyzProbeOptions,
  XyzProbeResult,
  XyzStageState,
  XyzStageStateResponse,
  XyzZDiagnoseResult,
  XySpeed,
  ZDirection,
  ZProbeResult,
  ZSpeed,
} from './xyzPlatform';
import type { ImageSelection, ZAxisSettingsPayload, ZAxisSettingsResult } from './zAxisSettings';

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
  setLiveExposureForFps(
    targetFps: number
  ): Promise<CameraReply<{ exposureMs: number; fpsCeiling?: number }>>;
  setLiveMode(profile: {
    roi?: { x: number; y: number; w: number; h: number };
    format?: 'mono8' | 'rgb24' | 'rgb32' | 'bgr24' | 'bgr32' | 'mono16' | 'raw8' | 'raw10' | 'raw12';
    resolutionMode?: number;
    exposureMs?: number;
    mono?: boolean;
  }): Promise<
    CameraReply<{
      appliedRoi: boolean;
      appliedFormat: boolean;
      appliedResolutionMode: boolean;
      appliedExposure: boolean;
      appliedMono: boolean;
    }>
  >;
  setGain(value: number): Promise<CameraReply<{ gain: number }>>;
  getExposureRange(): Promise<CameraReply<CameraRange>>;
  getGainRange(): Promise<CameraReply<CameraRange>>;
  openDevice(payload?: { index?: number; micrometerPort?: string }): Promise<DeviceOpenResponse>;
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
  | 'camera:get-status'
  | 'camera:set-exposure'
  | 'camera:set-gain'
  | 'camera:get-exposure-range'
  | 'camera:get-gain-range'
  | 'camera:set-trigger-mode'
  | 'camera:measure-vickers-auto'
  | 'camera:frame-ack'
  | 'camera:flush-stream'
  | 'device:open'
  | 'device:close'
  | 'dialog:openImage'
  | 'dialog:saveImage'
  | 'dialog:saveReport'
  | 'serial:list-ports'
  | 'micrometer:open'
  | 'micrometer:close'
  | 'micrometer:get-state'
  | 'micrometer:get-latest-reading'
  | 'machine:get-state'
  | 'machine:set-objective'
  | 'machine:set-force'
  | 'machine:set-lightness'
  | 'machine:set-load-time'
  | 'machine:set-hardness-level'
  | 'machine:apply-objective-brightness'
  | 'machine:start-indent'
  | 'machine:move-turret'
  | 'xyz-platform:get-state'
  | 'xyz-platform:connect'
  | 'xyz-platform:disconnect'
  | 'xyz-platform:move-stage'
  | 'xyz-platform:stop-stage'
  | 'xyz-platform:move-z'
  | 'xyz-platform:stop-z'
  | 'xyz-platform:lock-z'
  | 'xyz-platform:unlock-z'
  | 'xyz-platform:lock-xy'
  | 'xyz-platform:unlock-xy'
  | 'xyz-platform:set-focus-mode'
  | 'xyz-platform:set-xy-speed'
  | 'xyz-platform:set-z-speed'
  | 'xyz-platform:get-position'
  | 'xyz-platform:move-center'
  | 'xyz-platform:locate-center'
  | 'xyz-platform:set-center'
  | 'xyz-platform:home'
  | 'xyz-platform:get-z-settings'
  | 'xyz-platform:save-z-settings'
  | 'xyz-platform:preview-z-settings'
  | 'xyz-platform:revert-z-settings';

export type IpcEventChannel =
  | 'app:status'
  | 'camera:frame'
  | 'camera:status'
  | 'micrometer:state'
  | 'machine:state'
  | 'xyz-platform:state';

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
  'camera:frame-ack': {
    request: { frameId: number };
    response: { ok: boolean };
  };
  'camera:flush-stream': {
    request: { reason?: string } | void;
    response: { ok: boolean; flushUntilAt: number };
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
  'dialog:saveReport': { request: SaveReportRequest; response: SaveReportResult };
  'serial:list-ports': { request: void; response: SerialPortListResult };
  'micrometer:open': { request: { port?: string } | void; response: MicrometerOpenResult };
  'micrometer:close': { request: void; response: MicrometerCloseResult };
  'micrometer:get-state': { request: void; response: MicrometerGetStateResult };
  'micrometer:get-latest-reading': { request: void; response: MicrometerGetLatestReadingResult };
  'machine:get-state': { request: void; response: MachineApiResponse };
  'machine:set-objective': { request: { value: string | number }; response: MachineApiResponse };
  'machine:set-force': { request: { value: string | number }; response: MachineApiResponse };
  'machine:set-lightness': { request: { value: string | number }; response: MachineApiResponse };
  'machine:set-load-time': { request: { value: string | number }; response: MachineApiResponse };
  'machine:set-hardness-level': { request: { value: string | number }; response: MachineApiResponse };
  'machine:apply-objective-brightness': {
    request: { objective: string };
    response: MachineApiResponse;
  };
  'machine:start-indent': { request: void; response: MachineApiResponse };
  'machine:move-turret': { request: { direction: TurretDirection }; response: MachineApiResponse };
  'xyz-platform:get-state': { request: void; response: XyzStageStateResponse };
  'xyz-platform:connect': {
    request: { port: string; baudRate?: number } | void;
    response: XyzStageStateResponse;
  };
  'xyz-platform:disconnect': { request: void; response: XyzStageStateResponse };
  'xyz-platform:move-stage': {
    request: { direction: XyzDirection };
    response: XyzCommandResult;
  };
  'xyz-platform:move-to-point': {
    request: { x: number; y: number };
    response: XyzCommandResult;
  };
  'xyz-platform:stop-stage': { request: void; response: XyzCommandResult };
  'xyz-platform:move-z': {
    request: { direction: ZDirection; speed: ZSpeed };
    response: XyzCommandResult;
  };
  'xyz-platform:stop-z': { request: void; response: XyzCommandResult };
  'xyz-platform:lock-z': { request: void; response: XyzCommandResult };
  'xyz-platform:unlock-z': { request: void; response: XyzCommandResult };
  'xyz-platform:lock-xy': { request: void; response: XyzCommandResult };
  'xyz-platform:unlock-xy': { request: void; response: XyzCommandResult };
  'xyz-platform:set-focus-mode': { request: { mode: FocusMode }; response: XyzCommandResult };
  'xyz-platform:set-xy-speed': { request: { speed: XySpeed }; response: XyzCommandResult };
  'xyz-platform:set-z-speed': { request: { speed: ZSpeed }; response: XyzCommandResult };
  'xyz-platform:get-position': { request: void; response: XyzCommandResult };
  'xyz-platform:move-center': { request: void; response: XyzCommandResult };
  'xyz-platform:locate-center': { request: void; response: XyzCommandResult };
  'xyz-platform:set-center': { request: void; response: XyzCommandResult };
  'xyz-platform:home': { request: void; response: XyzCommandResult };
  'xyz-platform:get-z-settings': { request: void; response: ZAxisSettingsResult };
  'xyz-platform:save-z-settings': { request: ZAxisSettingsPayload; response: ZAxisSettingsResult };
  'xyz-platform:preview-z-settings': {
    request: { imageSelection: ImageSelection };
    response: ZAxisSettingsResult;
  };
  'xyz-platform:revert-z-settings': { request: void; response: ZAxisSettingsResult };
};

export type IpcEventPayloadMap = {
  'app:status': [unknown];
  'camera:frame': [CameraFrameMeta, ArrayBufferLike];
  'camera:status': [Partial<CameraStatus>];
  'micrometer:state': [MicrometerState];
  'machine:state': [MachineState];
  'xyz-platform:state': [XyzStageState];
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

export interface MachineControlApi {
  getState(): Promise<MachineApiResponse>;
  subscribeState(listener: (state: MachineState) => void): () => void;
  setObjective(value: string | number): Promise<MachineApiResponse>;
  setForce(value: string | number): Promise<MachineApiResponse>;
  setLightness(value: string | number): Promise<MachineApiResponse>;
  setLoadTime(value: string | number): Promise<MachineApiResponse>;
  setHardnessLevel(value: string | number): Promise<MachineApiResponse>;
  applyObjectiveBrightness(objective: string): Promise<MachineApiResponse>;
  setValue(key: MachineControlKey, value: string | number): Promise<MachineApiResponse>;
  startIndent(): Promise<MachineApiResponse>;
  moveTurret(direction: TurretDirection): Promise<MachineApiResponse>;
}

export interface XyzPlatformApi {
  getState(): Promise<XyzStageStateResponse>;
  subscribeState(listener: (state: XyzStageState) => void): () => void;
  connect(opts: { port: string; baudRate?: number }): Promise<XyzStageStateResponse>;
  disconnect(): Promise<XyzStageStateResponse>;
  diagnose(): Promise<XyzDiagnoseResult>;
  /** RTS/DTR line-control diagnostic — sweeps the four combos sending safe #10!. */
  testLineControl(): Promise<XyzLineControlResult>;
  /** Expert dev-console probe. WARNING: a moving command WILL move the stage. */
  probe(commandText: string, options?: XyzProbeOptions): Promise<XyzProbeResult>;
  /** Start a press-and-hold jog in `direction`. Release calls stopStage(). */
  moveStage(direction: XyzDirection): Promise<XyzCommandResult>;
  /** Quick tap: move exactly the configured per-tier step distance once (RX-gated). */
  moveStep(direction: XyzDirection): Promise<XyzCommandResult>;
  /** Absolute point move: x/y are mm offsets from the taught optical center (RX-gated). */
  moveToPoint(x: number, y: number): Promise<XyzCommandResult>;
  stopStage(): Promise<XyzCommandResult>;
  /** Quick-tap Z step (one configured stepDistanceMm, RX-gated). */
  moveZ(direction: ZDirection, speed: ZSpeed): Promise<XyzCommandResult>;
  stopZ(): Promise<XyzCommandResult>;
  /** Open the dedicated Z serial connection on the configured Z port. */
  connectZ(opts: { port: string; baudRate?: number }): Promise<XyzStageStateResponse>;
  disconnectZ(): Promise<XyzStageStateResponse>;
  /** Press-and-hold Z jog start (#+S#/#-S#). Release calls stopZJog(). */
  startZJog(direction: ZDirection): Promise<XyzCommandResult>;
  stopZJog(): Promise<XyzCommandResult>;
  /** Poll Z status (#sss#). */
  pollZStatus(): Promise<XyzCommandResult>;
  /** Manual Z probe (dev console). probeZ('LK') → #LK#, probeZ('+Z 15') → #+Z 15#. */
  probeZ(payload: string): Promise<ZProbeResult>;
  /** Diagnostic: probe candidate stop payloads (#SSS#/#S#/#STOP#/#ST#/#UP#). */
  diagnoseStopZ(): Promise<{ ok: boolean; probes: ZProbeResult[] }>;
  /** Dev diagnostic — runs the legacy Z command sequence and reports TX/RX. */
  diagnoseZ(options?: { includeJog?: boolean; speedRegisterValue?: number }): Promise<XyzZDiagnoseResult>;
  lockZ(): Promise<XyzCommandResult>;
  unlockZ(): Promise<XyzCommandResult>;
  lockXy(): Promise<XyzCommandResult>;
  unlockXy(): Promise<XyzCommandResult>;
  setFocusMode(mode: FocusMode): Promise<XyzCommandResult>;
  setXySpeed(speed: XySpeed): Promise<XyzCommandResult>;
  setZSpeed(speed: ZSpeed): Promise<XyzCommandResult>;
  getPosition(): Promise<XyzCommandResult>;
  /** ⊕ Center: move to the taught optical center from the current position (no home). */
  moveToCenter(): Promise<XyzCommandResult>;
  /** Relocation: home (#12!) first, then move to the taught optical center. */
  locateCenter(): Promise<XyzCommandResult>;
  /** Teach: capture the current position as the optical center and persist it. */
  setCenter(): Promise<XyzCommandResult>;
  /** Dedicated hardware home (#12!) — the controller's zero, separate from Relocation. */
  home(): Promise<XyzCommandResult>;
  /** Read the backend-owned Z Axis settings singleton. */
  getZSettings(): Promise<ZAxisSettingsResult>;
  /** Persist the full Z Axis settings (Confirm). */
  saveZSettings(settings: ZAxisSettingsPayload): Promise<ZAxisSettingsResult>;
  /** Apply ONLY the image-selection in-memory (Preview) — no DB write, no hardware. */
  previewZSettings(imageSelection: ImageSelection): Promise<ZAxisSettingsResult>;
  /** Discard an in-memory preview, reverting to the last saved settings (Cancel). */
  revertZSettings(): Promise<ZAxisSettingsResult>;
}
