import { forwardRef, memo } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import CameraWindow, { type CameraWindowHandle } from '@/component/own/CameraWindow';
import type { AutoMeasureGraphics } from '@/types/autoMeasure';
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
  crossLineVisible: boolean;
  onAddShape: (shape: OverlayShapeInput) => void;
  manualMeasureResetKey: number;
  onManualMeasurementUpdated: (result: ManualMeasureDragResult) => void;
};

function LeftPanelImpl(
  {
    activeTool,
    overlayShapes,
    autoMeasureGraphics,
    crossLineVisible,
    onAddShape,
    manualMeasureResetKey,
    onManualMeasurementUpdated,
  }: Props,
  ref: React.Ref<CameraWindowHandle>
) {
  return (
    <Box sx={PANEL_SX}>
      <CameraWindow
        ref={ref}
        activeTool={activeTool}
        overlayShapes={overlayShapes}
        autoMeasureGraphics={autoMeasureGraphics}
        crossLineVisible={crossLineVisible}
        onAddShape={onAddShape}
        manualMeasureResetKey={manualMeasureResetKey}
        onManualMeasurementUpdated={onManualMeasurementUpdated}
      />
    </Box>
  );
}

export default memo(forwardRef<CameraWindowHandle, Props>(LeftPanelImpl));
