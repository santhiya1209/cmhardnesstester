/// <reference types="vite/client" />

import type { ElectronApi } from './types/ipc';

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
  }
}

export {};
