import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useCalibrationDialogSlot } from '@/features/calibration/useCalibrationDialogSlot';
import AppDialogs from '@/features/shell/AppDialogs';
import { useLineColorSetting } from '@/hooks/queries/useLineColorSetting';
import { useCalibrationSettings } from '@/hooks/queries/useCalibrationSettings';
import { useCalibrations } from '@/hooks/queries/useCalibrations';
import { useAutoMeasureSettings } from '@/hooks/queries/useAutoMeasureSettings';
import { useMicrometerConfig } from '@/hooks/queries/useMicrometerConfig';
import { useTestRecords } from '@/hooks/queries/useTestRecords';
import { useCameraSetting } from '@/hooks/queries/useCameraSetting';
import { useMachineStateSnapshot } from '@/hooks/queries/useMachineStateSnapshot';
import {
  useMachineSelector,
  useMachineStoreApi,
} from '@/contexts/MachineStateContext';
import { useSaveMeasurement } from '@/hooks/mutations/useSaveMeasurement';
import { useMachineConnection } from '@/features/machine/useMachineConnection';
import { useMicrometerAutoRestore } from '@/features/machine/useMicrometerAutoRestore';
import { measureVickersAuto } from '@/api/system';
import { useCameraLifecycle } from '@/features/camera/useCameraLifecycle';
import { useCameraSettingsRestore } from '@/features/camera/useCameraSettingsRestore';
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
import { useMeasurements } from '@/hooks/queries/useMeasurements';
import { useToolbarActionPersistence } from '@/features/shell/useToolbarActionPersistence';
import { useActiveTool } from '@/hooks/useActiveTool';
import {
  getLastPaintEpoch,
  getLastPaintedFrameId,
} from '@/hooks/useCameraStream';
import { useImageOverlay } from '@/hooks/useImageOverlay';
import { useLineThickness } from '@/hooks/useLineThickness';
import { useRenderCount } from '@/utils/renderStats';
import { dispatchToolbarAction } from '@/utils/toolDispatcher';
import { useMenuActions } from '@/features/shell/useMenuActions';
import { useToolDispatchContext } from '@/features/shell/useToolDispatchContext';
import { useSetStatusMessage } from '@/contexts/StatusMessageContext';
import { useDialog } from '@/contexts/DialogContext';
import { TOOL_ACTION_TO_TOOL, type ToolbarActionId } from '@/types/tool';
import type {
  AutoMeasureCorners,
  AutoMeasureGraphics,
} from '@/types/autoMeasure';
import { autoMeasureCornersKey } from '@/utils/autoMeasureOverlayKey';
import {
  AUTO_MEASURE_CENTER_TOLERANCE_PX,
  AUTO_MEASURE_CORNER_TOLERANCE_PX,
  AUTO_MEASURE_DIAGONAL_TOLERANCE_PX,
  AUTO_MEASURE_HARDNESS_TOLERANCE_HV,
  applyAutoMeasureObjectiveProfile,
  autoMeasureSettingsEqual,
  buildAutoMeasureFingerprintKey,
  cloneAutoMeasureGraphics,
  cloneCapturedFrame,
  finiteOrNull,
  getAutoMeasureMaxCornerDelta,
  graphicsAlmostEqual,
  graphicsFromAutoMeasureResult,
  hasValidAutoMeasureCorners,
  logAutoMeasureDetectResult,
  logAutoMeasurePhase,
  logUnexpectedAutoMeasureCall,
  normalizeAutoMeasureFingerprintObjective,
  objectiveForMeasureFromObjective,
  roundAutoMeasurePixel,
  upsertCommittedAutoMeasureFingerprint,
  validateAutoMeasureGeometry,
  type AutoMeasureCallSource,
  type AutoMeasureDetectionSnapshot,
  type CapturedAutoMeasureFrame,
  type CommitAutoMeasureSource,
  type RunAutoMeasure,
} from '@/features/autoMeasure/autoMeasureHelpers';
import { useCommittedFingerprints } from '@/features/autoMeasure/useCommittedFingerprints';
import { resolveAutoMeasureCalibration } from '@/features/autoMeasure/resolveAutoMeasureCalibration';
import { runNativeDetection } from '@/features/autoMeasure/runNativeDetection';
import { validateDetectionResult } from '@/features/autoMeasure/validateDetectionResult';
import { useOverlayLifecycle } from '@/features/autoMeasure/useOverlayLifecycle';
import { useAutoMeasureSessionLifecycle } from '@/features/autoMeasure/useAutoMeasureSessionLifecycle';
import { useAfterImpressFlow } from '@/features/impress/useAfterImpressFlow';
import { useObjectiveSync } from '@/features/objective/useObjectiveSync';
import { useActiveMeasurement } from '@/features/measurement/useActiveMeasurement';
import {
  buildNewRowDepthPayload,
  deriveQualifiedForRow,
  waitForOverlayPaint,
  type DepthSavePayload,
} from '@/features/measurement/measurementRowHelpers';
import { useCalibrationRowSave } from '@/features/calibration/useCalibrationRowSave';
import { useUmPerPixelForObjective } from '@/features/calibration/useUmPerPixelForObjective';
import { useTurretMotionGate } from '@/features/machine/useTurretMotionGate';
import { useObjectiveSyncGate } from '@/features/machine/useObjectiveSyncGate';
import { useManualMeasureSave } from '@/features/measurement/useManualMeasureSave';
import { useAutoAdjustedSave } from '@/features/measurement/useAutoAdjustedSave';
import { useAutoMeasureKeyboardAdjust } from '@/hooks/useAutoMeasureKeyboardAdjust';
import { useManualMeasureLifecycle } from '@/features/manualMeasure/useManualMeasureLifecycle';
import { useCalibrationManualMeasure } from '@/features/manualMeasure/useCalibrationManualMeasure';
import type { MachineState } from '@/types/machine';
import { calculateVickersFromPixels } from '@/utils/manualMeasure';

const ROOT_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100%',
  // overflow: 'hidden',
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

function logAfterImpressDetectionFailed(reason: string) {
  // eslint-disable-next-line no-console
  console.warn(`[after-impress-detection-failed] reason=${reason}`);
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
  const { persistToolbarAction, refetchToolbarState } = useToolbarActionPersistence({
    setStatusMessage,
  });
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
  const { data: testRecordsList, refetch: refetchTestRecords } = useTestRecords();
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
  // When the Sample Info (testRecords) dialog closes, refetch so targetMinHv /
  // targetMaxHv update immediately without requiring an app restart.
  const prevDialogRef = useRef<typeof activeDialog>(activeDialog);
  useEffect(() => {
    const prev = prevDialogRef.current;
    prevDialogRef.current = activeDialog;
    if (prev === 'testRecords' && activeDialog !== 'testRecords') {
      void refetchTestRecords();
    }
  }, [activeDialog, refetchTestRecords]);
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
  const { restoreCameraSettings } = useCameraSettingsRestore({ refetchCameraSetting });
  // Machine COM port lifecycle (selection, connect/disconnect, one-shot
  // auto-connect from persisted settings) lives in useMachineConnection so
  // App is not in the business of orchestrating serial reconnects.
  const { currentMachinePort, applyMachinePort } = useMachineConnection();
  useMicrometerAutoRestore();

  const { saveMeasurement: saveManualMeasurement } = useSaveMeasurement();
  const { getSnapshot: getMachineStateSnapshot } = useMachineStateSnapshot();
  // Single shared machine-state subscription lives in MachineStateProvider.
  // App subscribes only to the slices it actually reacts to, so unrelated
  // field updates (loadTime, sync/status, lightness) no longer re-render App.
  const machineStore = useMachineStoreApi();
  const machineForce = useMachineSelector((s) => s?.force ?? null);
  const machineHardnessLevel = useMachineSelector((s) => s?.hardnessLevel ?? null);
  const machineConfirmedObjective = useMachineSelector(
    (s) => s?.confirmedObjectiveFromMachine ?? null
  );
  const machineTurretPosition = useMachineSelector((s) => s?.turretPosition ?? null);
  const machineIndentStatus = useMachineSelector((s) => s?.indentStatus ?? null);
  const machineLastObjectiveRx = useMachineSelector((s) => s?.lastObjectiveRx ?? null);
  // Mirror the full snapshot to a ref so impress-complete / turret-after-impress
  // closures can read current machine state without subscribing for re-renders.
  // The observational lightness tracking (previously its own effect) is folded
  // in here so it stays a pure ref-write that never re-renders App.
  const liveMachineStateRef = useRef<MachineState | null>(machineStore.getSnapshot());
  const lastLoggedLightnessRef = useRef<string | null>(null);
  useEffect(() => {
    const sync = () => {
      const snap = machineStore.getSnapshot();
      liveMachineStateRef.current = snap;
      const lv = snap?.lightness;
      if (lv !== undefined && lv !== null) {
        const next = String(lv);
        if (lastLoggedLightnessRef.current !== next) {
          lastLoggedLightnessRef.current = next;
        }
      }
    };
    sync();
    return machineStore.subscribe(sync);
  }, [machineStore]);
  const {
    manualMeasurementIdRef,
    manualMeasureResetKey,
    setManualMeasureResetKey,
    latestManualPixels,
    setLatestManualPixels,
    latestManualPixelsRef,
    resetManualMeasure,
  } = useManualMeasureLifecycle();
  const { activeTool, setActiveTool } = useActiveTool('pointer');
  const overlay = useImageOverlay();
  const lineThickness = useLineThickness();
  useRenderCount('App');
  const cameraRef = useRef<CameraWindowHandle | null>(null);
  const autoMeasureInFlightRef = useRef(false);
  // Set true between Impress TX and the FINISH RX so any concurrent Auto
  // Measure entry point (manual click, settings preview, drag-recompute) is
  // refused — the indenter is still over the workpiece, the live frame is
  // mid-motion, and any detection would commit a row for the wrong instant.
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
  // Magnifier is an independent helper overlay (not a mode). It can be on
  // alongside Manual Measure for precision diamond-tip placement, and turns
  // off when the user switches to Pointer/Auto Measure (see handleToolbarSelect).
  const [magnifierEnabled, setMagnifierEnabled] = useState(false);
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
  const turretMovingRef = useRef(false);
  const setTurretMovingState = useCallback((moving: boolean) => {
    turretMovingRef.current = moving;
    setTurretMoving(moving);
  }, []);
  // Target objective for an in-progress turret move ("10X" / "40X").
  // Surfaced in the CameraWindow "Turret moving to X..." popup so the
  // operator knows exactly what the camera is switching to.
  const [turretMovingTarget, setTurretMovingTarget] = useState<string | null>(null);
  const [autoMeasurePreviewSettings, setAutoMeasurePreviewSettings] =
    useState<AutoMeasureSettingsPayload>(DEFAULT_AUTO_MEASURE_SETTINGS);
  const autoMeasurementIdRef = useRef<string | null>(null);
  const {
    activeMeasurementMethodRef,
    cameraMeasurementSessionIdRef,
    getActiveMeasurementId,
    setActiveMeasurement,
    clearActiveMeasurement,
  } = useActiveMeasurement();
  const committedFingerprintsRef = useCommittedFingerprints(measurements);
  // SINGLE GLOBAL SOURCE OF TRUTH for the active objective.
  // - Set only by the objective commit pipeline after machine ACK/RX.
  // - Hydrated from machine-confirmed SSE state through that same pipeline.
  // - Used by Auto Measure, Manual Measure, calibration lookup, and the
  //   measurement table row.
  // - There is NO silent fallback to a hardcoded default. If this is ever
  //   null at save time, we surface a warning instead of saving "10X".
  const [activeObjective, setActiveObjective] = useState<string | null>(null);
  // Shared ref mirror of activeObjective: useAfterImpressFlow needs it before
  // useObjectiveSync runs (circular dep), so the ref lives here and both hooks
  // read/write through it. The sync effect is here too.
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

  // Bumped on objective change to force a re-render; the value itself is read
  // via autoMeasureSessionIdRef, so only the setter is bound here.
  const [, setAutoMeasureSessionId] = useState(0);
  const autoMeasureSessionIdRef = useRef(0);
  const [objectiveChangeInProgress, setObjectiveChangeInProgress] = useState(false);
  const objectiveChangeInProgressRef = useRef(false);
  const setObjectiveChangeInProgressState = useCallback((inProgress: boolean) => {
    objectiveChangeInProgressRef.current = inProgress;
    setObjectiveChangeInProgress(inProgress);
  }, []);

  // Overlay lifecycle state + hard render gate live in useOverlayLifecycle.
  // These setters are destructured here because clearAutoMeasureOverlay (from
  // useAutoMeasureSessionLifecycle, below) drives them alongside App-owned
  // controller/measurement/camera-frame refs.
  const {
    committedAutoMeasureOverlay,
    setCommittedAutoMeasureOverlay,
    previewAutoMeasureOverlay,
    setPreviewAutoMeasureOverlay,
    autoMeasureClearNonce,
    setAutoMeasureClearNonce,
    autoMeasureSessionActive,
    setAutoMeasureSessionActive,
    autoMeasureCapturedFrameId,
    setAutoMeasureCapturedFrameId,
    displayedAutoMeasureGraphics,
    displayedAutoMeasureSource,
    displayedAutoMeasureGraphicsRef,
  } = useOverlayLifecycle({
    cameraOpen,
    activeDialog,
    turretMoving,
    objectiveChangeInProgress,
    activeObjective,
  });

  // Set true whenever the active objective changes. The next would-be
  // settings-preview run is skipped so an objective change never paints
  // yellow lines on its own — they appear only after an explicit Auto
  // Measure click. Cleared by the click handler.
  const suppressAutoMeasurePreviewRef = useRef(false);
  const { clearAutoMeasureOverlay } = useAutoMeasureSessionLifecycle({
    setCommittedAutoMeasureOverlay,
    setPreviewAutoMeasureOverlay,
    autoMeasurePreviewSnapshotRef,
    committedAutoMeasureFrameRef,
    previewMeasurementRef,
    autoMeasurementIdRef,
    autoMeasurePendingPreviewRef,
    autoMeasureSettingsOpenRef,
    setAutoMeasureSessionActive,
    setAutoMeasureCapturedFrameId,
    setAutoMeasureSessionId,
    autoMeasureSessionIdRef,
  });

  const {
    impressInProgressRef,
    preserveAfterImpressOverlay,
    shouldPreserveAfterImpressOverlay,
  } = useAfterImpressFlow({
    machineIndentStatus,
    machineLastObjectiveRx,
    cameraRef,
    activeObjectiveRef,
    autoMeasureInFlightRef,
    runAutoMeasureRef,
    displayedAutoMeasureGraphicsRef,
    autoMeasurementIdRef,
    latestAutoMeasurePreviewSettingsRef,
    liveMachineStateRef,
    suppressAutoMeasurePreviewRef,
    setAutoMeasureStatus,
    setStatusMessage,
    setManualMeasureResetKey,
    setAutoMeasureClearNonce,
    clearActiveMeasurement,
    clearAutoMeasureOverlay,
  });

  useObjectiveSyncGate({
    activeObjective,
    shouldPreserveAfterImpressOverlay,
    setAutoMeasurePreviewSettings,
    latestAutoMeasurePreviewSettingsRef,
    suppressAutoMeasurePreviewRef,
    setCommittedAutoMeasureOverlay,
    setPreviewAutoMeasureOverlay,
    autoMeasurePreviewSnapshotRef,
    committedAutoMeasureFrameRef,
    previewMeasurementRef,
    setAutoMeasureSessionActive,
    setAutoMeasureCapturedFrameId,
    setAutoMeasureSessionId,
    autoMeasureSessionIdRef,
    setAutoMeasureStatusState,
    setAutoMeasureClearNonce,
  });

  const {
    calibrationManualModeRef,
    calibrationMeasureModeRef,
    setCalibrationMeasureMode,
    handleCalibrationManualMeasure,
  } = useCalibrationManualMeasure({
    clearAutoMeasureOverlay,
    setActiveTool,
    setAutoMeasureSessionActive,
    setStatusMessage,
  });

  const {
    objectiveRefreshKey,
    lastSyncedObjectiveRef,
    handleObjectiveChangeFromUI,
    handleCenterCommit,
  } = useObjectiveSync({
    activeObjective,
    setActiveObjective,
    activeObjectiveRef,
    cameraOpen,
    cameraRef,
    machineConfirmedObjective,
    activeTool,
    manualMeasureResetKey,
    getMachineStateSnapshot,
    refetchCalibrationSettings,
    shouldPreserveAfterImpressOverlay,
    clearAutoMeasureOverlay,
    setObjectiveChangeInProgressState,
  });

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
      // eslint-disable-next-line no-console
      console.log(`[calibration-auto-click] detectionStarted=true`);
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
      // eslint-disable-next-line no-console
      console.log(`[calibration-auto-success] pixelX=${result.d1Pixels.toFixed(2)} pixelY=${result.d2Pixels.toFixed(2)}`);
      return { d1Px: result.d1Pixels, d2Px: result.d2Pixels };
    },
    [autoMeasureSettings, setActiveTool, setCalibrationMeasureMode]
  );

  const { handleCalibrationAutoCreateRow } = useCalibrationRowSave({
    activeObjectiveRef,
    calibrationMeasureModeRef,
    manualMeasurementIdRef,
    autoMeasurementIdRef,
    activeMeasurementMethodRef,
    calibrationSettingsList,
    cameraRef,
    setUnavailableMsg,
    setStatusMessage,
    setCommittedAutoMeasureOverlay,
    setPreviewAutoMeasureOverlay,
    setManualMeasureResetKey,
    getActiveMeasurementId,
    setActiveMeasurement,
    saveManualMeasurement,
    refetchMeasurements,
  });

  const umPerPixelForActiveObjective = useUmPerPixelForObjective({
    activeObjective,
    calibrationSettings,
    calibrationSettingsList,
    calibrations,
    machineStore,
    machineForce,
    machineHardnessLevel,
  });

  const handleUpdateShape = overlay.updateShape;

  const openCalibrationPanel = useCallback(
    (source: 'menu' | 'toolbar' | 'snackbar' = 'menu') => {
      if (source === 'toolbar') {
      }

      // TEMP DEBUG: snapshot every overlay source at the instant Calibration
      // opens, BEFORE the clear runs, so the actual rendered source of any
      // lingering yellow lines is visible in the console.
      const graphicsObjects =
        (committedAutoMeasureOverlay ? 1 : 0) + (previewAutoMeasureOverlay ? 1 : 0);
      // eslint-disable-next-line no-console
      console.log(
        `[calibration-open-debug] committedAutoMeasureOverlay=${!!committedAutoMeasureOverlay} autoMeasureSessionActive=${autoMeasureSessionActive} calibrationOverlay=${calibrationMeasureModeRef.current !== 'none'} graphicsObjects=${graphicsObjects}`
      );

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
      // 1) Null the React overlay state (committed + preview + session) so the
      //    render gate stops emitting the yellow Auto Measure graphics.
      clearAutoMeasureOverlay('calibration-open');
      // 2) Force an imperative canvas clearRect via the clear nonce. React
      //    state-null alone is NOT enough: a requestAnimationFrame queued by
      //    the just-completed Auto Measure draw can repaint stale yellow lines
      //    AFTER the state cleared. Bumping the nonce drives
      //    AutoMeasureOverlay.forceClearCanvas synchronously, exactly like the
      //    proven Clear Graphics path does.
      setAutoMeasureClearNonce((n) => n + 1);
      // 3) Reset the manual-measure overlay too, so no overlay source survives
      //    into calibration regardless of which tool was active.
      setManualMeasureResetKey((k) => k + 1);
      setActiveTool('pointer');
      setActiveDialog('calibration');
      // eslint-disable-next-line no-console
      console.log('[calibration-open] imageVisible=true overlayVisible=false');
    },
    [
      activeTool,
      autoMeasureSessionActive,
      calibrationManualModeRef,
      clearAutoMeasureOverlay,
      committedAutoMeasureOverlay,
      magnifierEnabled,
      overlay.clearByKind,
      previewAutoMeasureOverlay,
      resetManualMeasure,
      setActiveTool,
      setAutoMeasureClearNonce,
      setCalibrationMeasureMode,
      setManualMeasureResetKey,
    ]
  );


  const { handleManualMeasurementUpdated } = useManualMeasureSave({
    activeObjectiveRef,
    manualMeasurementIdRef,
    calibrationManualModeRef,
    micrometerEnabledRef,
    autoMeasurementIdRef,
    activeMeasurementMethodRef,
    measurements,
    calibrationSettings,
    calibrations,
    calibrationSettingsList,
    cameraRef,
    setUnavailableMsg,
    setStatusMessage,
    setLatestManualPixels,
    getMachineStateSnapshot,
    getActiveMeasurementId,
    setActiveMeasurement,
    saveManualMeasurement,
    refetchMeasurements,
  });

  useEffect(() => {
    const normalized = normalizeAutoMeasureSettings(autoMeasureSettings);
    // Per-objective defaults are authoritative for smoothing/threshold. The
    // persisted settings are a SINGLE GLOBAL row, so without this the global
    // value clobbers the active objective's tuned defaults that the
    // objective-change effect set — e.g. selecting 10X snaps to {4,44} but a
    // later autoMeasureSettings load/refetch would overwrite it with the saved
    // global (often 40X-shaped) numbers. Honor the objective defaults here so
    // 10X stays smoothing=4/threshold=44 with objectiveForMeasure=10X and
    // 40X stays smoothing=6/threshold=91; unrelated fields still come from
    // the persisted row.
    const resolved = applyAutoMeasureObjectiveProfile(normalized, activeObjectiveRef.current);
    latestAutoMeasurePreviewSettingsRef.current = resolved;
    setAutoMeasurePreviewSettings(resolved);
  }, [autoMeasureSettings]);

  const handleAutoMeasureSettingsPreviewChange = useCallback((settings: AutoMeasureSettingsPayload) => {
    const base = normalizeAutoMeasureSettings(settings);
    const active = objectiveForMeasureFromObjective(activeObjectiveRef.current);
    const normalized =
      active && base.objectiveForMeasure !== active
        ? applyAutoMeasureObjectiveProfile(base, active)
        : base;
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
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-validate] success=false reason=${validation.reason} cornersValid=false d1Valid=${d1Px > 0} d2Valid=${d2Px > 0} overlayValid=false`
        );
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
      // Geometry passed — overlay validity is still pending until after paint.
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-validate] cornersValid=true linesValid=true d1Valid=${d1Px > 0} d2Valid=${d2Px > 0} overlayValid=pending`
      );

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
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-final-corners] session=${graphics.sessionId ?? 'n/a'} objective=${graphics.objective ?? 'n/a'} key=${autoMeasureCornersKey(graphics.corners)}`
      );
      setCommittedAutoMeasureOverlay((prev) => {
        if (!forceOverlayRefresh && prev && graphicsAlmostEqual(prev, graphics)) {
          return prev;
        }
        if (source === 'auto-click' || source === 'after-impress') {
        }
        return { ...graphics, corners: { ...graphics.corners } };
      });
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-overlay-commit] corners=4 lines=4 objective=${objectiveForCalibration ?? 'unknown'} source=${source}`
      );
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
      // Overlay visibility gate — applies to EVERY source, not just after-impress.
      // setCommittedAutoMeasureOverlay was called above, but useOverlayLifecycle
      // has several render guards (turretMoving, objectiveChangeInProgress,
      // autoMeasureSessionActive, frameId mismatch) that can silently suppress
      // display even when the committed overlay is non-null. Without this check
      // a measurement row is saved with "success" status but no visible lines.
      if (!displayedAutoMeasureGraphicsRef.current) {
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-validate] success=false reason=overlay-not-visible source=${source}`
        );
        // eslint-disable-next-line no-console
        console.log(`[measurement-save] source=auto-measure allowed=false reason=invalid-overlay`);
        if (source === 'after-impress') {
          logAfterImpressDetectionFailed('overlay-not-ready');
        }
        setAutoMeasureStatus('failed');
        setStatusMessage('System Status: Auto Measure rejected: overlay not visible after render');
        setUnavailableMsg('Auto Measure overlay failed to render. Please retry.');
        clearAutoMeasureOverlay(
          source === 'after-impress' ? 'after-impress-detection-failed' : 'auto-measure-overlay-not-visible'
        );
        return false;
      }
      if (source === 'after-impress') {
        preserveAfterImpressOverlay(5000);
      }
      // Overlay is confirmed visible — log render success.
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-overlay-render] visible=true lines=4 objective=${objectiveForCalibration ?? 'unknown'}`
      );
      // Deterministic finalize: capture ONLY after the overlay canvas has
      // painted these exact final corners — never a preview/stale/blank scrape.
      const finalCornersKey = autoMeasureCornersKey(graphics.corners);
      // eslint-disable-next-line no-console
      console.log(
        `[album-overlay-source] source=committed-final session=${graphics.sessionId ?? 'n/a'} key=${finalCornersKey}`
      );
      // eslint-disable-next-line no-console
      console.log(`[album-overlay-session] session=${graphics.sessionId ?? 'n/a'}`);
      const imageDataUrl =
        (await cameraRef.current?.captureFinalizedThumbnail(finalCornersKey)) ?? undefined;
      if (imageDataUrl) {
        // eslint-disable-next-line no-console
        console.log(`[album-overlay-save] session=${graphics.sessionId ?? 'n/a'} key=${finalCornersKey}`);
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
      // eslint-disable-next-line no-console
      console.log(`[measurement-save] source=auto-measure allowed=true isNew=${isNewAutoMeasurement}`);
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
      if (source === 'settings-save') {
        // eslint-disable-next-line no-console
        console.warn(
          `[auto-settings-save] objective=${saved.objective ?? values.normalizedObjective ?? 'null'} d1=${values.d1Um}um d2=${values.d2Um}um hv=${saved.hv ?? values.hv ?? 'null'}`
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[measurement-add] objective=${saved.objective ?? values.normalizedObjective ?? 'null'} method=${savedAutoMethod} hv=${saved.hv ?? 'null'} new=${isNewAutoMeasurement}`
        );
      }
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

    if (objectiveChangeInProgressRef.current || turretMovingRef.current) {
      if (!preview) {
        setStatusMessage('System Status: Auto Measure blocked: objective switch in progress');
      }
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
      let settings = normalizeAutoMeasureSettings(settingsInput);
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
        const activeObjectiveSnapshot = activeObjectiveRef.current?.trim().toUpperCase() || null;
        const machineConfirmed = machineState?.confirmedObjectiveFromMachine?.trim() || null;
        const objectiveForCalibration = objectiveForMeasureFromObjective(activeObjectiveSnapshot);
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-objective-check] activeObjective=${activeObjectiveSnapshot ?? 'null'} machineConfirmed=${machineConfirmed ?? 'null'} resolved=${objectiveForCalibration ?? 'null'}`
        );
        if (callSource === 'auto-click') {
          // eslint-disable-next-line no-console
          console.warn(
            `[auto-measure-click] activeObjective=${activeObjectiveSnapshot ?? 'null'} machineConfirmed=${machineConfirmed ?? 'null'}`
          );
        }
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
            `[measurement-commit-blocked] method=Auto reason=no-active-objective activeObjective=${activeObjectiveSnapshot ?? 'null'} machineConfirmed=${machineConfirmed ?? 'null'}`
          );
          // eslint-disable-next-line no-console
          console.warn('[auto-measure-blocked] reason=no-active-objective');
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
        const resolvedObjectiveForMeasure = objectiveForCalibration;
        if (settings.objectiveForMeasure !== resolvedObjectiveForMeasure) {
          const profiledSettings = applyAutoMeasureObjectiveProfile(settings, objectiveForCalibration);
          settings = profiledSettings;
          latestAutoMeasurePreviewSettingsRef.current = profiledSettings;
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-settings-sync] objective=${resolvedObjectiveForMeasure} smoothing=${profiledSettings.smoothing} threshold=${profiledSettings.threshold}`
          );
          if (callSource === 'auto-click' || callSource === 'after-impress') {
            setAutoMeasurePreviewSettings((prev) =>
              autoMeasureSettingsEqual(prev, profiledSettings) ? prev : profiledSettings
            );
          }
        }
        const { machineStateForAuto, calibration, forceKgf } = resolveAutoMeasureCalibration({
          machineState,
          objectiveForCalibration,
          calibrationSettings,
          calibrationSettingsList,
          calibrations,
          callSource,
        });
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
          if (!displayedFrame && callSource === 'settings-preview') {
            // No prior fresh capture in this session — settings preview must
            // not silently early-return. Capture the current frame once so
            // the user's first slider drag has something to fit against, and
            // commit it as the session's frame for subsequent drags.
            const fresh = cameraRef.current?.captureDisplayedFrame({ freeze: true });
            if (fresh?.ok) {
              displayedFrame = fresh;
              committedAutoMeasureFrameRef.current = cloneCapturedFrame(fresh);
              // eslint-disable-next-line no-console
              console.warn('[auto-settings-preview-frame] source=fresh-capture');
            } else {
              // eslint-disable-next-line no-console
              console.warn('[auto-settings-preview-no-frame]');
            }
          }
        }
        let capturedFrameIdForRun: number | null = autoMeasureCapturedFrameId;
        if (isFreshCapture) {
          const capturedFrameId = getLastPaintedFrameId();
          capturedFrameIdForRun = capturedFrameId;
          setAutoMeasureCapturedFrameId(capturedFrameId);
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
            clearAutoMeasureOverlay(
              callSource === 'after-impress' ? 'after-impress-detection-failed' : 'auto-measure-failed'
            );
            if (isFreshCapture) setAutoMeasureStatus('failed');
            // liveObjectiveForNative is declared further down — this branch
            // fires before it's computed (no displayed image), so log it as
            // 'unknown'.
            if (callSource === 'after-impress') {
              logAfterImpressDetectionFailed(stale);
              // eslint-disable-next-line no-console
              console.log('[auto-measure-overlay] cleared reason=after-impress-detection-failed');
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
            clearAutoMeasureOverlay(
              callSource === 'after-impress' ? 'after-impress-detection-failed' : 'auto-measure-failed'
            );
            if (isFreshCapture) setAutoMeasureStatus('failed');
          }
          if (callSource === 'after-impress') {
            logAfterImpressDetectionFailed('invalid-detection-frame');
            // eslint-disable-next-line no-console
            console.log('[auto-measure-overlay] cleared reason=after-impress-detection-failed');
          }
          return false;
        }

        if (callSource === 'after-impress') {
          // eslint-disable-next-line no-console
          console.log('[auto-measure] detection-start source=after-impress');
        }

        // Log the frame dimensions used for detection so coordinate-space
        // mismatches can be spotted in the console.
        // eslint-disable-next-line no-console
        console.log(
          `[auto-measure-coords] imageWidth=${displayedFrame.width} imageHeight=${displayedFrame.height} objective=${objectiveForCalibration ?? 'unknown'} source=${displayedFrame.source}`
        );

        if (isFreshCapture) {
          committedAutoMeasureFrameRef.current = cloneCapturedFrame(displayedFrame);
        }
        const { nativeResult, liveObjectiveForNative, runSmoothing, runThreshold } =
          await runNativeDetection({
            preview,
            callSource,
            settings,
            objectiveForCalibration,
            displayedFrame,
            capturedFrameIdForRun,
            calibration,
            forceKgf,
            minConfidence,
          });

        const { nativeObjective, resolvedDetection } = validateDetectionResult({
          nativeResult,
          liveObjectiveForNative,
          runSmoothing,
          runThreshold,
        });
        const logDetectResult = (
          success: boolean,
          corners: AutoMeasureCorners | null | undefined
        ) => {
          logAutoMeasureDetectResult(liveObjectiveForNative, success, corners);
        };
        if (
          liveObjectiveForNative === '10X' &&
          nativeObjective !== '10X' &&
          nativeObjective !== ''
        ) {
          const reason = `native-branch-not-used (requested=10X native=${nativeObjective})`;
          logDetectResult(false, null);
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
            clearAutoMeasureOverlay(
              callSource === 'after-impress' ? 'after-impress-detection-failed' : 'auto-measure-failed'
            );
            if (isFreshCapture) setAutoMeasureStatus('failed');
          }
          if (callSource === 'after-impress') {
            logAfterImpressDetectionFailed(reason);
            // eslint-disable-next-line no-console
            console.log('[auto-measure-overlay] cleared reason=after-impress-detection-failed');
          }
          return false;
        }
        if (!resolvedDetection.ok) {
          const reason = resolvedDetection.reason;
          logDetectResult(false, null);
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
          clearAutoMeasureOverlay(
            callSource === 'after-impress' ? 'after-impress-detection-failed' : 'auto-measure-failed'
          );
          // eslint-disable-next-line no-console
          console.warn(
            `[measurement-commit-blocked] method=Auto reason=detection-rejected detail="${reason}"`
          );
          // eslint-disable-next-line no-console
          console.warn('[auto-measure-blocked] reason=detection-failed');
          if (callSource === 'after-impress') {
            logAfterImpressDetectionFailed(reason);
            // eslint-disable-next-line no-console
            console.log(`[auto-measure] detection-failed source=after-impress reason=${reason}`);
            // eslint-disable-next-line no-console
            console.log('[auto-measure-overlay] cleared reason=after-impress-detection-failed');
          }
          return false;
        }

        const result = resolvedDetection.result;
        const detectionMethod = resolvedDetection.method;
        logDetectResult(true, result.corners);
        if (callSource === 'auto-click') {
          // eslint-disable-next-line no-console
          console.warn(
            `[auto-measure-success] objective=${objectiveForCalibration ?? 'null'} d1=${result.d1Pixels.toFixed(2)}px d2=${result.d2Pixels.toFixed(2)}px hv=${result.hv ?? 'null'}`
          );
        }
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
          // eslint-disable-next-line no-console
          console.log('[auto-measure] detection-success corners=4');
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
          const liveConfirmed = activeObjectiveRef.current?.trim() || null;
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
          // eslint-disable-next-line no-console
          console.log('[auto-measure-overlay] shown source=after-impress');
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
          if (callSource === 'settings-preview') {
            // eslint-disable-next-line no-console
            console.warn(
              `[auto-settings-preview] objective=${objectiveForCalibration ?? 'null'} smoothing=${runSmoothing} threshold=${runThreshold} d1=${result.d1Pixels.toFixed(2)}px d2=${result.d2Pixels.toFixed(2)}px confidence=${result.confidence.toFixed(3)}`
            );
          }
          setPreviewAutoMeasureOverlay((prev) => {
            if (prev && graphicsAlmostEqual(prev, graphics)) {
              return prev;
            }
            return graphics;
          });
          if (callSource === 'settings-preview') {
            const cc = graphics.corners;
            // eslint-disable-next-line no-console
            console.warn(
              `[auto-settings-preview-update] smoothing=${runSmoothing} threshold=${runThreshold} corners=L(${cc.left.x.toFixed(0)},${cc.left.y.toFixed(0)}) R(${cc.right.x.toFixed(0)},${cc.right.y.toFixed(0)}) T(${cc.top.x.toFixed(0)},${cc.top.y.toFixed(0)}) B(${cc.bottom.x.toFixed(0)},${cc.bottom.y.toFixed(0)})`
            );
          }
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
            // eslint-disable-next-line no-console
            console.log('[measurement-save] source=after-impress');
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
          clearAutoMeasureOverlay(
            callSource === 'after-impress' ? 'after-impress-detection-failed' : 'auto-measure-failed'
          );
        }
        if (callSource === 'after-impress') {
          logAfterImpressDetectionFailed(err instanceof Error ? err.message : String(err));
          // eslint-disable-next-line no-console
          console.log('[auto-measure-overlay] cleared reason=after-impress-detection-failed');
        }
        return false;
      } finally {
        autoMeasureInFlightRef.current = false;
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
      const base = normalizeAutoMeasureSettings(settings);
      const active = objectiveForMeasureFromObjective(activeObjectiveRef.current);
      const normalized =
        active && base.objectiveForMeasure !== active
          ? applyAutoMeasureObjectiveProfile(base, active)
          : base;
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

  // Settings dialog open log. Fires when Auto Measure Settings opens so the
  // operator's re-fit session is anchored to the frozen frame in the log
  // trail. Deps = [activeDialog] only, so this runs solely on dialog transition.
  useEffect(() => {
    if (activeDialog !== 'autoMeasure') return;
    // eslint-disable-next-line no-console
    console.warn(
      `[auto-settings-open] objective=${activeObjective ?? 'null'} frozenFrame=${autoMeasureCapturedFrameId ?? (committedAutoMeasureFrameRef.current ? 'present' : 'none')}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDialog]);

  // Observational lightness tracking is folded into the machineStore ref-sync
  // effect above (a pure ref-write that never re-renders App).

  const { markTurretIntent } = useTurretMotionGate({
    machineTurretPosition,
    cameraStatus,
    setTurretMovingState,
    setTurretMovingTarget,
    setPreviewAutoMeasureOverlay,
    setAutoMeasureSessionActive,
    setManualMeasureResetKey,
    clearAutoMeasureOverlay,
    shouldPreserveAfterImpressOverlay,
  });

  const handleAutoMeasure = useCallback(() => {
    if (activeTool === 'manualMeasure') {
      setActiveTool('pointer');
      resetManualMeasure();
    }
    suppressAutoMeasurePreviewRef.current = false;
    runAutoMeasure(autoMeasurePreviewSettings, false, 'auto-click');
  }, [activeTool, autoMeasurePreviewSettings, resetManualMeasure, runAutoMeasure, setActiveTool]);

  const { handleAutoMeasureAdjusted } = useAutoAdjustedSave({
    previewAutoMeasureOverlay,
    setPreviewAutoMeasureOverlay,
    setCommittedAutoMeasureOverlay,
    displayedAutoMeasureGraphicsRef,
    activeObjectiveRef,
    autoMeasurementIdRef,
    calibrationManualModeRef,
    calibrationMeasureModeRef,
    committedFingerprintsRef,
    manualMeasurementIdRef,
    activeMeasurementMethodRef,
    measurements,
    calibrationSettings,
    calibrations,
    calibrationSettingsList,
    cameraRef,
    setUnavailableMsg,
    setStatusMessage,
    setLatestManualPixels,
    getMachineStateSnapshot,
    getActiveMeasurementId,
    setActiveMeasurement,
    saveManualMeasurement,
    refetchMeasurements,
  });

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

  // Shared selection state: both mouse click and keyboard Tab write this.
  // Passed into the keyboard hook (for Tab cycling) and down to AutoMeasureOverlay
  // (for white/thicker visual highlight) and the mouse-click handler below.
  const [autoMeasureSelectedLine, setAutoMeasureSelectedLine] = useState<
    'top' | 'right' | 'bottom' | 'left' | null
  >(null);

  // Keyboard-based fine adjustment. Active only when the camera is open, no
  // dialog is open, and the pointer tool is selected.
  useAutoMeasureKeyboardAdjust({
    selectedLine: autoMeasureSelectedLine,
    setSelectedLine: setAutoMeasureSelectedLine,
    committedAutoMeasureOverlay,
    setCommittedAutoMeasureOverlay,
    onAdjusted: handleAutoMeasureAdjusted,
    isActive: cameraOpen && activeDialog === null && activeTool === 'pointer',
  });

  // Called when the operator clicks a yellow line with the mouse. Sets the
  // shared selectedLine so keyboard arrows immediately control that line.
  const handleAutoMeasureLineSelected = useCallback(
    (line: 'top' | 'right' | 'bottom' | 'left') => {
      setAutoMeasureSelectedLine(line);
    },
    []
  );

  const openCameraSettingsPanel = useCallback(() => {
    setActiveDialog('camera');
  }, []);

  const { openCameraDevice, closeCameraDevice } = useCameraLifecycle({
    cameraRef,
    cameraMeasurementSessionIdRef,
    micrometerConfig,
    currentMachinePort,
    autoMeasurePreviewSnapshotRef,
    committedAutoMeasureFrameRef,
    previewMeasurementRef,
    autoMeasurementIdRef,
    manualMeasurementIdRef,
    committedFingerprintsRef,
    autoMeasurePendingPreviewRef,
    autoMeasureSettingsOpenRef,
    autoMeasureSessionIdRef,
    lastSyncedObjectiveRef,
    setCameraOpen,
    setCameraStatus,
    setAutoMeasureStatus,
    setUnavailableMsg,
    setCommittedAutoMeasureOverlay,
    setPreviewAutoMeasureOverlay,
    setAutoMeasureClearNonce,
    setAutoMeasureSessionActive,
    setAutoMeasureCapturedFrameId,
    setAutoMeasureSessionId,
    setActiveTool,
    resetManualMeasure,
    clearAutoMeasureOverlay,
    clearActiveMeasurement,
    restoreCameraSettings,
    refetchCalibrationSettings,
    setStatusMessage,
  });

  const { buildSharedCtx } = useToolDispatchContext({
    cameraRef,
    setActiveTool,
    setStatusMessage,
    setUnavailableMsg,
    overlayClearAll: overlay.clearAll,
    overlayTrimLast: overlay.trimLast,
    overlayToggleCrossLine: overlay.toggleCrossLine,
    resetManualMeasure,
    manualMeasurementIdRef,
    setLineThickness: lineThickness.setThickness,
    setMagnifierEnabled,
    setTrimMeasureOpen,
    handleAutoMeasure,
    clearAutoMeasureOverlay,
    setAutoMeasureClearNonce,
    setCommittedAutoMeasureOverlay,
    setPreviewAutoMeasureOverlay,
    autoMeasurePreviewSnapshotRef,
    committedAutoMeasureFrameRef,
    previewMeasurementRef,
    autoMeasurementIdRef,
    committedFingerprintsRef,
    openCalibrationPanel,
    openCameraSettingsPanel,
    openCameraDevice,
    closeCameraDevice,
  });

  const testRecordMeasurementIds = useMemo(() => {
    if (initialTestRecordMeasurementIds.length > 0) {
      return initialTestRecordMeasurementIds;
    }

    return measurements.map((measurement) => measurement.id);
  }, [initialTestRecordMeasurementIds, measurements]);

  const { handleMenuSelect } = useMenuActions({
    openCalibrationPanel,
    openCameraSettingsPanel,
    openTestRecordsDialog,
    setActiveDialog,
    setExitConfirmOpen,
    buildSharedCtx,
  });

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
      persistToolbarAction(action);
    },
    [
      activeTool,
      buildSharedCtx,
      clearAutoMeasureOverlay,
      committedAutoMeasureOverlay,
      magnifierEnabled,
      overlay,
      persistToolbarAction,
      previewAutoMeasureOverlay,
      setActiveTool,
    ]
  );


  useEffect(() => {
    const hex = LINE_COLOR_HEX[lineColorSetting?.lineColor ?? DEFAULT_LINE_COLOR];
    document.documentElement.style.setProperty('--line-color', hex);
  }, [lineColorSetting?.lineColor]);

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

  // Stable interactive props for RightPanel so its memo holds across unrelated
  // App re-renders (notably machine-state pushes). Inline arrows / a freshly
  // built calibrationSlot element previously created new identities every
  // render and forced RightPanel + its subtree to re-render on every update.
  const handleTurretIntentClick = useCallback(
    () => markTurretIntent('turret-click'),
    [markTurretIntent]
  );
  const handleObjectiveChangeIntent = useCallback(
    (target: '10X' | '40X') => markTurretIntent('objective-change-click', target),
    [markTurretIntent]
  );
  const handleCloseTrimMeasure = useCallback(
    () => setTrimMeasureOpen(false),
    [setTrimMeasureOpen]
  );
  const { calibrationSlot } = useCalibrationDialogSlot({
    calibrationOpen: activeDialog === 'calibration',
    activeObjective,
    latestManualPixels,
    calibrationManualModeRef,
    setCalibrationMeasureMode,
    setManualMeasureResetKey,
    setAutoMeasureSessionActive,
    clearAutoMeasureOverlay,
    closeDialog,
    setStatusMessage,
    refetchCalibrations,
    onRequestAutoMeasure: handleCalibrationAutoMeasure,
    onRequestManualMeasure: handleCalibrationManualMeasure,
    onAutoCreateMeasurementRow: handleCalibrationAutoCreateRow,
  });

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
          onAutoMeasureLineSelected={handleAutoMeasureLineSelected}
          autoMeasureSelectedLine={autoMeasureSelectedLine}
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
          activeObjective={activeObjective}
          onObjectiveChange={handleObjectiveChangeFromUI}
          onCenterCommit={handleCenterCommit}
          onTurretIntent={handleTurretIntentClick}
          onObjectiveChangeIntent={handleObjectiveChangeIntent}
          trimMeasureOpen={trimMeasureOpen}
          onCloseTrimMeasure={handleCloseTrimMeasure}
          onTrimAdjust={handleTrimAdjust}
          calibrationActive={activeDialog === 'calibration'}
          calibrationSlot={calibrationSlot}
        />
      </Box>

      <StatusBar
        cameraStatus={cameraStatus}
        objective={activeObjective}
        autoMeasureStatus={autoMeasureStatus}
      />

      <AppDialogs
        activeDialog={activeDialog}
        closeDialog={closeDialog}
        setStatusMessage={setStatusMessage}
        activeObjective={activeObjective}
        handleAutoMeasureSettingsPreviewChange={handleAutoMeasureSettingsPreviewChange}
        handleAutoMeasureSettingsSaved={handleAutoMeasureSettingsSaved}
        refetchLineColor={refetchLineColor}
        refetchMicrometerConfig={refetchMicrometerConfig}
        refetchMeasurements={refetchMeasurements}
        refetchToolbarState={refetchToolbarState}
        currentMachinePort={currentMachinePort}
        applyMachinePort={applyMachinePort}
        exitConfirmOpen={exitConfirmOpen}
        setExitConfirmOpen={setExitConfirmOpen}
        unavailableMsg={unavailableMsg}
        setUnavailableMsg={setUnavailableMsg}
        openCalibrationPanel={openCalibrationPanel}
        measurements={measurements}
        testRecordMeasurementIds={testRecordMeasurementIds}
      />
    </Box>
  );
}

export default App;
