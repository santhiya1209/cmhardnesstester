import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { RegexParser } from '@serialport/parser-regex';
import {
  buildCommandForKey,
  buildStartIndentCommand,
  buildTurretCommand,
  getCommandVerification,
  getObjectiveForTurretSlot,
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
import {
  DEFAULT_OBJECTIVE_BRIGHTNESS_MAP,
  MachineSettingsModel,
  type MachineSettingsPayload,
} from '../../models/machine-settings';
import { upsertRows } from '../sqlite';
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
// Only these lenses carry a saved per-objective brightness; everything else
// (IND / center) is left untouched and never written to the map.
const BRIGHTNESS_OBJECTIVES = new Set(['10X', '40X']);
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
  private persistedCreatedAt: string | null = null;
  private persistLoadPromise: Promise<void> | null = null;
  private persistInFlight = false;
  private persistPending = false;
  // Debounce so a burst of machine-status ticks (force/lightness/loadTime/
  // objective/hardnessLevel) collapses into one narrow DB write. The UI state
  // is emitted immediately via setState — only the disk write is delayed.
  private persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly PERSIST_DEBOUNCE_MS = 1500;
  // Per-objective saved brightness (backend-owned). Seeded from defaults and
  // overlaid with the persisted row on load.
  private objectiveBrightnessMap: Record<string, number> = { ...DEFAULT_OBJECTIVE_BRIGHTNESS_MAP };
  // The objective the renderer last marked authoritative (10X / 40X). Only set
  // while a measurement lens is active — null for IND/center — so a lightness
  // edit is attributed to the right slot, and never saved on IND/center.
  private brightnessObjective: string | null = null;

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
        this.persistedCreatedAt = latest.createdAt;
        // Overlay persisted brightness onto the defaults, keeping only the
        // savable lenses so a stray IND/legacy key can never resurrect.
        if (latest.objectiveBrightnessMap) {
          const merged: Record<string, number> = { ...DEFAULT_OBJECTIVE_BRIGHTNESS_MAP };
          for (const key of BRIGHTNESS_OBJECTIVES) {
            const saved = latest.objectiveBrightnessMap[key];
            if (Number.isInteger(saved)) merged[key] = saved;
          }
          this.objectiveBrightnessMap = merged;
        }
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
      objectiveBrightnessMap: { ...this.objectiveBrightnessMap },
    };
  }

  private schedulePersist(): void {
    // Debounce: a timer is already pending → the flush will read the latest
    // state when it fires, so this tick is coalesced into that one write.
    if (this.persistDebounceTimer) {
      // eslint-disable-next-line no-console
      console.log('[db-persist-skip] reason=debounce-coalesced');
      return;
    }
    this.persistDebounceTimer = setTimeout(() => {
      this.persistDebounceTimer = null;
      void this.flushPersist();
    }, HardnessMachineSerialService.PERSIST_DEBOUNCE_MS);
  }

  /**
   * Persist machine settings via the NARROW per-collection write so only the
   * `machine_settings` table is touched. measurements / album_items (and their
   * base64 image blobs) are never rewritten by a machine-state change.
   */
  private async flushPersist(): Promise<void> {
    if (this.persistInFlight) {
      this.persistPending = true;
      return;
    }
    this.persistInFlight = true;
    try {
      await this.loadPersistedSettings();
      const payload = this.buildPersistPayload();
      const now = new Date().toISOString();
      const id = this.persistedSettingsId ?? randomUUID();
      const createdAt = this.persistedCreatedAt ?? now;
      const row = MachineSettingsModel.parse({ id, ...payload, createdAt, updatedAt: now });
      upsertRows('machineSettings', [row]);
      this.persistedSettingsId = id;
      this.persistedCreatedAt = createdAt;
      // eslint-disable-next-line no-console
      console.log(
        `[db-persist-machine-state] fields=force,lightness,loadTime,objective,hardnessLevel debounceMs=${HardnessMachineSerialService.PERSIST_DEBOUNCE_MS}`
      );
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
        void this.flushPersist();
      }
    }
  }

  /**
   * Replay saved lightness/load-time to the machine after a successful
   * connection so the physical display reflects the values stored in SQLite.
   * Fire-and-forget: failures are logged but never block the connect call.
   *
   * Startup-replay ACK-timeout guard:
   * Many industrial controllers do NOT echo a command when the value is already
   * at the requested level (no-change silent accept). If we push the same
   * lightness/loadTime that the machine is already displaying, the machine
   * sends no echo → waitForAck times out → setState({ lastError: 'ack timeout' })
   * appears in the status bar even though the serial connection is healthy.
   *
   * Three mitigations applied here:
   * 1. 1000 ms startup delay — lets the machine's initial AV-status batch
   *    arrive and update this.state with the machine's own current values.
   * 2. Skip replay when machine already reports the same value — avoids sending
   *    to a machine that will silently accept and not echo.
   * 3. finally block clears any ack-timeout error from the replay itself —
   *    a replay timeout is non-fatal; the connection remains usable.
   */
  private replayPersistedToMachine(): void {
    void (async () => {
      try {
        await this.loadPersistedSettings();
        if (!this.state.connected) {
          return;
        }
        // Capture the SQLite-saved values before the AV batch can overwrite them.
        const savedLightness = this.state.lightness;
        const savedLoadTime = this.state.loadTime;

        // Wait for the machine's initial AV-status burst to settle so that
        // this.state reflects the machine's actual current values.
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        if (!this.state.connected) {
          return;
        }
        // eslint-disable-next-line no-console
        console.log(
          `[machine-startup-sync] replay start savedLightness=${savedLightness} savedLoadTime=${savedLoadTime} machineCurrentLightness=${this.state.lightness} machineCurrentLoadTime=${this.state.loadTime}`
        );

        // Lightness: only send if machine's AV-batch-reported value differs.
        if (Number(this.state.lightness) !== Number(savedLightness)) {
          // eslint-disable-next-line no-console
          console.log(
            `[machine-startup-sync] lightness mismatch machine=${this.state.lightness} saved=${savedLightness} — sending replay`
          );
          try {
            await this.setControlValue('lightness', savedLightness);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(
              '[machine-startup-sync] lightness replay failed:',
              err instanceof Error ? err.message : String(err)
            );
          }
        } else {
          // eslint-disable-next-line no-console
          console.log(
            `[machine-startup-sync] lightness already matches machine=${this.state.lightness} — skipping`
          );
        }

        // LoadTime: only send if machine's AV-batch-reported value differs.
        if (Number(this.state.loadTime) !== Number(savedLoadTime)) {
          // eslint-disable-next-line no-console
          console.log(
            `[machine-startup-sync] loadTime mismatch machine=${this.state.loadTime} saved=${savedLoadTime} — sending replay`
          );
          try {
            await this.setControlValue('loadTime', savedLoadTime);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(
              '[machine-startup-sync] loadTime replay failed:',
              err instanceof Error ? err.message : String(err)
            );
          }
        } else {
          // eslint-disable-next-line no-console
          console.log(
            `[machine-startup-sync] loadTime already matches machine=${this.state.loadTime} — skipping`
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          '[machine-startup-sync] failed:',
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        // A replay ACK timeout is non-fatal — the connection is still alive.
        // Clear any ack-timeout error that the replay itself set so the status
        // bar shows "connected" rather than "Error: ack timeout".
        if (this.state.connected && this.state.lastError === 'ack timeout') {
          // eslint-disable-next-line no-console
          console.log('[machine-startup-sync] cleared ack-timeout from startup replay — connection is healthy');
          this.setState(
            { lastError: undefined, syncStatus: 'synced', syncMessage: 'connected' },
            'system'
          );
        }
      }
    })();
  }

  /**
   * Force the objective to 40X on every connect, ignoring the saved/last
   * objective. Sends UL3\r once and waits for the machine ACK (L3OK or OK);
   * only after a confirmed ACK is 40X marked machine-confirmed so the renderer
   * commits it. Runs even when the machine is already at 40X — a fresh UL3\r
   * re-confirms the slot (same re-send semantics as a user click). Right turret
   * slot = 3 = 40X = UL3\r. Fire-and-forget: failures are logged, never thrown.
   */
  private initStartupObjective(): void {
    void (async () => {
      try {
        if (!this.state.connected) return;
        const direction: TurretDirection = 'right'; // slot 3 → 40X → UL3\r
        const commandKey = getTurretCommandKey(direction);
        const slot = getTurretSlotForDirection(direction);
        const frame = buildTurretCommand(direction);
        if (!frame) {
          // eslint-disable-next-line no-console
          console.warn('[startup-objective-init] refused: UL3 command not built');
          return;
        }
        // eslint-disable-next-line no-console
        console.log(
          `[startup-objective-init] default=40X commandRequired=true command=${JSON.stringify(frame.toString('ascii'))}`
        );
        this.updateTelemetry({
          lastTxAt: new Date().toISOString(),
          lastTxCommand: `turret=${direction} slot=${slot}`,
          syncStatus: 'pending',
          syncMessage: 'TX startup objective=40X',
        });
        await this.transmit(commandKey, frame, {
          awaitAck: true,
          expectedValue: slot,
          reason: 'startup-default',
        });
        this.pendingAckResolution = null;
        const ack =
          (this.state.lastRxFrame?.ascii ?? '').replace(/[\r\n]+$/, '').trim().toUpperCase() || 'OK';
        // eslint-disable-next-line no-console
        console.log(`[machine-objective-rx] objective=40X ack=${ack}`);
        // ACK confirmed → mark 40X machine-confirmed so the renderer's
        // confirmed-RX path commits it. Set explicitly because a bare OK reply
        // carries no slot to decode (only L3OK does), so we cannot rely on the
        // frame handler having recorded the objective.
        this.setState(
          {
            objective: '40X',
            confirmedObjectiveFromMachine: '40X',
            lastObjectiveRx: ack,
            lastObjectivePhysicalCheck: 'unknown',
            lastError: undefined,
            syncStatus: 'synced',
            syncMessage: 'startup objective=40X',
          },
          'machine'
        );
        // eslint-disable-next-line no-console
        console.log('[startup-objective-confirmed] objective=40X');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          '[startup-objective-init] failed:',
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
    // Every connect forces the objective back to 40X (UL3\r), ignoring the
    // saved/last objective. Queued before the lightness/load-time replay so the
    // turret command goes out first. Fire-and-forget — non-fatal for connect.
    this.initStartupObjective();
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
        // Some machines send an AV-status batch with objective info but WITHOUT
        // the explicit L<n> turret-slot marker (e.g. AV08T05K0005 vs
        // AV08T05K0005L1OK). Without this extra check, a pending turretLeft/Right
        // command would never resolve via state-batch — causing a 5s ACK timeout
        // even though the machine clearly reported the objective change.
        const expectedObjectiveFromTurretBatch =
          this.pendingAckField !== null &&
          String(this.pendingAckField).startsWith('turret') &&
          frame.values.objective !== undefined;
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
            : expectedObjectiveFromTurretBatch
              ? frame.values.objective
              : frame.values[this.pendingAckField as MachineControlKey];
          const matched = expectedEcho || expectedTurretEcho || expectedObjectiveFromTurretBatch;
          // eslint-disable-next-line no-console
          console.log(
            `[machine-ack-match] field=${this.pendingAckField} expected=${this.pendingAckExpectedValue ?? ''} received=${received ?? ''} matched=${matched}`
          );
        }
        this.setState(fullPatch, 'machine');
        if (expectedEcho || expectedTurretEcho || expectedObjectiveFromTurretBatch) {
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
          console.log(`[machine-objective-rx] raw=${rxAscii} parsed=L${frame.slot}OK→${frame.objective}`);
          // eslint-disable-next-line no-console
          console.log(
            `[machine-objective-ack] objective=${frame.objective} ok=true reason=L${frame.slot}OK`
          );
          // eslint-disable-next-line no-console
          console.log(`[objective-active] objective=${frame.objective} source=ack`);
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
          const matched = expectedTurretEcho || expectedObjectiveEcho;
          // eslint-disable-next-line no-console
          console.log(
            `[machine-ack-match] field=${this.pendingAckField} expected=${this.pendingAckExpectedValue ?? ''} received=${received} matched=${matched}`
          );
          if (!matched) {
            // Objective echo arrived while a different ACK is pending — log and keep waiting.
            // eslint-disable-next-line no-console
            console.log(
              `[machine-ack-unrelated] pendingField=${this.pendingAckField} received=${rxFrame.ascii.replace(/[\r\n]+$/, '')} action=continue-wait`
            );
          }
        }
        this.setState(patch, 'machine');
        if (expectedTurretEcho || expectedObjectiveEcho) {
          // eslint-disable-next-line no-console
          console.log(
            `[machine-objective-ack-match] value=${frame.objective ?? frame.slot} received=${rxFrame.ascii.replace(/[\r\n]+$/, '')} matched=true`
          );
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
          if (frame.key === 'lightness') {
            // eslint-disable-next-line no-console
            console.log(
              `[machine-lightness-ack-match] expected=${this.pendingAckExpectedValue != null ? (lightnessFrameForValue(this.pendingAckExpectedValue) ?? this.pendingAckExpectedValue) : ''} received=${lightnessFrameForValue(frame.value) ?? frame.value} matched=true`
            );
          }
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
        const lastRx = this.state.lastRxFrame?.ascii.replace(/[\r\n]+$/, '').trim() ?? 'none';
        const txObjective = String(field).startsWith('turret')
          ? (getObjectiveForTurretSlot(String(expectedValue ?? '')) ?? '')
          : '';
        // eslint-disable-next-line no-console
        console.error(
          `[machine-ack-timeout] id=${commandId} field=${field}${txObjective ? ` objective=${txObjective}` : ''} expected=${this.formatAckFrame(field, expectedValue)} lastReceived=${lastRx}`
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
    opts: {
      awaitAck?: boolean;
      expectedValue?: string | number;
      timeoutMs?: number;
      reason?: string;
    } = {}
  ): Promise<void> {
    const pending = this.pendingAckField;
    if (pending) {
      // eslint-disable-next-line no-console
      console.log(
        `[machine-command-queue] pending=${pending} new=${field} action=queued`
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `[machine-command-queue] pending=none new=${field} action=send-now`
      );
    }
    const run = () => this.transmitNow(field, frame, opts);
    const queued = this.txQueue.then(run, run);
    this.txQueue = queued.catch(() => undefined);
    return queued;
  }

  private async transmitNow(
    field: MachineCommandKey,
    frame: Buffer,
    opts: {
      awaitAck?: boolean;
      expectedValue?: string | number;
      timeoutMs?: number;
      reason?: string;
    } = {}
  ): Promise<void> {
    if (!this.port || !this.state.connected) {
      throw new Error('machine not connected');
    }
    const commandId = ++this.commandSequence;

    // eslint-disable-next-line no-console
    console.log(`[machine-tx] field=${field} command=${JSON.stringify(frame.toString('ascii'))} hex=${frame.toString('hex')}`);

    // Only present for backend-initiated sends (e.g. startup-default); user
    // clicks pass no reason so their objective-tx log line is unchanged.
    const reasonSuffix = opts.reason ? ` reason=${opts.reason}` : '';
    if (field === 'objective') {
      // Stash on telemetry so the UI can correlate TX vs RX for the diagnostic.
      const codeAscii = frame.toString('ascii').replace(/\r$/, '');
      this.updateTelemetry({ lastObjectiveTx: codeAscii });
      // eslint-disable-next-line no-console
      console.log(
        `[machine-objective-tx] objective=${opts.expectedValue ?? ''} command=${JSON.stringify(frame.toString('ascii'))} hex=${frame.toString('hex')}${reasonSuffix}`
      );
    } else if (String(field).startsWith('turret')) {
      // Turret buttons emit UL<n>\r on the wire (left=UL1=10X, right=UL3=40X).
      // Log under the same tag so the TX is visible whichever control the
      // operator used. Map slot back to objective name for human readability.
      const slot = opts.expectedValue !== undefined ? String(opts.expectedValue) : '';
      const txObjective = slot ? (getObjectiveForTurretSlot(slot) ?? `slot=${slot}`) : field;
      // eslint-disable-next-line no-console
      console.log(
        `[machine-objective-tx] objective=${txObjective} command=${JSON.stringify(frame.toString('ascii'))} hex=${frame.toString('hex')}${reasonSuffix}`
      );
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
      // A lightness edit while a measurement lens is active is saved into that
      // lens's brightness slot. No-op for IND/center (brightnessObjective null).
      if (key === 'lightness') {
        this.maybeSaveObjectiveBrightness(Number(this.state.lightness));
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
   * Save the given lightness into the active lens's brightness slot. Gated on
   * brightnessObjective being a savable lens (10X/40X) so IND/center edits are
   * ignored. Schedules the narrow machine_settings write.
   */
  private maybeSaveObjectiveBrightness(lightness: number): void {
    const objective = this.brightnessObjective;
    if (objective === null || !BRIGHTNESS_OBJECTIVES.has(objective)) return;
    if (!Number.isInteger(lightness) || lightness < LIGHTNESS_MIN || lightness > LIGHTNESS_MAX) {
      return;
    }
    if (this.objectiveBrightnessMap[objective] === lightness) return;
    this.objectiveBrightnessMap = { ...this.objectiveBrightnessMap, [objective]: lightness };
    // eslint-disable-next-line no-console
    console.log(`[machine-objective-brightness-save] objective=${objective} lightness=${lightness}`);
    this.schedulePersist();
  }

  /**
   * Apply the saved brightness for the renderer's authoritative objective.
   * 10X/40X: record the slot and push its saved lightness to the machine.
   * Any other value (IND/center): clear the slot and leave lightness untouched.
   * Failures to transmit are logged, never thrown — applying brightness must
   * not break the objective-change flow that triggered it.
   */
  async applyObjectiveBrightness(objective: string): Promise<MachineState> {
    const normalized = String(objective).trim().toUpperCase();
    if (!BRIGHTNESS_OBJECTIVES.has(normalized)) {
      this.brightnessObjective = null;
      return this.getState();
    }
    this.brightnessObjective = normalized;
    const saved = this.objectiveBrightnessMap[normalized];
    if (!Number.isInteger(saved)) return this.getState();
    // eslint-disable-next-line no-console
    console.log(`[objective-brightness] objective=${normalized} brightness=${saved} source=objective-ack`);
    if (!this.state.connected) return this.getState();
    if (Number(this.state.lightness) === saved) return this.getState();
    // eslint-disable-next-line no-console
    console.log(`[brightness-apply] objective=${normalized} brightness=${saved}`);
    try {
      await this.setControlValue('lightness', saved);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[machine-objective-brightness] apply failed objective=${normalized} lightness=${saved}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
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
    const expectedObjective = getObjectiveForTurretSlot(slot);

    // User-initiated turret/objective click: ALWAYS transmit UL<n>\r, even when
    // the turret is already at this slot. The machine re-executes the command
    // and re-emits its sound/ACK on every press, which the operator expects.
    // The prior silent-accept guard returned early here when the objective was
    // unchanged, so a repeat click on the active objective sent nothing (no
    // sound). It is removed: sendTurret is reached only from POST
    // /machine/turret, so every call is a user click. ACK handling below is
    // unchanged — the normal transmit({ awaitAck }) path (and its timeout) runs
    // on every press exactly as for a fresh objective change.
    const sameAsCurrent =
      !!expectedObjective &&
      this.state.turretPosition === direction &&
      this.state.confirmedObjectiveFromMachine === expectedObjective;
    if (expectedObjective) {
      // eslint-disable-next-line no-console
      console.log(
        `[machine-objective-click] objective=${expectedObjective} sameAsCurrent=${sameAsCurrent} forceSend=true`
      );
    }

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
      // Apply saved brightness only after turret ACK is confirmed (L1OK/L10K received),
      // not from the frontend watcher which fires on state-batch before turret is done.
      if (expectedObjective) {
        // eslint-disable-next-line no-console
        console.log(
          `[machine-objective-brightness] apply-after-objective-confirmed objective=${expectedObjective}`
        );
        await this.applyObjectiveBrightness(expectedObjective);
      }
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
