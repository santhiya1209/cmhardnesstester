import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import AutoMeasureSettingsDialog from '@/component/own/AutoMeasureSettingsDialog';
import CalibrationDialog from '@/component/own/CalibrationDialog';
import CameraSettingDialog from '@/component/own/CameraSettingDialog';
import LineColorSettingDialog from '@/component/own/LineColorSettingDialog';
import MicrometerConfigDialog from '@/component/own/MicrometerConfigDialog';
import GenericSettingDialog from '@/component/own/GenericSettingDialog';
import OtherSettingDialog from '@/component/own/OtherSettingDialog';
import RestoreFactoryDialog from '@/component/own/RestoreFactoryDialog';
import SerialPortSettingDialog from '@/component/own/SerialPortSettingDialog';
import { useLineColorSetting } from '@/hooks/queries/useLineColorSetting';
import { useCalibrationSettings } from '@/hooks/queries/useCalibrationSettings';
import { useCalibrations } from '@/hooks/queries/useCalibrations';
import { useAutoMeasureSettings } from '@/hooks/queries/useAutoMeasureSettings';
import { useMicrometerConfig } from '@/hooks/queries/useMicrometerConfig';
import { useTestRecords } from '@/hooks/queries/useTestRecords';
import { useCameraSetting } from '@/hooks/queries/useCameraSetting';
import { useMachineStateSnapshot } from '@/hooks/queries/useMachineStateSnapshot';
import { useMachineState } from '@/hooks/queries/useMachineState';
import { useSaveMeasurement } from '@/hooks/mutations/useSaveMeasurement';
import { useMachineConnection } from '@/hooks/useMachineConnection';
import { getLatestMicrometerReading } from '@/api/micrometer';
import { measureVickersAuto, measureVickersAutoPreview } from '@/api/system';
import { getCameraSetting } from '@/api/camera';
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
  getLastPaintEpoch,
  getLastPaintedFrameId,
  dropPendingCameraFrames,
  resetCameraSession,
} from '@/hooks/useCameraStream';
import { useImageOverlay } from '@/hooks/useImageOverlay';
import { useLineThickness } from '@/hooks/useLineThickness';
import { listSerialPorts } from '@/api/serialPort';
import { openImageDialog } from '@/api/system';
import { saveImageDialog } from '@/api/system';
import { exitApp } from '@/api/system';
import { dispatchToolbarAction, type ToolDispatchContext } from '@/utils/toolDispatcher';
import { dispatchMenuAction } from '@/utils/menuDispatcher';
import { useSetStatusMessage } from '@/contexts/StatusMessageContext';
import { useDialog, type DialogKey } from '@/contexts/DialogContext';
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
    return resolved;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[micrometer-depth-before-row] value=null error=${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

type DepthSavePayload = {
  depthMm: number | null;
  depthSource: 'device' | 'manual';
  deviceDepthMm: number | null;
  manualDepthMm: number | null;
};

// Captures the depth snapshot to save on a NEW measurement row. Enabled =
// freeze the live micrometer reading into deviceDepthMm + depthMm with
// source='device'. Disabled = leave depth fields null with source='manual'
// so the operator can type the value into the table afterward. Callers MUST
// only invoke this for new rows; existing rows are preserved via the
// `{}`-spread path so saved depth never gets clobbered by a re-detect.
async function buildNewRowDepthPayload(
  micrometerEnabled: boolean
): Promise<DepthSavePayload> {
  if (micrometerEnabled) {
    const deviceValue = await readLatestMicrometerDepthMm();
    return {
      depthMm: deviceValue,
      depthSource: 'device',
      deviceDepthMm: deviceValue,
      manualDepthMm: null,
    };
  }
  return {
    depthMm: null,
    depthSource: 'manual',
    deviceDepthMm: null,
    manualDepthMm: null,
  };
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
  frameId: number | null;
  centerX: number;
  centerY: number;
  d1Px: number;
  d2Px: number;
  hv: number | null;
  d1Um: number | null;
  d2Um: number | null;
  avgDUm: number | null;
  avgDMm: number | null;
  rowId: string | null;
  fingerprintKey: string;
  corners: AutoMeasureGraphics['corners'];
  graphics: AutoMeasureGraphics;
};

type AutoMeasureCallSource = 'auto-click' | 'settings-preview' | 'settings-save' | 'after-impress';

type CapturedAutoMeasureFrame = Extract<
  ReturnType<CameraWindowHandle['captureDisplayedFrame']>,
  { ok: true }
>;

type RunAutoMeasure = (
  settingsInput: AutoMeasureSettingsPayload,
  preview?: boolean,
  source?: AutoMeasureCallSource
) => Promise<boolean>;

type CommitAutoMeasureSource = 'auto-click' | 'settings-save' | 'after-impress';

function logUnexpectedAutoMeasureCall(source: string) {
  if (
    source === 'auto-click' ||
    source === 'settings-preview' ||
    source === 'settings-save' ||
    source === 'after-impress'
  ) {
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[auto-measure-unexpected-call] source=${source} stack=${new Error().stack ?? 'unavailable'}`
  );
}

function logAfterImpressDetectionFailed(reason: string) {
  // eslint-disable-next-line no-console
  console.warn(`[after-impress-detection-failed] reason=${reason}`);
}

const AUTO_MEASURE_CENTER_TOLERANCE_PX = 3;
const AUTO_MEASURE_DIAGONAL_TOLERANCE_PX = 3;
const AUTO_MEASURE_CORNER_TOLERANCE_PX = 4;
const AUTO_MEASURE_HARDNESS_TOLERANCE_HV = 10;
const AUTO_MEASURE_STABLE_PIXEL_DIGITS = 2;
const AUTO_MEASURE_CORNER_KEYS = ['top', 'right', 'bottom', 'left'] as const;

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

function roundAutoMeasurePixel(value: number): number {
  return Number(value.toFixed(AUTO_MEASURE_STABLE_PIXEL_DIGITS));
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getAutoMeasureMaxCornerDelta(
  a: AutoMeasureGraphics['corners'],
  b: AutoMeasureGraphics['corners']
): number {
  return AUTO_MEASURE_CORNER_KEYS.reduce((maxDelta, key) => {
    const dx = a[key].x - b[key].x;
    const dy = a[key].y - b[key].y;
    return Math.max(maxDelta, Math.hypot(dx, dy));
  }, 0);
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

function cloneCapturedFrame(frame: CapturedAutoMeasureFrame): CapturedAutoMeasureFrame {
  return {
    ...frame,
    buffer: frame.buffer.slice(0),
  };
}

function finitePoint(point: { x: number; y: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function logAutoMeasurePhase(_phase: string, _context: AutoMeasureLogContext): void {
  // no-op (logging stripped)
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function App() {
  // statusMessage lives in StatusMessageContext so App does not re-render on
  // every status update. setStatusMessage from the context is referentially
  // stable, so consuming it here costs nothing.
  const setStatusMessage = useSetStatusMessage();
  // Dialog state lives in DialogContext. App still reads activeDialog (since
  // it renders every dialog conditionally), so re-renders on dialog change
  // are unchanged; the win here is shrinking App and giving menu/toolbar
  // dispatchers a clean hook to talk to.
  const {
    activeDialog,
    setActiveDialog,
    exitConfirmOpen,
    setExitConfirmOpen,
    trimMeasureOpen,
    setTrimMeasureOpen,
    initialTestRecordMeasurementIds,
    closeDialog,
    openTestRecordsDialog,
  } = useDialog();
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
  const { data: micrometerConfig, refetch: refetchMicrometerConfig } = useMicrometerConfig();
  const micrometerEnabled = micrometerConfig?.enabled ?? true;
  // Latest TestRecord drives the live target HV band used to color HV values
  // across the app (table, top HV display, report). Records are pre-sorted by
  // updatedAt descending in useTestRecords.
  const { data: testRecordsList } = useTestRecords();
  const latestTestRecord = testRecordsList[0] ?? null;
  const targetMinHv =
    typeof latestTestRecord?.targetMinHv === 'number' &&
    Number.isFinite(latestTestRecord.targetMinHv)
      ? latestTestRecord.targetMinHv
      : null;
  const targetMaxHv =
    typeof latestTestRecord?.targetMaxHv === 'number' &&
    Number.isFinite(latestTestRecord.targetMaxHv)
      ? latestTestRecord.targetMaxHv
      : null;
  // Mirror to a ref so async save closures always see the latest value without
  // re-creating callbacks every time the config toggles.
  const micrometerEnabledRef = useRef(micrometerEnabled);
  const lastLoggedMicrometerEnabledRef = useRef<boolean | null>(null);
  useEffect(() => {
    micrometerEnabledRef.current = micrometerEnabled;
    if (lastLoggedMicrometerEnabledRef.current !== micrometerEnabled) {
      lastLoggedMicrometerEnabledRef.current = micrometerEnabled;
      // First emission after the persisted row resolves is a load; subsequent
      // transitions are saves driven by the settings dialog.
    }
  }, [micrometerEnabled]);
  const { refetch: refetchCameraSetting } = useCameraSetting();
  // Machine COM port lifecycle (selection, connect/disconnect, one-shot
  // auto-connect from persisted settings) lives in useMachineConnection so
  // App is not in the business of orchestrating serial reconnects.
  const { currentMachinePort, applyMachinePort } = useMachineConnection();

  const { saveMeasurement: saveManualMeasurement } = useSaveMeasurement();
  const { getSnapshot: getMachineStateSnapshot } = useMachineStateSnapshot();
  // SSE-reactive machine state — same hook MachineControlTab uses, so the
  // value App reads here is the same as the highlighted lens button.
  const { data: liveMachineState } = useMachineState();
  // Mirror to a ref so impress-complete / turret-after-impress closures can
  // snapshot the current machine state without re-firing the effect on every
  // state batch.
  const liveMachineStateRef = useRef(liveMachineState);
  useEffect(() => {
    liveMachineStateRef.current = liveMachineState;
  }, [liveMachineState]);
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
  // Set when an impress completes WITH turretAfterImpress=true. The next
  // confirmed-objective RX (L1OK / L2OK / objective state-update) clears
  // this and, when measureAfterImpress is also true, triggers detection
  // against a fresh post-rotation frame. Without this gate the auto-detect
  // would fire on the FINISH event before the turret has settled.
  const pendingTurretAfterImpressRef = useRef<
    | {
        armedAt: number;
        measureAfterImpress: boolean;
        lastSeenObjectiveRx: string | null;
      }
    | null
  >(null);
  const turretAfterImpressWatchdogRef = useRef<number | null>(null);
  const afterImpressOverlayPreserveUntilRef = useRef(0);
  const preserveAfterImpressOverlay = useCallback((durationMs = 5000) => {
    afterImpressOverlayPreserveUntilRef.current = Math.max(
      afterImpressOverlayPreserveUntilRef.current,
      Date.now() + durationMs
    );
  }, []);
  const shouldPreserveAfterImpressOverlay = useCallback(() => {
    return Date.now() < afterImpressOverlayPreserveUntilRef.current;
  }, []);
  const afterImpressAutoMeasureAttemptRef = useRef(0);
  const afterImpressAutoMeasureRunIdRef = useRef(0);
  const afterImpressAutoMeasureInFlightRef = useRef(false);
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
  // `turretMoving` gates overlay rendering during the click → ACK window.
  // The yellow Auto Measure / Manual Measure / Calibration overlays must
  // disappear the instant a turret or objective button is pressed, BEFORE
  // the motion completes, so the operator never sees stale yellow lines
  // floating on top of the camera image as the turret rotates. A watchdog
  // (declared further below) releases the gate after 4 s if no machine RX
  // arrives, so a dropped ACK can never permanently suppress overlay
  // rendering.
  const [turretMoving, setTurretMoving] = useState(false);
  // Target objective for an in-progress turret move ("10X" / "40X").
  // Surfaced in the CameraWindow "Turret moving to X..." popup so the
  // operator knows exactly what the camera is switching to.
  const [turretMovingTarget, setTurretMovingTarget] = useState<string | null>(null);
  const [autoMeasurePreviewSettings, setAutoMeasurePreviewSettings] =
    useState<AutoMeasureSettingsPayload>(DEFAULT_AUTO_MEASURE_SETTINGS);
  const rawDisplayedAutoMeasureGraphics =
    activeDialog === 'autoMeasure'
      ? previewAutoMeasureOverlay ?? committedAutoMeasureOverlay
      : committedAutoMeasureOverlay;
  // Suppress overlay output entirely while the turret/objective is moving.
  // The state-clear in markTurretIntent already nulls the underlying
  // overlays, but a stale render (or an in-flight detection result landing
  // mid-motion) must not paint a yellow line on top of the moving image.
  const turretMovingGuardedGraphics = turretMoving ? null : rawDisplayedAutoMeasureGraphics;
  const displayedAutoMeasureSource: 'auto' | 'preview' | 'save' =
    activeDialog === 'autoMeasure' && previewAutoMeasureOverlay ? 'preview' : 'auto';
  const displayedAutoMeasureGraphicsRef = useRef<AutoMeasureGraphics | null>(null);
  const autoMeasurementIdRef = useRef<string | null>(null);
  // Frame-anchored active measurement: the single row currently "owned" by
  // the frozen frame the user is interacting with. Auto Measure, Manual
  // Measure, line drag, and Calibration all consult this so they update the
  // same row instead of creating duplicates. Cleared on new frame / explicit
  // new measurement boundaries (overlay clear, settings cancel, etc.).
  const activeMeasurementIdRef = useRef<string | null>(null);
  const activeMeasurementFrameIdRef = useRef<number | null>(null);
  // Method last written to the active row. Lets us emit honest
  // [measurement-mode-update] old=…new=… logs without re-reading the table.
  const activeMeasurementMethodRef = useRef<string | null>(null);
  // Camera-open scoped measurement session. Bumped on every camera open and
  // cleared on close — its only role is to scope the "one active row per
  // session" rule so we can log session boundaries clearly.
  const cameraMeasurementSessionIdRef = useRef<number>(0);
  // Returns the current active row id, regardless of which live frame is
  // painted. The earlier strict-frame-id gate was buggy: while the user holds
  // a frozen Auto Measure result and opens Calibration, the live camera keeps
  // painting new frame ids, so getLastPaintedFrameId() drifts away from the
  // frame the row was tagged with — and reuse fell through to POST, creating
  // duplicate rows. The active id is invalidated ONLY by the explicit "new
  // measurement" boundaries below (new image, camera close, clear table,
  // clear-graphics).
  const getActiveMeasurementId = useCallback((): string | undefined => {
    const id = activeMeasurementIdRef.current ?? undefined;
    if (id) {
    }
    return id;
  }, []);
  const setActiveMeasurement = useCallback(
    (id: string, frameId: number | null, _reason: string) => {
      activeMeasurementIdRef.current = id;
      activeMeasurementFrameIdRef.current = frameId;
    },
    []
  );
  const clearActiveMeasurement = useCallback((_reason: string) => {
    if (
      activeMeasurementIdRef.current === null &&
      activeMeasurementFrameIdRef.current === null &&
      activeMeasurementMethodRef.current === null
    ) {
      return;
    }
    activeMeasurementIdRef.current = null;
    activeMeasurementFrameIdRef.current = null;
    activeMeasurementMethodRef.current = null;
  }, []);
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
  const activeObjectiveRef = useRef<string | null>(null);
  useEffect(() => {
    activeObjectiveRef.current = activeObjective;
  }, [activeObjective]);

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
      return next;
    });
  }, []);
  const [autoMeasureStatus, setAutoMeasureStatusState] =
    useState<AutoMeasureStatusState>('idle');
  const setAutoMeasureStatus = useCallback((next: AutoMeasureStatusState) => {
    setAutoMeasureStatusState((prev) => {
      if (prev === next) return prev;
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
    if (turretMoving) {
      return null;
    }
    if (objectiveChangeInProgress) {
      return null;
    }
    if (!turretMovingGuardedGraphics) return null;
    if (!autoMeasureSessionActive) {
      return null;
    }
    const overlayObjective = (turretMovingGuardedGraphics.objective ?? '').trim().toUpperCase();
    const confirmedFromMachine = (liveMachineState?.confirmedObjectiveFromMachine ?? '')
      .trim()
      .toUpperCase();
    const liveObjective = (activeObjective ?? '').trim().toUpperCase();
    const referenceObjective = confirmedFromMachine || liveObjective;
    if (overlayObjective && referenceObjective && overlayObjective !== referenceObjective) {
      return null;
    }
    const overlayFrameId = turretMovingGuardedGraphics.frameId ?? null;
    if (
      overlayFrameId !== null &&
      autoMeasureCapturedFrameId !== null &&
      overlayFrameId !== autoMeasureCapturedFrameId
    ) {
      return null;
    }
    const renderKey = `${overlayObjective || 'unknown'}|${overlayFrameId ?? 'n/a'}`;
    if (lastOverlayRenderLogRef.current !== renderKey) {
      lastOverlayRenderLogRef.current = renderKey;
    }
    return turretMovingGuardedGraphics;
  })();

  // Whenever the active objective changes (UI click OR machine echo), snap
  // Auto Measure smoothing/threshold to that objective's tuned defaults so
  // the Settings dialog and the next detection run pick them up. Also
  // emits the defaults log so we can verify in the console.
  const previousActiveObjectiveRef = useRef<string | null>(null);
  useEffect(() => {
    const defaults = autoMeasureDefaultsForObjective(activeObjective);
    previousActiveObjectiveRef.current = activeObjective;
    if (!defaults) return;
    setAutoMeasurePreviewSettings((prev) => {
      if (prev.smoothing === defaults.smoothing && prev.threshold === defaults.threshold) {
        return prev;
      }
      return { ...prev, smoothing: defaults.smoothing, threshold: defaults.threshold };
    });
    if (shouldPreserveAfterImpressOverlay()) {
      return;
    }
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
  }, [activeObjective, shouldPreserveAfterImpressOverlay]);
  // Last manual-measure pixel diagonals (d1Px = horizontal, d2Px = vertical).
  // Captured in handleManualMeasurementUpdated and passed to CalibrationDialog
  // so opening the dialog auto-fills Pixel Length X / Y. State (not ref) so
  // the dialog re-renders with fresh values when re-opened.
  const [latestManualPixels, setLatestManualPixels] = useState<{
    d1Px: number;
    d2Px: number;
  } | null>(null);
  // Mirror of latestManualPixels for synchronous reads from async callbacks
  // (e.g. the auto-measure preview result handler, which needs to compute a
  // geometry delta vs. the previous pixels without closing over stale state).
  const latestManualPixelsRef = useRef<{ d1Px: number; d2Px: number } | null>(null);
  useEffect(() => {
    latestManualPixelsRef.current = latestManualPixels;
  }, [latestManualPixels]);
  // True while the user is doing a Manual Measure that was launched from the
  // Calibration dialog. handleManualMeasurementUpdated checks this flag so it
  // can suppress measurement-row creation (calibration mode is pixels-only)
  // and the calibration dialog re-opens once the user is done.
  const calibrationManualModeRef = useRef(false);
  // Mutually-exclusive overlay mode for the Calibration panel. Without this
  // the shared AutoMeasureOverlay and ManualMeasureOverlay state could both
  // be populated while Calibration is open — clicking Auto, then Manual,
  // would leave the yellow auto guides visible underneath the manual
  // draggable lines. Updated only from the three calibration entry points
  // (auto click, manual click, dialog close).
  const [calibrationMeasureMode, setCalibrationMeasureModeState] = useState<
    'none' | 'auto' | 'manual'
  >('none');
  const calibrationMeasureModeRef = useRef<'none' | 'auto' | 'manual'>('none');
  const setCalibrationMeasureMode = useCallback(
    (next: 'none' | 'auto' | 'manual', _reason: string) => {
      const prev = calibrationMeasureModeRef.current;
      if (prev === next) return;
      calibrationMeasureModeRef.current = next;
      setCalibrationMeasureModeState(next);
    },
    []
  );
  useEffect(() => {
  }, [calibrationMeasureMode]);
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
  const clearAutoMeasureOverlay = useCallback((_reason: string) => {
    setCommittedAutoMeasureOverlay((prev) => {
      if (!prev) {
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
  }, []);

  const handleObjectiveChangeFromUI = useCallback((objective: '10X' | '40X') => {
    lastObjectiveClickAtRef.current = Date.now();
    const isActualSwitch = (activeObjective ?? '').trim().toUpperCase() !== objective;
    setActiveObjective(objective);
    // Snap Auto Measure smoothing/threshold to the objective-tuned defaults
    // so the Settings dialog and any next preview run use the right values.
    const defaults = autoMeasureDefaultsForObjective(objective);
    if (defaults) {
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
      // Mutually-exclusive calibration overlay: clear any manual state
      // before kicking off auto detection so the two never coexist.
      if (calibrationMeasureModeRef.current === 'manual') {
      }
      calibrationManualModeRef.current = false;
      setManualMeasureResetKey((current) => current + 1);
      setActiveTool('pointer');
      setCalibrationMeasureMode('auto', 'auto-measure-click');
      const camera = cameraRef.current;
      if (!camera) {
        setStatusMessage('System Status: Calibration Auto Measure: camera unavailable');
        return null;
      }
      let frame = camera.captureDisplayedFrame({ freeze: true });
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
      // Detection-parity rule: Calibration Auto Measure MUST use the exact
      // same smoothing/threshold the live Auto Measure uses, so the native
      // detector runs an identical pipeline and selects the same contour on
      // the same indentation. Previously this path applied
      // autoMeasureDefaultsForObjective(...) as an override, which silently
      // diverged from the slider values whenever the user adjusted them or
      // the objective defaults differed (e.g. calibration t=71 vs live t=92).
      // That divergence is what caused the elongated 2.08-sideRatio contour
      // to be picked in calibration while live picked the real diamond.
      const calibSmoothing = settings.smoothing;
      const calibThreshold = settings.threshold;
      // Persist the frozen calibration frame so the Auto Measure Settings
      // preview effect (which re-runs detection through runAutoMeasureRef
      // with callSource='settings-preview') can use the SAME native 2592x1944
      // bgr24 buffer when the user drags Smoothing/Threshold. Without this
      // the settings preview path would fall back to the live camera and
      // diverge from the diamond the user is calibrating against.
      committedAutoMeasureFrameRef.current = cloneCapturedFrame(frame);
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
      {
      }
      if (liveObjectiveForNative === '10X' && hasValidAutoMeasureCorners(result)) {
      }
      return { d1Px: result.d1Pixels, d2Px: result.d2Pixels };
    },
    [autoMeasureSettings, setActiveTool, setCalibrationMeasureMode]
  );

  // Calibration-mode Manual Measure: activates the manual measure tool while
  // keeping the calibration PANEL open (panel layout, not modal). The user
  // drags the cross over the indent on the live image; each drag updates
  // latestManualPixels (and emits [calibration-drag-update]); the panel's
  // live-update effect syncs Pixel Length X / Y in real time. The flag
  // suppresses measurement-row creation so the calibration drag does not
  // pollute the measurement table.
  const handleCalibrationManualMeasure = useCallback(() => {
    // Mutually-exclusive calibration overlay: clear any auto state before
    // entering manual mode so the yellow auto guides disappear immediately.
    if (calibrationMeasureModeRef.current === 'auto') {
    }
    setAutoMeasureSessionActive(false);
    clearAutoMeasureOverlay('switch-to-manual');
    setCalibrationMeasureMode('manual', 'manual-measure-click');
    calibrationManualModeRef.current = true;
    setActiveTool('manualMeasure');
    setStatusMessage(
      'System Status: Calibration Manual Measure active: drag the cross over the indent. Pixel X/Y update live in the panel.'
    );
  }, [clearAutoMeasureOverlay, setActiveTool, setCalibrationMeasureMode]);

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


      let depthMm: number | null = null;
      try {
        depthMm = await readLatestMicrometerDepthMm();
      } catch {
        depthMm = null;
      }
      await waitForOverlayPaint();
      const imageDataUrl = cameraRef.current?.captureThumbnailDataUrl() ?? undefined;

      // Method must reflect the measurement tool the user just operated
      // inside Calibration — not a hardcoded 'Manual'. The auto-measure
      // branch of Calibration trips calibrationMeasureModeRef='auto'; the
      // manual branch trips 'manual'. Fall back to 'Manual' for legacy paths
      // that don't set the ref (e.g. direct-from-pixels with no overlay).
      const calibrationMode = calibrationMeasureModeRef.current;
      const resolvedMethod: 'Auto' | 'Manual' =
        calibrationMode === 'auto' ? 'Auto' : 'Manual';
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
        method: resolvedMethod,
        unit: 'um' as const,
        timestamp: new Date().toISOString(),
        imageDataUrl,
      };


      try {
        const calibrationFrameId = getLastPaintedFrameId();
        const reuseId = getActiveMeasurementId();
        if (reuseId) {
        }
        const saved = await saveManualMeasurement({ id: reuseId, values: rowPayload });
        setActiveMeasurement(saved.id, calibrationFrameId, 'calibration-save');
        manualMeasurementIdRef.current = saved.id;
        autoMeasurementIdRef.current = saved.id;
        const savedMethod = saved.method ?? resolvedMethod;
        activeMeasurementMethodRef.current = savedMethod;
        await refetchMeasurements();
        // Clear yellow Auto/Manual Measure overlays now that the calibration
        // row has been committed. Guarded behind the successful saveManual...
        // path above so a save failure leaves the overlay in place for retry.
        setCommittedAutoMeasureOverlay(null);
        setPreviewAutoMeasureOverlay(null);
        setManualMeasureResetKey((current) => current + 1);
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
      getActiveMeasurementId,
      setActiveMeasurement,
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
  }, [calibrationSettingsList]);

  // um-per-pixel calibration for the currently-active objective. Resolves
  // through the same lookup helpers used by Manual Measure so Measure Length
  // renders the identical calibrated micron conversion instead of raw pixels.
  const umPerPixelForActiveObjective = useMemo<number | null>(() => {
    const confirmedFromMachine =
      liveMachineState?.confirmedObjectiveFromMachine?.trim() || null;
    const optimisticActive = (activeObjective && activeObjective.trim()) || null;
    const lastEchoed = liveMachineState?.objective?.trim() || null;
    const targetObjective = confirmedFromMachine || optimisticActive || lastEchoed;
    if (!targetObjective) return null;
    const calibration = resolveManualCalibration({
      calibrationSettings,
      calibrationSettingsList,
      calibrations,
      machineState: liveMachineState ? { ...liveMachineState, objective: targetObjective } : null,
      targetObjective,
    });
    return calibration?.micronPerPixel ?? null;
  }, [activeObjective, calibrationSettings, calibrationSettingsList, calibrations, liveMachineState]);

  const handleUpdateShape = overlay.updateShape;

  const resetManualMeasure = useCallback(() => {
    manualMeasurementIdRef.current = null;
    setManualMeasureResetKey((current) => current + 1);
  }, []);

  const openCalibrationPanel = useCallback(
    (source: 'menu' | 'toolbar' | 'snackbar' = 'menu') => {
      if (source === 'toolbar') {
      }


      if (activeTool === 'measureLength') {
        overlay.clearByKind('length');
      }

      if (magnifierEnabled) {
        setMagnifierEnabled(false);
      }

      if (activeTool === 'manualMeasure') {
        resetManualMeasure();
      }

      calibrationManualModeRef.current = false;
      setCalibrationMeasureMode('none', 'calibration-open');
      setActiveTool('pointer');
      setActiveDialog('calibration');
    },
    [
      activeTool,
      magnifierEnabled,
      overlay.clearByKind,
      resetManualMeasure,
      setActiveTool,
      setCalibrationMeasureMode,
    ]
  );


  const handleManualMeasurementUpdated = useCallback(
    (result: ManualMeasureDragResult) => {
      // Spec-format drag trace: fires every time the manual overlay emits a
      // new diagonal — i.e. on every handle drag commit. Coordinates are in
      // image-space (the manual overlay already maps client→image).
      void (async () => {
        try {
          const machineState = await getMachineStateSnapshot();
          const timestamp = new Date().toISOString();
          // "New" means there's no row to update — neither the manual id
          // nor the cross-flow active id. Without this, dragging a Manual
          // line after an Auto save re-reads the micrometer and clobbers
          // the existing row's depth.
          const manualPreflightActiveId = getActiveMeasurementId();
          const isNewManualMeasurement =
            manualMeasurementIdRef.current === null && !manualPreflightActiveId;
          const manualDepthCapture: DepthSavePayload | null = isNewManualMeasurement
            ? await buildNewRowDepthPayload(micrometerEnabledRef.current)
            : null;
          const manualExistingRowId =
            manualMeasurementIdRef.current ?? manualPreflightActiveId ?? null;
          const manualExistingRow = manualExistingRowId
            ? measurements.find((m) => m.id === manualExistingRowId) ?? null
            : null;
          // For an updated row (line drag, re-measure) we must echo back the
          // saved depth + conversion fields. The backend's buildUpdateSchema
          // injects null defaults for fields missing from the PUT body, so
          // omitting them would wipe depthMm / depthSource / device + manual
          // depth / convertType / convertValue. New rows freeze the device
          // value (or none, if disabled) via manualDepthCapture.
          const depthPayload = manualDepthCapture
            ? {
                depthMm: manualDepthCapture.depthMm,
                depthSource: manualDepthCapture.depthSource,
                deviceDepthMm: manualDepthCapture.deviceDepthMm,
                manualDepthMm: manualDepthCapture.manualDepthMm,
              }
            : manualExistingRow
              ? {
                  depthMm: manualExistingRow.depthMm ?? null,
                  depthSource: manualExistingRow.depthSource ?? null,
                  deviceDepthMm: manualExistingRow.deviceDepthMm ?? null,
                  manualDepthMm: manualExistingRow.manualDepthMm ?? null,
                  convertType: manualExistingRow.convertType ?? null,
                  convertValue:
                    typeof manualExistingRow.convertValue === 'number'
                      ? manualExistingRow.convertValue
                      : null,
                }
              : {};
          if (isNewManualMeasurement && manualDepthCapture) {
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
          const machineStateForManual = machineState
            ? { ...machineState, objective: targetObjective }
            : null;
          const forceKgf = parseForceKgf(machineState?.force);
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


          await waitForOverlayPaint();
          const imageDataUrl = cameraRef.current?.captureThumbnailDataUrl() ?? undefined;
          if (imageDataUrl) {
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
          const manualFrameId = getLastPaintedFrameId();
          const manualReuseId =
            manualMeasurementIdRef.current ?? getActiveMeasurementId();
          if (manualReuseId && manualMeasurementIdRef.current === null) {
          }
          const saved = await saveManualMeasurement({
            id: manualReuseId ?? undefined,
            values: rowPayload,
          });
          const savedManualMethod = saved.method ?? 'Manual';
          if (isNewManualMeasurement && manualDepthCapture) {
          } else if (!isNewManualMeasurement) {
          }
          setActiveMeasurement(saved.id, manualFrameId, 'manual-save');
          activeMeasurementMethodRef.current = savedManualMethod;
          autoMeasurementIdRef.current = saved.id;

          manualMeasurementIdRef.current = saved.id;
          await refetchMeasurements();
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
      getActiveMeasurementId,
      setActiveMeasurement,
      measurements,
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
    async (snapshot: AutoMeasureDetectionSnapshot, source: CommitAutoMeasureSource) => {
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
      const { d1Px, d2Px, center } = validation;
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

      // Duplicate-measurement guard. Repeat clicks on the same indentation
      // compare stable rounded geometry against the row fingerprint before
      // any save. Settings-save is exempt because the user is intentionally
      // re-detecting under new params and expects the existing row to update.
      const stableD1Px = roundAutoMeasurePixel(d1Px);
      const stableD2Px = roundAutoMeasurePixel(d2Px);
      const stableCenterX = roundAutoMeasurePixel(center.x);
      const stableCenterY = roundAutoMeasurePixel(center.y);
      const frameEpoch =
        typeof graphics.frameId === 'number' && Number.isFinite(graphics.frameId)
          ? graphics.frameId
          : getLastPaintEpoch();
      const fingerprintObjective = normalizeAutoMeasureFingerprintObjective(objectiveForCalibration);
      const fingerprint = {
        d1Px: stableD1Px,
        d2Px: stableD2Px,
        centerX: stableCenterX,
        centerY: stableCenterY,
        frameId: frameEpoch,
        hv: finiteOrNull(result.hv),
      };
      const fingerprintKey = buildAutoMeasureFingerprintKey({
        objective: fingerprintObjective,
        centerX: fingerprint.centerX,
        centerY: fingerprint.centerY,
        d1Px: fingerprint.d1Px,
        d2Px: fingerprint.d2Px,
      });

      const conversion = calculateVickersFromPixels({
        calibrationSettings,
        calibrationSettingsList,
        calibrations,
        d1Px: stableD1Px,
        d2Px: stableD2Px,
        forceKgf,
        machineState: machineStateForAuto,
        objective: objectiveForCalibration,
        targetObjective: objectiveForCalibration,
      });
      const candidateHv = conversion.ok ? finiteOrNull(conversion.value.hv) : fingerprint.hv;
      if (conversion.ok) {
      }

      const shouldCheckDuplicate = source === 'auto-click' || source === 'after-impress';
      if (shouldCheckDuplicate) {
        const existing = committedFingerprintsRef.current;
        let matchedEntry: typeof existing[number] | null = null;
        if (existing.length === 0) {
        }
        for (const entry of existing) {
          const sameObjective = entry.objective === fingerprintObjective;
          const d1Delta = Math.abs(entry.d1Px - fingerprint.d1Px);
          const d2Delta = Math.abs(entry.d2Px - fingerprint.d2Px);
          const cxDelta = Math.abs(entry.centerX - fingerprint.centerX);
          const cyDelta = Math.abs(entry.centerY - fingerprint.centerY);
          const cornerDelta = getAutoMeasureMaxCornerDelta(entry.corners, c);
          const hvDelta =
            entry.hv !== null && candidateHv !== null ? Math.abs(entry.hv - candidateHv) : null;
          const hvMatches = hvDelta === null || hvDelta <= AUTO_MEASURE_HARDNESS_TOLERANCE_HV;
          const matches =
            sameObjective &&
            d1Delta <= AUTO_MEASURE_DIAGONAL_TOLERANCE_PX &&
            d2Delta <= AUTO_MEASURE_DIAGONAL_TOLERANCE_PX &&
            cxDelta <= AUTO_MEASURE_CENTER_TOLERANCE_PX &&
            cyDelta <= AUTO_MEASURE_CENTER_TOLERANCE_PX &&
            cornerDelta <= AUTO_MEASURE_CORNER_TOLERANCE_PX &&
            hvMatches;
          if (matches && !matchedEntry) {
            matchedEntry = entry;
          }
        }
        if (matchedEntry) {
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
          if (source === 'after-impress') {
            setPreviewAutoMeasureOverlay(null);
            autoMeasurePreviewSnapshotRef.current = null;
            preserveAfterImpressOverlay(5000);
            await waitForOverlayPaint();
            if (!displayedAutoMeasureGraphicsRef.current) {
              logAfterImpressDetectionFailed('overlay-not-ready');
              setAutoMeasureStatus('failed');
              setStatusMessage('System Status: Auto Measure rejected: overlay not ready');
              return false;
            }
            setAutoMeasureStatus('success');
            setStatusMessage('System Status: Auto Measure complete');
            return true;
          }
          setAutoMeasureStatus('duplicate');
          setStatusMessage(
            'System Status: Auto Measure: same indentation - no duplicate row added.'
          );
          return false;
        }
      }

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

      // Why: always commit a NEW reference for the explicit Auto Measure
      // click. The graphicsAlmostEqual short-circuit was suppressing overlay
      // updates after an objective change when the new corners happened to
      // be near-identical to the prior run, leaving the user with the table
      // updated but no fresh yellow lines drawn. The skip is still useful
      // for slider-driven preview spam, so keep it on settings-save only.
      const forceOverlayRefresh = source === 'auto-click' || source === 'after-impress';
      setCommittedAutoMeasureOverlay((prev) => {
        if (!forceOverlayRefresh && prev && graphicsAlmostEqual(prev, graphics)) {
          return prev;
        }
        if (source === 'auto-click' || source === 'after-impress') {
        }
        return { ...graphics, corners: { ...graphics.corners } };
      });
      if (source === 'after-impress') {
      }
      setPreviewAutoMeasureOverlay(null);
      autoMeasurePreviewSnapshotRef.current = null;
      previewMeasurementRef.current = null;

      const timestamp = new Date().toISOString();
      // For auto-click, the existing fingerprint match at line ~2167 may have
      // already restored autoMeasurementIdRef. If not, also reuse the active
      // row when the user previously placed a Manual/Calibration row on this
      // same frozen frame — otherwise we'd duplicate the indent.
      let saveRowId: string | undefined =
        autoMeasurementIdRef.current ?? undefined;
      if (saveRowId === undefined) {
        saveRowId = getActiveMeasurementId();
        if (saveRowId) {
        }
      }
      // Depth is captured ONLY when creating a new auto-measure row. On
      // re-detection of an existing row we must keep the originally saved
      // micrometer reading — overwriting would violate "old saved row must
      // not change" and copy the current depth across all re-detected rows.
      const isNewAutoMeasurement = saveRowId === undefined;
      const depthCapture: DepthSavePayload | null = isNewAutoMeasurement
        ? await buildNewRowDepthPayload(micrometerEnabledRef.current)
        : null;
      if (isNewAutoMeasurement && depthCapture) {
      }


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



      await waitForOverlayPaint();
      if (source === 'after-impress') {
        preserveAfterImpressOverlay(5000);
        if (!displayedAutoMeasureGraphicsRef.current) {
          logAfterImpressDetectionFailed('overlay-not-ready');
          setAutoMeasureStatus('failed');
          setStatusMessage('System Status: Auto Measure rejected: overlay not ready');
          return false;
        }
      }
      const imageDataUrl = cameraRef.current?.captureThumbnailDataUrl() ?? undefined;
      if (imageDataUrl) {
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
        ...(isNewAutoMeasurement && depthCapture
          ? {
              depthMm: depthCapture.depthMm,
              depthSource: depthCapture.depthSource,
              deviceDepthMm: depthCapture.deviceDepthMm,
              manualDepthMm: depthCapture.manualDepthMm,
            }
          : {}),
        method: 'Auto' as const,
        unit: 'um' as const,
        timestamp,
        imageDataUrl,
      };
      if (isNewAutoMeasurement) {
      }
      let saved;
      try {
        saved = await saveManualMeasurement({
          id: saveRowId,
          values: autoRowPayload,
        });
        if (source === 'after-impress') {
        }
        if (isNewAutoMeasurement && depthCapture) {
        } else if (!isNewAutoMeasurement) {
        }
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

      const savedAutoMethod = saved.method ?? autoRowPayload.method;
      autoMeasurementIdRef.current = saved.id;
      manualMeasurementIdRef.current = saved.id;
      setActiveMeasurement(saved.id, fingerprint.frameId, 'auto-save');
      activeMeasurementMethodRef.current = savedAutoMethod;
      const committedGraphics = cloneAutoMeasureGraphics(graphics);
      committedFingerprintsRef.current = upsertCommittedAutoMeasureFingerprint(
        committedFingerprintsRef.current,
        {
          objective: fingerprintObjective,
          frameId: fingerprint.frameId,
          d1Px: values.d1Px,
          d2Px: values.d2Px,
          centerX: fingerprint.centerX,
          centerY: fingerprint.centerY,
          hv:
            typeof saved.hv === 'number' && Number.isFinite(saved.hv)
              ? saved.hv
              : candidateHv,
          d1Um: typeof saved.d1Um === 'number' && Number.isFinite(saved.d1Um) ? saved.d1Um : values.d1Um,
          d2Um: typeof saved.d2Um === 'number' && Number.isFinite(saved.d2Um) ? saved.d2Um : values.d2Um,
          avgDUm:
            typeof saved.averageUm === 'number' && Number.isFinite(saved.averageUm)
              ? saved.averageUm
              : values.avgDUm,
          avgDMm:
            typeof saved.averageMm === 'number' && Number.isFinite(saved.averageMm)
              ? saved.averageMm
              : values.avgDMm,
          rowId: saved.id,
          fingerprintKey,
          corners: committedGraphics.corners,
          graphics: committedGraphics,
        }
      );
      if (source === 'auto-click' || source === 'after-impress') {
        setAutoMeasureStatus('success');
      }
      await refetchMeasurements();

      if (source === 'settings-save') {
      } else {
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
      getActiveMeasurementId,
      setActiveMeasurement,
      preserveAfterImpressOverlay,
      setAutoMeasureStatus,
    ]
  );

  const runAutoMeasure = useCallback((settingsInput: AutoMeasureSettingsPayload, preview = false, source?: AutoMeasureCallSource): Promise<boolean> => {
    const callSource = source ?? (preview ? 'settings-preview' : 'auto-click');
    logUnexpectedAutoMeasureCall(callSource);

    if (impressInProgressRef.current) {
      return Promise.resolve(false);
    }

    if (autoMeasureInFlightRef.current) {
      // Coalesce: remember the latest preview settings so the trailing run
      // after the in-flight detection picks up the user's final slider value.
      // Non-preview (explicit Auto Measure click) is still ignored while busy.
      if (preview) {
        autoMeasurePendingPreviewRef.current = settingsInput;
      }
      return Promise.resolve(false);
    }

    return (async (): Promise<boolean> => {
      const settings = normalizeAutoMeasureSettings(settingsInput);
      if (!preview && callSource !== 'after-impress') {
        // Drop the previously-committed yellow lines before running a new
        // detection — old D1/D2 must never linger over a fresh detection
        // attempt. The new overlay will be set only if detection succeeds.
        // Keep committed row fingerprints alive so repeat clicks compare
        // against every current row, even while the overlay is being refreshed.
        setCommittedAutoMeasureOverlay((prev) => {
          if (!prev) {
          }
          return null;
        });
        setPreviewAutoMeasureOverlay(null);
        autoMeasurePreviewSnapshotRef.current = null;
        autoMeasurementIdRef.current = null;
      }

      autoMeasureInFlightRef.current = true;
      setAutoMeasuring(true);
      // Begin a fresh Auto Measure session. The session id stamps every
      // overlay produced by this run so a result that returns after a later
      // invalidator can be filtered out (overlay.sessionId !== current).
      const sessionIdForRun = autoMeasureSessionIdRef.current + 1;
      autoMeasureSessionIdRef.current = sessionIdForRun;
      setAutoMeasureSessionId(sessionIdForRun);
      // Both auto-click and settings-preview activate the session — preview
      // overlays during slider drags also need the gate to allow paint.
      // The session ends on the next clearAutoMeasureOverlay invalidator
      // (objective change, turret change, camera close).
      setAutoMeasureSessionActive(true);
      // 'after-impress' is a system-triggered detection that mirrors an
      // explicit user click — same camera-freeze + fresh-frame semantics, no
      // prior committed snapshot to reuse. Without this branch the source
      // fell into the else-path below and tried to reuse a non-existent
      // committedAutoMeasureFrameRef, silently aborting detection.
      const isFreshCapture = callSource === 'auto-click' || callSource === 'after-impress';
      if (isFreshCapture) {
        setAutoMeasureStatus('detecting');
        setCameraStatus('frozen');
      }
      if (callSource === 'settings-preview') {
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
        if (!objectiveForCalibration) {
          if (callSource === 'after-impress') {
            logAfterImpressDetectionFailed('no-active-objective');
          }
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
            return false;
          }
          setUnavailableMsg(
            'No active objective. Please click 10X or 40X in Machine Control before Auto Measure.'
          );
          setStatusMessage('System Status: Auto Measure blocked: no active objective');
          return false;
        }
        if (machineState?.objective?.trim() && machineState.objective !== activeObjective) {
          setActiveObjective(machineState.objective);
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
        }
        const minConfidence =
          settings.imageType === 'HV-1' ? 0.52 : settings.imageType === 'HV-3' ? 0.38 : 0.45;
        let displayedFrame;
        if (isFreshCapture) {
          if (callSource === 'after-impress') {
          }
          displayedFrame = cameraRef.current?.captureDisplayedFrame({ freeze: true });
          if (callSource === 'after-impress') {
          }
        } else {
          displayedFrame = committedAutoMeasureFrameRef.current;
          if (displayedFrame) {
          } else {
          }
        }
        let capturedFrameIdForRun: number | null = autoMeasureCapturedFrameId;
        if (isFreshCapture) {
          const capturedFrameId = getLastPaintedFrameId();
          capturedFrameIdForRun = capturedFrameId;
          setAutoMeasureCapturedFrameId(capturedFrameId);
          // Auto Measure click is an explicit user intent — release the
          // objective-change transition gate so the result is allowed to
          // paint even if the camera's first-fresh-frame observer hasn't
          // fired yet.
          setObjectiveChangeInProgress(false);
        }

        // After an objective change the live canvas is cleared and the next
        // worker frame typically lands within ~33ms. If the user clicks Auto
        // Measure during that gap, wait once for a fresh frame and retry the
        // capture so detection runs against real pixels, not a black canvas.
        if (
          isFreshCapture &&
          displayedFrame &&
          !displayedFrame.ok &&
          displayedFrame.error === 'awaiting-fresh-frame'
        ) {
          if (!preview) {
            setStatusMessage('System Status: Waiting for camera frame after objective change');
          }
          const fresh = await (cameraRef.current?.waitForFreshFrame(2000) ?? Promise.resolve(false));
          if (fresh) {
            displayedFrame = cameraRef.current?.captureDisplayedFrame({ freeze: true });
          }
        }

        if (!displayedFrame?.ok) {
          if (preview) {
            // Keep last valid overlay; surface only via status (no log spam).
            return false;
          }
          if (callSource === 'auto-click') {
          }
          {
            const stale = displayedFrame?.error ?? 'no-displayed-image (stale-frame)';
            setUnavailableMsg(`Auto Measure rejected: ${stale}. Please use manual measure.`);
            setStatusMessage(`System Status: Auto Measure rejected: ${stale}`);
            if (callSource !== 'after-impress') {
              clearAutoMeasureOverlay('auto-measure-failed');
            }
            if (isFreshCapture) setAutoMeasureStatus('failed');
            // liveObjectiveForNative is declared further down — this branch
            // fires before it's computed (no displayed image), so log it as
            // 'unknown'.
            if (callSource === 'after-impress') {
              logAfterImpressDetectionFailed(stale);
            }
          }
          return false;
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
          if (!preview) {
            setStatusMessage('System Status: Auto Measure rejected: invalid-detection-frame');
            setUnavailableMsg('Auto Measure rejected: invalid-detection-frame. Please retry.');
            if (callSource !== 'after-impress') {
              clearAutoMeasureOverlay('auto-measure-failed');
            }
            if (isFreshCapture) setAutoMeasureStatus('failed');
          }
          if (callSource === 'after-impress') {
            logAfterImpressDetectionFailed('invalid-detection-frame');
          }
          return false;
        }

        if (callSource === 'after-impress') {
        }

        if (isFreshCapture) {
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
          if (callSource === 'after-impress') {
          }
          if (callSource === 'auto-click') {
          }
        }
        // Prove the frame about to be detected matches the confirmed
        // objective AND was painted after the most recent canvas clear.
        // Both fields must be aligned for detection to be trustworthy.
        // Spec-format start log — also stamps a frameId we can grep for in
        // the native [auto-measure-start ...] line in the terminal.
        // Parity log: must match [calibration-auto-native-input] for the
        // same indent so the two paths can be diffed in the console.
        const measureFn = preview ? measureVickersAutoPreview : measureVickersAuto;
        if (preview) {
        }
        // Slider values are the source of truth at detection time. Objective
        // defaults seed the dialog when the objective changes (UI level) — at
        // detection time we must honor whatever the user has in the form,
        // otherwise dragging Smoothing/Threshold sliders produces no visible
        // change in the yellow lines because every detection runs on the
        // same hardcoded numbers.
        if (preview) {
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
          if (callSource === 'auto-click') {
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
            if (callSource !== 'after-impress') {
              clearAutoMeasureOverlay('auto-measure-failed');
            }
            if (isFreshCapture) setAutoMeasureStatus('failed');
          }
          if (callSource === 'after-impress') {
            logAfterImpressDetectionFailed(reason);
          }
          return false;
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
            return false;
          }
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
          if (callSource !== 'after-impress') {
            clearAutoMeasureOverlay('auto-measure-failed');
          }
          // eslint-disable-next-line no-console
          console.warn(
            `[measurement-commit-blocked] method=Auto reason=detection-rejected detail="${reason}"`
          );
          if (callSource === 'after-impress') {
            logAfterImpressDetectionFailed(reason);
          }
          return false;
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
        if (callSource === 'after-impress' && result.ok) {
        }
        if (sessionIdForRun !== autoMeasureSessionIdRef.current) {
          if (callSource === 'after-impress') {
            logAfterImpressDetectionFailed('session-mismatch');
          }
          return false;
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
            if (callSource === 'after-impress') {
              logAfterImpressDetectionFailed('objective-mismatch');
            }
            return false;
          }
        }
        if (callSource === 'after-impress') {
        }
        if (!preview && callSource === 'auto-click') {
          // nativeCorners → displayCorners scale map. The camera preview
          // canvas is now painted at full native resolution
          // (PREVIEW_SCALE=1); the AutoMeasureOverlay receives native
          // corners and maps them via imageToDisplay at render time. This
          // log captures the scaled set used for the yellow overlay.
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
          {
            const c = result.ok ? result.corners : null;
            const prev = displayedAutoMeasureGraphicsRef.current;
            if (c && prev) {
              const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
                Math.hypot(a.x - b.x, a.y - b.y).toFixed(2);
              const same =
                d(c.left, prev.corners.left) === '0.00' &&
                d(c.right, prev.corners.right) === '0.00' &&
                d(c.top, prev.corners.top) === '0.00' &&
                d(c.bottom, prev.corners.bottom) === '0.00';
              if (same) {
              }
            }
          }
          if (!autoMeasureSettingsEqual(settings, latestAutoMeasurePreviewSettingsRef.current)) {
            return false;
          }
          setPreviewAutoMeasureOverlay((prev) => {
            if (prev && graphicsAlmostEqual(prev, graphics)) {
              return prev;
            }
            return graphics;
          });
          autoMeasurePreviewSnapshotRef.current = snapshot;
          previewMeasurementRef.current = {
            d1Pixels: result.d1Pixels,
            d2Pixels: result.d2Pixels,
            confidence: result.confidence,
          };
          // Calibration-aware: when the preview is being driven for the
          // Calibration auto path, push the new pixels into the same state
          // the Calibration dialog reads (autoFillPixelLength*), so the
          // panel's Pixel X / Pixel Y fields refresh live as the user drags
          // Smoothing / Threshold sliders. The committed auto overlay was
          // already updated above so the yellow guide lines move.
          if (calibrationMeasureModeRef.current === 'auto') {
            // The yellow guides should also paint as the committed (not just
            // preview) overlay so closing the settings dialog doesn't snap
            // back to the pre-preview detection in calibration mode.
            setCommittedAutoMeasureOverlay(graphics);
            const nextPixels = { d1Px: result.d1Pixels, d2Px: result.d2Pixels };
            latestManualPixelsRef.current = nextPixels;
            setLatestManualPixels(nextPixels);
          }
          return true;
        }

        const committed = await commitAutoMeasureSnapshot(
          snapshot,
          callSource === 'settings-save'
            ? 'settings-save'
            : callSource === 'after-impress'
              ? 'after-impress'
              : 'auto-click'
        );
        if (callSource === 'after-impress') {
          if (committed) {
          }
        }
        return committed;

      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[auto-measure] failed:', err);
        if (!preview && callSource === 'auto-click') {
        }
        if (preview) {
          // Preview-time exception: keep overlay, just log + status.
          setStatusMessage('System Status: Auto Measure preview detection failed');
        } else {
          setUnavailableMsg('Auto detection not reliable. Please use manual measure.');
          // For explicit user Auto Measure, ensure no stale state resurrects
          // after a thrown detection error. After-impress keeps the current
          // overlay state untouched per the impress completion contract.
          if (callSource !== 'after-impress') {
            clearAutoMeasureOverlay('auto-measure-failed');
          }
        }
        if (callSource === 'after-impress') {
          logAfterImpressDetectionFailed(err instanceof Error ? err.message : String(err));
        }
        return false;
      } finally {
        autoMeasureInFlightRef.current = false;
        setAutoMeasuring(false);
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

  // Mirror the live preview settings to a ref so the impress-complete async
  // closure reads the current "Measure after Impress" flag without forcing
  // that effect to re-subscribe on every settings change.
  const autoMeasurePreviewSettingsRef = useRef<AutoMeasureSettingsPayload>(autoMeasurePreviewSettings);
  useEffect(() => {
    autoMeasurePreviewSettingsRef.current = autoMeasurePreviewSettings;
  }, [autoMeasurePreviewSettings]);

  const runAutoMeasureAfterImpress = useCallback(async (): Promise<boolean> => {
    const markAfterImpressFailed = (reason: string) => {
      logAfterImpressDetectionFailed(reason);
      setAutoMeasureStatus('failed');
      setStatusMessage(`System Status: Auto Measure rejected: ${reason}`);
    };

    impressInProgressRef.current = false;
    const settings = latestAutoMeasurePreviewSettingsRef.current;
    const measureAfterImpressEnabled = settings.measureAfterImpress === true;
    // Defensive sync visibility: surface both the ref (used for the decision)
    // and the latest React state value so a drift between the two is obvious
    // in the log trail if the operator saved settings and clicked Impress in
    // the same tick.
    if (!measureAfterImpressEnabled) {
      return false;
    }
    if (afterImpressAutoMeasureInFlightRef.current) {
      return false;
    }

    afterImpressAutoMeasureInFlightRef.current = true;
    const runId = afterImpressAutoMeasureRunIdRef.current + 1;
    afterImpressAutoMeasureRunIdRef.current = runId;

    try {
      suppressAutoMeasurePreviewRef.current = false;
      preserveAfterImpressOverlay(12000);

      const objective = (
        liveMachineStateRef.current?.confirmedObjectiveFromMachine ??
        activeObjectiveRef.current ??
        liveMachineStateRef.current?.objective ??
        ''
      )
        .trim()
        .toUpperCase();
      const settleMs = objective === '40X' ? 600 : 350;
      await delay(settleMs);

      const camera = cameraRef.current;
      if (!camera) {
        markAfterImpressFailed('camera-unavailable');
        return false;
      }

      const firstFresh = await camera.waitForFreshFrame(1200);
      if (!firstFresh) {
        // eslint-disable-next-line no-console
        console.warn('[camera-fresh-frame] reason=after-impress result=timeout');
      }

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (runId !== afterImpressAutoMeasureRunIdRef.current) {
          markAfterImpressFailed('superseded');
          return false;
        }
        if (attempt > 1) {
          await delay(300);
          const fresh = await camera.waitForFreshFrame(1200);
          if (!fresh) {
            // eslint-disable-next-line no-console
            console.warn(
              `[camera-fresh-frame] reason=after-impress retry=${attempt} result=timeout`
            );
          }
        }
        if (autoMeasureInFlightRef.current) {
          const waitStart = Date.now();
          while (autoMeasureInFlightRef.current && Date.now() - waitStart < 2000) {
            await delay(60);
          }
          if (autoMeasureInFlightRef.current) {
            markAfterImpressFailed('in-flight-detection-did-not-clear-within-2s');
            return false;
          }
        }

        const runner = runAutoMeasureRef.current;
        if (!runner) {
          markAfterImpressFailed('runAutoMeasure-ref-missing');
          return false;
        }

        afterImpressAutoMeasureAttemptRef.current = attempt;
        preserveAfterImpressOverlay(12000);
        suppressAutoMeasurePreviewRef.current = false;
        const finished = await runner(latestAutoMeasurePreviewSettingsRef.current, false, 'after-impress');
        await waitForOverlayPaint();
        const overlayReady = displayedAutoMeasureGraphicsRef.current !== null;
        if (finished && overlayReady) {
          preserveAfterImpressOverlay(5000);
          return true;
        }

        const reason = finished ? 'overlay-not-ready' : 'detection-failed';
        if (attempt < 3) {
          continue;
        }
        markAfterImpressFailed(reason);
        return false;
      }

      markAfterImpressFailed('max-retries-exhausted');
      return false;
    } finally {
      afterImpressAutoMeasureAttemptRef.current = 0;
      afterImpressAutoMeasureInFlightRef.current = false;
    }
  }, [preserveAfterImpressOverlay, setAutoMeasureStatus]);

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

    // Calibration-aware preview: when the Calibration panel is open, the
    // slider re-run must respect the calibration overlay mode. Manual mode
    // → ignore (no preview detection); Auto mode → emit the calibration log
    // breadcrumb so the live and calibration paths can be diffed in the
    // console. When Calibration is closed, the normal live preview flow is
    // unaffected.
    // calibrationMeasureModeRef is 'none' whenever Calibration is closed
    // (the close handler resets it), so this naturally restricts the
    // calibration-specific branch to the open-panel case.
    const calibrationMode = calibrationMeasureModeRef.current;
    if (calibrationMode !== 'none') {
      if (calibrationMode !== 'auto') {
        return;
      }
      const calibFrame = committedAutoMeasureFrameRef.current;
      if (!calibFrame) {
        return;
      }
    }

    const timer = window.setTimeout(() => {
      if (suppressAutoMeasurePreviewRef.current) {
        suppressAutoMeasurePreviewRef.current = false;
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
      setActiveObjective(next);
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
    setObjectiveChangeInProgress(true);

    // L1 / L2 are the slot positions; the machine echoes L<n>OK on
    // mechanical landing.

    // 2) Reload calibration profile for the now-confirmed objective.
    void refetchCalibrationSettings();

    // 3) Bump the viewport refresh key so CameraWindow can clear any cached
    //    transforms and force a fresh draw at the new magnification.
    setObjectiveRefreshKey((k) => k + 1);

    // 4) Invalidate the live canvas so the next worker frame draws onto a
    //    cleared surface (no stale frame from the previous objective).
    cameraRef.current?.clearLiveCanvas();

    // 5) Clear any stale Auto Measure state from the previous magnification —
    //    snapshot frame, frozen overlay, preview overlay, and preview snapshot.
    //    Without this, a 40X frame/overlay can survive into a 10X session.
    if (shouldPreserveAfterImpressOverlay()) {
    } else {
      clearAutoMeasureOverlay('objective-change-confirmed');
    }


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
    })();
  }, [
    liveMachineState?.confirmedObjectiveFromMachine,
    calibrationSettingsList,
    clearAutoMeasureOverlay,
    refetchCalibrationSettings,
    shouldPreserveAfterImpressOverlay,
  ]);

  const turretMovingTimerRef = useRef<number | null>(null);
  const clearTurretMovingTimer = useCallback(() => {
    if (turretMovingTimerRef.current !== null) {
      window.clearTimeout(turretMovingTimerRef.current);
      turretMovingTimerRef.current = null;
    }
  }, []);
  const markTurretIntent = useCallback(
    (
      reason: 'turret-click' | 'objective-change-click',
      target?: string | null
    ) => {
      if (reason === 'objective-change-click') {
        const to = (target ?? 'unknown') || 'unknown';
        setTurretMovingTarget(to === 'unknown' ? null : to);
      }
      // Force-clear overlay state. clearAutoMeasureOverlay nulls
      // committedAutoMeasureOverlay → AutoMeasureOverlay re-renders empty.
      // Bumping manualMeasureResetKey clears the manual measure overlay's
      // internal corners + repaints empty. The calibration overlay shares
      // committedAutoMeasureOverlay, so the same call clears it too.
      clearAutoMeasureOverlay(reason);
      setPreviewAutoMeasureOverlay(null);
      setAutoMeasureSessionActive(false);
      setManualMeasureResetKey((current) => current + 1);
      clearTurretMovingTimer();
      setTurretMoving(true);
      turretMovingTimerRef.current = window.setTimeout(() => {
        turretMovingTimerRef.current = null;
        setTurretMoving(false);
        setTurretMovingTarget(null);
      }, 4000);
    },
    [clearAutoMeasureOverlay, clearTurretMovingTimer]
  );
  useEffect(() => clearTurretMovingTimer, [clearTurretMovingTimer]);

  // Turret position change — any direction button (left/front/right) that
  // moves the turret can land on a different slot (incl. IND, which is not
  // an objective lens and therefore does NOT bump confirmedObjective). The
  // overlay was captured against a specific turret orientation, so any
  // turret move invalidates it regardless of objective.
  //
  // IMPORTANT: do NOT clear the live canvas here. Turret rotation is a pure
  // mechanical move on the same camera/sensor — closing or blanking the
  // canvas would make the camera look frozen for the entire motion window
  // (the next worker frame paints only when one is grabbed/decoded, which
  // can lag a couple of frames during vibration). The canvas-flush belongs
  // exclusively to the confirmed-objective-change handler below, which
  // fires when the new turret slot actually changes the optical objective.
  // Pure turret rotation on the same objective MUST keep streaming pixels.
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
    const frameId = getLastPaintedFrameId();
    // RX confirms the motion completed — release the overlay-render gate
    // immediately, regardless of whether the gate was set by a click in
    // this session (a hardware-driven turret move with no click also lands
    // here and must not leave the gate stuck on if a prior watchdog set it).
    clearTurretMovingTimer();
    setTurretMoving(false);
    setTurretMovingTarget(null);
    if (shouldPreserveAfterImpressOverlay()) {
    } else {
      clearAutoMeasureOverlay('turret-change');
    }
    // Schedule a one-shot post-RX log on the next paint so the user can
    // verify the stream resumed (frameId advanced) without the camera ever
    // being closed/reset.
    const startId = frameId;
    let cancelled = false;
    const tickStart = Date.now();
    const tick = () => {
      if (cancelled) return;
      const cur = getLastPaintedFrameId();
      if (cur > startId) {
        return;
      }
      if (Date.now() - tickStart > 2000) {
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [
    liveMachineState?.turretPosition,
    clearAutoMeasureOverlay,
    cameraStatus,
    clearTurretMovingTimer,
    shouldPreserveAfterImpressOverlay,
  ]);

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
      clearActiveMeasurement('impress-start');
      clearAutoMeasureOverlay('impress-start');
      setManualMeasureResetKey((current) => current + 1);
      setAutoMeasureClearNonce((n) => n + 1);
      return;
    }

    // Trigger post-impress flow on ANY transition into `completed` (including
    // `idle → completed`, which the machine sends when a cycle completes
    // faster than the running batch can land). The earlier
    // `prev === 'started' || 'running'` guard caused the auto-detect to be
    // silently skipped on fast hardware paths.
    if (next === 'completed') {
      const completedAt = Date.now();
      autoMeasurementIdRef.current = null;
      clearActiveMeasurement('impress-done');
      // Read from the synchronously-updated ref (latestAutoMeasurePreviewSettingsRef)
      // — autoMeasurePreviewSettingsRef lags by one render because it's
      // synced via useEffect. If the operator saves Auto Measure Settings
      // and clicks Impress in the same tick, the laggy ref can still hold
      // the pre-save value.
      const latestSettings = latestAutoMeasurePreviewSettingsRef.current;
      const measureAfterImpressEnabled = latestSettings.measureAfterImpress === true;
      const turretAfterImpressEnabled = latestSettings.turretAfterImpress === true;
      const currentObjective = (
        liveMachineStateRef.current?.confirmedObjectiveFromMachine ??
        activeObjectiveRef.current ??
        liveMachineStateRef.current?.objective ??
        ''
      )
        .trim()
        .toUpperCase();
      const targetObjective = latestSettings.objectiveForMeasure.trim().toUpperCase();
      const shouldWaitForTurretAfterImpress =
        turretAfterImpressEnabled &&
        measureAfterImpressEnabled &&
        (!currentObjective || currentObjective !== targetObjective);
      if (!measureAfterImpressEnabled) {
      }
      // When the machine is about to rotate the turret after impress, defer
      // detection until the L*OK confirmation arrives. The other effect that
      // watches confirmedObjectiveFromMachine + lastObjectiveRx clears
      // pendingTurretAfterImpressRef and kicks off the fresh-frame wait +
      // detection. Without this gate, auto-measure would fire on the next
      // available camera frame mid-rotation and detect on a moving image.
      if (shouldWaitForTurretAfterImpress) {
        pendingTurretAfterImpressRef.current = {
          armedAt: completedAt,
          measureAfterImpress: measureAfterImpressEnabled,
          lastSeenObjectiveRx: liveMachineStateRef.current?.lastObjectiveRx ?? null,
        };
        impressInProgressRef.current = false;
        // Watchdog: if L*OK never arrives within 10s the operator can still
        // hit Auto Measure manually. Drop the gate so a future impress isn't
        // permanently armed.
        if (turretAfterImpressWatchdogRef.current !== null) {
          window.clearTimeout(turretAfterImpressWatchdogRef.current);
        }
        turretAfterImpressWatchdogRef.current = window.setTimeout(() => {
          const pending = pendingTurretAfterImpressRef.current;
          if (pending) {
            // eslint-disable-next-line no-console
            console.warn(
              '[turret-after-impress-done] reason=watchdog-timeout — L*OK never arrived; running fallback auto measure'
            );
            pendingTurretAfterImpressRef.current = null;
            if (pending.measureAfterImpress) {
              void runAutoMeasureAfterImpress();
            }
          }
          turretAfterImpressWatchdogRef.current = null;
        }, 10000);
        return;
      }
      if (turretAfterImpressEnabled && measureAfterImpressEnabled) {
      }
      void runAutoMeasureAfterImpress();
      return;
    }

    if (next === 'error' || next === 'idle') {
      if (impressInProgressRef.current) {
        impressInProgressRef.current = false;
      }
    }
  }, [
    clearActiveMeasurement,
    clearAutoMeasureOverlay,
    liveMachineState?.indentStatus,
    runAutoMeasureAfterImpress,
  ]);

  // Resolve the turret-after-impress gate: when the machine confirms the new
  // objective slot (L*OK / objective state-update), the rotation has settled.
  // Then wait for a fresh stable frame and, if measureAfterImpress is also on,
  // run detection. Watching lastObjectiveRx is robust to multiple confirms
  // landing in the same RX batch.
  useEffect(() => {
    const pending = pendingTurretAfterImpressRef.current;
    if (!pending) return;
    const currentRx = liveMachineState?.lastObjectiveRx ?? null;
    if (!currentRx || currentRx === pending.lastSeenObjectiveRx) return;
    pendingTurretAfterImpressRef.current = null;
    if (turretAfterImpressWatchdogRef.current !== null) {
      window.clearTimeout(turretAfterImpressWatchdogRef.current);
      turretAfterImpressWatchdogRef.current = null;
    }
    void runAutoMeasureAfterImpress();
  }, [liveMachineState?.lastObjectiveRx, runAutoMeasureAfterImpress]);

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
    if (activeTool === 'manualMeasure') {
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
        setLatestManualPixels({ d1Px, d2Px });
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

            // Line drag must NEVER create a new row — that's how depth was
            // silently being lost. Fall back to the active row id so an
            // empty autoMeasurementIdRef (cross-flow edge case) still
            // resolves to PUT instead of POST.
            const targetId =
              autoMeasurementIdRef.current ?? getActiveMeasurementId() ?? undefined;
            const timestamp = new Date().toISOString();
            const targetExisting = targetId
              ? measurements.find((m) => m.id === targetId)
              : null;

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


            await waitForOverlayPaint();
            const imageDataUrl = cameraRef.current?.captureThumbnailDataUrl() ?? undefined;
            if (imageDataUrl) {
            } else {
              // eslint-disable-next-line no-console
              console.warn('[album] missing image for measurementId=', targetId ?? 'new');
            }
            // Depth + conversion fields must survive a line drag. The backend's
            // buildUpdateSchema injects `null` defaults for fields missing from
            // the PUT body, so an "omit depth" payload would wipe depthMm /
            // depthSource / deviceDepthMm / manualDepthMm / convertType /
            // convertValue to null on every adjust. Pass them through from the
            // existing row when we're updating (not creating).
            const preservedConvertValue =
              typeof targetExisting?.convertValue === 'number'
                ? targetExisting.convertValue
                : null;
            const preserveFields = targetExisting
              ? {
                  depthMm: targetExisting.depthMm ?? null,
                  depthSource: targetExisting.depthSource ?? null,
                  deviceDepthMm: targetExisting.deviceDepthMm ?? null,
                  manualDepthMm: targetExisting.manualDepthMm ?? null,
                  convertType: targetExisting.convertType ?? null,
                  convertValue: preservedConvertValue,
                }
              : {};
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
                ...preserveFields,
                method: 'Auto (Adjusted)',
                unit: 'um',
                timestamp,
                imageDataUrl,
              },
            });
            autoMeasurementIdRef.current = saved.id;
            manualMeasurementIdRef.current = saved.id;
            {
              const adjFrameId = getLastPaintedFrameId();
              const savedAdjMethod = saved.method ?? 'Auto (Adjusted)';
              setActiveMeasurement(saved.id, adjFrameId, 'auto-adjust-save');
              activeMeasurementMethodRef.current = savedAdjMethod;
            }
            const centerX = (corners.left.x + corners.right.x) / 2;
            const centerY = (corners.top.y + corners.bottom.y) / 2;
            const stableCenterX = roundAutoMeasurePixel(centerX);
            const stableCenterY = roundAutoMeasurePixel(centerY);
            const fingerprintObjective = normalizeAutoMeasureFingerprintObjective(objectiveForCalibration);
            const fingerprintKey = buildAutoMeasureFingerprintKey({
              objective: fingerprintObjective,
              centerX: stableCenterX,
              centerY: stableCenterY,
              d1Px: values.d1Px,
              d2Px: values.d2Px,
            });
            const baseGraphics = displayedAutoMeasureGraphicsRef.current;
            if (baseGraphics) {
              const committedGraphics = cloneAutoMeasureGraphics({ ...baseGraphics, corners });
              committedFingerprintsRef.current = upsertCommittedAutoMeasureFingerprint(
                committedFingerprintsRef.current,
                {
                  objective: fingerprintObjective,
                  frameId:
                    typeof baseGraphics.frameId === 'number' && Number.isFinite(baseGraphics.frameId)
                      ? baseGraphics.frameId
                      : null,
                  d1Px: values.d1Px,
                  d2Px: values.d2Px,
                  centerX: stableCenterX,
                  centerY: stableCenterY,
                  hv:
                    typeof saved.hv === 'number' && Number.isFinite(saved.hv)
                      ? saved.hv
                      : values.hv,
                  d1Um: values.d1Um,
                  d2Um: values.d2Um,
                  avgDUm: values.avgDUm,
                  avgDMm: values.avgDMm,
                  rowId: saved.id,
                  fingerprintKey,
                  corners: committedGraphics.corners,
                  graphics: committedGraphics,
                }
              );
            }
            await refetchMeasurements();
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
      setActiveMeasurement,
      getActiveMeasurementId,
      measurements,
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
          return prev;
        }
        const current = prev.corners[corner];
        const next = { x: current.x + dx, y: current.y + dy };
        const nextCorners = { ...prev.corners, [corner]: next };
        return { ...prev, corners: nextCorners };
      });
    },
    []
  );

  const openCameraSettingsPanel = useCallback(() => {
    setActiveDialog('camera');
  }, []);

  const buildSharedCtx = useCallback(
    (): ToolDispatchContext => ({
      setActiveTool,
      setStatus: (message) => setStatusMessage(`System Status: ${message}`),
      notifyUnavailable: (label) =>
        setUnavailableMsg(`${label} is not available yet.`),
      clearGraphics: () => {
        overlay.clearAll();
        setCommittedAutoMeasureOverlay(null);
        setPreviewAutoMeasureOverlay(null);
        autoMeasurePreviewSnapshotRef.current = null;
        committedAutoMeasureFrameRef.current = null;
        previewMeasurementRef.current = null;
        autoMeasurementIdRef.current = null;
        manualMeasurementIdRef.current = null;
        // Note: active measurement row is NOT cleared from the clear-graphics
        // menu. Per spec only camera close/open ends the session and allows
        // a new row.
        resetManualMeasure();
      },
      autoMeasure: handleAutoMeasure,
      setLineThickness: lineThickness.setThickness,
      toggleMagnifier: () => {
        setMagnifierEnabled((prev) => {
          const next = !prev;
          if (next) {
          } else {
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
      openCalibration: () => openCalibrationPanel('toolbar'),
      openCameraSettings: openCameraSettingsPanel,
      openImage: () => {
        void (async () => {
          try {
            const reply = await openImageDialog();
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
              setCommittedAutoMeasureOverlay(null);
              setPreviewAutoMeasureOverlay(null);
              autoMeasurePreviewSnapshotRef.current = null;
              committedAutoMeasureFrameRef.current = null;
              previewMeasurementRef.current = null;
              autoMeasurementIdRef.current = null;
              manualMeasurementIdRef.current = null;
              // Note: active measurement row is NOT cleared on new-image
              // load. Per spec only camera close/open starts a new row.
              committedFingerprintsRef.current = [];
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
            const reply = await saveImageDialog({
              defaultName: `hardness-${Date.now()}.png`,
            });
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
        // eslint-disable-next-line no-console
        console.log('[camera-ui][open]');
        void (async () => {
          try {
            // Reset per-session log flags so the next first-frame / first-paint
            // events log again after a close→open cycle.
            resetCameraSession();
            // Reload calibration list from SQLite so a saved 40X (or any other
            // objective) calibration is picked up after a camera close/open —
            // without this, calibrationSettingsList stays at whatever was
            // fetched on app mount and Auto Measure can't find the calibration.
            try {
              await refetchCalibrationSettings();
            } catch {
              /* non-fatal — calibration-confirm path will retry */
            }
            // Enumerate OS-reported serial ports up front so we can validate
            // the saved Machine / Micrometer selections against what the
            // operating system actually exposes — no hardcoded fallbacks.
            const portList = await listSerialPorts().catch((err) => {
              // eslint-disable-next-line no-console
              console.warn('[serial-ports-list] renderer call failed:', err);
              return { ok: false as const, ports: [], error: 'list-failed' };
            });
            const availablePortPaths = Array.isArray(portList?.ports)
              ? portList.ports.map((p) => p.path).filter(Boolean)
              : [];

            const savedMicrometerPort =
              typeof micrometerConfig?.comPort === 'string' && micrometerConfig.comPort.trim()
                ? micrometerConfig.comPort.trim()
                : null;
            const micrometerPortAvailable =
              !!savedMicrometerPort && availablePortPaths.includes(savedMicrometerPort);
            const shouldOpenMicrometer =
              !!micrometerConfig?.enabled && micrometerPortAvailable;
            if (!shouldOpenMicrometer) {
              const reason = !micrometerConfig?.enabled
                ? 'disabled-or-no-port'
                : !savedMicrometerPort
                  ? 'disabled-or-no-port'
                  : 'port-missing';
              if (savedMicrometerPort && reason === 'port-missing') {
                // eslint-disable-next-line no-console
                console.warn(
                  `[saved-com-missing] device=micrometer port=${savedMicrometerPort}`
                );
              }
            } else if (savedMicrometerPort) {
            }

            // Camera open MUST NOT modify the persisted machine/micrometer
            // COM ports — it only reads them to pass to device:open.
            setCameraStatus('opening');
            const reply = await window.hardnessCamera.openDevice(
              shouldOpenMicrometer && savedMicrometerPort
                ? { index: 0, micrometerPort: savedMicrometerPort }
                : { index: 0 }
            );
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
            cameraMeasurementSessionIdRef.current += 1;
            clearActiveMeasurement('camera-session-start');

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
              if (saved) {
                try {
                  dropPendingCameraFrames('gain-change');
                } catch (gainErr) {
                  // eslint-disable-next-line no-console
                  console.error('[camera-settings] apply analogGain threw', gainErr);
                }
                try {
                  dropPendingCameraFrames('exposure-change');
                } catch (expErr) {
                  // eslint-disable-next-line no-console
                  console.error('[camera-settings] apply exposure threw', expErr);
                }
              } else {
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

            // Surface micrometer outcome. The micrometer port is opened only
            // when the user has enabled it AND selected a port that exists in
            // the OS-reported list — never via a hardcoded fallback.
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

            // Machine COM port is persisted via serial-port-setting and
            // auto-connected at app startup. Camera open doesn't reselect it;
            // it just notes the current selection state for diagnostics.
            if (!currentMachinePort) {
            }
          } catch (err) {
            setUnavailableMsg(
              `Open Device failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })();
      },
      closeCameraDevice: () => {
        // eslint-disable-next-line no-console
        console.log('[camera-ui][close]');
        void (async () => {
          try {
            // Force AutoMeasureOverlay to imperatively clearRect its canvas
            // synchronously, before the IPC round-trip. Without this, a rAF
            // queued by the live draw loop can repaint the 4 yellow lines
            // AFTER the React state nulling but BEFORE device:close returns,
            // leaving stale lines visible across the close.
            setAutoMeasureClearNonce((n) => n + 1);
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
            manualMeasurementIdRef.current = null;
            clearActiveMeasurement('camera-close-pre');
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
            // Camera close MUST NOT modify the persisted machine/micrometer
            // COM ports — the close path only tears down hardware connections.
            const reply = await window.hardnessCamera.closeDevice();
            // Always sync status + clear live canvas, freeze canvas and any
            // overlay that belongs to the live camera frame so the viewport
            // actually appears empty after close.
            await cameraRef.current?.refetchStatus();
            cameraRef.current?.clearLiveImage('camera-close');
            setCameraOpen(false);
            setCommittedAutoMeasureOverlay(null);
            setPreviewAutoMeasureOverlay(null);
            // Second bump after IPC closes the stream — guarantees any rAF
            // that landed mid-IPC is invalidated and the canvas is blank.
            setAutoMeasureClearNonce((n) => n + 1);
            autoMeasurePreviewSnapshotRef.current = null;
            committedAutoMeasureFrameRef.current = null;
            previewMeasurementRef.current = null;
            autoMeasurementIdRef.current = null;
            manualMeasurementIdRef.current = null;
            clearActiveMeasurement('camera-close');
            committedFingerprintsRef.current = [];
            resetManualMeasure();
            // Drop the active measure mode so the manual-measure overlay
            // hook stops re-creating default yellow guides on the cleared
            // canvas. Without this, bumping the reset key only clears once —
            // the next effect re-initializes guides because active stays true
            // and imageSize is still cached.
            setActiveTool('pointer');
            // Reset per-session log flags so the next open re-fires
            // [camera-frame] first-frame-after-open and the paint log.
            resetCameraSession();
            // Drop the last-synced objective so re-confirming the SAME
            // objective after reopen re-runs the calibration sync effect
            // (otherwise the equality guard early-returns and Auto Measure
            // sees a stale calibration view).
            lastSyncedObjectiveRef.current = null;
            setStatusMessage('System Status: Device closed');
            void reply;

            // Machine + micrometer connections are intentionally preserved
            // across camera close. They are independent serial devices and
            // must remain usable until the operator clicks Machine Disconnect
            // or the app exits. Previously this path tore down the machine
            // RS-232 link, which forced an unwanted reconnect and lost mid-
            // session state.
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
      openCalibrationPanel,
      openCameraSettingsPanel,
      setActiveTool,
      currentMachinePort,
      micrometerConfig,
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

  const openConfigDialog = useCallback((id: ConfigDialogId) => {
    if (id === 'config:calibration') {
      openCalibrationPanel('menu');
      return;
    }
    if (id === 'config:camera') {
      openCameraSettingsPanel();
      return;
    }

    const map: Record<Exclude<ConfigDialogId, 'config:calibration' | 'config:camera'>, DialogKey> = {
      'config:lineColor': 'lineColor',
      'config:autoMeasure': 'autoMeasure',
      'config:micrometer': 'micrometer',
      'config:serialPort': 'serialPort',
      'config:generic': 'generic',
      'config:other': 'other',
      'config:restoreFactory': 'restoreFactory',
    };
    setActiveDialog(map[id]);
  }, [openCalibrationPanel, openCameraSettingsPanel]);

  const handleMenuSelect = useCallback(
    (action: MenuActionId) => {
      dispatchMenuAction(action, {
        ...buildSharedCtx(),
        openConfigDialog,
        openSampleInfo: () => openTestRecordsDialog([]),
        exitApplication: () => setExitConfirmOpen(true),
      });
    },
    [buildSharedCtx, openConfigDialog]
  );

  const handleToolbarSelect = useCallback(
    (action: ToolbarActionId) => {
      const enteringMagnifier = action === 'tools:magnifier';
      const openingConfigPanel = action === 'config:calibration' || action === 'config:camera';
      const mappedTool = TOOL_ACTION_TO_TOOL[action];

      // Manual Measure must clear any active Auto Measure overlay/session so
      // the two modes are mutually exclusive (only one set of yellow lines /
      // crosshair on screen at a time).
      if (action === 'tools:manualMeasure') {
        if (committedAutoMeasureOverlay || previewAutoMeasureOverlay) {
          clearAutoMeasureOverlay('manual-mode-switch');
        }
      }

      // Measure Length keeps its one-shot behavior on tool switch. Measure
      // Angle is intentionally persistent and multi-measurement: Clear
      // Graphics is the explicit removal path for those overlays.
      if (activeTool === 'measureLength' && mappedTool !== 'measureLength' && !openingConfigPanel) {
        overlay.clearByKind('length');
      }

      // Magnifier is now an overlay toggle (handled in dispatcher via
      // toggleMagnifier). When the user switches to a tool other than
      // Manual Measure, force the magnifier off so it does not bleed into
      // Pointer/Auto Measure/calibration.
      if (!enteringMagnifier && magnifierEnabled && action !== 'tools:manualMeasure' && !openingConfigPanel) {
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
    openTestRecordsDialog(measurementIds);
    setStatusMessage('System Status: Test Records opened');
  }, []);

  const handleMeasurementsCleared = useCallback(() => {
    committedFingerprintsRef.current = [];
    autoMeasurementIdRef.current = null;
    manualMeasurementIdRef.current = null;
    clearActiveMeasurement('clear-table');
  }, [clearActiveMeasurement]);

  return (
    <Box sx={ROOT_SX}>
      <MenuBar onSelect={handleMenuSelect} />
      <Toolbar onSelect={handleToolbarSelect} cameraOpen={cameraOpen} />

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
          turretMoving={turretMoving}
          turretMovingTarget={turretMovingTarget}
          cameraOpen={cameraOpen}
          umPerPixel={umPerPixelForActiveObjective}
          onUpdateShape={handleUpdateShape}
        />
        <RightPanel
          micrometerEnabled={micrometerEnabled}
          targetMinHv={targetMinHv}
          targetMaxHv={targetMaxHv}
          measurements={measurements}
          measurementsError={measurementsError}
          measurementsLoading={measurementsLoading}
          refetchMeasurements={refetchMeasurements}
          onOpenTestRecords={handleOpenTestRecords}
          onMeasurementsCleared={handleMeasurementsCleared}
          onObjectiveChange={handleObjectiveChangeFromUI}
          onTurretIntent={() => markTurretIntent('turret-click')}
          onObjectiveChangeIntent={(target) =>
            markTurretIntent('objective-change-click', target)
          }
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
                }
                if (calibrationMeasureModeRef.current !== 'none') {
                }
                setManualMeasureResetKey((current) => current + 1);
                setAutoMeasureSessionActive(false);
                clearAutoMeasureOverlay('calibration-closed');
                setCalibrationMeasureMode('none', 'panel-closed');
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
        cameraStatus={cameraStatus}
        objective={activeObjective}
        autoMeasureStatus={autoMeasureStatus}
        machineState={liveMachineState}
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
      <MicrometerConfigDialog
        open={activeDialog === 'micrometer'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
        onSaved={() => {
          void refetchMicrometerConfig();
        }}
      />
      <SerialPortSettingDialog
        open={activeDialog === 'serialPort'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
        currentMachinePort={currentMachinePort}
        onApplyMachinePort={applyMachinePort}
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
                  openCalibrationPanel('snackbar');
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
