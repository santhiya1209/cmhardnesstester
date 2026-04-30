export type MicrometerStatus = 'valid' | 'waiting' | 'invalid' | 'waiting_for_valid_frame';

export interface MicrometerState {
  connected: boolean;
  portName: string | null;
  status: MicrometerStatus;
  value: number | null;
  displayValue: string;
  unit: 'mm';
  raw: string | null;
  rawAscii: string | null;
  rawHex: string;
  lastError: string | null;
  updatedAt: string | null;
  timestamp: number | null;
  lockedBaudRate?: number | null;
}

export interface MicrometerOpenResult {
  ok: boolean;
  alreadyOpen?: boolean;
  state?: MicrometerState;
  error?: string;
  message?: string;
}

export interface MicrometerCloseResult {
  ok: boolean;
  alreadyClosed?: boolean;
  error?: string;
  message?: string;
}

export interface MicrometerGetStateResult {
  ok: true;
  state: MicrometerState;
}
