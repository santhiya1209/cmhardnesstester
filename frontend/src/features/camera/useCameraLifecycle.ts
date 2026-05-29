import { useCallback } from 'react';
import { listSerialPorts } from '@/api/serialPort';
import type { CameraWindowHandle } from '@/component/own/CameraWindow';
import type {
  AutoMeasureStatusState,
  CameraStatusState,
} from '@/component/own/StatusBar';
import { resetCameraSession } from '@/hooks/useCameraStream';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';
import type {
  AutoMeasureDetectionSnapshot,
  CapturedAutoMeasureFrame,
  CommittedAutoMeasureFingerprint,
} from '@/features/autoMeasure/autoMeasureHelpers';
import type { MicrometerConfig } from '@/types/micrometerConfig';
import type { ToolId } from '@/types/tool';

export type UseCameraLifecycleArgs = {
  // Refs read by the open path
  cameraRef: React.RefObject<CameraWindowHandle | null>;
  cameraMeasurementSessionIdRef: React.MutableRefObject<number>;

  // Closure state read by the open path
  micrometerConfig: MicrometerConfig | null | undefined;
  currentMachinePort: string | null;

  // Refs nulled / cleared by the close path
  autoMeasurePreviewSnapshotRef: React.MutableRefObject<AutoMeasureDetectionSnapshot | null>;
  committedAutoMeasureFrameRef: React.MutableRefObject<CapturedAutoMeasureFrame | null>;
  previewMeasurementRef: React.MutableRefObject<
    { d1Pixels: number; d2Pixels: number; confidence: number } | null
  >;
  autoMeasurementIdRef: React.MutableRefObject<string | null>;
  manualMeasurementIdRef: React.MutableRefObject<string | null>;
  committedFingerprintsRef: React.MutableRefObject<CommittedAutoMeasureFingerprint[]>;
  autoMeasurePendingPreviewRef: React.MutableRefObject<unknown>;
  autoMeasureSettingsOpenRef: React.MutableRefObject<boolean>;
  autoMeasureSessionIdRef: React.MutableRefObject<number>;
  lastSyncedObjectiveRef: React.MutableRefObject<string | null>;

  // Local App state setters
  setCameraOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCameraStatus: (next: CameraStatusState) => void;
  setAutoMeasureStatus: (next: AutoMeasureStatusState) => void;
  setUnavailableMsg: React.Dispatch<React.SetStateAction<string | null>>;

  // Overlay-lifecycle setters
  setCommittedAutoMeasureOverlay: React.Dispatch<
    React.SetStateAction<AutoMeasureGraphics | null>
  >;
  setPreviewAutoMeasureOverlay: React.Dispatch<
    React.SetStateAction<AutoMeasureGraphics | null>
  >;
  setAutoMeasureClearNonce: React.Dispatch<React.SetStateAction<number>>;
  setAutoMeasureSessionActive: (active: boolean) => void;
  setAutoMeasureCapturedFrameId: (id: number | null) => void;
  setAutoMeasureSessionId: React.Dispatch<React.SetStateAction<number>>;

  // Cross-feature callbacks
  setActiveTool: (tool: ToolId) => void;
  resetManualMeasure: () => void;
  clearAutoMeasureOverlay: (reason: string) => void;
  clearActiveMeasurement: (reason: string) => void;
  restoreCameraSettings: () => Promise<unknown> | unknown;
  refetchCalibrationSettings: () => unknown;
  setStatusMessage: (message: string) => void;
};

export type UseCameraLifecycleResult = {
  openCameraDevice: () => void;
  closeCameraDevice: () => void;
};

// Camera open / close orchestration. The IPC hand-off (`window.hardnessCamera`)
// and the camera worker remain untouched; this hook owns the surrounding state
// machine — status transitions, overlay/session teardown, fingerprint / active
// measurement resets, manual measure reset, and micrometer port enumeration at
// open time. The two returned functions are wired into buildSharedCtx as-is so
// the toolbar dispatch surface is unchanged.
export function useCameraLifecycle({
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
}: UseCameraLifecycleArgs): UseCameraLifecycleResult {
  const openCameraDevice = useCallback(() => {
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

        await restoreCameraSettings();

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
  }, [
    cameraRef,
    cameraMeasurementSessionIdRef,
    clearActiveMeasurement,
    clearAutoMeasureOverlay,
    currentMachinePort,
    micrometerConfig,
    refetchCalibrationSettings,
    resetManualMeasure,
    restoreCameraSettings,
    setCameraOpen,
    setCameraStatus,
    setStatusMessage,
    setUnavailableMsg,
  ]);

  const closeCameraDevice = useCallback(() => {
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
  }, [
    autoMeasurePendingPreviewRef,
    autoMeasurePreviewSnapshotRef,
    autoMeasureSessionIdRef,
    autoMeasureSettingsOpenRef,
    autoMeasurementIdRef,
    cameraRef,
    clearActiveMeasurement,
    committedAutoMeasureFrameRef,
    committedFingerprintsRef,
    lastSyncedObjectiveRef,
    manualMeasurementIdRef,
    previewMeasurementRef,
    resetManualMeasure,
    setActiveTool,
    setAutoMeasureCapturedFrameId,
    setAutoMeasureClearNonce,
    setAutoMeasureSessionActive,
    setAutoMeasureSessionId,
    setAutoMeasureStatus,
    setCameraOpen,
    setCameraStatus,
    setCommittedAutoMeasureOverlay,
    setPreviewAutoMeasureOverlay,
    setStatusMessage,
    setUnavailableMsg,
  ]);

  return { openCameraDevice, closeCameraDevice };
}
