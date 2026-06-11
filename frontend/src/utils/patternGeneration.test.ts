import { describe, expect, it } from 'vitest';
import { generatePattern } from './patternGeneration';
import { configFromProgram, toPayload } from './patternProgramMapping';
import type { ProgramMeta } from '@/types/multipoint';
import type { FreePoint, PatternGenerationRequest, PatternProgram } from '@/types/patternProgram';

const ref = (id: string, x: number, y: number): FreePoint => ({ id, x, y });

function caseDepthConfig(overrides: Partial<PatternGenerationRequest> = {}): PatternGenerationRequest {
  return {
    mode: 'Case Depth Mode',
    refX: null,
    refY: null,
    interval: null,
    offset: null,
    firstOffset: null,
    number: null,
    intervalY: null,
    rows: null,
    columns: null,
    refX2: null,
    refY2: null,
    radius: null,
    freePoints: [],
    referencePoints: [],
    angle: null,
    ...overrides,
  };
}

describe('Case Depth generation', () => {
  it('lays indents on a single line from origin toward the direction point', () => {
    const config = caseDepthConfig({
      referencePoints: [ref('o', 0, 0), ref('d', 10, 0)], // direction = +X
      firstOffset: 1,
      offset: 0.5, // start distance = firstOffset + offset = 1.5
      interval: 2,
      number: 3,
    });

    const result = generatePattern(config);

    expect(result.success).toBe(true);
    // Distances 1.5, 3.5, 5.5 along +X.
    expect(result.points).toEqual([
      { id: '1', no: 1, x: 1.5, y: 0 },
      { id: '2', no: 2, x: 3.5, y: 0 },
      { id: '3', no: 3, x: 5.5, y: 0 },
    ]);
  });

  it('uses the bearing of the two points, not their separation', () => {
    // Direction point only 1 mm away, but interval/offset are in mm regardless.
    const config = caseDepthConfig({
      referencePoints: [ref('o', 2, 2), ref('d', 2, 3)], // direction = +Y
      firstOffset: 0,
      offset: 0,
      interval: 5,
      number: 2,
    });

    const result = generatePattern(config);

    expect(result.success).toBe(true);
    expect(result.points).toEqual([
      { id: '1', no: 1, x: 2, y: 2 },
      { id: '2', no: 2, x: 2, y: 7 },
    ]);
  });

  it('fails when no reference points exist', () => {
    const result = generatePattern(caseDepthConfig({ interval: 1, number: 3 }));
    expect(result.success).toBe(false);
    expect(result.points).toEqual([]);
    expect(result.error).toMatch(/Reference Point 1/i);
  });

  it('fails when only the origin point exists (direction missing)', () => {
    const result = generatePattern(
      caseDepthConfig({ referencePoints: [ref('o', 0, 0)], interval: 1, number: 3 })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Reference Point 2/i);
  });

  it('fails when the two reference points are identical (no direction)', () => {
    const result = generatePattern(
      caseDepthConfig({ referencePoints: [ref('o', 5, 5), ref('d', 5, 5)], interval: 1, number: 2 })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/must differ/i);
  });

  it('fails when interval <= 0', () => {
    const base = { referencePoints: [ref('o', 0, 0), ref('d', 1, 0)], number: 3 };
    expect(generatePattern(caseDepthConfig({ ...base, interval: 0 })).success).toBe(false);
    expect(generatePattern(caseDepthConfig({ ...base, interval: -2 })).success).toBe(false);
  });

  it('fails when number <= 0', () => {
    const base = { referencePoints: [ref('o', 0, 0), ref('d', 1, 0)], interval: 1 };
    expect(generatePattern(caseDepthConfig({ ...base, number: 0 })).success).toBe(false);
    expect(generatePattern(caseDepthConfig({ ...base, number: -1 })).success).toBe(false);
  });
});

describe('Case Depth save/load round-trip', () => {
  it('reproduces identical points after Save → Load → Generate', () => {
    const original = caseDepthConfig({
      referencePoints: [ref('o', 1.25, -3.5), ref('d', 4, 6)],
      firstOffset: 0.8,
      offset: 0.2,
      interval: 1.5,
      number: 5,
    });
    const meta: ProgramMeta = { pattern: 'Custom', multiset: true, focusAll: false, impressMode: 'twoPass' };

    const payload = toPayload(original, 'Case Depth Mode', meta, true);
    // Simulate the persisted record the backend returns on Load.
    const program: PatternProgram = {
      ...payload,
      id: 'pp-1',
      patternName: 'Custom Program 1',
      pointCount: payload.number ?? 0,
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
    };
    const reloaded = configFromProgram(program);

    expect(reloaded).toEqual(original);

    const before = generatePattern(original);
    const after = generatePattern(reloaded);
    expect(after.success).toBe(true);
    expect(after.points).toEqual(before.points);
  });
});
