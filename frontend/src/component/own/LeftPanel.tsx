import { forwardRef, memo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import CameraWindow, { type CameraWindowHandle } from '@/component/own/CameraWindow';
import { dropPendingCameraFrames } from '@/hooks/useCameraStream';
import type { AutoMeasureCorners, AutoMeasureGraphics } from '@/types/autoMeasure';
import type { ManualMeasureDragResult } from '@/types/manualMeasure';
import type { OverlayShape, OverlayShapeInput, ToolId } from '@/types/tool';

const PANEL_SX: SxProps<Theme> = {
  flex: 2.0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  bgcolor: 'background.paper',
  borderRight: 1,
  borderColor: 'divider',
  overflow: 'hidden',
};

// Camera-area toolbar. Currently just the "Live 30 FPS" quick action — a
// dedicated button so the user doesn't have to open Camera Settings to lower
// exposure for smooth live preview. Calls the dedicated IPC path in preload
// (logs at every layer) so any silent skip is visible in the terminal.
function CameraToolbar() {
  const [pending, setPending] = useState(false);
  const [lastReply, setLastReply] = useState<string | null>(null);
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.default',
        minHeight: 36,
      }}
    >
      <Button
        size="small"
        variant="contained"
        disabled={pending}
        onClick={() => {
          const targetFps = 30;
          // eslint-disable-next-line no-console
          console.log(`[live-fps-button-click] targetFps=${targetFps}`);
          setPending(true);
          dropPendingCameraFrames('exposure-change');
          void window.hardnessCamera
            .setLiveExposureForFps(targetFps)
            .then((reply) => {
              // eslint-disable-next-line no-console
              console.log('[live-fps-button-reply]', reply);
              if (reply && reply.ok && typeof reply.exposureMs === 'number') {
                setLastReply(`exposure=${reply.exposureMs.toFixed(2)}ms`);
              } else {
                setLastReply(reply && reply.message ? `error: ${reply.message}` : 'no reply');
              }
            })
            .catch((err: unknown) => {
              // eslint-disable-next-line no-console
              console.error('[live-fps-button-error]', err);
              setLastReply(err instanceof Error ? `error: ${err.message}` : 'threw');
            })
            .finally(() => setPending(false));
        }}
      >
        Live 30 FPS
      </Button>
      {lastReply ? (
        <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {lastReply}
        </Typography>
      ) : null}
    </Box>
  );
}

type Props = {
  activeTool: ToolId;
  overlayShapes: OverlayShape[];
  autoMeasureGraphics: AutoMeasureGraphics | null;
  autoMeasureGraphicsSource?: 'auto' | 'preview' | 'save';
  autoMeasureClearNonce?: number;
  crossLineVisible: boolean;
  onAddShape: (shape: OverlayShapeInput) => void;
  manualMeasureResetKey: number;
  manualMeasureObjective?: string | null;
  objectiveRefreshKey?: number;
  onManualMeasurementUpdated: (result: ManualMeasureDragResult) => void;
  onAutoMeasureAdjusted?: (corners: AutoMeasureCorners) => void;
  magnifierEnabled: boolean;
  onClearShapeKind?: (kind: OverlayShape['kind']) => void;
  lineStrokeWidth?: number;
  turretMoving?: boolean;
  turretMovingTarget?: string | null;
  cameraOpen?: boolean;
};

function LeftPanelImpl(
  {
    activeTool,
    overlayShapes,
    autoMeasureGraphics,
    autoMeasureGraphicsSource,
    autoMeasureClearNonce,
    crossLineVisible,
    onAddShape,
    manualMeasureResetKey,
    manualMeasureObjective,
    objectiveRefreshKey,
    onManualMeasurementUpdated,
    onAutoMeasureAdjusted,
    magnifierEnabled,
    onClearShapeKind,
    lineStrokeWidth,
    turretMoving,
    turretMovingTarget,
    cameraOpen,
  }: Props,
  ref: React.Ref<CameraWindowHandle>
) {
  return (
    <Box sx={PANEL_SX}>
      <CameraToolbar />
      <CameraWindow
        ref={ref}
        activeTool={activeTool}
        overlayShapes={overlayShapes}
        autoMeasureGraphics={autoMeasureGraphics}
        autoMeasureGraphicsSource={autoMeasureGraphicsSource}
        autoMeasureClearNonce={autoMeasureClearNonce}
        crossLineVisible={crossLineVisible}
        onAddShape={onAddShape}
        manualMeasureResetKey={manualMeasureResetKey}
        manualMeasureObjective={manualMeasureObjective}
        objectiveRefreshKey={objectiveRefreshKey}
        onManualMeasurementUpdated={onManualMeasurementUpdated}
        onAutoMeasureAdjusted={onAutoMeasureAdjusted}
        magnifierEnabled={magnifierEnabled}
        onClearShapeKind={onClearShapeKind}
        lineStrokeWidth={lineStrokeWidth}
        turretMoving={turretMoving}
        turretMovingTarget={turretMovingTarget}
        cameraOpen={cameraOpen}
      />
    </Box>
  );
}

export default memo(forwardRef<CameraWindowHandle, Props>(LeftPanelImpl));
