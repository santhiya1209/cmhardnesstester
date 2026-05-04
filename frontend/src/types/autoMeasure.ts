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

export type AutoMeasureGraphics = Pick<VickersAutoMeasureSuccess, 'corners' | 'lines'>;
