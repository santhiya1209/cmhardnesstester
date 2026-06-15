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
import { useXyzAutoConnect } from '@/features/xyzPlatform/useXyzAutoConnect';
import { useCameraLifecycle } from '@/features/camera/useCameraLifecycle';
import { useCameraSettingsRestore } from '@/features/camera/useCameraSettingsRestore';
import {
  DEFAULT_AUTO_MEASURE_SETTINGS,
  normalizeAutoMeasureSettings,
  type AutoMeasureSettingsPayload,
} from '@/types/autoMeasureSettings';
import { DEFAULT_LINE_COLOR, LINE_COLOR_HEX } from '@/types/lineColorSetting';
import MenuBar from '@/component/own/MenuBar';
import Toolbar from '@/component/own/Toolbar';
import LeftPanel from '@/component/own/LeftPanel';
import ReticleModeLock from '@/features/multipoint/ReticleModeLock';
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
} from '@/hooks/cameraStreamManager';
import { useImageOverlay } from '@/hooks/useImageOverlay';
import { useLineThickness } from '@/hooks/useLineThickness';
import { useRenderCount } from '@/utils/renderStats';
import { dispatchToolbarAction } from '@/utils/toolDispatcher';
import { useMenuActions } from '@/features/shell/useMenuActions';
import { useToolDispatchContext } from '@/features/shell/useToolDispatchContext';
import { useSetStatusMessage } from '@/contexts/StatusMessageContext';
import { useDialog } from '@/contexts/DialogContext';
import { TOOL_ACTION_TO_TOOL, type ToolbarActionId, type MeasureSelection } from '@/types/tool';
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
  type CommitAutoMeasureSource,
} from '@/features/autoMeasure/autoMeasureHelpers';
import { useCommittedFingerprints } from '@/features/autoMeasure/useCommittedFingerprints';
import { resolveAutoMeasureCalibration } from '@/features/autoMeasure/resolveAutoMeasureCalibration';
import { useCameraPointSelect } from '@/features/multipoint/useCameraPointSelect';
import { runNativeDetection } from '@/features/autoMeasure/runNativeDetection';
import { validateDetectionResult } from '@/features/autoMeasure/validateDetectionResult';
import { useOverlayLifecycle } from '@/features/autoMeasure/useOverlayLifecycle';
import { useAutoMeasureSessionLifecycle } from '@/features/autoMeasure/useAutoMeasureSessionLifecycle';
import { useAutoMeasureRefs } from '@/features/autoMeasure/useAutoMeasureRefs';
import { useAfterImpressFlow } from '@/features/impress/useAfterImpressFlow';
import { useObjectiveSync } from '@/features/objective/useObjectiveSync';
import { useActiveMeasurement } from '@/features/measurement/useActiveMeasurement';
import {
  buildNewRowDepthPayload,
  deriveQualifiedForRow,
  waitForOverlayPaint,
  type DepthSavePayload,
} from '@/features/measurement/measurementRowHelpers';
import { useUmPerPixelForObjective } from '@/features/calibration/useUmPerPixelForObjective';
import { useTurretMotionGate } from '@/features/machine/useTurretMotionGate';
import { useObjectiveSyncGate } from '@/features/autoMeasure/useObjectiveSyncGate';
import { useManualMeasure } from '@/features/measurement/useManualMeasure';
import { useAutoMeasure } from '@/features/measurement/useAutoMeasure';
import { useManualMeasureLifecycle } from '@/features/manualMeasure/useManualMeasureLifecycle';
import { useCalibrationManualMeasure } from '@/features/manualMeasure/useCalibrationManualMeasure';
import type { MachineState } from '@/types/machine';
import { calculateVickersFromPixels, hasCalibrationForForce } from '@/utils/manualMeasure';
import { subscribeXyzStageState } from '@/api/xyzPlatform';

const ROOT_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100%',
};

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
  const setStatusMessage = useSetStatusMessage();
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
  const prevDialogRef = useRef<typeof activeDialog>(activeDialog);
  useEffect(() => {
    const prev = prevDialogRef.current;
    prevDialogRef.current = activeDialog;
    if (prev === 'testRecords' && activeDialog !== 'testRecords') {
      void refetchTestRecords();
    }
  }, [activeDialog, refetchTestRecords]);
  const micrometerEnabledRef = useRef(micrometerEnabled);
  const lastLoggedMicrometerEnabledRef = useRef<boolean | null>(null);
  useEffect(() => {
    micrometerEnabledRef.current = micrometerEnabled;
    if (lastLoggedMicrometerEnabledRef.current !== micrometerEnabled) {
      lastLoggedMicrometerEnabledRef.current = micrometerEnabled;
    }
  }, [micrometerEnabled]);
  const { refetch: refetchCameraSetting } = useCameraSetting();
  const { restoreCameraSettings } = useCameraSettingsRestore({ refetchCameraSetting });
  const { currentMachinePort, applyMachinePort } = useMachineConnection();
  useMicrometerAutoRestore();
  useXyzAutoConnect();

  const { saveMeasurement: saveManualMeasurement } = useSaveMeasurement();
  const { getSnapshot: getMachineStateSnapshot } = useMachineStateSnapshot();
  // Latest XYZ stage position, mirrored into a ref (NOT React state) so reading it
  // at measurement-save time never adds a re-render to this large root on every
  // serial position update. Populates xMm/yMm on each saved measurement row.
  const stagePositionRef = useRef<{ x: number; y: number; known: boolean }>({ x: 0, y: 0, known: false });
  useEffect(
    () =>
      subscribeXyzStageState((state) => {
        const mm = state.positionMm ?? state.position;
        if (mm && Number.isFinite(mm.x) && Number.isFinite(mm.y)) {
          stagePositionRef.current = { x: mm.x, y: mm.y, known: state.positionKnown ?? false };
        }
      }),
    []
  );
  const machineStore = useMachineStoreApi();
  const machineForce = useMachineSelector((s) => s?.force ?? null);
  const machineHardnessLevel = useMachineSelector((s) => s?.hardnessLevel ?? null);
  const machineConfirmedObjective = useMachineSelector(
    (s) => s?.confirmedObjectiveFromMachine ?? null
  );
  const machineTurretPosition = useMachineSelector((s) => s?.turretPosition ?? null);
  const machineIndentStatus = useMachineSelector((s) => s?.indentStatus ?? null);
  const machineLastObjectiveRx = useMachineSelector((s) => s?.lastObjectiveRx ?? null);
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
  // True only during the window between committing the auto-measure overlay
  // lines and confirming they painted on the canvas. While true, no clear may
  // wipe the latest overlay — that is the stale path that left "Detection
  // success" on screen with no visible lines.
  const overlayPaintPendingRef = useRef(false);
  const {
    autoMeasureInFlightRef,
    autoMeasurePendingPreviewRef,
    latestAutoMeasurePreviewSettingsRef,
    runAutoMeasureRef,
    autoMeasurePreviewSnapshotRef,
    committedAutoMeasureFrameRef,
    previewMeasurementRef,
    autoMeasureSettingsOpenRef,
    autoMeasureClickCountRef,
    autoMeasurementIdRef,
    autoMeasureSessionIdRef,
    suppressAutoMeasurePreviewRef,
  } = useAutoMeasureRefs();
  const [unavailableMsg, setUnavailableMsg] = useState<string | null>(null);
  const [calibrationRequiredMsg, setCalibrationRequiredMsg] = useState<string | null>(null);
  const [magnifierEnabled, setMagnifierEnabled] = useState(false);
  const [selectedMeasureMode, setSelectedMeasureMode] = useState<MeasureSelection>(null);
  const [cameraOpen, setCameraOpen] = useState(false);  const [turretMoving, setTurretMoving] = useState(false);
  const turretMovingRef = useRef(false);
  const setTurretMovingState = useCallback((moving: boolean) => {
    turretMovingRef.current = moving;
    setTurretMoving(moving);
  }, []);
  const [turretMovingTarget, setTurretMovingTarget] = useState<string | null>(null);
  const [autoMeasurePreviewSettings, setAutoMeasurePreviewSettings] =
    useState<AutoMeasureSettingsPayload>(DEFAULT_AUTO_MEASURE_SETTINGS);  const {
    activeMeasurementMethodRef,
    cameraMeasurementSessionIdRef,
    getActiveMeasurementId,
    setActiveMeasurement,
    clearActiveMeasurement,
  } = useActiveMeasurement();
  const committedFingerprintsRef = useCommittedFingerprints(measurements);
  const [activeObjective, setActiveObjective] = useState<string | null>(null);
  const activeObjectiveRef = useRef<string | null>(null);
  useEffect(() => {
    activeObjectiveRef.current = activeObjective;
  }, [activeObjective]);

  const cameraOpenRef = useRef(false);
  cameraOpenRef.current = cameraOpen;
  const calibrationReadyRef = useRef(false);
  const getAfterImpressReadiness = useCallback(
    () => ({
      cameraOpen: cameraOpenRef.current,
      activeObjective: activeObjectiveRef.current,
      calibrationReady: calibrationReadyRef.current,
    }),
    []
  );

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

  const [, setAutoMeasureSessionId] = useState(0);  const [objectiveChangeInProgress, setObjectiveChangeInProgress] = useState(false);
  const objectiveChangeInProgressRef = useRef(false);
  const setObjectiveChangeInProgressState = useCallback((inProgress: boolean) => {
    objectiveChangeInProgressRef.current = inProgress;
    setObjectiveChangeInProgress(inProgress);
  }, []);

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
    activeTool,
  });
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
    overlayPaintPendingRef,
  });

  const {
    impressInProgressRef,
    preserveAfterImpressOverlay,
    shouldPreserveAfterImpressOverlay,
  } = useAfterImpressFlow({
    machineIndentStatus,
    machineLastObjectiveRx,
    cameraRef,
    getAfterImpressReadiness,
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

  const handleCalibrationAutoMeasure = useCallback(
    async (objective: string): Promise<{ d1Px: number; d2Px: number } | null> => {
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
      const minConfidence =
        settings.imageType === 'HV-1' ? 0.52 : settings.imageType === 'HV-3' ? 0.38 : 0.45;
      committedAutoMeasureFrameRef.current = cloneCapturedFrame(frame);
      // Calibration Auto Measure runs the SAME native detection core as Normal
      // Auto Measure (runNativeDetection). The only mode difference is config:
      // calibration is pixels-only (no µm/px calibration, no test force) at the
      // detection step — objective/smoothing/threshold resolution and the
      // measureVickersAuto invocation are shared, not duplicated.
      const { nativeResult: result } = await runNativeDetection({
        preview: false,
        callSource: 'auto-click',
        settings,
        objectiveForCalibration: objective,
        displayedFrame: frame,
        capturedFrameIdForRun: getLastPaintedFrameId(),
        calibration: null,
        forceKgf: null,
        minConfidence,
      });
      if (!result.ok || !hasValidAutoMeasureCorners(result)) {
        const reason = result.ok ? 'invalid corner coordinates' : result.reason;
        setStatusMessage(`System Status: Calibration Auto Measure rejected: ${reason}`);
        return null;
      }
      setAutoMeasureSessionActive(true);
      setCommittedAutoMeasureOverlay(graphicsFromAutoMeasureResult(result, objective));
      // eslint-disable-next-line no-console
      console.log(`[calibration-auto-success] pixelX=${result.d1Pixels.toFixed(2)} pixelY=${result.d2Pixels.toFixed(2)}`);
      return { d1Px: result.d1Pixels, d2Px: result.d2Pixels };
    },
    [autoMeasureSettings, setActiveTool, setCalibrationMeasureMode]
  );

  const umPerPixelForActiveObjective = useUmPerPixelForObjective({
    activeObjective,
    calibrationSettings,
    calibrationSettingsList,
    calibrations,
    machineStore,
    machineForce,
    machineHardnessLevel,
  });
  calibrationReadyRef.current = umPerPixelForActiveObjective != null;

  // Multipoint camera-click point selection: a click on the live camera moves the
  // stage (RX-gated, via the backend relocation engine) so the clicked feature is
  // brought to the objective, then captures the ACTUAL landed position as a point.
  const cameraPointSelect = useCameraPointSelect({
    umPerPixel: umPerPixelForActiveObjective,
    setStatusMessage,
  });

  const handleUpdateShape = overlay.updateShape;

  const openCalibrationPanel = useCallback(
    (_source: 'menu' | 'toolbar' | 'snackbar' = 'menu') => {
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
      clearAutoMeasureOverlay('calibration-open');
      setAutoMeasureClearNonce((n) => n + 1);
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
  );  const { handleManualMeasurementUpdated } = useManualMeasure({
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
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-validate] cornersValid=true linesValid=true d1Valid=${d1Px > 0} d2Valid=${d2Px > 0} overlayValid=pending`
      );

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

      const shouldCheckDuplicate = source === 'auto-click' || source === 'after-impress';
      if (shouldCheckDuplicate) {
        const existing = committedFingerprintsRef.current;
        let matchedEntry: typeof existing[number] | null = null;
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
          // eslint-disable-next-line no-console
          console.log(
            `[auto-overlay-commit] success=true hasGeometry=${!!restoredGraphics.corners} frameId=${restoredGraphics.frameId ?? 'n/a'} objective=${restoredGraphics.objective ?? 'unknown'}`
          );
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
            const restoredKey = autoMeasureCornersKey(restoredGraphics.corners);
            let shown = displayedAutoMeasureGraphicsRef.current;
            let visible = !!shown && autoMeasureCornersKey(shown.corners) === restoredKey;
            if (!visible) {
              await waitForOverlayPaint();
              shown = displayedAutoMeasureGraphicsRef.current;
              visible = !!shown && autoMeasureCornersKey(shown.corners) === restoredKey;
            }
            if (!visible) {
              // eslint-disable-next-line no-console
              console.log(`[auto-overlay-render] visible=false reason=${shown ? 'frame-mismatch' : 'cleared'}`);
              logAfterImpressDetectionFailed('overlay-not-ready');
              setAutoMeasureStatus('failed');
              setStatusMessage('System Status: Auto Measure rejected: overlay not ready');
              return false;
            }
            // eslint-disable-next-line no-console
            console.log(`[auto-overlay-render] visible=true reason=ok`);
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

      const forceOverlayRefresh = source === 'auto-click' || source === 'after-impress';
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-final-corners] session=${graphics.sessionId ?? 'n/a'} objective=${graphics.objective ?? 'n/a'} key=${autoMeasureCornersKey(graphics.corners)}`
      );
      setCommittedAutoMeasureOverlay((prev) => {
        if (!forceOverlayRefresh && prev && graphicsAlmostEqual(prev, graphics)) {
          return prev;
        }
        return { ...graphics, corners: { ...graphics.corners } };
      });
      const committedHasGeometry = !!graphics.corners;
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-overlay-lines-set] lines=4 session=${graphics.sessionId ?? 'n/a'} objective=${objectiveForCalibration ?? 'unknown'}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[auto-overlay-commit] success=true hasGeometry=${committedHasGeometry} frameId=${graphics.frameId ?? 'n/a'} objective=${graphics.objective ?? 'unknown'}`
      );
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-overlay-commit] graphics=${committedHasGeometry} lines=4 objective=${objectiveForCalibration ?? 'unknown'} source=${source}`
      );
      setPreviewAutoMeasureOverlay(null);
      autoMeasurePreviewSnapshotRef.current = null;
      previewMeasurementRef.current = null;

      const timestamp = new Date().toISOString();
      let saveRowId: string | undefined =
        autoMeasurementIdRef.current ?? undefined;
      if (saveRowId === undefined) {
        saveRowId = getActiveMeasurementId();
      }
      const isNewAutoMeasurement = saveRowId === undefined;
      const depthCapture: DepthSavePayload | null = isNewAutoMeasurement
        ? await buildNewRowDepthPayload(micrometerEnabledRef.current)
        : null;      const values = conversion.value;

      if (values.hv === null || forceKgf === null || forceKgf === undefined || forceKgf <= 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[measurement-commit-blocked] method=Auto reason=force-missing objective=${objectiveForCalibration} forceKgf=${forceKgf ?? 'null'}`
        );
        setUnavailableMsg('Force value missing');
        setStatusMessage('System Status: Auto Measure blocked: Force value missing');
        return false;
      }      await waitForOverlayPaint();
      const committedCornersKey = autoMeasureCornersKey(graphics.corners);
      const overlayShowsThisRun = () => {
        const shown = displayedAutoMeasureGraphicsRef.current;
        return !!shown && autoMeasureCornersKey(shown.corners) === committedCornersKey;
      };
      let overlayVisible = overlayShowsThisRun();
      if (!overlayVisible) {
        await waitForOverlayPaint();
        overlayVisible = overlayShowsThisRun();
      }
      if (!overlayVisible) {
        const shown = displayedAutoMeasureGraphicsRef.current;
        const liveObjectiveNow = (activeObjectiveRef.current ?? '').trim().toUpperCase();
        const overlayObjectiveNow = (graphics.objective ?? '').trim().toUpperCase();
        const reason = !graphics.corners
          ? 'no-geometry'
          : !shown
            ? 'cleared'
            : overlayObjectiveNow && liveObjectiveNow && overlayObjectiveNow !== liveObjectiveNow
              ? 'objective-mismatch'
              : 'frame-mismatch';
        // eslint-disable-next-line no-console
        console.log(`[auto-overlay-render] visible=false reason=${reason}`);
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
      } else {
        preserveAfterImpressOverlay(1500);
      }
      // eslint-disable-next-line no-console
      console.log(`[auto-overlay-render] visible=true reason=ok`);
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-overlay-render] visible=true lines=4 objective=${objectiveForCalibration ?? 'unknown'}`
      );
      const finalCornersKey = autoMeasureCornersKey(graphics.corners);

      // Hard paint gate. The render gate above only proves the overlay PASSED
      // React's display filter — not that the canvas actually drew the 4 lines.
      // Confirm the real paint (overlayDrawnKeyRef) before success / save. While
      // confirming, overlayPaintPendingRef blocks any clear from wiping it.
      overlayPaintPendingRef.current = true;
      const overlayPainted =
        (await cameraRef.current?.confirmOverlayPainted(finalCornersKey)) ?? false;
      overlayPaintPendingRef.current = false;

      const cornerPoints = graphics.corners
        ? [graphics.corners.top, graphics.corners.right, graphics.corners.bottom, graphics.corners.left]
        : [];
      const fourLinesPresent =
        cornerPoints.length === 4 &&
        cornerPoints.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
      const d1Valid = Number.isFinite(values.d1Um) && values.d1Um > 0;
      const d2Valid = Number.isFinite(values.d2Um) && values.d2Um > 0;
      const davgValid = Number.isFinite(values.avgDUm) && values.avgDUm > 0;
      const hardnessValid =
        typeof values.hv === 'number' && Number.isFinite(values.hv) && values.hv > 0;

      const saveBlockedReason =
        !d1Valid || !d2Valid || !davgValid
          ? 'diagonal-invalid'
          : !hardnessValid
            ? 'hardness-invalid'
            : !fourLinesPresent
              ? 'overlay-lines-missing'
              : !overlayVisible
                ? 'overlay-not-visible'
                : !overlayPainted
                  ? 'overlay-not-painted'
                  : null;
      if (saveBlockedReason) {
        // eslint-disable-next-line no-console
        console.log(`[measurement-save-blocked] reason=${saveBlockedReason}`);
        if (!overlayPainted) {
          // Keep the frozen frame + the committed overlay; do NOT resume live
          // and do NOT clear before the lines are confirmed painted.
          // eslint-disable-next-line no-console
          console.log('[auto-measure-live-resume-blocked] reason=overlay-not-painted');
        }
        if (source === 'after-impress') {
          logAfterImpressDetectionFailed(saveBlockedReason);
        }
        setAutoMeasureStatus('failed');
        setUnavailableMsg('Measurement lines are not visible. Please run Auto Measure again.');
        setStatusMessage(
          'System Status: Measurement lines are not visible. Please run Auto Measure again.'
        );
        return false;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[auto-measure-overlay-painted] session=${graphics.sessionId ?? 'n/a'} key=${finalCornersKey}`
      );
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
      const overlayImageReady = !!imageDataUrl;
      // eslint-disable-next-line no-console
      console.log(`[auto-measure-overlay-visible] visible=true imageReady=${overlayImageReady}`);
      if (!overlayImageReady) {
        // eslint-disable-next-line no-console
        console.warn(
          `[auto-measure-overlay-visible] visible=true imageReady=false reason=canvas-not-painted source=${source}`
        );
      }
      // eslint-disable-next-line no-console
      console.log('[auto-measure-save-gate] overlayCommitted=true overlayVisible=true');

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
        // True stage position at the moment the measurement is taken — gives each
        // row (incl. every Multipoint point) its X/Y. Null when the stage position
        // is not yet known (e.g. before homing / non-stage measurements).
        xMm: stagePositionRef.current.known ? stagePositionRef.current.x : null,
        yMm: stagePositionRef.current.known ? stagePositionRef.current.y : null,
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
      // eslint-disable-next-line no-console
      console.log(`[measurement-save] source=auto-measure allowed=true isNew=${isNewAutoMeasurement}`);
      let saved;
      try {
        saved = await saveManualMeasurement({
          id: saveRowId,
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

  // Start-time prerequisite for a Multipoint run: the (active objective, selected
  // force) pair must be calibrated BEFORE the first point moves/indents — the
  // measurement-save gate alone would let the stage move + indent first. Reuses
  // the same lookup (`hasCalibrationForForce`) and the same "Calibration Required"
  // dialog the Auto Measure / Impress gates use. Returns false (and shows the
  // dialog) to abort Start; true to proceed. Wired to the Multipoint Start button.
  const validateMultipointCalibration = useCallback(async (): Promise<boolean> => {
    const machineState = await getMachineStateSnapshot();
    const activeObjectiveSnapshot = activeObjectiveRef.current?.trim().toUpperCase() || null;
    const objectiveForCalibration = objectiveForMeasureFromObjective(activeObjectiveSnapshot);
    const calibrated =
      !!objectiveForCalibration &&
      hasCalibrationForForce(calibrations, objectiveForCalibration, machineState?.force);
    if (!calibrated) {
      // eslint-disable-next-line no-console
      console.warn(
        `[multipoint-start-blocked] reason=calibration-required objective=${objectiveForCalibration ?? 'null'} force=${machineState?.force ?? 'null'}`
      );
      setCalibrationRequiredMsg(
        'The selected objective and/or force has not been calibrated.\nPlease complete calibration before running a Multipoint program.'
      );
      return false;
    }
    return true;
  }, [getMachineStateSnapshot, calibrations]);

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
      if (preview) {
        autoMeasurePendingPreviewRef.current = settingsInput;
      }
      return Promise.resolve(false);
    }

    return (async (): Promise<boolean> => {
      let settings = normalizeAutoMeasureSettings(settingsInput);
      if (!preview && callSource !== 'after-impress') {
        setCommittedAutoMeasureOverlay(() => null);
        setPreviewAutoMeasureOverlay(null);
        autoMeasurePreviewSnapshotRef.current = null;
        autoMeasurementIdRef.current = null;
      }

      autoMeasureInFlightRef.current = true;
      const sessionIdForRun = autoMeasureSessionIdRef.current + 1;
      autoMeasureSessionIdRef.current = sessionIdForRun;
      setAutoMeasureSessionId(sessionIdForRun);
      setAutoMeasureSessionActive(true);
      const isFreshCapture = callSource === 'auto-click' || callSource === 'after-impress';
      if (isFreshCapture) {
        setAutoMeasureStatus('detecting');
        setCameraStatus('frozen');
        // eslint-disable-next-line no-console
        console.log(`[auto-measure-start] source=${callSource} session=${sessionIdForRun}`);
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
        // Block measurement-creating runs when the selected force is not
        // calibrated for the active objective. This runs BEFORE any frame
        // capture, detection, HV calculation or save, so an uncalibrated force
        // never produces a measurement row. Previews are exempt (they never
        // save), and so is the Calibration dialog's own Auto Measure mode, which
        // must run to CREATE the calibration in the first place.
        const isCalibrationModeRun =
          calibrationMeasureModeRef.current !== 'none' || calibrationManualModeRef.current;
        if (!preview && !isCalibrationModeRun) {
          if (!hasCalibrationForForce(calibrations, objectiveForCalibration, machineState?.force)) {
            const forceRaw = machineState?.force;
            const forceLabel =
              forceRaw != null && String(forceRaw).trim() !== '' ? String(forceRaw).trim() : null;
            const forceText = forceLabel ?? 'The selected force';
            // eslint-disable-next-line no-console
            console.warn(
              `[auto-measure-blocked] reason=force-not-calibrated objective=${objectiveForCalibration} force=${forceLabel ?? 'null'}`
            );
            setCalibrationRequiredMsg(
              `${forceText} has not been calibrated.\nPlease complete calibration for ${forceText} before performing Auto Measure.`
            );
            setStatusMessage(`System Status: Auto Measure blocked: ${forceText} not calibrated`);
            if (isFreshCapture) setAutoMeasureStatus('failed');
            return false;
          }
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
          displayedFrame = cameraRef.current?.captureDisplayedFrame({ freeze: true });
        } else {
          displayedFrame = committedAutoMeasureFrameRef.current;
          if (!displayedFrame && callSource === 'settings-preview') {
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
            return false;
          }
          {
            const stale = displayedFrame?.error ?? 'no-displayed-image (stale-frame)';
            setUnavailableMsg(`Auto Measure rejected: ${stale}. Please use manual measure.`);
            setStatusMessage(`System Status: Auto Measure rejected: ${stale}`);
            clearAutoMeasureOverlay(
              callSource === 'after-impress' ? 'after-impress-detection-failed' : 'auto-measure-failed'
            );
            if (isFreshCapture) setAutoMeasureStatus('failed');
            if (callSource === 'after-impress') {
              logAfterImpressDetectionFailed(stale);
              // eslint-disable-next-line no-console
              console.log('[auto-measure-overlay] cleared reason=after-impress-detection-failed');
            }
          }
          return false;
        }

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
        }        const graphics: AutoMeasureGraphics = {
          ...graphicsFromAutoMeasureResult(result, objectiveForCalibration),
          sessionId: sessionIdForRun,
          frameId: capturedFrameIdForRun,
        };
        if (callSource === 'after-impress' && result.ok) {
          // eslint-disable-next-line no-console
          console.log('[auto-measure] detection-success corners=4');
        }
        if (!preview && (callSource === 'auto-click' || callSource === 'after-impress')) {
          // eslint-disable-next-line no-console
          console.log(
            `[auto-measure-detection-success] lines=4 d1=${result.d1Pixels.toFixed(1)} d2=${result.d2Pixels.toFixed(1)}`
          );
        }
        if (sessionIdForRun !== autoMeasureSessionIdRef.current) {
          if (callSource === 'after-impress') {
            logAfterImpressDetectionFailed('session-mismatch');
          }
          return false;
        }
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
          if (calibrationMeasureModeRef.current === 'auto') {
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
        if (preview) {
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

  useEffect(() => {
    runAutoMeasureRef.current = runAutoMeasure;
  }, [runAutoMeasure]);

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
      runAutoMeasureRef.current?.(autoMeasurePreviewSettings, true, 'settings-preview');
    }, 70);

    return () => window.clearTimeout(timer);
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

  useEffect(() => {
    if (activeDialog !== 'autoMeasure') return;
    // eslint-disable-next-line no-console
    console.warn(
      `[auto-settings-open] objective=${activeObjective ?? 'null'} frozenFrame=${autoMeasureCapturedFrameId ?? (committedAutoMeasureFrameRef.current ? 'present' : 'none')}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDialog]);  const { markTurretIntent } = useTurretMotionGate({
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
    autoMeasureClickCountRef.current += 1;
    // eslint-disable-next-line no-console
    console.log(`[auto-measure-click] firstAfterStartup=${autoMeasureClickCountRef.current === 1}`);
    if (activeTool === 'manualMeasure') {
      setActiveTool('pointer');
      resetManualMeasure();
    }
    suppressAutoMeasurePreviewRef.current = false;
    runAutoMeasure(autoMeasurePreviewSettings, false, 'auto-click');
  }, [activeTool, autoMeasurePreviewSettings, resetManualMeasure, runAutoMeasure, setActiveTool]);

  const autoMeasureSelectedLineRef = useRef<'top' | 'right' | 'bottom' | 'left' | null>(null);

  const { handleAutoMeasureAdjusted } = useAutoMeasure({
    previewAutoMeasureOverlay,
    setPreviewAutoMeasureOverlay,
    setCommittedAutoMeasureOverlay,
    displayedAutoMeasureGraphicsRef,
    activeObjectiveRef,
    autoMeasurementIdRef,
    autoMeasureSelectedLineRef,
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

  const [autoMeasureSelectedLine, setAutoMeasureSelectedLine] = useState<
    'top' | 'right' | 'bottom' | 'left' | null
  >(null);
  autoMeasureSelectedLineRef.current = autoMeasureSelectedLine;

  const autoMeasureKeyboardActive =
    cameraOpen &&
    activeTool === 'pointer' &&
    (activeDialog === null ||
      (activeDialog === 'calibration' &&
        calibrationMeasureModeRef.current === 'auto'));

  const handleAutoMeasureLineSelected = useCallback(
    (line: 'top' | 'right' | 'bottom' | 'left' | null) => {
      setAutoMeasureSelectedLine(line);
      if (line && calibrationMeasureModeRef.current === 'auto') {
        // eslint-disable-next-line no-console
        console.log(`[calibration-line-select] line=${line}`);
      }
    },
    [calibrationMeasureModeRef]
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

      if (action === 'tools:manualMeasure') {
        // Manual Measure must always start from a clean, isolated overlay state.
        // Dispose every other overlay's geometry so nothing stale survives into
        // the fresh session: auto-measure overlay + detection state, the length/
        // angle annotation shapes, and the prior manual guides. The multipoint
        // dots are hidden (not destroyed) via CameraWindow's PatternOverlay gate.
        clearAutoMeasureOverlay('enter-manual-measure');
        setAutoMeasureClearNonce((n) => n + 1);
        overlay.clearByKind('length');
        overlay.clearByKind('angle');
        manualMeasurementIdRef.current = null;
        resetManualMeasure();
      }

      if (activeTool === 'measureLength' && mappedTool !== 'measureLength' && !openingConfigPanel) {
        overlay.clearByKind('length');
      }

      if (!enteringMagnifier && magnifierEnabled && action !== 'tools:manualMeasure' && !openingConfigPanel) {
        setMagnifierEnabled(false);
      }

      if (action === 'tools:autoMeasure') {
        setSelectedMeasureMode('auto');
      } else if (action === 'tools:manualMeasure') {
        setSelectedMeasureMode('manual');
      } else if (mappedTool) {
        setSelectedMeasureMode(null);
      }

      dispatchToolbarAction(action, buildSharedCtx());
      persistToolbarAction(action);
    },
    [
      activeTool,
      buildSharedCtx,
      clearAutoMeasureOverlay,
      magnifierEnabled,
      manualMeasurementIdRef,
      overlay,
      persistToolbarAction,
      resetManualMeasure,
      setAutoMeasureClearNonce,
      setActiveTool,
    ]
  );

  useEffect(() => {
    if (selectedMeasureMode === 'manual' && activeTool !== 'manualMeasure') {
      setSelectedMeasureMode(null);
    }
  }, [activeTool, selectedMeasureMode]);  useEffect(() => {
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
    activeForce: machineForce == null ? null : String(machineForce),
    latestManualPixels,
    calibrationManualModeRef,
    setCalibrationMeasureMode,
    setManualMeasureResetKey,
    setAutoMeasureSessionActive,
    setActiveTool,
    clearAutoMeasureOverlay,
    closeDialog,
    setStatusMessage,
    refetchCalibrations,
    onRequestAutoMeasure: handleCalibrationAutoMeasure,
    onRequestManualMeasure: handleCalibrationManualMeasure,
  });

  return (
    <Box sx={ROOT_SX}>
      <ReticleModeLock onLockChange={overlay.lockCrossLine} />
      <MenuBar onSelect={handleMenuSelect} />
      <Toolbar
        onSelect={handleToolbarSelect}
        cameraOpen={cameraOpen}
        selectedMeasureMode={selectedMeasureMode}
      />

      <Box sx={WORKSPACE_SX}>
        <LeftPanel
          ref={cameraRef}
          activeTool={activeTool}
          overlayShapes={overlay.shapes}
          autoMeasureGraphics={displayedAutoMeasureGraphics}
          autoMeasureClearNonce={autoMeasureClearNonce}
          autoMeasureGraphicsSource={displayedAutoMeasureSource}
          crossLineVisible={overlay.crossLineVisible}
          crosshairConfig={overlay.crosshairConfig}
          onAddShape={overlay.addShape}
          manualMeasureResetKey={manualMeasureResetKey}
          manualMeasureObjective={activeObjective}
          objectiveRefreshKey={objectiveRefreshKey}
          onManualMeasurementUpdated={handleManualMeasurementUpdated}
          onAutoMeasureAdjusted={handleAutoMeasureAdjusted}
          onAutoMeasureLineSelected={handleAutoMeasureLineSelected}
          autoMeasureSelectedLine={autoMeasureSelectedLine}
          autoMeasureKeyboardActive={autoMeasureKeyboardActive}
          magnifierEnabled={magnifierEnabled}
          onClearShapeKind={overlay.clearByKind}
          lineStrokeWidth={lineThickness.strokeWidth}
          turretMoving={turretMoving}
          turretMovingTarget={turretMovingTarget}
          cameraOpen={cameraOpen}
          umPerPixel={umPerPixelForActiveObjective}
          onUpdateShape={handleUpdateShape}
          pointSelectActive={cameraPointSelect.selecting}
          pointSelectHint={cameraPointSelect.hint}
          onPointSelectPick={cameraPointSelect.handlePick}
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
          onToolbarAction={handleToolbarSelect}
          onValidateMultipointStart={validateMultipointCalibration}
          selectedMeasureMode={selectedMeasureMode}
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
        calibrationRequiredMsg={calibrationRequiredMsg}
        setCalibrationRequiredMsg={setCalibrationRequiredMsg}
        openCalibrationPanel={openCalibrationPanel}
        measurements={measurements}
        testRecordMeasurementIds={testRecordMeasurementIds}
        crosshairConfig={overlay.crosshairConfig}
        onCrosshairConfigChange={overlay.setCrosshairConfig}
        crossLineVisible={overlay.crossLineVisible}
        onToggleCrossLine={overlay.toggleCrossLine}
      />
    </Box>
  );
}

export default App;
