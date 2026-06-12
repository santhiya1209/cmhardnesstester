import { describe, expect, it } from 'vitest';
import { arePointsVerticallyAligned, generatePattern } from './patternGeneration';
import { configFromProgram, toPayload } from './patternProgramMapping';
import type { ProgramMeta } from '@/types/multipoint';
import type { CompositeLine, FreePoint, PatternGenerationRequest, PatternProgram } from '@/types/patternProgram';

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
    lines: [],
    triangles: [],
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

function circleConfig(overrides: Partial<PatternGenerationRequest> = {}): PatternGenerationRequest {
  return { ...caseDepthConfig(), mode: 'Circle Mode', ...overrides };
}

describe('Circle generation', () => {
  it('places indents around a circle defined by center + edge point', () => {
    // center (5,5), edge (5,8) → radius 3; 4 points, 90° apart from angle 0.
    const result = generatePattern(
      circleConfig({
        referencePoints: [ref('c', 5, 5), ref('e', 5, 8)],
        angle: 0,
        interval: 90,
        number: 4,
      })
    );

    expect(result.success).toBe(true);
    expect(result.points).toEqual([
      { id: '1', no: 1, x: 8, y: 5 },
      { id: '2', no: 2, x: 5, y: 8 },
      { id: '3', no: 3, x: 2, y: 5 },
      { id: '4', no: 4, x: 5, y: 2 },
    ]);
  });

  it('honors the start Angle and produces a partial arc when number×interval < 360', () => {
    const result = generatePattern(
      circleConfig({
        referencePoints: [ref('c', 0, 0), ref('e', 2, 0)], // radius 2
        angle: 90,
        interval: 45,
        number: 2,
      })
    );

    expect(result.success).toBe(true);
    expect(result.points).toHaveLength(2);
    expect(result.points[0].x).toBeCloseTo(0, 6); // 90°: (0, 2)
    expect(result.points[0].y).toBeCloseTo(2, 6);
    expect(result.points[1].x).toBeCloseTo(-Math.SQRT2, 6); // 135°
    expect(result.points[1].y).toBeCloseTo(Math.SQRT2, 6);
  });

  it('fails when the edge reference point is missing', () => {
    const result = generatePattern(
      circleConfig({ referencePoints: [ref('c', 0, 0)], interval: 30, number: 3 })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Reference point on the circle/i);
  });

  it('fails when center and edge coincide (zero radius)', () => {
    const result = generatePattern(
      circleConfig({ referencePoints: [ref('c', 4, 4), ref('e', 4, 4)], interval: 30, number: 3 })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/radius/i);
  });

  it('fails when interval or number are not positive', () => {
    const base = { referencePoints: [ref('c', 0, 0), ref('e', 1, 0)] };
    expect(generatePattern(circleConfig({ ...base, interval: 0, number: 3 })).success).toBe(false);
    expect(generatePattern(circleConfig({ ...base, interval: 30, number: 0 })).success).toBe(false);
  });
});

describe('Circle save/load round-trip', () => {
  it('reproduces identical points after Save → Load → Generate', () => {
    const original = circleConfig({
      referencePoints: [ref('c', 1.5, -2.25), ref('e', 4.5, -2.25)],
      angle: 30,
      interval: 60,
      number: 6,
    });
    const meta: ProgramMeta = { pattern: 'Circle', multiset: false, focusAll: true, impressMode: 'onePass' };

    const payload = toPayload(original, 'Circle Mode', meta, true);
    const program: PatternProgram = {
      ...payload,
      id: 'pp-circle',
      patternName: 'Circle Program 1',
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

function equidistantConfig(overrides: Partial<PatternGenerationRequest> = {}): PatternGenerationRequest {
  return { ...caseDepthConfig(), mode: 'Equidistant Multipoint Mode', ...overrides };
}

describe('Equidistant Multipoint generation', () => {
  it('matches the documented two-reference example: (10,10)→(110,10), Number 11', () => {
    const result = generatePattern(
      equidistantConfig({ referencePoints: [ref('a', 10, 10), ref('b', 110, 10)], number: 11 })
    );
    expect(result.success).toBe(true);
    expect(result.points).toHaveLength(11);
    expect(result.points[0]).toEqual({ id: '1', no: 1, x: 10, y: 10 });
    expect(result.points[1]).toEqual({ id: '2', no: 2, x: 20, y: 10 });
    expect(result.points[10]).toEqual({ id: '11', no: 11, x: 110, y: 10 });
  });

  it('chains a polyline across >2 references, emitting each shared vertex once', () => {
    // P1(0,0)→P2(10,0)→P3(10,10), 3 points per leg.
    const result = generatePattern(
      equidistantConfig({
        referencePoints: [ref('p1', 0, 0), ref('p2', 10, 0), ref('p3', 10, 10)],
        number: 3,
      })
    );
    expect(result.success).toBe(true);
    expect(result.points).toEqual([
      { id: '1', no: 1, x: 0, y: 0 },
      { id: '2', no: 2, x: 5, y: 0 },
      { id: '3', no: 3, x: 10, y: 0 },
      { id: '4', no: 4, x: 10, y: 5 },
      { id: '5', no: 5, x: 10, y: 10 },
    ]);
  });

  it('with multiset, generates each consecutive pair as its own line', () => {
    const result = generatePattern(
      equidistantConfig({
        referencePoints: [ref('p1', 0, 0), ref('p2', 10, 0), ref('p3', 0, 5), ref('p4', 10, 5)],
        number: 2,
      }),
      { multiset: true }
    );
    expect(result.success).toBe(true);
    expect(result.points).toEqual([
      { id: '1', no: 1, x: 0, y: 0 },
      { id: '2', no: 2, x: 10, y: 0 },
      { id: '3', no: 3, x: 0, y: 5 },
      { id: '4', no: 4, x: 10, y: 5 },
    ]);
  });

  it('with multiset, ignores a trailing unpaired reference', () => {
    const result = generatePattern(
      equidistantConfig({
        referencePoints: [ref('p1', 0, 0), ref('p2', 10, 0), ref('p3', 0, 5)],
        number: 2,
      }),
      { multiset: true }
    );
    expect(result.success).toBe(true);
    expect(result.points).toHaveLength(2); // only the (p1,p2) pair
  });

  it('filters incomplete (NaN) reference slots before generating', () => {
    const result = generatePattern(
      equidistantConfig({
        referencePoints: [ref('a', 0, 0), ref('blank', NaN, NaN), ref('b', 10, 0)],
        number: 2,
      })
    );
    expect(result.success).toBe(true);
    expect(result.points).toEqual([
      { id: '1', no: 1, x: 0, y: 0 },
      { id: '2', no: 2, x: 10, y: 0 },
    ]);
  });

  it('fails with fewer than two complete reference points', () => {
    const result = generatePattern(equidistantConfig({ referencePoints: [ref('a', 0, 0)], number: 5 }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least two reference points/i);
  });

  it('fails when Number is missing or < 2', () => {
    const base = { referencePoints: [ref('a', 0, 0), ref('b', 10, 0)] };
    expect(generatePattern(equidistantConfig({ ...base, number: null })).success).toBe(false);
    expect(generatePattern(equidistantConfig({ ...base, number: 1 })).success).toBe(false);
  });

  it('fails when two consecutive references are identical', () => {
    const result = generatePattern(
      equidistantConfig({ referencePoints: [ref('a', 4, 4), ref('b', 4, 4)], number: 3 })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/must differ/i);
  });
});

describe('Equidistant Multipoint save/load round-trip', () => {
  it('reproduces identical points after Save → Load → Generate', () => {
    const original = equidistantConfig({
      referencePoints: [ref('p1', 1, 2), ref('p2', 11, 2), ref('p3', 11, 12)],
      number: 4,
    });
    const meta: ProgramMeta = { pattern: 'Custom', multiset: false, focusAll: true, impressMode: 'indenting' };

    const payload = toPayload(original, 'Equidistant Multipoint Mode', meta, true);
    const program: PatternProgram = {
      ...payload,
      id: 'pp-eq',
      patternName: 'Equidistant Program 1',
      pointCount: payload.number ?? 0,
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
    };
    const reloaded = configFromProgram(program);

    expect(reloaded).toEqual(original);
    const before = generatePattern(original, { multiset: meta.multiset });
    const after = generatePattern(reloaded, { multiset: meta.multiset });
    expect(after.success).toBe(true);
    expect(after.points).toEqual(before.points);
  });

  it('drops incomplete reference slots when building the save payload', () => {
    const config = equidistantConfig({
      referencePoints: [ref('a', 0, 0), ref('blank', NaN, NaN), ref('b', 10, 0)],
      number: 2,
    });
    const meta: ProgramMeta = { pattern: 'Custom', multiset: false, focusAll: false, impressMode: 'indenting' };
    const payload = toPayload(config, 'Equidistant Multipoint Mode', meta, true);
    expect(payload.referencePoints).toEqual([ref('a', 0, 0), ref('b', 10, 0)]);
  });
});

function threePointConfig(overrides: Partial<PatternGenerationRequest> = {}): PatternGenerationRequest {
  return { ...caseDepthConfig(), mode: 'Equidistant Three Point Mode', ...overrides };
}

describe('Equidistant Three Point generation', () => {
  it('chains one row P1→P2→P3 into a single polyline, shared vertex once', () => {
    const result = generatePattern(
      threePointConfig({
        referencePoints: [ref('p1', 0, 0), ref('p2', 10, 0), ref('p3', 10, 10)],
        interval: 5,
      })
    );
    expect(result.success).toBe(true);
    expect(result.points).toEqual([
      { id: '1', no: 1, x: 0, y: 0, line: 1 },
      { id: '2', no: 2, x: 5, y: 0, line: 1 },
      { id: '3', no: 3, x: 10, y: 0, line: 1 },
      { id: '4', no: 4, x: 10, y: 5, line: 1 },
      { id: '5', no: 5, x: 10, y: 10, line: 1 },
    ]);
  });

  it('forces both endpoints of each leg even when the interval does not divide it', () => {
    // Leg length 3, interval 2 → 0, 2, then the forced endpoint 3.
    const result = generatePattern(
      threePointConfig({
        referencePoints: [ref('p1', 0, 0), ref('p2', 3, 0), ref('p3', 3, 3)],
        interval: 2,
      })
    );
    expect(result.success).toBe(true);
    expect(result.points.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [2, 0],
      [3, 0],
      [3, 2],
      [3, 3],
    ]);
  });

  it('with multiset, keeps the two legs as separate segments (vertex repeated)', () => {
    const result = generatePattern(
      threePointConfig({
        referencePoints: [ref('p1', 0, 0), ref('p2', 10, 0), ref('p3', 10, 10)],
        interval: 5,
      }),
      { multiset: true }
    );
    expect(result.success).toBe(true);
    // legA: (0,0),(5,0),(10,0); legB: (10,0),(10,5),(10,10) — P2 appears twice.
    expect(result.points.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 0],
      [10, 5],
      [10, 10],
    ]);
  });

  it('generates each row independently, concatenated with per-row line tags', () => {
    const result = generatePattern(
      threePointConfig({
        referencePoints: [
          ref('r1p1', 0, 0), ref('r1p2', 10, 0), ref('r1p3', 20, 0),
          ref('r2p1', 0, 5), ref('r2p2', 10, 5), ref('r2p3', 20, 5),
        ],
        interval: 10,
      })
    );
    expect(result.success).toBe(true);
    expect(result.points.map((p) => [p.no, p.line, p.x, p.y])).toEqual([
      [1, 1, 0, 0],
      [2, 1, 10, 0],
      [3, 1, 20, 0],
      [4, 2, 0, 5],
      [5, 2, 10, 5],
      [6, 2, 20, 5],
    ]);
  });

  it('skips incomplete rows but generates from the complete ones', () => {
    const result = generatePattern(
      threePointConfig({
        referencePoints: [
          ref('blank1', NaN, NaN), ref('blank2', NaN, NaN), ref('blank3', NaN, NaN),
          ref('p1', 0, 0), ref('p2', 10, 0), ref('p3', 20, 0),
        ],
        interval: 10,
      })
    );
    expect(result.success).toBe(true);
    expect(result.points.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
  });

  it('fails without a positive interval', () => {
    const refs = [ref('p1', 0, 0), ref('p2', 10, 0), ref('p3', 10, 10)];
    expect(generatePattern(threePointConfig({ referencePoints: refs, interval: null })).success).toBe(false);
    expect(generatePattern(threePointConfig({ referencePoints: refs, interval: 0 })).success).toBe(false);
  });

  it('fails when there is no complete row', () => {
    const result = generatePattern(threePointConfig({ referencePoints: [], interval: 5 }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/complete row/i);
  });

  it('fails when a leg has zero length (two coincident points in a row)', () => {
    const result = generatePattern(
      threePointConfig({
        referencePoints: [ref('p1', 5, 5), ref('p2', 5, 5), ref('p3', 10, 10)],
        interval: 5,
      })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/must differ/i);
  });
});

describe('Equidistant Three Point save/load round-trip', () => {
  it('reproduces identical points after Save → Load → Generate', () => {
    const original = threePointConfig({
      referencePoints: [
        ref('r1p1', 1, 2), ref('r1p2', 11, 2), ref('r1p3', 11, 12),
        ref('r2p1', 1, 20), ref('r2p2', 21, 20), ref('r2p3', 21, 40),
      ],
      interval: 5,
    });
    const meta: ProgramMeta = { pattern: 'Custom', multiset: false, focusAll: true, impressMode: 'indenting' };

    const payload = toPayload(original, 'Equidistant Three Point Mode', meta, true);
    const program: PatternProgram = {
      ...payload,
      id: 'pp-3pt',
      patternName: 'Three Point Program 1',
      pointCount: 0,
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
    };
    const reloaded = configFromProgram(program);

    expect(reloaded).toEqual(original);
    const before = generatePattern(original, { multiset: meta.multiset });
    const after = generatePattern(reloaded, { multiset: meta.multiset });
    expect(after.success).toBe(true);
    expect(after.points).toEqual(before.points);
  });
});

function verticalFreeConfig(overrides: Partial<PatternGenerationRequest> = {}): PatternGenerationRequest {
  return { ...caseDepthConfig(), mode: 'Vertical Line Free Points Mode', ...overrides };
}

describe('Vertical Line Free Points generation', () => {
  it('uses the entered X/Y per row and orders points by ascending Y', () => {
    const result = generatePattern(
      verticalFreeConfig({
        freePoints: [
          ref('a', 10, 40),
          ref('b', 10, 20),
          ref('c', 10, 31.5),
          ref('d', 10, 25),
        ],
      })
    );
    expect(result.success).toBe(true);
    expect(result.points).toEqual([
      { id: '1', no: 1, x: 10, y: 20 },
      { id: '2', no: 2, x: 10, y: 25 },
      { id: '3', no: 3, x: 10, y: 31.5 },
      { id: '4', no: 4, x: 10, y: 40 },
    ]);
  });

  it('keeps each row\'s own X (no single reference X is imposed)', () => {
    const result = generatePattern(
      verticalFreeConfig({ freePoints: [ref('a', 10, 0), ref('b', 12, 5)] })
    );
    expect(result.success).toBe(true);
    expect(result.points.map((p) => p.x)).toEqual([10, 12]);
  });

  it('fails with no points or an invalid coordinate', () => {
    expect(generatePattern(verticalFreeConfig({ freePoints: [] })).success).toBe(false);
    expect(
      generatePattern(verticalFreeConfig({ freePoints: [ref('a', 10, 0), ref('b', NaN, 5)] })).success
    ).toBe(false);
  });

  it('round-trips through Save → Load → Generate', () => {
    const original = verticalFreeConfig({
      freePoints: [ref('p1', 10, 20), ref('p2', 10, 25), ref('p3', 10, 30)],
    });
    const meta: ProgramMeta = { pattern: 'Line', multiset: false, focusAll: true, impressMode: 'indenting' };
    const payload = toPayload(original, 'Vertical Line Free Points Mode', meta, true);
    const program: PatternProgram = {
      ...payload,
      id: 'pp-vlfp',
      patternName: 'Vertical Free 1',
      pointCount: payload.freePoints.length,
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
    };
    const reloaded = configFromProgram(program);
    expect(reloaded).toEqual(original);
    expect(generatePattern(reloaded).points).toEqual(generatePattern(original).points);
  });
});

describe('arePointsVerticallyAligned', () => {
  it('is true when X values are within tolerance and false when they diverge', () => {
    expect(arePointsVerticallyAligned([ref('a', 10, 0), ref('b', 10.1, 5)])).toBe(true);
    expect(arePointsVerticallyAligned([ref('a', 10, 0), ref('b', 12, 5)])).toBe(false);
  });

  it('treats fewer than two finite-X points as aligned', () => {
    expect(arePointsVerticallyAligned([])).toBe(true);
    expect(arePointsVerticallyAligned([ref('a', 10, 0)])).toBe(true);
    expect(arePointsVerticallyAligned([ref('a', NaN, 0), ref('b', 99, 5)])).toBe(true);
  });
});

function compLine(overrides: Partial<CompositeLine>): CompositeLine {
  return {
    id: overrides.id ?? 'L',
    move: 'Horizontal',
    startX: 0,
    startY: 0,
    endX: 10,
    endY: 0,
    interval: 1,
    offset: 0,
    firstOffset: 0,
    ...overrides,
  };
}

function multilineConfig(lines: CompositeLine[]): PatternGenerationRequest {
  return { ...caseDepthConfig(), mode: 'Multiline Composite Pattern', lines };
}

describe('MultiLine Composite generation', () => {
  it('generates a horizontal line from the Start→End span at the given interval', () => {
    const result = generatePattern(
      multilineConfig([compLine({ id: 'a', startX: 10, startY: 20, endX: 100, endY: 20, interval: 10 })])
    );
    expect(result.success).toBe(true);
    expect(result.points).toHaveLength(10);
    expect(result.points[0]).toEqual({ id: '1', no: 1, x: 10, y: 20, line: 1 });
    expect(result.points[9]).toEqual({ id: '10', no: 10, x: 100, y: 20, line: 1 });
  });

  it('concatenates multiple lines with continuous numbering and per-line tags', () => {
    const result = generatePattern(
      multilineConfig([
        compLine({ id: 'a', startX: 10, startY: 20, endX: 30, endY: 20, interval: 10 }),
        compLine({ id: 'b', startX: 10, startY: 40, endX: 30, endY: 40, interval: 10 }),
      ])
    );
    expect(result.success).toBe(true);
    expect(result.points.map((p) => [p.no, p.line, p.x, p.y])).toEqual([
      [1, 1, 10, 20],
      [2, 1, 20, 20],
      [3, 1, 30, 20],
      [4, 2, 10, 40],
      [5, 2, 20, 40],
      [6, 2, 30, 40],
    ]);
  });

  it('runs a Vertical line along Y, ignoring a stray End X', () => {
    const result = generatePattern(
      multilineConfig([compLine({ id: 'a', move: 'Vertical', startX: 5, startY: 0, endX: 999, endY: 20, interval: 10 })])
    );
    expect(result.success).toBe(true);
    expect(result.points.map((p) => [p.x, p.y])).toEqual([
      [5, 0],
      [5, 10],
      [5, 20],
    ]);
  });

  it('steps a Diagonal line along the Start→End vector', () => {
    const result = generatePattern(
      multilineConfig([compLine({ id: 'a', move: 'Diagonal', startX: 0, startY: 0, endX: 30, endY: 40, interval: 10 })])
    );
    expect(result.success).toBe(true);
    expect(result.points.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [6, 8],
      [12, 16],
      [18, 24],
      [24, 32],
      [30, 40],
    ]);
  });

  it('fails when a line has zero span or there are no lines', () => {
    expect(generatePattern(multilineConfig([])).success).toBe(false);
    const zero = generatePattern(
      multilineConfig([compLine({ id: 'a', startX: 5, startY: 5, endX: 5, endY: 5, interval: 1 })])
    );
    expect(zero.success).toBe(false);
    expect(zero.error).toMatch(/Line 1/);
  });

  it('round-trips through Save → Load → Generate', () => {
    const original = multilineConfig([
      compLine({ id: 'a', startX: 10, startY: 20, endX: 50, endY: 20, interval: 10 }),
      compLine({ id: 'b', move: 'Diagonal', startX: 0, startY: 0, endX: 30, endY: 40, interval: 10 }),
    ]);
    const meta: ProgramMeta = { pattern: 'Custom', multiset: false, focusAll: false, impressMode: 'indenting' };
    const payload = toPayload(original, 'Multiline Composite Pattern', meta, true);
    const program: PatternProgram = {
      ...payload,
      id: 'pp-ml',
      patternName: 'MultiLine 1',
      pointCount: 0,
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
    };
    const reloaded = configFromProgram(program);
    expect(reloaded).toEqual(original);
    expect(generatePattern(reloaded).points).toEqual(generatePattern(original).points);
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
