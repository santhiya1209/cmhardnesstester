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
import StatusBar from '@/component/own/StatusBar';
import TestRecordsDialog from '@/component/own/TestRecordsDialog';
import { useSaveToolbarState } from '@/hooks/mutations/useSaveToolbarState';
import { useMeasurements } from '@/hooks/queries/useMeasurements';
import { useToolbarState } from '@/hooks/queries/useToolbarState';
import { useActiveTool } from '@/hooks/useActiveTool';
import { resetCameraSession } from '@/hooks/useCameraStream';
import { useImageOverlay } from '@/hooks/useImageOverlay';
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
import type { MachineState } from '@/types/machine';
import {
  calculateVickersFromPixels,
  calculateManualDiagonalsFromPixels,
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

function graphicsFromAutoMeasureResult(result: VickersAutoMeasureSuccess): AutoMeasureGraphics {
  if (result.lines.length === 4) {
    return { corners: result.corners, lines: result.lines };
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
  const cameraRef = useRef<CameraWindowHandle | null>(null);
  const autoMeasureInFlightRef = useRef(false);
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
  const [committedAutoMeasureOverlay, setCommittedAutoMeasureOverlay] =
    useState<AutoMeasureGraphics | null>(null);
  const [previewAutoMeasureOverlay, setPreviewAutoMeasureOverlay] =
    useState<AutoMeasureGraphics | null>(null);
  const [, setAutoMeasuring] = useState(false);
  const [autoMeasurePreviewSettings, setAutoMeasurePreviewSettings] =
    useState<AutoMeasureSettingsPayload>(DEFAULT_AUTO_MEASURE_SETTINGS);
  const displayedAutoMeasureGraphics =
    activeDialog === 'autoMeasure'
      ? previewAutoMeasureOverlay ?? committedAutoMeasureOverlay
      : committedAutoMeasureOverlay;
  const displayedAutoMeasureSource: 'auto' | 'preview' | 'save' =
    activeDialog === 'autoMeasure' && previewAutoMeasureOverlay ? 'preview' : 'auto';
  const displayedAutoMeasureGraphicsRef = useRef<AutoMeasureGraphics | null>(null);
  const autoMeasurementIdRef = useRef<string | null>(null);
  // SINGLE GLOBAL SOURCE OF TRUTH for the active objective.
  // - Set by the user's lens button click (authoritative, instant).
  // - Hydrated from SSE machine state when SSE pushes (guarded so it cannot
  //   clobber a recent user click).
  // - Used by Auto Measure, Manual Measure, calibration lookup, and the
  //   measurement table row.
  // - There is NO silent fallback to a hardcoded default. If this is ever
  //   null at save time, we surface a warning instead of saving "10X".
  const [activeObjective, setActiveObjective] = useState<string | null>(null);
  const lastObjectiveClickAtRef = useRef<number>(0);
  // Bumps every time the machine confirms a new objective via L1OK / L2OK RX.
  // CameraWindow watches it to invalidate any per-objective caches and force a
  // fresh draw — separate from activeObjective so we can trigger a refresh
  // even when the confirmed value is identical (e.g. user re-selects same lens).
  const [objectiveRefreshKey, setObjectiveRefreshKey] = useState<number>(0);
  const lastSyncedObjectiveRef = useRef<string | null>(null);
  const handleObjectiveChangeFromUI = useCallback((objective: '10X' | '40X') => {
    lastObjectiveClickAtRef.current = Date.now();
    setActiveObjective(objective);
    // eslint-disable-next-line no-console
    console.log('[objective] changed →', objective);
  }, []);

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
      void (async () => {
        try {
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
            setUnavailableMsg('Manual Measure requires valid D1/D2 values greater than 0.');
            return;
          }

          // SINGLE SOURCE OF TRUTH: activeObjective (set by lens click) → SSE
          // snapshot. NO silent fallback to dialog default — if neither is
          // set, surface a clear warning instead of saving a wrong value.
          const targetObjective =
            (activeObjective && activeObjective.trim()) ||
            (machineState?.objective?.trim() ?? null);
          if (!targetObjective) {
            setUnavailableMsg(
              'No active objective. Please click 10X or 40X in Machine Control before measuring.'
            );
            return;
          }
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
          const saved = await saveManualMeasurement({
            id: manualMeasurementIdRef.current ?? undefined,
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
              micronPerPixel: values.umPerPixel,
              calibrationName: values.calibrationName,
              objective: values.normalizedObjective,
              testForceKgf: values.forceKgf,
              ...depthPayload,
              method: 'Manual',
              unit: 'um',
              timestamp,
              imageDataUrl,
            },
          });
          // eslint-disable-next-line no-console
          console.log('[album] measurement updated thumbnail=', !!imageDataUrl, 'id=', saved.id);

          manualMeasurementIdRef.current = saved.id;
          await refetchMeasurements();
          // eslint-disable-next-line no-console
          console.log('[manual-measure] table row updated', {
            id: saved.id,
            method: saved.method,
          });
          setStatusMessage(`System Status: Manual measurement updated: HV ${values.hv}`);
        } catch (err) {
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
        setUnavailableMsg(conversion.reason);
        setStatusMessage(`System Status: Auto Measure blocked: ${conversion.reason}`);
        return false;
      }

      const values = conversion.value;

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
      const saved = await saveManualMeasurement({
        id: autoMeasurementIdRef.current ?? undefined,
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
          micronPerPixel: values.umPerPixel,
          calibrationName: values.calibrationName,
          objective: values.normalizedObjective,
          testForceKgf: values.forceKgf,
          ...(isNewAutoMeasurement ? { depthMm } : {}),
          method: 'Auto',
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
        `[auto-measure][table-auto-update] rowId=${saved.id} source=detected`
      );
      await refetchMeasurements();
      // eslint-disable-next-line no-console
      console.log('[measurement-table][refresh] rows=auto');

      if (source === 'settings-save') {
        // eslint-disable-next-line no-console
        console.log(
          `[auto-settings-save] committed=true D1_px=${values.d1Px.toFixed(3)} D2_px=${values.d2Px.toFixed(3)} HV=${values.hv.toFixed(3)}`
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure:commit] overlayFrozen=true measurementAdded=true D1_px=${values.d1Px.toFixed(3)} D2_px=${values.d2Px.toFixed(3)} D1_um=${values.d1Um.toFixed(3)} D2_um=${values.d2Um.toFixed(3)} HV=${values.hv.toFixed(3)}`
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
        autoMeasurementIdRef.current = null;
        autoMeasurePreviewSnapshotRef.current = null;
        setPreviewAutoMeasureOverlay(null);
      }

      autoMeasureInFlightRef.current = true;
      setAutoMeasuring(true);
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
          setUnavailableMsg('Auto detection not reliable. Please use manual measure.');
          setStatusMessage(`System Status: Auto Measure rejected: ${displayedFrame?.error ?? 'no displayed image'}`);
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
        const measureFn = preview ? measureVickersAutoPreview : measureVickersAuto;
        const result = await measureFn({
          smoothing: settings.smoothing,
          threshold: settings.threshold,
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
          const reason = result.ok
            ? result.confidence < minConfidence
              ? 'low confidence'
              : 'invalid corner coordinates'
            : result.reason;
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
          setStatusMessage(`System Status: Auto Measure rejected: ${reason}`);
          setUnavailableMsg('Auto detection not reliable. Please use manual measure.');
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure:validate] ok=false reason=${reason} D1_px=0 D2_px=0`
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
        }

        const graphics = graphicsFromAutoMeasureResult(result);
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
    console.log(`[measurement-scale] umPerPixel=${umPerPixel ?? 'unknown'}`);

    // 3) Bump the viewport refresh key so CameraWindow can clear any cached
    //    transforms and force a fresh draw at the new magnification.
    setObjectiveRefreshKey((k) => k + 1);

    // 4) Invalidate the live canvas so the next worker frame draws onto a
    //    cleared surface (no stale frame from the previous objective).
    cameraRef.current?.clearLiveCanvas();

    // 5) Clear any stale Auto Measure state from the previous magnification —
    //    snapshot frame, frozen overlay, preview overlay, and preview snapshot.
    //    Without this, a 40X frame/overlay can survive into a 10X session.
    committedAutoMeasureFrameRef.current = null;
    autoMeasurePreviewSnapshotRef.current = null;
    setCommittedAutoMeasureOverlay(null);
    setPreviewAutoMeasureOverlay(null);
    // eslint-disable-next-line no-console
    console.log(`[auto-measure-reset] reason=objective-change objective=${confirmed}`);

    // eslint-disable-next-line no-console
    console.log(`[viewport-refresh] completed objective=${confirmed}`);
  }, [
    liveMachineState?.confirmedObjectiveFromMachine,
    calibrationSettingsList,
    refetchCalibrationSettings,
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
    runAutoMeasure(autoMeasurePreviewSettings, false, 'auto-click');
  }, [autoMeasurePreviewSettings, runAutoMeasure]);

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
        resetManualMeasure();
      },
      autoMeasure: handleAutoMeasure,
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
            // eslint-disable-next-line no-console
            console.log('[ipc] device:open →');
            const reply = await window.hardnessCamera.openDevice({ index: 0 });
            // eslint-disable-next-line no-console
            console.log('[ipc] device:open ←', reply);
            // eslint-disable-next-line no-console
            console.log(`[camera-open] connected ok=${!!reply.camera.connected}`);
            // eslint-disable-next-line no-console
            console.log(`[camera-open] stream-started ok=${!!reply.camera.streaming}`);
            await cameraRef.current?.refetchStatus();
            if (!reply.camera.connected) {
              setUnavailableMsg(
                `Open Camera failed: ${reply.camera.error ?? reply.camera.message ?? 'unknown error'}`
              );
              return;
            }
            if (!reply.camera.streaming) {
              setUnavailableMsg(
                `Start Stream failed: ${reply.camera.error ?? reply.camera.message ?? 'unknown error'}`
              );
              return;
            }
            setStatusMessage('System Status: Camera streaming');

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
                  const gainReply = await window.hardnessCamera.setGain(saved.analogGain);
                  // eslint-disable-next-line no-console
                  console.log('[camera-settings] apply analogGain ok=', !!gainReply?.ok, gainReply);
                } catch (gainErr) {
                  // eslint-disable-next-line no-console
                  console.error('[camera-settings] apply analogGain threw', gainErr);
                }
                try {
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
            setCommittedAutoMeasureOverlay(null);
            setPreviewAutoMeasureOverlay(null);
            autoMeasurePreviewSnapshotRef.current = null;
            committedAutoMeasureFrameRef.current = null;
            previewMeasurementRef.current = null;
            autoMeasurementIdRef.current = null;
            resetManualMeasure();
            // Reset per-session log flags so the next open re-fires
            // [camera-frame] first-frame-after-open and the paint log.
            resetCameraSession();
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
      overlay.clearAll,
      overlay.trimLast,
      overlay.toggleCrossLine,
      resetManualMeasure,
      handleAutoMeasure,
      setActiveTool,
      serialPortSetting,
      connectMachineFn,
      disconnectMachineFn,
      refetchCameraSetting,
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
      const isModeSwitch = mappedTool !== undefined;
      // eslint-disable-next-line no-console
      console.log(
        `[toolbar] selected tool=${mappedTool ?? action} magnifier=${enteringMagnifier}`
      );

      // Magnifier must turn off the moment any other toolbar action runs.
      // Mode-switch actions clear it via setActiveTool inside the dispatcher;
      // one-shot actions do not, so we drop magnifier explicitly here.
      if (!enteringMagnifier && !isModeSwitch && activeTool === 'magnifier') {
        // eslint-disable-next-line no-console
        console.log('[magnifier] disabled reason=tool-change');
        setActiveTool('pointer');
      } else if (!enteringMagnifier && isModeSwitch && activeTool === 'magnifier') {
        // eslint-disable-next-line no-console
        console.log('[magnifier] disabled reason=tool-change');
      } else if (enteringMagnifier) {
        // eslint-disable-next-line no-console
        console.log('[magnifier] enabled');
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
          autoMeasureGraphicsSource={displayedAutoMeasureSource}
          crossLineVisible={overlay.crossLineVisible}
          onAddShape={overlay.addShape}
          manualMeasureResetKey={manualMeasureResetKey}
          manualMeasureObjective={activeObjective}
          objectiveRefreshKey={objectiveRefreshKey}
          onManualMeasurementUpdated={handleManualMeasurementUpdated}
          onAutoMeasureAdjusted={handleAutoMeasureAdjusted}
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
        />
      </Box>

      <StatusBar message={statusMessage} />

      <AutoMeasureSettingsDialog
        open={activeDialog === 'autoMeasure'}
        onClose={closeDialog}
        onPreviewChange={handleAutoMeasureSettingsPreviewChange}
        onSaved={handleAutoMeasureSettingsSaved}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
      <CalibrationDialog
        open={activeDialog === 'calibration'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
        onChanged={() => {
          void refetchCalibrations();
        }}
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
