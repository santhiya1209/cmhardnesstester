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

export type IpcInvokeChannel = 'app:getInfo' | 'app:ping';
export type IpcEventChannel = 'app:status';

export type IpcInvokeMap = {
  'app:getInfo': { request: void; response: AppInfo };
  'app:ping': { request: unknown; response: PingResponse };
};

export interface ElectronApi {
  invoke<C extends IpcInvokeChannel>(
    channel: C,
    payload?: IpcInvokeMap[C]['request']
  ): Promise<IpcInvokeMap[C]['response']>;
  on(channel: IpcEventChannel, listener: (...args: unknown[]) => void): () => void;
  platform: NodeJS.Platform;
}
