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
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
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
  objectiveForCalibration: string;
  machineStateForAuto: MachineState | null;
  forceKgf: number | null;
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
  // Duplicate-measurement guard. Captures the last committed Auto Measure
  // result so a repeat click on the same unchanged frame doesn't append a
  // duplicate table row. Cleared on camera close, new image, objective
  // change, and clear-graphics — see [measurement-session-reset] logs.
  const lastCommittedFingerprintRef = useRef<{
    d1Px: number;
    d2Px: number;
    centerX: number;
    centerY: number;
    frameEpoch: number;
  } | null>(null);
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
    // Drop the duplicate-guard fingerprint so re-detection at the new
    // objective is never short-circuited as a "same indentation" repeat.
    lastCommittedFingerprintRef.current = null;
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
  // Clears all Auto Measure overlay/session state. Used whenever the
  // displayed camera image is no longer guaranteed to match the cached
  // detection (objective change, camera open/refresh, auto-measure start,
  // auto-measure reject, manual-mode switch).
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
    lastCommittedFingerprintRef.current = null;
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
          const saved = await saveManualMeasurement({
            id: manualMeasurementIdRef.current ?? undefined,
            values: rowPayload,
          });
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
      const { result, graphics, objectiveForCalibration, machineStateForAuto, forceKgf } = snapshot;

      // Duplicate-measurement guard. Identical detection on the same unchanged
      // frame (repeat click) must NOT spawn a new table row. Tolerance is
      // sub-pixel because the native detector is deterministic for an
      // unchanged frame; a real new indentation moves D1/D2/center well past
      // these bounds. Settings-save is exempt — the user is intentionally
      // re-detecting under new params and expects the existing row to update.
      const centerX = (graphics.corners.left.x + graphics.corners.right.x) / 2;
      const centerY = (graphics.corners.top.y + graphics.corners.bottom.y) / 2;
      const frameEpoch = getLastPaintEpoch();
      const fingerprint = {
        d1Px: result.d1Pixels,
        d2Px: result.d2Pixels,
        centerX,
        centerY,
        frameEpoch,
      };
      // eslint-disable-next-line no-console
      console.log(`[auto-measure-start] frameId=${frameEpoch}`);
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-fingerprint]\ncenterX=${centerX.toFixed(2)}\ncenterY=${centerY.toFixed(2)}\nd1Px=${fingerprint.d1Px.toFixed(2)}\nd2Px=${fingerprint.d2Px.toFixed(2)}\nframeId=${frameEpoch}`
      );

      const last = lastCommittedFingerprintRef.current;
      if (source === 'auto-click' && last) {
        const D_PX_TOL = 1.5;
        const CENTER_TOL = 2;
        const sameValues =
          Math.abs(last.d1Px - fingerprint.d1Px) <= D_PX_TOL &&
          Math.abs(last.d2Px - fingerprint.d2Px) <= D_PX_TOL &&
          Math.abs(last.centerX - fingerprint.centerX) <= CENTER_TOL &&
          Math.abs(last.centerY - fingerprint.centerY) <= CENTER_TOL;
        const sameFrame = last.frameEpoch === fingerprint.frameEpoch;
        // eslint-disable-next-line no-console
        console.log(
          `[measurement-duplicate-check]\nsameFrame=${sameFrame}\nsameValues=${sameValues}`
        );
        if (sameValues) {
          // eslint-disable-next-line no-console
          console.log('[measurement-row-blocked] reason=duplicate-measurement');
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
        }
        return { ...graphics, corners: { ...graphics.corners } };
      });
      setPreviewAutoMeasureOverlay(null);
      autoMeasurePreviewSnapshotRef.current = null;
      previewMeasurementRef.current = null;

      const timestamp = new Date().toISOString();
      // Depth is captured ONLY when creating a new auto-measure row. On
      // re-detection of an existing row we must keep the originally saved
      // micrometer reading — overwriting would violate "old saved row must
      // not change" and copy the current depth across all re-detected rows.
      const isNewAutoMeasurement = autoMeasurementIdRef.current === null;
      const depthMm = isNewAutoMeasurement ? await readLatestMicrometerDepthMm() : null;
      // eslint-disable-next-line no-console
      console.log(
        `[measurement-save] depth from micrometer=${depthMm ?? '-'} new=${isNewAutoMeasurement}`
      );

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
      console.log('[album] snapshot capture start measurementId=', autoMeasurementIdRef.current ?? 'new');
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
      let saved;
      try {
        saved = await saveManualMeasurement({
          id: autoMeasurementIdRef.current ?? undefined,
          values: autoRowPayload,
        });
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
      console.log('[album] measurement updated thumbnail=', !!imageDataUrl, 'id=', saved.id);

      autoMeasurementIdRef.current = saved.id;
      lastCommittedFingerprintRef.current = fingerprint;
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
        // We keep `lastCommittedFingerprintRef` alive so the duplicate-row
        // guard still fires on a repeat click against an unchanged frame.
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
        let displayedFrame =
          callSource === 'auto-click'
            ? cameraRef.current?.captureDisplayedFrame({ freeze: true })
            : committedAutoMeasureFrameRef.current;
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

        if (callSource === 'auto-click') {
          committedAutoMeasureFrameRef.current = cloneCapturedFrame(displayedFrame);
        }

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
        // Force objective-tuned defaults for smoothing/threshold so the
        // detector always uses the values calibrated for that magnification,
        // regardless of any stale UI value.
        const objectiveDefaults = autoMeasureDefaultsForObjective(liveObjectiveForNative);
        const runSmoothing = objectiveDefaults?.smoothing ?? settings.smoothing;
        const runThreshold = objectiveDefaults?.threshold ?? settings.threshold;
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-run] objective=${liveObjectiveForNative} smoothing=${runSmoothing} threshold=${runThreshold}`
        );
        const result = await measureFn({
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
          console.log('[auto-measure] result', result);
          if (callSource === 'auto-click') {
            // eslint-disable-next-line no-console
            console.log(
              `[auto-measure-click] detection-complete ok=${result.ok} confidence=${result.ok ? result.confidence.toFixed(3) : 0} D1_px=${result.ok ? result.d1Pixels.toFixed(3) : 0} D2_px=${result.ok ? result.d2Pixels.toFixed(3) : 0}`
            );
          }
        }

        if (!result.ok || result.confidence < minConfidence || !hasValidAutoMeasureCorners(result)) {
          const baseReason = result.ok
            ? result.confidence < minConfidence
              ? 'low confidence'
              : 'invalid corner coordinates'
            : result.reason;

          // Step 1 runtime sanity check: if the operator asked for 10X but
          // the native debug echo doesn't say "10X", the rebuilt .node
          // didn't load (or string normalisation diverged). Surface this as
          // a distinct reason rather than masking it under the normal
          // detection-failure message.
          const debugObj = (result.debug ?? {}) as { objectiveForMeasure?: unknown };
          const nativeObjective =
            typeof debugObj.objectiveForMeasure === 'string'
              ? debugObj.objectiveForMeasure
              : '';
          let reason = baseReason;
          if (
            liveObjectiveForNative === '10X' &&
            nativeObjective !== '10X' &&
            nativeObjective !== ''
          ) {
            reason = `native-branch-not-used (requested=10X native=${nativeObjective})`;
          } else if (liveObjectiveForNative === '10X' && nativeObjective === '') {
            reason = `native-branch-not-used (native objective missing — addon likely stale; rebuild required)`;
          }

          if (preview) {
            // Preview rejection: keep last valid overlay; no log spam.
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
        }
        const snapshot: AutoMeasureDetectionSnapshot = {
          settings,
          result,
          graphics,
          objectiveForCalibration,
          machineStateForAuto,
          forceKgf,
        };

        if (preview) {
          const detectMs = performance.now() - requestedAt;
          if (!autoMeasureSettingsEqual(settings, latestAutoMeasurePreviewSettingsRef.current)) {
            // eslint-disable-next-line no-console
            console.log(
              `[auto-settings-preview] smoothing=${settings.smoothing} kernel=${readPreviewKernel(result, settings.smoothing)} threshold=${settings.threshold} accepted=false D1_px=0 D2_px=0 detectMs=${detectMs.toFixed(1)}`
            );
            // eslint-disable-next-line no-console
            console.log('[auto-settings-preview-reject] reason=stale-preview keepLastValid=true');
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

    const timer = window.setTimeout(() => {
      if (suppressAutoMeasurePreviewRef.current) {
        suppressAutoMeasurePreviewRef.current = false;
        // eslint-disable-next-line no-console
        console.log('[auto-measure-preview-skip] reason=objective-change');
        return;
      }
      runAutoMeasure(autoMeasurePreviewSettings, true, 'settings-preview');
    }, 70);

    return () => window.clearTimeout(timer);
  }, [activeDialog, autoMeasurePreviewSettings, committedAutoMeasureOverlay, runAutoMeasure]);

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
        lastCommittedFingerprintRef.current = null;
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
        lastCommittedFingerprintRef.current = null;
        // eslint-disable-next-line no-console
        console.log('[measurement-session-reset] reason=clear-graphics');
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
              lastCommittedFingerprintRef.current = null;
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
            lastCommittedFingerprintRef.current = null;
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
            lastCommittedFingerprintRef.current = null;
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
