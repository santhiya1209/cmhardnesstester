import type { AutoMeasureSettingsPayload } from '@/types/autoMeasureSettings';
import type { Point } from '@/types/tool';

export type AutoMeasureLine = {
  p1: Point;
  p2: Point;
};

export type AutoMeasureCorners = {
  top: Point;
  right: Point;
  bottom: Point;
  left: Point;
};

export type AutoMeasureSource = 'live-camera' | 'uploaded-image';

export type VickersAutoMeasureParameters = Partial<AutoMeasureSettingsPayload> & {
  frameBuffer?: ArrayBufferLike;
  width?: number;
  height?: number;
  pixelFormat?: string;
  bits?: 8 | 16;
  source?: AutoMeasureSource;
  micronPerPixel?: number | null;
  pxPerMm?: number | null;
  testForceKgf?: number | null;
  minConfidence?: number;
  timeoutMs?: number;
  maxFrameAgeMs?: number;
};

export type VickersAutoMeasureSuccess = {
  ok: true;
  source: AutoMeasureSource;
  corners: AutoMeasureCorners;
  lines: AutoMeasureLine[];
  d1Pixels: number;
  d2Pixels: number;
  d1Mm: number | null;
  d2Mm: number | null;
  averageMm: number | null;
  confidence: number;
  hv: number | null;
  debug: Record<string, unknown>;
};

export type VickersAutoMeasureFailure = {
  ok: false;
  source?: AutoMeasureSource;
  reason: string;
  confidence: 0;
  debug: Record<string, unknown>;
};

export type VickersAutoMeasureResult =
  | VickersAutoMeasureSuccess
  | VickersAutoMeasureFailure;

/**
 * Overlay rendering mode for Auto Measure results.
 *  - 'four-guides'   : legacy 4 full-extent yellow guides (top/bottom/left/right).
 *                      Used for 40X / 50X / 100X where the 4-corner refined
 *                      detection is reliable.
 *  - 'two-diagonals' : 2 corner-to-corner diagonal segments (D1 = left↔right,
 *                      D2 = top↔bottom). Used for 10X where the simplified
 *                      two-line detection runs in the native addon.
 */
export type AutoMeasureLineLayout = 'four-guides' | 'two-diagonals';

export type AutoMeasureGraphics = Pick<VickersAutoMeasureSuccess, 'corners' | 'lines'> & {
  lineLayout?: AutoMeasureLineLayout;
  /** Objective the detection ran against. Used by the render gate to drop
   * stale overlays after a 10X↔40X switch — graphics whose `objective` does
   * not match the live `activeObjective` are filtered out before paint. */
  objective?: string | null;
  /** Frame epoch captured at the moment detection started. The render gate
   * compares this against the current session's `autoMeasureCapturedFrameId`
   * — async results from a superseded click are dropped. */
  frameId?: number | null;
  /** Session id at the moment detection started — guards async callbacks
   * against a session that has since been invalidated. */
  sessionId?: number | null;
};
