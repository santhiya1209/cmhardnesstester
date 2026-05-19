import { EventEmitter } from 'node:events';
import {
  buildCommandForKey,
  buildStartIndentCommand,
  buildTurretCommand,
  getCommandVerification,
  getTurretCommandKey,
  getTurretSlotForDirection,
  isCommandVerified,
  tryParseOneFrame,
  type MachineCommandKey,
  type MachineCommandVerification,
  type MachineControlKey,
  type TurretDirection,
} from './hardness-machine-protocol';
import { machineSettingsService } from './machine-settings.service';
import type { MachineSettingsPayload } from '../../models/machine-settings';
import { autoMeasureSettingsService } from './auto-measure-settings.service';

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
  drain: (cb?: (err: Error | null | undefined) => void) => void;
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
export type MachineSyncStatus = 'synced' | 'pending' | 'failed';
export type MachineTurretPosition = TurretDirection | 'unknown';

export interface SerialFrameLog {
  hex: string;
  ascii: string;
}

export interface MachineState {
  connected: boolean;
  port: string | null;
  force: string | number;
  lightness: string | number;
  loadTime: string | number;
  objective: string;
  hardnessLevel: string;
  turretPosition: MachineTurretPosition;
  turret: MachineTurretPosition;
  indenting: boolean;
  machineStatus: string;
  indentStatus: IndentStatus;
  commandVerification: MachineCommandVerification;
  lastRxAt?: string;
  lastRx?: string;
  lastRxTime?: string;
  lastRxFrame?: SerialFrameLog;
  lastTxAt?: string;
  lastTx?: string;
  lastTxCommand?: string;
  syncStatus: MachineSyncStatus;
  syncMessage?: string;
  lastUpdatedBy: 'pc' | 'machine' | 'system';
  lastUpdateSource: 'pc' | 'machine' | 'system';
  lastError?: string;
  updatedAt: string;
  /** Last objective TX code on the wire, e.g. "UL1" / "UL2". */
  lastObjectiveTx?: string;
  /** Last objective RX echo from the machine, e.g. "L1OK" / "L2OK". */
  lastObjectiveRx?: string;
  /** Objective value the machine itself last confirmed via L<n>OK. */
  confirmedObjectiveFromMachine?: string;
  /**
   * Whether a human has visually verified the physical turret matches the
   * machine-confirmed objective. 'unknown' until the user explicitly confirms.
   */
  lastObjectivePhysicalCheck?: 'unknown' | 'manual';
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
  turretPosition: 'unknown',
  turret: 'unknown',
  indenting: false,
  machineStatus: 'idle',
  indentStatus: 'idle',
  commandVerification: getCommandVerification(),
  syncStatus: 'synced',
  lastUpdatedBy: 'system',
  lastUpdateSource: 'system',
  updatedAt: new Date().toISOString(),
};

const TX_TIMEOUT_MS = 5000;
const ALLOWED_FORCES = new Set([
  '0.01kgf',
  '0.025kgf',
  '0.05kgf',
  '0.1kgf',
  '0.2kgf',
  '0.3kgf',
  '0.5kgf',
  '1kgf',
]);
const ALLOWED_OBJECTIVES = new Set(['2.5X', '5X', '10X', '20X', '40X', '50X']);
const ALLOWED_HARDNESS_LEVELS = new Set(['Low', 'Middle', 'High']);
const LIGHTNESS_MIN = 0;
const LIGHTNESS_MAX = 10;
const LOAD_TIME_MIN = 1;
const LOAD_TIME_MAX = 99;
const INDENT_FINISH_GRACE_MS = 45_000;

class HardnessMachineSerialService extends EventEmitter {
  private state: MachineState = { ...DEFAULT_STATE };
  private port: SerialPortInstance | null = null;
  private rxBuffer: Buffer = Buffer.alloc(0);
  private pendingAckField: MachineCommandKey | null = null;
  private pendingAckValue: string | null = null;
  private pendingAckCommandLabel: string | null = null;
  private pendingAckCommandId: number | null = null;
  private commandSequence = 0;
  // Set when an impress command is sent with turretAfterImpress=true. The next
  // machine-confirmed objective RX (L1OK/L2OK) emits a
  // [turret-after-impress-move-confirmed] log, then clears this flag.
  private pendingTurretAfterImpressConfirm = false;
  private txQueue: Promise<void> = Promise.resolve();
  // Persisted-settings record bookkeeping. The latest row is loaded once at
  // service construction; subsequent saves update that same row instead of
  // creating a new history record on every keystroke.
  private persistedSettingsId: string | null = null;
  private persistLoadPromise: Promise<void> | null = null;
  private persistInFlight = false;
  private persistPending = false;

  private loadPersistedSettings(): Promise<void> {
    if (this.persistLoadPromise) return this.persistLoadPromise;
    this.persistLoadPromise = (async () => {
      try {
        const all = await machineSettingsService.getAll();
        if (all.length === 0) {
          // eslint-disable-next-line no-console
          console.log('[machine-settings] no saved record; using defaults');
          return;
        }
        const latest = [...all].sort(
          (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
        )[0];
        this.persistedSettingsId = latest.id;
        // Seed in-memory state. Connection-related fields stay at defaults.
        this.state = {
          ...this.state,
          force: latest.force,
          lightness: latest.lightness,
          loadTime: latest.loadTime,
          objective: latest.objective,
          hardnessLevel: latest.hardnessLevel,
        };
        // eslint-disable-next-line no-console
        console.log(
          `[machine-settings] loaded saved lightness=${latest.lightness} loadTime=${latest.loadTime}`
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[machine-settings] load failed:',
          err instanceof Error ? err.message : String(err)
        );
      }
    })();
    return this.persistLoadPromise;
  }

  private buildPersistPayload(): MachineSettingsPayload {
    const lightnessNum = Number(this.state.lightness);
    const loadTimeNum = Number(this.state.loadTime);
    return {
      force: String(this.state.force),
      lightness: Number.isFinite(lightnessNum) ? lightnessNum : 5,
      loadTime: Number.isFinite(loadTimeNum) ? loadTimeNum : 5,
      objective: String(this.state.objective),
      hardnessLevel: String(this.state.hardnessLevel),
    };
  }

  private schedulePersist(): void {
    if (this.persistInFlight) {
      this.persistPending = true;
      return;
    }
    this.persistInFlight = true;
    void (async () => {
      try {
        await this.loadPersistedSettings();
        const payload = this.buildPersistPayload();
        if (this.persistedSettingsId) {
          await machineSettingsService.update(this.persistedSettingsId, payload);
        } else {
          const created = await machineSettingsService.create(payload);
          this.persistedSettingsId = created.id;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[machine-settings] persist failed:',
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        this.persistInFlight = false;
        if (this.persistPending) {
          this.persistPending = false;
          this.schedulePersist();
        }
      }
    })();
  }

  /**
   * Replay saved lightness/load-time to the machine after a successful
   * connection so the physical display reflects the values stored in SQLite.
   * Fire-and-forget: failures are logged but never block the connect call.
   */
  private replayPersistedToMachine(): void {
    void (async () => {
      try {
        await this.loadPersistedSettings();
        if (!this.state.connected) {
          // eslint-disable-next-line no-console
          console.log('[machine-startup-sync] skipped because machine not connected');
          return;
        }
        // eslint-disable-next-line no-console
        console.log('[machine-startup-sync] waiting for machine tx ready');
        const lightness = this.state.lightness;
        const loadTime = this.state.loadTime;
        try {
          // eslint-disable-next-line no-console
          console.log(`[machine-startup-sync] sending saved lightness=${lightness}`);
          await this.setControlValue('lightness', lightness);
          // eslint-disable-next-line no-console
          console.log(`[machine-tx] lightness sent value=${lightness}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            '[machine-startup-sync] lightness replay failed:',
            err instanceof Error ? err.message : String(err)
          );
        }
        try {
          // eslint-disable-next-line no-console
          console.log(`[machine-startup-sync] sending saved loadTime=${loadTime}`);
          await this.setControlValue('loadTime', loadTime);
          // eslint-disable-next-line no-console
          console.log(`[machine-tx] loadTime sent value=${loadTime}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            '[machine-startup-sync] loadTime replay failed:',
            err instanceof Error ? err.message : String(err)
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[machine-startup-sync] failed:',
          err instanceof Error ? err.message : String(err)
        );
      }
    })();
  }

  /** Public hook so the backend bootstrap can wait for SQLite restore. */
  async ready(): Promise<void> {
    await this.loadPersistedSettings();
  }

  getState(): MachineState {
    return { ...this.state };
  }

  isConnected(): boolean {
    return this.state.connected;
  }

  private normalizeStatePatch(patch: Partial<MachineState>): Partial<MachineState> {
    const normalized: Partial<MachineState> = { ...patch };
    if (patch.turretPosition !== undefined && patch.turret === undefined) {
      normalized.turret = patch.turretPosition;
    }
    if (patch.turret !== undefined && patch.turretPosition === undefined) {
      normalized.turretPosition = patch.turret;
    }
    if (patch.lastRxAt !== undefined && patch.lastRx === undefined) {
      normalized.lastRx = patch.lastRxAt;
    }
    if (patch.lastTxAt !== undefined && patch.lastTx === undefined) {
      normalized.lastTx = patch.lastTxAt;
    }
    return normalized;
  }

  private setState(patch: Partial<MachineState>, origin: MachineState['lastUpdatedBy']): void {
    const normalizedPatch = this.normalizeStatePatch(patch);
    const prevError = this.state.lastError;
    const nextError =
      Object.prototype.hasOwnProperty.call(normalizedPatch, 'lastError')
        ? normalizedPatch.lastError
        : prevError;
    this.state = {
      ...this.state,
      ...normalizedPatch,
      commandVerification: getCommandVerification(),
      lastUpdatedBy: origin,
      lastUpdateSource: origin,
      updatedAt: new Date().toISOString(),
    };
    if (!prevError && nextError) {
      const type = /timeout/i.test(nextError) ? 'ack-timeout' : 'error';
      // eslint-disable-next-line no-console
      console.log(`[machine-error-set] type=${type} message=${JSON.stringify(nextError)}`);
    } else if (prevError && !nextError) {
      const reason =
        origin === 'machine'
          ? 'rx-recovered'
          : this.state.syncStatus === 'synced'
            ? 'sync-success'
            : 'ack-success';
      // eslint-disable-next-line no-console
      console.log(`[machine-error-clear] reason=${reason} prior=${JSON.stringify(prevError)}`);
    }
    this.emit('state', this.state);
    this.logUiState();
  }

  private updateTelemetry(patch: Partial<MachineState>): void {
    const normalizedPatch = this.normalizeStatePatch(patch);
    this.state = {
      ...this.state,
      ...normalizedPatch,
      commandVerification: getCommandVerification(),
      updatedAt: new Date().toISOString(),
    };
    this.emit('state', this.state);
  }

  private logUiState(): void {
    // eslint-disable-next-line no-console
    console.log(
      `[machine-sync][ui-state] objective=${this.state.objective} force=${this.state.force} lightness=${this.state.lightness} loadTime=${this.state.loadTime} hardnessLevel=${this.state.hardnessLevel}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[machine-state] force=${this.state.force} objective=${this.state.objective} lightness=${this.state.lightness} loadTime=${this.state.loadTime} turret=${this.state.turretPosition} status=${this.state.machineStatus}`
    );
  }

  private machineFieldName(key: MachineCommandKey): string {
    return key === 'force' ? 'load' : key;
  }

  private describeCommand(
    field: MachineCommandKey,
    expectedValue: string | number | undefined
  ): string {
    if (String(field).startsWith('turret')) {
      return `${field} slot=${expectedValue ?? 'unknown'}`;
    }
    return `${this.machineFieldName(field)}=${expectedValue ?? 'unknown'}`;
  }

  private logAckMatched(rxAscii: string): void {
    const command = this.pendingAckCommandLabel ?? this.pendingAckField ?? 'unknown';
    const id = this.pendingAckCommandId ?? 'unknown';
    // eslint-disable-next-line no-console
    console.log(`[machine-ack] matched command=${command} id=${id} rx=${rxAscii}`);
  }

  private logAckUnmatched(rxAscii: string): void {
    if (!this.pendingAckField) return;
    const command = this.pendingAckCommandLabel ?? this.pendingAckField;
    const expected = this.pendingAckValue ?? 'any';
    // eslint-disable-next-line no-console
    console.log(`[machine-ack] unmatched rx=${rxAscii} command=${command} expected=${expected}`);
  }

  private logMachineRxField(field: string, value: string | number): void {
    // eslint-disable-next-line no-console
    console.log(`[machine-state] field=${field} value=${value} source=machine`);
    if (field === 'force') {
      // eslint-disable-next-line no-console
      console.log(`[machine-rx] load detected value=${value}`);
      // eslint-disable-next-line no-console
      console.log(`[machine-sync] mapped machine load -> software force value=${value}`);
      // eslint-disable-next-line no-console
      console.log(`[machine-state] force=${value} source=machine`);
    } else if (field === 'objective') {
      // eslint-disable-next-line no-console
      console.log(`[machine-objective-rx] objective=${value}`);
      // eslint-disable-next-line no-console
      console.log(`[machine-objective-rx] confirmed value=${value}`);
    }
  }

  private unverifiedMessage(field: MachineCommandKey): string {
    return `RS232 command for "${field}" is not verified; writes are disabled until the official protocol bytes are supplied.`;
  }

  private frameLog(frame: Buffer): SerialFrameLog {
    return {
      hex: frame.toString('hex'),
      ascii: frame.toString('ascii'),
    };
  }

  private validateControlValue(key: MachineControlKey, value: string | number): string | number {
    const text = String(value).trim();
    switch (key) {
      case 'force':
        if (!ALLOWED_FORCES.has(text)) {
          throw new Error(`invalid force "${text}"`);
        }
        return text;
      case 'objective': {
        const normalized = text.toUpperCase();
        if (!ALLOWED_OBJECTIVES.has(normalized)) {
          throw new Error(`invalid objective "${text}"`);
        }
        return normalized;
      }
      case 'lightness': {
        const numeric = Number(text);
        if (!Number.isInteger(numeric) || numeric < LIGHTNESS_MIN || numeric > LIGHTNESS_MAX) {
          throw new Error(`invalid lightness "${text}"`);
        }
        return numeric;
      }
      case 'loadTime': {
        const numeric = Number(text);
        if (!Number.isInteger(numeric) || numeric < LOAD_TIME_MIN || numeric > LOAD_TIME_MAX) {
          throw new Error(`invalid loadTime "${text}"`);
        }
        return numeric;
      }
      case 'hardnessLevel':
        if (!ALLOWED_HARDNESS_LEVELS.has(text)) {
          throw new Error(`invalid hardnessLevel "${text}"`);
        }
        return text;
      default: {
        const exhaustive: never = key;
        return exhaustive;
      }
    }
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
      this.setState(
        { connected: false, port: null, indenting: false, machineStatus: 'disconnected' },
        'system'
      );
    });

    this.port = portInstance;
    // eslint-disable-next-line no-console
    console.log('[machine-service] port open path=', opts.port);
    this.setState(
      {
        connected: true,
        port: opts.port,
        lastError: undefined,
        indentStatus: 'idle',
        indenting: false,
        machineStatus: 'connected',
      },
      'system'
    );
    // After the port is open, push the persisted lightness/load-time values
    // to the machine so its physical display matches the UI on every cold
    // start. Fire-and-forget — failures are non-fatal for the connect call.
    this.replayPersistedToMachine();
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
    this.setState(
      {
        connected: false,
        port: null,
        indentStatus: 'idle',
        indenting: false,
        machineStatus: 'disconnected',
      },
      'system'
    );
    return this.getState();
  }

  private handleIncoming(chunk: Buffer): void {
    // [RX] hex + ascii — verbatim so the user can match against the manual.
    // eslint-disable-next-line no-console
    console.log(
      `[machine-sync][rx] hex=${chunk.toString('hex')} ascii=${JSON.stringify(chunk.toString('ascii'))}`
    );
    // eslint-disable-next-line no-console
    console.log(`[machine-rx] raw hex=${chunk.toString('hex')}`);
    // eslint-disable-next-line no-console
    console.log(`[machine-rx] raw ascii=${JSON.stringify(chunk.toString('ascii'))}`);
    // eslint-disable-next-line no-console
    console.log(`[machine-rx] byteCount=${chunk.length}`);
    if (this.pendingAckField) {
      // eslint-disable-next-line no-console
      console.log(`[machine-rx] after-tx raw=${JSON.stringify(chunk.toString('ascii'))}`);
    }
    if (this.pendingAckField === 'force') {
      // eslint-disable-next-line no-console
      console.log(
        `[machine-force-rx] hex=${chunk.toString('hex')} ascii=${JSON.stringify(chunk.toString('ascii'))}`
      );
    }
    if (this.pendingAckField === 'loadTime') {
      // eslint-disable-next-line no-console
      console.log(
        `[machine-loadtime-rx] hex=${chunk.toString('hex')} ascii=${JSON.stringify(chunk.toString('ascii'))}`
      );
    }
    if (this.pendingAckField === 'lightness') {
      // eslint-disable-next-line no-console
      console.log(
        `[machine-lightness-rx] raw=${JSON.stringify(chunk.toString('ascii'))} hex=${chunk.toString('hex')}`
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      `[machine-rx] chunk hex=${chunk.toString('hex')} ascii=${JSON.stringify(chunk.toString('ascii'))}`
    );

    // Record Last RX on every byte arrival, even if the bytes don't yet form a
    // complete frame. The UI was showing "Never" whenever the parser was still
    // accumulating partial input.
    const chunkAt = new Date().toISOString();
    this.updateTelemetry({
      lastRxAt: chunkAt,
      lastRxTime: chunkAt,
      lastRxFrame: this.frameLog(chunk),
    });

    this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);

    // Drain as many complete frames as the streaming parser can extract from
    // the rolling buffer. The parser tells us how many bytes it consumed; we
    // keep the unconsumed tail for the next chunk.
    let safety = 32;
    while (safety > 0) {
      safety -= 1;
      const { frame, consumed } = tryParseOneFrame(this.rxBuffer);
      if (consumed === 0) break;
      const rawFrame = this.rxBuffer.slice(0, consumed);
      const rxAt = new Date().toISOString();
      const rxFrame = this.frameLog(rawFrame);
      this.rxBuffer = this.rxBuffer.slice(consumed);

      // eslint-disable-next-line no-console
      console.log('[machine-service] [PARSED] kind=', frame.kind);
      // eslint-disable-next-line no-console
      console.log(
        `[machine-rx] frame kind=${frame.kind} hex=${rxFrame.hex} ascii=${JSON.stringify(rxFrame.ascii)}`
      );
      if (frame.kind === 'unknown' && frame.raw.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[machine-sync][rx-frame] hex=${frame.raw.toString('hex')} ascii=${JSON.stringify(frame.raw.toString('ascii'))}`
        );
        this.updateTelemetry({ lastRxAt: rxAt, lastRxTime: rxAt, lastRxFrame: rxFrame });
        this.logAckUnmatched(frame.raw.toString('ascii'));
      }

      switch (frame.kind) {
        case 'state-batch': {
          const patch = frame.values as Partial<MachineState>;
          // Accept ANY state echo for the pending field as confirmation. The
          // machine's reported value is authoritative — if it differs from the
          // requested value we still record it (the dropdown will reflect the
          // real machine state) instead of letting ACK time out.
          const expectedEcho =
            this.pendingAckField !== null &&
            frame.values[this.pendingAckField as MachineControlKey] !== undefined;
          const expectedTurretEcho =
            this.pendingAckField !== null &&
            String(this.pendingAckField).startsWith('turret') &&
            frame.turretSlot !== undefined;
          for (const [field, value] of Object.entries(frame.values)) {
            // eslint-disable-next-line no-console
            console.log(`[machine-sync][machine-update] field=${field} value=${value}`);
            this.logMachineRxField(field, value);
            if (field === 'force') {
              // eslint-disable-next-line no-console
              console.log(`[machine-parse] force detected value=${value}`);
              // eslint-disable-next-line no-console
              console.log(`[machine-sync] source=machine force=${value}`);
              // eslint-disable-next-line no-console
              console.log(`[machine-force-panel-update] value=${value} source=machine`);
              // eslint-disable-next-line no-console
              console.log(`[machine-force-state-confirmed] value=${value} source=machine`);
            }
            if (field === 'objective') {
              // eslint-disable-next-line no-console
              console.log(`[machine-rx] objective detected value=${value}`);
              // eslint-disable-next-line no-console
              console.log(`[machine-sync] source=machine objective=${value}`);
            }
          }
          if (frame.turretSlot) {
            // eslint-disable-next-line no-console
            console.log(
              `[machine-turret-rx] slot=${frame.turretSlot} direction=${frame.turretDirection ?? 'unknown'} objective=${frame.values.objective ?? 'unknown'}`
            );
          }
          const fullPatch: Partial<MachineState> = {
            ...patch,
            turretPosition: frame.turretDirection ?? this.state.turretPosition,
            lastRxAt: rxAt,
            lastRxTime: rxAt,
            lastRxFrame: rxFrame,
            machineStatus: 'rx-state',
            syncStatus: 'synced',
            syncMessage: `RX state batch`,
            lastError: undefined,
          };
          if (frame.values.objective !== undefined) {
            const rxAscii = rxFrame.ascii.replace(/[\r\n]+$/, '');
            // Defensive: assign explicitly even though `...patch` already
            // carries it. Guards against future changes to frame.values typing
            // and makes the machine-RX → state.objective contract explicit.
            fullPatch.objective = String(frame.values.objective);
            fullPatch.lastObjectiveRx = rxAscii;
            fullPatch.confirmedObjectiveFromMachine = String(frame.values.objective);
            fullPatch.lastObjectivePhysicalCheck = 'unknown';
            if (this.pendingTurretAfterImpressConfirm) {
              // eslint-disable-next-line no-console
              console.log(
                `[turret-after-impress-move-confirmed] objective=${frame.values.objective}`
              );
              this.pendingTurretAfterImpressConfirm = false;
            }
            // eslint-disable-next-line no-console
            console.log(
              `[machine-objective-rx] raw=${JSON.stringify(rxAscii)} parsedObjective=${frame.values.objective}`
            );
            // eslint-disable-next-line no-console
            console.log(
              `[machine-sync][objective] source=machine confirmedObjective=${frame.values.objective}`
            );
            // eslint-disable-next-line no-console
            console.log(
              `[objective-test] rx=${rxAscii} confirmed=${frame.values.objective}`
            );
            // eslint-disable-next-line no-console
            console.log(
              `[machine-rx] ack/status objective=${frame.values.objective} raw=${rxAscii}`
            );
            // eslint-disable-next-line no-console
            console.log(
              `[machine-sync] confirmed objective=${frame.values.objective} source=machine`
            );
          }
          this.setState(fullPatch, 'machine');
          if (expectedEcho || expectedTurretEcho) {
            this.logAckMatched(rxFrame.ascii.replace(/[\r\n]+$/, ''));
            this.emit('ack');
          } else {
            this.logAckUnmatched(rxFrame.ascii.replace(/[\r\n]+$/, ''));
          }
          break;
        }
        case 'turret-update': {
          // Accept any turret-update for a pending turret command, and any
          // L<n>OK frame as objective confirmation when an objective change is
          // pending — value mismatch is still a real machine state and should
          // not cause an ack timeout.
          const expectedTurretEcho =
            this.pendingAckField !== null &&
            String(this.pendingAckField).startsWith('turret');
          const expectedObjectiveEcho =
            this.pendingAckField === 'objective' && frame.objective !== undefined;
          // eslint-disable-next-line no-console
          console.log(
            `[machine-sync][machine-update] field=turretPosition value=${frame.direction ?? 'unknown'} slot=${frame.slot}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[machine-turret-rx] slot=${frame.slot} direction=${frame.direction ?? 'unknown'} objective=${frame.objective ?? 'unknown'}`
          );
          const patch: Partial<MachineState> = {
            turretPosition: frame.direction ?? 'unknown',
            lastRxAt: rxAt,
            lastRxTime: rxAt,
            lastRxFrame: rxFrame,
            machineStatus: 'turret-update',
            syncStatus: 'synced',
            syncMessage: `RX turret slot=${frame.slot}`,
            lastError: undefined,
          };
          if (frame.objective !== undefined) {
            const rxAscii = rxFrame.ascii.replace(/[\r\n]+$/, '');
            // eslint-disable-next-line no-console
            console.log(
              `[machine-objective-rx] raw=${JSON.stringify(rxAscii)} parsedObjective=${frame.objective}`
            );
            // eslint-disable-next-line no-console
            console.log(
              `[machine-objective-rx] raw=${rxAscii} confirmedObjective=${frame.objective} expected=L${frame.slot}OK`
            );
            // eslint-disable-next-line no-console
            console.log(
              `[machine-sync][objective] source=machine confirmedObjective=${frame.objective}`
            );
            // eslint-disable-next-line no-console
            console.log(`[machine-sync][machine-update] field=objective value=${frame.objective}`);
            this.logMachineRxField('objective', frame.objective);
            // eslint-disable-next-line no-console
            console.log(`[machine-rx] objective detected value=${frame.objective}`);
            // eslint-disable-next-line no-console
            console.log(`[machine-sync] source=machine objective=${frame.objective}`);
            patch.objective = frame.objective;
            patch.lastObjectiveRx = rxAscii;
            patch.confirmedObjectiveFromMachine = frame.objective;
            if (this.pendingTurretAfterImpressConfirm) {
              // eslint-disable-next-line no-console
              console.log(
                `[turret-after-impress-move-confirmed] objective=${frame.objective}`
              );
              this.pendingTurretAfterImpressConfirm = false;
            }
            patch.lastObjectivePhysicalCheck = 'unknown';
            patch.syncMessage = `RX objective=${frame.objective} turret slot=${frame.slot}`;
            // eslint-disable-next-line no-console
            console.log(`[objective-test] rx=${rxAscii} confirmed=${frame.objective}`);
            if (expectedObjectiveEcho) {
              // eslint-disable-next-line no-console
              console.log(`[machine-rx] ack/status objective=${frame.objective} raw=${rxAscii}`);
              // eslint-disable-next-line no-console
              console.log(`[machine-sync] confirmed objective=${frame.objective} source=machine`);
            }
          }
          this.setState(patch, 'machine');
          if (expectedTurretEcho || expectedObjectiveEcho) {
            this.logAckMatched(rxFrame.ascii.replace(/[\r\n]+$/, ''));
            this.emit('ack');
          } else {
            this.logAckUnmatched(rxFrame.ascii.replace(/[\r\n]+$/, ''));
          }
          break;
        }
        case 'state-update':
          // eslint-disable-next-line no-console
          console.log(`[machine-sync][machine-update] field=${frame.key} value=${frame.value}`);
          this.logMachineRxField(frame.key, frame.value);
          if (frame.key === 'force') {
            // eslint-disable-next-line no-console
            console.log(`[machine-parse] force detected value=${frame.value}`);
            // eslint-disable-next-line no-console
            console.log(`[machine-sync] source=machine force=${frame.value}`);
            // eslint-disable-next-line no-console
            console.log(`[machine-force-panel-update] value=${frame.value} source=machine`);
            // eslint-disable-next-line no-console
            console.log(`[machine-force-state-confirmed] value=${frame.value} source=machine`);
          }
          if (frame.key === 'objective') {
            // eslint-disable-next-line no-console
            console.log(`[machine-rx] objective detected value=${frame.value}`);
            // eslint-disable-next-line no-console
            console.log(`[machine-sync] source=machine objective=${frame.value}`);
          }
          {
            const rxField = this.machineFieldName(frame.key);
            // Field-level match is enough — the machine's echoed value is the
            // truth. If we asked for 1kgf and got C08 back, the dropdown
            // updates to the real value instead of timing out.
            const expectedEcho = this.pendingAckField === frame.key;
            const patch: Partial<MachineState> = {
              [frame.key]: frame.value,
              lastRxAt: rxAt,
              lastRxTime: rxAt,
              lastRxFrame: rxFrame,
              machineStatus: `rx-${rxField}`,
              syncStatus: 'synced',
              syncMessage: `RX ${rxField}=${frame.value}`,
              lastError: undefined,
            } as Partial<MachineState>;
            if (frame.key === 'objective') {
              const rxAscii = rxFrame.ascii.replace(/[\r\n]+$/, '');
              patch.lastObjectiveRx = rxAscii;
              patch.confirmedObjectiveFromMachine = String(frame.value);
              // Reset physical check on every fresh machine confirmation —
              // the human has not yet visually verified this new position.
              patch.lastObjectivePhysicalCheck = 'unknown';
              if (this.pendingTurretAfterImpressConfirm) {
                // eslint-disable-next-line no-console
                console.log(
                  `[turret-after-impress-move-confirmed] objective=${frame.value}`
                );
                this.pendingTurretAfterImpressConfirm = false;
              }
              // eslint-disable-next-line no-console
              console.log(
                `[machine-objective-rx] raw=${JSON.stringify(rxAscii)} parsedObjective=${frame.value}`
              );
              // eslint-disable-next-line no-console
              console.log(
                `[machine-sync][objective] source=machine confirmedObjective=${frame.value}`
              );
              // eslint-disable-next-line no-console
              console.log(
                `[objective-test] rx=${rxAscii} confirmed=${frame.value}`
              );
              if (expectedEcho) {
                // eslint-disable-next-line no-console
                console.log(`[machine-rx] ack/status objective=${frame.value} raw=${rxAscii}`);
                // eslint-disable-next-line no-console
                console.log(`[machine-sync] confirmed objective=${frame.value} source=machine`);
              }
            }
            this.setState(patch, 'machine');
            if (frame.key === 'lightness' || frame.key === 'loadTime') {
              // eslint-disable-next-line no-console
              console.log(`[machine-rx] confirmed ${frame.key}=${frame.value}`);
            }
            if (frame.key === 'lightness') {
              // eslint-disable-next-line no-console
              console.log(
                `[machine-lightness-rx] raw=${JSON.stringify(rxFrame.ascii)} parsedValue=${frame.value}`
              );
              // eslint-disable-next-line no-console
              console.log(`[lightness-ack] value=${frame.value}`);
            }
            if (frame.key === 'force') {
              // eslint-disable-next-line no-console
              console.log(
                `[machine-force-ack] success=${expectedEcho} parsedForce=${frame.value}`
              );
            }
            if (frame.key === 'loadTime') {
              // eslint-disable-next-line no-console
              console.log(
                `[machine-loadtime-ack] success=${expectedEcho} parsedLoadTime=${frame.value}`
              );
            }
            // Persist machine-driven changes too — operator may have edited
            // values directly on the panel; SQLite must mirror reality.
            if (
              frame.key === 'force' ||
              frame.key === 'lightness' ||
              frame.key === 'loadTime' ||
              frame.key === 'objective' ||
              frame.key === 'hardnessLevel'
            ) {
              this.schedulePersist();
            }
            if (expectedEcho) {
              this.logAckMatched(rxFrame.ascii.replace(/[\r\n]+$/, ''));
              this.emit('ack');
            } else {
              this.logAckUnmatched(rxFrame.ascii.replace(/[\r\n]+$/, ''));
            }
          }
          break;
        case 'indent-status':
          // eslint-disable-next-line no-console
          console.log('[machine-service] [SYNC] indent status=', frame.status);
          this.setState(
            {
              indentStatus: frame.status,
              indenting: frame.status === 'started' || frame.status === 'running',
              machineStatus: `indent-${frame.status}`,
              lastError: frame.status === 'error' ? frame.message : undefined,
              lastRxAt: rxAt,
              lastRxTime: rxAt,
              lastRxFrame: rxFrame,
              syncStatus: frame.status === 'error' ? 'failed' : 'synced',
              syncMessage: `RX indent=${frame.status}`,
            },
            'machine'
          );
          if (this.pendingAckField === 'indent') {
            if (frame.status === 'completed') {
              this.logAckMatched(rxFrame.ascii.replace(/[\r\n]+$/, ''));
              this.emit('ack');
            } else if (frame.status === 'error') {
              this.emit('nak', frame.message ?? 'indent error');
            }
          }
          break;
        case 'ack':
          if (!this.pendingAckField) {
            // eslint-disable-next-line no-console
            console.log('[machine-sync][ack] field=unknown ok=true');
          }
          {
            const isIndentAck = this.pendingAckField === 'indent';
            if (this.pendingAckField) {
              this.logAckMatched(rxFrame.ascii.replace(/[\r\n]+$/, ''));
            }
            this.updateTelemetry({
              lastRxAt: rxAt,
              lastRxTime: rxAt,
              lastRxFrame: rxFrame,
              machineStatus: isIndentAck ? 'indent-ack' : 'ack',
              syncStatus: 'synced',
              syncMessage: isIndentAck ? 'ACK indent=start' : 'ACK received',
              lastError: undefined,
            });
            this.emit('ack');
          }
          break;
        case 'nak':
          if (!this.pendingAckField) {
            // eslint-disable-next-line no-console
            console.log(`[machine-sync][ack] field=unknown ok=false message=${frame.message ?? 'machine NAK'}`);
          }
          this.emit('nak', frame.message ?? 'machine NAK');
          this.setState(
            {
              lastError: frame.message ?? 'machine NAK',
              lastRxAt: rxAt,
              lastRxTime: rxAt,
              lastRxFrame: rxFrame,
              machineStatus: 'nak',
              syncStatus: 'failed',
              syncMessage: frame.message ?? 'machine NAK',
            },
            'machine'
          );
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
  private waitForAck(
    field: MachineCommandKey,
    expectedValue: string | number | undefined,
    timeoutMs: number,
    commandId: number,
    commandLabel: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.off('ack', onAck);
        this.off('nak', onNak);
        if (this.pendingAckField === field) {
          this.pendingAckField = null;
          this.pendingAckValue = null;
          this.pendingAckCommandLabel = null;
          this.pendingAckCommandId = null;
        }
      };
      const onAck = () => {
        // eslint-disable-next-line no-console
        console.log(`[machine-sync][ack] field=${field} ok=true`);
        // eslint-disable-next-line no-console
        console.log(`[machine-service] ack field=${field} ok=true`);
        if (field === 'force') {
          // eslint-disable-next-line no-console
          console.log(`[machine-force-ack] command=${commandLabel} id=${commandId} expected=${expectedValue ?? 'any'}`);
        }
        cleanup();
        resolve();
      };
      const onNak = (message: string) => {
        // eslint-disable-next-line no-console
        console.log(`[machine-sync][ack] field=${field} ok=false message=${message}`);
        // eslint-disable-next-line no-console
        console.log(`[machine-service] ack field=${field} ok=false message=${message}`);
        cleanup();
        reject(new Error(message));
      };
      const timer = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.log(`[machine-sync][ack] field=${field} ok=false message=ack timeout`);
        // eslint-disable-next-line no-console
        console.log(`[machine-service] ack field=${field} ok=false message=ack timeout`);
        // eslint-disable-next-line no-console
        console.log(`[machine-ack] timeout command=${commandLabel} id=${commandId} expected=${expectedValue ?? 'any'}`);
        if (field === 'force') {
          // eslint-disable-next-line no-console
          console.log(`[machine-force-timeout] command=${commandLabel} id=${commandId} expected=${expectedValue ?? 'any'} timeoutMs=${timeoutMs}`);
        }
        cleanup();
        reject(new Error('ack timeout'));
      }, timeoutMs);
      this.pendingAckField = field;
      this.pendingAckValue = expectedValue === undefined ? null : String(expectedValue);
      this.pendingAckCommandLabel = commandLabel;
      this.pendingAckCommandId = commandId;
      this.once('ack', onAck);
      this.once('nak', onNak);
    });
  }

  private async transmit(
    field: MachineCommandKey,
    frame: Buffer,
    opts: { awaitAck?: boolean; expectedValue?: string | number; timeoutMs?: number } = {}
  ): Promise<void> {
    const run = () => this.transmitNow(field, frame, opts);
    const queued = this.txQueue.then(run, run);
    this.txQueue = queued.catch(() => undefined);
    return queued;
  }

  private async transmitNow(
    field: MachineCommandKey,
    frame: Buffer,
    opts: { awaitAck?: boolean; expectedValue?: string | number; timeoutMs?: number } = {}
  ): Promise<void> {
    if (!this.port || !this.state.connected) {
      throw new Error('machine not connected');
    }
    const commandId = ++this.commandSequence;
    const commandLabel = this.describeCommand(field, opts.expectedValue);
    // eslint-disable-next-line no-console
    console.log(`[machine-command] queued id=${commandId} command=${commandLabel}`);
    // [TX] hex + ascii — full frame logged for protocol verification.
    // eslint-disable-next-line no-console
    console.log(
      `[machine-sync][tx] field=${field} hex=${frame.toString('hex')} ascii=${JSON.stringify(frame.toString('ascii'))}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[machine-tx] field=${field} hex=${frame.toString('hex')} ascii=${JSON.stringify(frame.toString('ascii'))}`
    );
    if (field === 'force') {
      // eslint-disable-next-line no-console
      console.log(
        `[machine-tx] command=load sourceField=force value=${opts.expectedValue ?? 'unknown'} hex=${frame.toString('hex')}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[machine-force-tx] value=${opts.expectedValue ?? 'unknown'} hex=${frame.toString('hex')} ascii=${JSON.stringify(frame.toString('ascii'))}`
      );
    } else if (field === 'loadTime') {
      // eslint-disable-next-line no-console
      console.log(
        `[machine-loadtime-tx] value=${opts.expectedValue ?? 'unknown'} ascii=${JSON.stringify(frame.toString('ascii'))} hex=${frame.toString('hex')}`
      );
      // eslint-disable-next-line no-console
      console.log(`[machine-tx] command=${field} value=${opts.expectedValue ?? 'unknown'} hex=${frame.toString('hex')}`);
    } else if (field === 'lightness') {
      // eslint-disable-next-line no-console
      console.log(
        `[machine-lightness-tx] value=${opts.expectedValue ?? 'unknown'} ascii=${JSON.stringify(frame.toString('ascii'))} hex=${frame.toString('hex')}`
      );
      // eslint-disable-next-line no-console
      console.log(`[machine-tx] command=${field} value=${opts.expectedValue ?? 'unknown'} hex=${frame.toString('hex')}`);
    } else if (field === 'objective') {
      // eslint-disable-next-line no-console
      console.log(`[machine-tx] command=${field} value=${opts.expectedValue ?? 'unknown'} hex=${frame.toString('hex')}`);
      // eslint-disable-next-line no-console
      console.log(
        `[machine-objective-tx] objective=${opts.expectedValue ?? 'unknown'} hex=${frame.toString('hex')} ascii=${JSON.stringify(frame.toString('ascii'))}`
      );
      // Spec-format companion log: explicit value/code/hex split for diffing
      // 10X (UL1), IND (UL2), 40X (UL3) traces side-by-side.
      const codeAscii = frame.toString('ascii').replace(/\r$/, '');
      // eslint-disable-next-line no-console
      console.log(
        `[machine-objective-tx] value=${opts.expectedValue ?? 'unknown'} code=${codeAscii} hex=${frame.toString('hex')}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[machine-objective-tx] objective=${opts.expectedValue ?? 'unknown'} command=${codeAscii}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[objective-test] requested=${opts.expectedValue ?? 'unknown'} tx=${codeAscii}`
      );
      // Stash on telemetry so the UI can correlate TX vs RX for the diagnostic.
      this.updateTelemetry({ lastObjectiveTx: codeAscii });
    } else {
      // eslint-disable-next-line no-console
      console.log(`[machine-tx] command=${field} value=${opts.expectedValue ?? 'unknown'} hex=${frame.toString('hex')}`);
    }

    // Pre-arm ack listener BEFORE the write completes — some machines reply
    // before the write callback fires.
    const ackPromise = opts.awaitAck
      ? this.waitForAck(
          field,
          opts.expectedValue,
          opts.timeoutMs ?? TX_TIMEOUT_MS,
          commandId,
          commandLabel
        )
      : null;

    // eslint-disable-next-line no-console
    console.log(`[machine-tx] open=${this.port?.isOpen ?? false} port=${this.state.port ?? '?'}`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('tx timeout'));
      }, TX_TIMEOUT_MS);
      // eslint-disable-next-line no-console
      console.log(`[machine-tx] write start hex=${frame.toString('hex')}`);
      this.port?.write(frame, (err, bytesWritten) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }
        // eslint-disable-next-line no-console
        console.log(`[machine-tx] bytesWritten=${bytesWritten ?? frame.length}`);
        // Force the OS buffer to flush before we start the ack countdown,
        // otherwise on slow USB-serial adapters the bytes can sit in the
        // driver queue past the timeout window.
        this.port?.drain((drainErr) => {
          clearTimeout(timer);
          if (drainErr) {
            reject(drainErr);
            return;
          }
          // eslint-disable-next-line no-console
          console.log(`[machine-tx] drain complete bytes=${bytesWritten ?? frame.length}`);
          // eslint-disable-next-line no-console
          console.log(`[machine-tx] write complete bytes=${bytesWritten ?? frame.length}`);
          resolve();
        });
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
    // eslint-disable-next-line no-console
    console.log(`[machine-ui] field=${key} value=${value}`);
    if (key === 'force') {
      // eslint-disable-next-line no-console
      console.log(`[machine-service] setForce requested value=${value}`);
      // eslint-disable-next-line no-console
      console.log(`[machine-force-tx-request] requested value=${value}`);
    }

    let normalizedValue: string | number;
    try {
      normalizedValue = this.validateControlValue(key, value);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw err;
    }

    if (!this.state.connected) {
      const message = 'machine not connected';
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw new Error(message);
    }

    const machineField = this.machineFieldName(key);

    if (!isCommandVerified(key)) {
      const message = this.unverifiedMessage(key);
      // eslint-disable-next-line no-console
      console.warn(`[machine-sync][tx-blocked] field=${key} verified=false reason=${message}`);
      // eslint-disable-next-line no-console
      console.warn(`[machine-tx] blocked field=${key} value=${normalizedValue} verified=false reason=${message}`);
      // eslint-disable-next-line no-console
      console.warn(`[machine-tx] blocked ${key} verified=false`);
      if (key === 'force') {
        // eslint-disable-next-line no-console
        console.warn(
          `[machine-tx] blocked command=load sourceField=force value=${normalizedValue} reason=${message}`
        );
      }
      this.setState(
        {
          lastError: message,
          lastTxCommand: `blocked ${machineField}=${normalizedValue}`,
          syncStatus: 'failed',
          syncMessage: message,
        },
        'system'
      );
      throw new Error(message);
    }

    const frame = buildCommandForKey(key, normalizedValue);
    if (!frame) {
      const message = this.unverifiedMessage(key);
      // eslint-disable-next-line no-console
      console.warn(`[machine-sync][tx-blocked] field=${key} verified=false reason=${message}`);
      // eslint-disable-next-line no-console
      console.warn(`[machine-tx] blocked field=${key} value=${normalizedValue} reason=${message}`);
      // eslint-disable-next-line no-console
      console.warn(`[machine-tx] blocked ${key} verified=false`);
      if (key === 'force') {
        // eslint-disable-next-line no-console
        console.warn(
          `[machine-tx] blocked command=load sourceField=force value=${normalizedValue} reason=${message}`
        );
      }
      this.setState(
        {
          lastError: message,
          lastTxCommand: `blocked ${machineField}=${normalizedValue}`,
          syncStatus: 'failed',
          syncMessage: message,
        },
        'system'
      );
      throw new Error(message);
    }

    try {
      const txAt = new Date().toISOString();
      this.updateTelemetry({
        lastTxAt: txAt,
        lastTxCommand: `${machineField}=${normalizedValue}`,
        syncStatus: 'pending',
        syncMessage: `TX ${machineField}=${normalizedValue}`,
      });
      await this.transmit(key, frame, { awaitAck: true, expectedValue: normalizedValue });
      if (key === 'force') {
        // eslint-disable-next-line no-console
        console.log(`[machine-sync] mapped software force -> machine load value=${normalizedValue}`);
        // eslint-disable-next-line no-console
        console.log(`[machine-state] force=${normalizedValue} source=pc`);
        // eslint-disable-next-line no-console
        console.log(`[machine-force-state-confirmed] value=${normalizedValue} source=pc`);
      }
      const confirmedByMachine =
        this.state.lastUpdatedBy === 'machine' &&
        String(this.state[key]) === String(normalizedValue);
      this.setState(
        {
          [key]: normalizedValue,
          lastError: undefined,
          syncStatus: 'synced',
          syncMessage: `TX ACK ${machineField}=${normalizedValue}`,
        } as Partial<MachineState>,
        confirmedByMachine ? 'machine' : 'pc'
      );
      // Mirror successful changes to SQLite so they survive a restart and
      // can be replayed to the machine on next connect. Persist all five
      // fields together since the row is a single record.
      this.schedulePersist();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (key === 'objective') {
        // Surface objective-specific failure so a UL2 timeout is greppable
        // separately from generic TX errors in the captures.
        const codeAscii = frame.toString('ascii').replace(/\r$/, '');
        // eslint-disable-next-line no-console
        console.warn(
          `[machine-objective-timeout] value=${normalizedValue} code=${codeAscii} reason=${message}`
        );
      }
      // UI must NOT show the requested value on failure. Backend state stays
      // at the last machine-confirmed objective, and the renderer reverts its
      // formState from machineState in its own catch handler.
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw err;
    }
    return this.getState();
  }

  /**
   * Operator-driven confirmation that the physical turret matches the last
   * machine-confirmed objective. Does not transmit anything — only flips the
   * diagnostic flag so the UI can hide its "verify physical position" note.
   */
  confirmObjectivePhysical(): MachineState {
    // eslint-disable-next-line no-console
    console.log(
      `[objective-test] physical check=manual confirmed=${this.state.confirmedObjectiveFromMachine ?? 'unknown'}`
    );
    this.setState({ lastObjectivePhysicalCheck: 'manual' }, 'system');
    return this.getState();
  }

  async sendTurret(direction: TurretDirection): Promise<MachineState> {
    // eslint-disable-next-line no-console
    console.log(`[machine-service] turret requested direction=${direction}`);
    if (!this.state.connected) {
      const message = 'machine not connected';
      // eslint-disable-next-line no-console
      console.warn(`[machine-turret-tx] blocked verified=false`);
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw new Error(message);
    }

    const commandKey = getTurretCommandKey(direction);
    const slot = getTurretSlotForDirection(direction);
    const verified = isCommandVerified(commandKey);
    const frame = verified ? buildTurretCommand(direction) : null;

    if (!verified || !frame) {
      // eslint-disable-next-line no-console
      console.warn(`[machine-turret-tx] blocked verified=false`);
      const message = `Turret ${direction} command is not verified; refusing to transmit speculative bytes.`;
      this.setState(
        {
          lastError: message,
          lastTxCommand: `blocked turret=${direction}`,
          syncStatus: 'failed',
          syncMessage: message,
        },
        'system'
      );
      throw new Error(message);
    }

    // eslint-disable-next-line no-console
    console.log(`[machine-turret-tx] direction=${direction} slot=${slot} hex=${frame.toString('hex')}`);

    try {
      const txAt = new Date().toISOString();
      this.updateTelemetry({
        lastTxAt: txAt,
        lastTxCommand: `turret=${direction} slot=${slot}`,
        syncStatus: 'pending',
        syncMessage: `TX turret=${direction} slot=${slot}`,
      });
      await this.transmit(commandKey, frame, { awaitAck: true, expectedValue: slot });
      const confirmedByMachine =
        this.state.lastUpdatedBy === 'machine' && this.state.turretPosition === direction;
      this.setState(
        {
          lastError: undefined,
          syncStatus: 'synced',
          syncMessage: `TX ACK turret=${direction} slot=${slot}`,
        },
        confirmedByMachine ? 'machine' : 'pc'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw err;
    }
    return this.getState();
  }

  async startIndent(): Promise<MachineState> {
    // eslint-disable-next-line no-console
    console.log('[machine-service] indent requested');
    if (!this.state.connected) {
      const message = 'machine not connected';
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw new Error(message);
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
      // eslint-disable-next-line no-console
      console.warn(`[machine-tx] blocked field=indent verified=false reason=${message}`);
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw new Error(message);
    }
    let turretAfterImpress = true;
    let measureObjective: string | null = null;
    try {
      const all = await autoMeasureSettingsService.getAll();
      const settings = all[0] ?? null;
      if (settings) {
        turretAfterImpress = settings.turretAfterImpress !== false;
        measureObjective =
          typeof settings.objectiveForMeasure === 'string'
            ? settings.objectiveForMeasure
            : null;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[turret-after-impress-settings-read-failed] error=${err instanceof Error ? err.message : String(err)} — defaulting to enabled`
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      `[turret-after-impress] enabled=${turretAfterImpress} action=${turretAfterImpress ? 'move' : 'stay-current'}`
    );
    if (turretAfterImpress) {
      // eslint-disable-next-line no-console
      console.log(
        `[turret-after-impress-move-start] target=${measureObjective ?? 'unknown'}`
      );
      this.pendingTurretAfterImpressConfirm = true;
    } else {
      this.pendingTurretAfterImpressConfirm = false;
      // eslint-disable-next-line no-console
      console.log('[turret-after-impress-skip] reason=setting-disabled');
    }
    const frame = buildStartIndentCommand(this.state.force, this.state.loadTime, turretAfterImpress);
    if (!frame) {
      const message = this.unverifiedMessage('indent');
      // eslint-disable-next-line no-console
      console.warn(`[machine-sync][tx-blocked] field=indent verified=false reason=${message}`);
      // eslint-disable-next-line no-console
      console.warn(`[machine-tx] blocked field=indent reason=${message}`);
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw new Error(message);
    }
    try {
      const numericLoadTime = Number(this.state.loadTime);
      const indentTimeoutMs =
        (Number.isFinite(numericLoadTime) ? numericLoadTime * 1000 : 0) + INDENT_FINISH_GRACE_MS;
      // eslint-disable-next-line no-console
      console.log(
        `[machine-impress-context] force=${this.state.force} loadTime=${this.state.loadTime} objective=${this.state.objective} turretAfterImpress=${turretAfterImpress} ascii=${JSON.stringify(frame.toString('ascii'))} hex="${frame.toString('hex')}" expectedRx=FINISH timeoutMs=${indentTimeoutMs}`
      );
      // Indent triggers physical motion. The original DLL decodes FINISH as
      // the completion acknowledgement, so keep the UI pending until RX proves it.
      this.updateTelemetry({
        lastTxAt: new Date().toISOString(),
        lastTxCommand: `indent force=${this.state.force} loadTime=${this.state.loadTime}`,
        indentStatus: 'running',
        indenting: true,
        machineStatus: 'indent-running',
        syncStatus: 'pending',
        syncMessage: 'TX indent=start',
      });
      await this.transmit('indent', frame, { awaitAck: true, timeoutMs: indentTimeoutMs });
      const completedByMachine = this.state.indentStatus === 'completed';
      this.setState(
        {
          indentStatus: completedByMachine ? 'completed' : 'running',
          indenting: !completedByMachine,
          machineStatus: completedByMachine ? 'indent-completed' : 'indent-running',
          lastError: undefined,
          syncStatus: 'synced',
          syncMessage: completedByMachine ? 'RX indent=completed' : 'TX ACK indent=start',
        },
        completedByMachine ? 'machine' : 'pc'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState(
        {
          indentStatus: 'error',
          indenting: false,
          machineStatus: 'indent-error',
          lastError: message,
          syncStatus: 'failed',
          syncMessage: message,
        },
        'system'
      );
      throw err;
    }
    return this.getState();
  }
}

export const hardnessMachineSerialService = new HardnessMachineSerialService();
