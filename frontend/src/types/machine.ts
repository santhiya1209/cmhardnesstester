export type IndentStatus = 'idle' | 'started' | 'running' | 'completed' | 'error';

export type MachineControlKey =
  | 'force'
  | 'lightness'
  | 'loadTime'
  | 'objective'
  | 'hardnessLevel';

export type MachineCommandKey = MachineControlKey | 'indent';
export type MachineCommandVerification = Record<MachineCommandKey, boolean>;

export interface MachineState {
  connected: boolean;
  port: string | null;
  force: string | number;
  lightness: string | number;
  loadTime: string | number;
  objective: string;
  hardnessLevel: string;
  indentStatus: IndentStatus;
  commandVerification?: MachineCommandVerification;
  lastUpdatedBy: 'pc' | 'machine' | 'system';
  lastError?: string;
  updatedAt: string;
}

export interface ConnectMachineRequest {
  port: string;
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 1.5 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
}

export interface MachineApiResponse {
  ok: boolean;
  state: MachineState;
  error?: string;
  message?: string;
}
