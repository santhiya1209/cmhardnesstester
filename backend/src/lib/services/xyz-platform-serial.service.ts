import { EventEmitter } from 'node:events';
import {
  buildGetPositionCommand,
  buildHomeCommand,
  buildLockXyCommand,
  buildMoveXCommand,
  buildMoveXyCommand,
  buildMoveYCommand,
  buildSetXAccelerationCommand,
  buildSetXBeginSpeedCommand,
  buildSetXFinalSpeedCommand,
  buildSetYAccelerationCommand,
  buildSetYBeginSpeedCommand,
  buildSetYFinalSpeedCommand,
  buildStopXyCommand,
  buildUnlockXyCommand,
  buildXyVisibleCommandPayload,
  parseXyzFrame,
  type XyzBuiltCommand,
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
const SAFE_MOVE_PULSES = 1;
// Conservative ramp-speed magnitudes per UI speed. The protocol-confirmed value
// is 1 (the safe-movement value); mid/fast are kept deliberately low until the
// real controller speed scale is confirmed. Tune here when known.
const XY_SPEED_VALUE: Record<XySpeed, number> = { slow: 1, mid: 2, fast: 4 };
// No confirmed Z protocol bytes exist yet — Z actions return this distinct code
// so the UI/logs show a not-mapped feature, NOT a serial/ACK failure.
const Z_NOT_CONFIGURED = 'XYZ_Z_COMMAND_NOT_MAPPED';
// X/Y MOVE/HOME protocol is HARDWARE-VERIFIED (Hercules): moveX #0C, moveY #0E,
// moveXY #11 (position reply), home #12 (no immediate ACK -> query #10! after a
// delay). Movement is RX-gated: success only from a real position reply (no fake
// success, no optimistic update). Set back to false to re-block if needed.
const MOVE_COMMANDS_CONFIRMED = true;
const MOVE_NOT_CONFIRMED = 'XYZ_STAGE_COMMAND_NOT_CONFIRMED';
// Home (#12!) returns no immediate reply — wait this long, then read position.
const HOME_QUERY_DELAY_MS = 1500;

export type XyzSerialMode = 'separate' | 'shared' | 'unknown';

export type FocusMode = 'manual' | 'cFocus' | 'fFocus';

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

export interface ConnectStageOptions {
  port: string;
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 1.5 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
}

export type XyzCommandResult =
  | { ok: true; position?: XyzPosition; rx?: string; commandId: string }
  | { ok: false; error: string; commandId?: string };

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
  xySpeed: 'slow',
  zSpeed: 'fast',
  xyLocked: false,
  zLocked: false,
  focusMode: 'manual',
  moving: false,
  lastAction: 'XYZ stage idle.',
  updatedAt: new Date().toISOString(),
};

const MOVE_BUILDERS: Record<XyzDirection, (pulses: number) => XyzBuiltCommand> = {
  // left = X negative, right = X positive, forward = Y positive, back = Y negative.
  left: (p) => buildMoveXCommand(-p),
  right: (p) => buildMoveXCommand(p),
  forward: (p) => buildMoveYCommand(p),
  back: (p) => buildMoveYCommand(-p),
  'forward-left': (p) => buildMoveXyCommand(-p, p),
  'forward-right': (p) => buildMoveXyCommand(p, p),
  'back-left': (p) => buildMoveXyCommand(-p, -p),
  'back-right': (p) => buildMoveXyCommand(p, -p),
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
  // RX kind the in-flight command is waiting for — logged in [xyz-ack-match] /
  // [xyz-rx-unmatched] so an unexpected reply is traceable to what was expected.
  private pendingExpect: XyzExpect | null = null;
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

  getState(): XyzStageState {
    return { ...this.state, position: { ...this.state.position } };
  }

  isConnected(): boolean {
    return this.state.connected;
  }

  private setState(patch: Partial<XyzStageState>): void {
    this.state = {
      ...this.state,
      ...patch,
      position: patch.position ? { ...patch.position } : { ...this.state.position },
      updatedAt: new Date().toISOString(),
    };
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
    // bytes), plus checksum-free token replies (OK_LK/OK_LS/ERROR). We decode as
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

    // SAFE, NON-MOVING probes only — lock/loosen/query and the textual #LK/#LS
    // variants. NO move/home frame (#0C/#0E/#11/#12) is ever sent here. Checksum
    // #01! is the CONFIRMED command (-> OK_LK); the rest are probes to identify
    // unlock/position. Terminator variants of #LK/#LS test how the controller
    // expects those textual commands framed.
    const probes: Array<{ label: string; bytes: Buffer }> = [
      { label: 'checksum #01! (XY lock, expect OK_LK)', bytes: buildXyVisibleCommandPayload('#01!', 'checksum') },
      { label: 'checksum #02! (XY unlock, expect OK_LS)', bytes: buildXyVisibleCommandPayload('#02!', 'checksum') },
      { label: 'raw #02! (probe only)', bytes: Buffer.from('#02!', 'ascii') },
      { label: 'checksum #03! (probe)', bytes: buildXyVisibleCommandPayload('#03!', 'checksum') },
      { label: 'checksum #04! (probe)', bytes: buildXyVisibleCommandPayload('#04!', 'checksum') },
      { label: 'checksum #10! (get position, probe)', bytes: buildXyVisibleCommandPayload('#10!', 'checksum') },
      { label: 'raw #LK', bytes: Buffer.from('#LK', 'ascii') },
      { label: 'raw #LK CR', bytes: Buffer.from('#LK\r', 'ascii') },
      { label: 'raw #LK CRLF', bytes: Buffer.from('#LK\r\n', 'ascii') },
      { label: 'raw #LS', bytes: Buffer.from('#LS', 'ascii') },
      { label: 'raw #LS CR', bytes: Buffer.from('#LS\r', 'ascii') },
      { label: 'raw #LS CRLF', bytes: Buffer.from('#LS\r\n', 'ascii') },
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
      if (/^(#[0-9A-Za-z]{2}OK|OK_LK|OK_LS|OK|ERROR)$/i.test(this.rxBuffer)) {
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
    console.log(`[xyz-rx-frame] commandId=${commandId} kind=${parsed.kind} raw=${JSON.stringify(parsed.raw)} hex=${JSON.stringify(rxHexFull)}`);
    this.setState({ lastRx: parsed.raw });

    switch (parsed.kind) {
      case 'position': {
        const position: XyzPosition = { x: parsed.x, y: parsed.y, z: this.state.position.z };
        // eslint-disable-next-line no-console
        console.log(`[xyz-position-parse] commandId=${commandId} x=${parsed.x} y=${parsed.y} status=${JSON.stringify(parsed.status)} busy=${parsed.busy}`);
        // eslint-disable-next-line no-console
        console.log(`[xyz-position-rx] commandId=${commandId} x=${parsed.x} y=${parsed.y} busy=${parsed.busy}`);
        if (parsed.checksum !== undefined && parsed.checksumExpected !== undefined) {
          // eslint-disable-next-line no-console
          console.log(`[xyz-rx-checksum] commandId=${commandId} kind=position rx=${hexByte(parsed.checksum)} expectedSum=${hexByte(parsed.checksumExpected)} match=${parsed.checksum === parsed.checksumExpected}`);
        }
        // Position is a REAL reply (e.g. from #10!), not optimistic. busy flag is
        // truthful motion state derived from the frame.
        this.setState({ position, moving: parsed.busy, lastError: undefined });
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
    if (reject) reject(err);
  }

  /** Write a frame and wait for the RX position/ack (or time out). */
  private transmitNow(commandId: string, built: XyzBuiltCommand, label: string): Promise<XyzPosition | null> {
    if (!this.port || !this.state.connected) {
      return Promise.reject(new Error('XYZ_STAGE_NOT_CONNECTED'));
    }
    const hex = hexSpaced(built.frame);
    // eslint-disable-next-line no-console
    console.log(`[xyz-tx] commandId=${commandId} visible=${JSON.stringify(built.visible)} hex=${JSON.stringify(hex)}`);
    this.setState({ lastTx: built.visible, lastCommandId: commandId });

    const waitForRx = new Promise<XyzPosition | null>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.pendingCommandId = commandId;
      this.pendingExpect = built.expect;
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
        this.pendingAckCode = null;
        this.pendingLabel = null;
        this.pendingTxVisible = null;
        this.pendingTxHex = null;
        // eslint-disable-next-line no-console
        console.error(`[xyz-timeout] commandId=${commandId} timeoutMs=${TX_TIMEOUT_MS}`);
        reject(new Error('XYZ_STAGE_ACK_TIMEOUT'));
      }, TX_TIMEOUT_MS);
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
    }).then(() => waitForRx);
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
    priority = false
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
      this.rejectPending(new Error('XYZ_STAGE_PREEMPTED'));
    }

    try {
      const position = await queue.enqueue(() => this.transmitNow(commandId, built, action), { priority });
      this.setState({ lastAction, lastError: undefined });
      const status = position ? 'move-confirmed' : 'ack-confirmed';
      // eslint-disable-next-line no-console
      console.log(`[xyz-status] commandId=${commandId} status=${status}`);
      return position
        ? { ok: true, position, rx: this.state.lastRx, commandId }
        : { ok: true, rx: this.state.lastRx, commandId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] commandId=${commandId} error=${JSON.stringify(error)}`);
      // eslint-disable-next-line no-console
      console.error(`[xyz-status] commandId=${commandId} status=failed`);
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
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

  /**
   * Every Z method fails safely — there is NO confirmed Z protocol yet (TODO).
   * This is a not-implemented feature, NOT a serial/ACK failure: logged under
   * [xyz-todo] (not [xyz-error]) so it can't be mistaken for a comms problem.
   */
  private zNotConfigured(action: string): Promise<XyzCommandResult> {
    const commandId = this.nextCommandId();
    // eslint-disable-next-line no-console
    console.warn(`[xyz-todo] commandId=${commandId} action=${action} note=${JSON.stringify(Z_NOT_CONFIGURED)} (feature not configured — not a serial failure)`);
    this.setState({ lastError: Z_NOT_CONFIGURED });
    return Promise.resolve({ ok: false, error: Z_NOT_CONFIGURED, commandId });
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

  moveStage(direction: XyzDirection, speed: XySpeed): Promise<XyzCommandResult> {
    // Movement is BLOCKED until a move command's frame + reply are verified on
    // hardware — never send an unverified move (could move the stage wrongly).
    if (!MOVE_COMMANDS_CONFIRMED) {
      return this.moveNotConfirmed(`moveStage(${direction},${speed})`);
    }
    // X/Y must be LOCKED (servo engaged) to move: lock enables movement, unlock
    // blocks it. Mirrors the UI gating (locked ⇒ arrows enabled).
    if (!this.state.xyLocked) {
      return Promise.resolve({ ok: false, error: 'XYZ_STAGE_XY_UNLOCKED', commandId: this.nextCommandId() });
    }
    const build = (): XyzBuiltCommand => MOVE_BUILDERS[direction](SAFE_MOVE_PULSES);
    return this.runCommand('moveStage', build, `Move ${direction} (speed ${speed}).`);
  }

  stopStage(): Promise<XyzCommandResult> {
    return this.runCommand('stopStage', () => buildStopXyCommand(), 'Stop X/Y.', true);
  }

  async lockXy(): Promise<XyzCommandResult> {
    const result = await this.runCommand('lockXy', () => buildLockXyCommand(), 'X/Y platform locked.');
    if (result.ok) this.setState({ xyLocked: true });
    return result;
  }

  async unlockXy(): Promise<XyzCommandResult> {
    const result = await this.runCommand('unlockXy', () => buildUnlockXyCommand(), 'X/Y platform unlocked.');
    if (result.ok) this.setState({ xyLocked: false });
    return result;
  }

  async setXySpeed(speed: XySpeed): Promise<XyzCommandResult> {
    const value = XY_SPEED_VALUE[speed];
    const steps: Array<() => XyzBuiltCommand> = [
      () => buildSetXBeginSpeedCommand(value),
      () => buildSetXAccelerationCommand(value),
      () => buildSetXFinalSpeedCommand(value),
      () => buildSetYBeginSpeedCommand(value),
      () => buildSetYAccelerationCommand(value),
      () => buildSetYFinalSpeedCommand(value),
    ];
    let last: XyzCommandResult | null = null;
    for (const build of steps) {
      const result = await this.runCommand('setXySpeed', build, `Set X/Y speed ${speed} (value ${value}).`);
      if (!result.ok) return result;
      last = result;
    }
    this.setState({ xySpeed: speed });
    return last ?? { ok: true, commandId: this.nextCommandId() };
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

  // No confirmed "move to centre of travel" command — fail safely (never invent).
  moveToCenter(): Promise<XyzCommandResult> {
    const commandId = this.nextCommandId();
    const error = 'XYZ move-to-center not configured';
    // eslint-disable-next-line no-console
    console.error(`[xyz-error] commandId=${commandId} error=${JSON.stringify(error)}`);
    this.setState({ lastError: error });
    return Promise.resolve({ ok: false, error, commandId });
  }

  // Relocate = re-home (#12!). Home returns NO immediate ACK, so we fire it
  // WITHOUT waiting for RX, then read the position via #10! after a delay. The
  // returned result reflects that follow-up position query (no fake success).
  async locateCenter(): Promise<XyzCommandResult> {
    if (!MOVE_COMMANDS_CONFIRMED) {
      return this.moveNotConfirmed('locateCenter(home)');
    }
    const sent = await this.sendFireAndForget('home', () => buildHomeCommand(), 'Home / relocate.');
    if (!sent.ok) return sent;
    await new Promise((resolve) => setTimeout(resolve, HOME_QUERY_DELAY_MS));
    return this.getPosition();
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

  // --- Z surface (no confirmed protocol — all fail safely) -------------------

  moveZ(_direction: ZDirection, _speed: ZSpeed): Promise<XyzCommandResult> {
    return this.zNotConfigured('moveZ');
  }

  stopZ(): Promise<XyzCommandResult> {
    return this.zNotConfigured('stopZ');
  }

  lockZ(): Promise<XyzCommandResult> {
    return this.zNotConfigured('lockZ');
  }

  unlockZ(): Promise<XyzCommandResult> {
    return this.zNotConfigured('unlockZ');
  }

  setZSpeed(_speed: ZSpeed): Promise<XyzCommandResult> {
    return this.zNotConfigured('setZSpeed');
  }
}

export const xyzPlatformSerialService = new XyzPlatformSerialService();
