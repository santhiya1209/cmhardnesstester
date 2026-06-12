import { describe, expect, it } from 'vitest';
import { generatePattern, triangleIsValid } from './patternGeneration';
import { configFromProgram, toPayload } from './patternProgramMapping';
import type { ProgramMeta } from '@/types/multipoint';
import type {
  PatternGenerationRequest,
  PatternProgram,
  TriangleDefinition,
} from '@/types/patternProgram';

const tri = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number
): TriangleDefinition => ({ id, x1, y1, x2, y2, x3, y3 });

function triangleConfig(overrides: Partial<PatternGenerationRequest> = {}): PatternGenerationRequest {
  return {
    mode: 'Equidistant Triangle Mode',
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
    lines: [],
    triangles: [],
    ...overrides,
  };
}

describe('Equidistant Triangle generation', () => {
  it('samples the three edges, emitting each corner exactly once', () => {
    // Right triangle (0,0)-(10,0)-(0,10); interval 5.
    //  edge A (0,0)->(10,0)  dist 10: corner (0,0) + 5,10? 10 not <10 → interior (5,0)
    //  edge B (10,0)->(0,10) dist ~14.14: corner (10,0) + interior at 5,10
    //  edge C (0,10)->(0,0)  dist 10: corner (0,10) + interior (0,5)
    const result = generatePattern(
      triangleConfig({ triangles: [tri('t', 0, 0, 10, 0, 0, 10)], interval: 5 })
    );
    expect(result.success).toBe(true);
    // 3 corners + (5,0) on A + 2 interior on B + (0,5) on C = 3 + 1 + 2 + 1 = 7
    expect(result.points).toHaveLength(7);
    // Corners appear once each.
    const corners = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    for (const c of corners) {
      expect(result.points.filter((p) => p.x === c.x && p.y === c.y)).toHaveLength(1);
    }
    // First point is the first corner; every point tagged triangle 1.
    expect(result.points[0]).toMatchObject({ no: 1, x: 0, y: 0, triangle: 1 });
    expect(result.points.every((p) => p.triangle === 1)).toBe(true);
  });

  it('with multiset off, generates only the first triangle', () => {
    const result = generatePattern(
      triangleConfig({
        triangles: [tri('a', 0, 0, 10, 0, 0, 10), tri('b', 20, 0, 30, 0, 20, 10)],
        interval: 5,
      })
    );
    expect(result.success).toBe(true);
    expect(result.points.every((p) => p.triangle === 1)).toBe(true);
  });

  it('with multiset on, generates every triangle, numbered sequentially', () => {
    const result = generatePattern(
      triangleConfig({
        triangles: [tri('a', 0, 0, 10, 0, 0, 10), tri('b', 20, 0, 30, 0, 20, 10)],
        interval: 5,
      }),
      { multiset: true }
    );
    expect(result.success).toBe(true);
    expect(result.points.some((p) => p.triangle === 1)).toBe(true);
    expect(result.points.some((p) => p.triangle === 2)).toBe(true);
    // Sequence numbers are contiguous across triangles.
    expect(result.points.map((p) => p.no)).toEqual(
      Array.from({ length: result.points.length }, (_, i) => i + 1)
    );
  });

  it('skips incomplete triangles and fails when none remain', () => {
    const result = generatePattern(
      triangleConfig({ triangles: [tri('blank', 0, 0, 10, 0, NaN, NaN)], interval: 5 })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least one triangle/i);
  });

  it('rejects collinear points as Invalid Triangle Geometry', () => {
    const result = generatePattern(
      triangleConfig({ triangles: [tri('line', 0, 0, 5, 0, 10, 0)], interval: 2 })
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid Triangle Geometry');
  });

  it('fails without a positive interval', () => {
    expect(
      generatePattern(triangleConfig({ triangles: [tri('t', 0, 0, 10, 0, 0, 10)], interval: 0 })).success
    ).toBe(false);
  });
});

describe('triangleIsValid', () => {
  it('is false for incomplete, duplicate-vertex, or collinear triangles', () => {
    expect(triangleIsValid(tri('a', 0, 0, 10, 0, NaN, NaN))).toBe(false); // incomplete
    expect(triangleIsValid(tri('b', 0, 0, 0, 0, 5, 5))).toBe(false); // duplicate vertex
    expect(triangleIsValid(tri('c', 0, 0, 5, 0, 10, 0))).toBe(false); // collinear
    expect(triangleIsValid(tri('d', 0, 0, 10, 0, 0, 10))).toBe(true); // valid
  });
});

describe('Equidistant Triangle save/load round-trip', () => {
  it('reproduces identical points after Save → Load → Generate and drops blank triangles', () => {
    const original = triangleConfig({
      interval: 4,
      triangles: [
        tri('a', 1, 2, 11, 2, 1, 12),
        tri('blank', NaN, NaN, NaN, NaN, NaN, NaN),
      ],
    });
    const meta: ProgramMeta = { pattern: 'Custom', multiset: true, focusAll: true, impressMode: 'indenting' };

    const payload = toPayload(original, 'Equidistant Triangle Mode', meta, true);
    // The incomplete triangle is dropped on Save.
    expect(payload.triangles).toHaveLength(1);

    const program: PatternProgram = {
      ...payload,
      id: 'pp-tri',
      patternName: 'Triangle Program 1',
      pointCount: 0,
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
    };
    const reloaded = configFromProgram(program);

    const before = generatePattern({ ...original, triangles: payload.triangles }, { multiset: meta.multiset });
    const after = generatePattern(reloaded, { multiset: meta.multiset });
    expect(after.success).toBe(true);
    expect(after.points).toEqual(before.points);
  });
});
