import { EventEmitter } from 'node:events';
import { getSerialQueue } from './serial-command-queue';
import { hardnessMachineSerialService } from './hardness-machine-serial.service';
import {
  buildPollZStatusCommand,
  buildZJogCommand,
  buildZLockCommand,
  buildZLoosenCommand,
  buildZMoveCommand,
  buildZProbeCommand,
  buildZSetSpeedCommand,
  buildZStopCommand,
  classifyZLine,
  normalizeZLine,
  replyMatchesExpect,
  splitZLines,
  type ZBuiltCommand,
  type ZLineKind,
} from './z-axis-protocol';

// DEDICATED Z-axis serial connection. INDEPENDENT of the X/Y stage port and the
// hardness-machine port: its own SerialPort instance, its own per-port command
// queue (mutex), its own RX framing. The X/Y service (xyz-platform-serial.service)
// delegates every Z action here and merges the resulting Z state into the single
// state broadcast the UI consumes — but the serial connection lives only here.
//
// PROTOCOL (see z-axis-protocol.ts): TX "#payload#", RX "payload\n". NO checksum.
// Replies are matched by SUBSTRING (OK_LK / OK_LS / SOK / UP / >Z: / OK_ZFinalSpeed).
//
// Hardware truth only: UI/state changes are driven from real TX/RX. No optimistic
// updates, no simulated motion, no fabricated replies. Continuous jog is held by
// REPEATED #+S#/#-S# frames (each gated on a real SOK) and stopped by #SSS#→UP.

// Defensive require so the backend keeps booting even if `serialport` is not
// rebuilt for the current Node ABI yet — mirrors the X/Y + machine services.
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
  set?: (
    opts: { rts?: boolean; dtr?: boolean; brk?: boolean },
    cb?: (err: Error | null | undefined) => void
  ) => void;
  on: (event: 'data' | 'error' | 'close', listener: (...args: unknown[]) => void) => void;
  isOpen: boolean;
};

let SerialPortLib: { SerialPort: SerialPortCtor } | null = null;
let serialPortLoadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SerialPortLib = require('serialport') as { SerialPort: SerialPortCtor };
} catch (err) {
  serialPortLoadError = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error('[z-error] serialport module not available:', serialPortLoadError);
}

/** TEST SEAM: inject a fake serialport lib so the jog loop / stop can be unit-tested. */
export function __setZSerialPortLibForTests(lib: { SerialPort: SerialPortCtor } | null): void {
  SerialPortLib = lib;
  serialPortLoadError = null;
}

// Z line settings come from the old software: 57600 8N1, no flow control. This is
// the DEFAULT only — the actual value is parameterizable per connect() call.
const Z_DEFAULT_BAUD = 57600;
const Z_TX_TIMEOUT_MS = 5000;
// Continuous-jog repeat cadence. The old software re-sends the jog frame while the
// button is held; we mirror that, each frame gated on a real SOK reply.
const Z_JOG_REPEAT_MS = 150;
// Backend safety watchdog: if no stopJog arrives within this window after a jog
// starts (release event missed / IPC dropped), the service runs the stop itself.
const Z_JOG_WATCHDOG_MS = 10_000;
// Default stop payload, sent as "#SSS#". Configurable via Serial settings
// (zStopPayload) and passed in by the facade; this is only the fallback.
const Z_DEFAULT_STOP_PAYLOAD = 'SSS';
// Candidate stop payloads for diagnoseStop() — used to find the real stop command
// on hardware when the configured stop is rejected with ERROR.
const Z_STOP_PROBE_CANDIDATES = ['SSS', 'S', 'STOP', 'ST', 'UP'];

export type ZCommandResult =
  | { ok: true; reply?: string; commandId: string }
  | { ok: false; error: string; message?: string; commandId?: string };

export interface ZServiceState {
  connected: boolean;
  port: string | null;
  locked: boolean;
  moving: boolean;
  /** Last RX line classified as a status word, or null. */
  status: string | null;
  lastTx: string | null;
  lastRx: string | null;
  lastError: string | null;
}

/** One probe outcome for diagnose()/probe() — exact TX and whatever (if anything) came back. */
export interface ZProbeResult {
  label: string;
  tx: string;
  rx: string | null;
  classification: ZLineKind | null;
  error?: string;
}

export interface ZDiagnoseResult {
  ok: boolean;
  error?: string;
  port: string | null;
  baudRate: number | null;
  anyRx: boolean;
  probes: ZProbeResult[];
  summary: string;
}

export interface ConnectZOptions {
  port: string;
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 1.5 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
}

const Z_PORT_NOT_CONFIGURED = 'Z Axis port not configured';

function hexSpaced(buf: Buffer): string {
  return buf.toString('hex').toUpperCase().replace(/(..)(?=.)/g, '$1 ');
}

function toPrintable(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1F\x7F]/g, (c) => {
    if (c === '\r') return '\\r';
    if (c === '\n') return '\\n';
    if (c === '\t') return '\\t';
    return '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase();
  });
}

export class ZAxisSerialService extends EventEmitter {
  private port: SerialPortInstance | null = null;
  private portName: string | null = null;
  private baudRate: number = Z_DEFAULT_BAUD;
  private connected = false;
  private locked = false;
  private moving = false;
  private status: string | null = null;
  private lastTx: string | null = null;
  private lastRx: string | null = null;
  private lastError: string | null = null;

  private rxBuffer = '';
  private commandSequence = 0;
  private jogRepeatMs = Z_JOG_REPEAT_MS;
  // Active stop payload (configurable; set by the facade from Serial settings).
  private stopPayload = Z_DEFAULT_STOP_PAYLOAD;

  // Single in-flight waiter (the per-port queue guarantees one command at a time).
  private pending: {
    resolve: (line: string) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    built: ZBuiltCommand;
    commandId: string;
  } | null = null;

  // True between startJog and stopJog. While active, a 150 ms loop re-sends the
  // jog frame; each send still waits for a real SOK before scheduling the next.
  private jogActive = false;
  private jogTimer: ReturnType<typeof setTimeout> | null = null;
  private jogWatchdog: ReturnType<typeof setTimeout> | null = null;

  /** TEST SEAM: shorten the jog repeat cadence so the loop can be unit-tested quickly. */
  setJogRepeatMsForTests(ms: number): void {
    this.jogRepeatMs = ms;
  }

  getZState(): ZServiceState {
    return {
      connected: this.connected,
      port: this.portName,
      locked: this.locked,
      moving: this.moving,
      status: this.status,
      lastTx: this.lastTx,
      lastRx: this.lastRx,
      lastError: this.lastError,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  private nextCommandId(): string {
    this.commandSequence += 1;
    return `z-${this.commandSequence}`;
  }

  // State mutators that log [z-state] only on a real change (RX-driven).
  private setMoving(value: boolean): void {
    if (this.moving === value) return;
    this.moving = value;
    // eslint-disable-next-line no-console
    console.log(`[z-state] moving=${value} locked=${this.locked} jogActive=${this.jogActive}`);
  }

  // --- Connection ------------------------------------------------------------

  async connect(opts: ConnectZOptions): Promise<ZServiceState> {
    if (this.connected) return this.getZState();

    // Port is operator-selected (Serial Port Setting → zPortName), never hardcoded.
    const port = typeof opts.port === 'string' ? opts.port.trim() : '';
    if (!port) {
      this.lastError = Z_PORT_NOT_CONFIGURED;
      // eslint-disable-next-line no-console
      console.error(`[z-error] action=connect error=${JSON.stringify(Z_PORT_NOT_CONFIGURED)}`);
      throw new Error(Z_PORT_NOT_CONFIGURED);
    }
    // Never share the hardness-machine COM port. (X/Y-port sharing is rejected at
    // the IPC layer, which knows both configured stage ports.)
    const machinePort = hardnessMachineSerialService.getState().port;
    if (machinePort && machinePort === port) {
      const message = 'Z port cannot use machine COM port';
      this.lastError = message;
      // eslint-disable-next-line no-console
      console.error(`[z-error] action=connect error=${JSON.stringify(message)}`);
      throw new Error(message);
    }
    if (!SerialPortLib) {
      const message =
        'serialport native module not loaded' +
        (serialPortLoadError ? `: ${serialPortLoadError}` : '');
      this.lastError = message;
      // eslint-disable-next-line no-console
      console.error(`[z-error] action=connect error=${JSON.stringify(message)}`);
      throw new Error(message);
    }

    // Baud comes from the SerialPort settings; default to the legacy 57600 if empty.
    const baudRate = opts.baudRate ?? Z_DEFAULT_BAUD;
    const dataBits = opts.dataBits ?? 8;
    const stopBits = opts.stopBits ?? 1;
    const parity = opts.parity ?? 'none';
    this.baudRate = baudRate;
    // eslint-disable-next-line no-console
    console.log(
      `[z-open] port=${port} baudRate=${baudRate} dataBits=${dataBits} parity=${parity} stopBits=${stopBits}`
    );

    const instance = new SerialPortLib.SerialPort({
      path: port,
      baudRate,
      dataBits,
      stopBits,
      parity,
      rtscts: false,
      xon: false,
      xoff: false,
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      const watchdog = setTimeout(() => reject(new Error(`open() timed out after 5s for ${port}`)), 5000);
      instance.open((err) => {
        clearTimeout(watchdog);
        if (err) {
          // eslint-disable-next-line no-console
          console.error(`[z-error] action=open path=${port} error=${JSON.stringify(err.message)}`);
          reject(err);
          return;
        }
        resolve();
      });
    });

    // Assert RTS+DTR high — many RS232/USB adapters gate the controller's
    // transmitter (or power the converter) off these lines, so an open that left
    // them low can leave the controller silent even with correct baud/framing. A
    // .set failure is logged but never aborts the connect.
    if (typeof instance.set === 'function') {
      await new Promise<void>((resolve) => {
        instance.set!({ rts: true, dtr: true }, (err) => {
          // eslint-disable-next-line no-console
          if (err) console.error(`[z-error] action=line-control error=${JSON.stringify(err.message)}`);
          else console.log('[z-open] lineControl rts=true dtr=true ok=true');
          resolve();
        });
      });
    }

    this.rxBuffer = '';
    instance.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'latin1');
      const text = buf.toString('latin1');
      // eslint-disable-next-line no-console
      console.log(
        `[z-rx-raw] commandId=${this.pending?.commandId ?? 'none'} hex=${JSON.stringify(hexSpaced(buf))} text=${JSON.stringify(toPrintable(text))}`
      );
      this.rxBuffer += text;
      this.drainRxLines();
    });
    instance.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[z-error] port error:', message);
      this.lastError = message;
    });
    instance.on('close', () => {
      this.port = null;
      this.rxBuffer = '';
      this.clearJogTimer();
      this.clearJogWatchdog();
      this.jogActive = false;
      this.setMoving(false);
      this.connected = false;
    });

    this.port = instance;
    this.portName = port;
    this.connected = true;
    this.lastError = null;
    // eslint-disable-next-line no-console
    console.log(`[z-open] status=connected port=${port}`);
    return this.getZState();
  }

  async disconnect(): Promise<ZServiceState> {
    // If a jog is active, send #SSS# to halt motion BEFORE tearing down the port.
    if (this.jogActive && this.connected) {
      // eslint-disable-next-line no-console
      console.log('[z-jog-stop] phase=safe-stop-before-disconnect');
      try {
        await this.stopJog();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[z-error] action=stop-before-disconnect error=${JSON.stringify(err instanceof Error ? err.message : String(err))}`);
      }
    }
    if (this.port) {
      await new Promise<void>((resolve) => this.port?.close(() => resolve()));
      this.port = null;
    }
    this.rxBuffer = '';
    this.clearJogTimer();
    this.clearJogWatchdog();
    this.jogActive = false;
    this.setMoving(false);
    this.connected = false;
    // eslint-disable-next-line no-console
    console.log(`[z-close] port=${this.portName}`);
    this.portName = null;
    return this.getZState();
  }

  // --- RX framing (line-based; replies are LF-terminated ASCII, NO checksum) --

  private drainRxLines(): void {
    // Split on LF (0x0A) ONLY — the Z reply terminator. A stray CR is trimmed by
    // normalizeZLine. The trailing partial line stays buffered until its LF.
    const { lines, rest } = splitZLines(this.rxBuffer);
    this.rxBuffer = rest;
    for (const rawLine of lines) {
      const line = normalizeZLine(rawLine);
      if (line.length === 0) continue;
      this.lastRx = line;
      const kind = classifyZLine(line);
      if (kind === 'status') this.status = line;
      // eslint-disable-next-line no-console
      console.log(`[z-rx-line] kind=${kind} line=${JSON.stringify(line)} pending=${this.pending?.commandId ?? 'none'}`);

      const pending = this.pending;
      if (pending && replyMatchesExpect(line, pending.built.expect)) {
        // eslint-disable-next-line no-console
        console.log(`[z-ack] commandId=${pending.commandId} key=${pending.built.key} expect=${pending.built.expect} matched=${JSON.stringify(line)}`);
        this.resolvePending(line, null);
      } else if (pending && kind === 'error') {
        // A real PLC ERROR is a DEFINITIVE response — end the in-flight command
        // immediately rather than waiting for the expected token / 5s timeout. The
        // caller (e.g. stopJog) decides how to clear state. Never a fake success.
        // eslint-disable-next-line no-console
        console.warn(`[z-rx-line] kind=error commandId=${pending.commandId} key=${pending.built.key} note=reject-pending raw=${JSON.stringify(line)}`);
        this.resolvePending(null, new Error('Z_STAGE_PROTOCOL_ERROR'));
      }
      // A non-matching / unsolicited line is logged above and intentionally NOT
      // resolved — we wait for the expected substring or the timeout. Never
      // resolve on the wrong reply (no fake success).
    }
  }

  private resolvePending(line: string | null, err: Error | null): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    if (err) pending.reject(err);
    else pending.resolve(line ?? '');
  }

  // --- Low-level send --------------------------------------------------------

  /**
   * Send a command and wait for its expected reply substring. Serialized through
   * the per-port queue (one command in flight at a time). Times out safely,
   * always releasing the queue lock and clearing the pending waiter. Returns the
   * matched RX line; throws on timeout / write error.
   */
  private async transmit(commandId: string, built: ZBuiltCommand): Promise<string> {
    if (!this.port || !this.connected) {
      throw new Error('XYZ_Z_NOT_CONNECTED');
    }
    const hex = hexSpaced(built.frame);
    this.lastTx = built.visible;
    // eslint-disable-next-line no-console
    console.log(`[z-tx] commandId=${commandId} key=${built.key} visible=${JSON.stringify(built.visible)} hex=${JSON.stringify(hex)} expect=${built.expect}`);

    const queue = getSerialQueue(this.portName as string);
    return queue.enqueue(
      () =>
        new Promise<string>((resolve, reject) => {
          this.port?.write(built.frame, (writeErr) => {
            if (writeErr) {
              reject(writeErr);
              return;
            }
            this.port?.drain((drainErr) => {
              if (drainErr) {
                reject(drainErr);
                return;
              }
              const timer = setTimeout(() => {
                // eslint-disable-next-line no-console
                console.error(`[z-timeout] commandId=${commandId} key=${built.key} expect=${built.expect} afterMs=${Z_TX_TIMEOUT_MS}`);
                this.resolvePending(null, new Error('XYZ_Z_TIMEOUT'));
              }, Z_TX_TIMEOUT_MS);
              this.pending = { resolve, reject, timer, built, commandId };
            });
          });
        })
    );
  }

  /** Run a reply-gated command and map the outcome to a ZCommandResult. */
  private async runCommand(built: ZBuiltCommand, action: string): Promise<ZCommandResult> {
    const commandId = this.nextCommandId();
    if (!this.connected) {
      this.lastError = 'XYZ_Z_NOT_CONNECTED';
      return { ok: false, error: 'XYZ_Z_NOT_CONNECTED', commandId };
    }
    try {
      const reply = await this.transmit(commandId, built);
      this.lastError = null;
      // eslint-disable-next-line no-console
      console.log(`[z-confirm] commandId=${commandId} action=${JSON.stringify(action)} reply=${JSON.stringify(reply)}`);
      return { ok: true, reply, commandId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.lastError = error;
      // eslint-disable-next-line no-console
      console.error(`[z-error] commandId=${commandId} action=${JSON.stringify(action)} error=${JSON.stringify(error)}`);
      return { ok: false, error, commandId };
    }
  }

  // --- Public Z command surface ----------------------------------------------

  async lock(): Promise<ZCommandResult> {
    const result = await this.runCommand(buildZLockCommand(), 'Z lock (#LK#).');
    // Lock is a DRIVER-STATE command, NOT motion: on the real OK_LK it sets
    // locked=true and asserts a known-idle state (no jog loop, moving=false). It
    // must never leave a stale moving=true that would block the next step move.
    if (result.ok) this.applyDriverState(true);
    return result;
  }

  async unlock(): Promise<ZCommandResult> {
    const result = await this.runCommand(buildZLoosenCommand(), 'Z loosen (#LS#).');
    if (result.ok) this.applyDriverState(false);
    return result;
  }

  /**
   * Apply a CONFIRMED lock/loosen (driver-state, not motion). Sets `locked` and
   * forces a known-idle state — cancels any running jog loop/watchdog and clears
   * `moving`/`jogActive`. This is bookkeeping for a driver handshake, not a faked
   * motion result: it runs ONLY after the real OK_LK / OK_LS reply.
   */
  private applyDriverState(locked: boolean): void {
    this.clearJogTimer();
    this.clearJogWatchdog();
    this.jogActive = false;
    this.locked = locked;
    this.moving = false;
    // eslint-disable-next-line no-console
    console.log(`[z-state] locked=${locked} moving=false jogActive=false`);
  }

  /** Set Z final speed. `registerValue` is the controller speed register units. */
  async setSpeed(registerValue: number): Promise<ZCommandResult> {
    return this.runCommand(buildZSetSpeedCommand(registerValue), `Z set speed #VZ ${registerValue}#.`);
  }

  /**
   * Single relative step (#+Z n# / #-Z n#). `sign` is the PHYSICAL direction
   * (already reverse-resolved by the caller); `pulses` is the magnitude. Gated on
   * the >Z: reply — state changes only from a real RX.
   */
  async moveStep(sign: '+' | '-', pulses: number): Promise<ZCommandResult> {
    // BUSY only on REAL motion/jog state — NEVER on lock/loosen state.
    if (this.jogActive || this.moving) {
      return { ok: false, error: 'XYZ_Z_BUSY', commandId: this.nextCommandId() };
    }
    // `moving` is owned by the step lifecycle: true while the command is in
    // flight, cleared after the real >Z: reply (or on failure) via finally.
    this.setMoving(true);
    try {
      return await this.runCommand(buildZMoveCommand(sign, pulses), `Z step ${sign}Z ${pulses}.`);
    } finally {
      this.setMoving(false);
    }
  }

  /**
   * Start a continuous press-and-hold jog. Sends the jog frame (#+S#/#-S#) and
   * waits for the real SOK; only then is `moving` set true and the 150 ms repeat
   * loop scheduled. A safety watchdog fires stopJog if the release is missed.
   */
  async startJog(sign: '+' | '-', stopPayload?: string): Promise<ZCommandResult> {
    if (typeof stopPayload === 'string' && stopPayload.length > 0) this.stopPayload = stopPayload;
    if (!this.connected) {
      this.lastError = 'XYZ_Z_NOT_CONNECTED';
      return { ok: false, error: 'XYZ_Z_NOT_CONNECTED', commandId: this.nextCommandId() };
    }
    if (this.jogActive) {
      // One jog at a time — ignore a repeated press.
      return { ok: true, commandId: this.nextCommandId() };
    }
    const built = buildZJogCommand(sign);
    this.jogActive = true;
    // eslint-disable-next-line no-console
    console.log(`[z-jog-start] sign=${sign} visible=${JSON.stringify(built.visible)} repeatMs=${this.jogRepeatMs}`);
    const first = await this.runCommand(built, `Z jog start ${built.visible}.`);
    if (!first.ok) {
      this.jogActive = false;
      // eslint-disable-next-line no-console
      console.error(`[z-jog-start] result=failed error=${JSON.stringify(first.error)}`);
      return first;
    }
    this.setMoving(true);
    this.armJogWatchdog();
    this.scheduleJogTick(built);
    return first;
  }

  private scheduleJogTick(built: ZBuiltCommand): void {
    this.clearJogTimer();
    this.jogTimer = setTimeout(() => {
      void this.jogTick(built);
    }, this.jogRepeatMs);
  }

  private async jogTick(built: ZBuiltCommand): Promise<void> {
    if (!this.jogActive) return;
    // eslint-disable-next-line no-console
    console.log(`[z-jog-tick] visible=${JSON.stringify(built.visible)}`);
    const result = await this.runCommand(built, `Z jog tick ${built.visible}.`);
    if (!this.jogActive) return; // stopped while this tick was in flight
    if (!result.ok) {
      // A tick did not get its SOK — stop safely rather than keep firing blind.
      // eslint-disable-next-line no-console
      console.error(`[z-jog-tick] result=failed error=${JSON.stringify(result.error)} note=auto-stop`);
      void this.stopJog();
      return;
    }
    this.scheduleJogTick(built);
  }

  /**
   * Stop a press-and-hold jog. Cancels the repeat loop IMMEDIATELY, then sends the
   * high-priority stop frame #SSS# and waits for the real UP reply. `moving` is
   * cleared ONLY on that UP — if the controller never confirms, we surface the
   * failure honestly rather than faking a stop.
   */
  async stopJog(stopPayload?: string): Promise<ZCommandResult> {
    if (typeof stopPayload === 'string' && stopPayload.length > 0) this.stopPayload = stopPayload;
    const commandId = this.nextCommandId();
    const wasJogging = this.jogActive;
    // Stop the loop from scheduling further frames before anything else.
    this.jogActive = false;
    this.clearJogTimer();
    this.clearJogWatchdog();
    if (!this.connected) {
      this.setMoving(false);
      return { ok: false, error: 'XYZ_Z_NOT_CONNECTED', commandId };
    }
    const built = buildZStopCommand(this.stopPayload);
    // eslint-disable-next-line no-console
    console.log(`[z-jog-stop] wasJogging=${wasJogging} send=${JSON.stringify(built.visible)}`);
    const result = await this.runCommand(built, `Z stop (${built.visible}).`);
    if (result.ok) {
      this.setMoving(false); // idle confirmed by the real UP reply
      return result;
    }
    // A real PLC ERROR is a DEFINITIVE response, NOT a hang. Clear the software jog
    // state immediately so the next step move isn't blocked, and surface the PLC
    // error honestly. We do NOT keep waiting for a UP that will never arrive.
    if (result.error === 'Z_STAGE_PROTOCOL_ERROR') {
      this.setMoving(false);
      this.jogActive = false;
      this.lastError = 'Z stop returned ERROR from PLC';
      // eslint-disable-next-line no-console
      console.warn(`[z-jog-stop] result=plc-error cleared=moving,jogActive lastError=${JSON.stringify(this.lastError)} commandId=${commandId}`);
      return { ok: false, error: 'Z_STOP_PLC_ERROR', message: this.lastError, commandId };
    }
    // Timeout / write error: genuinely unknown — surface honestly, leave moving.
    return result;
  }

  /**
   * Probe candidate stop payloads (#SSS#, #S#, #STOP#, #ST#, #UP#) and report the
   * raw RX for each — used to discover the real stop command on hardware when the
   * configured stop is rejected with ERROR. Each probe accepts ANY reply, so an
   * ERROR is reported (not retried) and nothing hangs.
   */
  async diagnoseStop(): Promise<ZProbeResult[]> {
    const results: ZProbeResult[] = [];
    for (const payload of Z_STOP_PROBE_CANDIDATES) {
      // eslint-disable-next-line no-console
      console.log(`[z-stop-probe] candidate=${JSON.stringify(payload)}`);
      results.push(await this.probe(payload));
    }
    return results;
  }

  async pollStatus(): Promise<ZCommandResult> {
    // Diagnostic only — #sss# is NOT one of the verified motion commands.
    return this.runCommand(buildPollZStatusCommand(), 'Z poll status (#sss#).');
  }

  private armJogWatchdog(): void {
    this.clearJogWatchdog();
    this.jogWatchdog = setTimeout(() => {
      this.jogWatchdog = null;
      // eslint-disable-next-line no-console
      console.warn(`[z-jog-stop] action=jog-watchdog fired afterMs=${Z_JOG_WATCHDOG_MS} note=auto-stop`);
      void this.stopJog();
    }, Z_JOG_WATCHDOG_MS);
  }

  private clearJogWatchdog(): void {
    if (this.jogWatchdog) {
      clearTimeout(this.jogWatchdog);
      this.jogWatchdog = null;
    }
  }

  private clearJogTimer(): void {
    if (this.jogTimer) {
      clearTimeout(this.jogTimer);
      this.jogTimer = null;
    }
  }

  // --- Manual probe ----------------------------------------------------------

  /**
   * Manual Z probe (window.xyzPlatform.probeZ). Wraps the operator-supplied
   * payload as "#payload#" and reports whatever line (if any) the controller
   * sends back. e.g. probe('LK') → #LK#, probe('+Z 15') → #+Z 15#. Accepts ANY
   * reply line — it never asserts success, it just shows the RX.
   */
  async probe(payload: string): Promise<ZProbeResult> {
    const built = buildZProbeCommand(payload);
    if (!this.connected || !this.portName) {
      // eslint-disable-next-line no-console
      console.error(`[z-error] action=probe error=${JSON.stringify('XYZ_Z_NOT_CONNECTED')} tx=${JSON.stringify(built.visible)}`);
      return { label: built.visible, tx: built.visible, rx: null, classification: null, error: 'XYZ_Z_NOT_CONNECTED' };
    }
    const commandId = this.nextCommandId();
    try {
      const reply = await this.transmit(commandId, built);
      return {
        label: built.visible,
        tx: built.visible,
        rx: reply,
        classification: reply ? classifyZLine(reply) : null,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { label: built.visible, tx: built.visible, rx: null, classification: null, error };
    }
  }

  // --- Diagnostics -----------------------------------------------------------

  /**
   * Send the Z command sequence and report exactly what (if anything) the
   * controller replies with. By default sends only the non-continuous commands
   * (#LK#, #LS#, #VZ <r>#, #+Z 15#, #-Z 15#, #SSS#); the continuous jog probes
   * (#+S#/#-S#) run ONLY when includeJog is explicitly true (they cause motion).
   */
  async diagnose(opts?: { includeJog?: boolean; speedRegisterValue?: number }): Promise<ZDiagnoseResult> {
    if (!this.connected || !this.portName) {
      const summary = `Z not connected — configure the Z port and connect first. (${Z_PORT_NOT_CONFIGURED} if unset.)`;
      // eslint-disable-next-line no-console
      console.error(`[z-error] action=diagnose error=${JSON.stringify(summary)}`);
      return { ok: false, error: 'XYZ_Z_NOT_CONNECTED', port: this.portName, baudRate: this.connected ? this.baudRate : null, anyRx: false, probes: [], summary };
    }
    const speedValue = opts?.speedRegisterValue ?? 1000;
    const sequence: ZBuiltCommand[] = [
      buildZLockCommand(),
      buildZLoosenCommand(),
      buildZSetSpeedCommand(speedValue),
      buildZMoveCommand('+', 15),
      buildZMoveCommand('-', 15),
      buildZStopCommand(),
    ];
    if (opts?.includeJog) {
      sequence.push(buildZJogCommand('+'), buildZJogCommand('-'));
    }

    // eslint-disable-next-line no-console
    console.log(`[z-state] action=diagnose port=${this.portName} baudRate=${this.baudRate} includeJog=${!!opts?.includeJog}`);

    const probes: ZProbeResult[] = [];
    for (const built of sequence) {
      const commandId = this.nextCommandId();
      try {
        const reply = await this.transmit(commandId, built);
        probes.push({
          label: built.visible,
          tx: built.visible,
          rx: reply,
          classification: reply ? classifyZLine(reply) : null,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        probes.push({ label: built.visible, tx: built.visible, rx: null, classification: null, error });
      }
    }

    const anyRx = probes.some((p) => p.rx !== null);
    const summary = anyRx
      ? `Z controller answered on ${this.portName} @ ${this.baudRate} 8N1. Inspect each probe's rx/classification.`
      : `No RX from Z controller on ${this.portName} @ ${this.baudRate} 8N1. Likely wrong port or wrong baud/framing. Check [z-rx-raw] lines.`;
    // eslint-disable-next-line no-console
    console.log(`[z-state] action=diagnose-summary anyRx=${anyRx} result=${JSON.stringify(summary)}`);
    return { ok: true, port: this.portName, baudRate: this.baudRate, anyRx, probes, summary };
  }
}

export const zAxisSerialService = new ZAxisSerialService();
export { Z_PORT_NOT_CONFIGURED };
