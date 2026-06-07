
import type { FocusMode, XySpeed, ZSpeed } from './xyzPlatformState';

export type { FocusMode, XySpeed, ZSpeed };

export type XyzDirection =
  | 'left'
  | 'right'
  | 'forward'
  | 'back'
  | 'forward-left'
  | 'forward-right'
  | 'back-left'
  | 'back-right';

export type ZDirection = 'up' | 'down';

export type XyzSerialMode = 'separate' | 'shared' | 'unknown';

export interface XyzPosition {
  x: number;
  y: number;
  z: number;
}

/** Mirrors the backend xyz-platform action-route result shape. */
export type XyzCommandResult =
  | { ok: true; position?: XyzPosition; rx?: string; commandId: string }
  | { ok: false; error: string; commandId?: string; message?: string };

/** Live stage state broadcast over the `xyz-platform:state` IPC event. */
export interface XyzStageState {
  connected: boolean;
  port: string | null;
  serialMode: XyzSerialMode;
  position: XyzPosition;
  xySpeed: XySpeed;
  zSpeed: ZSpeed;
  xyLocked: boolean;
  zLocked: boolean;
  focusMode: FocusMode;
  moving: boolean;
  lastAction: string;
  lastError?: string;
  lastTx?: string;
  lastRx?: string;
  lastCommandId?: string;
  updatedAt: string;
}

export interface XyzStageStateResponse {
  ok: boolean;
  state: XyzStageState;
  error?: string;
  message?: string;
}

export interface XyzOpenSettings {
  baudRate: number;
  dataBits: number;
  parity: string;
  stopBits: number;
}

/** One probe's outcome from the hardware diagnostic / manual probe. */
export interface XyzProbeResult {
  label: string;
  tx: string;
  txHex: string;
  rx: string | null;
  rxHex?: string;
  /** How the RX parsed: 'ack' (success), 'error' (ERROR), 'position', 'unknown'. */
  classification?: 'ack' | 'error' | 'position' | 'unknown';
  error?: string;
}

/** Options for the expert manual probe (`window.xyzPlatform.probe`). */
export interface XyzProbeOptions {
  /** false (default) = raw byte-exact; true = append checksum + 0x21 to a "#..!" command. */
  checksum?: boolean;
  /** Alias for `checksum` — 'raw' (default) or 'checksum'. */
  mode?: 'raw' | 'checksum';
  terminator?: 'none' | 'cr' | 'crlf';
  timeoutMs?: number;
}

/** One baud rate's outcome from the diagnose() sweep (8N1). */
export interface XyzBaudSweepEntry {
  baudRate: number;
  anyRx: boolean;
  probes: XyzProbeResult[];
  error?: string;
}

/** Result of `window.xyzPlatform.diagnose()` — see the [xyz-probe-*] logs for detail. */
export interface XyzDiagnoseResult {
  ok: boolean;
  error?: string;
  port: string | null;
  open: XyzOpenSettings | null;
  anyRx: boolean;
  probes: XyzProbeResult[];
  /** Present only when the current-baud probes all timed out and a sweep ran. */
  sweep?: XyzBaudSweepEntry[];
  summary: string;
}

/** One RTS/DTR combination's outcome from `window.xyzPlatform.testLineControl()`. */
export interface XyzLineControlEntry {
  rts: boolean;
  dtr: boolean;
  setOk: boolean;
  setError?: string;
  tx: string;
  txHex: string;
  rx: string | null;
  rxHex?: string;
}

/** Result of `window.xyzPlatform.testLineControl()` — see the [xyz-line-control*] logs. */
export interface XyzLineControlResult {
  ok: boolean;
  error?: string;
  port: string | null;
  open: XyzOpenSettings | null;
  supported: boolean;
  anyRx: boolean;
  configs: XyzLineControlEntry[];
  summary: string;
}
