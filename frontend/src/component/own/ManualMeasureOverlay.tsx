import { memo } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useManualMeasureOverlay } from '@/hooks/useManualMeasureOverlay';
import { useRenderCount } from '@/utils/renderStats';
import type { ManualMeasureDragResult } from '@/types/manualMeasure';
import type { Point } from '@/types/tool';
import type { ManualMeasureImageSize } from '@/utils/manualMeasureOverlayCanvas';

type Props = {
  active: boolean;
  imageSize: ManualMeasureImageSize | null;
  resetKey: number;
  objective?: string | null;
  onCursor?: (point: Point | null) => void;
  onMeasurementUpdated: (result: ManualMeasureDragResult) => void;
  strokeWidth?: number;
};

const ROOT_SX: SxProps<Theme> = {
  position: 'absolute',
  inset: 0,
};

const CANVAS_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
};

function ManualMeasureOverlayImpl({
  active,
  imageSize,
  resetKey,
  objective,
  onCursor,
  onMeasurementUpdated,
  strokeWidth,
}: Props) {
  useRenderCount('ManualMeasureOverlay');
  const {
    canvasRef,
    cursor,
    handlePointerDown,
    handlePointerLeave,
    handlePointerMove,
    handlePointerUp,
    wrapRef,
  } = useManualMeasureOverlay({
    active,
    imageSize,
    resetKey,
    objective,
    onCursor,
    onMeasurementUpdated,
    strokeWidth,
  });

  return (
    <Box
      ref={wrapRef}
      sx={{
        ...ROOT_SX,
        pointerEvents: active && imageSize ? 'auto' : 'none',
        cursor: active && imageSize ? cursor : 'default',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <canvas ref={canvasRef} style={CANVAS_STYLE} />
    </Box>
  );
}

export default memo(ManualMeasureOverlayImpl);
