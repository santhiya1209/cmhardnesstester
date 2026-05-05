import { EventEmitter } from 'node:events';
import {
  buildCommandForKey,
  buildStartIndentCommand,
  getCommandVerification,
  isCommandVerified,
  tryParseOneFrame,
  type MachineCommandKey,
  type MachineCommandVerification,
  type MachineControlKey,
} from './hardness-machine-protocol';

// Defensive require so the backend keeps booting even if `serialport` is not
// rebuilt for the current Node ABI yet. Connect attempts will surface a clean
// error instead of crashing the whole API server.
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
  write: (
    data: Buffer,
    cb?: (err: Error | null | undefined, bytesWritten?: number) => void
  ) => boolean;
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
  console.warn('[machine-service] serialport module not available:', serialPortLoadError);
}

export type IndentStatus = 'idle' | 'started' | 'running' | 'completed' | 'error';

export interface MachineState {
  connected: boolean;
  port: string | null;
  force: string | number;
  lightness: string | number;
  loadTime: string | number;
  objective: string;
  hardnessLevel: string;
  indentStatus: IndentStatus;
  commandVerification: MachineCommandVerification;
  lastUpdatedBy: 'pc' | 'machine' | 'system';
  lastError?: string;
  updatedAt: string;
}

export interface ConnectOptions {
  port: string;
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 1.5 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
}

const DEFAULT_STATE: MachineState = {
  connected: false,
  port: null,
  force: '0.5kgf',
  lightness: 5,
  loadTime: 5,
  objective: '10X',
  hardnessLevel: 'Middle',
  indentStatus: 'idle',
  commandVerification: getCommandVerification(),
  lastUpdatedBy: 'system',
  updatedAt: new Date().toISOString(),
};

const TX_TIMEOUT_MS = 1500;

class HardnessMachineSerialService extends EventEmitter {
  private state: MachineState = { ...DEFAULT_STATE };
  private port: SerialPortInstance | null = null;
  private rxBuffer: Buffer = Buffer.alloc(0);
  private pendingAckField: MachineCommandKey | null = null;

  getState(): MachineState {
    return { ...this.state };
  }

  isConnected(): boolean {
    return this.state.connected;
  }

  private setState(patch: Partial<MachineState>, origin: MachineState['lastUpdatedBy']): void {
    this.state = {
      ...this.state,
      ...patch,
      commandVerification: getCommandVerification(),
      lastUpdatedBy: origin,
      updatedAt: new Date().toISOString(),
    };
    this.emit('state', this.state);
    this.logUiState();
  }

  private logUiState(): void {
    // eslint-disable-next-line no-console
    console.log(
      `[machine-sync][ui-state] objective=${this.state.objective} force=${this.state.force} lightness=${this.state.lightness} loadTime=${this.state.loadTime} hardnessLevel=${this.state.hardnessLevel}`
    );
  }

  private unverifiedMessage(field: MachineCommandKey): string {
    return `RS232 command for "${field}" is not verified; writes are disabled until the official protocol bytes are supplied.`;
  }

  async connectMachine(opts: ConnectOptions): Promise<MachineState> {
    // eslint-disable-next-line no-console
    console.log('[machine-service] connect requested', opts);
    if (this.state.connected) {
      return this.getState();
    }
    if (!SerialPortLib) {
      const message =
        'serialport native module not loaded' +
        (serialPortLoadError ? `: ${serialPortLoadError}` : '');
      this.setState({ connected: false, lastError: message }, 'system');
      throw new Error(message);
    }

    const portInstance = new SerialPortLib.SerialPort({
      path: opts.port,
      baudRate: opts.baudRate ?? 9600,
      dataBits: opts.dataBits ?? 8,
      stopBits: opts.stopBits ?? 1,
      parity: opts.parity ?? 'none',
      autoOpen: false,
    });

    // eslint-disable-next-line no-console
    console.log('[machine-service] opening port', opts.port, 'baud=', opts.baudRate ?? 9600);
    await new Promise<void>((resolve, reject) => {
      const watchdog = setTimeout(() => {
        reject(new Error(`open() timed out after 5s for ${opts.port}`));
      }, 5000);
      portInstance.open((err) => {
        clearTimeout(watchdog);
        if (err) {
          // eslint-disable-next-line no-console
          console.error('[machine-service] open failed:', err.message);
          reject(err);
          return;
        }
        // eslint-disable-next-line no-console
        console.log('[machine-service] open succeeded');
        resolve();
      });
    });

    portInstance.on('data', (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) return;
      this.handleIncoming(chunk);
    });
    portInstance.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[machine-service] port error:', message);
      this.setState({ lastError: message }, 'system');
    });
    portInstance.on('close', () => {
      // eslint-disable-next-line no-console
      console.log('[machine-service] port closed');
      this.port = null;
      this.setState({ connected: false, port: null }, 'system');
    });

    this.port = portInstance;
    // eslint-disable-next-line no-console
    console.log('[machine-service] port open path=', opts.port);
    this.setState(
      { connected: true, port: opts.port, lastError: undefined, indentStatus: 'idle' },
      'system'
    );
    return this.getState();
  }

  async disconnectMachine(): Promise<MachineState> {
    // eslint-disable-next-line no-console
    console.log('[machine-service] disconnect requested');
    if (this.port) {
      await new Promise<void>((resolve) => {
        this.port?.close(() => resolve());
      });
      this.port = null;
    }
    this.setState({ connected: false, port: null, indentStatus: 'idle' }, 'system');
    return this.getState();
  }

  private handleIncoming(chunk: Buffer): void {
    // [RX] hex + ascii — verbatim so the user can match against the manual.
    // eslint-disable-next-line no-console
    console.log(
      `[machine-sync][rx] hex=${chunk.toString('hex')} ascii=${JSON.stringify(chunk.toString('ascii'))}`
    );
    this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);

    // Drain as many complete frames as the streaming parser can extract from
    // the rolling buffer. The parser tells us how many bytes it consumed; we
    // keep the unconsumed tail for the next chunk.
    let safety = 32;
    while (safety > 0) {
      safety -= 1;
      const { frame, consumed } = tryParseOneFrame(this.rxBuffer);
      if (consumed === 0) break;
      this.rxBuffer = this.rxBuffer.slice(consumed);

      // eslint-disable-next-line no-console
      console.log('[machine-service] [PARSED] kind=', frame.kind);

      switch (frame.kind) {
        case 'state-update':
          // eslint-disable-next-line no-console
          console.log(`[machine-sync][machine-update] field=${frame.key} value=${frame.value}`);
          this.setState({ [frame.key]: frame.value } as Partial<MachineState>, 'machine');
          break;
        case 'indent-status':
          // eslint-disable-next-line no-console
          console.log('[machine-service] [SYNC] indent status=', frame.status);
          this.setState(
            {
              indentStatus: frame.status,
              lastError: frame.status === 'error' ? frame.message : undefined,
            },
            'machine'
          );
          break;
        case 'ack':
          if (!this.pendingAckField) {
            // eslint-disable-next-line no-console
            console.log('[machine-sync][ack] field=unknown ok=true');
          }
          this.emit('ack');
          break;
        case 'nak':
          if (!this.pendingAckField) {
            // eslint-disable-next-line no-console
            console.log(`[machine-sync][ack] field=unknown ok=false message=${frame.message ?? 'machine NAK'}`);
          }
          this.emit('nak', frame.message ?? 'machine NAK');
          this.setState({ lastError: frame.message ?? 'machine NAK' }, 'machine');
          break;
        case 'unknown':
        default:
          break;
      }
      if (frame.kind === 'unknown') break;
    }

    // Hard-cap the rx buffer to avoid unbounded growth if the protocol is
    // misconfigured and nothing is parseable.
    if (this.rxBuffer.length > 4096) {
      // eslint-disable-next-line no-console
      console.warn('[machine-service] rx buffer overflow, discarding', this.rxBuffer.length, 'bytes');
      this.rxBuffer = Buffer.alloc(0);
    }
  }

  /**
   * Wait for the next 'ack' (resolves) or 'nak' (rejects) event from the
   * machine, with a timeout. Used by transmit() when callers need the UI to
   * commit only after the machine confirms.
   */
  private waitForAck(field: MachineCommandKey, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.off('ack', onAck);
        this.off('nak', onNak);
        if (this.pendingAckField === field) {
          this.pendingAckField = null;
        }
      };
      const onAck = () => {
        // eslint-disable-next-line no-console
        console.log(`[machine-sync][ack] field=${field} ok=true`);
        cleanup();
        resolve();
      };
      const onNak = (message: string) => {
        // eslint-disable-next-line no-console
        console.log(`[machine-sync][ack] field=${field} ok=false message=${message}`);
        cleanup();
        reject(new Error(message));
      };
      const timer = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.log(`[machine-sync][ack] field=${field} ok=false message=ack timeout`);
        cleanup();
        reject(new Error('ack timeout'));
      }, timeoutMs);
      this.pendingAckField = field;
      this.once('ack', onAck);
      this.once('nak', onNak);
    });
  }

  private async transmit(
    field: MachineCommandKey,
    frame: Buffer,
    opts: { awaitAck?: boolean } = {}
  ): Promise<void> {
    if (!this.port || !this.state.connected) {
      throw new Error('machine not connected');
    }
    // [TX] hex + ascii — full frame logged for protocol verification.
    // eslint-disable-next-line no-console
    console.log(
      `[machine-sync][tx] field=${field} hex=${frame.toString('hex')} ascii=${JSON.stringify(frame.toString('ascii'))}`
    );

    // Pre-arm ack listener BEFORE the write completes — some machines reply
    // before the write callback fires.
    const ackPromise = opts.awaitAck ? this.waitForAck(field, TX_TIMEOUT_MS) : null;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('tx timeout'));
      }, TX_TIMEOUT_MS);
      this.port?.write(frame, (err) => {
        clearTimeout(timer);
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    if (ackPromise) {
      await ackPromise;
    }
  }

  async setControlValue(key: MachineControlKey, value: string | number): Promise<MachineState> {
    // eslint-disable-next-line no-console
    console.log('[machine-service] set value requested', key, value);
    // eslint-disable-next-line no-console
    console.log(`[machine-sync][ui-change] field=${key} value=${value}`);

    if (!this.state.connected) {
      const message = 'machine not connected';
      this.setState({ lastError: message }, 'system');
      throw new Error(message);
    }

    if (!isCommandVerified(key)) {
      const message = this.unverifiedMessage(key);
      // eslint-disable-next-line no-console
      console.warn(`[machine-sync][tx-blocked] field=${key} verified=false reason=${message}`);
      this.setState({ lastError: message }, 'system');
      throw new Error(message);
    }

    const frame = buildCommandForKey(key, value);
    if (!frame) {
      const message = this.unverifiedMessage(key);
      // eslint-disable-next-line no-console
      console.warn(`[machine-sync][tx-blocked] field=${key} verified=false reason=${message}`);
      this.setState({ lastError: message }, 'system');
      throw new Error(message);
    }

    try {
      await this.transmit(key, frame, { awaitAck: true });
      this.setState(
        { [key]: value, lastError: undefined } as Partial<MachineState>,
        'pc'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ lastError: message }, 'system');
      throw err;
    }
    return this.getState();
  }

  async startIndent(): Promise<MachineState> {
    // eslint-disable-next-line no-console
    console.log('[machine-service] indent requested');
    if (!this.state.connected) {
      throw new Error('machine not connected');
    }
    if (this.state.indentStatus === 'started' || this.state.indentStatus === 'running') {
      // eslint-disable-next-line no-console
      console.warn('[machine-service] indent already in progress — ignoring duplicate');
      return this.getState();
    }
    if (!isCommandVerified('indent')) {
      const message = this.unverifiedMessage('indent');
      // eslint-disable-next-line no-console
      console.warn(`[machine-sync][tx-blocked] field=indent verified=false reason=${message}`);
      this.setState({ lastError: message }, 'system');
      throw new Error(message);
    }
    const frame = buildStartIndentCommand();
    if (!frame) {
      const message = this.unverifiedMessage('indent');
      // eslint-disable-next-line no-console
      console.warn(`[machine-sync][tx-blocked] field=indent verified=false reason=${message}`);
      this.setState({ lastError: message }, 'system');
      throw new Error(message);
    }
    try {
      // Indent triggers physical motion — wait for the machine's ACK before
      // the UI commits to "running". A NAK or timeout flips status to error.
      await this.transmit('indent', frame, { awaitAck: true });
      this.setState({ indentStatus: 'running', lastError: undefined }, 'pc');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ indentStatus: 'error', lastError: message }, 'system');
      throw err;
    }
    return this.getState();
  }
}

export const hardnessMachineSerialService = new HardnessMachineSerialService();
