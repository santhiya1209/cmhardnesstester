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
// REPEATED #+S#/#-S# frames (each gated on a real SOK).
//
// STOP IS UNRESOLVED (hardware-verified): "#SSS# -> ERROR" repeats consistently, so
// #SSS# is NOT a stop command. There is no verified stop frame. Until one is found,
// stop is handled by the diagnostic toggle-same-command strategy: re-send the exact
// active jog frame (#+S#/#-S#) and observe. A reply only proves the frame was
// accepted, NOT that the stage halted — so stop is never reported as confirmed and
// moving is never cleared on a PLC ERROR.

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
// Short ACK window for NON-motion commands (lock/unlock/jog/status/speed): the
// controller answers these within a few hundred ms.
const Z_TX_TIMEOUT_MS = 5000;
// Motion (moveZ #+Z n# / #-Z n#) emits its completion frame (>Z:) only when the
// physical step FINISHES, which can exceed the 5s ACK window — the controller has
// been observed replying >Z: after 5s, landing as a stale "pending=none" line once
// the short timeout already fired. A single bounded Z step gets this longer ceiling
// so a slow-but-normal move is never falsely timed out. Bounded (not infinite) so a
// stage that never completes still fails honestly. No retry, no poll, no fake done.
const Z_MOVE_TIMEOUT_MS = 30000;
// Continuous-jog repeat cadence. The old software re-sends the jog frame while the
// button is held; we mirror that, each frame gated on a real SOK reply.
const Z_JOG_REPEAT_MS = 150;
// Backend safety watchdog: if no stopJog arrives within this window after a jog
// starts (release event missed / IPC dropped), the service runs the stop itself.
const Z_JOG_WATCHDOG_MS = 10_000;
// Candidate stop payloads for diagnoseStop() — used to find the real stop command
// on hardware. #SSS# is included ONLY so the probe can re-confirm it returns ERROR;
// it is NOT used as a stop command anywhere in the jog path.
const Z_STOP_PROBE_CANDIDATES = ['SSS', 'S', 'STOP', 'ST', 'UP'];
// How a jog stop is attempted while the real stop command is unknown:
//  - 'toggle-same-command' (default): re-send the exact active jog frame (#+S#/#-S#)
//    and observe whether the controller treats a second identical jog as a stop.
//  - 'poll-only': send NO motion frame; just stop the repeat loop and poll #sss#.
// Neither can CONFIRM a halt yet — both are hardware-discovery strategies.
export type ZStopStrategy = 'toggle-same-command' | 'poll-only';
const Z_DEFAULT_STOP_STRATEGY: ZStopStrategy = 'toggle-same-command';

/** Result of the diagnostic stop sequence (window.xyzPlatform.diagnoseStopZ()). */
export interface ZStopDiagnosis {
  strategy: ZStopStrategy;
  /** The jog frame used to start motion, e.g. "#+S#". */
  startCommand: string;
  /** The frame sent to attempt the stop (toggle: same jog frame; poll-only: "#sss#"). */
  stopCommand: string;
  /** Raw RX to the stop attempt (the SOK/ERROR line, or null on timeout). */
  stopReply: string | null;
  /** Raw RX to the trailing #sss# status poll, or null. */
  finalStatus: string | null;
  /**
   * Whether the stage is CONFIRMED stopped. Always false for now — no verified stop
   * token exists, so a halt cannot be proven from any reply. Captured replies are
   * for human/hardware analysis, never an optimistic success.
   */
  stopped: boolean;
}

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
  // Jog-stop strategy while the verified stop command is unknown (see ZStopStrategy).
  private stopStrategy: ZStopStrategy = Z_DEFAULT_STOP_STRATEGY;
  // The exact jog frame (#+S#/#-S#) of the jog currently in flight, captured on
  // startJog so the toggle-same-command stop can re-send the SAME frame. null when
  // no jog is active.
  private activeJogCommand: ZBuiltCommand | null = null;

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

  /** Select the jog-stop discovery strategy (default 'toggle-same-command'). */
  setStopStrategy(strategy: ZStopStrategy): void {
    this.stopStrategy = strategy;
    // eslint-disable-next-line no-console
    console.log(`[z-stop-test] action=set-strategy strategy=${strategy}`);
  }

  getStopStrategy(): ZStopStrategy {
    return this.stopStrategy;
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
      // If the port dies mid-jog, the close itself ceases all jog frames — this is
      // the de-facto emergency stop for a focus jog. Surface it as such.
      const wasJogging = this.jogActive;
      this.port = null;
      this.rxBuffer = '';
      this.clearJogTimer();
      this.clearJogWatchdog();
      this.jogActive = false;
      this.setMoving(false);
      this.connected = false;
      if (wasJogging) {
        // eslint-disable-next-line no-console
        console.error('[ZFOCUS] Communication Lost');
        // eslint-disable-next-line no-console
        console.error('[ZFOCUS] Emergency Motion Stop Executed');
      }
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
    // If a jog is active, attempt the stop (toggle strategy) BEFORE tearing down the
    // port. The stop is unverified, so this is best-effort — the port close below is
    // the hard backstop that ceases all jog frames regardless.
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
  private async transmit(commandId: string, built: ZBuiltCommand, timeoutMs: number = Z_TX_TIMEOUT_MS): Promise<string> {
    if (!this.port || !this.connected) {
      throw new Error('XYZ_Z_NOT_CONNECTED');
    }
    const hex = hexSpaced(built.frame);
    this.lastTx = built.visible;
    // eslint-disable-next-line no-console
    console.log(`[z-tx] commandId=${commandId} key=${built.key} visible=${JSON.stringify(built.visible)} hex=${JSON.stringify(hex)} expect=${built.expect} timeoutMs=${timeoutMs}`);

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
                console.error(`[z-timeout] commandId=${commandId} key=${built.key} expect=${built.expect} afterMs=${timeoutMs}`);
                this.resolvePending(null, new Error('XYZ_Z_TIMEOUT'));
              }, timeoutMs);
              this.pending = { resolve, reject, timer, built, commandId };
            });
          });
        })
    );
  }

  /** Run a reply-gated command and map the outcome to a ZCommandResult. The
   *  timeout defaults to the short Z_TX_TIMEOUT_MS (jog/lock/unlock/status/speed);
   *  motion (moveZ) passes the longer Z_MOVE_TIMEOUT_MS for physical travel. */
  private async runCommand(built: ZBuiltCommand, action: string, timeoutMs: number = Z_TX_TIMEOUT_MS): Promise<ZCommandResult> {
    const commandId = this.nextCommandId();
    if (!this.connected) {
      this.lastError = 'XYZ_Z_NOT_CONNECTED';
      return { ok: false, error: 'XYZ_Z_NOT_CONNECTED', commandId };
    }
    try {
      const reply = await this.transmit(commandId, built, timeoutMs);
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
      // moveZ waits for the physical step's >Z: completion, which can arrive after
      // the short ACK window — use the longer motion ceiling so a normal move isn't
      // timed out before the controller replies.
      return await this.runCommand(buildZMoveCommand(sign, pulses), `Z step ${sign}Z ${pulses}.`, Z_MOVE_TIMEOUT_MS);
    } finally {
      this.setMoving(false);
    }
  }

  /**
   * Start a continuous press-and-hold jog. Sends the jog frame (#+S#/#-S#) and
   * waits for the real SOK; only then is `moving` set true and the 150 ms repeat
   * loop scheduled. A safety watchdog fires stopJog if the release is missed.
   */
  async startJog(sign: '+' | '-'): Promise<ZCommandResult> {
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
    // Remember the EXACT jog frame so the toggle stop can re-send the same command.
    this.activeJogCommand = built;
    // eslint-disable-next-line no-console
    console.log(`[z-jog-start] sign=${sign} visible=${JSON.stringify(built.visible)} repeatMs=${this.jogRepeatMs}`);
    const first = await this.runCommand(built, `Z jog start ${built.visible}.`);
    if (!first.ok) {
      this.jogActive = false;
      this.activeJogCommand = null;
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
   * Stop a press-and-hold jog. ALWAYS cancels the repeat loop immediately (no more
   * jog frames are scheduled). The actual stop is UNRESOLVED in the protocol —
   * #SSS# is rejected with ERROR — so we apply the configured discovery strategy:
   *
   *  - 'toggle-same-command' (default): re-send the EXACT active jog frame
   *    (#+S#/#-S#) and observe. A SOK reply only proves the frame was accepted, not
   *    that the stage halted, so we never claim a confirmed stop.
   *  - 'poll-only': send NO motion frame; just poll #sss# and report status.
   *
   * HARDWARE TRUTH: on a PLC ERROR (or no active jog) we do NOT clear `moving` —
   * backend state must reflect that the stop is unconfirmed (no fake success). On a
   * SOK reply to the toggle we clear `moving` because the repeat loop has ceased and
   * the controller accepted the frame; the unverified physical halt is logged via
   * [z-stop-test] for hardware confirmation.
   */
  async stopJog(): Promise<ZCommandResult> {
    const commandId = this.nextCommandId();
    const wasJogging = this.jogActive;
    const active = this.activeJogCommand;
    // Stop the loop from scheduling further frames before anything else.
    this.jogActive = false;
    this.clearJogTimer();
    this.clearJogWatchdog();
    if (!this.connected) {
      this.setMoving(false);
      this.activeJogCommand = null;
      return { ok: false, error: 'XYZ_Z_NOT_CONNECTED', commandId };
    }

    // POLL-ONLY, or nothing to toggle: send NO motion frame, just read status. We
    // cannot confirm a halt, so surface it honestly without clearing `moving`.
    if (this.stopStrategy === 'poll-only' || !active) {
      const poll = await this.runCommand(buildPollZStatusCommand(), 'Z stop poll (#sss#).');
      const rx = poll.ok ? (poll.reply ?? null) : (poll.error ?? null);
      // eslint-disable-next-line no-console
      console.log(
        `[z-stop-test] strategy=${this.stopStrategy} start=${JSON.stringify(active?.visible ?? null)} stop="#sss#" stopReply=${JSON.stringify(rx)} wasJogging=${wasJogging} note=stop-unconfirmed`
      );
      this.activeJogCommand = null;
      this.lastError = 'Z stop command is unverified; motion stop not confirmed by hardware.';
      return { ok: false, error: 'XYZ_Z_STOP_UNRESOLVED', message: this.lastError, commandId };
    }

    // TOGGLE-SAME-COMMAND: re-send the EXACT active jog frame and observe.
    // eslint-disable-next-line no-console
    console.log(
      `[z-stop-test] strategy=toggle-same-command start=${JSON.stringify(active.visible)} stop=${JSON.stringify(active.visible)} wasJogging=${wasJogging}`
    );
    const result = await this.runCommand(active, `Z stop test (re-send ${active.visible}).`);
    const rx = result.ok ? (result.reply ?? null) : (result.error ?? null);
    // eslint-disable-next-line no-console
    console.log(`[z-stop-test] strategy=toggle-same-command stop=${JSON.stringify(active.visible)} stopReply=${JSON.stringify(rx)}`);
    this.activeJogCommand = null;

    if (!result.ok) {
      // A real PLC ERROR (or timeout) — stop is NOT confirmed. Per hardware-truth,
      // do NOT clear `moving`: the stage may still be moving. A lock/loosen forces a
      // known-idle state when the operator needs to recover.
      this.lastError =
        result.error === 'Z_STAGE_PROTOCOL_ERROR'
          ? 'Z stop toggle returned ERROR from PLC — stop not confirmed.'
          : (result.message ?? result.error);
      // eslint-disable-next-line no-console
      console.warn(`[z-stop-test] strategy=toggle-same-command result=failed error=${JSON.stringify(result.error)} moving=unchanged commandId=${commandId}`);
      return { ok: false, error: result.error, message: this.lastError, commandId };
    }
    // SOK reply: frame accepted and the repeat loop has ceased. The physical halt is
    // still unverified (logged above) but the backend is no longer driving motion.
    this.setMoving(false);
    return { ok: true, reply: result.reply, commandId };
  }

  /**
   * Diagnostic stop sequence for hardware discovery (window.xyzPlatform.diagnoseStopZ()):
   * start a jog, let it run ~2s, attempt the configured stop strategy, capture the
   * raw RX, then poll #sss# for the final status. Returns every observed reply so
   * the real stop protocol can be identified. NEVER claims `stopped` — there is no
   * verified stop token, and this sequence DOES cause real motion (the stage may
   * still be moving when it returns; the operator must physically confirm).
   */
  async diagnoseStopStrategy(sign: '+' | '-' = '+'): Promise<ZStopDiagnosis> {
    const strategy = this.stopStrategy;
    const startCmd = buildZJogCommand(sign);
    const startCommand = startCmd.visible;
    if (!this.connected) {
      // eslint-disable-next-line no-console
      console.error(`[z-stop-test] phase=abort error=XYZ_Z_NOT_CONNECTED`);
      return { strategy, startCommand, stopCommand: '', stopReply: null, finalStatus: null, stopped: false };
    }
    // eslint-disable-next-line no-console
    console.warn(`[z-stop-test] phase=start strategy=${strategy} start=${JSON.stringify(startCommand)} note=causes-real-motion`);
    const start = await this.runCommand(startCmd, `Z stop-test jog start ${startCommand}.`);
    // eslint-disable-next-line no-console
    console.log(`[z-stop-test] phase=start-reply rx=${JSON.stringify(start.ok ? start.reply : start.error)}`);

    // Let the jog run so a stop has something to act on.
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));

    let stopCommand: string;
    let stopResult: ZCommandResult;
    if (strategy === 'poll-only') {
      const poll = buildPollZStatusCommand();
      stopCommand = poll.visible;
      stopResult = await this.runCommand(poll, `Z stop-test poll ${poll.visible}.`);
    } else {
      stopCommand = startCommand;
      // eslint-disable-next-line no-console
      console.log(`[z-stop-test] phase=stop strategy=${strategy} stop=${JSON.stringify(stopCommand)}`);
      stopResult = await this.runCommand(buildZJogCommand(sign), `Z stop-test re-send ${stopCommand}.`);
    }
    const stopReply = stopResult.ok ? (stopResult.reply ?? null) : (stopResult.error ?? null);
    // eslint-disable-next-line no-console
    console.log(`[z-stop-test] phase=stop-reply strategy=${strategy} stop=${JSON.stringify(stopCommand)} rx=${JSON.stringify(stopReply)}`);

    // Trailing status poll (#sss#) to capture whatever the controller reports.
    const pollCmd = buildPollZStatusCommand();
    const poll = await this.runCommand(pollCmd, `Z stop-test final poll ${pollCmd.visible}.`);
    const finalStatus = poll.ok ? (poll.reply ?? null) : (poll.error ?? null);
    // No verified stop token exists, so a halt cannot be proven — always false.
    const stopped = false;
    // eslint-disable-next-line no-console
    console.log(
      `[z-stop-test] strategy=${strategy} start=${JSON.stringify(startCommand)} stop=${JSON.stringify(stopCommand)} stopReply=${JSON.stringify(stopReply)} finalStatus=${JSON.stringify(finalStatus)} stopped=${stopped} note=stop-unconfirmed-hardware-discovery`
    );
    return { strategy, startCommand, stopCommand, stopReply, finalStatus, stopped };
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
   * (#LK#, #LS#, #VZ <r>#, #+Z 15#, #-Z 15#, #sss# status poll); the continuous jog
   * probes (#+S#/#-S#) run ONLY when includeJog is explicitly true (they cause motion).
   */
  async diagnose(opts?: { includeJog?: boolean; speedRegisterValue?: number }): Promise<ZDiagnoseResult> {
    if (!this.connected || !this.portName) {
      const summary = `Z not connected — configure the Z port and connect first. (${Z_PORT_NOT_CONFIGURED} if unset.)`;
      // eslint-disable-next-line no-console
      console.error(`[z-error] action=diagnose error=${JSON.stringify(summary)}`);
      return { ok: false, error: 'XYZ_Z_NOT_CONNECTED', port: this.portName, baudRate: this.connected ? this.baudRate : null, anyRx: false, probes: [], summary };
    }
    const speedValue = opts?.speedRegisterValue ?? 1000;
    // Verify sequence: #LK#, #LS#, #VZ1000#, #+Z 15#, #-Z 15#, #sss# (poll). The
    // poll (#sss#) — NOT the stop (#SSS#) — is the safe last probe for diagnostics.
    const sequence: ZBuiltCommand[] = [
      buildZLockCommand(),
      buildZLoosenCommand(),
      buildZSetSpeedCommand(speedValue),
      buildZMoveCommand('+', 15),
      buildZMoveCommand('-', 15),
      buildPollZStatusCommand(),
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
