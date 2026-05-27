import { EventEmitter } from 'node:events';
import { RegexParser } from '@serialport/parser-regex';
import {
  buildCommandForKey,
  buildStartIndentCommand,
  buildTurretCommand,
  getCommandVerification,
  getTurretCommandKey,
  getTurretSlotForDirection,
  isCommandVerified,
  forceCodeForValue,
  lightnessFrameForValue,
  loadTimeFrameForValue,
  objectiveFrameForValue,
  parseFrame,
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
  // SerialPort extends Duplex, so pipe() is inherited from the Node stream
  // API. We narrow the return to RegexParser since that's the only thing we
  // pipe into here. The serialport TS types in v13 don't ship a permissive
  // shape, so we declare what we use.
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
  console.error('[machine-service] serialport module not available:', serialPortLoadError);
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
const ALLOWED_OBJECTIVES = new Set(['2.5X', '5X', '10X', 'IND', '20X', '40X', '50X']);
const ALLOWED_HARDNESS_LEVELS = new Set(['Low', 'Middle', 'High']);
const LIGHTNESS_MIN = 0;
const LIGHTNESS_MAX = 10;
const LOAD_TIME_MIN = 1;
const LOAD_TIME_MAX = 99;
const INDENT_FINISH_GRACE_MS = 45_000;

class HardnessMachineSerialService extends EventEmitter {
  private state: MachineState = { ...DEFAULT_STATE };
  private port: SerialPortInstance | null = null;
  // RegexParser is a Transform stream piped off the port. It assembles
  // complete frames delimited by \r, \n, or '!' and emits one 'data' event
  // per frame, so handleFrame() never has to deal with partial chunks.
  private parser: RegexParser | null = null;
  private pendingAckField: MachineCommandKey | null = null;
  private pendingAckResolution: 'generic-ack' | 'state-echo' | null = null;
  private commandSequence = 0;
  // Set when an impress command is sent with turretAfterImpress=true. The next
  // machine-confirmed objective RX (L1OK/L2OK) clears this flag.
  private pendingTurretAfterImpressConfirm = false;
  private pendingAckExpectedValue: string | number | undefined;
  // Command id of the in-flight ack wait, for correlating ack-check / resolved
  // / timeout log lines with the originating TX.
  private pendingAckCommandId: number | null = null;
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
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
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
        console.error(
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
          return;
        }
        const lightness = this.state.lightness;
        const loadTime = this.state.loadTime;
        try {
          await this.setControlValue('lightness', lightness);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            '[machine-startup-sync] lightness replay failed:',
            err instanceof Error ? err.message : String(err)
          );
        }
        try {
          await this.setControlValue('loadTime', loadTime);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            '[machine-startup-sync] loadTime replay failed:',
            err instanceof Error ? err.message : String(err)
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
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
      // eslint-disable-next-line no-console
      console.error(`[machine-service] error: ${nextError}`);
    }
    this.emit('state', this.state);
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

  private machineFieldName(key: MachineCommandKey): string {
    return key === 'force' ? 'load' : key;
  }

  private unverifiedMessage(field: MachineCommandKey): string {
    return `RS232 command for "${field}" is not verified; writes are disabled until the official protocol bytes are supplied.`;
  }

  private logProtocolBlocked(field: MachineCommandKey): void {
    // eslint-disable-next-line no-console
    console.warn(`[machine-tx] blocked waiting-for-protocol-verification field=${field}`);
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
        resolve();
      });
    });

    // Byte-level visibility — fires once per OS-level read. Chunks may be
    // partial frames; that's fine, we only use this for raw-wire diagnostics.
    portInstance.on('data', (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) return;
      // eslint-disable-next-line no-console
      console.log(
        `[machine-rx-raw] bytes=${chunk.length} hex=${chunk.toString('hex')} ascii=${JSON.stringify(chunk.toString('ascii'))}`
      );
    });
    // Frame-level — RegexParser splits on any of our terminators (\r, \n, !)
    // and delivers one complete frame per 'data' event. No buffering math
    // lives in the service anymore.
    const parser = portInstance.pipe(new RegexParser({ regex: /\r\n|\r|\n|!/ }));
    parser.on('data', (frame: Buffer | string) => {
      // RegexParser emits terminator-stripped STRINGS (encoding 'utf8'), having
      // already reassembled split chunks (e.g. 'K' then '0004\r'). Normalise to
      // a Buffer so handleFrame always receives bytes — the previous
      // Buffer.isBuffer guard silently dropped every (string) frame, so no ack
      // ever resolved.
      const frameBuf = Buffer.isBuffer(frame) ? frame : Buffer.from(String(frame), 'ascii');
      if (frameBuf.length === 0) return;
      // eslint-disable-next-line no-console
      console.log(`[machine-frame-assembled] frame=${JSON.stringify(frameBuf.toString('ascii'))}`);
      // eslint-disable-next-line no-console
      console.log(
        `[machine-rx-frame] ascii=${JSON.stringify(frameBuf.toString('ascii'))} hex=${frameBuf.toString('hex')}`
      );
      this.handleFrame(frameBuf);
    });
    this.parser = parser;
    portInstance.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[machine-service] port error:', message);
      this.setState({ lastError: message }, 'system');
    });
    portInstance.on('close', () => {
      this.port = null;
      if (this.parser) {
        this.parser.removeAllListeners('data');
        this.parser = null;
      }
      this.setState(
        { connected: false, port: null, indenting: false, machineStatus: 'disconnected' },
        'system'
      );
    });

    this.port = portInstance;
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

  private handleFrame(rawFrame: Buffer): void {
    const rxAt = new Date().toISOString();
    const rxFrame = this.frameLog(rawFrame);
    const frame = parseFrame(rawFrame);

    // eslint-disable-next-line no-console
    console.log(`[machine-rx] raw=${JSON.stringify(rxFrame.ascii)}`);
    // eslint-disable-next-line no-console
    console.log(
      `[machine-rx-handle] kind=${frame.kind} pendingField=${this.pendingAckField ?? 'none'} ascii=${JSON.stringify(rxFrame.ascii)}`
    );

    // ACK matcher visibility: every assembled frame that arrives while a TX is
    // awaiting confirmation is checked here (matching is decided per-frame-kind
    // below). Logs even for 'unknown' frames so a non-matching reply is visible
    // instead of silently letting the wait time out.
    if (this.pendingAckField !== null) {
      const receivedAscii = rxFrame.ascii.replace(/[\r\n]+$/, '');
      // eslint-disable-next-line no-console
      console.log(
        `[machine-ack-check] id=${this.pendingAckCommandId ?? ''} field=${this.pendingAckField} expected=${this.formatAckFrame(this.pendingAckField, this.pendingAckExpectedValue)} received=${receivedAscii}`
      );
    }

    if (frame.kind === 'unknown') {
      this.updateTelemetry({ lastRxAt: rxAt, lastRxTime: rxAt, lastRxFrame: rxFrame });
      return;
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
          // eslint-disable-next-line no-console
          console.log(`[machine-objective-rx] raw=${rxAscii}`);
          // eslint-disable-next-line no-console
          console.log(
            `[machine-objective-ack] objective=${String(frame.values.objective)} ok=true reason=${rxAscii}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[machine-objective-state-update] confirmedObjective=${String(frame.values.objective)}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[machine-sync][objective-confirmed] objective=${String(frame.values.objective)}`
          );
          if (this.pendingTurretAfterImpressConfirm) {
            this.pendingTurretAfterImpressConfirm = false;
          }
        }
        // Machine-panel origin: log each synced field whose value actually
        // changed (dedupe identical repeats in the AV status batch).
        for (const k of ['force', 'lightness', 'loadTime', 'objective'] as const) {
          const incoming = frame.values[k];
          if (incoming !== undefined && String(this.state[k]) !== String(incoming)) {
            // eslint-disable-next-line no-console
            console.log(`[machine-sync][machine-change] field=${k} value=${incoming}`);
          }
        }
        if (
          frame.turretDirection !== undefined &&
          this.state.turretPosition !== frame.turretDirection
        ) {
          // eslint-disable-next-line no-console
          console.log(`[machine-sync][machine-change] field=turret value=${frame.turretDirection}`);
        }
        for (const [k, v] of Object.entries(frame.values)) {
          // eslint-disable-next-line no-console
          console.log(`[machine-rx-parse] field=${k} value=${v}`);
        }
        if (this.pendingAckField !== null) {
          const received = expectedTurretEcho
            ? frame.turretSlot
            : frame.values[this.pendingAckField as MachineControlKey];
          // eslint-disable-next-line no-console
          console.log(
            `[machine-ack-match] field=${this.pendingAckField} expected=${this.pendingAckExpectedValue ?? ''} received=${received ?? ''} matched=${expectedEcho || expectedTurretEcho}`
          );
        }
        this.setState(fullPatch, 'machine');
        if (expectedEcho || expectedTurretEcho) {
          this.pendingAckResolution = 'state-echo';
          this.emit('ack');
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
          console.log(`[machine-rx-parse] field=objective value=${frame.objective}`);
          if (String(this.state.objective) !== String(frame.objective)) {
            // eslint-disable-next-line no-console
            console.log(`[machine-sync][machine-change] field=objective value=${frame.objective}`);
          }
          patch.objective = frame.objective;
          patch.lastObjectiveRx = rxAscii;
          patch.confirmedObjectiveFromMachine = frame.objective;
          // eslint-disable-next-line no-console
          console.log(`[machine-objective-rx] raw=${rxAscii}`);
          // eslint-disable-next-line no-console
          console.log(
            `[machine-objective-ack] objective=${frame.objective} ok=true reason=L${frame.slot}OK`
          );
          // eslint-disable-next-line no-console
          console.log(`[machine-objective-state-update] confirmedObjective=${frame.objective}`);
          // eslint-disable-next-line no-console
          console.log(`[machine-sync][objective-confirmed] objective=${frame.objective}`);
          if (this.pendingTurretAfterImpressConfirm) {
            this.pendingTurretAfterImpressConfirm = false;
          }
          patch.lastObjectivePhysicalCheck = 'unknown';
          patch.syncMessage = `RX objective=${frame.objective} turret slot=${frame.slot}`;
        }
        if (frame.direction !== undefined && this.state.turretPosition !== frame.direction) {
          // eslint-disable-next-line no-console
          console.log(`[machine-sync][machine-change] field=turret value=${frame.direction}`);
        }
        if (this.pendingAckField !== null) {
          const received =
            this.pendingAckField === 'objective'
              ? frame.objective ?? frame.slot
              : frame.slot;
          // eslint-disable-next-line no-console
          console.log(
            `[machine-ack-match] field=${this.pendingAckField} expected=${this.pendingAckExpectedValue ?? ''} received=${received} matched=${expectedTurretEcho || expectedObjectiveEcho}`
          );
        }
        this.setState(patch, 'machine');
        if (expectedTurretEcho || expectedObjectiveEcho) {
          this.pendingAckResolution = 'state-echo';
          this.emit('ack');
        }
        break;
      }
      case 'state-update': {
        const rxField = this.machineFieldName(frame.key);
        // Field-level match is enough — the machine's echoed value is the
        // truth. If we asked for 1kgf and got C08 back, the dropdown
        // updates to the real value instead of timing out.
        const expectedEcho = this.pendingAckField === frame.key;
        // eslint-disable-next-line no-console
        console.log(`[machine-rx-parse] field=${frame.key} value=${frame.value}`);
        if (this.pendingAckField !== null) {
          // Show the machine frame form for force (Cxx) and lightness (Kxxxx);
          // other fields are already human-readable.
          const toDisplay = (v: string | number | undefined): string | number => {
            if (v === undefined) return '';
            if (frame.key === 'force') return forceCodeForValue(v) ?? v;
            if (frame.key === 'lightness') return lightnessFrameForValue(v) ?? v;
            if (frame.key === 'loadTime') return loadTimeFrameForValue(v) ?? v;
            return v;
          };
          const expectedDisplay = toDisplay(this.pendingAckExpectedValue);
          const receivedDisplay = toDisplay(frame.value);
          // eslint-disable-next-line no-console
          console.log(
            `[machine-ack-match] field=${frame.key} expected=${expectedDisplay} received=${receivedDisplay} matched=${expectedEcho}`
          );
        }
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
            this.pendingTurretAfterImpressConfirm = false;
          }
        }
        // Machine-panel origin: log a sync breadcrumb only when the value
        // actually changed (dedupe identical repeats) for the synced fields.
        if (
          (frame.key === 'force' ||
            frame.key === 'lightness' ||
            frame.key === 'loadTime' ||
            frame.key === 'objective') &&
          String(this.state[frame.key]) !== String(frame.value)
        ) {
          // eslint-disable-next-line no-console
          console.log(`[machine-sync][machine-change] field=${frame.key} value=${frame.value}`);
        }
        this.setState(patch, 'machine');
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
          this.pendingAckResolution = 'state-echo';
          this.emit('ack');
        }
        break;
      }
      case 'indent-status':
        if (this.state.indentStatus !== frame.status) {
          // eslint-disable-next-line no-console
          console.log(`[machine-sync][machine-change] field=indent value=${frame.status}`);
        }
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
            // eslint-disable-next-line no-console
            console.log(
              `[machine-ack-match] field=indent expected=start received=FINISH matched=true`
            );
            this.pendingAckResolution = 'state-echo';
            this.emit('ack');
          } else if (frame.status === 'error') {
            this.emit('nak', frame.message ?? 'indent error');
          }
        }
        break;
      case 'ack': {
        const isIndentAck = this.pendingAckField === 'indent';
        const pendingField = this.pendingAckField;
        const lastTxCommand = String(this.state.lastTxCommand ?? '');
        const objectiveAck =
          pendingField === 'objective' ||
          String(pendingField ?? '').startsWith('turret') ||
          lastTxCommand.startsWith('objective=') ||
          lastTxCommand.startsWith('turret=');
        if (objectiveAck) {
          // Accept a bare generic OK as objective/turret confirmation, alongside
          // the specific L<n>OK echo. OK carries no slot, so commit the
          // REQUESTED objective; if the machine also sends an L<n>OK it decodes
          // the real slot and overrides this (the L<n>OK handlers run first when
          // it arrives first). Either reply resolves the ack so the dropdown and
          // Auto Measure update instead of timing out and stranding the UI.
          const rxAscii =
            rxFrame.ascii.replace(/[\r\n]+$/, '').trim().toUpperCase() || 'ACK';
          const requested = this.pendingAckExpectedValue;
          // eslint-disable-next-line no-console
          console.log(`[machine-objective-rx] raw=${rxAscii}`);
          // eslint-disable-next-line no-console
          console.log(
            `[machine-ack-match] field=${pendingField} expected=${this.formatAckFrame(pendingField, requested)} received=${rxAscii} matched=true`
          );
          // eslint-disable-next-line no-console
          console.log(`[machine-objective-ack] objective=${requested ?? ''} ok=true reason=${rxAscii}`);
          const patch: Partial<MachineState> = {
            lastRxAt: rxAt,
            lastRxTime: rxAt,
            lastRxFrame: rxFrame,
            machineStatus: 'ack',
            syncStatus: 'synced',
            syncMessage: 'ACK received',
            lastError: undefined,
          };
          if (pendingField === 'objective' && requested !== undefined) {
            patch.objective = String(requested);
            patch.confirmedObjectiveFromMachine = String(requested);
            patch.lastObjectiveRx = rxAscii;
            patch.lastObjectivePhysicalCheck = 'unknown';
            // eslint-disable-next-line no-console
            console.log(`[machine-objective-state-update] confirmedObjective=${requested}`);
            // eslint-disable-next-line no-console
            console.log(`[machine-sync][objective-confirmed] objective=${requested}`);
          }
          this.setState(patch, 'machine');
          this.pendingAckResolution = 'state-echo';
          this.emit('ack');
          break;
        }
        if (pendingField !== null) {
          const received = rxFrame.ascii.replace(/[\r\n]+$/, '') || 'ACK';
          // eslint-disable-next-line no-console
          console.log(
            `[machine-ack-match] field=${pendingField} expected=${this.pendingAckExpectedValue ?? ''} received=${received} matched=true`
          );
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
        this.pendingAckResolution = 'generic-ack';
        this.emit('ack');
        break;
      }
      case 'nak':
        // eslint-disable-next-line no-console
        console.error(`[machine-service] NAK: ${frame.message ?? 'machine NAK'}`);
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
    }
  }

  /**
   * Render the expected value in the machine's echo-frame form for log
   * clarity: force→Cxx, lightness→Kxxxx, loadTime→Txx. Other fields fall back
   * to the raw value (objective/turret carry their value directly).
   */
  private formatAckFrame(
    field: MachineCommandKey | null,
    value: string | number | undefined
  ): string {
    if (value === undefined || value === null) return '';
    if (field === 'force') return forceCodeForValue(value) ?? String(value);
    if (field === 'lightness') return lightnessFrameForValue(value) ?? String(value);
    if (field === 'loadTime') return loadTimeFrameForValue(value) ?? String(value);
    if (field === 'objective') return objectiveFrameForValue(value) ?? String(value);
    return String(value);
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
    commandId: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.off('ack', onAck);
        this.off('nak', onNak);
        if (this.pendingAckField === field) {
          this.pendingAckField = null;
          this.pendingAckExpectedValue = undefined;
          this.pendingAckCommandId = null;
        }
      };
      const onAck = () => {
        // eslint-disable-next-line no-console
        console.log(`[machine-ack-resolved] id=${commandId} field=${field}`);
        cleanup();
        resolve();
      };
      const onNak = (message: string) => {
        cleanup();
        reject(new Error(message));
      };
      const timer = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.error(
          `[machine-ack-timeout] id=${commandId} field=${field} expected=${this.formatAckFrame(field, expectedValue)}`
        );
        cleanup();
        reject(new Error('ack timeout'));
      }, timeoutMs);
      this.pendingAckField = field;
      this.pendingAckExpectedValue = expectedValue;
      this.pendingAckResolution = null;
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

    // eslint-disable-next-line no-console
    console.log(`[machine-tx] field=${field} command=${JSON.stringify(frame.toString('ascii'))}`);

    if (field === 'objective') {
      // Stash on telemetry so the UI can correlate TX vs RX for the diagnostic.
      const codeAscii = frame.toString('ascii').replace(/\r$/, '');
      this.updateTelemetry({ lastObjectiveTx: codeAscii });
      // eslint-disable-next-line no-console
      console.log(
        `[machine-objective-tx] objective=${opts.expectedValue ?? ''} command=${JSON.stringify(frame.toString('ascii'))} hex=${frame.toString('hex')}`
      );
    } else if (String(field).startsWith('turret')) {
      // The turret buttons also emit UL<n> on the wire (left=UL1=10X,
      // right=UL3=40X). Log them under the same tag so the TX is visible
      // whichever control the operator used.
      const codeAscii = frame.toString('ascii').replace(/\r$/, '');
      // eslint-disable-next-line no-console
      console.log(`[machine-objective-tx] command=${codeAscii}`);
    }

    // Pre-arm ack listener BEFORE the write completes — some machines reply
    // before the write callback fires.
    const ackPromise = opts.awaitAck
      ? this.waitForAck(field, opts.expectedValue, opts.timeoutMs ?? TX_TIMEOUT_MS, commandId)
      : null;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('tx timeout'));
      }, TX_TIMEOUT_MS);
      this.port?.write(frame, (err) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }
        // Force the OS buffer to flush before we start the ack countdown,
        // otherwise on slow USB-serial adapters the bytes can sit in the
        // driver queue past the timeout window.
        this.port?.drain((drainErr) => {
          clearTimeout(timer);
          if (drainErr) {
            reject(drainErr);
            return;
          }
          resolve();
        });
      });
    });

    if (ackPromise) {
      await ackPromise;
    }
  }

  async setControlValue(key: MachineControlKey, value: string | number): Promise<MachineState> {
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
      this.logProtocolBlocked(key);
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
      this.logProtocolBlocked(key);
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
      // eslint-disable-next-line no-console
      console.log(`[machine-sync][pc-change] field=${key} value=${normalizedValue}`);
      const txAt = new Date().toISOString();
      this.updateTelemetry({
        lastTxAt: txAt,
        lastTxCommand: `${machineField}=${normalizedValue}`,
        syncStatus: 'pending',
        syncMessage: `TX ${machineField}=${normalizedValue}`,
      });
      await this.transmit(key, frame, {
        awaitAck: true,
        expectedValue: normalizedValue,
      });
      const ackResolution = this.pendingAckResolution;
      this.pendingAckResolution = null;
      // eslint-disable-next-line no-console
      console.log(`[machine-ack] field=${key} ok=true`);
      const confirmedByMachine =
        ackResolution === 'state-echo' && this.state.lastUpdatedBy === 'machine';
      if (confirmedByMachine) {
        this.setState(
          {
            lastError: undefined,
            syncStatus: 'synced',
            syncMessage: `TX ACK ${machineField}=${this.state[key]}`,
          },
          'machine'
        );
      } else {
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
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.log(`[machine-ack] field=${key} ok=false`);
      // eslint-disable-next-line no-console
      console.error(`[machine-service] set ${key}=${normalizedValue} failed: ${message}`);
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
    this.setState({ lastObjectivePhysicalCheck: 'manual' }, 'system');
    return this.getState();
  }

  async sendTurret(direction: TurretDirection): Promise<MachineState> {
    if (!this.state.connected) {
      const message = 'machine not connected';
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw new Error(message);
    }

    const commandKey = getTurretCommandKey(direction);
    const slot = getTurretSlotForDirection(direction);
    const verified = isCommandVerified(commandKey);
    const frame = verified ? buildTurretCommand(direction) : null;

    if (!verified || !frame) {
      const message = `Turret ${direction} command is not verified; refusing to transmit speculative bytes.`;
      this.logProtocolBlocked(commandKey);
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

    try {
      const txAt = new Date().toISOString();
      // eslint-disable-next-line no-console
      console.log(`[machine-sync][pc-change] field=turret value=${direction}`);
      this.updateTelemetry({
        lastTxAt: txAt,
        lastTxCommand: `turret=${direction} slot=${slot}`,
        syncStatus: 'pending',
        syncMessage: `TX turret=${direction} slot=${slot}`,
      });
      await this.transmit(commandKey, frame, {
        awaitAck: true,
        expectedValue: slot,
      });
      this.pendingAckResolution = null;
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
      // eslint-disable-next-line no-console
      console.error(`[machine-service] turret ${direction} failed: ${message}`);
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw err;
    }
    return this.getState();
  }

  async startIndent(): Promise<MachineState> {
    if (!this.state.connected) {
      const message = 'machine not connected';
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw new Error(message);
    }
    if (this.state.indentStatus === 'started' || this.state.indentStatus === 'running') {
      return this.getState();
    }
    if (!isCommandVerified('indent')) {
      const message = this.unverifiedMessage('indent');
      this.logProtocolBlocked('indent');
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw new Error(message);
    }
    let turretAfterImpress = true;
    try {
      const all = await autoMeasureSettingsService.getAll();
      const settings = all[0] ?? null;
      if (settings) {
        turretAfterImpress = settings.turretAfterImpress !== false;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[machine-service] indent settings read failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (turretAfterImpress) {
      this.pendingTurretAfterImpressConfirm = true;
    } else {
      this.pendingTurretAfterImpressConfirm = false;
    }
    const frame = buildStartIndentCommand(this.state.force, this.state.loadTime, turretAfterImpress);
    if (!frame) {
      const message = this.unverifiedMessage('indent');
      this.logProtocolBlocked('indent');
      this.setState({ lastError: message, syncStatus: 'failed', syncMessage: message }, 'system');
      throw new Error(message);
    }
    try {
      const numericLoadTime = Number(this.state.loadTime);
      const indentTimeoutMs =
        (Number.isFinite(numericLoadTime) ? numericLoadTime * 1000 : 0) + INDENT_FINISH_GRACE_MS;
      // Indent triggers physical motion. The original DLL decodes FINISH as
      // the completion acknowledgement, so keep the UI pending until RX proves it.
      // eslint-disable-next-line no-console
      console.log(`[machine-sync][pc-change] field=indent value=start`);
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
      this.pendingAckResolution = null;
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
      // eslint-disable-next-line no-console
      console.error(`[machine-service] indent failed: ${message}`);
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
