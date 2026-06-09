import { EventEmitter } from 'node:events';
import { getSerialQueue } from './serial-command-queue';
import { hardnessMachineSerialService } from './hardness-machine-serial.service';
import {
  buildJogZCommand,
  buildLockZCommand,
  buildMoveZCommand,
  buildPollZStatusCommand,
  buildSetZSpeedCommand,
  buildUnlockZCommand,
  parseZReply,
  replyMatchesExpect,
  type ParsedZReply,
  type ZBuiltCommand,
} from './z-axis-protocol';

// DEDICATED Z-axis serial connection. INDEPENDENT of the X/Y stage port and the
// hardness-machine port: its own SerialPort instance, its own per-port command
// queue (mutex), its own RX framing. The X/Y service (xyz-platform-serial.service)
// delegates every Z action here and merges the resulting Z state into the single
// state broadcast the UI consumes — but the serial connection lives only here.
//
// Hardware truth only: UI/state changes are driven from real TX/RX. No optimistic
// updates, no simulated motion, no fabricated replies. See z-axis-protocol.ts for
// the (legacy-sourced, NEEDS-HARDWARE-VERIFICATION) frame/reply definitions.

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

// Z line settings come from the legacy software: 57600 8N1, no flow control. This
// is the DEFAULT only — the actual value is parameterizable per connect() call.
const Z_DEFAULT_BAUD = 57600;
const Z_TX_TIMEOUT_MS = 5000;
// Backend safety watchdog: if no stopZJog arrives within this window after a jog
// starts (release event missed / IPC dropped), the service runs the stop itself.
const Z_JOG_WATCHDOG_MS = 10_000;
// Conservative Z jog stop. The legacy docs do NOT clearly define a stop command.
// Strategy: first POLL (#sss#) to read live status, then perform the stop action,
// then POLL again to confirm. 'toggle' re-sends the same jog command (#+S#/#-S#)
// to toggle motion off. We NEVER report stop success without a real STOP/IDLE
// status RX; every step is logged so the true behaviour can be confirmed on
// hardware (TODO hardware: replace with the verified stop command once known).
const Z_JOG_STOP_STRATEGY: 'toggle' | 'poll-only' = 'toggle';

export type ZCommandResult =
  | { ok: true; reply?: string; status?: string; commandId: string }
  | { ok: false; error: string; message?: string; commandId?: string };

export interface ZServiceState {
  connected: boolean;
  port: string | null;
  locked: boolean;
  moving: boolean;
  /** Last status word seen (UP/DOWN/STOP/IDLE/...), or null. */
  status: string | null;
  lastTx: string | null;
  lastRx: string | null;
  lastError: string | null;
}

/** One probe outcome for diagnoseZ — exact TX and whatever (if anything) came back. */
export interface ZProbeResult {
  label: string;
  tx: string;
  rx: string | null;
  classification: ParsedZReply['kind'] | null;
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

class ZAxisSerialService extends EventEmitter {
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

  // Single in-flight waiter (the per-port queue guarantees one command at a time).
  private pending: {
    resolve: (reply: ParsedZReply | null) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    built: ZBuiltCommand;
    commandId: string;
  } | null = null;

  // True between a startJog TX and its stopZJog. The jog command is fire-and-forget
  // (continuous motion, no reply) so mid-jog status frames arrive UNSOLICITED — they
  // update `status` for diagnostics but never resolve a command.
  private jogActive = false;
  private jogSign: '+' | '-' | null = null;
  private jogWatchdog: ReturnType<typeof setTimeout> | null = null;

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

  // --- Connection ------------------------------------------------------------

  async connect(opts: ConnectZOptions): Promise<ZServiceState> {
    if (this.connected) return this.getZState();

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
      this.clearJogWatchdog();
      this.jogActive = false;
      this.jogSign = null;
      this.moving = false;
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
    // If a jog is active, attempt a safe stop BEFORE tearing down the port.
    if (this.jogActive && this.connected) {
      // eslint-disable-next-line no-console
      console.log('[z-close] phase=safe-stop-before-disconnect');
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
    this.clearJogWatchdog();
    this.jogActive = false;
    this.jogSign = null;
    this.moving = false;
    this.connected = false;
    // eslint-disable-next-line no-console
    console.log(`[z-close] port=${this.portName}`);
    this.portName = null;
    return this.getZState();
  }

  // --- RX framing (line-based; replies are CRLF-terminated ASCII words) -------

  private drainRxLines(): void {
    // Split on CR, LF, or CRLF; keep the trailing partial line in the buffer.
    const parts = this.rxBuffer.split(/\r\n|\r|\n/);
    this.rxBuffer = parts.pop() ?? '';
    for (const line of parts) {
      if (line.trim().length === 0) continue;
      const parsed = parseZReply(line);
      this.lastRx = parsed.raw;
      // eslint-disable-next-line no-console
      console.log(`[z-rx-frame] kind=${parsed.kind} raw=${JSON.stringify(parsed.raw)}`);
      if (parsed.kind === 'status') {
        this.status = parsed.token;
        // eslint-disable-next-line no-console
        console.log(`[z-status] token=${parsed.token} pending=${this.pending?.commandId ?? 'none'} jogActive=${this.jogActive}`);
      } else if (parsed.kind === 'ack') {
        // eslint-disable-next-line no-console
        console.log(`[z-ack] token=${parsed.token} pending=${this.pending?.commandId ?? 'none'}`);
      } else if (parsed.kind === 'unknown') {
        // eslint-disable-next-line no-console
        console.warn(`[z-rx-frame] kind=unknown raw=${JSON.stringify(parsed.raw)} note=logged-not-ignored`);
      }
      this.handleParsedForPending(parsed);
    }
  }

  private handleParsedForPending(parsed: ParsedZReply): void {
    const pending = this.pending;
    if (!pending) return;
    const { built } = pending;
    if (parsed.kind === 'error') {
      this.resolvePending(null, new Error('Z_STAGE_PROTOCOL_ERROR'));
      return;
    }
    if (replyMatchesExpect(parsed, built.expect, built.ackToken)) {
      this.resolvePending(parsed, null);
      return;
    }
    // A non-matching reply (e.g. unknown, or a status while waiting for an ACK) is
    // logged above and intentionally NOT resolved — we wait for the expected reply
    // or the timeout. Never resolve on the wrong reply (no fake success).
  }

  private resolvePending(reply: ParsedZReply | null, err: Error | null): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    if (err) pending.reject(err);
    else pending.resolve(reply);
  }

  // --- Low-level send --------------------------------------------------------

  /**
   * Send a command and wait for its expected reply (ACK/status). For `expect:
   * 'none'` (jog) it resolves after the OS accepts the bytes (drain) — there is
   * no reply to wait for. Times out safely, always releasing the queue lock and
   * clearing the pending waiter. Returns the matched parsed reply (or null for
   * fire-and-forget).
   */
  private async transmit(commandId: string, built: ZBuiltCommand): Promise<ParsedZReply | null> {
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
        new Promise<ParsedZReply | null>((resolve, reject) => {
          // Write, then either resolve (no reply expected) or arm the RX waiter.
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
              if (built.expect === 'none') {
                resolve(null);
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

  /** Run a reply-expecting command and map the outcome to a ZCommandResult. */
  private async runCommand(built: ZBuiltCommand, lastAction: string): Promise<ZCommandResult> {
    const commandId = this.nextCommandId();
    if (!this.connected) {
      this.lastError = 'XYZ_Z_NOT_CONNECTED';
      return { ok: false, error: 'XYZ_Z_NOT_CONNECTED', commandId };
    }
    try {
      const reply = await this.transmit(commandId, built);
      this.lastError = null;
      // eslint-disable-next-line no-console
      console.log(`[z-ack] commandId=${commandId} action=${JSON.stringify(lastAction)} status=confirmed reply=${JSON.stringify(reply?.raw ?? null)}`);
      const status = reply && reply.kind === 'status' ? reply.token : undefined;
      return { ok: true, reply: reply?.raw, status, commandId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.lastError = error;
      // eslint-disable-next-line no-console
      console.error(`[z-error] commandId=${commandId} action=${JSON.stringify(lastAction)} error=${JSON.stringify(error)}`);
      return { ok: false, error, commandId };
    }
  }

  // --- Public Z command surface ----------------------------------------------

  async lock(): Promise<ZCommandResult> {
    const result = await this.runCommand(buildLockZCommand(), 'Z lock (#LK#).');
    if (result.ok) this.locked = true; // confirmed only by the OK_LK ACK
    return result;
  }

  async unlock(): Promise<ZCommandResult> {
    const result = await this.runCommand(buildUnlockZCommand(), 'Z unlock (#LS#).');
    if (result.ok) this.locked = false; // confirmed only by the OK_LS ACK
    return result;
  }

  /** Set Z final speed. `registerValue` is the controller speed register units. */
  async setSpeed(registerValue: number): Promise<ZCommandResult> {
    return this.runCommand(buildSetZSpeedCommand(registerValue), `Z set speed #VZ${registerValue}#.`);
  }

  /**
   * Single relative step. `sign` is the PHYSICAL direction (already reverse-
   * resolved by the caller); `pulses` is the magnitude. RX-gated on a status
   * reply — position/state changes only from a real RX.
   */
  async moveStep(sign: '+' | '-', pulses: number): Promise<ZCommandResult> {
    if (this.jogActive || this.moving) {
      return { ok: false, error: 'XYZ_Z_BUSY', commandId: this.nextCommandId() };
    }
    return this.runCommand(buildMoveZCommand(sign, pulses), `Z step ${sign}${pulses}.`);
  }

  /**
   * Start a continuous press-and-hold jog. The jog command (#+S#/#-S#) is sent
   * FIRE-AND-FORGET (no reply); `moving` is set true ONLY after the OS accepts the
   * TX. A safety watchdog fires stopJog if the release is missed.
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
    const commandId = this.nextCommandId();
    try {
      await this.transmit(commandId, buildJogZCommand(sign));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.lastError = error;
      // eslint-disable-next-line no-console
      console.error(`[z-error] commandId=${commandId} action=startJog error=${JSON.stringify(error)}`);
      return { ok: false, error, commandId };
    }
    this.jogActive = true;
    this.jogSign = sign;
    this.moving = true;
    this.lastError = null;
    this.armJogWatchdog();
    // eslint-disable-next-line no-console
    console.log(`[z-status] action=jog-start sign=${sign} commandId=${commandId} moving=true`);
    return { ok: true, commandId };
  }

  /**
   * Stop a press-and-hold jog. CONSERVATIVE: poll status (#sss#), perform the
   * configured stop action, then poll again to read the resulting status. `moving`
   * is set from the REAL final status — STOP/IDLE clears it; if the controller
   * still reports motion (UP/DOWN) or never answers, we keep moving=true and
   * surface an honest "stop not confirmed" rather than faking success.
   */
  async stopJog(): Promise<ZCommandResult> {
    const commandId = this.nextCommandId();
    if (!this.connected) {
      this.clearJogWatchdog();
      this.jogActive = false;
      this.jogSign = null;
      this.moving = false;
      return { ok: false, error: 'XYZ_Z_NOT_CONNECTED', commandId };
    }
    this.clearJogWatchdog();
    const sign = this.jogSign;
    // eslint-disable-next-line no-console
    console.log(`[z-status] action=jog-stop strategy=${Z_JOG_STOP_STRATEGY} sign=${sign ?? 'none'} commandId=${commandId}`);

    // 1) Poll current status (diagnostic — what is the controller doing now?).
    const pollBefore = await this.runCommand(buildPollZStatusCommand(), 'Z stop: poll status (before).');

    // 2) Perform the stop action.
    if (Z_JOG_STOP_STRATEGY === 'toggle' && sign) {
      // eslint-disable-next-line no-console
      console.log(`[z-tx] action=jog-stop-toggle resend=#${sign}S#`);
      try {
        await this.transmit(this.nextCommandId(), buildJogZCommand(sign));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[z-error] action=jog-stop-toggle error=${JSON.stringify(err instanceof Error ? err.message : String(err))}`);
      }
    }

    // 3) Poll again to read the resulting status.
    const pollAfter = await this.runCommand(buildPollZStatusCommand(), 'Z stop: poll status (after).');

    this.jogActive = false;
    this.jogSign = null;

    const finalStatus = pollAfter.ok ? pollAfter.status : undefined;
    const stopped = finalStatus === 'STOP' || finalStatus === 'IDLE';
    // Reflect REAL status only: STOP/IDLE → stopped; UP/DOWN → still moving;
    // unknown/no-reply → leave `moving` as-is (we honestly don't know).
    if (stopped) this.moving = false;
    else if (finalStatus === 'UP' || finalStatus === 'DOWN') this.moving = true;

    if (stopped) {
      // eslint-disable-next-line no-console
      console.log(`[z-status] action=jog-stop result=confirmed-stopped status=${finalStatus} commandId=${commandId}`);
      this.lastError = null;
      return { ok: true, status: finalStatus, commandId };
    }
    // Not confirmed: do not pretend success. Surface honestly; diagnostics above
    // show poll-before/after so the real stop behaviour can be identified.
    const message = 'Z jog stop not confirmed by status reply';
    this.lastError = message;
    // eslint-disable-next-line no-console
    console.warn(`[z-status] action=jog-stop result=unconfirmed before=${JSON.stringify(pollBefore.ok ? pollBefore.status ?? pollBefore.reply : pollBefore.error)} after=${JSON.stringify(pollAfter.ok ? pollAfter.status ?? pollAfter.reply : pollAfter.error)} moving=${this.moving} commandId=${commandId}`);
    return { ok: false, error: 'XYZ_Z_STOP_UNCONFIRMED', message, commandId };
  }

  async pollStatus(): Promise<ZCommandResult> {
    const result = await this.runCommand(buildPollZStatusCommand(), 'Z poll status (#sss#).');
    return result;
  }

  private armJogWatchdog(): void {
    this.clearJogWatchdog();
    this.jogWatchdog = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn(`[z-status] action=jog-watchdog fired afterMs=${Z_JOG_WATCHDOG_MS} note=auto-stop`);
      void this.stopJog();
    }, Z_JOG_WATCHDOG_MS);
  }

  private clearJogWatchdog(): void {
    if (this.jogWatchdog) {
      clearTimeout(this.jogWatchdog);
      this.jogWatchdog = null;
    }
  }

  // --- Diagnostics -----------------------------------------------------------

  /**
   * Send the legacy Z command sequence and report exactly what (if anything) the
   * controller replies with. By default sends only the non-continuous commands
   * (#LK#, #LS#, #VZ#, #+Z 15#, #-Z 15#, #sss#); the continuous jog probes
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
      buildLockZCommand(),
      buildUnlockZCommand(),
      buildSetZSpeedCommand(speedValue),
      buildMoveZCommand('+', 15),
      buildMoveZCommand('-', 15),
      buildPollZStatusCommand(),
    ];
    if (opts?.includeJog) {
      sequence.push(buildJogZCommand('+'), buildJogZCommand('-'));
    }

    // eslint-disable-next-line no-console
    console.log(`[z-status] action=diagnose port=${this.portName} baudRate=${this.baudRate} includeJog=${!!opts?.includeJog}`);

    const probes: ZProbeResult[] = [];
    for (const built of sequence) {
      const commandId = this.nextCommandId();
      try {
        const reply = await this.transmit(commandId, built);
        probes.push({
          label: built.visible,
          tx: built.visible,
          rx: reply?.raw ?? (built.expect === 'none' ? '(no reply expected)' : null),
          classification: reply?.kind ?? null,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        probes.push({ label: built.visible, tx: built.visible, rx: null, classification: null, error });
      }
    }

    const anyRx = probes.some((p) => p.rx !== null && p.rx !== '(no reply expected)');
    const summary = anyRx
      ? `Z controller answered on ${this.portName} @ ${this.baudRate} 8N1. Inspect each probe's rx/classification to confirm the legacy command mapping.`
      : `No RX from Z controller on ${this.portName} @ ${this.baudRate} 8N1. Likely wrong port, wrong baud/framing, or the legacy command set differs. Check [z-rx-raw] lines.`;
    // eslint-disable-next-line no-console
    console.log(`[z-status] action=diagnose-summary anyRx=${anyRx} result=${JSON.stringify(summary)}`);
    return { ok: true, port: this.portName, baudRate: this.baudRate, anyRx, probes, summary };
  }
}

export const zAxisSerialService = new ZAxisSerialService();
export { Z_PORT_NOT_CONFIGURED };
