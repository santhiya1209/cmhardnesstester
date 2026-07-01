import { forwardRef, memo } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import CameraWindow, { type CameraWindowHandle } from '@/component/own/CameraWindow';
import { useRenderCount } from '@/utils/renderStats';
import type { AutoMeasureCorners, AutoMeasureGraphics } from '@/types/autoMeasure';
import type { ManualMeasureDragResult } from '@/types/manualMeasure';
import type { OverlayShape, OverlayShapeInput, ToolId } from '@/types/tool';
import type { CrosshairConfig } from '@/types/crosshair';


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
  crosshairConfig?: CrosshairConfig;
  onAddShape: (shape: OverlayShapeInput) => void;
  manualMeasureResetKey: number;
  manualMeasureObjective?: string | null;
  objectiveRefreshKey?: number;
  onManualMeasurementUpdated: (result: ManualMeasureDragResult) => void;
  onAutoMeasureAdjusted?: (corners: AutoMeasureCorners) => void;
  onAutoMeasureLineSelected?: (line: 'top' | 'right' | 'bottom' | 'left' | null) => void;
  autoMeasureSelectedLine?: 'top' | 'right' | 'bottom' | 'left' | null;
  autoMeasureKeyboardActive?: boolean;
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
    crosshairConfig,
    onAddShape,
    manualMeasureResetKey,
    manualMeasureObjective,
    objectiveRefreshKey,
    onManualMeasurementUpdated,
    onAutoMeasureAdjusted,
    onAutoMeasureLineSelected,
    autoMeasureSelectedLine,
    autoMeasureKeyboardActive,
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
        crosshairConfig={crosshairConfig}
        onAddShape={onAddShape}
        manualMeasureResetKey={manualMeasureResetKey}
        manualMeasureObjective={manualMeasureObjective}
        objectiveRefreshKey={objectiveRefreshKey}
        onManualMeasurementUpdated={onManualMeasurementUpdated}
        onAutoMeasureAdjusted={onAutoMeasureAdjusted}
        onAutoMeasureLineSelected={onAutoMeasureLineSelected}
        autoMeasureSelectedLine={autoMeasureSelectedLine}
        autoMeasureKeyboardActive={autoMeasureKeyboardActive}
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
