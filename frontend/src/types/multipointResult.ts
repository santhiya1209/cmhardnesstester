// Per-point Multipoint run record (mirrors backend models/multipoint-result.ts).
// The RUN outcome for one executed point; metrology (HV/D1/D2) lives in the
// measurements table and is linked via `measurementId`.

import type { DiamondGeometry } from './measurement';

export type MultipointFocusStatus =
  | 'pending'
  | 'manual'
  | 'settled'
  | 'focused'
  | 'skipped'
  | 'failed'
  | 'not-available';

export type MultipointIndentStatus = 'pending' | 'indented' | 'skipped' | 'failed';

export type MultipointMeasureStatus =
  | 'pending'
  | 'measured'
  | 'rejected'
  | 'skipped'
  | 'failed';

export type MultipointResultSavePayload = {
  runId: string;
  pointNo: number;
  pointId?: string | null;
  pass?: number | null;
  xMm: number;
  yMm: number;
  focusStatus?: MultipointFocusStatus;
  indentStatus?: MultipointIndentStatus;
  measureStatus?: MultipointMeasureStatus;
  hv?: number | null;
  d1Um?: number | null;
  d2Um?: number | null;
  averageUm?: number | null;
  testForceKgf?: number | null;
  objective?: string | null;
  confidence?: number | null;
  measurementId?: string | null;
  // Indenting-mode self-contained review snapshot (null for measured points).
  imageDataUrl?: string | null;
  diamond?: DiamondGeometry | null;
  centerNorm?: { x: number; y: number } | null;
  operator?: string | null;
  durationMs?: number | null;
  timestamp?: string;
};

export type MultipointResult = Required<
  Omit<MultipointResultSavePayload, 'timestamp'>
> & {
  id: string;
  timestamp: string;
  createdAt: string;
  updatedAt: string;
};
