import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import AutoMeasureSettingsDialog from '@/component/own/AutoMeasureSettingsDialog';
import CalibrationDialog from '@/component/own/CalibrationDialog';
import CameraSettingDialog from '@/component/own/CameraSettingDialog';
import LineColorSettingDialog from '@/component/own/LineColorSettingDialog';
import GenericSettingDialog from '@/component/own/GenericSettingDialog';
import OtherSettingDialog from '@/component/own/OtherSettingDialog';
import RestoreFactoryDialog from '@/component/own/RestoreFactoryDialog';
import SerialPortSettingDialog from '@/component/own/SerialPortSettingDialog';
import { useLineColorSetting } from '@/hooks/queries/useLineColorSetting';
import { useSerialPortSetting } from '@/hooks/queries/useSerialPortSetting';
import { useCalibrationSettings } from '@/hooks/queries/useCalibrationSettings';
import { useCalibrations } from '@/hooks/queries/useCalibrations';
import { useAutoMeasureSettings } from '@/hooks/queries/useAutoMeasureSettings';
import { useCameraSetting } from '@/hooks/queries/useCameraSetting';
import { useMachineStateSnapshot } from '@/hooks/queries/useMachineStateSnapshot';
import { useMachineState } from '@/hooks/queries/useMachineState';
import { useConnectMachine } from '@/hooks/mutations/useConnectMachine';
import { useSaveMeasurement } from '@/hooks/mutations/useSaveMeasurement';
import { getLatestMicrometerReading } from '@/api/getLatestMicrometerReading';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';
import { measureVickersAuto, measureVickersAutoPreview } from '@/api/measureVickersAuto';
import { getCameraSetting } from '@/api/getCameraSetting';
import {
  DEFAULT_AUTO_MEASURE_SETTINGS,
  OBJECTIVE_FOR_MEASURE_OPTIONS,
  normalizeAutoMeasureSettings,
  type AutoMeasureSettingsPayload,
  type ObjectiveForMeasure,
} from '@/types/autoMeasureSettings';
import { DEFAULT_LINE_COLOR, LINE_COLOR_HEX } from '@/types/lineColorSetting';
import MenuBar from '@/component/own/MenuBar';
import Toolbar from '@/component/own/Toolbar';
import LeftPanel from '@/component/own/LeftPanel';
import type { CameraWindowHandle } from '@/component/own/CameraWindow';
import RightPanel from '@/component/own/RightPanel';
import StatusBar, {
  type AutoMeasureStatusState,
  type CameraStatusState,
} from '@/component/own/StatusBar';
import TestRecordsDialog from '@/component/own/TestRecordsDialog';
import { useSaveToolbarState } from '@/hooks/mutations/useSaveToolbarState';
import { useMeasurements } from '@/hooks/queries/useMeasurements';
import { useToolbarState } from '@/hooks/queries/useToolbarState';
import { useActiveTool } from '@/hooks/useActiveTool';
import {
  getCurrentFrameEpoch,
  getLastCameraFramePaintAt,
  getLastPaintEpoch,
  getLastPaintedFrameId,
  dropPendingCameraFrames,
  resetCameraSession,
} from '@/hooks/useCameraStream';
import { useImageOverlay } from '@/hooks/useImageOverlay';
import { useLineThickness } from '@/hooks/useLineThickness';
import { openImageDialog } from '@/api/openImageDialog';
import { saveImageDialog } from '@/api/saveImageDialog';
import { exitApp } from '@/api/exitApp';
import { dispatchToolbarAction, type ToolDispatchContext } from '@/utils/toolDispatcher';
import { dispatchMenuAction } from '@/utils/menuDispatcher';
import { TOOL_ACTION_TO_TOOL, type ToolbarActionId } from '@/types/tool';
import type { ConfigDialogId, MenuActionId } from '@/types/menu';
import type {
  AutoMeasureCorners,
  AutoMeasureGraphics,
  VickersAutoMeasureResult,
  VickersAutoMeasureSuccess,
} from '@/types/autoMeasure';
import type { ManualMeasureDragResult } from '@/types/manualMeasure';
import type { Calibration, CalibrationSavePayload } from '@/types/calibration';
import type { IndentStatus, MachineState } from '@/types/machine';
import {
  calculateVickersFromPixels,
  calculateManualDiagonalsFromPixels,
  computeQualified,
  findCalibrationForObjective,
  normalizeObjectiveName,
  parseForceKgf,
  resolveManualCalibration,
} from '@/utils/manualMeasure';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DialogContentText from '@mui/material/DialogContentText';
import MuiButton from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';

const ROOT_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100%',
  overflow: 'hidden',
};

// Workspace = two side-by-side panels:
//   [ LeftPanel ] [ RightPanel ]
const WORKSPACE_SX: SxProps<Theme> = {
  flex: 1,
  display: 'flex',
  flexDirection: 'row',
  minHeight: 0,
  minWidth: 0,
};

async function readLatestMicrometerDepthMm(): Promise<number | null> {
  try {
    const reply = await getLatestMicrometerReading();
    const value = reply.reading?.value ?? null;
    const resolved =
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    // eslint-disable-next-line no-console
    console.log(
      `[micrometer-depth-before-row] value=${resolved ?? 'null'} stale=${(reply.reading as { stale?: boolean } | null)?.stale ?? false}`
    );
    return resolved;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[micrometer-depth-before-row] value=null error=${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

const POINT_TOL_PX = 0.5;
function pointAlmostEqual(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < POINT_TOL_PX && Math.abs(a.y - b.y) < POINT_TOL_PX;
}
function graphicsAlmostEqual(a: AutoMeasureGraphics, b: AutoMeasureGraphics): boolean {
  if (
    !pointAlmostEqual(a.corners.top, b.corners.top) ||
    !pointAlmostEqual(a.corners.right, b.corners.right) ||
    !pointAlmostEqual(a.corners.bottom, b.corners.bottom) ||
    !pointAlmostEqual(a.corners.left, b.corners.left)
  ) {
    return false;
  }
  if (a.lines.length !== b.lines.length) return false;
  for (let i = 0; i < a.lines.length; i += 1) {
    if (
      !pointAlmostEqual(a.lines[i].p1, b.lines[i].p1) ||
      !pointAlmostEqual(a.lines[i].p2, b.lines[i].p2)
    ) {
      return false;
    }
  }
  return true;
}

function autoMeasureSettingsEqual(
  a: AutoMeasureSettingsPayload,
  b: AutoMeasureSettingsPayload
): boolean {
  return JSON.stringify(normalizeAutoMeasureSettings(a)) === JSON.stringify(normalizeAutoMeasureSettings(b));
}

// Fixed acceptance window for the Qualified column. Treated as inclusive on
// both ends per the workpiece spec. Hoist to a Settings panel later if a
// per-job range is needed.
const QUALIFIED_TARGET_MIN_HV = 300;
const QUALIFIED_TARGET_MAX_HV = 800;

function deriveQualifiedForRow(hv: number | null | undefined): 'YES' | 'NO' | null {
  const result = computeQualified(hv, QUALIFIED_TARGET_MIN_HV, QUALIFIED_TARGET_MAX_HV);
  // eslint-disable-next-line no-console
  console.log(
    `[measurement-qualified-check]\nhv=${typeof hv === 'number' && Number.isFinite(hv) ? hv : 'null'}\ntargetMin=${QUALIFIED_TARGET_MIN_HV}\ntargetMax=${QUALIFIED_TARGET_MAX_HV}\nqualified=${result ?? 'null'}`
  );
  return result;
}

type AutoMeasureDetectionSnapshot = {
  settings: AutoMeasureSettingsPayload;
  result: VickersAutoMeasureSuccess;
  graphics: AutoMeasureGraphics;
  method: AutoMeasureDetectionMethod;
  validationReason: string;
  objectiveForCalibration: string;
  machineStateForAuto: MachineState | null;
  forceKgf: number | null;
};

type AutoMeasureDetectionMethod = 'refined' | 'rough';

type CommittedAutoMeasureFingerprint = {
  objective: string;
  centerX: number;
  centerY: number;
  d1Px: number;
  d2Px: number;
  hv: number | null;
  rowId: string | null;
  fingerprintKey: string;
  graphics: AutoMeasureGraphics;
};

type AutoMeasureCallSource = 'auto-click' | 'settings-preview' | 'settings-save';

type CapturedAutoMeasureFrame = Extract<
  ReturnType<CameraWindowHandle['captureDisplayedFrame']>,
  { ok: true }
>;

type RunAutoMeasure = (
  settingsInput: AutoMeasureSettingsPayload,
  preview?: boolean,
  source?: AutoMeasureCallSource
) => void;

function logUnexpectedAutoMeasureCall(source: string) {
  if (source === 'auto-click' || source === 'settings-preview' || source === 'settings-save') {
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[auto-measure-unexpected-call] source=${source} stack=${new Error().stack ?? 'unavailable'}`
  );
}

const AUTO_MEASURE_CENTER_TOLERANCE_PX = 3;
const AUTO_MEASURE_DIAGONAL_TOLERANCE_PX = 3;

function normalizeAutoMeasureFingerprintObjective(objective: string | null | undefined): string {
  return (objective ?? 'unknown').trim().toUpperCase() || 'UNKNOWN';
}

function buildAutoMeasureFingerprintKey({
  objective,
  centerX,
  centerY,
  d1Px,
  d2Px,
}: {
  objective: string;
  centerX: number;
  centerY: number;
  d1Px: number;
  d2Px: number;
}): string {
  return [
    objective,
    Math.round(centerX),
    Math.round(centerY),
    Math.round(d1Px),
    Math.round(d2Px),
  ].join('|');
}

function cloneAutoMeasureGraphics(graphics: AutoMeasureGraphics): AutoMeasureGraphics {
  return {
    ...graphics,
    corners: {
      top: { ...graphics.corners.top },
      right: { ...graphics.corners.right },
      bottom: { ...graphics.corners.bottom },
      left: { ...graphics.corners.left },
    },
    lines: graphics.lines.map((line) => ({
      p1: { ...line.p1 },
      p2: { ...line.p2 },
    })),
  };
}

function upsertCommittedAutoMeasureFingerprint(
  entries: CommittedAutoMeasureFingerprint[],
  entry: CommittedAutoMeasureFingerprint
): CommittedAutoMeasureFingerprint[] {
  const existingIndex = entries.findIndex(
    (candidate) => candidate.rowId !== null && candidate.rowId === entry.rowId
  );
  if (existingIndex === -1) {
    return [...entries, entry];
  }
  const next = [...entries];
  next[existingIndex] = entry;
  return next;
}

// Per-objective Auto Measure defaults. The user's machine-tuned values.
// These override whatever is currently in the Auto Measure Settings UI
// when a detection runs, and reset the UI when the objective changes.
const AUTO_MEASURE_OBJECTIVE_DEFAULTS: Record<string, { smoothing: number; threshold: number }> = {
  '10X': { smoothing: 4, threshold: 44 },
  '40X': { smoothing: 6, threshold: 71 },
};

function autoMeasureDefaultsForObjective(
  objective: string | null | undefined
): { smoothing: number; threshold: number } | null {
  const key = String(objective ?? '').trim().toUpperCase();
  return AUTO_MEASURE_OBJECTIVE_DEFAULTS[key] ?? null;
}

type AutoMeasureLogContext = {
  objective: string | null | undefined;
  smoothing: number;
  threshold: number;
  method?: AutoMeasureDetectionMethod;
  d1Px?: number | null;
  d2Px?: number | null;
  center?: { x: number; y: number } | null;
  reason?: string;
  extra?: string;
};

type AutoMeasureGeometryValidation = {
  ok: boolean;
  reason: string;
  d1Px: number;
  d2Px: number;
  ratio: number;
  center: { x: number; y: number };
};

type ResolvedAutoMeasureDetection =
  | {
      ok: true;
      result: VickersAutoMeasureSuccess;
      method: AutoMeasureDetectionMethod;
      reason: string;
      validation: AutoMeasureGeometryValidation;
      fallbackUsed: boolean;
    }
  | {
      ok: false;
      reason: string;
      method: AutoMeasureDetectionMethod;
      validation?: AutoMeasureGeometryValidation;
    };

const MIN_AUTO_MEASURE_DIAGONAL_PX = 6;
const MAX_AUTO_MEASURE_DIAGONAL_RATIO = 4;

function formatAutoMeasureNumber(value: number | null | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits)
    : 'n/a';
}

function formatAutoMeasureCenter(center: { x: number; y: number } | null | undefined): string {
  return center && Number.isFinite(center.x) && Number.isFinite(center.y)
    ? `(${center.x.toFixed(2)},${center.y.toFixed(2)})`
    : 'n/a';
}

function logAutoMeasurePhase(phase: string, context: AutoMeasureLogContext): void {
  const d1 = context.d1Px ?? null;
  const d2 = context.d2Px ?? null;
  const ratio =
    typeof d1 === 'number' && Number.isFinite(d1) &&
    typeof d2 === 'number' && Number.isFinite(d2) && d2 > 0
      ? d1 / d2
      : null;
  // eslint-disable-next-line no-console
  console.log(
    `[${phase}] objective=${context.objective ?? 'unknown'} smoothing=${context.smoothing} threshold=${context.threshold} d1=${formatAutoMeasureNumber(d1)} d2=${formatAutoMeasureNumber(d2)} ratio=${formatAutoMeasureNumber(ratio, 3)} center=${formatAutoMeasureCenter(context.center)} reason=${context.reason ?? 'n/a'} method=${context.method ?? 'refined'}${context.extra ? ` ${context.extra}` : ''}`
  );
}

function smoothingToPreviewKernel(smoothing: number): number {
  if (smoothing <= 0) return 1;
  const bucket = Math.min(5, Math.max(1, Math.ceil(smoothing / 4)));
  return bucket * 2 + 1;
}

function readPreviewKernel(result: VickersAutoMeasureSuccess, smoothing: number): number {
  const debug = result.debug;
  const settings = debug.settings;
  if (settings && typeof settings === 'object' && 'gaussianKernel' in settings) {
    const value = Number((settings as { gaussianKernel?: unknown }).gaussianKernel);
    if (Number.isFinite(value)) return value;
  }
  const value = Number((debug as { gaussianKernel?: unknown }).gaussianKernel);
  return Number.isFinite(value) ? value : smoothingToPreviewKernel(smoothing);
}

function cloneCapturedFrame(frame: CapturedAutoMeasureFrame): CapturedAutoMeasureFrame {
  return {
    ...frame,
    buffer: frame.buffer.slice(0),
  };
}

function finitePoint(point: { x: number; y: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function hasValidAutoMeasureCorners(result: VickersAutoMeasureSuccess): boolean {
  return (
    finitePoint(result.corners.top) &&
    finitePoint(result.corners.right) &&
    finitePoint(result.corners.bottom) &&
    finitePoint(result.corners.left)
  );
}

function readAutoMeasurePoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as { x?: unknown; y?: unknown };
  const x = Number(point.x);
  const y = Number(point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function readAutoMeasureCorners(value: unknown): AutoMeasureCorners | null {
  if (!value || typeof value !== 'object') return null;
  const corners = value as Record<keyof AutoMeasureCorners, unknown>;
  const top = readAutoMeasurePoint(corners.top);
  const right = readAutoMeasurePoint(corners.right);
  const bottom = readAutoMeasurePoint(corners.bottom);
  const left = readAutoMeasurePoint(corners.left);
  return top && right && bottom && left ? { top, right, bottom, left } : null;
}

function orderRoughDiamondPoints(points: { x: number; y: number }[]): AutoMeasureCorners | null {
  if (points.length !== 4 || points.some((point) => !finitePoint(point))) return null;
  const indexed = points.map((point, index) => ({ point, index }));
  const top = [...indexed].sort((a, b) => a.point.y - b.point.y || a.point.x - b.point.x)[0];
  const bottom = [...indexed].sort((a, b) => b.point.y - a.point.y || b.point.x - a.point.x)[0];
  const left = [...indexed].sort((a, b) => a.point.x - b.point.x || a.point.y - b.point.y)[0];
  const right = [...indexed].sort((a, b) => b.point.x - a.point.x || b.point.y - a.point.y)[0];
  if (new Set([top.index, right.index, bottom.index, left.index]).size !== 4) return null;
  return {
    top: top.point,
    right: right.point,
    bottom: bottom.point,
    left: left.point,
  };
}

function roughCornersFromRotatedRect(rect: unknown): AutoMeasureCorners | null {
  if (!rect || typeof rect !== 'object') return null;
  const source = rect as { center?: unknown; width?: unknown; height?: unknown; angle?: unknown };
  const center = readAutoMeasurePoint(source.center);
  const width = Number(source.width);
  const height = Number(source.height);
  const angle = Number(source.angle);
  if (!center || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const theta = (Number.isFinite(angle) ? angle : 0) * Math.PI / 180;
  const ux = { x: Math.cos(theta) * width / 2, y: Math.sin(theta) * width / 2 };
  const uy = { x: -Math.sin(theta) * height / 2, y: Math.cos(theta) * height / 2 };
  return orderRoughDiamondPoints([
    { x: center.x - ux.x - uy.x, y: center.y - ux.y - uy.y },
    { x: center.x + ux.x - uy.x, y: center.y + ux.y - uy.y },
    { x: center.x + ux.x + uy.x, y: center.y + ux.y + uy.y },
    { x: center.x - ux.x + uy.x, y: center.y - ux.y + uy.y },
  ]);
}

function readRoughAutoMeasureCorners(debug: Record<string, unknown>): {
  corners: AutoMeasureCorners;
  reason: string;
} | null {
  for (const key of ['roughCorners', 'contourCorners', 'initialCorners']) {
    const corners = readAutoMeasureCorners(debug[key]);
    if (corners) return { corners, reason: `debug-${key}` };
  }
  const rectCorners = roughCornersFromRotatedRect(debug.minAreaRect);
  if (rectCorners) return { corners: rectCorners, reason: 'debug-minAreaRect' };
  const finalCorners = readAutoMeasureCorners(debug.finalCorners);
  return finalCorners ? { corners: finalCorners, reason: 'debug-finalCorners' } : null;
}

function validateAutoMeasureGeometry(
  corners: AutoMeasureCorners,
  context: Omit<AutoMeasureLogContext, 'd1Px' | 'd2Px' | 'center' | 'reason'> & {
    reason?: string;
  }
): AutoMeasureGeometryValidation {
  const finite =
    finitePoint(corners.top) &&
    finitePoint(corners.right) &&
    finitePoint(corners.bottom) &&
    finitePoint(corners.left);
  const d1Px = finite
    ? Math.hypot(corners.right.x - corners.left.x, corners.right.y - corners.left.y)
    : Number.NaN;
  const d2Px = finite
    ? Math.hypot(corners.bottom.x - corners.top.x, corners.bottom.y - corners.top.y)
    : Number.NaN;
  const midD1 = finite
    ? { x: (corners.left.x + corners.right.x) / 2, y: (corners.left.y + corners.right.y) / 2 }
    : { x: Number.NaN, y: Number.NaN };
  const midD2 = finite
    ? { x: (corners.top.x + corners.bottom.x) / 2, y: (corners.top.y + corners.bottom.y) / 2 }
    : { x: Number.NaN, y: Number.NaN };
  const center = {
    x: (midD1.x + midD2.x) / 2,
    y: (midD1.y + midD2.y) / 2,
  };
  const ratio = d2Px > 0 ? d1Px / d2Px : Number.NaN;
  const distinctDistances = finite
    ? [
        Math.hypot(corners.top.x - corners.right.x, corners.top.y - corners.right.y),
        Math.hypot(corners.right.x - corners.bottom.x, corners.right.y - corners.bottom.y),
        Math.hypot(corners.bottom.x - corners.left.x, corners.bottom.y - corners.left.y),
        Math.hypot(corners.left.x - corners.top.x, corners.left.y - corners.top.y),
      ]
    : [Number.NaN];
  const midpointOffset = Math.hypot(midD1.x - midD2.x, midD1.y - midD2.y);
  const minDiagonal = Math.min(d1Px, d2Px);
  const diagonalOk =
    Number.isFinite(d1Px) &&
    Number.isFinite(d2Px) &&
    d1Px >= MIN_AUTO_MEASURE_DIAGONAL_PX &&
    d2Px >= MIN_AUTO_MEASURE_DIAGONAL_PX;
  const ratioOk =
    Number.isFinite(ratio) &&
    ratio >= 1 / MAX_AUTO_MEASURE_DIAGONAL_RATIO &&
    ratio <= MAX_AUTO_MEASURE_DIAGONAL_RATIO;
  const orderOk =
    finite &&
    corners.left.x < corners.right.x &&
    corners.top.y < corners.bottom.y;
  const distinctOk = distinctDistances.every((distance) => distance >= 2);
  const centerOk =
    Number.isFinite(midpointOffset) &&
    Number.isFinite(minDiagonal) &&
    midpointOffset <= Math.max(12, minDiagonal * 0.65);
  const reason = !finite
    ? 'non-finite-corners'
    : !diagonalOk
      ? 'diagonals-too-small'
      : !ratioOk
        ? 'diagonal-ratio-out-of-range'
        : !orderOk
          ? 'corner-order-invalid'
          : !distinctOk
            ? 'corner-points-not-distinct'
            : !centerOk
              ? 'diagonal-centers-too-far-apart'
              : context.reason ?? 'geometry-usable';
  const validation = {
    ok: finite && diagonalOk && ratioOk && orderOk && distinctOk && centerOk,
    reason,
    d1Px,
    d2Px,
    ratio,
    center,
  };
  logAutoMeasurePhase('auto-measure-diamond-validation', {
    ...context,
    d1Px,
    d2Px,
    center,
    reason,
  });
  return validation;
}

function buildRoughAutoMeasureResult(
  raw: VickersAutoMeasureResult,
  corners: AutoMeasureCorners,
  reason: string
): VickersAutoMeasureSuccess {
  const d1Pixels = Math.hypot(corners.right.x - corners.left.x, corners.right.y - corners.left.y);
  const d2Pixels = Math.hypot(corners.bottom.x - corners.top.x, corners.bottom.y - corners.top.y);
  const debug = raw.debug ?? {};
  const confidence = Number((debug as { confidence?: unknown }).confidence);
  return {
    ok: true,
    source: raw.source === 'uploaded-image' ? 'uploaded-image' : 'live-camera',
    corners,
    lines: [
      { p1: corners.top, p2: corners.right },
      { p1: corners.right, p2: corners.bottom },
      { p1: corners.bottom, p2: corners.left },
      { p1: corners.left, p2: corners.top },
    ],
    d1Pixels,
    d2Pixels,
    d1Mm: null,
    d2Mm: null,
    averageMm: null,
    confidence: Number.isFinite(confidence) && confidence > 0 ? confidence : 0,
    hv: null,
    debug: {
      ...debug,
      frontendFallback: 'rough',
      frontendFallbackReason: reason,
    },
  };
}

function resolveAutoMeasureDetection(
  raw: VickersAutoMeasureResult,
  context: Pick<AutoMeasureLogContext, 'objective' | 'smoothing' | 'threshold'>
): ResolvedAutoMeasureDetection {
  if (raw.ok) {
    const refinedResult = raw;
    const refinedCorners = refinedResult.corners;
    const validation = validateAutoMeasureGeometry(refinedCorners, {
      ...context,
      method: 'refined',
      reason: 'refined-corners',
    });
    logAutoMeasurePhase('auto-measure-refined-corners', {
      ...context,
      method: 'refined',
      d1Px: validation.d1Px,
      d2Px: validation.d2Px,
      center: validation.center,
      reason: validation.reason,
    });
    if (validation.ok) {
      const roughForLog = readRoughAutoMeasureCorners(raw.debug ?? {});
      if (roughForLog) {
        const roughValidation = validateAutoMeasureGeometry(roughForLog.corners, {
          ...context,
          method: 'rough',
          reason: roughForLog.reason,
        });
        logAutoMeasurePhase('auto-measure-rough-diamond', {
          ...context,
          method: 'rough',
          d1Px: roughValidation.d1Px,
          d2Px: roughValidation.d2Px,
          center: roughValidation.center,
          reason: roughValidation.reason,
          extra: `source=${roughForLog.reason} used=false`,
        });
      } else {
        logAutoMeasurePhase('auto-measure-rough-diamond', {
          ...context,
          method: 'rough',
          reason: 'rough-geometry-missing used=false',
        });
      }
      return {
        ok: true,
        result: refinedResult,
        method: 'refined',
        reason: validation.reason,
        validation,
        fallbackUsed: false,
      };
    }
  } else {
    logAutoMeasurePhase('auto-measure-refined-corners', {
      ...context,
      method: 'refined',
      reason: raw.reason,
    });
  }

  const debug = raw.debug ?? {};
  const rough = readRoughAutoMeasureCorners(debug);
  if (rough) {
    const validation = validateAutoMeasureGeometry(rough.corners, {
      ...context,
      method: 'rough',
      reason: rough.reason,
    });
    logAutoMeasurePhase('auto-measure-rough-diamond', {
      ...context,
      method: 'rough',
      d1Px: validation.d1Px,
      d2Px: validation.d2Px,
      center: validation.center,
      reason: validation.reason,
      extra: `source=${rough.reason}`,
    });
    if (validation.ok) {
      logAutoMeasurePhase('auto-measure-fallback-used', {
        ...context,
        method: 'rough',
        d1Px: validation.d1Px,
        d2Px: validation.d2Px,
        center: validation.center,
        reason: raw.ok ? 'refined-geometry-not-usable' : raw.reason,
        extra: `source=${rough.reason}`,
      });
      return {
        ok: true,
        result: buildRoughAutoMeasureResult(raw, rough.corners, rough.reason),
        method: 'rough',
        reason: rough.reason,
        validation,
        fallbackUsed: true,
      };
    }
  } else {
    logAutoMeasurePhase('auto-measure-rough-diamond', {
      ...context,
      method: 'rough',
      reason: 'rough-geometry-missing',
    });
  }

  const reason = raw.ok
    ? 'no usable diamond geometry'
    : raw.reason || 'no usable diamond geometry';
  return {
    ok: false,
    reason,
    method: raw.ok ? 'refined' : 'rough',
  };
}

function graphicsFromAutoMeasureResult(
  result: VickersAutoMeasureSuccess,
  objective?: string | null
): AutoMeasureGraphics {
  // All objectives — 10X included — now use the four-guides layout that
  // 40X has always used. The native addon runs the same 4-edge side-fit +
  // intersection pipeline for every objective (`twoLineMode` is disabled),
  // and the frontend renders the same yellow edge/guide overlay.
  const norm = (objective ?? '').trim().toUpperCase();
  const lineLayout: 'four-guides' | 'two-diagonals' = 'four-guides';
  if (norm === '10X') {
    // eslint-disable-next-line no-console
    console.log(`[overlay-set] objective=10X mode=four-edge`);
  }
  const tagObjective = norm || null;
  if (result.lines.length === 4) {
    return { corners: result.corners, lines: result.lines, lineLayout, objective: tagObjective };
  }
  const { top, right, bottom, left } = result.corners;
  return {
    corners: result.corners,
    lines: [
      { p1: top, p2: right },
      { p1: right, p2: bottom },
      { p1: bottom, p2: left },
      { p1: left, p2: top },
    ],
    lineLayout,
    objective: tagObjective,
  };
}

type DialogKey =
  | 'autoMeasure'
  | 'calibration'
  | 'camera'
  | 'generic'
  | 'lineColor'
  | 'other'
  | 'restoreFactory'
  | 'serialPort'
  | 'testRecords'
  | null;

// Two RAFs guarantees overlay canvases (AutoMeasure / ManualMeasure) finished
// painting after a state-driven update before we composite them into the album
// thumbnail.
function waitForOverlayPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function App() {
  const [activeDialog, setActiveDialog] = useState<DialogKey>(null);
  const [statusMessage, setStatusMessage] = useState('System Status: Ready');
  const [initialTestRecordMeasurementIds, setInitialTestRecordMeasurementIds] = useState<string[]>([]);
  const {
    data: measurements,
    error: measurementsError,
    loading: measurementsLoading,
    refetch: refetchMeasurements,
  } = useMeasurements();
  const {
    data: toolbarState,
    error: toolbarStateError,
    loading: toolbarStateLoading,
    refetch: refetchToolbarState,
  } = useToolbarState();
  const { saveToolbarState } = useSaveToolbarState();
  const { data: lineColorSetting, refetch: refetchLineColor } = useLineColorSetting();
  const {
    data: calibrationSettings,
    items: calibrationSettingsList,
    refetch: refetchCalibrationSettings,
  } = useCalibrationSettings();
  const { data: calibrations, refetch: refetchCalibrations } = useCalibrations();
  const { data: autoMeasureSettings, refetch: refetchAutoMeasureSettings } = useAutoMeasureSettings();
  const { refetch: refetchCameraSetting } = useCameraSetting();
  const { data: serialPortSetting } = useSerialPortSetting();
  const { connect: connectMachineFn, disconnect: disconnectMachineFn } = useConnectMachine();
  const { saveMeasurement: saveManualMeasurement } = useSaveMeasurement();
  const { getSnapshot: getMachineStateSnapshot } = useMachineStateSnapshot();
  // SSE-reactive machine state — same hook MachineControlTab uses, so the
  // value App reads here is the same as the highlighted lens button.
  const { data: liveMachineState } = useMachineState();
  const restoredToolbarActionRef = useRef(false);
  const manualMeasurementIdRef = useRef<string | null>(null);
  const { activeTool, setActiveTool } = useActiveTool('pointer');
  const overlay = useImageOverlay();
  const lineThickness = useLineThickness();
  const cameraRef = useRef<CameraWindowHandle | null>(null);
  const autoMeasureInFlightRef = useRef(false);
  // Set true between Impress TX and the FINISH RX so any concurrent Auto
  // Measure entry point (manual click, settings preview, drag-recompute) is
  // refused — the indenter is still over the workpiece, the live frame is
  // mid-motion, and any detection would commit a row for the wrong instant.
  const impressInProgressRef = useRef(false);
  const lastSeenIndentStatusRef = useRef<IndentStatus>('idle');
  // Latest preview settings that arrived while a detection was in flight.
  // Why: Slider drags fire faster than the native detection completes
  // (~60–200ms). Without coalescing, the user's final slider position can be
  // dropped, leaving the yellow lines fitted to a stale value.
  const autoMeasurePendingPreviewRef = useRef<AutoMeasureSettingsPayload | null>(null);
  const latestAutoMeasurePreviewSettingsRef =
    useRef<AutoMeasureSettingsPayload>(DEFAULT_AUTO_MEASURE_SETTINGS);
  const runAutoMeasureRef = useRef<RunAutoMeasure | null>(null);
  const autoMeasurePreviewSnapshotRef = useRef<AutoMeasureDetectionSnapshot | null>(null);
  const committedAutoMeasureFrameRef = useRef<CapturedAutoMeasureFrame | null>(null);
  const previewMeasurementRef = useRef<{ d1Pixels: number; d2Pixels: number; confidence: number } | null>(null);
  const autoMeasureSettingsOpenRef = useRef(false);
  const [unavailableMsg, setUnavailableMsg] = useState<string | null>(null);
  const [trimMeasureOpen, setTrimMeasureOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [manualMeasureResetKey, setManualMeasureResetKey] = useState(0);
  // Magnifier is an independent helper overlay (not a mode). It can be on
  // alongside Manual Measure for precision diamond-tip placement, and turns
  // off when the user switches to Pointer/Auto Measure (see handleToolbarSelect).
  const [magnifierEnabled, setMagnifierEnabled] = useState(false);
  const [committedAutoMeasureOverlay, setCommittedAutoMeasureOverlay] =
    useState<AutoMeasureGraphics | null>(null);
  const [previewAutoMeasureOverlay, setPreviewAutoMeasureOverlay] =
    useState<AutoMeasureGraphics | null>(null);
  const [, setAutoMeasuring] = useState(false);
  // Strict lifecycle gate. Yellow Auto Measure overlay must never be visible
  // when the camera is not actively streaming — even if a stale graphics
  // state lingers in React. Flipped true only after a successful openDevice
  // reply, flipped false at closeDevice.
  const [cameraOpen, setCameraOpen] = useState(false);
  const [autoMeasurePreviewSettings, setAutoMeasurePreviewSettings] =
    useState<AutoMeasureSettingsPayload>(DEFAULT_AUTO_MEASURE_SETTINGS);
  const rawDisplayedAutoMeasureGraphics =
    activeDialog === 'autoMeasure'
      ? previewAutoMeasureOverlay ?? committedAutoMeasureOverlay
      : committedAutoMeasureOverlay;
  const displayedAutoMeasureSource: 'auto' | 'preview' | 'save' =
    activeDialog === 'autoMeasure' && previewAutoMeasureOverlay ? 'preview' : 'auto';
  const displayedAutoMeasureGraphicsRef = useRef<AutoMeasureGraphics | null>(null);
  const autoMeasurementIdRef = useRef<string | null>(null);
  // Duplicate-measurement guard for every committed Auto Measure row in the
  // current measurement session. It survives overlay clears and repeat Auto
  // Measure clicks; only table clear, new image/session resets, or row removal
  // prune it.
  const committedFingerprintsRef = useRef<CommittedAutoMeasureFingerprint[]>([]);
  useEffect(() => {
    const currentRowIds = new Set(measurements.map((measurement) => measurement.id));
    const next = committedFingerprintsRef.current.filter(
      (entry) => entry.rowId !== null && currentRowIds.has(entry.rowId)
    );
    if (next.length === committedFingerprintsRef.current.length) return;
    committedFingerprintsRef.current = next;
    // eslint-disable-next-line no-console
    console.log(`[measurement-fingerprint-prune] total=${next.length}`);
  }, [measurements]);
  // SINGLE GLOBAL SOURCE OF TRUTH for the active objective.
  // - Set by the user's lens button click (authoritative, instant).
  // - Hydrated from SSE machine state when SSE pushes (guarded so it cannot
  //   clobber a recent user click).
  // - Used by Auto Measure, Manual Measure, calibration lookup, and the
  //   measurement table row.
  // - There is NO silent fallback to a hardcoded default. If this is ever
  //   null at save time, we surface a warning instead of saving "10X".
  const [activeObjective, setActiveObjective] = useState<string | null>(null);

  // Strict session-based Auto Measure gating.
  // - sessionId: bumps every time the user opens a fresh Auto Measure session
  //   (Auto Measure click or Settings preview enter). Used by async detection
  //   callbacks to reject results from a superseded session.
  // - sessionActive: true while a session "owns" the overlay; cleared by any
  //   invalidator (objective change, turret change, lightness change is N/A
  //   because lightness never starts a session, camera close).
  // - capturedFrameId: the frame id captured at click time. Render gate
  //   compares the overlay's frameId against this — a stale async result
  //   from before the most recent click is filtered out.
  // - objectiveChangeInProgress: true between objective-change request and
  //   the first painted live frame at the new mag. Suppresses any overlay
  //   draw during the transition window.
  // Status-bar surfaces. Kept as discrete state so transitions log explicitly
  // and the bar updates without recomputing from a dozen scattered flags.
  const [cameraStatus, setCameraStatusState] = useState<CameraStatusState>('closed');
  const setCameraStatus = useCallback((next: CameraStatusState) => {
    setCameraStatusState((prev) => {
      if (prev === next) return prev;
      // eslint-disable-next-line no-console
      console.log(`[camera-state-change] from=${prev} to=${next}`);
      // eslint-disable-next-line no-console
      console.log(`[statusbar-camera] state=${next}`);
      return next;
    });
  }, []);
  const [autoMeasureStatus, setAutoMeasureStatusState] =
    useState<AutoMeasureStatusState>('idle');
  const setAutoMeasureStatus = useCallback((next: AutoMeasureStatusState) => {
    setAutoMeasureStatusState((prev) => {
      if (prev === next) return prev;
      // eslint-disable-next-line no-console
      console.log(`[statusbar-auto-measure] state=${next}`);
      return next;
    });
  }, []);

  const [autoMeasureSessionId, setAutoMeasureSessionId] = useState(0);
  const autoMeasureSessionIdRef = useRef(0);
  // Bump-counter that forces AutoMeasureOverlay to imperatively clearRect its
  // canvas (bypassing React state and the skip-redraw cache). Incremented on
  // every objective change so no stale yellow lines from the prior mag survive
  // into the next session.
  const [autoMeasureClearNonce, setAutoMeasureClearNonce] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(`[auto-measure-session] id=${autoMeasureSessionId}`);
  }, [autoMeasureSessionId]);
  const [autoMeasureSessionActive, setAutoMeasureSessionActive] = useState(false);
  const [autoMeasureCapturedFrameId, setAutoMeasureCapturedFrameId] = useState<number | null>(null);
  const [objectiveChangeInProgress, setObjectiveChangeInProgress] = useState(false);

  // Hard render gate for the yellow Auto Measure overlay. Never show yellow
  // lines/dots unless the camera is streaming. Also drops graphics whose
  // detection-time objective no longer matches the live activeObjective so a
  // 40X overlay can never linger after a switch to 10X (and vice versa).
  const lastOverlayRenderLogRef = useRef<string | null>(null);
  const displayedAutoMeasureGraphics = (() => {
    if (!cameraOpen) return null;
    if (objectiveChangeInProgress) {
      // eslint-disable-next-line no-console
      console.log('[overlay-render-guard] visible=false reason=objective-change-in-progress');
      return null;
    }
    if (!rawDisplayedAutoMeasureGraphics) return null;
    if (!autoMeasureSessionActive) {
      // eslint-disable-next-line no-console
      console.log('[overlay-render-guard] visible=false reason=no-active-auto-session');
      return null;
    }
    const overlayObjective = (rawDisplayedAutoMeasureGraphics.objective ?? '').trim().toUpperCase();
    const confirmedFromMachine = (liveMachineState?.confirmedObjectiveFromMachine ?? '')
      .trim()
      .toUpperCase();
    const liveObjective = (activeObjective ?? '').trim().toUpperCase();
    const referenceObjective = confirmedFromMachine || liveObjective;
    if (overlayObjective && referenceObjective && overlayObjective !== referenceObjective) {
      // eslint-disable-next-line no-console
      console.log(
        `[overlay-render-guard] visible=false reason=objective-mismatch overlay=${overlayObjective} live=${referenceObjective}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-overlay-skip] reason=objective-mismatch overlayObjective=${overlayObjective} activeObjective=${referenceObjective}`
      );
      return null;
    }
    const overlayFrameId = rawDisplayedAutoMeasureGraphics.frameId ?? null;
    if (
      overlayFrameId !== null &&
      autoMeasureCapturedFrameId !== null &&
      overlayFrameId !== autoMeasureCapturedFrameId
    ) {
      // eslint-disable-next-line no-console
      console.log(
        `[overlay-render-guard] visible=false reason=frame-mismatch overlay=${overlayFrameId} captured=${autoMeasureCapturedFrameId}`
      );
      return null;
    }
    const renderKey = `${overlayObjective || 'unknown'}|${overlayFrameId ?? 'n/a'}`;
    if (lastOverlayRenderLogRef.current !== renderKey) {
      lastOverlayRenderLogRef.current = renderKey;
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-overlay-render] objective=${overlayObjective || 'unknown'} frameId=${overlayFrameId ?? 'n/a'}`
      );
    }
    return rawDisplayedAutoMeasureGraphics;
  })();

  // Whenever the active objective changes (UI click OR machine echo), snap
  // Auto Measure smoothing/threshold to that objective's tuned defaults so
  // the Settings dialog and the next detection run pick them up. Also
  // emits the defaults log so we can verify in the console.
  const previousActiveObjectiveRef = useRef<string | null>(null);
  useEffect(() => {
    const defaults = autoMeasureDefaultsForObjective(activeObjective);
    const oldObjective = previousActiveObjectiveRef.current;
    previousActiveObjectiveRef.current = activeObjective;
    if (!defaults) return;
    // eslint-disable-next-line no-console
    console.log(
      `[auto-measure-defaults] objective=${activeObjective} smoothing=${defaults.smoothing} threshold=${defaults.threshold}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[auto-measure-settings-sync] objective=${activeObjective} smoothing=${defaults.smoothing} threshold=${defaults.threshold}`
    );
    setAutoMeasurePreviewSettings((prev) => {
      if (prev.smoothing === defaults.smoothing && prev.threshold === defaults.threshold) {
        return prev;
      }
      return { ...prev, smoothing: defaults.smoothing, threshold: defaults.threshold };
    });
    // Objective changed — drop any visible Auto Measure lines, end the
    // current session (so async results from the old objective can't paint),
    // and arm the suppression ref so a settings-preview detection cannot
    // repaint yellow lines for the new magnification on its own. Lines
    // reappear only after the user clicks Auto Measure again.
    suppressAutoMeasurePreviewRef.current = true;
    setCommittedAutoMeasureOverlay(null);
    setPreviewAutoMeasureOverlay(null);
    autoMeasurePreviewSnapshotRef.current = null;
    committedAutoMeasureFrameRef.current = null;
    previewMeasurementRef.current = null;
    setAutoMeasureSessionActive(false);
    setAutoMeasureCapturedFrameId(null);
    setAutoMeasureSessionId((id) => {
      const next = id + 1;
      autoMeasureSessionIdRef.current = next;
      return next;
    });
    setAutoMeasureStatusState('idle');
    // Force AutoMeasureOverlay to imperatively clear its canvas — React state
    // nulling alone was leaving yellow lines on screen across objective swaps.
    setAutoMeasureClearNonce((n) => n + 1);
    // eslint-disable-next-line no-console
    console.log(
      `[overlay-clear] reason=objective-change oldObjective=${oldObjective ?? 'null'} newObjective=${activeObjective ?? 'null'}`
    );
    // eslint-disable-next-line no-console
    console.log('[auto-measure-state-clear] reason=objective-change');
    // eslint-disable-next-line no-console
    console.log(
      `[auto-measure-overlay-clear] reason=objective-change from=${oldObjective ?? 'null'} to=${activeObjective ?? 'null'}`
    );
    // eslint-disable-next-line no-console
    console.log('[overlay-visible] false reason=objective-change');
  }, [activeObjective]);
  // Last manual-measure pixel diagonals (d1Px = horizontal, d2Px = vertical).
  // Captured in handleManualMeasurementUpdated and passed to CalibrationDialog
  // so opening the dialog auto-fills Pixel Length X / Y. State (not ref) so
  // the dialog re-renders with fresh values when re-opened.
  const [latestManualPixels, setLatestManualPixels] = useState<{
    d1Px: number;
    d2Px: number;
  } | null>(null);
  // True while the user is doing a Manual Measure that was launched from the
  // Calibration dialog. handleManualMeasurementUpdated checks this flag so it
  // can suppress measurement-row creation (calibration mode is pixels-only)
  // and the calibration dialog re-opens once the user is done.
  const calibrationManualModeRef = useRef(false);
  const lastObjectiveClickAtRef = useRef<number>(0);
  // Bumps every time the machine confirms a new objective via L1OK / L2OK RX.
  // CameraWindow watches it to invalidate any per-objective caches and force a
  // fresh draw — separate from activeObjective so we can trigger a refresh
  // even when the confirmed value is identical (e.g. user re-selects same lens).
  const [objectiveRefreshKey, setObjectiveRefreshKey] = useState<number>(0);
  const lastSyncedObjectiveRef = useRef<string | null>(null);
  // Set true whenever the active objective changes. The next would-be
  // settings-preview run is skipped so an objective change never paints
  // yellow lines on its own — they appear only after an explicit Auto
  // Measure click. Cleared by the click handler.
  const suppressAutoMeasurePreviewRef = useRef(false);
  // Clears Auto Measure overlay/session state without touching committed row
  // fingerprints. Duplicate suppression must survive overlay clears.
  const clearAutoMeasureOverlay = useCallback((reason: string) => {
    setCommittedAutoMeasureOverlay((prev) => {
      if (!prev) {
        // eslint-disable-next-line no-console
        console.log(`[overlay-skip] reason=no-active-measurement-overlay trigger=${reason}`);
      }
      return null;
    });
    setPreviewAutoMeasureOverlay(null);
    autoMeasurePreviewSnapshotRef.current = null;
    committedAutoMeasureFrameRef.current = null;
    previewMeasurementRef.current = null;
    autoMeasurementIdRef.current = null;
    // Cancel any pending coalesced trailing detection and mark the settings
    // dialog closed in the ref the in-flight finally block consults so a
    // queued preview run does not repaint after we just cleared.
    autoMeasurePendingPreviewRef.current = null;
    autoMeasureSettingsOpenRef.current = false;
    // End the current Auto Measure session: any in-flight detection callback
    // that observes the bumped sessionId will refuse to paint.
    setAutoMeasureSessionActive(false);
    setAutoMeasureCapturedFrameId(null);
    setAutoMeasureSessionId((id) => {
      const next = id + 1;
      autoMeasureSessionIdRef.current = next;
      return next;
    });
    // eslint-disable-next-line no-console
    console.log(`[auto-measure-clear] ${reason}`);
    // eslint-disable-next-line no-console
    console.log(`[overlay-clear] reason=${reason}`);
  }, []);

  const handleObjectiveChangeFromUI = useCallback((objective: '10X' | '40X') => {
    lastObjectiveClickAtRef.current = Date.now();
    const isActualSwitch = (activeObjective ?? '').trim().toUpperCase() !== objective;
    setActiveObjective(objective);
    // eslint-disable-next-line no-console
    console.log(`[objective-change-request] source=ui objective=${objective}`);
    // eslint-disable-next-line no-console
    console.log('[objective] changed →', objective);
    // Snap Auto Measure smoothing/threshold to the objective-tuned defaults
    // so the Settings dialog and any next preview run use the right values.
    const defaults = autoMeasureDefaultsForObjective(objective);
    if (defaults) {
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-defaults] objective=${objective} smoothing=${defaults.smoothing} threshold=${defaults.threshold}`
      );
      setAutoMeasurePreviewSettings((prev) => ({
        ...prev,
        smoothing: defaults.smoothing,
        threshold: defaults.threshold,
      }));
    }
    // Clear the yellow Auto Measure overlay immediately on the user's
    // request — do not wait for the L#OK confirmation — so the live camera
    // never shows D1/D2 from the previous magnification during the
    // turret-switch window.
    if (isActualSwitch) {
      setObjectiveChangeInProgress(true);
    }
    clearAutoMeasureOverlay('objective-change');
  }, [activeObjective, clearAutoMeasureOverlay]);

  // Calibration-mode Auto Measure: runs the same native detector used by
  // normal Auto Measure but does NOT save a measurement row. Returns the
  // detected pixel diagonals so the Calibration dialog can fill Pixel
  // Length X / Y. The yellow corners + lines are still drawn on the camera
  // overlay so the user can verify the detection visually after closing
  // the dialog.
  const handleCalibrationAutoMeasure = useCallback(
    async (objective: string): Promise<{ d1Px: number; d2Px: number } | null> => {
      // eslint-disable-next-line no-console
      console.log(`[calibration-auto-measure-start] objective=${objective}`);
      const camera = cameraRef.current;
      if (!camera) {
        setStatusMessage('System Status: Calibration Auto Measure: camera unavailable');
        return null;
      }
      let frame = camera.captureDisplayedFrame({ freeze: true });
      // eslint-disable-next-line no-console
      console.log(`[auto-measure-snapshot] frameId=${getLastPaintedFrameId()}`);
      if (frame && !frame.ok && frame.error === 'awaiting-fresh-frame') {
        const fresh = await camera.waitForFreshFrame(2000);
        if (fresh) frame = camera.captureDisplayedFrame({ freeze: true });
      }
      if (!frame?.ok) {
        setStatusMessage(
          `System Status: Calibration Auto Measure: ${frame?.error ?? 'no frame'}`
        );
        return null;
      }
      const settings = normalizeAutoMeasureSettings(autoMeasureSettings);
      const candidate = String(objective ?? '').trim().toUpperCase();
      const liveObjectiveForNative: ObjectiveForMeasure =
        (OBJECTIVE_FOR_MEASURE_OPTIONS as readonly string[]).includes(candidate)
          ? (candidate as ObjectiveForMeasure)
          : settings.objectiveForMeasure;
      const minConfidence =
        settings.imageType === 'HV-1' ? 0.52 : settings.imageType === 'HV-3' ? 0.38 : 0.45;
      const calibObjectiveDefaults = autoMeasureDefaultsForObjective(liveObjectiveForNative);
      const calibSmoothing = calibObjectiveDefaults?.smoothing ?? settings.smoothing;
      const calibThreshold = calibObjectiveDefaults?.threshold ?? settings.threshold;
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-run] objective=${liveObjectiveForNative} smoothing=${calibSmoothing} threshold=${calibThreshold} source=calibration`
      );
      const result = await measureVickersAuto({
        smoothing: calibSmoothing,
        threshold: calibThreshold,
        objectiveForMeasure: liveObjectiveForNative,
        frameBuffer: frame.buffer,
        width: frame.width,
        height: frame.height,
        pixelFormat: frame.pixelFormat,
        bits: frame.bits,
        source: frame.source,
        micronPerPixel: null,
        pxPerMm: null,
        testForceKgf: null,
        minConfidence,
        timeoutMs: 4000,
        maxFrameAgeMs: 1200,
      });
      if (!result.ok || !hasValidAutoMeasureCorners(result)) {
        const reason = result.ok ? 'invalid corner coordinates' : result.reason;
        setStatusMessage(`System Status: Calibration Auto Measure rejected: ${reason}`);
        return null;
      }
      // Draw the detected diamond on the camera overlay so the user sees the
      // detection result after closing the calibration dialog.
      // Calibration-path detection also activates the session so the render
      // gate allows the verification overlay to paint.
      setAutoMeasureSessionActive(true);
      setCommittedAutoMeasureOverlay(graphicsFromAutoMeasureResult(result, objective));
      // eslint-disable-next-line no-console
      console.log(
        `[calibration-auto-measure-success] pixelX=${result.d1Pixels} pixelY=${result.d2Pixels}`
      );
      if (liveObjectiveForNative === '10X' && hasValidAutoMeasureCorners(result)) {
        const c = result.corners;
        const centerX = (c.left.x + c.right.x) / 2;
        const centerY = (c.top.y + c.bottom.y) / 2;
        // eslint-disable-next-line no-console
        console.log(
          `[calibration-auto-measure-10x] center=(${centerX.toFixed(2)},${centerY.toFixed(2)}) d1Px=${result.d1Pixels.toFixed(2)} d2Px=${result.d2Pixels.toFixed(2)}`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-10x-lines] d1Start=(${c.left.x.toFixed(2)},${c.left.y.toFixed(2)}) d1End=(${c.right.x.toFixed(2)},${c.right.y.toFixed(2)}) d2Start=(${c.top.x.toFixed(2)},${c.top.y.toFixed(2)}) d2End=(${c.bottom.x.toFixed(2)},${c.bottom.y.toFixed(2)})`
        );
      }
      return { d1Px: result.d1Pixels, d2Px: result.d2Pixels };
    },
    [autoMeasureSettings]
  );

  // Calibration-mode Manual Measure: activates the manual measure tool while
  // keeping the calibration PANEL open (panel layout, not modal). The user
  // drags the cross over the indent on the live image; each drag updates
  // latestManualPixels (and emits [calibration-drag-update]); the panel's
  // live-update effect syncs Pixel Length X / Y in real time. The flag
  // suppresses measurement-row creation so the calibration drag does not
  // pollute the measurement table.
  const handleCalibrationManualMeasure = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[calibration-manual-measure-start]');
    calibrationManualModeRef.current = true;
    setActiveTool('manualMeasure');
    setStatusMessage(
      'System Status: Calibration Manual Measure active: drag the cross over the indent. Pixel X/Y update live in the panel.'
    );
  }, [setActiveTool]);

  // Triggered immediately after Add Calibration succeeds. Reads the CURRENT
  // D1/D2 line pixels (already in the calibration payload), runs the
  // pixels→µm→HV conversion using the just-saved calibration, and commits a
  // measurement row so the table updates without a second click.
  const handleCalibrationAutoCreateRow = useCallback(
    async ({
      payload,
    }: {
      savedCalibration: Calibration;
      payload: CalibrationSavePayload;
    }) => {
      const d1Px = payload.pixelLengthX;
      const d2Px = payload.pixelLengthY;
      const targetObjective = payload.zoomTime;
      const forceKgf = parseForceKgf(payload.force);

      // eslint-disable-next-line no-console
      console.log(
        `[calibration-auto-row-create-start] objective=${targetObjective} force=${payload.force} forceKgf=${forceKgf ?? 'null'} d1Px=${d1Px} d2Px=${d2Px}`
      );

      // Derive PER-AXIS coefficients per spec:
      //   xUmPerPixel = knownReferenceUm / pixelLengthX
      //   yUmPerPixel = knownReferenceUm / pixelLengthY
      // Priority: 1) per-objective calibration_settings, 2) Length-tab
      // knownReferenceUm (stored in payload.realDistanceX/Y). Otherwise block
      // with a clear reason — never silently fall back to interpreting raw
      // pixel lengths as µm/pixel (that path produced nonsense rows).
      const settingsMatch = findCalibrationForObjective(
        calibrationSettingsList,
        targetObjective
      );
      const umPerPixelFromSettings =
        settingsMatch?.umPerPixel ?? settingsMatch?.pixelToMicron ?? 0;
      const knownReferenceUm =
        typeof payload.realDistanceX === 'number' && payload.realDistanceX > 0
          ? payload.realDistanceX
          : typeof payload.realDistanceY === 'number' && payload.realDistanceY > 0
            ? payload.realDistanceY
            : 0;
      const xUmPerPixel =
        umPerPixelFromSettings > 0
          ? umPerPixelFromSettings
          : d1Px > 0 && knownReferenceUm > 0
            ? knownReferenceUm / d1Px
            : 0;
      const yUmPerPixel =
        umPerPixelFromSettings > 0
          ? umPerPixelFromSettings
          : d2Px > 0 && knownReferenceUm > 0
            ? knownReferenceUm / d2Px
            : 0;

      if (!Number.isFinite(d1Px) || !Number.isFinite(d2Px) || d1Px <= 0 || d2Px <= 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[calibration-auto-row-blocked] reason=invalid-pixel-values d1Px=${d1Px} d2Px=${d2Px}`
        );
        setUnavailableMsg('D1/D2 pixel values are zero. Run Manual or Auto Measure first.');
        return;
      }

      if (xUmPerPixel <= 0 || yUmPerPixel <= 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[calibration-auto-row-blocked] reason=known-reference-missing-or-zero objective=${targetObjective} knownReferenceUm=${knownReferenceUm} settingsMatch=${settingsMatch ? 'yes' : 'no'}`
        );
        setUnavailableMsg(
          'Calibration saved, but Known Reference (µm) is zero — cannot derive xUmPerPixel / yUmPerPixel for the row.'
        );
        setStatusMessage(
          'System Status: Calibration saved. Auto row blocked: known-reference-missing-or-zero'
        );
        return;
      }

      // Spec formulas — separate per-axis coefficients, no averaging:
      //   d1Um = d1Px * xUmPerPixel
      //   d2Um = d2Px * yUmPerPixel
      //   davgUm = (d1Um + d2Um) / 2
      //   HV = 1.8544 * F / D_mm²  (D in mm; davgMm = davgUm / 1000)
      const d1UmExact = d1Px * xUmPerPixel;
      const d2UmExact = d2Px * yUmPerPixel;
      const davgUmExact = (d1UmExact + d2UmExact) / 2;
      const davgMmExact = davgUmExact / 1000;
      const hvExact =
        forceKgf && forceKgf > 0 && davgMmExact > 0
          ? (1.8544 * forceKgf) / (davgMmExact * davgMmExact)
          : null;

      // eslint-disable-next-line no-console
      console.log(
        `[measurement-convert]\nd1Px=${d1Px}\nd2Px=${d2Px}\nxUmPerPixel=${xUmPerPixel}\nyUmPerPixel=${yUmPerPixel}\nd1Um=${d1UmExact}\nd2Um=${d2UmExact}\ndavgUm=${davgUmExact}\nhv=${hvExact ?? 'n/a'}`
      );

      const round = (value: number, digits: number): number =>
        Number(value.toFixed(digits));

      const d1Um = round(d1UmExact, 3);
      const d2Um = round(d2UmExact, 3);
      const averageUm = round(davgUmExact, 3);
      const averageMm = round(davgMmExact, 6);
      const hv = hvExact === null ? null : round(hvExact, 2);

      if (d1Um <= 0 || d2Um <= 0 || averageUm <= 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[calibration-auto-row-blocked] reason=converted-values-non-positive d1Um=${d1Um} d2Um=${d2Um} averageUm=${averageUm}`
        );
        setUnavailableMsg('Computed µm values are zero — calibration coefficient is too small.');
        return;
      }
      if (hv !== null && hv <= 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[calibration-auto-row-blocked] reason=hv-non-positive hv=${hv} hvExact=${hvExact} davgMm=${davgMmExact}`
        );
        setUnavailableMsg(
          'Computed HV is non-positive — check force / calibration coefficient.'
        );
        return;
      }

      const normalizedObjective = normalizeObjectiveName(targetObjective);

      // eslint-disable-next-line no-console
      console.log(
        `[calibration-auto-row-create] objective=${normalizedObjective} xUmPerPixel=${xUmPerPixel} yUmPerPixel=${yUmPerPixel} d1Um=${d1Um} d2Um=${d2Um} davgUm=${averageUm} hv=${hv ?? 'n/a'}`
      );

      let depthMm: number | null = null;
      try {
        depthMm = await readLatestMicrometerDepthMm();
      } catch {
        depthMm = null;
      }
      await waitForOverlayPaint();
      const imageDataUrl = cameraRef.current?.captureThumbnailDataUrl() ?? undefined;

      const rowPayload = {
        d1: d1Um,
        d2: d2Um,
        d1Px: round(d1Px, 2),
        d2Px: round(d2Px, 2),
        d1Um,
        d2Um,
        averageUm,
        averageMm,
        hv,
        hardnessType: 'HV' as const,
        qualified: deriveQualifiedForRow(hv),
        micronPerPixel: round((xUmPerPixel + yUmPerPixel) / 2, 6),
        calibrationName: settingsMatch?.objective ?? `${payload.zoomTime} ${payload.force} ${payload.hardnessLevel}`,
        objective: normalizedObjective,
        testForceKgf: forceKgf,
        depthMm,
        method: 'Manual' as const,
        unit: 'um' as const,
        timestamp: new Date().toISOString(),
        imageDataUrl,
      };

      // eslint-disable-next-line no-console
      console.log('[calibration-auto-row-payload]', rowPayload);
      // eslint-disable-next-line no-console
      console.log('[hv-type-set] source=manual value=HV');
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-row-create] hv=${hv ?? 'n/a'} hardnessType=HV hvType=HV`
      );

      try {
        const saved = await saveManualMeasurement({ values: rowPayload });
        // eslint-disable-next-line no-console
        console.log(
          `[calibration-auto-row-saved] id=${saved.id} d1Um=${saved.d1Um} d2Um=${saved.d2Um} averageUm=${saved.averageUm} hv=${saved.hv ?? 'n/a'} objective=${saved.objective}`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[measurement-row-create] id=${saved.id} d1Um=${saved.d1Um} d2Um=${saved.d2Um} davgUm=${saved.averageUm} hv=${saved.hv ?? 'n/a'} objective=${saved.objective}`
        );
        await refetchMeasurements();
        // Clear yellow Auto/Manual Measure overlays now that the calibration
        // row has been committed. Guarded behind the successful saveManual...
        // path above so a save failure leaves the overlay in place for retry.
        setCommittedAutoMeasureOverlay(null);
        setPreviewAutoMeasureOverlay(null);
        setManualMeasureResetKey((current) => current + 1);
        // eslint-disable-next-line no-console
        console.log('[overlay-clear] reason=calibration-complete');
        setStatusMessage(
          `System Status: Calibration saved. Measurement row added: HV ${hv ?? 'n/a (force missing)'}`
        );
      } catch (saveErr) {
        const ax = saveErr as { response?: { status?: number; data?: unknown } };
        // eslint-disable-next-line no-console
        console.warn(
          `[calibration-auto-row-blocked] reason=row-save-failed http=${ax.response?.status ?? '?'} body=${JSON.stringify(ax.response?.data ?? null)} detail="${saveErr instanceof Error ? saveErr.message : String(saveErr)}"`
        );
        setUnavailableMsg(
          `Failed to save measurement row: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`
        );
      }
    },
    [
      calibrationSettingsList,
      refetchMeasurements,
      saveManualMeasurement,
    ]
  );

  // Index loaded calibrations by normalized objective so any debugging /
  // future O(1) lookup paths see the same canonical map the lookup helpers
  // use. Logged once per change so stale state is visible in devtools.
  useEffect(() => {
    const map: Record<string, number> = {};
    for (const item of calibrationSettingsList) {
      map[String(item.objective).trim().toUpperCase()] = item.pixelToMicron;
    }
    // eslint-disable-next-line no-console
    console.log('[calibration] loaded map', map);
  }, [calibrationSettingsList]);

  const resetManualMeasure = useCallback(() => {
    manualMeasurementIdRef.current = null;
    setManualMeasureResetKey((current) => current + 1);
  }, []);


  const handleManualMeasurementUpdated = useCallback(
    (result: ManualMeasureDragResult) => {
      // Spec-format drag trace: fires every time the manual overlay emits a
      // new diagonal — i.e. on every handle drag commit. Coordinates are in
      // image-space (the manual overlay already maps client→image).
      // eslint-disable-next-line no-console
      console.log(
        `[manual-handle-drag] points=${result.points.length} imageX=${result.points[0].x.toFixed(2)} imageY=${result.points[0].y.toFixed(2)} d1Px=${result.d1Px.toFixed(3)} d2Px=${result.d2Px.toFixed(3)}`
      );
      void (async () => {
        try {
          // eslint-disable-next-line no-console
          console.log(
            `[measurement-create-start] method=Manual d1Px=${result.d1Px} d2Px=${result.d2Px}`
          );
          const machineState = await getMachineStateSnapshot();
          const timestamp = new Date().toISOString();
          const isNewManualMeasurement = manualMeasurementIdRef.current === null;
          const depthPayload = isNewManualMeasurement
            ? { depthMm: await readLatestMicrometerDepthMm() }
            : {};
          // eslint-disable-next-line no-console
          console.log(
            `[measurement-save] depth from micrometer=${depthPayload.depthMm ?? '-'} new=${isNewManualMeasurement}`
          );
          if (isNewManualMeasurement) {
            // eslint-disable-next-line no-console
            console.log(
              `[measurement-row-depth-snapshot] rowId=pending depth=${depthPayload.depthMm ?? 'null'} source=currentMicrometer`
            );
            // eslint-disable-next-line no-console
            console.log(
              `[measurement-row-depth-assign] depthMm=${depthPayload.depthMm ?? 'null'}`
            );
          }
          const pixelValues = calculateManualDiagonalsFromPixels(
            result.d1Px,
            result.d2Px,
            1
          );

          if (!pixelValues) {
            // eslint-disable-next-line no-console
            console.warn(
              `[measurement-commit-blocked] method=Manual reason=invalid-pixel-values d1Px=${result.d1Px} d2Px=${result.d2Px}`
            );
            setUnavailableMsg('Manual Measure requires valid D1/D2 values greater than 0.');
            return;
          }

          // Stash the most recent manual pixel diagonals so the Calibration
          // dialog can auto-fill Pixel Length X / Y without the user having
          // to retype what they just measured on the live image.
          if (Number.isFinite(result.d1Px) && Number.isFinite(result.d2Px) && result.d1Px > 0 && result.d2Px > 0) {
            setLatestManualPixels({ d1Px: result.d1Px, d2Px: result.d2Px });
            // eslint-disable-next-line no-console
            console.log(
              `[calibration-drag-update] pixelX=${result.d1Px} pixelY=${result.d2Px}`
            );
          }

          // Calibration mode: the manual diamond is being used to PICK pixel
          // diagonals for calibration only. Do NOT save a measurement row —
          // calibration auto/manual must not pollute the measurement table.
          // The pixel values are already captured into latestManualPixels.
          if (calibrationManualModeRef.current) {
            // eslint-disable-next-line no-console
            console.warn(
              '[measurement-commit-blocked] method=Manual reason=calibration-manual-mode flag=true — drag is for calibration, no row created. (Closes when Add Calibration succeeds or dialog closes.)'
            );
            return;
          }
          // eslint-disable-next-line no-console
          console.log('[measurement-commit-start] method=Manual');

          // SINGLE SOURCE OF TRUTH (priority order, mirrors Auto Measure):
          //   1) confirmedObjectiveFromMachine (real L<n>OK echo from hardware)
          //   2) activeObjective (optimistic lens click — UI-only)
          //   3) machineState.objective (last persisted echo)
          // After app restart, activeObjective is null until the user clicks a
          // lens; without the machine-confirmed value the manual measure was
          // silently falling back to a stale machineState.objective and
          // applying the wrong calibration row from SQLite.
          const confirmedFromMachine =
            machineState?.confirmedObjectiveFromMachine?.trim() || null;
          const optimisticActive = (activeObjective && activeObjective.trim()) || null;
          const lastEchoed = machineState?.objective?.trim() || null;
          const targetObjective = confirmedFromMachine || optimisticActive || lastEchoed;
          // eslint-disable-next-line no-console
          console.log(
            `[frontend-objective-sync] method=Manual confirmedObjectiveFromMachine=${confirmedFromMachine ?? 'null'} activeObjective=${optimisticActive ?? 'null'} machineObjective=${lastEchoed ?? 'null'}`
          );
          if (!targetObjective) {
            // eslint-disable-next-line no-console
            console.warn(
              `[measurement-commit-blocked] method=Manual reason=no-active-objective confirmedFromMachine=${confirmedFromMachine ?? 'null'} activeObjective=${optimisticActive ?? 'null'} machineObjective=${lastEchoed ?? 'null'}`
            );
            setUnavailableMsg(
              'No active objective. Please click 10X or 40X in Machine Control before measuring.'
            );
            return;
          }
          // eslint-disable-next-line no-console
          console.log(
            `[measurement-create-input] method=Manual d1Px=${result.d1Px} d2Px=${result.d2Px} objective=${targetObjective} force=${machineState?.force ?? 'null'} forceKgf=${parseForceKgf(machineState?.force) ?? 'null'}`
          );
          const machineStateForManual = machineState
            ? { ...machineState, objective: targetObjective }
            : null;
          const forceKgf = parseForceKgf(machineState?.force);
          // eslint-disable-next-line no-console
          console.log('[manual-measure] objective=', targetObjective);
          // eslint-disable-next-line no-console
          console.log('[calibration] using objective=', targetObjective);
          const conversion = calculateVickersFromPixels({
            calibrationSettings,
            calibrations,
            machineState: machineStateForManual,
            d1Px: result.d1Px,
            d2Px: result.d2Px,
            forceKgf,
            objective: targetObjective,
            targetObjective,
            calibrationSettingsList,
          });

          // eslint-disable-next-line no-console
          console.log('[manual-measure][calibration] activeCalibrationLoaded', {
            objective: targetObjective,
            normalizedObjective: normalizeObjectiveName(targetObjective),
            found: conversion.ok,
            umPerPixel: conversion.ok ? conversion.value.umPerPixel : null,
            reason: conversion.ok ? null : conversion.reason,
          });

          if (!conversion.ok) {
            // eslint-disable-next-line no-console
            console.warn(
              `[measurement-commit-blocked] method=Manual reason=conversion-failed detail="${conversion.reason}" objective=${targetObjective}`
            );
            setUnavailableMsg(conversion.reason);
            setStatusMessage(`System Status: Manual Measure blocked: ${conversion.reason}`);
            return;
          }

          const values = conversion.value;

          // eslint-disable-next-line no-console
          console.log('[manual-measure][converted]', {
            objective: values.objective,
            normalizedObjective: values.normalizedObjective,
            umPerPixel: values.umPerPixel,
            d1Px: values.d1Px,
            d2Px: values.d2Px,
            d1Um: values.d1Um,
            d2Um: values.d2Um,
            averageUm: values.avgDUm,
            averageMm: values.avgDMm,
            forceKgf: values.forceKgf,
            hv: values.hv,
          });

          // eslint-disable-next-line no-console
          console.log('[measurement-table] insert objective=', values.normalizedObjective, 'method=Manual');
          // eslint-disable-next-line no-console
          console.log(
            `[measurement-row-create] method=Manual d1Px=${values.d1Px} d2Px=${values.d2Px} d1Um=${values.d1Um} d2Um=${values.d2Um} davgUm=${values.avgDUm} hv=${values.hv} objective=${values.normalizedObjective} umPerPixel=${values.umPerPixel}`
          );
          // eslint-disable-next-line no-console
          console.log('[album] snapshot capture start measurementId=', manualMeasurementIdRef.current ?? 'new');
          await waitForOverlayPaint();
          // eslint-disable-next-line no-console
          console.log('[album] manual measure overlay ready, capturing thumbnail');
          const imageDataUrl = cameraRef.current?.captureThumbnailDataUrl() ?? undefined;
          if (imageDataUrl) {
            // eslint-disable-next-line no-console
            console.log('[album] thumbnail captured with overlay=true points=4');
          } else {
            // eslint-disable-next-line no-console
            console.warn('[album] missing image for measurementId=', manualMeasurementIdRef.current ?? 'new');
          }
          const rowPayload = {
            d1: values.d1Um,
            d2: values.d2Um,
            d1Px: values.d1Px,
            d2Px: values.d2Px,
            d1Um: values.d1Um,
            d2Um: values.d2Um,
            averageUm: values.avgDUm,
            averageMm: values.avgDMm,
            hv: values.hv,
            hardnessType: 'HV' as const,
            qualified: deriveQualifiedForRow(values.hv),
            micronPerPixel: values.umPerPixel,
            calibrationName: values.calibrationName,
            objective: values.normalizedObjective,
            testForceKgf: values.forceKgf,
            ...depthPayload,
            method: 'Manual' as const,
            unit: 'um' as const,
            timestamp,
            imageDataUrl,
          };
          // eslint-disable-next-line no-console
          console.log('[measurement-row-object] method=Manual', rowPayload);
          // eslint-disable-next-line no-console
          console.log('[hv-type-set] source=manual value=HV');
          // eslint-disable-next-line no-console
          console.log(
            `[measurement-row-create] hv=${values.hv ?? 'n/a'} hardnessType=HV hvType=HV`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[measurement-save-payload] depthMm=${'depthMm' in rowPayload ? (rowPayload as { depthMm?: number | null }).depthMm ?? 'null' : 'preserved'}`
          );
          const saved = await saveManualMeasurement({
            id: manualMeasurementIdRef.current ?? undefined,
            values: rowPayload,
          });
          // eslint-disable-next-line no-console
          console.log(
            `[measurement-save-result] rowId=${saved.id} depthMm=${saved.depthMm ?? 'null'}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[measurement-row-save-success] method=Manual id=${saved.id} d1Um=${saved.d1Um} d2Um=${saved.d2Um} averageUm=${saved.averageUm} hv=${saved.hv} objective=${saved.objective}`
          );
          // eslint-disable-next-line no-console
          console.log('[album] measurement updated thumbnail=', !!imageDataUrl, 'id=', saved.id);

          manualMeasurementIdRef.current = saved.id;
          await refetchMeasurements();
          // eslint-disable-next-line no-console
          console.log('[manual-measure] table row updated', {
            id: saved.id,
            method: saved.method,
          });
          setStatusMessage(
            `System Status: Manual measurement updated: HV ${values.hv ?? 'n/a (force missing)'}`
          );
        } catch (err) {
          // Surface the real backend error (axios response body / zod issues)
          // to the console — without this the user sees only the popup and we
          // have no way to diagnose validation rejections.
          // eslint-disable-next-line no-console
          console.error('[measurement-row-save-error] method=Manual', err);
          // Cast to a loose shape to avoid a hard import of axios types here.
          const ax = err as { response?: { status?: number; data?: unknown } };
          if (ax.response) {
            // eslint-disable-next-line no-console
            console.error(
              `[measurement-row-save-error] http=${ax.response.status} body=${JSON.stringify(ax.response.data)}`
            );
          }
          setUnavailableMsg(
            `Manual Measure failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      })();
    },
    [
      calibrationSettings,
      calibrationSettingsList,
      calibrations,
      getMachineStateSnapshot,
      activeObjective,
      refetchMeasurements,
      saveManualMeasurement,
    ]
  );

  useEffect(() => {
    const normalized = normalizeAutoMeasureSettings(autoMeasureSettings);
    latestAutoMeasurePreviewSettingsRef.current = normalized;
    setAutoMeasurePreviewSettings(normalized);
  }, [autoMeasureSettings]);

  useEffect(() => {
    displayedAutoMeasureGraphicsRef.current = displayedAutoMeasureGraphics;
  }, [displayedAutoMeasureGraphics]);

  const handleAutoMeasureSettingsPreviewChange = useCallback((settings: AutoMeasureSettingsPayload) => {
    const normalized = normalizeAutoMeasureSettings(settings);
    latestAutoMeasurePreviewSettingsRef.current = normalized;
    setAutoMeasurePreviewSettings(normalized);
  }, []);

  const commitAutoMeasureSnapshot = useCallback(
    async (snapshot: AutoMeasureDetectionSnapshot, source: 'auto-click' | 'settings-save') => {
      const {
        result,
        graphics,
        method,
        validationReason,
        objectiveForCalibration,
        machineStateForAuto,
        forceKgf,
      } = snapshot;

      // Final frontend sanity gate. This intentionally stays loose: native
      // already selected the contour, and this layer only blocks broken or
      // non-finite geometry. Rotation, bloom, scratches, mild asymmetry, and
      // imperfect refined corners are accepted.
      const c = graphics.corners;
      const validation = validateAutoMeasureGeometry(c, {
        objective: objectiveForCalibration,
        smoothing: snapshot.settings.smoothing,
        threshold: snapshot.settings.threshold,
        method,
        reason: validationReason,
      });
      const { d1Px, d2Px, ratio, center } = validation;
      if (!validation.ok) {
        logAutoMeasurePhase('auto-measure-reject', {
          objective: objectiveForCalibration,
          smoothing: snapshot.settings.smoothing,
          threshold: snapshot.settings.threshold,
          method,
          d1Px,
          d2Px,
          center,
          reason: validation.reason,
        });
        setUnavailableMsg('Auto Measure rejected: no usable diamond geometry. Please use manual measure.');
        setStatusMessage(`System Status: Auto Measure rejected: ${validation.reason}`);
        return false;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure][success-refined-diamond-only] d1Px=${d1Px.toFixed(2)} d2Px=${d2Px.toFixed(2)} midX=${center.x.toFixed(2)} midY=${center.y.toFixed(2)} method=${method}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-corners] left=(${c.left.x.toFixed(2)},${c.left.y.toFixed(2)}) right=(${c.right.x.toFixed(2)},${c.right.y.toFixed(2)}) top=(${c.top.x.toFixed(2)},${c.top.y.toFixed(2)}) bottom=(${c.bottom.x.toFixed(2)},${c.bottom.y.toFixed(2)})`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-success] objective=${objectiveForCalibration ?? 'unknown'} method=${method} left=(${c.left.x.toFixed(2)},${c.left.y.toFixed(2)}) right=(${c.right.x.toFixed(2)},${c.right.y.toFixed(2)}) top=(${c.top.x.toFixed(2)},${c.top.y.toFixed(2)}) bottom=(${c.bottom.x.toFixed(2)},${c.bottom.y.toFixed(2)}) d1Px=${d1Px.toFixed(2)} d2Px=${d2Px.toFixed(2)} smoothing=${snapshot.settings.smoothing} threshold=${snapshot.settings.threshold} ratio=${ratio.toFixed(3)} center=(${center.x.toFixed(2)},${center.y.toFixed(2)}) reason=${validation.reason}`
      );

      // Duplicate-measurement guard. Identical detection on the same unchanged
      // frame (repeat click) must NOT spawn a new table row. Tolerance is
      // sub-pixel because the native detector is deterministic for an
      // unchanged frame; a real new indentation moves D1/D2/center well past
      // these bounds. Settings-save is exempt — the user is intentionally
      // re-detecting under new params and expects the existing row to update.
      const centerX = center.x;
      const centerY = center.y;
      const frameEpoch = getLastPaintEpoch();
      const fingerprint = {
        d1Px: result.d1Pixels,
        d2Px: result.d2Pixels,
        centerX,
        centerY,
        frameEpoch,
        hv:
          typeof result.hv === 'number' && Number.isFinite(result.hv)
            ? result.hv
            : null,
      };
      // eslint-disable-next-line no-console
      console.log(`[auto-measure-start] frameId=${frameEpoch}`);
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-fingerprint]\ncenterX=${centerX.toFixed(2)}\ncenterY=${centerY.toFixed(2)}\nd1Px=${fingerprint.d1Px.toFixed(2)}\nd2Px=${fingerprint.d2Px.toFixed(2)}\nframeId=${frameEpoch}`
      );

      const fingerprintObjective = normalizeAutoMeasureFingerprintObjective(objectiveForCalibration);
      const fingerprintKey = buildAutoMeasureFingerprintKey({
        objective: fingerprintObjective,
        centerX: fingerprint.centerX,
        centerY: fingerprint.centerY,
        d1Px: fingerprint.d1Px,
        d2Px: fingerprint.d2Px,
      });
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-fingerprint] objective=${fingerprintObjective} centerX=${Math.round(fingerprint.centerX)} centerY=${Math.round(fingerprint.centerY)} d1=${Math.round(fingerprint.d1Px)} d2=${Math.round(fingerprint.d2Px)} key=${fingerprintKey}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-fingerprint-current] objective=${fingerprintObjective} centerX=${fingerprint.centerX.toFixed(2)} centerY=${fingerprint.centerY.toFixed(2)} d1Px=${fingerprint.d1Px.toFixed(2)} d2Px=${fingerprint.d2Px.toFixed(2)} key=${fingerprintKey}`
      );
      if (source === 'auto-click') {
        const existing = committedFingerprintsRef.current;
        let matchedEntry: typeof existing[number] | null = null;
        for (const entry of existing) {
          const sameObjective = entry.objective === fingerprintObjective;
          const d1Delta = Math.abs(entry.d1Px - fingerprint.d1Px);
          const d2Delta = Math.abs(entry.d2Px - fingerprint.d2Px);
          const cxDelta = Math.abs(entry.centerX - fingerprint.centerX);
          const cyDelta = Math.abs(entry.centerY - fingerprint.centerY);
          const matches =
            sameObjective &&
            d1Delta <= AUTO_MEASURE_DIAGONAL_TOLERANCE_PX &&
            d2Delta <= AUTO_MEASURE_DIAGONAL_TOLERANCE_PX &&
            cxDelta <= AUTO_MEASURE_CENTER_TOLERANCE_PX &&
            cyDelta <= AUTO_MEASURE_CENTER_TOLERANCE_PX;
          // eslint-disable-next-line no-console
          console.log(
            `[measurement-fingerprint-compare-row] rowId=${entry.rowId ?? 'unknown'} sameObjective=${sameObjective} d1Delta=${d1Delta.toFixed(2)} d2Delta=${d2Delta.toFixed(2)} cxDelta=${cxDelta.toFixed(2)} cyDelta=${cyDelta.toFixed(2)} matches=${matches}`
          );
          if (matches && !matchedEntry) {
            matchedEntry = entry;
          }
        }
        if (matchedEntry) {
          // eslint-disable-next-line no-console
          console.log(
            `[measurement-duplicate-skip-existing-row] rowId=${matchedEntry.rowId ?? 'unknown'} key=${matchedEntry.fingerprintKey} hv=${matchedEntry.hv ?? 'n/a'} d1Px=${matchedEntry.d1Px.toFixed(2)} d2Px=${matchedEntry.d2Px.toFixed(2)}`
          );
          // eslint-disable-next-line no-console
          console.log('[measurement-duplicate-skip]');
          const restoredGraphics = {
            ...cloneAutoMeasureGraphics(matchedEntry.graphics),
            frameId: graphics.frameId,
            sessionId: graphics.sessionId,
            objective: graphics.objective ?? matchedEntry.objective,
          };
          setCommittedAutoMeasureOverlay(restoredGraphics);
          autoMeasurementIdRef.current = matchedEntry.rowId;
          previewMeasurementRef.current = {
            d1Pixels: matchedEntry.d1Px,
            d2Pixels: matchedEntry.d2Px,
            confidence: result.confidence,
          };
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-duplicate] keepOverlay=true matchedRowId=${matchedEntry.rowId ?? 'unknown'}`
          );
          // eslint-disable-next-line no-console
          console.log('[overlay-set-from-auto-result] reason=duplicate-restore');
          setAutoMeasureStatus('duplicate');
          setStatusMessage(
            'System Status: Auto Measure: same indentation — no duplicate row added.'
          );
          return false;
        }
      }

      // Why: always commit a NEW reference for the explicit Auto Measure
      // click. The graphicsAlmostEqual short-circuit was suppressing overlay
      // updates after an objective change when the new corners happened to
      // be near-identical to the prior run, leaving the user with the table
      // updated but no fresh yellow lines drawn. The skip is still useful
      // for slider-driven preview spam, so keep it on settings-save only.
      const forceOverlayRefresh = source === 'auto-click';
      setCommittedAutoMeasureOverlay((prev) => {
        if (!forceOverlayRefresh && prev && graphicsAlmostEqual(prev, graphics)) {
          // eslint-disable-next-line no-console
          console.log('[auto-overlay-skip] reason=same-lines-no-state-update');
          return prev;
        }
        // eslint-disable-next-line no-console
        console.log(
          `[auto-overlay-set] source=${source} lines=${graphics.lines.length} corners=4 force=${forceOverlayRefresh}`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[overlay-set-from-auto-result] source=${source} corners=4 d1Px=${result.d1Pixels.toFixed(2)} d2Px=${result.d2Pixels.toFixed(2)}`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[overlay-draw] source=auto-measure d1=${result.d1Pixels.toFixed(2)}px d2=${result.d2Pixels.toFixed(2)}px objective=${objectiveForCalibration ?? 'unknown'}`
        );
        if (source === 'auto-click') {
          // eslint-disable-next-line no-console
          console.log(
            `[overlay-show] reason=auto-measure-success objective=${objectiveForCalibration ?? 'unknown'}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[overlay-set] source=auto objective=${objectiveForCalibration ?? 'unknown'} sessionId=${graphics.sessionId ?? 'n/a'} lines=${graphics.lines.length} frameId=${graphics.frameId ?? 'n/a'}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure][overlay-freeze] objective=${objectiveForCalibration ?? 'unknown'} sessionId=${graphics.sessionId ?? 'n/a'} frameId=${graphics.frameId ?? 'n/a'} corners=4 color=yellow`
          );
        }
        return { ...graphics, corners: { ...graphics.corners } };
      });
      setPreviewAutoMeasureOverlay(null);
      autoMeasurePreviewSnapshotRef.current = null;
      previewMeasurementRef.current = null;

      const timestamp = new Date().toISOString();
      const saveRowId = source === 'auto-click' ? undefined : autoMeasurementIdRef.current ?? undefined;
      // Depth is captured ONLY when creating a new auto-measure row. On
      // re-detection of an existing row we must keep the originally saved
      // micrometer reading — overwriting would violate "old saved row must
      // not change" and copy the current depth across all re-detected rows.
      const isNewAutoMeasurement = saveRowId === undefined;
      const depthMm = isNewAutoMeasurement ? await readLatestMicrometerDepthMm() : null;
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-save] depth from micrometer=${depthMm ?? '-'} new=${isNewAutoMeasurement}`
      );
      if (isNewAutoMeasurement) {
        // eslint-disable-next-line no-console
        console.log(
          `[measurement-row-depth-snapshot] rowId=pending depth=${depthMm ?? 'null'} source=currentMicrometer`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[measurement-row-depth-assign] depthMm=${depthMm ?? 'null'}`
        );
      }

      const conversion = calculateVickersFromPixels({
        calibrationSettings,
        calibrationSettingsList,
        calibrations,
        d1Px: result.d1Pixels,
        d2Px: result.d2Pixels,
        forceKgf,
        machineState: machineStateForAuto,
        objective: objectiveForCalibration,
        targetObjective: objectiveForCalibration,
      });

      if (!conversion.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[measurement-commit-blocked] method=Auto reason=conversion-failed detail="${conversion.reason}" objective=${objectiveForCalibration}`
        );
        const message = /calibration/i.test(conversion.reason)
          ? `Calibration missing for ${objectiveForCalibration ?? 'current objective'}`
          : conversion.reason;
        setUnavailableMsg(message);
        setStatusMessage(`System Status: Auto Measure blocked: ${message}`);
        return false;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-commit-start] method=Auto objective=${objectiveForCalibration} d1Px=${result.d1Pixels} d2Px=${result.d2Pixels}`
      );

      const values = conversion.value;

      if (values.hv === null || forceKgf === null || forceKgf === undefined || forceKgf <= 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[measurement-commit-blocked] method=Auto reason=force-missing objective=${objectiveForCalibration} forceKgf=${forceKgf ?? 'null'}`
        );
        setUnavailableMsg('Force value missing');
        setStatusMessage('System Status: Auto Measure blocked: Force value missing');
        return false;
      }

      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-hv-calc] objective=${values.normalizedObjective} forceKgf=${forceKgf} d1Um=${values.d1Um.toFixed(3)} d2Um=${values.d2Um.toFixed(3)} davgUm=${values.avgDUm.toFixed(3)} hv=${values.hv ?? 'n/a'}`
      );

      // eslint-disable-next-line no-console
      console.log('[auto-measure] commit', {
        objective: values.normalizedObjective,
        d1Um: values.d1Um,
        d2Um: values.d2Um,
        hv: values.hv,
      });
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure][detected] d1Px=${values.d1Px.toFixed(3)} d2Px=${values.d2Px.toFixed(3)}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure][compute] d1Um=${values.d1Um.toFixed(3)} d2Um=${values.d2Um.toFixed(3)} davgUm=${values.avgDUm.toFixed(3)} hv=${values.hv ?? 'n/a'}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-row-create] method=Auto d1Px=${values.d1Px} d2Px=${values.d2Px} d1Um=${values.d1Um} d2Um=${values.d2Um} davgUm=${values.avgDUm} hv=${values.hv} objective=${values.normalizedObjective} umPerPixel=${values.umPerPixel}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-hv] hv=${values.hv ?? 'n/a'} hardnessType=${machineStateForAuto?.hardnessLevel ?? 'n/a'}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-row-create] frameId=${graphics.frameId ?? frameEpoch} hv=${values.hv ?? 'n/a'} hardnessType=${machineStateForAuto?.hardnessLevel ?? 'n/a'}`
      );

      // eslint-disable-next-line no-console
      console.log('[album] snapshot capture start measurementId=', saveRowId ?? 'new');
      await waitForOverlayPaint();
      // eslint-disable-next-line no-console
      console.log('[album] auto measure overlay ready, capturing thumbnail');
      const imageDataUrl = cameraRef.current?.captureThumbnailDataUrl() ?? undefined;
      if (imageDataUrl) {
        // eslint-disable-next-line no-console
        console.log('[album] thumbnail captured with overlay=true points=4');
      } else {
        // eslint-disable-next-line no-console
        console.warn('[album] missing image for measurementId=', autoMeasurementIdRef.current ?? 'new');
      }
      const autoRowPayload = {
        d1: values.d1Um,
        d2: values.d2Um,
        d1Px: values.d1Px,
        d2Px: values.d2Px,
        d1Um: values.d1Um,
        d2Um: values.d2Um,
        averageUm: values.avgDUm,
        averageMm: values.avgDMm,
        hv: values.hv,
        hardnessType: 'HV' as const,
        qualified: deriveQualifiedForRow(values.hv),
        micronPerPixel: values.umPerPixel,
        calibrationName: values.calibrationName,
        objective: values.normalizedObjective,
        testForceKgf: values.forceKgf,
        ...(isNewAutoMeasurement ? { depthMm } : {}),
        method: 'Auto' as const,
        unit: 'um' as const,
        timestamp,
        imageDataUrl,
      };
      // eslint-disable-next-line no-console
      console.log('[measurement-row-object] method=Auto', autoRowPayload);
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-row-build] hardness=${values.hv ?? 'n/a'} hardnessType=${autoRowPayload.hardnessType} hvType=${autoRowPayload.hardnessType}`
      );
      // eslint-disable-next-line no-console
      console.log('[hv-type-set] source=auto value=HV');
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-row-create] hv=${values.hv ?? 'n/a'} hardnessType=HV hvType=HV`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-row-insert] method=Auto hardnessType=HV hardness=${values.hv ?? 'n/a'}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-save-payload] depthMm=${'depthMm' in autoRowPayload ? (autoRowPayload as { depthMm?: number | null }).depthMm ?? 'null' : 'preserved'}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-row-add] reason=${isNewAutoMeasurement ? 'new-indentation' : 'settings-save-update'} hv=${values.hv ?? 'n/a'} d1Px=${values.d1Px.toFixed(2)} d2Px=${values.d2Px.toFixed(2)} existingRowId=${saveRowId ?? 'none'}`
      );
      if (isNewAutoMeasurement) {
        // eslint-disable-next-line no-console
        console.log(
          `[measurement-new-row] reason=new-indentation hv=${values.hv ?? 'n/a'} fingerprintKey=${fingerprintKey}`
        );
      }
      let saved;
      try {
        saved = await saveManualMeasurement({
          id: saveRowId,
          values: autoRowPayload,
        });
        // eslint-disable-next-line no-console
        console.log(
          `[measurement-save-result] rowId=${saved.id} depthMm=${saved.depthMm ?? 'null'}`
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[measurement-row-save-error] method=Auto', err);
        const ax = err as { response?: { status?: number; data?: unknown } };
        if (ax.response) {
          // eslint-disable-next-line no-console
          console.error(
            `[measurement-row-save-error] http=${ax.response.status} body=${JSON.stringify(ax.response.data)}`
          );
        }
        throw err;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-row-save-success] method=Auto id=${saved.id} d1Um=${saved.d1Um} d2Um=${saved.d2Um} averageUm=${saved.averageUm} hv=${saved.hv} objective=${saved.objective}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure][table-save] id=${saved.id} d1Um=${saved.d1Um} d2Um=${saved.d2Um} davgUm=${saved.averageUm} hv=${saved.hv} hardnessType=${autoRowPayload.hardnessType} objective=${saved.objective} method=Auto depthMm=${depthMm ?? 'preserved'} timestamp=${timestamp}`
      );
      // eslint-disable-next-line no-console
      console.log('[album] measurement updated thumbnail=', !!imageDataUrl, 'id=', saved.id);

      autoMeasurementIdRef.current = saved.id;
      committedFingerprintsRef.current = upsertCommittedAutoMeasureFingerprint(
        committedFingerprintsRef.current,
        {
          objective: fingerprintObjective,
          d1Px: fingerprint.d1Px,
          d2Px: fingerprint.d2Px,
          centerX: fingerprint.centerX,
          centerY: fingerprint.centerY,
          hv:
            typeof saved.hv === 'number' && Number.isFinite(saved.hv)
              ? saved.hv
              : fingerprint.hv,
          rowId: saved.id,
          fingerprintKey,
          graphics: cloneAutoMeasureGraphics(graphics),
        }
      );
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-fingerprint-store] rowId=${saved.id} key=${fingerprintKey} total=${committedFingerprintsRef.current.length}`
      );
      if (source === 'auto-click') {
        setAutoMeasureStatus('success');
      }
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-row-create]\nframeId=${frameEpoch}\nd1Um=${saved.d1Um}\nd2Um=${saved.d2Um}\nhv=${saved.hv ?? 'n/a'}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure][table-auto-update] rowId=${saved.id} source=detected`
      );
      await refetchMeasurements();
      // eslint-disable-next-line no-console
      console.log('[measurement-table][refresh] rows=auto');

      if (source === 'settings-save') {
        // eslint-disable-next-line no-console
        console.log(
          `[auto-settings-save] committed=true D1_px=${values.d1Px.toFixed(3)} D2_px=${values.d2Px.toFixed(3)} HV=${values.hv === null ? 'n/a' : values.hv.toFixed(3)}`
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure:commit] overlayFrozen=true measurementAdded=true D1_px=${values.d1Px.toFixed(3)} D2_px=${values.d2Px.toFixed(3)} D1_um=${values.d1Um.toFixed(3)} D2_um=${values.d2Um.toFixed(3)} HV=${values.hv === null ? 'n/a' : values.hv.toFixed(3)}`
        );
      }

      setStatusMessage(
        saved.hv
          ? `System Status: Auto measurement added: HV ${saved.hv}`
          : `System Status: Auto measurement added: ${values.d1Um} µm / ${values.d2Um} µm`
      );
      return true;
    },
    [
      calibrationSettings,
      calibrationSettingsList,
      calibrations,
      refetchMeasurements,
      saveManualMeasurement,
    ]
  );

  const runAutoMeasure = useCallback((settingsInput: AutoMeasureSettingsPayload, preview = false, source?: AutoMeasureCallSource) => {
    const callSource = source ?? (preview ? 'settings-preview' : 'auto-click');
    logUnexpectedAutoMeasureCall(callSource);
    const requestedAt = performance.now();

    if (impressInProgressRef.current) {
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-blocked] reason=impress-in-progress source=${callSource} preview=${preview}`
      );
      return;
    }

    if (autoMeasureInFlightRef.current) {
      // Coalesce: remember the latest preview settings so the trailing run
      // after the in-flight detection picks up the user's final slider value.
      // Non-preview (explicit Auto Measure click) is still ignored while busy.
      if (preview) {
        autoMeasurePendingPreviewRef.current = settingsInput;
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-preview-coalesced] smoothing=${settingsInput.smoothing} threshold=${settingsInput.threshold}`
        );
      }
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-table][skip-duplicate] reason=same-auto-measure-session preview=${preview}`
      );
      return;
    }

    void (async () => {
      const settings = normalizeAutoMeasureSettings(settingsInput);
      if (!preview) {
        // Drop the previously-committed yellow lines before running a new
        // detection — old D1/D2 must never linger over a fresh detection
        // attempt. The new overlay will be set only if detection succeeds.
        // Keep committed row fingerprints alive so repeat clicks compare
        // against every current row, even while the overlay is being refreshed.
        setCommittedAutoMeasureOverlay((prev) => {
          if (!prev) {
            // eslint-disable-next-line no-console
            console.log('[overlay-skip] reason=no-active-measurement-overlay trigger=auto-measure-start');
          }
          return null;
        });
        setPreviewAutoMeasureOverlay(null);
        autoMeasurePreviewSnapshotRef.current = null;
        autoMeasurementIdRef.current = null;
        // eslint-disable-next-line no-console
        console.log('[overlay-clear] reason=auto-measure-start');
        // eslint-disable-next-line no-console
        console.log('[overlay-clear-before-auto]');
      }

      autoMeasureInFlightRef.current = true;
      setAutoMeasuring(true);
      // Begin a fresh Auto Measure session. The session id stamps every
      // overlay produced by this run so a result that returns after a later
      // invalidator can be filtered out (overlay.sessionId !== current).
      const sessionIdForRun = autoMeasureSessionIdRef.current + 1;
      autoMeasureSessionIdRef.current = sessionIdForRun;
      setAutoMeasureSessionId(sessionIdForRun);
      // eslint-disable-next-line no-console
      console.log(`[auto-measure-run-start] runId=${sessionIdForRun} source=${callSource}`);
      // Both auto-click and settings-preview activate the session — preview
      // overlays during slider drags also need the gate to allow paint.
      // The session ends on the next clearAutoMeasureOverlay invalidator
      // (objective change, turret change, camera close).
      setAutoMeasureSessionActive(true);
      if (callSource === 'auto-click') {
        setAutoMeasureStatus('detecting');
        setCameraStatus('frozen');
      }
      if (callSource === 'settings-preview') {
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-preview-refresh] objective=${activeObjective ?? 'unknown'} smoothing=${settingsInput.smoothing} threshold=${settingsInput.threshold}`
        );
      }
      if (!preview) {
        setStatusMessage('System Status: Auto Measure running');
      }

      try {
        const machineState = await getMachineStateSnapshot();
        // SINGLE SOURCE OF TRUTH (priority order):
        //   1) confirmedObjectiveFromMachine (real L<n>OK echo from hardware)
        //   2) activeObjective (optimistic lens click — UI-only)
        //   3) machineState.objective (last persisted echo)
        // The machine RX value wins — Auto Measure must never run on a stale
        // optimistic value when the turret has actually confirmed a different
        // magnification.
        const confirmedFromMachine = machineState?.confirmedObjectiveFromMachine?.trim() || null;
        const optimisticActive = (activeObjective && activeObjective.trim()) || null;
        const lastEchoed = machineState?.objective?.trim() || null;
        const objectiveForCalibration = confirmedFromMachine || optimisticActive || lastEchoed;
        // eslint-disable-next-line no-console
        console.log(
          `[frontend-objective-sync] confirmedObjectiveFromMachine=${confirmedFromMachine ?? 'null'} activeObjective=${optimisticActive ?? 'null'} machineObjective=${lastEchoed ?? 'null'}`
        );
        if (!objectiveForCalibration) {
          // eslint-disable-next-line no-console
          console.error(
            '[frontend-objective-sync] no objective available — blocking Auto Measure'
          );
          // eslint-disable-next-line no-console
          console.warn(
            `[measurement-commit-blocked] method=Auto reason=no-active-objective confirmedFromMachine=${confirmedFromMachine ?? 'null'} activeObjective=${optimisticActive ?? 'null'}`
          );
          if (preview) {
            setStatusMessage('System Status: Auto Measure preview blocked: no active objective');
            return;
          }
          setUnavailableMsg(
            'No active objective. Please click 10X or 40X in Machine Control before Auto Measure.'
          );
          setStatusMessage('System Status: Auto Measure blocked: no active objective');
          return;
        }
        if (machineState?.objective?.trim() && machineState.objective !== activeObjective) {
          setActiveObjective(machineState.objective);
          // eslint-disable-next-line no-console
          console.log('[objective] changed →', machineState.objective);
        }
        const machineStateForAuto = machineState
          ? { ...machineState, objective: objectiveForCalibration }
          : null;
        const calibration = resolveManualCalibration({
          calibrationSettings,
          calibrations,
          machineState: machineStateForAuto,
          targetObjective: objectiveForCalibration,
          calibrationSettingsList,
        });
        const forceKgf = parseForceKgf(machineState?.force);
        if (!preview) {
          // eslint-disable-next-line no-console
          console.log('[auto-measure] calibration lookup', {
            resolvedObjective: objectiveForCalibration,
            micronPerPixel: calibration?.micronPerPixel ?? null,
            calibrationName: calibration?.calibrationName ?? null,
            forceKgf,
          });
        }
        const minConfidence =
          settings.imageType === 'HV-1' ? 0.52 : settings.imageType === 'HV-3' ? 0.38 : 0.45;
        let displayedFrame;
        if (callSource === 'auto-click') {
          displayedFrame = cameraRef.current?.captureDisplayedFrame({ freeze: true });
        } else {
          displayedFrame = committedAutoMeasureFrameRef.current;
          if (displayedFrame) {
            // eslint-disable-next-line no-console
            console.log(
              `[auto-measure-frozen-frame-reuse] sessionId=${sessionIdForRun} size=${displayedFrame.width}x${displayedFrame.height}`
            );
          } else {
            // eslint-disable-next-line no-console
            console.log(
              `[auto-measure-live-frame-blocked] reason=no-frozen-frame source=${callSource}`
            );
          }
        }
        let capturedFrameIdForRun: number | null = autoMeasureCapturedFrameId;
        if (callSource === 'auto-click') {
          const capturedFrameId = getLastPaintedFrameId();
          capturedFrameIdForRun = capturedFrameId;
          setAutoMeasureCapturedFrameId(capturedFrameId);
          // Auto Measure click is an explicit user intent — release the
          // objective-change transition gate so the result is allowed to
          // paint even if the camera's first-fresh-frame observer hasn't
          // fired yet.
          setObjectiveChangeInProgress(false);
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-freeze-frame] sessionId=${sessionIdForRun} frameId=${capturedFrameId}`
          );
          // eslint-disable-next-line no-console
          console.log(`[auto-measure-snapshot] frameId=${capturedFrameId}`);
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure][frame-freeze] sessionId=${sessionIdForRun} frameId=${capturedFrameId} objective=${objectiveForCalibration ?? 'unknown'}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-capture-fresh-frame] objective=${objectiveForCalibration} frameId=${capturedFrameId}`
          );
        }

        // After an objective change the live canvas is cleared and the next
        // worker frame typically lands within ~33ms. If the user clicks Auto
        // Measure during that gap, wait once for a fresh frame and retry the
        // capture so detection runs against real pixels, not a black canvas.
        if (
          callSource === 'auto-click' &&
          displayedFrame &&
          !displayedFrame.ok &&
          displayedFrame.error === 'awaiting-fresh-frame'
        ) {
          if (!preview) {
            setStatusMessage('System Status: Waiting for camera frame after objective change');
          }
          // eslint-disable-next-line no-console
          console.log('[auto-measure] waiting-for-fresh-frame after objective change');
          const fresh = await (cameraRef.current?.waitForFreshFrame(2000) ?? Promise.resolve(false));
          // eslint-disable-next-line no-console
          console.log(`[auto-measure] frame-ready=${fresh}`);
          if (fresh) {
            displayedFrame = cameraRef.current?.captureDisplayedFrame({ freeze: true });
          }
        }

        if (!displayedFrame?.ok) {
          if (preview) {
            // Keep last valid overlay; surface only via status (no log spam).
            // eslint-disable-next-line no-console
            console.log(
              `[auto-settings-preview-reject] reason=${displayedFrame?.error ?? 'no committed frame'} keepLastValid=true`
            );
            return;
          }
          if (callSource === 'auto-click') {
            // eslint-disable-next-line no-console
            console.log('[auto-measure-click] detection-complete ok=false confidence=0 D1_px=0 D2_px=0');
          }
          {
            const stale = displayedFrame?.error ?? 'no-displayed-image (stale-frame)';
            setUnavailableMsg(`Auto Measure rejected: ${stale}. Please use manual measure.`);
            setStatusMessage(`System Status: Auto Measure rejected: ${stale}`);
            clearAutoMeasureOverlay('auto-measure-failed');
            if (callSource === 'auto-click') setAutoMeasureStatus('failed');
            // liveObjectiveForNative is declared further down — this branch
            // fires before it's computed (no displayed image), so log it as
            // 'unknown'.
            // eslint-disable-next-line no-console
            console.log(
              `[auto-measure-result] success=false reason=${stale} objective=unknown nativeObjective=n/a`
            );
          }
          return;
        }

        // Hard guard: live-camera detection input MUST be the native
        // full-resolution bgr24 frame (2592x1944). If anything else slipped
        // through (resized rgb32 canvas, partial frame, wrong format),
        // reject — never let detection silently run on a downscaled frame.
        if (
          displayedFrame.source === 'live-camera' &&
          (displayedFrame.width !== 2592 ||
            displayedFrame.height !== 1944 ||
            displayedFrame.pixelFormat !== 'bgr24')
        ) {
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-reject] reason=invalid-detection-frame width=${displayedFrame.width} height=${displayedFrame.height} pixelFormat=${displayedFrame.pixelFormat}`
          );
          if (!preview) {
            setStatusMessage('System Status: Auto Measure rejected: invalid-detection-frame');
            setUnavailableMsg('Auto Measure rejected: invalid-detection-frame. Please retry.');
            clearAutoMeasureOverlay('auto-measure-failed');
            if (callSource === 'auto-click') setAutoMeasureStatus('failed');
          }
          return;
        }

        if (callSource === 'auto-click') {
          committedAutoMeasureFrameRef.current = cloneCapturedFrame(displayedFrame);
        }
        const runSmoothing = settings.smoothing;
        const runThreshold = settings.threshold;
        logAutoMeasurePhase('auto-measure-frame', {
          objective: objectiveForCalibration,
          smoothing: runSmoothing,
          threshold: runThreshold,
          method: 'refined',
          reason: 'captured',
          extra: `width=${displayedFrame.width} height=${displayedFrame.height} frameId=${capturedFrameIdForRun ?? 'n/a'} source=${displayedFrame.source}`,
        });

        // Only forward the live machine-control objective when it normalises
        // to one of the canonical values. A transient empty / unknown machine
        // string must never poison the value sent to native.
        const liveObjectiveCandidate = String(objectiveForCalibration ?? '')
          .trim()
          .toUpperCase();
        const liveObjectiveForNative: ObjectiveForMeasure =
          (OBJECTIVE_FOR_MEASURE_OPTIONS as readonly string[]).includes(liveObjectiveCandidate)
            ? (liveObjectiveCandidate as ObjectiveForMeasure)
            : settings.objectiveForMeasure;
        if (!preview) {
          if (callSource === 'auto-click') {
            // eslint-disable-next-line no-console
            console.log('[auto-measure] detection-start');
            // eslint-disable-next-line no-console
            console.log(
              `[auto-measure-click] detection-start frameId=${displayedFrame.source}-${displayedFrame.width}x${displayedFrame.height}-${Date.now()}`
            );
          }
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure:start] frameSize=${displayedFrame.width}x${displayedFrame.height} smoothing=${settings.smoothing} threshold=${settings.threshold}`
          );
        }
        // Prove the frame about to be detected matches the confirmed
        // objective AND was painted after the most recent canvas clear.
        // Both fields must be aligned for detection to be trustworthy.
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-fresh-check] objective=${liveObjectiveForNative} confirmedFromMachine=${confirmedFromMachine ?? 'null'} currentEpoch=${getCurrentFrameEpoch()} lastPaintEpoch=${getLastPaintEpoch()} lastPaintAt=${getLastCameraFramePaintAt()} now=${Date.now()} frameSource=${displayedFrame.source} frameSize=${displayedFrame.width}x${displayedFrame.height}`
        );
        // Spec-format start log — also stamps a frameId we can grep for in
        // the native [auto-measure-start ...] line in the terminal.
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-start] sessionId=${sessionIdForRun} frameId=${capturedFrameIdForRun ?? 'n/a'} objective=${liveObjectiveForNative}`
        );
        const measureFn = preview ? measureVickersAutoPreview : measureVickersAuto;
        if (preview) {
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-preview-start] sessionId=${sessionIdForRun} smoothing=${settings.smoothing} threshold=${settings.threshold}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[auto-preview-handler-enter] smoothing=${settings.smoothing} threshold=${settings.threshold}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[auto-preview-frame-source] source=frozenFrame frameId=${capturedFrameIdForRun ?? 'n/a'} size=${displayedFrame.width}x${displayedFrame.height}`
          );
        }
        // Slider values are the source of truth at detection time. Objective
        // defaults seed the dialog when the objective changes (UI level) — at
        // detection time we must honor whatever the user has in the form,
        // otherwise dragging Smoothing/Threshold sliders produces no visible
        // change in the yellow lines because every detection runs on the
        // same hardcoded numbers.
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-run] objective=${liveObjectiveForNative} smoothing=${runSmoothing} threshold=${runThreshold}`
        );
        if (preview) {
          // eslint-disable-next-line no-console
          console.log(
            `[auto-preview-native-call] smoothing=${runSmoothing} threshold=${runThreshold} objective=${liveObjectiveForNative}`
          );
        }
        logAutoMeasurePhase('auto-measure-preprocess', {
          objective: liveObjectiveForNative,
          smoothing: runSmoothing,
          threshold: runThreshold,
          method: 'refined',
          reason: 'clahe+adaptive-threshold+morphology',
        });
        const nativeResult = await measureFn({
          smoothing: runSmoothing,
          threshold: runThreshold,
          objectiveForMeasure: liveObjectiveForNative,
          frameBuffer: displayedFrame.buffer,
          width: displayedFrame.width,
          height: displayedFrame.height,
          pixelFormat: displayedFrame.pixelFormat,
          bits: displayedFrame.bits,
          source: displayedFrame.source,
          micronPerPixel: calibration?.micronPerPixel ?? null,
          pxPerMm: calibration ? 1000 / calibration.micronPerPixel : null,
          testForceKgf: forceKgf,
          minConfidence,
          timeoutMs: 4000,
          maxFrameAgeMs: 1200,
        });

        if (!preview) {
          // eslint-disable-next-line no-console
          console.log('[auto-measure] result', nativeResult);
          if (callSource === 'auto-click') {
            // eslint-disable-next-line no-console
            console.log(
              `[auto-measure-click] detection-complete ok=${nativeResult.ok} confidence=${nativeResult.ok ? nativeResult.confidence.toFixed(3) : 0} D1_px=${nativeResult.ok ? nativeResult.d1Pixels.toFixed(3) : 0} D2_px=${nativeResult.ok ? nativeResult.d2Pixels.toFixed(3) : 0}`
            );
          }
        }

        const debugObj = (nativeResult.debug ?? {}) as {
          objectiveForMeasure?: unknown;
          contourCount?: unknown;
          selectedContourArea?: unknown;
          selectedValidationArea?: unknown;
          confidence?: unknown;
        };
        const nativeObjective =
          typeof debugObj.objectiveForMeasure === 'string'
            ? debugObj.objectiveForMeasure
            : '';
        logAutoMeasurePhase('auto-measure-contours', {
          objective: liveObjectiveForNative,
          smoothing: runSmoothing,
          threshold: runThreshold,
          method: nativeResult.ok ? 'refined' : 'rough',
          d1Px: nativeResult.ok ? nativeResult.d1Pixels : null,
          d2Px: nativeResult.ok ? nativeResult.d2Pixels : null,
          center: nativeResult.ok
            ? {
                x: ((nativeResult.corners.left.x + nativeResult.corners.right.x) / 2 +
                  (nativeResult.corners.top.x + nativeResult.corners.bottom.x) / 2) / 2,
                y: ((nativeResult.corners.left.y + nativeResult.corners.right.y) / 2 +
                  (nativeResult.corners.top.y + nativeResult.corners.bottom.y) / 2) / 2,
              }
            : null,
          reason: nativeResult.ok ? 'native-result' : nativeResult.reason,
          extra: `contourCount=${Number(debugObj.contourCount) || 0} selectedArea=${formatAutoMeasureNumber(Number(debugObj.selectedContourArea))} validationArea=${formatAutoMeasureNumber(Number(debugObj.selectedValidationArea))} confidence=${nativeResult.ok ? nativeResult.confidence.toFixed(3) : '0.000'}`,
        });
        const resolvedDetection = resolveAutoMeasureDetection(nativeResult, {
          objective: liveObjectiveForNative,
          smoothing: runSmoothing,
          threshold: runThreshold,
        });
        if (
          liveObjectiveForNative === '10X' &&
          nativeObjective !== '10X' &&
          nativeObjective !== ''
        ) {
          const reason = `native-branch-not-used (requested=10X native=${nativeObjective})`;
          logAutoMeasurePhase('auto-measure-reject', {
            objective: liveObjectiveForNative,
            smoothing: runSmoothing,
            threshold: runThreshold,
            method: resolvedDetection.method,
            reason,
          });
          if (!preview) {
            setStatusMessage(`System Status: Auto Measure rejected: ${reason}`);
            setUnavailableMsg(`Auto Measure rejected: ${reason}. Please use manual measure.`);
            clearAutoMeasureOverlay('auto-measure-failed');
            if (callSource === 'auto-click') setAutoMeasureStatus('failed');
          }
          return;
        }
        if (!resolvedDetection.ok) {
          const reason = resolvedDetection.reason;
          if (preview) {
            // Preview rejection: keep last valid overlay; no log spam.
            logAutoMeasurePhase('auto-measure-reject', {
              objective: liveObjectiveForNative,
              smoothing: runSmoothing,
              threshold: runThreshold,
              method: resolvedDetection.method,
              reason,
            });
            // eslint-disable-next-line no-console
            console.log(
              `[auto-settings-preview] smoothing=${settings.smoothing} kernel=${smoothingToPreviewKernel(settings.smoothing)} threshold=${settings.threshold} accepted=false D1_px=0 D2_px=0`
            );
            // eslint-disable-next-line no-console
            console.log(
              `[auto-settings-preview-reject] reason=${reason} keepLastValid=true`
            );
            return;
          }
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-result] success=false reason=${reason} objective=${liveObjectiveForNative} nativeObjective=${nativeObjective || 'missing'}`
          );
          logAutoMeasurePhase('auto-measure-reject', {
            objective: liveObjectiveForNative,
            smoothing: runSmoothing,
            threshold: runThreshold,
            method: resolvedDetection.method,
            reason,
          });
          setStatusMessage(`System Status: Auto Measure rejected: ${reason}`);
          // Surface the actual reason in the toast instead of the generic
          // "Auto detection not reliable" line so the operator sees WHY.
          setUnavailableMsg(`Auto Measure rejected: ${reason}. Please use manual measure.`);
          clearAutoMeasureOverlay('auto-measure-failed');
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure:validate] ok=false reason=${reason} D1_px=0 D2_px=0`
          );
          // eslint-disable-next-line no-console
          console.warn(
            `[measurement-commit-blocked] method=Auto reason=detection-rejected detail="${reason}"`
          );
          return;
        }

        const result = resolvedDetection.result;
        const detectionMethod = resolvedDetection.method;
        if (result.confidence < minConfidence) {
          logAutoMeasurePhase('auto-measure-fallback-used', {
            objective: liveObjectiveForNative,
            smoothing: runSmoothing,
            threshold: runThreshold,
            method: detectionMethod,
            d1Px: result.d1Pixels,
            d2Px: result.d2Pixels,
            center: resolvedDetection.validation.center,
            reason: `low-confidence-geometry-accepted confidence=${result.confidence.toFixed(3)} min=${minConfidence.toFixed(3)}`,
          });
        }

        if (!preview) {
          const debug = result.debug ?? {};
          // eslint-disable-next-line no-console
          console.log('[auto-measure:candidate]', {
            area: debug.selectedContourArea,
            center: debug.minAreaRect && typeof debug.minAreaRect === 'object'
              ? (debug.minAreaRect as { center?: unknown }).center
              : undefined,
            score: debug.confidence ?? result.confidence,
          });
          // eslint-disable-next-line no-console
          console.log('[auto-measure:tips-after]', result.corners);
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure:validate] ok=true reason=accepted D1_px=${result.d1Pixels.toFixed(3)} D2_px=${result.d2Pixels.toFixed(3)}`
          );
          const debugObjOk = (result.debug ?? {}) as { objectiveForMeasure?: unknown };
          const nativeObjectiveOk =
            typeof debugObjOk.objectiveForMeasure === 'string' ? debugObjOk.objectiveForMeasure : '';
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-result-objective] objective=${liveObjectiveForNative} nativeObjective=${nativeObjectiveOk || 'missing'}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-result] success=true reason=accepted objective=${liveObjectiveForNative} nativeObjective=${nativeObjectiveOk || 'missing'} d1Px=${result.d1Pixels.toFixed(3)} d2Px=${result.d2Pixels.toFixed(3)}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-result] sessionId=${sessionIdForRun} frameId=${capturedFrameIdForRun ?? 'n/a'} objective=${liveObjectiveForNative}`
          );
        }

        // Stamp the run's session id + the captured frame id on the graphics
        // so the render gate can reject a result that returns after a later
        // invalidator (objective change, turret move, camera close).
        const graphics: AutoMeasureGraphics = {
          ...graphicsFromAutoMeasureResult(result, objectiveForCalibration),
          sessionId: sessionIdForRun,
          // Stamp the frame id captured at click time — NOT the current live
          // frame id. Detection takes 60–200 ms; the live id advances by
          // then, so any equality check against the captured id would
          // spuriously reject every successful detection.
          frameId: capturedFrameIdForRun,
        };
        if (sessionIdForRun !== autoMeasureSessionIdRef.current) {
          // eslint-disable-next-line no-console
          console.log('[auto-measure-result-discard] reason=session-mismatch');
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-stale-callback] reason=session-superseded run=${sessionIdForRun} current=${autoMeasureSessionIdRef.current}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-run-ignore-stale] resultRunId=${sessionIdForRun} currentRunId=${autoMeasureSessionIdRef.current}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[overlay-skip-stale-result] reason=runId-mismatch resultRunId=${sessionIdForRun} currentRunId=${autoMeasureSessionIdRef.current}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[overlay-ignore-stale] resultRunId=${sessionIdForRun} currentRunId=${autoMeasureSessionIdRef.current}`
          );
          return;
        }
        // Objective + frame guards. Result must belong to the objective the
        // user was viewing at click time AND to the frame captured then —
        // an in-flight result from a superseded objective/frame is dropped.
        {
          const liveSnapshot = await getMachineStateSnapshot().catch(() => null);
          const liveConfirmed =
            liveSnapshot?.confirmedObjectiveFromMachine?.trim() ||
            (activeObjective ?? '').trim() ||
            null;
          if (
            liveConfirmed &&
            objectiveForCalibration &&
            String(liveConfirmed).toUpperCase() !==
              String(objectiveForCalibration).toUpperCase()
          ) {
            // eslint-disable-next-line no-console
            console.log('[auto-measure-result-discard] reason=objective-mismatch');
            return;
          }
        }
        if (!preview && callSource === 'auto-click') {
          const c = result.corners;
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure] corners-detected top=${c.top.x.toFixed(2)},${c.top.y.toFixed(2)} right=${c.right.x.toFixed(2)},${c.right.y.toFixed(2)} bottom=${c.bottom.x.toFixed(2)},${c.bottom.y.toFixed(2)} left=${c.left.x.toFixed(2)},${c.left.y.toFixed(2)}`
          );
          // nativeCorners → displayCorners scale map. Camera preview canvas
          // is painted at half native resolution (PREVIEW_SCALE=2 in
          // useCameraStream); the AutoMeasureOverlay still receives native
          // corners and maps them via imageToDisplay at render time. This
          // log captures the scaled set used for the yellow overlay.
          const nativeWidth = displayedFrame.width;
          const nativeHeight = displayedFrame.height;
          const PREVIEW_SCALE = 2;
          const displayWidth = Math.round(nativeWidth / PREVIEW_SCALE);
          const displayHeight = Math.round(nativeHeight / PREVIEW_SCALE);
          const scaleX = displayWidth / nativeWidth;
          const scaleY = displayHeight / nativeHeight;
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-scale-map] nativeWidth=${nativeWidth} nativeHeight=${nativeHeight} displayWidth=${displayWidth} displayHeight=${displayHeight} scaleX=${scaleX.toFixed(4)} scaleY=${scaleY.toFixed(4)}`
          );
          const scalePoint = (p: { x: number; y: number }) => ({
            x: +(p.x * scaleX).toFixed(2),
            y: +(p.y * scaleY).toFixed(2),
          });
          const nativeCorners = {
            top: { x: +c.top.x.toFixed(2), y: +c.top.y.toFixed(2) },
            right: { x: +c.right.x.toFixed(2), y: +c.right.y.toFixed(2) },
            bottom: { x: +c.bottom.x.toFixed(2), y: +c.bottom.y.toFixed(2) },
            left: { x: +c.left.x.toFixed(2), y: +c.left.y.toFixed(2) },
          };
          const displayCorners = {
            top: scalePoint(c.top),
            right: scalePoint(c.right),
            bottom: scalePoint(c.bottom),
            left: scalePoint(c.left),
          };
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-result] nativeCorners=${JSON.stringify(nativeCorners)} displayCorners=${JSON.stringify(displayCorners)} d1Px=${result.d1Pixels.toFixed(3)} d2Px=${result.d2Pixels.toFixed(3)} hv=${typeof result.hv === 'number' ? result.hv.toFixed(2) : 'n/a'} frameId=${capturedFrameIdForRun ?? 'n/a'}`
          );
        }
        const snapshot: AutoMeasureDetectionSnapshot = {
          settings,
          result,
          graphics,
          method: detectionMethod,
          validationReason: resolvedDetection.reason,
          objectiveForCalibration,
          machineStateForAuto,
          forceKgf,
        };

        if (preview) {
          const detectMs = performance.now() - requestedAt;
          {
            const c = result.ok ? result.corners : null;
            const fmt = (p: { x: number; y: number } | null | undefined) =>
              p ? `(${p.x.toFixed(2)},${p.y.toFixed(2)})` : 'null';
            // eslint-disable-next-line no-console
            console.log(
              `[auto-preview-result] ok=${result.ok} left=${fmt(c?.left)} right=${fmt(c?.right)} top=${fmt(c?.top)} bottom=${fmt(c?.bottom)} d1=${result.ok ? result.d1Pixels.toFixed(3) : 'n/a'} d2=${result.ok ? result.d2Pixels.toFixed(3) : 'n/a'}`
            );
            const prev = displayedAutoMeasureGraphicsRef.current;
            if (c && prev) {
              const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
                Math.hypot(a.x - b.x, a.y - b.y).toFixed(2);
              // eslint-disable-next-line no-console
              console.log(
                `[auto-preview-geometry-delta] dLeft=${d(c.left, prev.corners.left)} dRight=${d(c.right, prev.corners.right)} dTop=${d(c.top, prev.corners.top)} dBottom=${d(c.bottom, prev.corners.bottom)}`
              );
              const same =
                d(c.left, prev.corners.left) === '0.00' &&
                d(c.right, prev.corners.right) === '0.00' &&
                d(c.top, prev.corners.top) === '0.00' &&
                d(c.bottom, prev.corners.bottom) === '0.00';
              if (same) {
                // eslint-disable-next-line no-console
                console.log(
                  `[auto-preview-no-geometry-change] smoothing=${settings.smoothing} threshold=${settings.threshold}`
                );
              }
            }
          }
          if (!autoMeasureSettingsEqual(settings, latestAutoMeasurePreviewSettingsRef.current)) {
            const latest = latestAutoMeasurePreviewSettingsRef.current;
            // eslint-disable-next-line no-console
            console.log(
              `[auto-settings-preview] smoothing=${settings.smoothing} kernel=${readPreviewKernel(result, settings.smoothing)} threshold=${settings.threshold} accepted=false D1_px=0 D2_px=0 detectMs=${detectMs.toFixed(1)}`
            );
            // eslint-disable-next-line no-console
            console.log('[auto-settings-preview-reject] reason=stale-preview keepLastValid=true');
            // eslint-disable-next-line no-console
            console.log(
              `[auto-measure-settings][preview-skip-stale] reqSmoothing=${settings.smoothing} reqThreshold=${settings.threshold} latestSmoothing=${latest?.smoothing ?? 'n/a'} latestThreshold=${latest?.threshold ?? 'n/a'} detectMs=${detectMs.toFixed(1)}`
            );
            return;
          }
          const before = displayedAutoMeasureGraphicsRef.current;
          const kernel = readPreviewKernel(result, settings.smoothing);
          setPreviewAutoMeasureOverlay((prev) => {
            if (prev && graphicsAlmostEqual(prev, graphics)) {
              // eslint-disable-next-line no-console
              console.log('[auto-overlay-skip] reason=same-lines-no-state-update');
              return prev;
            }
            // eslint-disable-next-line no-console
            console.log(
              `[auto-overlay-set] source=settings-preview lines=${graphics.lines.length} corners=4`
            );
            return graphics;
          });
          autoMeasurePreviewSnapshotRef.current = snapshot;
          previewMeasurementRef.current = {
            d1Pixels: result.d1Pixels,
            d2Pixels: result.d2Pixels,
            confidence: result.confidence,
          };
          // eslint-disable-next-line no-console
          console.log(
            `[auto-settings-preview] smoothing=${settings.smoothing} threshold=${settings.threshold} D1_px=${result.d1Pixels.toFixed(3)} D2_px=${result.d2Pixels.toFixed(3)} kernel=${kernel} accepted=true detectMs=${detectMs.toFixed(1)}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-settings][preview-apply] smoothing=${settings.smoothing} threshold=${settings.threshold} d1Px=${result.d1Pixels.toFixed(3)} d2Px=${result.d2Pixels.toFixed(3)} detectMs=${detectMs.toFixed(1)}`
          );
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-preview-finish] smoothing=${settings.smoothing} threshold=${settings.threshold} detectMs=${detectMs.toFixed(1)}`
          );
          const fmtPt = (p: { x: number; y: number } | null | undefined) =>
            p ? `${p.x.toFixed(2)},${p.y.toFixed(2)}` : 'null';
          // eslint-disable-next-line no-console
          console.log(
            `[auto-settings-tip-move] topBefore=${fmtPt(before?.corners.top)} topAfter=${fmtPt(result.corners.top)} rightBefore=${fmtPt(before?.corners.right)} rightAfter=${fmtPt(result.corners.right)} bottomBefore=${fmtPt(before?.corners.bottom)} bottomAfter=${fmtPt(result.corners.bottom)} leftBefore=${fmtPt(before?.corners.left)} leftAfter=${fmtPt(result.corners.left)}`
          );
          return;
        }

        await commitAutoMeasureSnapshot(
          snapshot,
          callSource === 'settings-save' ? 'settings-save' : 'auto-click'
        );
        return;

      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[auto-measure] failed:', err);
        if (!preview && callSource === 'auto-click') {
          // eslint-disable-next-line no-console
          console.log('[auto-measure-click] detection-complete ok=false confidence=0 D1_px=0 D2_px=0');
        }
        if (preview) {
          // Preview-time exception: keep overlay, just log + status.
          setStatusMessage('System Status: Auto Measure preview detection failed');
        } else {
          setUnavailableMsg('Auto detection not reliable. Please use manual measure.');
          // The overlay was already cleared at start; ensure no stale state
          // resurrects after a thrown detection error.
          clearAutoMeasureOverlay('auto-measure-failed');
        }
      } finally {
        autoMeasureInFlightRef.current = false;
        setAutoMeasuring(false);
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-run-finish] runId=${sessionIdForRun} source=${callSource}`
        );
        // Drain coalesced preview: if a slider tick arrived while we were
        // running, fire one more pass with the latest settings so the user's
        // final position always wins.
        const pending = autoMeasurePendingPreviewRef.current;
        if (pending) {
          autoMeasurePendingPreviewRef.current = null;
          window.setTimeout(() => runAutoMeasureRef.current?.(pending, true, 'settings-preview'), 0);
        }
      }
    })();
  }, [
    calibrationSettings,
    calibrationSettingsList,
    calibrations,
    clearAutoMeasureOverlay,
    commitAutoMeasureSnapshot,
    getMachineStateSnapshot,
    activeObjective,
  ]);

  // Keep a ref to the latest runAutoMeasure so the in-flight finally block
  // can schedule a coalesced trailing run without depending on itself.
  useEffect(() => {
    runAutoMeasureRef.current = runAutoMeasure;
  }, [runAutoMeasure]);

  useEffect(() => {
    if (activeDialog !== 'autoMeasure') {
      autoMeasureSettingsOpenRef.current = false;
      setPreviewAutoMeasureOverlay(null);
      autoMeasurePreviewSnapshotRef.current = null;
      previewMeasurementRef.current = null;
      return;
    }

    if (!autoMeasureSettingsOpenRef.current) {
      autoMeasureSettingsOpenRef.current = true;
      setPreviewAutoMeasureOverlay((prev) => {
        if (!committedAutoMeasureOverlay) return prev;
        return prev && graphicsAlmostEqual(prev, committedAutoMeasureOverlay)
          ? prev
          : committedAutoMeasureOverlay;
      });
    }

    // eslint-disable-next-line no-console
    console.log(
      `[auto-measure-preview-request] smoothing=${autoMeasurePreviewSettings.smoothing} threshold=${autoMeasurePreviewSettings.threshold}`
    );

    const timer = window.setTimeout(() => {
      if (suppressAutoMeasurePreviewRef.current) {
        suppressAutoMeasurePreviewRef.current = false;
        // eslint-disable-next-line no-console
        console.log('[auto-measure-preview-skip] reason=objective-change');
        return;
      }
      // Invoke through the ref so this effect does NOT depend on
      // runAutoMeasure's callback identity. Without this indirection, every
      // change to activeObjective / calibrations re-creates runAutoMeasure,
      // re-fires this effect mid-drag, clears the 70ms timer, and restarts
      // the preview pipeline — visible as jitter while the user is dragging
      // the Smoothing / Threshold sliders.
      runAutoMeasureRef.current?.(autoMeasurePreviewSettings, true, 'settings-preview');
    }, 70);

    return () => window.clearTimeout(timer);
    // committedAutoMeasureOverlay and runAutoMeasure are intentionally NOT
    // in the deps — they would re-fire the effect mid-drag. The initial-open
    // copy uses committedAutoMeasureOverlay from the closure captured when
    // activeDialog flips to 'autoMeasure', which is the moment we actually
    // want it sampled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDialog, autoMeasurePreviewSettings]);

  const handleAutoMeasureSettingsSaved = useCallback(
    (settings: AutoMeasureSettingsPayload) => {
      const normalized = normalizeAutoMeasureSettings(settings);
      latestAutoMeasurePreviewSettingsRef.current = normalized;
      setAutoMeasurePreviewSettings(normalized);
      void refetchAutoMeasureSettings();

      const commitPreviewOrDetect = () => {
        if (autoMeasureInFlightRef.current) {
          window.setTimeout(commitPreviewOrDetect, 80);
          return;
        }

        const snapshot = autoMeasurePreviewSnapshotRef.current;
        if (snapshot && autoMeasureSettingsEqual(snapshot.settings, normalized)) {
          void commitAutoMeasureSnapshot(snapshot, 'settings-save');
          return;
        }

        runAutoMeasure(normalized, false, 'settings-save');
      };

      commitPreviewOrDetect();
    },
    [commitAutoMeasureSnapshot, refetchAutoMeasureSettings, runAutoMeasure]
  );

  // Note the latest machine-confirmed lightness so the camera consumer can
  // log/refresh on each new value. The physical change is driven by the
  // machine's LED, so this is observational — we do not block the camera
  // pipeline on it.
  const lastLoggedLightnessRef = useRef<string | null>(null);
  useEffect(() => {
    const value = liveMachineState?.lightness;
    if (value === undefined || value === null) return;
    const next = String(value);
    if (lastLoggedLightnessRef.current === next) return;
    lastLoggedLightnessRef.current = next;
    // eslint-disable-next-line no-console
    console.log(`[camera-lightness-refresh] value=${next} frameId=${getLastPaintEpoch()}`);
  }, [liveMachineState?.lightness]);

  // Mirror SSE machine state's objective into App-level state — but never
  // clobber a value the user just clicked. The toggle click is the
  // authoritative source; SSE is only for picking up changes that originated
  // outside this UI (other tab, another client, app restart).
  useEffect(() => {
    const next = liveMachineState?.objective?.trim() || null;
    if (!next) return;
    if (Date.now() - lastObjectiveClickAtRef.current < 5000) return;
    if (next !== activeObjective) {
      // eslint-disable-next-line no-console
      console.log(`[objective-change-request] source=machine objective=${next}`);
      setActiveObjective(next);
      // eslint-disable-next-line no-console
      console.log('[objective] changed current=', next, 'source=sse');
    }
  }, [liveMachineState?.objective, activeObjective]);

  // Camera/objective sync pipeline. Triggered ONLY by a confirmed L<n>OK RX
  // from the machine (machineState.confirmedObjectiveFromMachine), not by the
  // OK-ACK or by the user click — so the UI never reflects a magnification the
  // turret hasn't actually reached.
  useEffect(() => {
    const confirmed = liveMachineState?.confirmedObjectiveFromMachine?.trim() || null;
    if (!confirmed) return;
    if (lastSyncedObjectiveRef.current === confirmed) return;
    lastSyncedObjectiveRef.current = confirmed;

    // 1) Force activeObjective to the machine-confirmed value. Overrides the
    //    optimistic value the click handler may have set.
    setActiveObjective(confirmed);
    // eslint-disable-next-line no-console
    console.log(`[statusbar-objective] objective=${confirmed}`);
    setObjectiveChangeInProgress(true);

    // eslint-disable-next-line no-console
    console.log(`[objective-change-start] objective=${confirmed}`);
    // eslint-disable-next-line no-console
    console.log(`[objective-confirmed] objective=${confirmed}`);
    // eslint-disable-next-line no-console
    console.log(`[camera-objective-change] objective=${confirmed}`);
    // eslint-disable-next-line no-console
    console.log(`[camera-objective-sync] objective=${confirmed}`);
    // eslint-disable-next-line no-console
    console.log(`[camera-refresh] reason=objective-change`);

    // 2) Reload calibration profile for the now-confirmed objective.
    void refetchCalibrationSettings();
    const cal = findCalibrationForObjective(calibrationSettingsList, confirmed);
    const umPerPixel = cal ? (cal.umPerPixel ?? cal.pixelToMicron) : null;
    // eslint-disable-next-line no-console
    console.log(`[camera-calibration] loaded objective=${confirmed} umPerPixel=${umPerPixel ?? 'unknown'}`);
    // eslint-disable-next-line no-console
    console.log(
      `[calibration-load] objective=${confirmed} umPerPixel=${umPerPixel ?? 'unknown'} xUmPerPixel=${umPerPixel ?? 'unknown'} yUmPerPixel=${umPerPixel ?? 'unknown'}`
    );
    // eslint-disable-next-line no-console
    console.log(`[measurement-scale] objective=${confirmed} umPerPixel=${umPerPixel ?? 'unknown'}`);

    // 3) Bump the viewport refresh key so CameraWindow can clear any cached
    //    transforms and force a fresh draw at the new magnification.
    setObjectiveRefreshKey((k) => k + 1);

    // 4) Invalidate the live canvas so the next worker frame draws onto a
    //    cleared surface (no stale frame from the previous objective).
    cameraRef.current?.clearLiveCanvas();
    // eslint-disable-next-line no-console
    console.log('[camera-canvas-clear] reason=objective-change');

    // 5) Clear any stale Auto Measure state from the previous magnification —
    //    snapshot frame, frozen overlay, preview overlay, and preview snapshot.
    //    Without this, a 40X frame/overlay can survive into a 10X session.
    clearAutoMeasureOverlay('objective-change-confirmed');
    // eslint-disable-next-line no-console
    console.log(`[auto-measure-clear-on-objective-change] objective=${confirmed}`);
    // eslint-disable-next-line no-console
    console.log('[measurement-session-reset] reason=objective-change');
    // eslint-disable-next-line no-console
    console.log(`[auto-measure-reset] reason=objective-change objective=${confirmed}`);

    // eslint-disable-next-line no-console
    console.log(`[viewport-refresh] completed objective=${confirmed}`);

    // Objective change does NOT auto-run detection. Yellow overlay appears
    // only after an explicit Auto Measure click. We just cleared the live
    // canvas and the previous-objective overlay above; the next worker frame
    // will paint the fresh live image on its own. Observer-only: wait for
    // the next painted frame so we can log when the live image refreshed
    // (does not capture, does not detect, does not block).
    void (async () => {
      const fresh = await (cameraRef.current?.waitForFreshFrame(2500) ?? Promise.resolve(false));
      if (!fresh) {
        // Don't strand the gate closed — re-open it even on timeout so the
        // user isn't blocked from clicking Auto Measure later.
        setObjectiveChangeInProgress(false);
        return;
      }
      if (lastSyncedObjectiveRef.current !== confirmed) {
        setObjectiveChangeInProgress(false);
        return;
      }
      setObjectiveChangeInProgress(false);
      // eslint-disable-next-line no-console
      console.log(
        `[camera-frame-after-objective-change] objective=${confirmed} frameId=${getLastPaintEpoch()}`
      );
    })();
  }, [
    liveMachineState?.confirmedObjectiveFromMachine,
    calibrationSettingsList,
    clearAutoMeasureOverlay,
    refetchCalibrationSettings,
  ]);

  // Turret position change — any direction button (left/front/right) that
  // moves the turret can land on a different slot (incl. IND, which is not
  // an objective lens and therefore does NOT bump confirmedObjective). The
  // overlay was captured against a specific turret orientation, so any
  // turret move invalidates it regardless of objective.
  const lastSeenTurretPositionRef = useRef<string | null>(null);
  useEffect(() => {
    const pos = liveMachineState?.turretPosition ?? null;
    if (!pos) return;
    if (lastSeenTurretPositionRef.current === null) {
      lastSeenTurretPositionRef.current = pos;
      return;
    }
    if (lastSeenTurretPositionRef.current === pos) return;
    lastSeenTurretPositionRef.current = pos;
    // eslint-disable-next-line no-console
    console.log(`[turret-change-start] position=${pos}`);
    clearAutoMeasureOverlay('turret-change');
    cameraRef.current?.clearLiveCanvas();
  }, [liveMachineState?.turretPosition, clearAutoMeasureOverlay]);

  // Impress lifecycle. Drives:
  //  - overlay clear at TX time (so old yellow lines disappear before motion),
  //  - block on Auto Measure during the run (impressInProgressRef),
  //  - auto-trigger Auto Measure on a FRESH frame after FINISH so the new
  //    indentation is detected without an operator click.
  // Driven entirely by the machine's confirmed indentStatus so we never flag
  // "done" before the machine actually finishes.
  useEffect(() => {
    const prev = lastSeenIndentStatusRef.current;
    const next: IndentStatus = liveMachineState?.indentStatus ?? 'idle';
    if (prev === next) return;
    lastSeenIndentStatusRef.current = next;

    const enteringRun =
      (next === 'started' || next === 'running') && prev !== 'started' && prev !== 'running';
    if (enteringRun) {
      impressInProgressRef.current = true;
      setCommittedAutoMeasureOverlay(null);
      setPreviewAutoMeasureOverlay(null);
      autoMeasurePreviewSnapshotRef.current = null;
      committedAutoMeasureFrameRef.current = null;
      previewMeasurementRef.current = null;
      autoMeasurementIdRef.current = null;
      setManualMeasureResetKey((current) => current + 1);
      // eslint-disable-next-line no-console
      console.log('[overlay-clear] reason=impress-start');
      // eslint-disable-next-line no-console
      console.log(`[impress-started] timestamp=${Date.now()} indentStatus=${next}`);
      return;
    }

    if (next === 'completed' && (prev === 'started' || prev === 'running')) {
      const completedAt = Date.now();
      // eslint-disable-next-line no-console
      console.log(`[impress-complete] timestamp=${completedAt}`);
      void (async () => {
        // eslint-disable-next-line no-console
        console.log('[camera-wait-fresh-frame] reason=after-impress');
        const camera = cameraRef.current;
        const fresh = camera ? await camera.waitForFreshFrame(2500) : false;
        if (!fresh) {
          // eslint-disable-next-line no-console
          console.warn(
            '[camera-fresh-frame] reason=after-impress result=timeout — auto-detect skipped, user can re-run Auto Measure manually'
          );
          impressInProgressRef.current = false;
          return;
        }
        // eslint-disable-next-line no-console
        console.log(
          `[camera-fresh-frame] frameId=${getLastPaintEpoch()} timestamp=${Date.now()}`
        );
        // Reset the duplicate-fingerprint guard so the post-impress detection
        // can write a row even if pixel coordinates happen to land near the
        // last committed values. The new indentation is, by definition, a
        // new measurement.
        committedFingerprintsRef.current = [];
        impressInProgressRef.current = false;
        // eslint-disable-next-line no-console
        console.log(`[auto-measure-after-impress-start] frameId=${getLastPaintEpoch()}`);
        // eslint-disable-next-line no-console
        console.log('[measurement-row-create] method=Auto impress=completed');
        runAutoMeasure(autoMeasurePreviewSettings, false, 'auto-click');
      })();
      return;
    }

    if (next === 'error' || next === 'idle') {
      if (impressInProgressRef.current) {
        impressInProgressRef.current = false;
        // eslint-disable-next-line no-console
        console.log(`[impress-flag-clear] reason=indentStatus=${next}`);
      }
    }
  }, [
    autoMeasurePreviewSettings,
    liveMachineState?.indentStatus,
    runAutoMeasure,
  ]);

  // When Manual Measure activates, refresh the live objective so the initial
  // diamond size matches the magnification the user just toggled to.
  useEffect(() => {
    if (activeTool !== 'manualMeasure') return;
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await getMachineStateSnapshot();
        if (cancelled) return;
        if (snapshot?.objective?.trim()) {
          setActiveObjective(snapshot.objective);
          // eslint-disable-next-line no-console
          console.log('[objective] current=', snapshot.objective);
        }
      } catch {
        /* non-fatal — fall back to whatever objective we already have */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTool, getMachineStateSnapshot, manualMeasureResetKey]);

  const handleAutoMeasure = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[measure-mode-change] mode=auto');
    // eslint-disable-next-line no-console
    console.log(
      `[auto-measure-click] sessionId=${autoMeasureSessionIdRef.current + 1} objective=${activeObjective ?? 'unknown'}`
    );
    if (activeTool === 'manualMeasure') {
      // eslint-disable-next-line no-console
      console.log('[measure-mode-clear] reason=switch-mode prev=manual');
      setActiveTool('pointer');
      resetManualMeasure();
    }
    suppressAutoMeasurePreviewRef.current = false;
    runAutoMeasure(autoMeasurePreviewSettings, false, 'auto-click');
  }, [activeObjective, activeTool, autoMeasurePreviewSettings, resetManualMeasure, runAutoMeasure, setActiveTool]);

  // Live recompute when the user drags edges/corners on the auto-measure
  // overlay. We coalesce rapid drag events with a 90ms trailing debounce so
  // the DB save and refetch don't fire 60×/sec while we still update the
  // overlay/graphics in real time on every move.
  const adjustSaveTimerRef = useRef<number | null>(null);
  const lastAdjustedCornersRef = useRef<AutoMeasureCorners | null>(null);
  const handleAutoMeasureAdjusted = useCallback(
    (newCorners: AutoMeasureCorners) => {
      lastAdjustedCornersRef.current = newCorners;
      // Update graphics immediately so the overlay & any downstream readers
      // see the new corners on the next frame.
      const applyAdjustedCorners = (current: AutoMeasureGraphics | null) =>
        current ? { ...current, corners: newCorners } : current;
      if (previewAutoMeasureOverlay) {
        setPreviewAutoMeasureOverlay(applyAdjustedCorners);
      } else {
        setCommittedAutoMeasureOverlay(applyAdjustedCorners);
      }

      // Calibration mode: the calibration panel's Pixel X / Pixel Y inputs
      // are bound to latestManualPixels. Push the new diagonals through
      // immediately so the form reflects every drag, and skip the
      // measurement-row debounce below — calibration must not create a row
      // until the user clicks Add Calibration.
      if (calibrationManualModeRef.current) {
        const d1Px = Math.hypot(
          newCorners.right.x - newCorners.left.x,
          newCorners.right.y - newCorners.left.y
        );
        const d2Px = Math.hypot(
          newCorners.bottom.x - newCorners.top.x,
          newCorners.bottom.y - newCorners.top.y
        );
        const centerX = (newCorners.left.x + newCorners.right.x) / 2;
        const centerY = (newCorners.top.y + newCorners.bottom.y) / 2;
        setLatestManualPixels({ d1Px, d2Px });
        // eslint-disable-next-line no-console
        console.log(
          `[calibration-cross-adjust-update] center=(${centerX.toFixed(2)},${centerY.toFixed(2)}) d1Px=${d1Px.toFixed(2)} d2Px=${d2Px.toFixed(2)}`
        );
        // eslint-disable-next-line no-console
        console.log(
          `[calibration-pixel-update] pixelX=${d1Px.toFixed(2)} pixelY=${d2Px.toFixed(2)}`
        );
        if (adjustSaveTimerRef.current !== null) {
          window.clearTimeout(adjustSaveTimerRef.current);
          adjustSaveTimerRef.current = null;
        }
        return;
      }

      if (adjustSaveTimerRef.current !== null) {
        window.clearTimeout(adjustSaveTimerRef.current);
      }
      adjustSaveTimerRef.current = window.setTimeout(() => {
        adjustSaveTimerRef.current = null;
        const corners = lastAdjustedCornersRef.current;
        if (!corners) return;
        void (async () => {
          try {
            const machineState = await getMachineStateSnapshot();
            // Same single source of truth as Auto Measure / Manual Measure.
            // No dialog-default silent fallback.
            const objectiveForCalibration =
              (activeObjective && activeObjective.trim()) ||
              (machineState?.objective?.trim() ?? null);
            if (!objectiveForCalibration) {
              setStatusMessage('System Status: Auto (Adjusted) blocked: no active objective');
              return;
            }
            const machineStateForAuto = machineState
              ? { ...machineState, objective: objectiveForCalibration }
              : null;
            const forceKgf = parseForceKgf(machineState?.force);

            const d1Px = Math.hypot(
              corners.right.x - corners.left.x,
              corners.right.y - corners.left.y
            );
            const d2Px = Math.hypot(
              corners.bottom.x - corners.top.x,
              corners.bottom.y - corners.top.y
            );
            // eslint-disable-next-line no-console
            console.log(
              `[auto-measure-adjust] d1Px=${d1Px.toFixed(2)} d2Px=${d2Px.toFixed(2)}`
            );

            const targetId = autoMeasurementIdRef.current ?? undefined;
            const timestamp = new Date().toISOString();

            const conversion = calculateVickersFromPixels({
              calibrationSettings,
              calibrationSettingsList,
              calibrations,
              d1Px,
              d2Px,
              forceKgf,
              machineState: machineStateForAuto,
              objective: objectiveForCalibration,
              targetObjective: objectiveForCalibration,
            });
            if (!conversion.ok) {
              setUnavailableMsg(conversion.reason);
              setStatusMessage(`System Status: Auto (Adjusted) blocked: ${conversion.reason}`);
              return;
            }
            const values = conversion.value;

            // eslint-disable-next-line no-console
            console.log('[auto-measure] adjusted recompute', {
              machineObjective: machineState?.objective ?? null,
              resolvedObjective: objectiveForCalibration,
              micronPerPixel: values.umPerPixel,
              d1Px: values.d1Px,
              d2Px: values.d2Px,
              d1Um: values.d1Um,
              d2Um: values.d2Um,
              averageUm: values.avgDUm,
              averageMm: values.avgDMm,
              forceKgf: values.forceKgf,
              hv: values.hv,
              corners,
            });

            // eslint-disable-next-line no-console
            console.log('[measurement-table] insert objective=', values.normalizedObjective, 'method=Auto (Adjusted)');
            // eslint-disable-next-line no-console
            console.log(
              `[auto-measure][save] source=auto-corrected d1Um=${values.d1Um} d2Um=${values.d2Um} davgUm=${values.avgDUm} hv=${values.hv ?? 'n/a'}`
            );
            // eslint-disable-next-line no-console
            console.log(
              `[auto-measure-adjust-update] d1Px=${values.d1Px.toFixed(2)} d2Px=${values.d2Px.toFixed(2)} hv=${values.hv ?? 'n/a'}`
            );
            // eslint-disable-next-line no-console
            console.log(
              `[measurement-row-create] method=Auto-Adjusted d1Px=${values.d1Px} d2Px=${values.d2Px} d1Um=${values.d1Um} d2Um=${values.d2Um} davgUm=${values.avgDUm} hv=${values.hv} objective=${values.normalizedObjective} umPerPixel=${values.umPerPixel}`
            );
            // eslint-disable-next-line no-console
            console.log('[hv-type-set] source=auto value=HV');
            // eslint-disable-next-line no-console
            console.log(
              `[measurement-row-create] hv=${values.hv ?? 'n/a'} hardnessType=HV hvType=HV`
            );
            // eslint-disable-next-line no-console
            console.log('[album] snapshot capture start measurementId=', targetId ?? 'new');
            await waitForOverlayPaint();
            // eslint-disable-next-line no-console
            console.log('[album] auto measure overlay ready, capturing thumbnail');
            const imageDataUrl = cameraRef.current?.captureThumbnailDataUrl() ?? undefined;
            if (imageDataUrl) {
              // eslint-disable-next-line no-console
              console.log('[album] thumbnail captured with overlay=true points=4');
            } else {
              // eslint-disable-next-line no-console
              console.warn('[album] missing image for measurementId=', targetId ?? 'new');
            }
            const saved = await saveManualMeasurement({
              id: targetId,
              values: {
                d1: values.d1Um,
                d2: values.d2Um,
                d1Px: values.d1Px,
                d2Px: values.d2Px,
                d1Um: values.d1Um,
                d2Um: values.d2Um,
                averageUm: values.avgDUm,
                averageMm: values.avgDMm,
                hv: values.hv,
                hardnessType: 'HV',
                qualified: deriveQualifiedForRow(values.hv),
                micronPerPixel: values.umPerPixel,
                calibrationName: values.calibrationName,
                objective: values.normalizedObjective,
                testForceKgf: values.forceKgf,
                method: 'Auto (Adjusted)',
                unit: 'um',
                timestamp,
                imageDataUrl,
              },
            });
            // eslint-disable-next-line no-console
            console.log('[album] measurement updated thumbnail=', !!imageDataUrl, 'id=', saved.id);
            autoMeasurementIdRef.current = saved.id;
            const centerX = (corners.left.x + corners.right.x) / 2;
            const centerY = (corners.top.y + corners.bottom.y) / 2;
            const fingerprintObjective = normalizeAutoMeasureFingerprintObjective(objectiveForCalibration);
            const fingerprintKey = buildAutoMeasureFingerprintKey({
              objective: fingerprintObjective,
              centerX,
              centerY,
              d1Px: values.d1Px,
              d2Px: values.d2Px,
            });
            const baseGraphics = displayedAutoMeasureGraphicsRef.current;
            if (baseGraphics) {
              committedFingerprintsRef.current = upsertCommittedAutoMeasureFingerprint(
                committedFingerprintsRef.current,
                {
                  objective: fingerprintObjective,
                  d1Px: values.d1Px,
                  d2Px: values.d2Px,
                  centerX,
                  centerY,
                  hv:
                    typeof saved.hv === 'number' && Number.isFinite(saved.hv)
                      ? saved.hv
                      : values.hv,
                  rowId: saved.id,
                  fingerprintKey,
                  graphics: cloneAutoMeasureGraphics({ ...baseGraphics, corners }),
                }
              );
              // eslint-disable-next-line no-console
              console.log(
                `[measurement-fingerprint-store] rowId=${saved.id} key=${fingerprintKey} total=${committedFingerprintsRef.current.length}`
              );
            }
            // eslint-disable-next-line no-console
            console.log(
              `[auto-measure][drag-table-update] rowId=${saved.id} source=corrected`
            );
            await refetchMeasurements();
            // eslint-disable-next-line no-console
            console.log('[measurement-table][refresh] rows=auto-corrected');
            setStatusMessage(
              saved.hv
                ? `System Status: Auto (Adjusted) updated: HV ${saved.hv}`
                : `System Status: Auto (Adjusted) updated: ${values.d1Um} µm / ${values.d2Um} µm`
            );
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[auto-measure] adjust save failed:', err);
          }
        })();
      }, 90);
    },
    [
      calibrationSettings,
      calibrationSettingsList,
      calibrations,
      getMachineStateSnapshot,
      activeObjective,
      refetchMeasurements,
      saveManualMeasurement,
    ]
  );

  useEffect(() => {
    return () => {
      if (adjustSaveTimerRef.current !== null) {
        window.clearTimeout(adjustSaveTimerRef.current);
      }
    };
  }, []);

  // Trim Measure: nudge an existing auto-measure corner by (dx, dy). Reuses
  // the already-displayed yellow corners — does NOT add a separate overlay.
  // No-op when there is no committed auto-measure result (nothing to trim).
  const handleTrimAdjust = useCallback(
    (corner: 'top' | 'right' | 'bottom' | 'left', dx: number, dy: number) => {
      setCommittedAutoMeasureOverlay((prev) => {
        if (!prev) {
          // eslint-disable-next-line no-console
          console.log('[trim-measure-overlay] no auto-measure corners to move — skipped');
          return prev;
        }
        const current = prev.corners[corner];
        const next = { x: current.x + dx, y: current.y + dy };
        const nextCorners = { ...prev.corners, [corner]: next };
        const lineKey: 'topY' | 'bottomY' | 'leftX' | 'rightX' =
          corner === 'top'
            ? 'topY'
            : corner === 'bottom'
              ? 'bottomY'
              : corner === 'left'
                ? 'leftX'
                : 'rightX';
        const lineValue = corner === 'left' || corner === 'right' ? next.x : next.y;
        // eslint-disable-next-line no-console
        console.log(`[trim-measure-overlay] move existingLine=${lineKey} value=${lineValue}`);
        return { ...prev, corners: nextCorners };
      });
    },
    []
  );

  const buildSharedCtx = useCallback(
    (): ToolDispatchContext => ({
      setActiveTool,
      setStatus: (message) => setStatusMessage(`System Status: ${message}`),
      notifyUnavailable: (label) =>
        setUnavailableMsg(`${label} is not available yet.`),
      clearGraphics: () => {
        overlay.clearAll();
        // eslint-disable-next-line no-console
        console.log('[auto-overlay-clear] reason=clear-graphics');
        // eslint-disable-next-line no-console
        console.log('[overlay] cleared reason=clear-graphics');
        // eslint-disable-next-line no-console
        console.log('[auto-measure][cancel] reason=clear-graphics');
        setCommittedAutoMeasureOverlay(null);
        setPreviewAutoMeasureOverlay(null);
        autoMeasurePreviewSnapshotRef.current = null;
        committedAutoMeasureFrameRef.current = null;
        previewMeasurementRef.current = null;
        autoMeasurementIdRef.current = null;
        resetManualMeasure();
      },
      autoMeasure: handleAutoMeasure,
      setLineThickness: lineThickness.setThickness,
      toggleMagnifier: () => {
        setMagnifierEnabled((prev) => {
          const next = !prev;
          // eslint-disable-next-line no-console
          if (next) {
            // eslint-disable-next-line no-console
            console.log(`[magnifier-open] mode=${activeTool}`);
          } else {
            // eslint-disable-next-line no-console
            console.log('[magnifier-close] reason=toggle-off');
          }
          return next;
        });
      },
      trimLastMeasurement: overlay.trimLast,
      openTrimMeasure: () => setTrimMeasureOpen(true),
      toggleCenterCrossLine: overlay.toggleCrossLine,
      resumeImage: () => {
        const nowFrozen = cameraRef.current?.toggleFreeze() ?? false;
        setStatusMessage(`System Status: Image ${nowFrozen ? 'frozen' : 'resumed'}`);
      },
      zoomIn: () => {
        const z = cameraRef.current?.zoomIn() ?? 1;
        setStatusMessage(`System Status: Zoom ${Math.round(z * 100)}%`);
      },
      zoomOut: () => {
        const z = cameraRef.current?.zoomOut() ?? 1;
        setStatusMessage(`System Status: Zoom ${Math.round(z * 100)}%`);
      },
      openImage: () => {
        void (async () => {
          try {
            // eslint-disable-next-line no-console
            console.log('[ipc] dialog:openImage →');
            const reply = await openImageDialog();
            // eslint-disable-next-line no-console
            console.log('[ipc] dialog:openImage ←', { ok: reply.ok });
            if (!reply.ok) {
              if (!reply.canceled) {
                setUnavailableMsg(
                  `Open Image failed: ${reply.error}${reply.message ? `: ${reply.message}` : ''}`
                );
              }
              return;
            }
            const loaded = await cameraRef.current?.loadImageFromBuffer(reply.buffer);
            if (loaded?.ok) {
              resetManualMeasure();
              // eslint-disable-next-line no-console
              console.log('[overlay] cleared reason=new-image');
              setCommittedAutoMeasureOverlay(null);
              setPreviewAutoMeasureOverlay(null);
              autoMeasurePreviewSnapshotRef.current = null;
              committedAutoMeasureFrameRef.current = null;
              previewMeasurementRef.current = null;
              autoMeasurementIdRef.current = null;
              committedFingerprintsRef.current = [];
              // eslint-disable-next-line no-console
              console.log('[measurement-session-reset] reason=new-image');
              setStatusMessage(`System Status: Loaded ${reply.fileName}`);
            } else {
              setUnavailableMsg(
                `Open Image failed: ${loaded?.error ?? 'unable to render'}`
              );
            }
          } catch (err) {
            setUnavailableMsg(
              `Open Image failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })();
      },
      saveImage: () => {
        void (async () => {
          try {
            // eslint-disable-next-line no-console
            console.log('[ipc] dialog:saveImage →');
            const reply = await saveImageDialog({
              defaultName: `hardness-${Date.now()}.png`,
            });
            // eslint-disable-next-line no-console
            console.log('[ipc] dialog:saveImage ←', { ok: reply.ok });
            if (!reply.ok) return;
            const blob = await cameraRef.current?.exportImageBlob('image/png');
            if (!blob) {
              setUnavailableMsg('Save Image failed: no image to save');
              return;
            }
            const buf = await blob.arrayBuffer();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
            a.download = reply.fileName;
            a.click();
            URL.revokeObjectURL(a.href);
            setStatusMessage(`System Status: Image saved as ${reply.fileName}`);
          } catch (err) {
            setUnavailableMsg(
              `Save Image failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })();
      },
      openCameraDevice: () => {
        void (async () => {
          try {
            // eslint-disable-next-line no-console
            console.log('[camera-open] requested');
            // Reset per-session log flags so the next first-frame / first-paint
            // events log again after a close→open cycle.
            resetCameraSession();
            // Reload calibration list from SQLite so a saved 40X (or any other
            // objective) calibration is picked up after a camera close/open —
            // without this, calibrationSettingsList stays at whatever was
            // fetched on app mount and Auto Measure can't find the calibration.
            // eslint-disable-next-line no-console
            console.log('[camera-open] reloadCalibration=true');
            try {
              await refetchCalibrationSettings();
            } catch {
              /* non-fatal — calibration-confirm path will retry */
            }
            // eslint-disable-next-line no-console
            console.log('[ipc] device:open →');
            setCameraStatus('opening');
            const reply = await window.hardnessCamera.openDevice({ index: 0 });
            // eslint-disable-next-line no-console
            console.log('[ipc] device:open ←', reply);
            // eslint-disable-next-line no-console
            console.log(`[camera-open] connected ok=${!!reply.camera.connected}`);
            // eslint-disable-next-line no-console
            console.log(`[camera-open] stream-started ok=${!!reply.camera.streaming}`);
            await cameraRef.current?.refetchStatus();
            if (!reply.camera.connected) {
              setCameraStatus('error');
              setUnavailableMsg(
                `Open Camera failed: ${reply.camera.error ?? reply.camera.message ?? 'unknown error'}`
              );
              return;
            }
            setCameraStatus('connected');
            if (!reply.camera.streaming) {
              setCameraStatus('error');
              setUnavailableMsg(
                `Start Stream failed: ${reply.camera.error ?? reply.camera.message ?? 'unknown error'}`
              );
              return;
            }
            setCameraStatus('streaming');
            setStatusMessage('System Status: Camera streaming');
            // Stale overlays from a previous camera session must not paint
            // over the new live stream.
            clearAutoMeasureOverlay('camera-open');
            resetManualMeasure();
            setCameraOpen(true);
            // eslint-disable-next-line no-console
            console.log('[camera-open] noAutoMeasure=true');

            // Apply previously-saved camera settings (exposure / analog gain)
            // to the SDK now that the handle is valid. Without this, every app
            // restart resets the live image to the SDK's hardware defaults.
            // Read fresh from the API to avoid the stale-closure value of
            // `savedCameraSetting`; also keep the React-side cache in sync.
            try {
              const items = await getCameraSetting();
              const saved =
                items.length > 0
                  ? [...items].sort(
                      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
                    )[0]
                  : null;
              // eslint-disable-next-line no-console
              console.log('[camera-settings] loaded saved settings', saved);
              if (saved) {
                // eslint-disable-next-line no-console
                console.log('[camera-settings] applying saved settings on camera open', {
                  analogGain: saved.analogGain,
                  exposureTimeMs: saved.exposureTimeMs,
                  updatedAt: saved.updatedAt,
                });
                try {
                  dropPendingCameraFrames('gain-change');
                  const gainReply = await window.hardnessCamera.setGain(saved.analogGain);
                  // eslint-disable-next-line no-console
                  console.log('[camera-settings] apply analogGain ok=', !!gainReply?.ok, gainReply);
                } catch (gainErr) {
                  // eslint-disable-next-line no-console
                  console.error('[camera-settings] apply analogGain threw', gainErr);
                }
                try {
                  dropPendingCameraFrames('exposure-change');
                  const expReply = await window.hardnessCamera.setExposure(saved.exposureTimeMs);
                  // eslint-disable-next-line no-console
                  console.log('[camera-settings] apply exposure ok=', !!expReply?.ok, expReply);
                } catch (expErr) {
                  // eslint-disable-next-line no-console
                  console.error('[camera-settings] apply exposure threw', expErr);
                }
              } else {
                // eslint-disable-next-line no-console
                console.log('[camera-settings] no saved settings found — SDK defaults retained');
              }
            } catch (loadErr) {
              // eslint-disable-next-line no-console
              console.warn('[camera-settings] failed to load saved settings', loadErr);
            }
            // Sync the React-side cache so the dialog opens with the right values.
            try {
              await refetchCameraSetting();
            } catch {
              /* non-fatal */
            }

            // Surface micrometer outcome (COM3 open is performed inside the
            // device:open main handler — never on app startup).
            if (reply.micrometer) {
              if (reply.micrometer.connected) {
                setStatusMessage(
                  `System Status: Micrometer connected on ${reply.micrometer.port}`
                );
              } else {
                setUnavailableMsg(
                  `Micrometer (${reply.micrometer.port}) failed: ${
                    reply.micrometer.error ?? reply.micrometer.message ?? 'unknown error'
                  }`
                );
              }
            }

            // Best-effort: also open the hardness machine COM port. Defaults
            // to COM7 (the wired-in port for this machine) if the user hasn't
            // configured one via Serial Port settings. Failure here must NOT
            // break the camera/micrometer flow.
            // Hardness machine is wired to COM7 on this PC. The
            // serial-port-setting record's mainPortName is used by the XYZ
            // platform / micrometer flow, not the machine, so we do NOT read
            // from it here. If the COM port ever changes, update this literal.
            const machinePort = 'COM7';
            void serialPortSetting;
            try {
              // eslint-disable-next-line no-console
              console.log('[machine-main] connect requested', machinePort);
              await connectMachineFn({ port: machinePort });
              setStatusMessage(`System Status: Machine connected on ${machinePort}`);
            } catch (mErr) {
              // eslint-disable-next-line no-console
              console.warn('[machine-main] connect failed:', mErr);
              const detail = getApiErrorMessage(mErr, 'unknown error');
              setUnavailableMsg(`Machine connect failed on ${machinePort}: ${detail}`);
            }
          } catch (err) {
            setUnavailableMsg(
              `Open Device failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })();
      },
      closeCameraDevice: () => {
        void (async () => {
          try {
            // eslint-disable-next-line no-console
            console.log('[camera-close] requested');
            // eslint-disable-next-line no-console
            console.log('[camera-close]');
            // Drop all Auto Measure overlay state synchronously, BEFORE the
            // IPC round-trip. The render gate at App.tsx:`displayedAutoMeasure
            // Graphics` is `cameraOpen ? raw : null` — flipping cameraOpen
            // false here means the AutoMeasureOverlay re-renders with null
            // graphics on the next paint, so the 4 yellow lines and corner
            // dots clear immediately instead of lingering through the IPC.
            // Also covers the catch path: if device:close throws, the user
            // still sees an empty viewport.
            setCameraOpen(false);
            setCameraStatus('closed');
            setAutoMeasureStatus('idle');
            setCommittedAutoMeasureOverlay(null);
            setPreviewAutoMeasureOverlay(null);
            autoMeasurePreviewSnapshotRef.current = null;
            committedAutoMeasureFrameRef.current = null;
            previewMeasurementRef.current = null;
            autoMeasurementIdRef.current = null;
            committedFingerprintsRef.current = [];
            // Cancel any pending coalesced trailing detection. The in-flight
            // finally block re-reads this ref; clearing it stops the queued
            // re-run from firing onto a closed camera.
            autoMeasurePendingPreviewRef.current = null;
            autoMeasureSettingsOpenRef.current = false;
            // End the strict session — no overlay can paint until the next
            // Auto Measure click on a reopened camera.
            setAutoMeasureSessionActive(false);
            setAutoMeasureCapturedFrameId(null);
            setAutoMeasureSessionId((id) => {
              const next = id + 1;
              autoMeasureSessionIdRef.current = next;
              return next;
            });
            // eslint-disable-next-line no-console
            console.log('[auto-measure-timer-cancelled]');
            // eslint-disable-next-line no-console
            console.log('[auto-measure-clear-on-camera-close]');
            // eslint-disable-next-line no-console
            console.log('[overlay-hidden-camera-closed]');
            // eslint-disable-next-line no-console
            console.log('[ipc] device:close →');
            const reply = await window.hardnessCamera.closeDevice();
            // eslint-disable-next-line no-console
            console.log('[ipc] device:close ←', reply);
            // eslint-disable-next-line no-console
            console.log(`[camera-close] stream-stopped ok=${!!(reply && (reply as { ok?: boolean }).ok !== false)}`);
            // Always sync status + clear live canvas, freeze canvas and any
            // overlay that belongs to the live camera frame so the viewport
            // actually appears empty after close.
            await cameraRef.current?.refetchStatus();
            cameraRef.current?.clearLiveImage();
            setCameraOpen(false);
            setCommittedAutoMeasureOverlay(null);
            setPreviewAutoMeasureOverlay(null);
            autoMeasurePreviewSnapshotRef.current = null;
            committedAutoMeasureFrameRef.current = null;
            previewMeasurementRef.current = null;
            autoMeasurementIdRef.current = null;
            committedFingerprintsRef.current = [];
            // eslint-disable-next-line no-console
            console.log('[overlay-clear] reason=camera-close');
            // eslint-disable-next-line no-console
            console.log('[overlay-clear] reason=device-closed');
            // eslint-disable-next-line no-console
            console.log('[measurement-session-reset] reason=camera-reopen');
            resetManualMeasure();
            // Drop the active measure mode so the manual-measure overlay
            // hook stops re-creating default yellow guides on the cleared
            // canvas. Without this, bumping the reset key only clears once —
            // the next effect re-initializes guides because active stays true
            // and imageSize is still cached.
            setActiveTool('pointer');
            // eslint-disable-next-line no-console
            console.log('[measure-mode-clear] reason=camera-close');
            // eslint-disable-next-line no-console
            console.log('[overlay-visibility] visible=false reason=idle');
            // eslint-disable-next-line no-console
            console.log('[overlay-visible] false reason=idle');
            // Reset per-session log flags so the next open re-fires
            // [camera-frame] first-frame-after-open and the paint log.
            resetCameraSession();
            // Drop the last-synced objective so re-confirming the SAME
            // objective after reopen re-runs the calibration sync effect
            // (otherwise the equality guard early-returns and Auto Measure
            // sees a stale calibration view).
            lastSyncedObjectiveRef.current = null;
            // eslint-disable-next-line no-console
            console.log('[camera-close] canvas-cleared=true frameCleared=true overlayCleared=true');
            setStatusMessage('System Status: Device closed');
            void reply;

            // Best-effort machine disconnect — never block close flow.
            try {
              await disconnectMachineFn();
            } catch (mErr) {
              // eslint-disable-next-line no-console
              console.warn('[machine-main] disconnect failed:', mErr);
            }
          } catch (err) {
            setUnavailableMsg(
              `Close Device failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })();
      },
    }),
    [
      activeTool,
      lineThickness.setThickness,
      overlay.clearAll,
      overlay.trimLast,
      overlay.toggleCrossLine,
      resetManualMeasure,
      clearAutoMeasureOverlay,
      handleAutoMeasure,
      setActiveTool,
      serialPortSetting,
      connectMachineFn,
      disconnectMachineFn,
      refetchCameraSetting,
      refetchCalibrationSettings,
    ]
  );

  const testRecordMeasurementIds = useMemo(() => {
    if (initialTestRecordMeasurementIds.length > 0) {
      return initialTestRecordMeasurementIds;
    }

    return measurements.map((measurement) => measurement.id);
  }, [initialTestRecordMeasurementIds, measurements]);

  const closeDialog = useCallback(() => {
    setActiveDialog(null);
    setInitialTestRecordMeasurementIds([]);
  }, []);

  const openConfigDialog = useCallback((id: ConfigDialogId) => {
    const map: Record<ConfigDialogId, DialogKey> = {
      'config:lineColor': 'lineColor',
      'config:calibration': 'calibration',
      'config:autoMeasure': 'autoMeasure',
      'config:serialPort': 'serialPort',
      'config:camera': 'camera',
      'config:generic': 'generic',
      'config:other': 'other',
      'config:restoreFactory': 'restoreFactory',
    };
    setActiveDialog(map[id]);
  }, []);

  const handleMenuSelect = useCallback(
    (action: MenuActionId) => {
      dispatchMenuAction(action, {
        ...buildSharedCtx(),
        openConfigDialog,
        openSampleInfo: () => {
          setInitialTestRecordMeasurementIds([]);
          setActiveDialog('testRecords');
        },
        exitApplication: () => setExitConfirmOpen(true),
      });
    },
    [buildSharedCtx, openConfigDialog]
  );

  const handleToolbarSelect = useCallback(
    (action: ToolbarActionId) => {
      const enteringMagnifier = action === 'tools:magnifier';
      const mappedTool = TOOL_ACTION_TO_TOOL[action];

      // Manual Measure must clear any active Auto Measure overlay/session so
      // the two modes are mutually exclusive (only one set of yellow lines /
      // crosshair on screen at a time).
      if (action === 'tools:manualMeasure') {
        // eslint-disable-next-line no-console
        console.log('[measure-mode-change] mode=manual');
        if (committedAutoMeasureOverlay || previewAutoMeasureOverlay) {
          // eslint-disable-next-line no-console
          console.log('[measure-mode-clear] reason=switch-mode prev=auto');
          clearAutoMeasureOverlay('manual-mode-switch');
        }
        // eslint-disable-next-line no-console
        console.log('[manual-measure-start]');
      }
      // eslint-disable-next-line no-console
      console.log(
        `[toolbar] selected tool=${mappedTool ?? action} magnifier=${enteringMagnifier}`
      );
      // eslint-disable-next-line no-console
      console.log(`[toolbar-tool-change] from=${activeTool} to=${mappedTool ?? action}`);

      // Drawing tools (Measure Length / Measure Angle) leave persistent
      // shapes. When the user switches AWAY to another tool, drop those
      // shapes so the camera window doesn't carry stale measurement lines
      // into the next mode.
      if (activeTool === 'measureLength' && mappedTool !== 'measureLength') {
        // eslint-disable-next-line no-console
        console.log('[measure-length-reset] reason=tool-switch');
        overlay.clearByKind('length');
      }
      if (activeTool === 'measureAngle' && mappedTool !== 'measureAngle') {
        overlay.clearByKind('angle');
      }

      // Magnifier is now an overlay toggle (handled in dispatcher via
      // toggleMagnifier). When the user switches to a tool other than
      // Manual Measure, force the magnifier off so it does not bleed into
      // Pointer/Auto Measure/calibration.
      if (!enteringMagnifier && magnifierEnabled && action !== 'tools:manualMeasure') {
        // eslint-disable-next-line no-console
        console.log('[magnifier-close] reason=tool-switch');
        setMagnifierEnabled(false);
      }

      dispatchToolbarAction(action, buildSharedCtx());
      void (async () => {
        try {
          await saveToolbarState({
            id: toolbarState?.id,
            values: { lastAction: action },
          });
          await refetchToolbarState();
        } catch {
          // error surfaces via useSaveToolbarState's own error state
        }
      })();
    },
    [
      activeTool,
      buildSharedCtx,
      clearAutoMeasureOverlay,
      committedAutoMeasureOverlay,
      magnifierEnabled,
      overlay,
      previewAutoMeasureOverlay,
      refetchToolbarState,
      saveToolbarState,
      setActiveTool,
      toolbarState?.id,
    ]
  );


  useEffect(() => {
    const hex = LINE_COLOR_HEX[lineColorSetting?.lineColor ?? DEFAULT_LINE_COLOR];
    document.documentElement.style.setProperty('--line-color', hex);
  }, [lineColorSetting?.lineColor]);

  useEffect(() => {
    if (toolbarStateLoading || restoredToolbarActionRef.current) {
      return;
    }

    restoredToolbarActionRef.current = true;

    if (toolbarStateError) {
      setStatusMessage(`System Status: ${toolbarStateError}`);
      return;
    }

    if (toolbarState) {
      setStatusMessage(`System Status: Last toolbar action: ${toolbarState.lastAction}`);
    }
  }, [toolbarState, toolbarStateError, toolbarStateLoading]);

  const handleOpenTestRecords = useCallback((measurementIds: string[]) => {
    setInitialTestRecordMeasurementIds(measurementIds);
    setActiveDialog('testRecords');
    setStatusMessage('System Status: Test Records opened');
  }, []);

  const handleMeasurementsCleared = useCallback(() => {
    committedFingerprintsRef.current = [];
    autoMeasurementIdRef.current = null;
    // eslint-disable-next-line no-console
    console.log('[measurement-session-reset] reason=clear-table');
  }, []);

  return (
    <Box sx={ROOT_SX}>
      <MenuBar onSelect={handleMenuSelect} />
      <Toolbar onSelect={handleToolbarSelect} />

      <Box sx={WORKSPACE_SX}>
        <LeftPanel
          ref={cameraRef}
          activeTool={activeTool}
          overlayShapes={overlay.shapes}
          autoMeasureGraphics={displayedAutoMeasureGraphics}
          autoMeasureClearNonce={autoMeasureClearNonce}
          autoMeasureGraphicsSource={displayedAutoMeasureSource}
          crossLineVisible={overlay.crossLineVisible}
          onAddShape={overlay.addShape}
          manualMeasureResetKey={manualMeasureResetKey}
          manualMeasureObjective={activeObjective}
          objectiveRefreshKey={objectiveRefreshKey}
          onManualMeasurementUpdated={handleManualMeasurementUpdated}
          onAutoMeasureAdjusted={handleAutoMeasureAdjusted}
          magnifierEnabled={magnifierEnabled}
          onClearShapeKind={overlay.clearByKind}
          lineStrokeWidth={lineThickness.strokeWidth}
        />
        <RightPanel
          measurements={measurements}
          measurementsError={measurementsError}
          measurementsLoading={measurementsLoading}
          refetchMeasurements={refetchMeasurements}
          onOpenTestRecords={handleOpenTestRecords}
          onMeasurementsCleared={handleMeasurementsCleared}
          onObjectiveChange={handleObjectiveChangeFromUI}
          trimMeasureOpen={trimMeasureOpen}
          onCloseTrimMeasure={() => setTrimMeasureOpen(false)}
          onTrimAdjust={handleTrimAdjust}
          calibrationActive={activeDialog === 'calibration'}
          calibrationSlot={
            <CalibrationDialog
              open={activeDialog === 'calibration'}
              onClose={() => {
                if (calibrationManualModeRef.current) {
                  calibrationManualModeRef.current = false;
                  // eslint-disable-next-line no-console
                  console.log('[calibration-manual-mode-cleared] reason=panel-closed-by-user');
                }
                closeDialog();
              }}
              onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
              onChanged={() => {
                void refetchCalibrations();
              }}
              autoFillPixelLengthX={latestManualPixels?.d1Px ?? null}
              autoFillPixelLengthY={latestManualPixels?.d2Px ?? null}
              defaultObjective={
                liveMachineState?.confirmedObjectiveFromMachine?.trim() ||
                activeObjective ||
                null
              }
              onRequestAutoMeasure={handleCalibrationAutoMeasure}
              onRequestManualMeasure={handleCalibrationManualMeasure}
              onAutoCreateMeasurementRow={handleCalibrationAutoCreateRow}
            />
          }
        />
      </Box>

      <StatusBar
        message={statusMessage}
        cameraStatus={cameraStatus}
        objective={activeObjective}
        autoMeasureStatus={autoMeasureStatus}
      />

      <AutoMeasureSettingsDialog
        open={activeDialog === 'autoMeasure'}
        onClose={closeDialog}
        onPreviewChange={handleAutoMeasureSettingsPreviewChange}
        onSaved={handleAutoMeasureSettingsSaved}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
        activeObjective={activeObjective}
      />
      <LineColorSettingDialog
        open={activeDialog === 'lineColor'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
        onSaved={() => {
          void refetchLineColor();
        }}
      />
      <SerialPortSettingDialog
        open={activeDialog === 'serialPort'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
      <CameraSettingDialog
        open={activeDialog === 'camera'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
      <GenericSettingDialog
        open={activeDialog === 'generic'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
      <OtherSettingDialog
        open={activeDialog === 'other'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
      <RestoreFactoryDialog
        open={activeDialog === 'restoreFactory'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
        onRestored={() => {
          void refetchLineColor();
          void refetchMeasurements();
          void refetchToolbarState();
        }}
      />
      <Dialog
        open={exitConfirmOpen}
        onClose={() => setExitConfirmOpen(false)}
      >
        <DialogTitle>Exit Hardness Tester?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Any unsaved measurements will be lost. Continue?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <MuiButton onClick={() => setExitConfirmOpen(false)}>Cancel</MuiButton>
          <MuiButton
            color="error"
            variant="contained"
            onClick={() => {
              // eslint-disable-next-line no-console
              console.log('[ipc] app:exit →');
              void exitApp().catch((err) => {
                setExitConfirmOpen(false);
                setUnavailableMsg(
                  `Exit failed: ${err instanceof Error ? err.message : String(err)}`
                );
              });
            }}
          >
            Exit
          </MuiButton>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={unavailableMsg !== null}
        autoHideDuration={unavailableMsg?.startsWith('Calibration not found') ? null : 3000}
        onClose={() => setUnavailableMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="warning"
          variant="filled"
          onClose={() => setUnavailableMsg(null)}
          action={
            unavailableMsg?.startsWith('Calibration not found') ? (
              <MuiButton
                color="inherit"
                size="small"
                onClick={() => {
                  setUnavailableMsg(null);
                  setActiveDialog('calibration');
                }}
              >
                Go to Calibration
              </MuiButton>
            ) : undefined
          }
          sx={{ width: '100%' }}
        >
          {unavailableMsg}
        </Alert>
      </Snackbar>

      <TestRecordsDialog
        open={activeDialog === 'testRecords'}
        onClose={closeDialog}
        measurements={measurements}
        initialMeasurementIds={testRecordMeasurementIds}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />

    </Box>
  );
}

export default App;
