import { EventEmitter } from 'node:events';
import {
  buildGetPositionCommand,
  buildHomeCommand,
  buildJogMoveCommand,
  buildLockXyCommand,
  buildRelocationMoveCommand,
  buildSetXAccelerationCommand,
  buildSetXBeginSpeedCommand,
  buildSetXFinalSpeedCommand,
  buildSetYAccelerationCommand,
  buildSetYBeginSpeedCommand,
  buildSetYFinalSpeedCommand,
  buildStopXyCommand,
  buildUnlockXyCommand,
  buildXyVisibleCommandPayload,
  isBusyResponseToken,
  isMoveClassCommand,
  normalizeXySpeed,
  parseXyzFrame,
  positionFrameCompletesCommand,
  type XyzBuiltCommand,
  type XyzCommandKey,
  type XyzExpect,
  type XyzProtocolMode,
  type XyzDirection,
  type XyzPosition,
  type XySpeed,
  type ZDirection,
  type ZSpeed,
} from './xyz-platform-protocol';
import { getSerialQueue } from './serial-command-queue';
import { hardnessMachineSerialService } from './hardness-machine-serial.service';
import {
  zAxisSerialService,
  type ConnectZOptions,
  type ZCommandResult,
  type ZDiagnoseResult,
  type ZProbeResult,
  type ZStopDiagnosis,
} from './z-axis-serial.service';
import { resolveZSign, zMmToPulses, zSpeedRegisterValue } from './z-axis-protocol';
import { zSettingsService } from './z-settings.service';
import { randomUUID } from 'node:crypto';
import { readCollection } from '../db';
import { upsertRows } from '../sqlite';
import type { XYZCenterCalibration } from '../../models/xyz-center-calibration';
import {
  DEFAULT_XYZ_PLATFORM_SETTINGS,
  type XyzSpeedProfile,
  type XYZPlatformSettings,
  type XYZPlatformSettingsPayload,
} from '../../models/xyz-platform-settings';

/**
 * Normalize a persisted XY Platform Settings row to the CURRENT shape. Rows saved
 * by an older build may still carry the legacy speed-profile fields
 * (stepDistanceMm / beginSpeedMmS / accelerationMmS2 / finalSpeedMmS /
 * registerValue) and lack the new begin/accel/final register values — those legacy
 * fields are ignored and any missing new field is filled from
 * DEFAULT_XYZ_PLATFORM_SETTINGS. This guarantees the backend never builds a #05–#0A
 * frame from an `undefined` register value. Pure settings-shape normalization — no
 * movement, no serial side effect, no fabricated hardware value.
 */
function normalizeXyzSettings(
  row: Partial<XYZPlatformSettings> | null | undefined
): XYZPlatformSettingsPayload {
  const d = DEFAULT_XYZ_PLATFORM_SETTINGS;
  if (!row) return structuredClone(d);
  const rawProfiles = (row.speedProfiles ?? {}) as Record<string, Partial<XyzSpeedProfile>>;
  // A row persisted during the (reverted) six-tier window keyed these tiers as
  // medium/ultraFast — fall back to those so an operator's customized values still
  // carry into mid/ultra.
  const legacyProfileKey: Record<string, string> = { mid: 'medium', ultra: 'ultraFast' };
  const modes = Object.keys(d.speedProfiles) as Array<keyof typeof d.speedProfiles>;
  const speedProfiles = Object.fromEntries(
    modes.map((mode) => {
      const def = d.speedProfiles[mode];
      const p = rawProfiles[mode] ?? rawProfiles[legacyProfileKey[mode]] ?? {};
      return [
        mode,
        {
          beginRegisterValue: p.beginRegisterValue ?? def.beginRegisterValue,
          accelerationRegisterValue: p.accelerationRegisterValue ?? def.accelerationRegisterValue,
          finalRegisterValue: p.finalRegisterValue ?? def.finalRegisterValue,
          approxMmS: p.approxMmS ?? def.approxMmS,
          // Per-tap step distance; fall back to the tier default when an older row
          // has no value so a quick tap always has a defined distance to move.
          stepDistanceMm: p.stepDistanceMm ?? def.stepDistanceMm,
        },
      ];
    })
  ) as XYZPlatformSettingsPayload['speedProfiles'];
  return {
    runningByNewThread: row.runningByNewThread ?? d.runningByNewThread,
    hasEmptyTrip: row.hasEmptyTrip ?? d.hasEmptyTrip,
    reverseXAxis: row.reverseXAxis ?? d.reverseXAxis,
    reverseYAxis: row.reverseYAxis ?? d.reverseYAxis,
    pulsePerMm: row.pulsePerMm ?? d.pulsePerMm,
    travelXmm: row.travelXmm ?? d.travelXmm,
    travelYmm: row.travelYmm ?? d.travelYmm,
    physicalCenterXmm: row.physicalCenterXmm ?? d.physicalCenterXmm,
    physicalCenterYmm: row.physicalCenterYmm ?? d.physicalCenterYmm,
    physicalCenterXpulses: row.physicalCenterXpulses ?? d.physicalCenterXpulses,
    physicalCenterYpulses: row.physicalCenterYpulses ?? d.physicalCenterYpulses,
    emptyTrip: { ...d.emptyTrip, ...(row.emptyTrip ?? {}) },
    speedProfiles,
  };
}

// Defensive require so the backend keeps booting even if `serialport` is not
// rebuilt for the current Node ABI yet — mirrors the hardness-machine service.
type SerialPortCtor = new (opts: {
  path: string;
  baudRate: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 1.5 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
  rtscts?: boolean;
  xon?: boolean;
  xoff?: boolean;
  autoOpen?: boolean;
}) => SerialPortInstance;

type SerialPortInstance = {
  open: (cb: (err: Error | null) => void) => void;
  close: (cb?: (err: Error | null) => void) => void;
  write: (data: Buffer, cb?: (err: Error | null | undefined) => void) => boolean;
  drain: (cb?: (err: Error | null | undefined) => void) => void;
  // Change line settings (baud) on the open port without closing it. Used only
  // by the diagnose() baud sweep. Optional so older serialport builds degrade
  // to a clear "unsupported" sweep entry instead of crashing.
  update?: (opts: { baudRate: number }, cb?: (err: Error | null | undefined) => void) => void;
  // Assert/deassert the RTS/DTR modem control lines on the open port. Used only
  // by testLineControl(). Optional so older serialport builds degrade to a clear
  // "unsupported" result instead of crashing.
  set?: (
    opts: { rts?: boolean; dtr?: boolean; brk?: boolean },
    cb?: (err: Error | null | undefined) => void
  ) => void;
  // Discard the OS RX/TX buffers. Used only by testLineControl() before a probe
  // TX so a stale byte can't masquerade as a fresh reply (diagnosis only).
  flush?: (cb?: (err: Error | null | undefined) => void) => void;
  on: (event: 'data' | 'error' | 'close', listener: (...args: unknown[]) => void) => void;
  isOpen: boolean;
};

/** Minimal shape of a SerialPort.list() entry — only the fields we log. */
type SerialPortListEntry = {
  path?: string;
  friendlyName?: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
};

type SerialPortStatic = SerialPortCtor & {
  list?: () => Promise<SerialPortListEntry[]>;
};

let SerialPortLib: { SerialPort: SerialPortStatic } | null = null;
let serialPortLoadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SerialPortLib = require('serialport') as { SerialPort: SerialPortStatic };
} catch (err) {
  serialPortLoadError = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error('[xyz-serial-error] serialport module not available:', serialPortLoadError);
}

// XY line settings: 9600 8N1, no flow control — HARDWARE-VERIFIED via Hercules
// on the COM6 controller (an earlier diagnose sweep mis-guessed 57600). This is
// only the DEFAULT when connectStage isn't given an explicit baudRate; the value
// is still parameterizable per call. Movement is one pulse at a time (the safe
// step); per-axis ramp speeds are configured separately via setXySpeed.
const DEFAULT_BAUD_RATE = 9600;
const TX_TIMEOUT_MS = 5000;
// Per-probe RX collection window used only by diagnose(). Short because a live
// controller answers within a few hundred ms; long enough to catch a slow reply.
const PROBE_WINDOW_MS = 800;
// Press-and-hold JOG: the confirmed protocol has no continuous-motion command,
// so a jog press sends ONE relative move with a large, bounded full-travel pulse
// count and the release sends Stop (#0B). Bounded (not the 8-digit max) so a
// missed release can never drive to the extreme; the watchdog + limit sensors
// are the backstops. Position only ever comes from the Stop's #11 reply.
const JOG_PULSES = 1_000_000;
// Backend safety watchdog: if no Stop arrives within this window after a jog
// starts (release event missed, renderer/IPC dropped), the service sends #0B
// itself. Bounds runaway TIME just as JOG_PULSES bounds runaway DISTANCE.
const JOG_WATCHDOG_MS = 10_000;
// X/Y MOVE/HOME protocol is HARDWARE-VERIFIED (Hercules): moveX #0C, moveY #0E,
// moveXY #11 (position reply), home #12 (no immediate ACK -> query #10! after a
// delay). Movement is RX-gated: success only from a real position reply (no fake
// success, no optimistic update). Set back to false to re-block if needed.
const MOVE_COMMANDS_CONFIRMED = true;
const MOVE_NOT_CONFIRMED = 'XYZ_STAGE_COMMAND_NOT_CONFIRMED';
// Home (#12!) runs the controller's homing cycle and emits a SINGLE position frame
// only when homing FINISHES — up to this long later. We wait for that real idle
// frame as the command's completion (no fire-and-forget, no #10! poll: a #10!
// issued mid-home returns a misleading idle frame at the pre-home position). A
// stage that never homes fails honestly when this ceiling elapses.
const HOME_TIMEOUT_MS = 60000;
// Center / Relocation traversal to the physical center is a full-travel absolute
// move (#11/#0C/#0E) that can take far longer than the default 5s ACK window to
// physically complete — the controller only emits its final idle position frame
// when motion finishes. Give that move the same long ceiling as home so the
// waiter doesn't reject with XYZ_STAGE_ACK_TIMEOUT while the stage is still
// moving. Only long-running motion uses this; lock/unlock/speed/getPosition keep
// the short TX_TIMEOUT_MS.
const MOVE_TIMEOUT_MS = 60000;
// Settle poll for move-class commands (#0C/#0E/#11): after a busy ('-') position
// frame, re-query #10! this often to elicit the final idle ('+') frame that
// completes the move. Small and conservative; the move's existing TX_TIMEOUT_MS
// is the hard ceiling (the poll never extends it). Only ever ONE poll is in flight
// and only while the original move command is still pending — no concurrent TX.
const SETTLE_POLL_MS = 120;
// Preemption is a CONTROLLED transition (a new command intentionally superseded
// an in-flight one), not a hardware failure.
const PREEMPTED_MESSAGE = 'Previous stage command was stopped to run the new command.';
const STAGE_COMMAND_FAILED_MESSAGE = 'XYZ stage command failed. Check connection and try again.';

/**
 * Map an internal error CODE to an operator-facing message. Codes that already
 * carry a human sentence (e.g. 'Z Axis port not configured') are returned as-is;
 * everything else that isn't explicitly mapped falls back to the generic
 * "command failed" message so a raw token like a serial timeout never reaches
 * the UI. The raw code still travels in `result.error` for logs/diagnostics.
 */
function friendlyXyzMessage(code: string): string {
  switch (code) {
    case 'XYZ_STAGE_PREEMPTED':
      return PREEMPTED_MESSAGE;
    case 'XYZ_STAGE_NOT_CONNECTED':
      return 'XYZ stage is not connected. Connect the stage and try again.';
    case 'XYZ_STAGE_XY_UNLOCKED':
      return 'Lock the X/Y stage before moving.';
    case 'XYZ_STAGE_NO_POSITION':
      return 'Cannot read the stage position. Check connection and try again.';
    case 'XYZ_STAGE_HOME_TIMEOUT':
      return 'Homing did not complete. Check the stage and try again.';
    case 'Z Axis port not configured':
      return 'Z Axis port not configured. Set it in Serial Port Setting.';
    case 'XYZ_Z_NOT_CONNECTED':
      return 'Z axis is not connected. Connect the Z port and try again.';
    case 'XYZ_Z_UNLOCKED':
      return 'Lock the Z axis before moving.';
    case 'XYZ_Z_BUSY':
      return 'Z axis is already moving.';
    case 'XYZ_Z_STOP_UNCONFIRMED':
      return 'Z jog stop was not confirmed by the controller. Check the Z connection.';
    case 'XYZ_Z_TIMEOUT':
      return 'The Z controller did not respond. Check the Z connection and try again.';
    case 'Z_STAGE_PROTOCOL_ERROR':
      return 'The Z controller reported an error (ERROR).';
    default:
      return STAGE_COMMAND_FAILED_MESSAGE;
  }
}

export type XyzSerialMode = 'separate' | 'shared' | 'unknown';

export type FocusMode = 'manual' | 'cFocus' | 'fFocus';

export interface XyzStageState {
  connected: boolean;
  port: string | null;
  serialMode: XyzSerialMode;
  /** Raw hardware position in PULSES (exactly what the #11 frame reports). */
  position: XyzPosition;
  /**
   * Position in MILLIMETRES — `position` pulses divided by the configured
   * pulsePerMm. Derived in the backend from the SAME real #11 RX frame as
   * `position` (never computed/simulated in the frontend); this is the value the
   * UI displays.
   */
  positionMm: XyzPosition;
  xySpeed: XySpeed;
  zSpeed: ZSpeed;
  xyLocked: boolean;
  zLocked: boolean;
  /**
   * Z serial connection state — INDEPENDENT of `connected` (which is the X/Y
   * port). The Z axis is a separate physical connection on its own port.
   */
  zConnected: boolean;
  zPort: string | null;
  /** True while a Z press-and-hold jog is in flight (separate from X/Y `moving`). */
  zMoving: boolean;
  focusMode: FocusMode;
  moving: boolean;
  /**
   * False until a real position frame (#10!/#11) has been received, so the UI
   * can show "--" instead of a fabricated 0,0 before the stage is ever read.
   */
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

export interface ConnectStageOptions {
  port: string;
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 1.5 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
}

export type XyzCommandResult =
  | { ok: true; position?: XyzPosition; rx?: string; commandId: string }
  | {
      ok: false;
      error: string;
      commandId?: string;
      message?: string;
      /**
       * True when this command failed because a stop (#0B) intentionally
       * preempted it — expected jog control flow, NOT a hardware error. Callers
       * must treat it as a no-op (no error toast), never as a failure.
       */
      preempted?: boolean;
    };

export interface XyzOpenSettings {
  baudRate: number;
  dataBits: number;
  parity: string;
  stopBits: number;
}

/** One probe's outcome from diagnose() — the exact bytes sent and anything received. */
export interface XyzProbeResult {
  label: string;
  /** ASCII rendering of the bytes written. */
  tx: string;
  /** Hex rendering of the bytes written. */
  txHex: string;
  /** Raw bytes received within the window, or null if the probe timed out. */
  rx: string | null;
  rxHex?: string;
  /** How the RX parsed: 'ack' (success), 'error' (ERROR), 'position', 'unknown'. */
  classification?: 'ack' | 'error' | 'position' | 'unknown';
  error?: string;
}

/** One baud rate's outcome from the diagnose() sweep (8N1, probes re-sent at each baud). */
export interface XyzBaudSweepEntry {
  baudRate: number;
  anyRx: boolean;
  probes: XyzProbeResult[];
  error?: string;
}

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

/** One RTS/DTR combination's outcome from testLineControl(). */
export interface XyzLineControlEntry {
  rts: boolean;
  dtr: boolean;
  /** Whether the .set({rts,dtr}) call succeeded. */
  setOk: boolean;
  setError?: string;
  /** ASCII rendering of the #10! bytes sent under this combo. */
  tx: string;
  txHex: string;
  /** Raw bytes received within the window, or null if it timed out. */
  rx: string | null;
  rxHex?: string;
}

export interface XyzLineControlResult {
  ok: boolean;
  error?: string;
  port: string | null;
  open: XyzOpenSettings | null;
  /** Whether the serialport build supports RTS/DTR control (.set). */
  supported: boolean;
  anyRx: boolean;
  configs: XyzLineControlEntry[];
  summary: string;
}

const DEFAULT_STATE: XyzStageState = {
  connected: false,
  port: null,
  serialMode: 'unknown',
  position: { x: 0, y: 0, z: 0 },
  positionMm: { x: 0, y: 0, z: 0 },
  xySpeed: 'slow',
  zSpeed: 'fast',
  xyLocked: false,
  zLocked: false,
  zConnected: false,
  zPort: null,
  zMoving: false,
  focusMode: 'manual',
  moving: false,
  positionKnown: false,
  centerX: null,
  centerY: null,
  lastAction: 'XYZ stage idle.',
  updatedAt: new Date().toISOString(),
};

function hexSpaced(buf: Buffer): string {
  return buf.toString('hex').toUpperCase().replace(/(..)(?=.)/g, '$1 ');
}

// Render a string with control bytes escaped (\r \n \t, else \xHH) for logs —
// so a CR/LF terminator is visible instead of being swallowed by the terminal.
function toPrintable(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1F\x7F]/g, (c) => {
    if (c === '\r') return '\\r';
    if (c === '\n') return '\\n';
    if (c === '\t') return '\\t';
    return '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase();
  });
}

class XyzPlatformSerialService extends EventEmitter {
  private state: XyzStageState = { ...DEFAULT_STATE };
  private port: SerialPortInstance | null = null;
  private rxBuffer = '';
  private pendingResolve: ((position: XyzPosition | null) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCommandId: string | null = null;
  // Epoch ms when the in-flight command registered its waiter — used to report
  // oldCommandAgeMs in [xyz-preempt] when a stop interrupts it.
  private pendingStartedAt: number | null = null;
  // RX kind the in-flight command is waiting for — logged in [xyz-ack-match] /
  // [xyz-rx-unmatched] so an unexpected reply is traceable to what was expected.
  private pendingExpect: XyzExpect | null = null;
  // Protocol command id of the in-flight command (e.g. 'moveXy', 'getPosition').
  // Drives the move-class settle-gate: a move (#0C/#0E/#11) completes only on an
  // idle position frame, every other consumer on the first reply.
  private pendingKey: XyzCommandKey | null = null;
  // Active move-settle re-query timer (#10!). Non-null only while a move-class
  // command is waiting out a busy ('-') frame. One poll in flight at a time.
  private settlePollTimer: ReturnType<typeof setTimeout> | null = null;
  // In-flight TX context, surfaced in [xyz-protocol-error] (label + tx text/hex).
  private pendingLabel: string | null = null;
  private pendingTxVisible: string | null = null;
  private pendingTxHex: string | null = null;
  // Expected ACK code for the in-flight command (e.g. "LK" lock, "05" speed).
  // null => any ACK resolves. A mismatched code never resolves (no fake success).
  private pendingAckCode: string | null = null;
  private commandSequence = 0;
  // Resolved line settings from the last successful open — reported by diagnose().
  private openSettings: XyzOpenSettings | null = null;
  // When non-null, every RX chunk is also appended here. diagnose() uses this to
  // collect raw bytes per probe without relying on the frame parser (the whole
  // point of diagnosis is that the reply format is unknown).
  private rawCapture: { text: string } | null = null;

  // Serial connection configuration. `port: null` means NOT configured — no
  // auto-open, and every command fails with "XYZ serial port not configured".
  // The X/Y port (e.g. COM6) is operator-selected and passed to connectStage —
  // never hardcoded. baudRate/dataBits/parity/stopBits also come from the call.
  private serialConfig: { port: string | null; baudRate: number } = {
    port: null,
    baudRate: DEFAULT_BAUD_RATE,
  };

  // Operator-taught optical center (absolute pulses), loaded once from the DB
  // singleton and mirrored into `state` for the UI. null => not yet taught.
  private centerX: number | null = null;
  private centerY: number | null = null;
  private centerLoaded = false;
  // Stable id of the singleton config row (UUID). Generated on first persist,
  // then reused so every write updates the same row instead of appending.
  private centerRowId: string | null = null;
  // Active press-and-hold jog safety watchdog. Non-null only while a jog is in
  // flight; fires Stop (#0B) if the release event is missed.
  private jogWatchdog: ReturnType<typeof setTimeout> | null = null;
  // True only while a press-and-hold jog is in flight — between moveStage's TX
  // accept and stopStage's #0B RX. The jog move is sent fire-and-forget, so there
  // is NO pending command and the controller's in-motion #11 frames arrive
  // UNSOLICITED. While this is set, such a frame updates X/Y but must NOT clear
  // `moving` or be treated as move completion: only the #0B stop reply ends a jog.
  private jogActive = false;
  // Per-axis travel bound in pulses (travelMm * pulsePerMm), refreshed whenever
  // settings load. Used ONLY to warn when an RX position exceeds the expected
  // range — never to clamp or fabricate a coordinate. Seeded from the confirmed
  // defaults so the bound is valid before the first settings read.
  private travelLimitPulses = {
    x: DEFAULT_XYZ_PLATFORM_SETTINGS.travelXmm * DEFAULT_XYZ_PLATFORM_SETTINGS.pulsePerMm,
    y: DEFAULT_XYZ_PLATFORM_SETTINGS.travelYmm * DEFAULT_XYZ_PLATFORM_SETTINGS.pulsePerMm,
  };
  // The ONE mm↔pulse factor used to convert a hardware #11 position (pulses) into
  // the displayed mm value. Cached so the synchronous RX frame handler can convert
  // without an async settings read; refreshed from the active settings whenever
  // loadActiveSettings() runs. Seeded from the confirmed default until the first load.
  private pulsePerMm = DEFAULT_XYZ_PLATFORM_SETTINGS.pulsePerMm;

  getState(): XyzStageState {
    return {
      ...this.state,
      position: { ...this.state.position },
      positionMm: { ...this.state.positionMm },
    };
  }

  isConnected(): boolean {
    return this.state.connected;
  }

  private setState(patch: Partial<XyzStageState>): void {
    this.state = {
      ...this.state,
      ...patch,
      position: patch.position ? { ...patch.position } : { ...this.state.position },
      positionMm: patch.positionMm ? { ...patch.positionMm } : { ...this.state.positionMm },
      updatedAt: new Date().toISOString(),
    };
    // eslint-disable-next-line no-console
    console.log(
      `[xyz-state-broadcast] connected=${this.state.connected} x=${this.state.positionKnown ? this.state.position.x : 'unknown'} y=${this.state.positionKnown ? this.state.position.y : 'unknown'} moving=${this.state.moving} xyLocked=${this.state.xyLocked} xySpeed=${this.state.xySpeed} centerX=${this.state.centerX ?? 'unset'} centerY=${this.state.centerY ?? 'unset'} lastError=${JSON.stringify(this.state.lastError ?? null)}`
    );
    this.emit('state', this.getState());
  }

  private nextCommandId(): string {
    this.commandSequence += 1;
    return `xyz-${this.commandSequence}`;
  }

  /**
   * Decide how XYZ commands reach the wire:
   *  - 'unknown'  → no port configured (fail safe, never open).
   *  - 'shared'   → configured port equals the live hardness-machine port.
   *  - 'separate' → configured port differs from the machine port.
   * Never opens the same COM port twice: a 'shared' port (e.g. XYZ == COM5
   * machine) is detected here and the caller refuses to open it.
   */
  private resolveSerialRoute(): { mode: XyzSerialMode; port: string | null } {
    const port = this.serialConfig.port;
    if (!port) {
      return { mode: 'unknown', port: null };
    }
    const machinePort = hardnessMachineSerialService.getState().port;
    const mode: XyzSerialMode = machinePort && machinePort === port ? 'shared' : 'separate';
    return { mode, port };
  }

  async connectStage(opts: ConnectStageOptions): Promise<XyzStageState> {
    if (this.state.connected) {
      return this.getState();
    }
    const requestedBaud = opts.baudRate;
    const resolvedBaud = requestedBaud ?? DEFAULT_BAUD_RATE;
    // Diagnostic: shows the baud the caller asked for (if any) vs the resolved
    // value. If `requested=undefined`, the DEFAULT is used — proving no external
    // baud is being injected/persisted.
    // eslint-disable-next-line no-console
    console.log(`[xyz-connect-request] port=${opts.port} baudRate=${requestedBaud ?? 'undefined'} resolved=${resolvedBaud} (default=${DEFAULT_BAUD_RATE})`);
    this.serialConfig = { port: opts.port, baudRate: resolvedBaud };
    // eslint-disable-next-line no-console
    console.log(`[xyz-service] action=connect port=${opts.port}`);

    const route = this.resolveSerialRoute();
    // eslint-disable-next-line no-console
    console.log(`[xyz-serial-config] mode=${route.mode} port=${route.port ?? 'none'}`);
    this.setState({ serialMode: route.mode });

    if (route.mode === 'shared') {
      const message = 'X/Y port cannot use machine COM port';
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] error=${JSON.stringify(message)}`);
      this.setState({ connected: false, lastError: message });
      throw new Error(message);
    }
    if (!SerialPortLib) {
      const message =
        'serialport native module not loaded' +
        (serialPortLoadError ? `: ${serialPortLoadError}` : '');
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] action=connect error=${JSON.stringify(message)}`);
      this.setState({ connected: false, lastError: message });
      throw new Error(message);
    }

    // Identify the OS device behind the chosen COM path BEFORE opening — proves
    // whether COM6 is actually the XYZ controller's adapter or some other device.
    await this.logPortInfo(opts.port);

    const dataBits = opts.dataBits ?? 8;
    const stopBits = opts.stopBits ?? 1;
    const parity = opts.parity ?? 'none';
    this.openSettings = { baudRate: this.serialConfig.baudRate, dataBits, parity, stopBits };
    // eslint-disable-next-line no-console
    console.log(
      `[xyz-open] port=${opts.port} baudRate=${this.serialConfig.baudRate} dataBits=${dataBits} parity=${parity} stopBits=${stopBits}`
    );

    const portInstance = new SerialPortLib.SerialPort({
      path: opts.port,
      baudRate: this.serialConfig.baudRate,
      dataBits,
      stopBits,
      parity,
      rtscts: false,
      xon: false,
      xoff: false,
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      const watchdog = setTimeout(() => {
        reject(new Error(`open() timed out after 5s for ${opts.port}`));
      }, 5000);
      portInstance.open((err) => {
        clearTimeout(watchdog);
        if (err) {
          // eslint-disable-next-line no-console
          console.error(`[xyz-serial-error] action=open path=${opts.port} error=${JSON.stringify(err.message)}`);
          reject(err);
          return;
        }
        resolve();
      });
    });

    // Open sequence step 1 → the port is open.
    // eslint-disable-next-line no-console
    console.log(`[xyz-connect-sequence] step=port-open port=${opts.port} hasSet=${typeof portInstance.set === 'function'}`);

    // Open sequence step 2 → assert RTS+DTR high to match Hercules' line state.
    // Many RS-232/USB adapters gate the controller's transmitter (or power the
    // converter) off these lines; if node-serialport opens them low the
    // controller never answers — TX succeeds but RX stays silent (no
    // [xyz-rx-raw]) even with correct bytes/baud. A .set failure is logged but
    // never aborts the connect. These log lines are the proof that THIS build
    // contains the line-control code: if a connect produces no
    // [xyz-line-control-request], the running backend is stale (rebuild dist).
    // eslint-disable-next-line no-console
    console.log(`[xyz-line-control-request] rts=true dtr=true port=${opts.port}`);
    if (typeof portInstance.set === 'function') {
      await new Promise<void>((resolve) => {
        portInstance.set!({ rts: true, dtr: true }, (err) => {
          // eslint-disable-next-line no-console
          if (err) {
            console.error(`[xyz-line-control] ok=false error=${JSON.stringify(err.message)}`);
          } else {
            console.log(`[xyz-line-control] ok=true rts=true dtr=true`);
          }
          resolve();
        });
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[xyz-line-control] unsupported=true note=${JSON.stringify('serialport build has no .set; cannot assert RTS/DTR — rebuild serialport for the Electron ABI')}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[xyz-connect-sequence] step=line-control-set port=${opts.port}`);

    // Frame-level RX. Replies carry a RAW CHECKSUM BYTE before '!' (short ACK
    // "#xxOK<cksum>!" = 7 bytes; position "#11:<±8>:<±8><busy><cksum>!" = 26
    // bytes), plus the checksum-free token reply ERROR. We decode as
    // LATIN1 so every byte (incl. a binary checksum >0x7F) survives 1:1, then
    // frame by fixed length / terminator ourselves. parseXyzFrame classifies.
    this.rxBuffer = '';
    portInstance.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'latin1');
      const text = buf.toString('latin1');
      // Raw RX trace — logged for EVERY byte, even with no command pending, so a
      // diagnostic can prove whether the port is receiving anything at all.
      // eslint-disable-next-line no-console
      console.log(
        `[xyz-rx-raw] commandId=${this.pendingCommandId ?? 'none'} hex=${JSON.stringify(hexSpaced(buf))} text=${JSON.stringify(text)}`
      );
      if (this.rawCapture) this.rawCapture.text += text;
      this.rxBuffer += text;
      this.drainRxFrames();
    });
    // Proof the native 'data' listener is bound. If commands still time out with
    // NO [xyz-rx-raw] after this line, the renderer/native RX wiring is fine and
    // the controller genuinely sent nothing (wrong device, line control, or wire).
    // eslint-disable-next-line no-console
    console.log(`[xyz-rx-listener-attached] port=${opts.port}`);
    // Open sequence step 3 → RX listener bound.
    // eslint-disable-next-line no-console
    console.log(`[xyz-connect-sequence] step=rx-listener-attach port=${opts.port}`);

    portInstance.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[xyz-serial-error] port error:', message);
      this.setState({ lastError: message });
    });
    portInstance.on('close', () => {
      this.port = null;
      this.rxBuffer = '';
      this.clearJogWatchdog();
      this.jogActive = false;
      this.setState({ connected: false, port: null, moving: false });
    });

    this.port = portInstance;
    this.setState({
      connected: true,
      port: opts.port,
      serialMode: 'separate',
      lastError: undefined,
      lastAction: 'XYZ stage connected.',
    });
    // eslint-disable-next-line no-console
    console.log(`[xyz-status] status=connected port=${opts.port}`);
    // Open sequence step 4 → ready for commands.
    // eslint-disable-next-line no-console
    console.log(`[xyz-connect-sequence] step=ready port=${opts.port}`);
    // Surface the taught optical center + persisted speed in state so the UI
    // reflects them (and can enable Relocation) without a first relocate/teach.
    await this.ensureCenterLoaded();
    // Restore the persisted XY speed onto the controller's registers so the mode
    // shown in the UI is the one actually in effect before any movement.
    // eslint-disable-next-line no-console
    console.log(`[xyz-speed] action=restore mode=${this.state.xySpeed}`);
    const speedApplied = await this.applyXySpeedToHardware(this.state.xySpeed);
    if (!speedApplied.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[xyz-speed] action=restore result=failed error=${JSON.stringify(speedApplied.error)}`);
    }
    // Document the GEOMETRIC travel center (fixed machine geometry, pulses =
    // centerMm * pulsePerMm). It is recorded for reference ONLY — relocation uses
    // the operator-taught optical center, NEVER this value (and never home 0,0).
    const settings = await this.loadActiveSettings();
    // eslint-disable-next-line no-console
    console.log(
      `[xyz-physical-center] xPulses=${settings.physicalCenterXpulses} yPulses=${settings.physicalCenterYpulses} xMm=${settings.physicalCenterXmm} yMm=${settings.physicalCenterYmm} pulsePerMm=${settings.pulsePerMm} note=documented-not-used-for-relocation`
    );
    return this.getState();
  }

  async disconnectStage(): Promise<XyzStageState> {
    if (this.port) {
      await new Promise<void>((resolve) => {
        this.port?.close(() => resolve());
      });
      this.port = null;
    }
    this.rxBuffer = '';
    this.clearJogWatchdog();
    this.jogActive = false;
    this.setState({ connected: false, port: null, moving: false, lastAction: 'XYZ stage disconnected.' });
    return this.getState();
  }

  /**
   * Log the OS device metadata for `path` via SerialPort.list(). Distinguishes a
   * "wrong COM port" failure (no match / unexpected adapter) from a real comms
   * problem. Never throws — a list failure is logged and connect proceeds.
   */
  private async logPortInfo(path: string): Promise<void> {
    const listFn = SerialPortLib?.SerialPort?.list;
    if (typeof listFn !== 'function') {
      // eslint-disable-next-line no-console
      console.log(`[xyz-port-info] path=${path} friendlyName=unavailable manufacturer=unavailable serialNumber=unavailable pnpId=unavailable (SerialPort.list unsupported)`);
      return;
    }
    try {
      const ports = await listFn();
      const match = Array.isArray(ports)
        ? ports.find((p) => p && typeof p.path === 'string' && p.path.toUpperCase() === path.toUpperCase())
        : undefined;
      if (!match) {
        // eslint-disable-next-line no-console
        console.log(`[xyz-port-info] path=${path} friendlyName=not-listed manufacturer=not-listed serialNumber=not-listed pnpId=not-listed (no OS match — wrong/absent COM port?)`);
        return;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[xyz-port-info] path=${path} friendlyName=${JSON.stringify(match.friendlyName ?? null)} manufacturer=${JSON.stringify(match.manufacturer ?? null)} serialNumber=${JSON.stringify(match.serialNumber ?? null)} pnpId=${JSON.stringify(match.pnpId ?? null)}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[xyz-serial-error] action=list path=${path} error=${JSON.stringify(message)}`);
    }
  }

  /**
   * RTS/DTR LINE-CONTROL DIAGNOSTIC. Hercules asserts RTS+DTR high on open; many
   * RS232/USB adapters gate the controller's transmitter (or power the converter)
   * off those lines, so if the node-serialport open left them low the controller
   * may never answer even with the CORRECT baud/protocol. This sweeps all four
   * RTS/DTR combinations, flushes the input buffer (DIAGNOSIS ONLY — never a
   * success fallback), sends ONE safe non-moving #10! per combo, and reports
   * whether ANY raw bytes came back. Never moves the stage, never fakes an ACK,
   * never updates position. Restores RTS+DTR high when done.
   */
  async testLineControl(): Promise<XyzLineControlResult> {
    const port = this.serialConfig.port;
    if (!this.port || !this.state.connected) {
      const summary = 'XYZ stage not connected — connect the X/Y port first, then run testLineControl.';
      // eslint-disable-next-line no-console
      console.error(`[xyz-line-control-summary] anyRx=false result=${JSON.stringify(summary)}`);
      return { ok: false, error: 'XYZ_STAGE_NOT_CONNECTED', port, open: this.openSettings, supported: false, anyRx: false, configs: [], summary };
    }
    if (typeof this.port.set !== 'function') {
      const summary =
        'This serialport build cannot control RTS/DTR (.set unavailable) — line control cannot be tested. Rebuild serialport for the Electron ABI.';
      // eslint-disable-next-line no-console
      console.error(`[xyz-line-control-summary] supported=false result=${JSON.stringify(summary)}`);
      return { ok: false, error: 'XYZ_LINE_CONTROL_UNSUPPORTED', port, open: this.openSettings, supported: false, anyRx: false, configs: [], summary };
    }

    // eslint-disable-next-line no-console
    console.log(`[xyz-line-control] port=${port} open=${JSON.stringify(this.openSettings)} flushInput=diagnosis-only`);

    const combos: Array<{ rts: boolean; dtr: boolean }> = [
      { rts: false, dtr: false },
      { rts: true, dtr: false },
      { rts: false, dtr: true },
      { rts: true, dtr: true },
    ];

    // Serialize through the port's single queue so a normal command can't steal a
    // reply mid-sweep.
    const queue = getSerialQueue(port as string);
    const configs = await queue.enqueue(async () => {
      const out: XyzLineControlEntry[] = [];
      for (const combo of combos) {
        out.push(await this.runLineControlProbe(combo));
      }
      return out;
    });

    // Leave the port on Hercules' default (both asserted), not the last swept combo.
    try {
      await this.setLineControl(true, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[xyz-serial-error] action=line-control-restore error=${JSON.stringify(message)}`);
    }

    const anyRx = configs.some((c) => c.rx !== null);
    const hits = configs.filter((c) => c.rx !== null).map((c) => `rts=${c.rts} dtr=${c.dtr}`);
    let summary: string;
    if (anyRx) {
      summary = `RX received under: ${hits.join(', ')}. COM6 IS the XYZ controller and the RX wire works — the failure was an RTS/DTR line-control / handshake issue. FIX: open the port asserting that RTS/DTR combo (Hercules' default is rts=true dtr=true).`;
    } else {
      summary = `NO RX under any RTS/DTR combo (true/true, false/false, true/false, false/true) at ${this.openSettings?.baudRate ?? '?'} baud sending #10!. Line control is NOT the cause. Remaining suspects: wrong COM port/device (check [xyz-port-info]) or a dead RX wire/cable (controller TXD → adapter RXD). Native RX listener is bound ([xyz-rx-listener-attached]).`;
    }
    // eslint-disable-next-line no-console
    console.log(`[xyz-line-control-summary] anyRx=${anyRx} hits=${JSON.stringify(hits)} result=${JSON.stringify(summary)}`);

    return { ok: true, port, open: this.openSettings, supported: true, anyRx, configs, summary };
  }

  /** Assert/deassert RTS and DTR on the open port. Rejects if unsupported. */
  private setLineControl(rts: boolean, dtr: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.port || typeof this.port.set !== 'function') {
        reject(new Error('serial port does not support RTS/DTR control'));
        return;
      }
      this.port.set({ rts, dtr }, (err) => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Discard the OS RX/TX buffers. DIAGNOSIS ONLY — called before a line-control
   * probe TX so a stale byte can't masquerade as a fresh reply. Never used in the
   * normal command path and never treated as a success signal. No-op if the
   * serialport build has no flush().
   */
  private flushInput(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.port || typeof this.port.flush !== 'function') {
        resolve();
        return;
      }
      this.port.flush(() => resolve());
    });
  }

  /** One RTS/DTR combo: set lines → flush input → send safe #10! → collect RX. */
  private async runLineControlProbe(combo: { rts: boolean; dtr: boolean }): Promise<XyzLineControlEntry> {
    const { rts, dtr } = combo;
    // eslint-disable-next-line no-console
    console.log(`[xyz-line-control-test] phase=set rts=${rts} dtr=${dtr}`);
    try {
      await this.setLineControl(rts, dtr);
      // eslint-disable-next-line no-console
      console.log(`[xyz-line-control-test] phase=set rts=${rts} dtr=${dtr} ok=true`);
    } catch (err) {
      const setError = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[xyz-serial-error] action=set-line-control rts=${rts} dtr=${dtr} error=${JSON.stringify(setError)}`);
      // eslint-disable-next-line no-console
      console.log(`[xyz-line-control-test] phase=set rts=${rts} dtr=${dtr} ok=false`);
      return { rts, dtr, setOk: false, setError, tx: '', txHex: '', rx: null };
    }

    // Flush BEFORE TX — diagnosis only, never a success fallback.
    await this.flushInput();
    // eslint-disable-next-line no-console
    console.log(`[xyz-line-control-test] phase=flush rts=${rts} dtr=${dtr} (diagnosis only)`);

    // Safe, non-moving #10! built by the CONFIRMED checksum builder — protocol unchanged.
    const built = buildGetPositionCommand();
    // eslint-disable-next-line no-console
    console.log(`[xyz-tx] action=line-control-test rts=${rts} dtr=${dtr} visible=${JSON.stringify(built.visible)} hex=${JSON.stringify(hexSpaced(built.frame))}`);
    const probe = await this.runProbe({ label: `line-control rts=${rts} dtr=${dtr} #10!`, bytes: built.frame });
    // RX (if any) surfaced via [xyz-rx-raw] + [xyz-rx-frame] from the data handler.
    // eslint-disable-next-line no-console
    console.log(`[xyz-line-control-test] phase=result rts=${rts} dtr=${dtr} anyRx=${probe.rx !== null} rxHex=${JSON.stringify(probe.rxHex ?? '')}`);
    return { rts, dtr, setOk: true, tx: probe.tx, txHex: probe.txHex, rx: probe.rx, rxHex: probe.rxHex };
  }

  /**
   * Hardware diagnostic. Sends a fixed set of SAFE, NON-MOVING probe frames and
   * reports exactly what (if anything) the controller replies with. Never moves
   * the stage — only #00/#01/#02 (query/lock-state) and #10 (read position) are
   * sent, never a move/home frame. Both raw (no-checksum) and checksummed
   * variants are tried so the log proves whether the checksum is the problem.
   */
  async diagnose(): Promise<XyzDiagnoseResult> {
    const port = this.serialConfig.port;
    if (!this.port || !this.state.connected) {
      const summary = 'XYZ stage not connected — connect the X/Y port first, then run diagnose.';
      // eslint-disable-next-line no-console
      console.error(`[xyz-diagnose-summary] anyRx=false result=${JSON.stringify(summary)}`);
      return {
        ok: false,
        error: 'XYZ_STAGE_NOT_CONNECTED',
        port,
        open: this.openSettings,
        anyRx: false,
        probes: [],
        summary,
      };
    }

    // eslint-disable-next-line no-console
    console.log(`[xyz-diagnose] port=${port} open=${JSON.stringify(this.openSettings)}`);

    // SAFE, NON-MOVING probes only — lock/loosen/query. NO move/home frame
    // (#0C/#0E/#11/#12) is ever sent here. Checksum #01! is the CONFIRMED XY lock
    // (-> #01OK) and #02! the CONFIRMED unlock (-> #02OK); the rest are probes to
    // identify other command codes. #LK/#LS are Z commands and are NOT probed here.
    const probes: Array<{ label: string; bytes: Buffer }> = [
      { label: 'checksum #01! (XY lock, expect #01OK)', bytes: buildXyVisibleCommandPayload('#01!', 'checksum') },
      { label: 'checksum #02! (XY unlock, expect #02OK)', bytes: buildXyVisibleCommandPayload('#02!', 'checksum') },
      { label: 'raw #02! (probe only)', bytes: Buffer.from('#02!', 'ascii') },
      { label: 'checksum #03! (probe)', bytes: buildXyVisibleCommandPayload('#03!', 'checksum') },
      { label: 'checksum #04! (probe)', bytes: buildXyVisibleCommandPayload('#04!', 'checksum') },
      { label: 'checksum #10! (get position, probe)', bytes: buildXyVisibleCommandPayload('#10!', 'checksum') },
    ];

    // Serialize the whole sequence (probes + any baud sweep) through the port's
    // single queue so a reply is never stolen by an interleaved command.
    const queue = getSerialQueue(port as string);
    const { probeResults, sweep } = await queue.enqueue(async () => {
      const out: XyzProbeResult[] = [];
      for (const probe of probes) {
        out.push(await this.runProbe(probe));
      }
      // Only sweep baud rates if NOTHING answered at the current baud — otherwise
      // we already have a working link and must not disturb it.
      const replied = out.some((r) => r.rx !== null);
      const sweepEntries = replied ? undefined : await this.runBaudSweep();
      return { probeResults: out, sweep: sweepEntries };
    });

    const anyRx = probeResults.some((r) => r.rx !== null);
    const successProbe = probeResults.find((r) => r.classification === 'ack');
    const errorProbes = probeResults.filter((r) => r.classification === 'error').map((r) => r.label);
    const sweepHit = sweep?.find((e) => e.anyRx);
    let summary: string;
    if (successProbe) {
      summary = `CONFIRMED: ${successProbe.label} -> ${JSON.stringify((successProbe.rx ?? '').trim())} (ACK). Checksum mode is correct. ERROR replies (${errorProbes.length}: ${errorProbes.join(', ') || 'none'}) are protocol errors, NOT acks. Lock is usable; movement stays BLOCKED until each move command's TX/RX is identified via window.xyzPlatform.probe().`;
    } else if (anyRx) {
      summary = `RX received but NO OK ack — replies were ERROR/unknown (errors: ${errorProbes.join(', ') || 'none'}). The link works but none of these probes is the right command. Use window.xyzPlatform.probe() to try other command strings; do not enable any action without an OK reply.`;
    } else if (sweepHit) {
      summary = `XYZ hardware did NOT answer at ${this.openSettings?.baudRate ?? '?'} baud but DID reply during the sweep at ${sweepHit.baudRate} baud (8N1). Reconnect at ${sweepHit.baudRate} baud and inspect the [xyz-probe-rx] lines.`;
    } else {
      summary = `No RX on ${port} at any baud (${'4800/9600/19200/38400/57600/115200'} 8N1). The port opens but the controller never answers. Likely cause: wrong COM port, wrong serial framing, or wrong command/checksum/protocol.`;
    }
    // eslint-disable-next-line no-console
    console.log(`[xyz-diagnose-summary] anyRx=${anyRx} success=${successProbe ? JSON.stringify(successProbe.label) : 'none'} errors=${errorProbes.length} sweptBaud=${sweepHit?.baudRate ?? 'none'} result=${JSON.stringify(summary)}`);

    return { ok: true, port, open: this.openSettings, anyRx, probes: probeResults, sweep, summary };
  }

  /**
   * EXPERT MANUAL PROBE — dev console only (`window.xyzPlatform.probe`), NEVER in
   * the UI. Sends an arbitrary command and reports TX/RX so an operator can
   * identify the real Move/Stop command bytes.
   *
   * ⚠ DANGER: there is NO safety filter here. If the caller types a real MOVING
   * command (e.g. "#0C+00000001!", "#12!") the stage WILL physically move. Use
   * only with knowledge of what each command does. No optimistic state update —
   * the live position only changes if the controller returns a real position frame.
   */
  async probe(
    commandText: string,
    options?: { checksum?: boolean; mode?: XyzProtocolMode; terminator?: 'none' | 'cr' | 'crlf'; timeoutMs?: number }
  ): Promise<XyzProbeResult> {
    // PROBE MODE: a TRUE raw-byte transmitter. The operator's bytes are sent
    // EXACTLY — no trim/normalize/sanitize. CR/LF/tabs embedded in commandText
    // are preserved verbatim.
    const text = typeof commandText === 'string' ? commandText : '';
    if (text.length === 0) {
      return { label: 'manual (empty)', tx: '', txHex: '', rx: null, error: 'XYZ_PROBE_EMPTY_COMMAND' };
    }
    if (!this.port || !this.state.connected) {
      return { label: `manual ${text}`, tx: text, txHex: '', rx: null, error: 'XYZ_STAGE_NOT_CONNECTED' };
    }
    const terminator = options?.terminator === 'cr' || options?.terminator === 'crlf' ? options.terminator : 'none';
    const windowMs =
      typeof options?.timeoutMs === 'number' && options.timeoutMs > 0 ? Math.min(options.timeoutMs, 10000) : PROBE_WINDOW_MS;

    // DEFAULT = RAW byte-exact. The checksum byte (+0x21) is added ONLY when the
    // caller EXPLICITLY opts in (checksum:true OR mode:'checksum') AND the text
    // is a clean "#..!" with no embedded CR/LF. `checksum:false` / no option =>
    // send the exact bytes via latin1 (full 8-bit, no masking) + an OPTIONAL
    // explicit terminator. Embedded CR/LF in `text` is NEVER stripped.
    const applyChecksum =
      (options?.checksum === true || options?.mode === 'checksum') && /^#[^\r\n]+!$/.test(text);

    let bytes: Buffer;
    if (applyChecksum) {
      bytes = buildXyVisibleCommandPayload(text, 'checksum');
    } else {
      let raw = text;
      if (terminator === 'cr') raw += '\r';
      else if (terminator === 'crlf') raw += '\r\n';
      bytes = Buffer.from(raw, 'latin1');
    }

    const txHex = hexSpaced(bytes);
    // eslint-disable-next-line no-console
    console.warn(
      `[xyz-manual-probe] EXPERT TOOL — may MOVE hardware. commandText=${JSON.stringify(text)} rawTextLength=${text.length} rawPrintable=${JSON.stringify(toPrintable(text))} txHex=${JSON.stringify(txHex)} checksum=${applyChecksum} preserveTerminators=true terminator=${terminator} timeoutMs=${windowMs}`
    );

    const queue = getSerialQueue(this.serialConfig.port as string);
    return queue.enqueue(() => this.runProbe({ label: `manual ${text}`, bytes }, windowMs));
  }

  /** Change baud on the open port (no close/reopen). Rejects if unsupported. */
  private updateBaud(baudRate: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.port || typeof this.port.update !== 'function') {
        reject(new Error('serial port does not support live baud update'));
        return;
      }
      this.port.update({ baudRate }, (err) => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Re-probe COM at each common baud (8N1) when the current baud got no reply.
   * Uses live baud updates on the open port and restores the original baud at
   * the end, so the connection is left exactly as it was found. Only the two
   * safest non-moving probes are sent per baud to keep the sweep quick.
   */
  private async runBaudSweep(): Promise<XyzBaudSweepEntry[]> {
    const base = this.openSettings ?? {
      baudRate: this.serialConfig.baudRate,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
    };
    const originalBaud = base.baudRate;
    const bauds = [4800, 9600, 19200, 38400, 57600, 115200];
    const sweepProbes: Array<{ label: string; bytes: Buffer }> = [
      { label: 'sweep #10! (getPosition)', bytes: buildGetPositionCommand().frame },
      { label: 'sweep raw #02!', bytes: Buffer.from('#02!', 'ascii') },
    ];

    const entries: XyzBaudSweepEntry[] = [];
    for (const baud of bauds) {
      try {
        await this.updateBaud(baud);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(`[xyz-probe-timeout] label=${JSON.stringify(`sweep ${baud} baud`)} updateError=${JSON.stringify(message)}`);
        entries.push({ baudRate: baud, anyRx: false, probes: [], error: message });
        continue;
      }
      this.openSettings = { ...base, baudRate: baud };
      // eslint-disable-next-line no-console
      console.log(`[xyz-open] port=${this.serialConfig.port} baudRate=${baud} dataBits=${base.dataBits} parity=${base.parity} stopBits=${base.stopBits} (sweep)`);

      const results: XyzProbeResult[] = [];
      for (const probe of sweepProbes) {
        results.push(await this.runProbe(probe));
      }
      entries.push({ baudRate: baud, anyRx: results.some((r) => r.rx !== null), probes: results });
    }

    // Restore the baud we found the port on.
    try {
      await this.updateBaud(originalBaud);
      this.openSettings = { ...base, baudRate: originalBaud };
      // eslint-disable-next-line no-console
      console.log(`[xyz-open] port=${this.serialConfig.port} baudRate=${originalBaud} dataBits=${base.dataBits} parity=${base.parity} stopBits=${base.stopBits} (restored)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] action=baud-restore error=${JSON.stringify(message)}`);
    }
    return entries;
  }

  /** Write one probe frame and collect any raw bytes that arrive within the window. */
  private runProbe(
    probe: { label: string; bytes: Buffer },
    windowMs: number = PROBE_WINDOW_MS
  ): Promise<XyzProbeResult> {
    // latin1 (not ascii) so the echoed tx preserves every byte 1:1, incl. >0x7F.
    const text = probe.bytes.toString('latin1');
    const txHex = hexSpaced(probe.bytes);
    // eslint-disable-next-line no-console
    console.log(`[xyz-probe-tx] label=${JSON.stringify(probe.label)} hex=${JSON.stringify(txHex)} text=${JSON.stringify(text)}`);
    this.rawCapture = { text: '' };

    return new Promise<XyzProbeResult>((resolve) => {
      const finish = (): void => {
        const captured = this.rawCapture?.text ?? '';
        this.rawCapture = null;
        if (captured.length > 0) {
          const rxHex = hexSpaced(Buffer.from(captured, 'latin1'));
          const classification = parseXyzFrame(captured).kind;
          // eslint-disable-next-line no-console
          console.log(`[xyz-probe-rx] label=${JSON.stringify(probe.label)} hex=${JSON.stringify(rxHex)} text=${JSON.stringify(captured)} classification=${classification}`);
          resolve({ label: probe.label, tx: text, txHex, rx: captured, rxHex, classification });
        } else {
          // eslint-disable-next-line no-console
          console.error(`[xyz-probe-timeout] label=${JSON.stringify(probe.label)} timeoutMs=${windowMs}`);
          resolve({ label: probe.label, tx: text, txHex, rx: null });
        }
      };

      this.port?.write(probe.bytes, (err) => {
        if (err) {
          this.rawCapture = null;
          // eslint-disable-next-line no-console
          console.error(`[xyz-probe-timeout] label=${JSON.stringify(probe.label)} writeError=${JSON.stringify(err.message)}`);
          resolve({ label: probe.label, tx: text, txHex, rx: null, error: err.message });
          return;
        }
        this.port?.drain(() => {
          setTimeout(finish, windowMs);
        });
      });
    });
  }

  /**
   * Pull every COMPLETE frame out of the RX accumulator. A frame ends at the
   * FIRST of '!' or CR/LF:
   *   - position "#11:<±8>:<±8><busy>!" and "#xxOK<cksum>!" end with '!'
   *     (verified position carries NO binary checksum, so '!'-framing is safe);
   *   - bare "#xxOK" / "OK" / "ERROR" are CR/LF-terminated.
   * A bare "#xxOK"/token with no terminator yet is taken as a complete frame.
   * A partial frame stays buffered until the rest arrives.
   */
  private drainRxFrames(): void {
    for (;;) {
      this.rxBuffer = this.rxBuffer.replace(/^[\s\r\n]+/, '');
      if (this.rxBuffer.length === 0) return;

      const bangIdx = this.rxBuffer.indexOf('!');
      const nlIdx = this.rxBuffer.search(/[\r\n]/);
      let end = -1;
      if (bangIdx >= 0 && (nlIdx < 0 || bangIdx < nlIdx)) {
        end = bangIdx + 1; // include the '!'
      } else if (nlIdx >= 0) {
        end = nlIdx; // exclude the CR/LF (stripped next pass)
      }
      if (end >= 0) {
        const frame = this.rxBuffer.slice(0, end);
        this.rxBuffer = this.rxBuffer.slice(end);
        if (frame.trim().length > 0) this.handleFrame(frame);
        continue;
      }

      // No terminator yet — if a complete bare token is buffered, take it.
      if (/^(#[0-9A-Za-z]{2}OK|OK|ERROR)$/i.test(this.rxBuffer)) {
        const frame = this.rxBuffer;
        this.rxBuffer = '';
        this.handleFrame(frame);
        continue;
      }
      return; // incomplete — wait for more bytes
    }
  }

  private handleFrame(frame: string): void {
    const commandId = this.pendingCommandId ?? 'none';
    const expected = this.pendingExpect ?? 'none';
    const hexByte = (n: number): string => '0x' + n.toString(16).padStart(2, '0').toUpperCase();
    const rxHexFull = hexSpaced(Buffer.from(frame, 'latin1'));
    // eslint-disable-next-line no-console
    console.log(`[xyz-rx] commandId=${commandId} response=${JSON.stringify(frame)} hex=${JSON.stringify(rxHexFull)}`);
    const parsed = parseXyzFrame(frame);
    // eslint-disable-next-line no-console
    console.log(`[xyz-rx] commandId=${commandId} kind=${parsed.kind} raw=${JSON.stringify(parsed.raw)} hex=${JSON.stringify(rxHexFull)}`);
    // eslint-disable-next-line no-console
    console.log(`[xyz-rx-frame] commandId=${commandId} kind=${parsed.kind} raw=${JSON.stringify(parsed.raw)} hex=${JSON.stringify(rxHexFull)}`);
    this.setState({ lastRx: parsed.raw });

    switch (parsed.kind) {
      case 'position': {
        const position: XyzPosition = { x: parsed.x, y: parsed.y, z: this.state.position.z };
        // Convert the RAW hardware pulses to MILLIMETRES with the configured factor.
        // This is the SINGLE conversion site; the frontend displays this verbatim.
        const ppm = this.pulsePerMm > 0 ? this.pulsePerMm : 1;
        const positionMm: XyzPosition = {
          x: parsed.x / ppm,
          y: parsed.y / ppm,
          z: this.state.position.z / ppm,
        };
        const action = this.pendingLabel ?? 'none';
        const moveClass = this.isMoveClassPending();
        // [xyz-move-frame] — every position frame seen while a command waits, with
        // its busy/idle status. For a move (#0C/#0E/#11) this is the frame the
        // settle-gate evaluates: idle ('+') completes, busy ('-') keeps waiting.
        // eslint-disable-next-line no-console
        console.log(
          `[xyz-move-frame] commandId=${commandId} action=${JSON.stringify(action)} expect=${expected} status=${JSON.stringify(parsed.status)} busy=${parsed.busy} x=${parsed.x} y=${parsed.y}`
        );
        // eslint-disable-next-line no-console
        console.log(`[xyz-position-parse] commandId=${commandId} x=${parsed.x} y=${parsed.y} status=${JSON.stringify(parsed.status)} busy=${parsed.busy}`);
        // Status-character diagnostic. Surfaces the RAW status byte alongside the
        // CURRENT busy decision (only '-' => busy today) so a hardware run can
        // confirm what '+' / '/' / '.' / '-' actually mean BEFORE any busy/idle
        // logic is changed. Logging only — does not alter completion behavior.
        // eslint-disable-next-line no-console
        console.log(
          `[xyz-status-char] raw=${JSON.stringify(parsed.status)} computedBusy=${parsed.busy} commandId=${commandId} action=${JSON.stringify(action)} x=${parsed.x} y=${parsed.y}`
        );
        // eslint-disable-next-line no-console
        console.log(`[xyz-position-rx] commandId=${commandId} x=${parsed.x} y=${parsed.y} busy=${parsed.busy}`);
        // eslint-disable-next-line no-console
        console.log(`[xyz-position] commandId=${commandId} x=${parsed.x} y=${parsed.y} busy=${parsed.busy} status=${JSON.stringify(parsed.status)}`);
        if (parsed.checksum !== undefined && parsed.checksumExpected !== undefined) {
          // eslint-disable-next-line no-console
          console.log(`[xyz-rx-checksum] commandId=${commandId} kind=position rx=${hexByte(parsed.checksum)} expectedSum=${hexByte(parsed.checksumExpected)} match=${parsed.checksum === parsed.checksumExpected}`);
        }
        // Position is a REAL reply (e.g. from #10!), not optimistic. busy flag is
        // truthful motion state derived from the frame. positionKnown latches true
        // so the UI can stop showing "--". ALWAYS broadcast the real RX position —
        // even when the move is still settling — so the UI tracks live motion.
        // This is the ONLY site that mutates the displayed X/Y, and it fires solely
        // from a parsed hardware position frame — never a fixed software increment.
        // eslint-disable-next-line no-console
        console.log(`[xyz-position-update] x=${parsed.x} y=${parsed.y} source=hardware`);
        // Conversion trace: raw pulses in, mm out, with the factor used. Proof that
        // the displayed mm is derived from a real RX frame, not a frontend guess.
        // eslint-disable-next-line no-console
        console.log(`[xyz-position-raw] commandId=${commandId} rawX=${parsed.x} rawY=${parsed.y}`);
        // eslint-disable-next-line no-console
        console.log(`[xyz-position-mm] commandId=${commandId} mmX=${positionMm.x} mmY=${positionMm.y} pulsePerMm=${ppm}`);
        // ACTIVE-JOG GUARD. During a press-and-hold jog the move was sent
        // fire-and-forget (no pending command), so these #11 frames are UNSOLICITED
        // in-motion telemetry. They update the live X/Y but must NOT clear `moving`
        // (a transient '+'/',' status mid-jog would otherwise broadcast moving=false
        // and stop the jog early) and must NOT resolve/complete any command. Only the
        // #0B stop reply — which runs as a PENDING command (pendingCommandId set) —
        // ends a jog, so it deliberately bypasses this guard.
        if (this.jogActive && this.pendingCommandId === null) {
          // eslint-disable-next-line no-console
          console.log(`[xyz-jog-position-update] x=${parsed.x} y=${parsed.y} moving=true commandId=none`);
          // eslint-disable-next-line no-console
          console.log(
            `[xyz-jog-ignore-unsolicited-complete] x=${parsed.x} y=${parsed.y} status=${JSON.stringify(parsed.status)} busy=${parsed.busy} reason=active-jog`
          );
          this.setState({ position, positionMm, positionKnown: true, moving: true, lastError: undefined });
          break; // do NOT complete/resolve/stop the jog on an unsolicited frame
        }
        this.setState({ position, positionMm, positionKnown: true, moving: parsed.busy, lastError: undefined });
        // Travel-range SAFETY warning only — the real RX value is kept as-is (never
        // clamped or faked). Coordinates are SIGNED (+/-): negative positions are
        // normal hardware output (confirmed by RX logs, e.g. x=-179), so the bound
        // is on MAGNITUDE (|pos| > travel), NOT a >= 0 floor. A value outside
        // ±travel is logged for the operator to notice a mis-home / runaway, not
        // silently corrected.
        const { x: limX, y: limY } = this.travelLimitPulses;
        if (Math.abs(parsed.x) > limX || Math.abs(parsed.y) > limY) {
          // eslint-disable-next-line no-console
          console.warn(
            `[xyz-travel-warning] commandId=${commandId} x=${parsed.x} y=${parsed.y} expectedX=[-${limX},${limX}] expectedY=[-${limY},${limY}] note=position-exceeds-travel-no-clamp`
          );
        }
        // SETTLE-GATE. A move-class command (#0C/#0E/#11) completes ONLY on the final
        // idle ('+') frame. While busy ('-'), keep the waiter alive (do NOT resolve,
        // do NOT clear the timeout) and schedule a #10! re-query to elicit the idle
        // frame. Every other position consumer (#10! get-position, #0B stop, or a
        // stray frame with no pending command) completes on the first valid frame —
        // unchanged. positionFrameCompletesCommand() is the single, unit-tested rule.
        const shouldComplete =
          this.pendingKey === null
            ? true
            : positionFrameCompletesCommand(this.pendingKey, parsed.busy);
        if (!shouldComplete) {
          // eslint-disable-next-line no-console
          console.log(
            `[xyz-move-settle-wait] commandId=${commandId} action=${JSON.stringify(action)} status=${JSON.stringify(parsed.status)} busy=${parsed.busy} x=${parsed.x} y=${parsed.y}`
          );
          // Only relative moves are nudged toward their idle frame with a #10!
          // re-query. Home (#12!) is settle-gated too but must NOT be polled — its
          // idle completion frame arrives unsolicited, and a mid-home #10! would
          // echo the stale pre-home position. So home just keeps the waiter alive.
          if (this.isMoveClassPending()) this.scheduleSettlePoll(commandId);
          break;
        }
        // [xyz-move-resolve] — the frame that actually completes the command. For a
        // move this is now guaranteed to be the idle frame (reason=idle-position-frame).
        // eslint-disable-next-line no-console
        console.log(
          `[xyz-move-resolve] commandId=${commandId} action=${JSON.stringify(action)} reason=${moveClass ? 'idle-position-frame' : 'position-frame'} status=${JSON.stringify(parsed.status)} busy=${parsed.busy} x=${parsed.x} y=${parsed.y}`
        );
        this.resolvePending(position);
        break;
      }
      case 'ack': {
        const wantCode = this.pendingAckCode;
        if (parsed.checksum !== undefined && parsed.checksumExpected !== undefined) {
          // eslint-disable-next-line no-console
          console.log(`[xyz-rx-checksum] commandId=${commandId} kind=ack rx=${hexByte(parsed.checksum)} expectedSum=${hexByte(parsed.checksumExpected)} match=${parsed.checksum === parsed.checksumExpected}`);
        }
        // ACK only counts when its tag matches the expected command code (e.g.
        // lock -> "LK", #05 speed -> "05"). A mismatched ACK is NOT success — it
        // is logged as unmatched and the command waits / times out (no fake
        // success). Commands without an expected code resolve on any ACK.
        if (wantCode && parsed.code.toUpperCase() !== wantCode.toUpperCase()) {
          // eslint-disable-next-line no-console
          console.warn(`[xyz-rx-unmatched] commandId=${commandId} expected=${JSON.stringify(wantCode)} rx=${JSON.stringify(parsed.raw)} code=${parsed.code}`);
          break;
        }
        // eslint-disable-next-line no-console
        console.log(`[xyz-ack-match] commandId=${commandId} expected=${JSON.stringify(wantCode ?? 'any')} rx=${JSON.stringify(parsed.raw)} code=${parsed.code}`);
        this.resolvePending(null);
        break;
      }
      case 'error': {
        // eslint-disable-next-line no-console
        console.error(
          `[xyz-protocol-error] commandId=${commandId} label=${JSON.stringify(this.pendingLabel ?? 'none')} txText=${JSON.stringify(this.pendingTxVisible ?? '')} txHex=${JSON.stringify(this.pendingTxHex ?? '')} rxText=${JSON.stringify(parsed.raw)} rxHex=${JSON.stringify(rxHexFull)}`
        );
        this.rejectPending(new Error(parsed.error));
        break;
      }
      case 'unknown':
        // ERRt! is the controller's TRANSIENT busy reply to a #10! issued while the
        // stage is still moving. ONLY in the move-settle context it means "still
        // moving — retry": log it, keep the move waiter alive, and re-query until
        // idle (or timeout). It is never success and (in this context) never a hard
        // error. Outside a pending move it stays an unmatched/unknown reply, so no
        // other command path changes behavior.
        if (this.isMoveClassPending() && isBusyResponseToken(parsed.raw)) {
          // eslint-disable-next-line no-console
          console.log(`[xyz-busy-response] commandId=${commandId} raw=${JSON.stringify(parsed.raw)}`);
          this.scheduleSettlePoll(commandId);
          break;
        }
        // No fabricated position/ack — log the unmatched reply and leave any
        // in-flight wait to time out so a command never reports success on an
        // unrecognised reply.
        // eslint-disable-next-line no-console
        console.warn(`[xyz-rx-unmatched] commandId=${commandId} expected=${expected} rx=${JSON.stringify(parsed.raw)} hex=${JSON.stringify(rxHexFull)}`);
        break;
    }
  }

  private resolvePending(position: XyzPosition | null): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.pendingReject = null;
    this.pendingCommandId = null;
    this.pendingExpect = null;
    this.pendingAckCode = null;
    this.pendingLabel = null;
    this.pendingTxVisible = null;
    this.pendingTxHex = null;
    this.pendingStartedAt = null;
    this.pendingKey = null;
    this.clearSettlePoll();
    if (resolve) resolve(position);
  }

  private rejectPending(err: Error): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    const reject = this.pendingReject;
    this.pendingResolve = null;
    this.pendingReject = null;
    this.pendingCommandId = null;
    this.pendingExpect = null;
    this.pendingAckCode = null;
    this.pendingLabel = null;
    this.pendingTxVisible = null;
    this.pendingTxHex = null;
    this.pendingStartedAt = null;
    this.pendingKey = null;
    this.clearSettlePoll();
    if (reject) reject(err);
  }

  /** True while the in-flight command is a move (#0C/#0E/#11) — i.e. settle-gated. */
  private isMoveClassPending(): boolean {
    return this.pendingKey !== null && isMoveClassCommand(this.pendingKey);
  }

  /** Cancel any scheduled move-settle re-query. */
  private clearSettlePoll(): void {
    if (this.settlePollTimer) {
      clearTimeout(this.settlePollTimer);
      this.settlePollTimer = null;
    }
  }

  /**
   * Schedule a single delayed #10! re-query to elicit the final idle ('+') frame
   * that completes a move-class command stuck on a busy ('-') reply. It does NOT
   * register a new waiter and does NOT enqueue a command — it writes #10! straight
   * to the open port so the SAME pending move waiter consumes the resulting frame.
   * The original move therefore resolves only on a real idle position (never faked).
   * Guards keep it safe: one poll in flight at a time, and the poll aborts if the
   * pending command is no longer this move (resolved/preempted) or the port closed.
   * The move's existing TX_TIMEOUT_MS remains the hard ceiling — the poll never
   * touches it, so a controller that never settles still times out honestly.
   */
  private scheduleSettlePoll(commandId: string): void {
    if (this.settlePollTimer) return; // already one in flight
    this.settlePollTimer = setTimeout(() => {
      this.settlePollTimer = null;
      if (this.pendingCommandId !== commandId || !this.isMoveClassPending()) return;
      if (!this.port || !this.state.connected) return;
      const built = buildGetPositionCommand();
      // eslint-disable-next-line no-console
      console.log(`[xyz-move-settle-poll] commandId=${commandId} tx=${JSON.stringify(built.visible)}`);
      this.port.write(built.frame, (err) => {
        if (err) {
          // eslint-disable-next-line no-console
          console.error(`[xyz-serial-error] commandId=${commandId} action=settle-poll error=${JSON.stringify(err.message)}`);
          // No reschedule — the move's own timeout is the backstop.
        }
      });
    }, SETTLE_POLL_MS);
  }

  /** Write a frame and wait for the RX position/ack (or time out). */
  private transmitNow(
    commandId: string,
    built: XyzBuiltCommand,
    label: string,
    timeoutMs: number = TX_TIMEOUT_MS
  ): Promise<XyzPosition | null> {
    if (!this.port || !this.state.connected) {
      return Promise.reject(new Error('XYZ_STAGE_NOT_CONNECTED'));
    }
    const hex = hexSpaced(built.frame);
    // eslint-disable-next-line no-console
    console.log(`[xyz-tx] commandId=${commandId} visible=${JSON.stringify(built.visible)} hex=${JSON.stringify(hex)}`);
    this.setState({ lastTx: built.visible, lastCommandId: commandId });
    // Long-running motion only (move-class #0C/#0E/#11 + home #12) — surface the
    // exact timeout this command runs under so a relocation/center/home timeout is
    // traceable to its real ceiling, not the short default. Non-motion commands
    // (lock/unlock/speed/getPosition) are intentionally not logged here.
    const isMotion = isMoveClassCommand(built.key) || built.key === 'home';
    const startedAt = Date.now();
    if (isMotion) {
      // eslint-disable-next-line no-console
      console.log(`[xyz-move-timeout-config] command=${built.visible} timeoutMs=${timeoutMs}`);
    }

    const waitForRx = new Promise<XyzPosition | null>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.pendingCommandId = commandId;
      this.pendingStartedAt = Date.now();
      this.pendingExpect = built.expect;
      this.pendingKey = built.key;
      this.pendingAckCode = built.ackCode ?? null;
      this.pendingLabel = label;
      this.pendingTxVisible = built.visible;
      this.pendingTxHex = hex;
      this.pendingTimer = setTimeout(() => {
        this.pendingResolve = null;
        this.pendingReject = null;
        this.pendingTimer = null;
        this.pendingCommandId = null;
        this.pendingExpect = null;
        this.pendingKey = null;
        this.clearSettlePoll();
        this.pendingAckCode = null;
        this.pendingLabel = null;
        this.pendingTxVisible = null;
        this.pendingTxHex = null;
        this.pendingStartedAt = null;
        // eslint-disable-next-line no-console
        console.error(`[xyz-timeout] commandId=${commandId} timeoutMs=${timeoutMs}`);
        reject(new Error('XYZ_STAGE_ACK_TIMEOUT'));
      }, timeoutMs);
    });

    return new Promise<void>((resolve, reject) => {
      this.port?.write(built.frame, (err) => {
        if (err) {
          // eslint-disable-next-line no-console
          console.error(`[xyz-serial-error] commandId=${commandId} action=write error=${JSON.stringify(err.message)}`);
          reject(err);
          return;
        }
        // The write callback fired without error — the bytes were accepted by the
        // OS serial layer. Proves a timeout is NOT a write-callback failure.
        // eslint-disable-next-line no-console
        console.log(`[xyz-write-complete] commandId=${commandId} bytesWritten=${built.frame.length}`);
        this.port?.drain((drainErr) => {
          if (drainErr) {
            // eslint-disable-next-line no-console
            console.error(`[xyz-serial-error] commandId=${commandId} action=drain error=${JSON.stringify(drainErr.message)}`);
            reject(drainErr);
            return;
          }
          resolve();
        });
      });
    })
      .then(() => waitForRx)
      .then((position) => {
        // Fires ONLY on a real RX resolution (a timeout rejects and skips this) —
        // so elapsedMs measures actual hardware completion, never a faked success.
        if (isMotion) {
          // eslint-disable-next-line no-console
          console.log(`[xyz-move-complete] command=${built.visible} commandId=${commandId} elapsedMs=${Date.now() - startedAt}`);
        }
        return position;
      });
  }

  /**
   * Build → enqueue → TX → wait RX → parse → validate → state. Returns a
   * structured result with a correlation id. "not configured" / "not connected"
   * are plain results (no throw) so the renderer renders an honest error without
   * a coordinate ever changing. Serial write success is NEVER treated as
   * hardware success — only a validated RX resolves the command. `priority`
   * (Stop) bypasses the queue and preempts a stuck in-flight wait.
   */
  private async runCommand(
    action: string,
    build: () => XyzBuiltCommand,
    lastAction: string,
    priority = false,
    timeoutMs: number = TX_TIMEOUT_MS
  ): Promise<XyzCommandResult> {
    const commandId = this.nextCommandId();
    // eslint-disable-next-line no-console
    console.log(`[xyz-service] commandId=${commandId} action=${action}`);

    const route = this.resolveSerialRoute();
    // eslint-disable-next-line no-console
    console.log(`[xyz-serial-config] mode=${route.mode} port=${route.port ?? 'none'} commandId=${commandId} action=${action}`);

    if (route.mode === 'unknown') {
      const error = 'XYZ serial port not configured';
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] commandId=${commandId} error=${JSON.stringify(error)}`);
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }
    if (route.mode === 'shared') {
      const error = 'X/Y port cannot use machine COM port';
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] commandId=${commandId} error=${JSON.stringify(error)}`);
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }
    if (!this.state.connected) {
      const error = 'XYZ_STAGE_NOT_CONNECTED';
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] commandId=${commandId} error=${JSON.stringify(error)}`);
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }

    let built: XyzBuiltCommand;
    try {
      built = build();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] commandId=${commandId} error=${JSON.stringify(error)}`);
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }

    // All TX/RX for this port is serialized through ONE queue. Stop preempts a
    // stuck waiter so it is never blocked by a hung command.
    const queue = getSerialQueue(route.port as string);
    if (priority) {
      // A priority command (only Stop/#0B) intentionally interrupts whatever is
      // in flight. Trace exactly WHAT it superseded so the preemption is never a
      // mystery. `stopStage` from a release is jog-stop; from a direction change
      // the renderer still issues a stopStage, so jog-stop covers both wire-side.
      if (this.pendingReject) {
        const ageMs = this.pendingStartedAt ? Date.now() - this.pendingStartedAt : -1;
        const reason = action === 'stopStage' ? 'jog-stop' : 'priority-command';
        // eslint-disable-next-line no-console
        console.log(
          `[xyz-preempt] oldCommand=${this.pendingLabel ?? 'unknown'} newCommand=${action} oldCommandAgeMs=${ageMs} reason=${reason} source=runCommand-priority`
        );
      }
      this.rejectPending(new Error('XYZ_STAGE_PREEMPTED'));
    }

    try {
      const position = await queue.enqueue(() => this.transmitNow(commandId, built, action, timeoutMs), { priority });
      this.setState({ lastAction, lastError: undefined });
      const status = position ? 'move-confirmed' : 'ack-confirmed';
      // eslint-disable-next-line no-console
      console.log(`[xyz-status] commandId=${commandId} status=${status}`);
      return position
        ? { ok: true, position, rx: this.state.lastRx, commandId }
        : { ok: true, rx: this.state.lastRx, commandId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const message = friendlyXyzMessage(error);
      if (error === 'XYZ_STAGE_PREEMPTED') {
        // EXPECTED jog control flow: a Stop (#0B) intentionally superseded this
        // in-flight command. NOT a hardware failure — flag it `preempted` and do
        // NOT write lastError, so no red snackbar ever shows for a normal stop.
        // (The interruption is already traced via [xyz-preempt] above.)
        // eslint-disable-next-line no-console
        console.log(`[xyz-move-preempted] commandId=${commandId} action=${action} userFacing=false`);
        return { ok: false, error, preempted: true, commandId };
      }
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] commandId=${commandId} error=${JSON.stringify(error)}`);
      // eslint-disable-next-line no-console
      console.error(`[xyz-status] commandId=${commandId} status=failed`);
      this.setState({ lastError: message });
      return { ok: false, error, message, commandId };
    }
  }

  /**
   * Apply a SOFTWARE-only state change (focus mode). Not a serial command —
   * there is no controller to acknowledge it — so it resolves immediately and
   * honestly. No bytes touch the wire, nothing is faked as a hardware reply.
   */
  private softwareCommand(patch: Partial<XyzStageState>, lastAction: string, label: string): XyzCommandResult {
    const commandId = this.nextCommandId();
    // eslint-disable-next-line no-console
    console.log(`[xyz-service] commandId=${commandId} action=${label} (software state)`);
    this.setState({ ...patch, lastAction, lastError: undefined });
    // eslint-disable-next-line no-console
    console.log(`[xyz-status] commandId=${commandId} status=confirmed`);
    return { ok: true, commandId };
  }

  // --- Public command surface (mirrors window.xyzPlatform.*) -----------------

  /** A moving command that is not yet TX/RX-confirmed — sends NOTHING, fails honestly. */
  private moveNotConfirmed(action: string): Promise<XyzCommandResult> {
    const commandId = this.nextCommandId();
    // eslint-disable-next-line no-console
    console.warn(`[xyz-todo] commandId=${commandId} action=${action} note=${JSON.stringify(MOVE_NOT_CONFIRMED)} (movement TX/RX not yet identified — no bytes sent)`);
    this.setState({ lastError: MOVE_NOT_CONFIRMED });
    return Promise.resolve({ ok: false, error: MOVE_NOT_CONFIRMED, commandId });
  }

  /**
   * Start a press-and-hold JOG in `direction`. The active XY speed (already
   * pushed to the controller's #05–#0A registers) governs how fast it moves; the
   * jog itself is one large bounded relative move sent FIRE-AND-FORGET (its
   * completion reply would only arrive on stop/limit, so we don't block on it).
   * `moving` is set true ONLY after the TX is accepted. The matching stopStage()
   * (release) halts it and reads the real position. One jog at a time — a press
   * while already moving is ignored (no second move is ever queued).
   */
  async moveStage(direction: XyzDirection): Promise<XyzCommandResult> {
    // eslint-disable-next-line no-console
    console.log(`[xyz-move-request] direction=${direction} speed=${this.state.xySpeed}`);
    if (!MOVE_COMMANDS_CONFIRMED) {
      return this.moveNotConfirmed(`moveStage(${direction})`);
    }
    // X/Y must be LOCKED (servo engaged) to move: lock enables movement, unlock
    // blocks it. Mirrors the UI gating (locked ⇒ arrows enabled).
    if (!this.state.xyLocked) {
      // eslint-disable-next-line no-console
      console.warn(`[xyz-move-blocked] reason=xy-unlocked direction=${direction}`);
      return Promise.resolve({ ok: false, error: 'XYZ_STAGE_XY_UNLOCKED', commandId: this.nextCommandId() });
    }
    // One active jog at a time — suppress a repeated press while already moving.
    if (this.state.moving) {
      // eslint-disable-next-line no-console
      console.log(`[xyz-move-start] direction=${direction} skipped=already-moving`);
      return { ok: true, commandId: this.state.lastCommandId ?? this.nextCommandId() };
    }
    // Axis inversion comes from the operator's XY Platform Settings (Y is reversed
    // on this hardware by default) so the UI arrow matches physical motion. It
    // flips only the commanded pulse SIGN — never the protocol bytes — and is NOT
    // applied to relocation/position (those work in native controller pulses).
    const settings = await this.loadActiveSettings();
    const invert = { reverseX: settings.reverseXAxis, reverseY: settings.reverseYAxis };
    // eslint-disable-next-line no-console
    console.log(`[xyz-jog-dispatch] direction=${direction} pulses=${JOG_PULSES} reverseX=${invert.reverseX} reverseY=${invert.reverseY} speed=${this.state.xySpeed}`);
    const built = buildJogMoveCommand(direction, JOG_PULSES, invert);
    const sent = await this.sendFireAndForget('moveStage', () => built, `Jog ${direction}.`);
    if (!sent.ok) {
      // eslint-disable-next-line no-console
      console.error(`[xyz-jog-error] phase=start direction=${direction} error=${JSON.stringify(sent.error)}`);
      return sent;
    }
    // Movement state is set ONLY after the TX was accepted by the OS serial layer
    // (not a guessed coordinate). Real X/Y still updates only from an RX frame.
    // eslint-disable-next-line no-console
    console.log(`[xyz-jog-start] direction=${direction} speed=${this.state.xySpeed} pulses=${JOG_PULSES} commandId=${sent.commandId}`);
    // Mark the jog active BEFORE broadcasting moving=true so any immediately
    // following unsolicited #11 frame is caught by the active-jog guard.
    this.jogActive = true;
    this.setState({ moving: true });
    this.armJogWatchdog();
    return sent;
  }

  /**
   * QUICK-TAP step move. A single arrow tap moves exactly the configured per-tier
   * distance (stepDistanceMm), converted to pulses with the active pulsePerMm and
   * sent as ONE finite relative move. Unlike the press-and-hold jog this is NOT
   * fire-and-forget: it runs as a normal pending command so it is settle-gated to
   * the idle #11 frame, and the displayed mm comes only from that real RX position
   * (no #0B, no optimistic update, no frontend simulation).
   */
  async moveStep(direction: XyzDirection): Promise<XyzCommandResult> {
    // eslint-disable-next-line no-console
    console.log(`[xyz-step-request] direction=${direction} speed=${this.state.xySpeed}`);
    if (!MOVE_COMMANDS_CONFIRMED) {
      return this.moveNotConfirmed(`moveStep(${direction})`);
    }
    if (!this.state.xyLocked) {
      // eslint-disable-next-line no-console
      console.warn(`[xyz-step-blocked] reason=xy-unlocked direction=${direction}`);
      return { ok: false, error: 'XYZ_STAGE_XY_UNLOCKED', commandId: this.nextCommandId() };
    }
    // One move at a time — ignore a tap while a jog/step is already running.
    if (this.state.moving || this.jogActive) {
      // eslint-disable-next-line no-console
      console.log(`[xyz-step-skip] direction=${direction} reason=already-moving`);
      return { ok: true, commandId: this.state.lastCommandId ?? this.nextCommandId() };
    }
    const settings = await this.loadActiveSettings();
    const invert = { reverseX: settings.reverseXAxis, reverseY: settings.reverseYAxis };
    const profile = settings.speedProfiles[this.state.xySpeed];
    // Normalized settings always carry stepDistanceMm; the ?? is a defensive floor.
    const stepMm = profile.stepDistanceMm ?? DEFAULT_XYZ_PLATFORM_SETTINGS.speedProfiles[this.state.xySpeed].stepDistanceMm ?? 0;
    const pulses = Math.max(1, Math.round(stepMm * settings.pulsePerMm));
    // eslint-disable-next-line no-console
    console.log(
      `[xyz-step-dispatch] direction=${direction} speed=${this.state.xySpeed} stepMm=${stepMm} pulsePerMm=${settings.pulsePerMm} pulses=${pulses} reverseX=${invert.reverseX} reverseY=${invert.reverseY}`
    );
    const built = buildJogMoveCommand(direction, pulses, invert);
    // RX-gated finite move: runCommand waits for the idle position frame, and the
    // [xyz-position-raw]/[xyz-position-mm] logs fire from that real #11 reply.
    const result = await this.runCommand('moveStep', () => built, `Step ${direction} ${stepMm}mm.`);
    if (result.ok && result.position) {
      // eslint-disable-next-line no-console
      console.log(`[xyz-step-complete] direction=${direction} x=${result.position.x} y=${result.position.y} source=hardware-rx`);
    }
    return result;
  }

  /** Stop X/Y (release/cancel). #0B preempts any in-flight wait and replies with
   * the real position, which is the ONLY thing that updates X/Y. */
  async stopStage(): Promise<XyzCommandResult> {
    this.clearJogWatchdog();
    // eslint-disable-next-line no-console
    console.log('[xyz-jog-stop-request]');
    // eslint-disable-next-line no-console
    console.log('[xyz-jog-stop]');
    // eslint-disable-next-line no-console
    console.log('[xyz-move-stop]');
    // eslint-disable-next-line no-console
    console.log('[xyz-stop-request]');
    // Keep jogActive set THROUGH the #0B TX/RX so a last unsolicited #11 frame is
    // still guarded; the #0B reply itself runs as a pending command (so it bypasses
    // the guard and completes normally). Only after #0B RX do we end the jog.
    let result = await this.runCommand('stopStage', () => buildStopXyCommand(), 'Stop X/Y.', true);
    this.jogActive = false;
    this.setState({ moving: false });
    // eslint-disable-next-line no-console
    console.log(
      `[xyz-jog-stop-confirmed] x=${this.state.positionKnown ? this.state.position.x : 'unknown'} y=${this.state.positionKnown ? this.state.position.y : 'unknown'} moving=false`
    );
    // #0B normally replies with the real landing position (used as today). If this
    // controller ever ACKs the stop WITHOUT a position frame, query #10! once for
    // the true final position instead of completing with an unknown coordinate.
    // No fabrication — if the requery also fails, the honest stop result stands.
    if (result.ok && !result.position) {
      // eslint-disable-next-line no-console
      console.log(`[xyz-stop-no-position-requery] commandId=${result.commandId} note=stop-acked-without-position-querying-#10!`);
      const queried = await this.getPosition();
      if (queried.ok && queried.position) {
        result = { ...result, position: queried.position, rx: queried.rx };
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[xyz-stop-no-position-requery] result=failed reason=${JSON.stringify(queried.ok ? 'no-position-frame' : queried.error)}`);
      }
    }
    if (result.ok && result.position) {
      // The #0B stop reply carries the REAL landing position — the move is now
      // complete against confirmed hardware coordinates.
      // eslint-disable-next-line no-console
      console.log(`[xyz-jog-stop-position] x=${result.position.x} y=${result.position.y} source=hardware-rx`);
      // eslint-disable-next-line no-console
      console.log(`[xyz-move-complete] x=${result.position.x} y=${result.position.y}`);
    } else if (!result.ok && !result.preempted) {
      // eslint-disable-next-line no-console
      console.error(`[xyz-jog-error] phase=stop error=${JSON.stringify(result.error)}`);
    }
    return result;
  }

  private armJogWatchdog(): void {
    this.clearJogWatchdog();
    this.jogWatchdog = setTimeout(() => {
      this.jogWatchdog = null;
      // eslint-disable-next-line no-console
      console.warn(`[xyz-move-stop] reason=watchdog timeoutMs=${JOG_WATCHDOG_MS}`);
      void this.stopStage();
    }, JOG_WATCHDOG_MS);
  }

  private clearJogWatchdog(): void {
    if (this.jogWatchdog) {
      clearTimeout(this.jogWatchdog);
      this.jogWatchdog = null;
    }
  }

  async lockXy(): Promise<XyzCommandResult> {
    // eslint-disable-next-line no-console
    console.log('[xyz-lock-request]');
    const result = await this.runCommand('lockXy', () => buildLockXyCommand(), 'X/Y platform locked.');
    if (result.ok) this.setState({ xyLocked: true });
    return result;
  }

  async unlockXy(): Promise<XyzCommandResult> {
    // eslint-disable-next-line no-console
    console.log('[xyz-unlock-request]');
    const result = await this.runCommand('unlockXy', () => buildUnlockXyCommand(), 'X/Y platform unlocked.');
    if (result.ok) this.setState({ xyLocked: false });
    return result;
  }

  /**
   * Set the active XY speed mode. The mode is VALIDATED against the fixed tiers —
   * an unrecognised value is rejected and the previous speed is kept (no free
   * speed value ever reaches the wire). On success the tier's REGISTER VALUE
   * (controller units, from XY Platform Settings — NOT a calibrated mm/s) is
   * written to the speed registers, mirrored into state, and persisted so the
   * mode restores on the next startup.
   */
  async setXySpeed(speed: XySpeed): Promise<XyzCommandResult> {
    // eslint-disable-next-line no-console
    console.log(`[xyz-speed-request] mode=${speed}`);
    // Normalize any reverted six-tier value back to a canonical tier (medium→mid,
    // veryFast/superFast/ultraFast→ultra) and reject any unrecognised mode — no
    // free speed value ever reaches the wire.
    const mode = normalizeXySpeed(speed);
    if (!mode) {
      const error = 'XYZ_STAGE_INVALID_SPEED';
      // eslint-disable-next-line no-console
      console.warn(`[xyz-speed] rejected=${JSON.stringify(speed)} kept=${this.state.xySpeed} reason=invalid-mode`);
      this.setState({ lastError: error });
      return { ok: false, error, commandId: this.nextCommandId() };
    }
    // eslint-disable-next-line no-console
    console.log(`[xyz-speed] mode=${mode}`);
    const result = await this.applyXySpeedToHardware(mode);
    if (!result.ok) return result;
    this.setState({ xySpeed: mode });
    this.persistConfig();
    // Speed is confirmed only after the registers were accepted by the hardware.
    // eslint-disable-next-line no-console
    console.log(`[xyz-speed-confirmed] mode=${speed}`);
    return result;
  }

  /** Write the tier's begin/accel/final REGISTER VALUES (controller units, from
   * settings) to the #05–#0A registers — begin/accel/final applied to both X and
   * Y. No state change or persistence here — callers own that. */
  private async applyXySpeedToHardware(speed: XySpeed): Promise<XyzCommandResult> {
    const settings = await this.loadActiveSettings();
    const profile = settings.speedProfiles[speed];
    const { beginRegisterValue, accelerationRegisterValue, finalRegisterValue } = profile;
    // eslint-disable-next-line no-console
    console.log(
      `[xyz-speed] mode=${speed} begin=${beginRegisterValue} accel=${accelerationRegisterValue} final=${finalRegisterValue} approxMmS=${profile.approxMmS} note=controller-units-uncalibrated`
    );
    const steps: Array<() => XyzBuiltCommand> = [
      () => buildSetXBeginSpeedCommand(beginRegisterValue),
      () => buildSetXAccelerationCommand(accelerationRegisterValue),
      () => buildSetXFinalSpeedCommand(finalRegisterValue),
      () => buildSetYBeginSpeedCommand(beginRegisterValue),
      () => buildSetYAccelerationCommand(accelerationRegisterValue),
      () => buildSetYFinalSpeedCommand(finalRegisterValue),
    ];
    let last: XyzCommandResult | null = null;
    for (const build of steps) {
      const result = await this.runCommand('setXySpeed', build, `Set X/Y speed ${speed}.`);
      if (!result.ok) return result;
      last = result;
    }
    return last ?? { ok: true, commandId: this.nextCommandId() };
  }

  /**
   * Read the operator's XY Platform Settings singleton (backend-owned config).
   * Returns the documented defaults when none has been saved — that default IS
   * the active configuration, not a fabricated hardware value. The only settings
   * consumed for movement today are the per-tier begin/accel/final speed register
   * values; the rest (reverse axes, empty trip, runningByNewThread, pulses/mm) are
   * stored config — no serial bytes are invented for unmapped controller features.
   */
  async loadActiveSettings(): Promise<XYZPlatformSettingsPayload> {
    let settings: XYZPlatformSettingsPayload = DEFAULT_XYZ_PLATFORM_SETTINGS;
    try {
      const rows = (await readCollection('xyzPlatformSettings')) as XYZPlatformSettings[];
      // Normalize the persisted row to the current shape — a row saved by an older
      // build may still use the legacy speedProfiles fields. The operator's saved
      // values are kept; only the shape is reconciled (see normalizeXyzSettings).
      if (rows[0]) settings = normalizeXyzSettings(rows[0]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[xyz-settings] action=load error=${JSON.stringify(message)}`);
    }
    // Refresh the travel-safety bound (pulses) from the active settings so the
    // RX position warning uses the operator's configured travel, not a stale one.
    this.travelLimitPulses = {
      x: settings.travelXmm * settings.pulsePerMm,
      y: settings.travelYmm * settings.pulsePerMm,
    };
    // Keep the display conversion factor in sync with the operator's configuration.
    this.pulsePerMm = settings.pulsePerMm;
    return settings;
  }

  // Focus mode — software state only (no focus command exists in the protocol).
  setFocusMode(focusMode: FocusMode): Promise<XyzCommandResult> {
    return Promise.resolve(
      this.softwareCommand({ focusMode }, `Focus mode ${focusMode}.`, `focus-${focusMode}`)
    );
  }

  getPosition(): Promise<XyzCommandResult> {
    return this.runCommand('getPosition', () => buildGetPositionCommand(), 'Query position.');
  }

  // Both buttons move to the FIXED geometric/physical center from settings
  // (physicalCenterXpulses/Ypulses — default 40000,40000 = 25mm,25mm at 1600
  // pulses/mm), NOT the operator-taught optical center and NOT hardware home (0,0).
  // ⊕ Center (moveToCenter) goes there from the CURRENT position; Relocation
  // (locateCenter) ALWAYS homes (#12!) first, then moves to the physical center —
  // the original AIO_Client Home → Center workflow.
  moveToCenter(): Promise<XyzCommandResult> {
    return this.goToPhysicalCenter('moveToCenter', false, 'xyz-center');
  }

  locateCenter(): Promise<XyzCommandResult> {
    return this.goToPhysicalCenter('locateCenter', true, 'xyz-relocation');
  }

  /**
   * Move the stage to the FIXED geometric/physical center taken from settings
   * (physicalCenterXpulses/Ypulses). Moves are RELATIVE (#11/#0C/#0E by a pulse
   * delta) while #10! reports ABSOLUTE position, so we establish the start position
   * (post-home for Relocation, current for ⊕ Center), move by (center − current),
   * then re-read to confirm. State only ever changes from a real position reply — no
   * faked success, no optimistic update, no fabricated coordinate. The target is
   * read from settings, never a duplicated literal. `logPrefix` routes the trace to
   * the per-button log family (xyz-center / xyz-relocation).
   */
  private async goToPhysicalCenter(
    action: string,
    homeFirst: boolean,
    logPrefix: 'xyz-center' | 'xyz-relocation'
  ): Promise<XyzCommandResult> {
    const commandId = this.nextCommandId();
    // eslint-disable-next-line no-console
    console.log(`[${logPrefix}-start] commandId=${commandId} action=${action} homeFirst=${homeFirst}`);

    if (!this.state.connected) {
      // eslint-disable-next-line no-console
      console.warn(`[${logPrefix}-error] commandId=${commandId} reason="XYZ_STAGE_NOT_CONNECTED"`);
      this.setState({ lastError: 'XYZ_STAGE_NOT_CONNECTED' });
      return { ok: false, error: 'XYZ_STAGE_NOT_CONNECTED', commandId };
    }
    // Movement needs the servo engaged (mirrors moveStage gating).
    if (!this.state.xyLocked) {
      // eslint-disable-next-line no-console
      console.warn(`[${logPrefix}-error] commandId=${commandId} reason="XYZ_STAGE_XY_UNLOCKED"`);
      this.setState({ lastError: 'XYZ_STAGE_XY_UNLOCKED' });
      return { ok: false, error: 'XYZ_STAGE_XY_UNLOCKED', commandId };
    }

    // TARGET = fixed geometric/physical center, read from settings (defaults
    // 40000,40000). loadActiveSettings() also refreshes the pulsePerMm / travel
    // bound used for the display + RX safety warning. No duplicated literal here.
    const settings = await this.loadActiveSettings();
    const targetX = settings.physicalCenterXpulses;
    const targetY = settings.physicalCenterYpulses;
    // eslint-disable-next-line no-console
    console.log(`[${logPrefix}-target] commandId=${commandId} targetX=${targetX} targetY=${targetY}`);

    // Establish the START position. Relocation homes (#12!) first and uses the REAL
    // home-complete frame as the start point — we do NOT issue a fresh #10! (which
    // can echo a stale pre-home position on this controller). ⊕ Center skips homing
    // and reads the current position (#10!). We never compute the delta while the
    // stage is still homing.
    let before: XyzCommandResult;
    if (homeFirst) {
      // eslint-disable-next-line no-console
      console.log(`[${logPrefix}-home-step] commandId=${commandId}`);
      const homed = await this.home();
      if (!homed.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[${logPrefix}-error] commandId=${commandId} reason=${JSON.stringify(homed.error)} phase=home-before`);
        return homed;
      }
      // eslint-disable-next-line no-console
      console.log(`[${logPrefix}-after-home-position] commandId=${commandId} x=${homed.position?.x ?? 'unknown'} y=${homed.position?.y ?? 'unknown'}`);
      before = homed;
    } else {
      // eslint-disable-next-line no-console
      console.log(`[xyz-position-query] commandId=${commandId} phase=before`);
      before = await this.getPosition();
    }
    if (!before.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[${logPrefix}-error] commandId=${commandId} reason=${JSON.stringify(before.error)}`);
      return before;
    }
    if (!before.position) {
      // eslint-disable-next-line no-console
      console.warn(`[${logPrefix}-error] commandId=${commandId} reason="XYZ_STAGE_NO_POSITION"`);
      this.setState({ lastError: 'XYZ_STAGE_NO_POSITION' });
      return { ok: false, error: 'XYZ_STAGE_NO_POSITION', commandId };
    }

    // Captured before the next serial round-trip so the post-move RX diff can compare
    // the landing position against this exact start point.
    const beforePos = before.position;

    // Relative delta to the absolute PHYSICAL center (settings target — NOT hardware
    // home 0,0 and NOT an operator optical center).
    const dx = targetX - beforePos.x;
    const dy = targetY - beforePos.y;
    // eslint-disable-next-line no-console
    console.log(
      `[${logPrefix}-delta] commandId=${commandId} targetX=${targetX} targetY=${targetY} currentX=${beforePos.x} currentY=${beforePos.y} dx=${dx} dy=${dy}`
    );

    if (dx === 0 && dy === 0) {
      // eslint-disable-next-line no-console
      console.log(`[${logPrefix}-arrived] commandId=${commandId} x=${beforePos.x} y=${beforePos.y} note=already-centered`);
      this.setState({ lastAction: 'At physical center.', lastError: undefined });
      return before;
    }

    // Move by the delta with the narrowest command for the axes that change
    // (#11 both, #0C X-only, #0E Y-only) — RX-gated to a real idle reply. The
    // dx===0 && dy===0 case already returned above, so a command is always built.
    const moved = await this.runCommand(
      action,
      () => {
        const cmd = buildRelocationMoveCommand(dx, dy);
        if (!cmd) throw new Error('XYZ_RELOCATION_NO_DELTA');
        // eslint-disable-next-line no-console
        console.log(`[${logPrefix}-command] commandId=${commandId} key=${cmd.key} visible=${JSON.stringify(cmd.visible)} dx=${dx} dy=${dy}`);
        return cmd;
      },
      `Move to physical center (dx ${dx}, dy ${dy}).`,
      false,
      MOVE_TIMEOUT_MS
    );
    if (!moved.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[${logPrefix}-error] commandId=${commandId} reason=${JSON.stringify(moved.error)}`);
      return moved;
    }

    // Confirm the landing position (#10!); state already updated from the move RX.
    // eslint-disable-next-line no-console
    console.log(`[xyz-position-query] commandId=${commandId} phase=after`);
    const after = await this.getPosition();

    // DIAGNOSTIC: diff the landing position the controller actually reported against
    // the requested delta. `landing` is the after-query position when available, else
    // the move command's own RX position (the move is RX-gated, so `moved.position`
    // is a real reply, never fabricated). No coordinate is changed here.
    const landing = after.ok && after.position ? after.position : moved.position;
    if (landing) {
      // eslint-disable-next-line no-console
      console.log(
        `[${logPrefix}-rx] commandId=${commandId} beforeX=${beforePos.x} beforeY=${beforePos.y} afterX=${landing.x} afterY=${landing.y} actualDx=${landing.x - beforePos.x} actualDy=${landing.y - beforePos.y} expectedDx=${dx} expectedDy=${dy}`
      );
    }

    if (!after.ok || !after.position) {
      // The move itself succeeded with a real reply; report it rather than fail.
      // eslint-disable-next-line no-console
      console.log(`[${logPrefix}-arrived] commandId=${commandId} note=confirm-query-unavailable`);
      this.setState({ lastAction: 'Moved to physical center.', lastError: undefined });
      return moved;
    }
    // eslint-disable-next-line no-console
    console.log(`[${logPrefix}-arrived] commandId=${commandId} x=${after.position.x} y=${after.position.y}`);
    this.setState({ lastAction: 'Moved to physical center.', lastError: undefined });
    return after;
  }

  /**
   * Teach the optical center from the LAST RX-CONFIRMED position the backend
   * already holds (`this.state.position`, the value shown in the UI) — NOT a
   * fresh #10! query. The controller does not answer #10! with a position frame
   * on this hardware; position is only ever known from a real move/jog reply, so
   * querying here bails and the center never saves. We capture the confirmed
   * state instead — gated on `positionKnown` so we never teach a fabricated 0,0.
   * The operator jogs the stage onto the reference (each move updates the
   * confirmed position), then clicks Set Center to store that exact position.
   */
  async setCenter(): Promise<XyzCommandResult> {
    const commandId = this.nextCommandId();
    // eslint-disable-next-line no-console
    console.log(`[xyz-set-center] commandId=${commandId} phase=request`);
    await this.ensureCenterLoaded();
    if (!this.state.positionKnown) {
      // No confirmed RX position yet — refuse to teach a center from a fabricated
      // 0,0. Tell the operator how to get a confirmed position first.
      // eslint-disable-next-line no-console
      console.warn(`[xyz-set-center] commandId=${commandId} bail=position-unknown source=state`);
      const message = 'Jog or query position first, then set center.';
      this.setState({ lastError: message });
      return { ok: false, error: 'XYZ_STAGE_NO_POSITION', message, commandId };
    }
    const currentX = this.state.position.x;
    const currentY = this.state.position.y;
    // eslint-disable-next-line no-console
    console.log(`[xyz-set-center] commandId=${commandId} currentX=${currentX} currentY=${currentY} source=state`);
    this.centerX = currentX;
    this.centerY = currentY;
    // Mirror into state BEFORE persist so persistConfig writes the new center.
    this.setState({
      centerX: this.centerX,
      centerY: this.centerY,
      lastAction: `Optical center set to (${this.centerX}, ${this.centerY}).`,
      lastError: undefined,
    });
    this.persistConfig();
    // eslint-disable-next-line no-console
    console.log(`[xyz-center-saved] commandId=${commandId} centerX=${this.centerX} centerY=${this.centerY} source=state`);
    return { ok: true, position: { x: currentX, y: currentY, z: this.state.position.z }, commandId };
  }

  /**
   * Dedicated HARDWARE HOME (#12!) — the controller's zero/origin, kept strictly
   * separate from Relocation. #12! runs the homing cycle and emits a SINGLE position
   * frame only when homing FINISHES (up to HOME_TIMEOUT_MS later). We send it as a
   * WAITED command and complete on that real idle frame — never fire-and-forget,
   * never a fixed delay, and never a mid-home #10! poll (which returns a misleading
   * idle frame at the pre-home position). The completion frame may arrive with no
   * preceding #10!; it is consumed as the real home result. No coordinate is faked
   * and home is never assumed to be 0,0.
   */
  async home(): Promise<XyzCommandResult> {
    const commandId = this.nextCommandId();
    // eslint-disable-next-line no-console
    console.log(`[xyz-home-request] commandId=${commandId}`);
    if (!MOVE_COMMANDS_CONFIRMED) {
      return this.moveNotConfirmed('home');
    }
    // eslint-disable-next-line no-console
    console.log(`[xyz-home-start] commandId=${commandId} visible="#12!"`);
    // eslint-disable-next-line no-console
    console.log(`[xyz-home-wait-start] commandId=${commandId} timeoutMs=${HOME_TIMEOUT_MS}`);
    const homed = await this.runCommand(
      'home',
      () => {
        // eslint-disable-next-line no-console
        console.log(`[xyz-home-tx] commandId=${commandId} visible="#12!"`);
        return buildHomeCommand();
      },
      'Hardware home (#12!).',
      false,
      HOME_TIMEOUT_MS
    );
    if (!homed.ok) {
      // A home that never emits its completion frame within HOME_TIMEOUT_MS surfaces
      // as a generic ACK timeout — remap it to the home-specific code/message so the
      // operator sees "Homing did not complete" rather than the catch-all failure.
      if (homed.error === 'XYZ_STAGE_ACK_TIMEOUT') {
        const message = friendlyXyzMessage('XYZ_STAGE_HOME_TIMEOUT');
        this.setState({ lastError: message });
        return { ok: false, error: 'XYZ_STAGE_HOME_TIMEOUT', message, commandId };
      }
      return homed;
    }
    // eslint-disable-next-line no-console
    console.log(`[xyz-home-complete-frame] commandId=${commandId} x=${homed.position?.x ?? 'unknown'} y=${homed.position?.y ?? 'unknown'}`);
    return homed;
  }

  /**
   * Load the taught optical center from the DB singleton ONCE, mirroring it into
   * `state` for the UI. A read/parse failure is non-fatal — the center stays
   * null and Relocation reports "not configured" rather than crashing.
   */
  private async ensureCenterLoaded(): Promise<void> {
    if (this.centerLoaded) return;
    try {
      const rows = (await readCollection('xyzCenterCalibration')) as XYZCenterCalibration[];
      const row = rows[0];
      if (row) {
        this.centerRowId = row.id;
        this.centerX = row.centerX;
        this.centerY = row.centerY;
        const patch: Partial<XyzStageState> = { centerX: row.centerX, centerY: row.centerY };
        // Restore the persisted speed mode into state, normalizing any legacy
        // alias (mid/ultra) so the canonical tier is what gets applied. The
        // hardware registers are (re)applied by connectStage — load itself stays
        // a pure state read.
        if (row.xySpeed) {
          const mode = normalizeXySpeed(row.xySpeed);
          if (mode) patch.xySpeed = mode;
        }
        // eslint-disable-next-line no-console
        console.log(`[xyz-center-load] rowId=${row.id} centerX=${row.centerX} centerY=${row.centerY} xySpeed=${row.xySpeed ?? 'unset'} source=db`);
        this.setState(patch);
      } else {
        // eslint-disable-next-line no-console
        console.log('[xyz-center-load] result=not-configured source=db');
      }
      // Mark loaded only after a successful read so a transient DB error retries
      // on the next call instead of permanently reporting "not configured".
      this.centerLoaded = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[xyz-center-offset] action=load error=${JSON.stringify(message)}`);
    }
  }

  /**
   * Persist the backend-owned XYZ config singleton (optical center + active XY
   * speed) by stable id. Center may be null (speed taught first) and vice versa.
   */
  private persistConfig(): void {
    const now = new Date().toISOString();
    const id = this.centerRowId ?? randomUUID();
    this.centerRowId = id;
    const row: XYZCenterCalibration = {
      id,
      centerX: this.centerX,
      centerY: this.centerY,
      xySpeed: this.state.xySpeed,
      createdAt: now,
      updatedAt: now,
    };
    try {
      upsertRows('xyzCenterCalibration', [row]);
      // eslint-disable-next-line no-console
      console.log(`[xyz-center-offset] action=persist centerX=${this.centerX} centerY=${this.centerY} xySpeed=${this.state.xySpeed}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[xyz-center-offset] action=persist error=${JSON.stringify(message)}`);
    }
  }

  /**
   * Write a frame WITHOUT waiting for an RX reply — for commands that have no
   * immediate ACK (home #12!). Reports only that the bytes were sent; the real
   * outcome must be confirmed separately (e.g. a follow-up #10! position read).
   */
  private async sendFireAndForget(
    action: string,
    build: () => XyzBuiltCommand,
    lastAction: string
  ): Promise<XyzCommandResult> {
    const commandId = this.nextCommandId();
    const route = this.resolveSerialRoute();
    if (route.mode === 'unknown') {
      const error = 'XYZ serial port not configured';
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }
    if (route.mode === 'shared') {
      const error = 'X/Y port cannot use machine COM port';
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }
    if (!this.state.connected) {
      const error = 'XYZ_STAGE_NOT_CONNECTED';
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }
    let built: XyzBuiltCommand;
    try {
      built = build();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }
    const hex = hexSpaced(built.frame);
    // eslint-disable-next-line no-console
    console.log(`[xyz-tx] commandId=${commandId} action=${action} visible=${JSON.stringify(built.visible)} hex=${JSON.stringify(hex)} (no-wait)`);
    this.setState({ lastTx: built.visible, lastCommandId: commandId });
    const queue = getSerialQueue(route.port as string);
    try {
      await queue.enqueue(
        () =>
          new Promise<void>((resolve, reject) => {
            this.port?.write(built.frame, (err) => {
              if (err) {
                reject(err);
                return;
              }
              this.port?.drain((drainErr) => (drainErr ? reject(drainErr) : resolve()));
            });
          })
      );
      this.setState({ lastAction, lastError: undefined });
      // eslint-disable-next-line no-console
      console.log(`[xyz-status] commandId=${commandId} status=sent`);
      return { ok: true, commandId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] commandId=${commandId} error=${JSON.stringify(error)}`);
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }
  }

  // --- Z surface (REAL hardware via the dedicated z-axis serial service) -----
  //
  // The Z axis is a SEPARATE physical connection (its own port/baud/queue) owned
  // by zAxisSerialService. The facade only delegates and merges the resulting Z
  // state into the single state broadcast the UI consumes. Every Z state change
  // is driven by a real TX/RX — no optimistic update, no simulated motion.

  /** Map a Z service result to the unified XyzCommandResult shape (+ friendly message). */
  private toXyzResult(r: ZCommandResult): XyzCommandResult {
    if (r.ok) return { ok: true, rx: r.reply, commandId: r.commandId };
    return {
      ok: false,
      error: r.error,
      message: r.message ?? friendlyXyzMessage(r.error),
      commandId: r.commandId,
    };
  }

  /** Mirror the dedicated Z service's live state into the unified broadcast. */
  private syncZState(extra?: Partial<XyzStageState>): void {
    const z = zAxisSerialService.getZState();
    this.setState({
      zConnected: z.connected,
      zPort: z.port,
      zLocked: z.locked,
      zMoving: z.moving,
      ...(extra ?? {}),
    });
  }

  /** Z operator CONFIG singleton (reverseDirection, pulsePerMm, fine + coarse step). */
  private async loadZSettings(): Promise<{ reverseDirection: boolean; pulsePerMm: number; stepDistanceMm: number; coarseStepDistanceMm: number }> {
    const s = await zSettingsService.get();
    return {
      reverseDirection: s.reverseDirection,
      pulsePerMm: s.pulsePerMm,
      stepDistanceMm: s.stepDistanceMm,
      coarseStepDistanceMm: s.coarseStepDistanceMm ?? 0.01,
    };
  }

  async connectZ(opts: ConnectZOptions): Promise<XyzStageState> {
    // eslint-disable-next-line no-console
    console.log(`[xyz-z] action=connect port=${opts.port} baudRate=${opts.baudRate ?? 'default'}`);
    try {
      await zAxisSerialService.connect(opts);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.syncZState({ lastError: friendlyXyzMessage(error) });
      throw err;
    }
    // Restore the UI's current Z speed tier onto the controller so the mode shown
    // is the one actually in effect (best-effort — logged, never fakes success).
    const applied = await zAxisSerialService.setSpeed(zSpeedRegisterValue(this.state.zSpeed));
    if (!applied.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[xyz-z] action=restore-speed result=failed error=${JSON.stringify(applied.error)}`);
    }
    this.syncZState({ lastAction: 'Z axis connected.', lastError: undefined });
    return this.getState();
  }

  async disconnectZ(): Promise<XyzStageState> {
    await zAxisSerialService.disconnect();
    this.syncZState({ lastAction: 'Z axis disconnected.' });
    return this.getState();
  }

  async lockZ(): Promise<XyzCommandResult> {
    // #LK# enables the Z drive; on the OK_LK ACK the Z service flips locked=true.
    const result = await zAxisSerialService.lock();
    this.syncZState(result.ok ? { lastAction: 'Z axis locked.', lastError: undefined } : { lastError: result.message ?? friendlyXyzMessage(result.error) });
    return this.toXyzResult(result);
  }

  async unlockZ(): Promise<XyzCommandResult> {
    const result = await zAxisSerialService.unlock();
    this.syncZState(result.ok ? { lastAction: 'Z axis unlocked.', lastError: undefined } : { lastError: result.message ?? friendlyXyzMessage(result.error) });
    return this.toXyzResult(result);
  }

  async setZSpeed(speed: ZSpeed): Promise<XyzCommandResult> {
    const registerValue = zSpeedRegisterValue(speed);
    // eslint-disable-next-line no-console
    console.log(`[xyz-z] action=set-speed mode=${speed} registerValue=${registerValue} note=controller-units-uncalibrated`);
    const result = await zAxisSerialService.setSpeed(registerValue);
    if (result.ok) {
      this.syncZState({ lastAction: `Z speed ${speed}.`, lastError: undefined });
      this.setState({ zSpeed: speed });
    } else {
      this.syncZState({ lastError: result.message ?? friendlyXyzMessage(result.error) });
    }
    return this.toXyzResult(result);
  }

  /**
   * Quick-tap STEP, RX-gated. The step size is chosen by the SOFTWARE focus mode
   * (no focus serial command exists): CFocus → coarseStepDistanceMm (0.010 mm =
   * 150 pulses), FFocus/manual → stepDistanceMm (0.001 mm = 15 pulses). Movement
   * requires Z connected AND locked.
   */
  async moveZ(direction: ZDirection, _speed: ZSpeed): Promise<XyzCommandResult> {
    if (!zAxisSerialService.isConnected()) {
      this.syncZState({ lastError: friendlyXyzMessage('XYZ_Z_NOT_CONNECTED') });
      return { ok: false, error: 'XYZ_Z_NOT_CONNECTED', commandId: this.nextCommandId() };
    }
    // #LK# enables the drive — movement requires Z LOCKED (mirrors the X/Y rule).
    if (!this.state.zLocked) {
      // eslint-disable-next-line no-console
      console.warn(`[xyz-z] action=move-step blocked=z-unlocked direction=${direction}`);
      this.syncZState({ lastError: friendlyXyzMessage('XYZ_Z_UNLOCKED') });
      return { ok: false, error: 'XYZ_Z_UNLOCKED', commandId: this.nextCommandId() };
    }
    const z = await this.loadZSettings();
    const sign = resolveZSign(direction, z.reverseDirection);
    // Coarse step only for CFocus; FFocus and manual both use the fine step.
    const focusMode = this.state.focusMode;
    const stepMm = focusMode === 'cFocus' ? z.coarseStepDistanceMm : z.stepDistanceMm;
    const pulses = Math.max(1, zMmToPulses(stepMm, z.pulsePerMm));
    // eslint-disable-next-line no-console
    console.log(`[xyz-z] action=move-step direction=${direction} focusMode=${focusMode} reverseDirection=${z.reverseDirection} sign=${sign} stepMm=${stepMm} pulsePerMm=${z.pulsePerMm} pulses=${pulses}`);
    const result = await zAxisSerialService.moveStep(sign, pulses);
    this.syncZState(result.ok ? { lastAction: `Z step ${direction}.`, lastError: undefined } : { lastError: result.message ?? friendlyXyzMessage(result.error) });
    return this.toXyzResult(result);
  }

  /** Press-and-hold jog START (#+S#/#-S#). Movement requires Z locked. */
  async startZJog(direction: ZDirection): Promise<XyzCommandResult> {
    if (!zAxisSerialService.isConnected()) {
      this.syncZState({ lastError: friendlyXyzMessage('XYZ_Z_NOT_CONNECTED') });
      return { ok: false, error: 'XYZ_Z_NOT_CONNECTED', commandId: this.nextCommandId() };
    }
    if (!this.state.zLocked) {
      // eslint-disable-next-line no-console
      console.warn(`[xyz-z] action=jog-start blocked=z-unlocked direction=${direction}`);
      this.syncZState({ lastError: friendlyXyzMessage('XYZ_Z_UNLOCKED') });
      return { ok: false, error: 'XYZ_Z_UNLOCKED', commandId: this.nextCommandId() };
    }
    const z = await this.loadZSettings();
    const sign = resolveZSign(direction, z.reverseDirection);
    // eslint-disable-next-line no-console
    console.log(`[xyz-z] action=jog-start direction=${direction} reverseDirection=${z.reverseDirection} sign=${sign}`);
    const result = await zAxisSerialService.startJog(sign);
    this.syncZState(result.ok ? { lastAction: `Z jog ${direction}.`, lastError: undefined } : { lastError: result.message ?? friendlyXyzMessage(result.error) });
    return this.toXyzResult(result);
  }

  /** Press-and-hold jog STOP — cancels the repeat loop, then applies the stop
   * discovery strategy (default: re-send the active jog frame). The verified stop
   * command is UNRESOLVED, so a SOK reply does not prove the stage halted and a PLC
   * ERROR is surfaced honestly without clearing the moving state. */
  async stopZJog(): Promise<XyzCommandResult> {
    const result = await zAxisSerialService.stopJog();
    this.syncZState(result.ok ? { lastAction: 'Z jog stop attempted.', lastError: undefined } : { lastError: result.message ?? friendlyXyzMessage(result.error) });
    return this.toXyzResult(result);
  }

  /** Manual Z probe (dev console) — wraps payload as #payload# and reports the RX. */
  probeZ(payload: string): Promise<ZProbeResult> {
    return zAxisSerialService.probe(payload);
  }

  /**
   * Diagnostic stop discovery: start a jog, run ~2s, attempt the stop strategy,
   * capture the raw RX, then poll #sss# for status. Returns the full observation
   * (strategy/start/stop/stopReply/finalStatus/stopped) so the real stop protocol
   * can be identified from hardware. NEVER claims a confirmed stop.
   */
  diagnoseStopZ(): Promise<ZStopDiagnosis> {
    return zAxisSerialService.diagnoseStopStrategy();
  }

  // Legacy single-shot Z stop (kept for API symmetry) routes to the jog stop.
  stopZ(): Promise<XyzCommandResult> {
    return this.stopZJog();
  }

  async pollZStatus(): Promise<XyzCommandResult> {
    const result = await zAxisSerialService.pollStatus();
    this.syncZState(result.ok ? { lastError: undefined } : { lastError: result.message ?? friendlyXyzMessage(result.error) });
    return this.toXyzResult(result);
  }

  diagnoseZ(opts?: { includeJog?: boolean; speedRegisterValue?: number }): Promise<ZDiagnoseResult> {
    return zAxisSerialService.diagnose(opts);
  }
}

export const xyzPlatformSerialService = new XyzPlatformSerialService();
