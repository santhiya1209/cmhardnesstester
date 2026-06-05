/// <reference types="vite/client" />

import type {
  ElectronApi,
  HardnessCameraApi,
  MachineControlApi,
  XyzPlatformApi,
} from './types/ipc';

interface ImportMetaEnv {
  readonly VITE_MODE: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_API_PROXY_TARGET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    api: ElectronApi;
    hardnessCamera: HardnessCameraApi;
    machineControl?: MachineControlApi;
    xyzPlatform?: XyzPlatformApi;
  }
}

export {};
