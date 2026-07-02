import { describe, expect, it } from 'vitest';
import {
  resolveAutoMeasureSettingsForObjective,
  selectSavedAutoMeasureRow,
} from './autoMeasureHelpers';
import {
  AUTO_MEASURE_DEFAULTS_BY_OBJECTIVE,
  type AutoMeasureSettings,
} from '@/types/autoMeasureSettings';

function saved(overrides: Partial<AutoMeasureSettings>): AutoMeasureSettings {
  return {
    id: overrides.id ?? 'row',
    smoothing: 15,
    threshold: 134,
    turretAfterImpress: true,
    measureAfterImpress: true,
    objectiveForMeasure: '40X',
    imageType: 'HV-2',
    thresholdMode: 'manual',
    manualThreshold: 134,
    morphologyKernelSize: 11,
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('per-objective auto-measure persistence', () => {
  it('restores the saved values for an objective (Scenario 1 & 2)', () => {
    const rows = [saved({ id: '40x', objectiveForMeasure: '40X', smoothing: 8, threshold: 135 })];
    const resolved = resolveAutoMeasureSettingsForObjective(rows, '40X');
    expect(resolved.smoothing).toBe(8);
    expect(resolved.threshold).toBe(135);
    expect(resolved.objectiveForMeasure).toBe('40X');
  });

  it('does NOT override a saved value with the objective preset', () => {
    const rows = [saved({ id: '40x', objectiveForMeasure: '40X', smoothing: 8, threshold: 135 })];
    const resolved = resolveAutoMeasureSettingsForObjective(rows, '40X');
    // Preset for 40X is {6, 91}; the saved value must win.
    expect(resolved).not.toMatchObject(AUTO_MEASURE_DEFAULTS_BY_OBJECTIVE['40X']);
  });

  it('keeps each objective independent (Scenario 4 & 5)', () => {
    const rows = [
      saved({ id: '40x', objectiveForMeasure: '40X', smoothing: 8, threshold: 135 }),
      saved({ id: '10x', objectiveForMeasure: '10X', smoothing: 3, threshold: 40 }),
    ];
    expect(resolveAutoMeasureSettingsForObjective(rows, '40X')).toMatchObject({
      smoothing: 8,
      threshold: 135,
    });
    expect(resolveAutoMeasureSettingsForObjective(rows, '10X')).toMatchObject({
      smoothing: 3,
      threshold: 40,
    });
  });

  it('seeds from the factory preset only when the objective has never been saved', () => {
    const resolved = resolveAutoMeasureSettingsForObjective([], '10X');
    expect(resolved).toMatchObject(AUTO_MEASURE_DEFAULTS_BY_OBJECTIVE['10X']);
    expect(resolved.objectiveForMeasure).toBe('10X');
  });

  it('picks the most-recently-updated row when duplicates exist for an objective', () => {
    const rows = [
      saved({ id: 'old', objectiveForMeasure: '40X', smoothing: 1, threshold: 10, updatedAt: '2026-06-01T00:00:00.000Z' }),
      saved({ id: 'new', objectiveForMeasure: '40X', smoothing: 9, threshold: 200, updatedAt: '2026-06-20T00:00:00.000Z' }),
    ];
    expect(selectSavedAutoMeasureRow(rows, '40X')?.id).toBe('new');
    expect(resolveAutoMeasureSettingsForObjective(rows, '40X')).toMatchObject({
      smoothing: 9,
      threshold: 200,
    });
  });

  it('returns null for an objective with no saved row (so save creates a new one)', () => {
    const rows = [saved({ id: '40x', objectiveForMeasure: '40X' })];
    expect(selectSavedAutoMeasureRow(rows, '10X')).toBeNull();
  });
});
