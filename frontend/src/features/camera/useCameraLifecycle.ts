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
  cameraRef: React.RefObject<CameraWindowHandle | null>;
  cameraMeasurementSessionIdRef: React.MutableRefObject<number>;

  micrometerConfig: MicrometerConfig | null | undefined;
  currentMachinePort: string | null;

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

  setCameraOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCameraStatus: (next: CameraStatusState) => void;
  setAutoMeasureStatus: (next: AutoMeasureStatusState) => void;
  setUnavailableMsg: React.Dispatch<React.SetStateAction<string | null>>;

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
        resetCameraSession();
        try {
          await refetchCalibrationSettings();
        } catch {
        }
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
        clearAutoMeasureOverlay('camera-open');
        resetManualMeasure();
        setCameraOpen(true);
        cameraMeasurementSessionIdRef.current += 1;
        clearActiveMeasurement('camera-session-start');

        await restoreCameraSettings();

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
        setAutoMeasureClearNonce((n) => n + 1);
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
        autoMeasurePendingPreviewRef.current = null;
        autoMeasureSettingsOpenRef.current = false;
        setAutoMeasureSessionActive(false);
        setAutoMeasureCapturedFrameId(null);
        setAutoMeasureSessionId((id) => {
          const next = id + 1;
          autoMeasureSessionIdRef.current = next;
          return next;
        });
        const reply = await window.hardnessCamera.closeDevice();
        await cameraRef.current?.refetchStatus();
        cameraRef.current?.clearLiveImage('camera-close');
        setCameraOpen(false);
        setCommittedAutoMeasureOverlay(null);
        setPreviewAutoMeasureOverlay(null);
        setAutoMeasureClearNonce((n) => n + 1);
        autoMeasurePreviewSnapshotRef.current = null;
        committedAutoMeasureFrameRef.current = null;
        previewMeasurementRef.current = null;
        autoMeasurementIdRef.current = null;
        manualMeasurementIdRef.current = null;
        clearActiveMeasurement('camera-close');
        committedFingerprintsRef.current = [];
        resetManualMeasure();
        setActiveTool('pointer');
        resetCameraSession();
        lastSyncedObjectiveRef.current = null;
        setStatusMessage('System Status: Device closed');
        void reply;

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
