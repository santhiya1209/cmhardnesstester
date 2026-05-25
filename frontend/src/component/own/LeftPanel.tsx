import { forwardRef, memo } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import CameraWindow, { type CameraWindowHandle } from '@/component/own/CameraWindow';
import { useRenderCount } from '@/utils/renderStats';
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
  umPerPixel?: number | null;
  onUpdateShape?: (id: string, next: OverlayShapeInput) => void;
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
    umPerPixel,
    onUpdateShape,
  }: Props,
  ref: React.Ref<CameraWindowHandle>
) {
  useRenderCount('LeftPanel');
  return (
    <Box sx={PANEL_SX}>
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
        umPerPixel={umPerPixel}
        onUpdateShape={onUpdateShape}
      />
    </Box>
  );
}

export default memo(forwardRef<CameraWindowHandle, Props>(LeftPanelImpl));
