import { EventEmitter } from 'node:events';
import { RegexParser } from '@serialport/parser-regex';
import {
  buildGetPositionCommand,
  buildLocateCenterCommand,
  buildLockZCommand,
  buildMoveStageCommand,
  buildMoveToCenterCommand,
  buildMoveZCommand,
  buildSetXySpeedCommand,
  buildSetZSpeedCommand,
  buildStopStageCommand,
  buildStopZCommand,
  buildUnlockZCommand,
  parseXyzFrame,
  type XyzCommandKey,
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
  autoOpen?: boolean;
}) => SerialPortInstance;

type SerialPortInstance = {
  open: (cb: (err: Error | null) => void) => void;
  close: (cb?: (err: Error | null) => void) => void;
  write: (data: Buffer, cb?: (err: Error | null | undefined) => void) => boolean;
  drain: (cb?: (err: Error | null | undefined) => void) => void;
  on: (event: 'data' | 'error' | 'close', listener: (...args: unknown[]) => void) => void;
  pipe: (destination: RegexParser) => RegexParser;
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
  console.error('[xyz-serial-error] serialport module not available:', serialPortLoadError);
}

const DEFAULT_BAUD_RATE = 9600;
const TX_TIMEOUT_MS = 5000;

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

class XyzPlatformSerialService extends EventEmitter {
  private state: XyzStageState = { ...DEFAULT_STATE };
  private port: SerialPortInstance | null = null;
  private parser: RegexParser | null = null;
  private pendingResolve: ((position: XyzPosition | null) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCommandId: string | null = null;
  private commandSequence = 0;

  // Serial connection configuration. `port: null` means NOT configured — no
  // auto-open, and every command fails with "XYZ serial port not configured".
  // TODO(hardware): set the real XYZ COM port + baud once confirmed (or, if the
  // stage turns out to share the hardness-machine port, implement shared-port
  // routing — see resolveSerialRoute()).
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
   * Never opens the same COM port twice: a 'shared' port is detected here and
   * the caller refuses to open a second SerialPort on it.
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
    this.serialConfig = { port: opts.port, baudRate: opts.baudRate ?? DEFAULT_BAUD_RATE };

    const route = this.resolveSerialRoute();
    // eslint-disable-next-line no-console
    console.log(`[xyz-serial-config] mode=${route.mode} port=${route.port ?? 'none'}`);
    this.setState({ serialMode: route.mode });

    if (route.mode === 'shared') {
      const message =
        'XYZ shares the hardness-machine COM port; shared-port routing is not implemented';
      // eslint-disable-next-line no-console
      console.error(`[xyz-serial-error] ${message} port=${route.port}`);
      this.setState({ connected: false, lastError: message });
      throw new Error(message);
    }
    if (!SerialPortLib) {
      const message =
        'serialport native module not loaded' +
        (serialPortLoadError ? `: ${serialPortLoadError}` : '');
      // eslint-disable-next-line no-console
      console.error(`[xyz-serial-error] ${message}`);
      this.setState({ connected: false, lastError: message });
      throw new Error(message);
    }

    const portInstance = new SerialPortLib.SerialPort({
      path: opts.port,
      baudRate: this.serialConfig.baudRate,
      dataBits: opts.dataBits ?? 8,
      stopBits: opts.stopBits ?? 1,
      parity: opts.parity ?? 'none',
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
          console.error('[xyz-serial-error] open failed:', err.message);
          reject(err);
          return;
        }
        resolve();
      });
    });

    // Frame-level RX. Terminator regex is a placeholder until the real XYZ
    // framing is known — parseXyzFrame() treats every frame as 'unknown' so no
    // position is ever fabricated regardless of how frames split here.
    const parser = portInstance.pipe(new RegexParser({ regex: /\r\n|\r|\n/ }));
    parser.on('data', (frame: Buffer | string) => {
      const frameBuf = Buffer.isBuffer(frame) ? frame : Buffer.from(String(frame), 'ascii');
      if (frameBuf.length === 0) return;
      this.handleFrame(frameBuf);
    });
    this.parser = parser;

    portInstance.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[xyz-serial-error] port error:', message);
      this.setState({ lastError: message });
    });
    portInstance.on('close', () => {
      this.port = null;
      if (this.parser) {
        this.parser.removeAllListeners('data');
        this.parser = null;
      }
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
    return this.getState();
  }

  async disconnectStage(): Promise<XyzStageState> {
    if (this.port) {
      await new Promise<void>((resolve) => {
        this.port?.close(() => resolve());
      });
      this.port = null;
    }
    if (this.parser) {
      this.parser.removeAllListeners('data');
      this.parser = null;
    }
    this.setState({ connected: false, port: null, moving: false, lastAction: 'XYZ stage disconnected.' });
    return this.getState();
  }

  private handleFrame(rawFrame: Buffer): void {
    const ascii = rawFrame.toString('ascii');
    const commandId = this.pendingCommandId ?? 'none';
    // eslint-disable-next-line no-console
    console.log(`[xyz-rx] commandId=${commandId} response=${JSON.stringify(ascii)}`);
    const parsed = parseXyzFrame(rawFrame);
    this.setState({ lastRx: ascii });

    switch (parsed.kind) {
      case 'position': {
        const { x, y, z } = parsed.position;
        // eslint-disable-next-line no-console
        console.log(`[xyz-position] commandId=${commandId} x=${x} y=${y} z=${z}`);
        this.setState({ position: parsed.position, lastError: undefined });
        this.resolvePending(parsed.position);
        break;
      }
      case 'ack':
        this.resolvePending(null);
        break;
      case 'nak':
        this.rejectPending(new Error(parsed.message ?? 'XYZ stage NAK'));
        break;
      case 'unknown':
        // No fabricated position — leave any in-flight wait to time out so a
        // command never reports success on an unrecognised reply.
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
    if (reject) reject(err);
  }

  /** Write a frame and wait for the RX position/ack (or time out). */
  private transmitNow(commandId: string, frame: Buffer): Promise<XyzPosition | null> {
    if (!this.port || !this.state.connected) {
      return Promise.reject(new Error('XYZ_STAGE_NOT_CONNECTED'));
    }
    const ascii = frame.toString('ascii');
    // eslint-disable-next-line no-console
    console.log(`[xyz-tx] commandId=${commandId} command=${JSON.stringify(ascii)} hex=${frame.toString('hex')}`);
    this.setState({ lastTx: ascii, lastCommandId: commandId });

    const waitForRx = new Promise<XyzPosition | null>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.pendingCommandId = commandId;
      this.pendingTimer = setTimeout(() => {
        this.pendingResolve = null;
        this.pendingReject = null;
        this.pendingTimer = null;
        this.pendingCommandId = null;
        // eslint-disable-next-line no-console
        console.error(`[xyz-timeout] commandId=${commandId} command=${JSON.stringify(ascii)} timeoutMs=${TX_TIMEOUT_MS} no response within timeout`);
        reject(new Error('XYZ_STAGE_ACK_TIMEOUT'));
      }, TX_TIMEOUT_MS);
    });

    return new Promise<void>((resolve, reject) => {
      this.port?.write(frame, (err) => {
        if (err) {
          reject(err);
          return;
        }
        this.port?.drain((drainErr) => {
          if (drainErr) {
            reject(drainErr);
            return;
          }
          resolve();
        });
      });
    }).then(() => waitForRx);
  }

  /**
   * Resolve a command to a structured result with a correlation id. Returns the
   * "not configured" / "not connected" / "protocol unknown" cases as plain
   * results (no throw) so the renderer renders an honest error without a
   * coordinate ever changing. `priority` (Stop) bypasses the queue and preempts
   * a stuck in-flight wait so it works even after a timeout.
   */
  private async runCommand(
    key: XyzCommandKey,
    buildFrame: () => Buffer,
    lastAction: string,
    priority = false
  ): Promise<XyzCommandResult> {
    const commandId = this.nextCommandId();
    // eslint-disable-next-line no-console
    console.log(`[xyz-service] commandId=${commandId} key=${key} requested`);

    const route = this.resolveSerialRoute();
    // eslint-disable-next-line no-console
    console.log(`[xyz-serial-config] mode=${route.mode} port=${route.port ?? 'none'} commandId=${commandId} key=${key}`);

    if (route.mode === 'unknown') {
      const error = 'XYZ serial port not configured';
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] commandId=${commandId} error=${error}`);
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }
    if (route.mode === 'shared') {
      const error =
        'XYZ shares the hardness-machine COM port; shared-port routing is not implemented';
      // eslint-disable-next-line no-console
      console.error(`[xyz-serial-error] commandId=${commandId} ${error}`);
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }
    if (!this.state.connected) {
      const error = 'XYZ_STAGE_NOT_CONNECTED';
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] commandId=${commandId} error=${error}`);
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }

    // Build the frame — the command map THROWS when the bytes are unknown.
    let frame: Buffer;
    try {
      frame = buildFrame();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] commandId=${commandId} error=${error}`);
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
      const position = await queue.enqueue(() => this.transmitNow(commandId, frame), { priority });
      this.setState({ lastAction, lastError: undefined });
      // eslint-disable-next-line no-console
      console.log(`[xyz-status] commandId=${commandId} key=${key} confirmed`);
      return position
        ? { ok: true, position, rx: this.state.lastRx, commandId }
        : { ok: true, rx: this.state.lastRx, commandId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[xyz-error] commandId=${commandId} error=${error}`);
      // eslint-disable-next-line no-console
      console.error(`[xyz-status] commandId=${commandId} key=${key} failed: ${error}`);
      this.setState({ lastError: error });
      return { ok: false, error, commandId };
    }
  }

  /**
   * Apply a SOFTWARE-only state change (XY interlock, focus mode). These are
   * not serial commands — there is no controller to acknowledge them — so they
   * resolve immediately and honestly. No bytes touch the wire, nothing is faked
   * as a hardware reply. The service still owns the state and broadcasts it, so
   * the renderer renders it from the `state` event like every other field.
   */
  private softwareCommand(patch: Partial<XyzStageState>, lastAction: string, label: string): XyzCommandResult {
    const commandId = this.nextCommandId();
    // eslint-disable-next-line no-console
    console.log(`[xyz-service] commandId=${commandId} ${label} (software interlock)`);
    this.setState({ ...patch, lastAction, lastError: undefined });
    // eslint-disable-next-line no-console
    console.log(`[xyz-status] commandId=${commandId} ${label} confirmed`);
    return { ok: true, commandId };
  }

  // --- Public command surface (mirrors window.xyzPlatform.*) -----------------

  moveStage(direction: XyzDirection, speed: XySpeed): Promise<XyzCommandResult> {
    if (this.state.xyLocked) {
      return Promise.resolve({ ok: false, error: 'XYZ_STAGE_XY_LOCKED', commandId: this.nextCommandId() });
    }
    return this.runCommand('moveStage', () => buildMoveStageCommand(direction, speed), `Move ${direction}.`);
  }

  // XY interlock — software guard that gates moveStage server-side. No serial TX.
  lockXy(): Promise<XyzCommandResult> {
    return Promise.resolve(this.softwareCommand({ xyLocked: true }, 'X/Y platform locked.', 'xy-lock'));
  }

  unlockXy(): Promise<XyzCommandResult> {
    return Promise.resolve(this.softwareCommand({ xyLocked: false }, 'X/Y platform unlocked.', 'xy-unlock'));
  }

  // Focus mode — software state only (no focus command exists in the protocol).
  setFocusMode(focusMode: FocusMode): Promise<XyzCommandResult> {
    return Promise.resolve(
      this.softwareCommand({ focusMode }, `Focus mode ${focusMode}.`, `focus-${focusMode}`)
    );
  }

  stopStage(): Promise<XyzCommandResult> {
    return this.runCommand('stopStage', () => buildStopStageCommand(), 'Stop X/Y.', true);
  }

  moveZ(direction: ZDirection, speed: ZSpeed): Promise<XyzCommandResult> {
    if (this.state.zLocked) {
      return Promise.resolve({ ok: false, error: 'XYZ_STAGE_Z_LOCKED', commandId: this.nextCommandId() });
    }
    return this.runCommand('moveZ', () => buildMoveZCommand(direction, speed), `Move Z ${direction}.`);
  }

  stopZ(): Promise<XyzCommandResult> {
    return this.runCommand('stopZ', () => buildStopZCommand(), 'Stop Z.', true);
  }

  async lockZ(): Promise<XyzCommandResult> {
    const result = await this.runCommand('lockZ', () => buildLockZCommand(), 'Z axis locked.');
    if (result.ok) this.setState({ zLocked: true });
    return result;
  }

  async unlockZ(): Promise<XyzCommandResult> {
    const result = await this.runCommand('unlockZ', () => buildUnlockZCommand(), 'Z axis unlocked.');
    if (result.ok) this.setState({ zLocked: false });
    return result;
  }

  async setXySpeed(speed: XySpeed): Promise<XyzCommandResult> {
    const result = await this.runCommand('setXySpeed', () => buildSetXySpeedCommand(speed), `X/Y speed ${speed}.`);
    if (result.ok) this.setState({ xySpeed: speed });
    return result;
  }

  async setZSpeed(speed: ZSpeed): Promise<XyzCommandResult> {
    const result = await this.runCommand('setZSpeed', () => buildSetZSpeedCommand(speed), `Z speed ${speed}.`);
    if (result.ok) this.setState({ zSpeed: speed });
    return result;
  }

  getPosition(): Promise<XyzCommandResult> {
    return this.runCommand('getPosition', () => buildGetPositionCommand(), 'Query position.');
  }

  moveToCenter(): Promise<XyzCommandResult> {
    return this.runCommand('moveToCenter', () => buildMoveToCenterCommand(), 'Move X/Y to center.');
  }

  locateCenter(): Promise<XyzCommandResult> {
    return this.runCommand('locateCenter', () => buildLocateCenterCommand(), 'Locate center.');
  }
}

export const xyzPlatformSerialService = new XyzPlatformSerialService();
