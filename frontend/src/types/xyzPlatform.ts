
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
  | {
      ok: false;
      error: string;
      commandId?: string;
      message?: string;
      /**
       * True when a stop (#0B) intentionally preempted this command — expected
       * jog control flow, NOT an error. Callers must not surface it to the user.
       */
      preempted?: boolean;
    };

/** Live stage state broadcast over the `xyz-platform:state` IPC event. */
export interface XyzStageState {
  connected: boolean;
  port: string | null;
  serialMode: XyzSerialMode;
  /** Raw hardware position in PULSES (exactly what the #11 frame reports). */
  position: XyzPosition;
  /** Position in MILLIMETRES (pulses / pulsePerMm), derived in the backend from the
   * same real #11 RX frame. This is the value shown in the UI — never computed here. */
  positionMm: XyzPosition;
  xySpeed: XySpeed;
  zSpeed: ZSpeed;
  xyLocked: boolean;
  zLocked: boolean;
  /** Z serial connection — INDEPENDENT of `connected` (the X/Y port). */
  zConnected: boolean;
  zPort: string | null;
  /** True while a Z press-and-hold jog is in flight (separate from X/Y `moving`). */
  zMoving: boolean;
  focusMode: FocusMode;
  moving: boolean;
  /** False until a real position frame has been received (UI shows "--"). */
  positionKnown: boolean;
  /** Operator-taught optical center (absolute pulses), or null until taught. */
  centerX: number | null;
  centerY: number | null;
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

/** One Z diagnostic probe — exact TX and whatever (if anything) came back. */
export interface ZProbeResult {
  label: string;
  tx: string;
  rx: string | null;
  classification: 'ack' | 'status' | 'error' | 'unknown' | null;
  error?: string;
}

/** Result of `window.xyzPlatform.diagnoseZ()` — see the [z-*] logs for detail. */
export interface XyzZDiagnoseResult {
  ok: boolean;
  error?: string;
  port: string | null;
  baudRate: number | null;
  anyRx: boolean;
  probes: ZProbeResult[];
  summary: string;
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
