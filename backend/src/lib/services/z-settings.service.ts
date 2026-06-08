import { randomUUID } from 'node:crypto';
import { readCollection } from '../db';
import { upsertRows } from '../sqlite';
import {
  DEFAULT_Z_AXIS_SETTINGS,
  type ImageSelection,
  type ZAxisSettings,
  type ZAxisSettingsPayload,
} from '../../models/z-axis-settings';

/**
 * Backend-owned source of truth for the Z Axis settings SINGLETON. The renderer
 * never holds the authoritative copy — it reads this service's state over IPC,
 * Confirm persists, Preview applies only the image-selection in memory, Cancel
 * reverts.
 *
 * NOTHING here touches Z hardware: there is no confirmed Z serial protocol, so
 * these values are stored config only. `pulsePerMm` would convert mm→pulses for a
 * confirmed pulse-based Z move (pulses = mm * pulsePerMm) — but no such operation
 * exists yet, so the factor is persisted and never applied.
 */
class ZSettingsService {
  // The active, authoritative settings. Null until load() runs at startup.
  private current: ZAxisSettings | null = null;

  /**
   * Load the singleton from the DB once at startup. If no row exists yet, seed
   * it from the reference defaults and persist so a stable id/row exists. A
   * read failure is non-fatal — it falls back to in-memory defaults (unsaved)
   * and logs, rather than crashing startup.
   */
  async load(): Promise<ZAxisSettings> {
    try {
      const rows = (await readCollection('zAxisSettings')) as ZAxisSettings[];
      const row = rows[0];
      if (row) {
        this.current = row;
        // eslint-disable-next-line no-console
        console.log(
          `[z-settings-load] source=db imageSelection=${row.imageSelection} pulsePerMm=${row.pulsePerMm} reverseDirection=${row.reverseDirection} hasEmptyTrip=${row.hasEmptyTrip}`
        );
        return row;
      }
      const seeded = this.makeRow(DEFAULT_Z_AXIS_SETTINGS);
      upsertRows('zAxisSettings', [seeded]);
      this.current = seeded;
      // eslint-disable-next-line no-console
      console.log(
        `[z-settings-load] source=default imageSelection=${seeded.imageSelection} pulsePerMm=${seeded.pulsePerMm} reverseDirection=${seeded.reverseDirection} hasEmptyTrip=${seeded.hasEmptyTrip}`
      );
      return seeded;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.current = this.makeRow(DEFAULT_Z_AXIS_SETTINGS);
      // eslint-disable-next-line no-console
      console.warn(`[z-settings-load] source=default-fallback error=${JSON.stringify(message)}`);
      return this.current;
    }
  }

  /** The current authoritative settings (loads lazily if startup load was skipped). */
  async get(): Promise<ZAxisSettings> {
    if (!this.current) return this.load();
    return this.current;
  }

  /**
   * Persist the full Z-axis payload (Confirm). Writes to the DB and updates the
   * in-memory copy, preserving the stable row id. Any in-memory preview overlay
   * is naturally superseded because the saved payload carries imageSelection too.
   */
  async save(payload: ZAxisSettingsPayload): Promise<ZAxisSettings> {
    const base = this.current ?? (await this.load());
    const next: ZAxisSettings = {
      ...base,
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    upsertRows('zAxisSettings', [next]);
    this.current = next;
    // eslint-disable-next-line no-console
    console.log(
      `[z-settings-save] imageSelection=${next.imageSelection} pulsePerMm=${next.pulsePerMm} stepDistanceMm=${next.stepDistanceMm} reverseDirection=${next.reverseDirection} hasEmptyTrip=${next.hasEmptyTrip} upMm=${next.upwardEmptyTripMm} downMm=${next.downwardEmptyTripMm}`
    );
    return next;
  }

  /**
   * Apply a preview of ONLY the image-selection setting. In-memory only — no DB
   * write (Confirm persists; Cancel reverts via revert()). Never moves hardware
   * or sends any Z serial command.
   */
  async preview(imageSelection: ImageSelection): Promise<ZAxisSettings> {
    const base = this.current ?? (await this.load());
    const next: ZAxisSettings = { ...base, imageSelection };
    this.current = next;
    // eslint-disable-next-line no-console
    console.log(`[z-settings-preview] imageSelection=${imageSelection}`);
    return next;
  }

  /** Discard any in-memory preview by reloading the last saved row from the DB. */
  async revert(): Promise<ZAxisSettings> {
    try {
      const rows = (await readCollection('zAxisSettings')) as ZAxisSettings[];
      const row = rows[0];
      if (row) this.current = row;
    } catch {
      // Keep the current in-memory copy if the DB read fails.
    }
    return this.current ?? this.load();
  }

  private makeRow(payload: ZAxisSettingsPayload): ZAxisSettings {
    const now = new Date().toISOString();
    return { id: randomUUID(), ...payload, createdAt: now, updatedAt: now };
  }
}

export const zSettingsService = new ZSettingsService();
