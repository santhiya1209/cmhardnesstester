import { useCallback } from 'react';
import type { CameraWindowHandle } from '@/component/own/CameraWindow';
import { openImageDialog, saveImageDialog } from '@/api/system';
import type { ToolDispatchContext } from '@/utils/toolDispatcher';
import type { ToolId } from '@/types/tool';
import type { LineThickness } from '@/types/lineThickness';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';
import type {
  AutoMeasureDetectionSnapshot,
  CapturedAutoMeasureFrame,
  CommittedAutoMeasureFingerprint,
} from '@/features/autoMeasure/autoMeasureHelpers';

export type UseToolDispatchContextArgs = {
  cameraRef: React.RefObject<CameraWindowHandle | null>;

  // From useActiveTool
  setActiveTool: (tool: ToolId) => void;

  // From StatusMessageContext + App state
  setStatusMessage: (message: string) => void;
  setUnavailableMsg: React.Dispatch<React.SetStateAction<string | null>>;

  // From useImageOverlay
  overlayClearAll: () => void;
  overlayTrimLast: () => void;
  overlayToggleCrossLine: () => void;

  // From useManualMeasureLifecycle
  resetManualMeasure: () => void;
  manualMeasurementIdRef: React.MutableRefObject<string | null>;

  // From useLineThickness
  setLineThickness: (thickness: LineThickness) => void;

  // App-owned state setters
  setMagnifierEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setTrimMeasureOpen: (open: boolean) => void;

  // App-owned auto-measure handler
  handleAutoMeasure: () => void;

  // App-owned overlay-clear callback (touches multiple setters)
  clearAutoMeasureOverlay: (reason: string) => void;

  // From useOverlayLifecycle
  setAutoMeasureClearNonce: React.Dispatch<React.SetStateAction<number>>;
  setCommittedAutoMeasureOverlay: React.Dispatch<
    React.SetStateAction<AutoMeasureGraphics | null>
  >;
  setPreviewAutoMeasureOverlay: React.Dispatch<
    React.SetStateAction<AutoMeasureGraphics | null>
  >;

  // App-owned auto-measure session refs (Open Image clears them)
  autoMeasurePreviewSnapshotRef: React.MutableRefObject<AutoMeasureDetectionSnapshot | null>;
  committedAutoMeasureFrameRef: React.MutableRefObject<CapturedAutoMeasureFrame | null>;
  previewMeasurementRef: React.MutableRefObject<
    { d1Pixels: number; d2Pixels: number; confidence: number } | null
  >;
  autoMeasurementIdRef: React.MutableRefObject<string | null>;
  committedFingerprintsRef: React.MutableRefObject<CommittedAutoMeasureFingerprint[]>;

  // App-owned dialog openers
  openCalibrationPanel: (source?: 'menu' | 'toolbar' | 'snackbar') => void;
  openCameraSettingsPanel: () => void;

  // From useCameraLifecycle
  openCameraDevice: () => void;
  closeCameraDevice: () => void;
};

export type UseToolDispatchContextResult = {
  buildSharedCtx: () => ToolDispatchContext;
};

// Builds the shared ToolDispatchContext consumed by the toolbar dispatcher and
// the menu actions hook. The camera open/close branches come straight from
// useCameraLifecycle; everything else (clearGraphics, autoMeasure, zoom, trim,
// magnifier, openImage, saveImage, etc.) is wired here so App.tsx stays slim.
export function useToolDispatchContext({
  cameraRef,
  setActiveTool,
  setStatusMessage,
  setUnavailableMsg,
  overlayClearAll,
  overlayTrimLast,
  overlayToggleCrossLine,
  resetManualMeasure,
  manualMeasurementIdRef,
  setLineThickness,
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
}: UseToolDispatchContextArgs): UseToolDispatchContextResult {
  const buildSharedCtx = useCallback(
    (): ToolDispatchContext => ({
      setActiveTool,
      setStatus: (message) => setStatusMessage(`System Status: ${message}`),
      notifyUnavailable: (label) =>
        setUnavailableMsg(`${label} is not available yet.`),
      clearGraphics: () => {
        // eslint-disable-next-line no-console
        console.warn('[clear-graphics-click]');
        overlayClearAll();
        // Delegate Auto Measure teardown to the tested clear path so session
        // state, refs, and the render gate flip together. Force-bump the
        // clear nonce so the overlay canvas clears synchronously even if a
        // rAF was already queued from the prior frame.
        clearAutoMeasureOverlay('toolbar-clear');
        setAutoMeasureClearNonce((n) => n + 1);
        manualMeasurementIdRef.current = null;
        // Note: active measurement row is NOT cleared from the clear-graphics
        // menu. Per spec only camera close/open ends the session and allows
        // a new row.
        resetManualMeasure();
        // eslint-disable-next-line no-console
        console.warn('[clear-graphics-finished]');
      },
      autoMeasure: handleAutoMeasure,
      setLineThickness,
      toggleMagnifier: () => {
        setMagnifierEnabled((prev) => {
          const next = !prev;
          if (next) {
          } else {
          }
          return next;
        });
      },
      trimLastMeasurement: overlayTrimLast,
      openTrimMeasure: () => setTrimMeasureOpen(true),
      toggleCenterCrossLine: overlayToggleCrossLine,
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
      openCameraDevice,
      closeCameraDevice,
    }),
    [
      autoMeasurePreviewSnapshotRef,
      autoMeasurementIdRef,
      cameraRef,
      clearAutoMeasureOverlay,
      closeCameraDevice,
      committedAutoMeasureFrameRef,
      committedFingerprintsRef,
      handleAutoMeasure,
      manualMeasurementIdRef,
      openCalibrationPanel,
      openCameraDevice,
      openCameraSettingsPanel,
      overlayClearAll,
      overlayToggleCrossLine,
      overlayTrimLast,
      previewMeasurementRef,
      resetManualMeasure,
      setActiveTool,
      setAutoMeasureClearNonce,
      setCommittedAutoMeasureOverlay,
      setLineThickness,
      setMagnifierEnabled,
      setPreviewAutoMeasureOverlay,
      setStatusMessage,
      setTrimMeasureOpen,
      setUnavailableMsg,
    ]
  );

  return { buildSharedCtx };
}
