import { memo } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useManualMeasureOverlay } from '@/hooks/useManualMeasureOverlay';
import type { ManualMeasureDragResult } from '@/types/manualMeasure';
import type { Point } from '@/types/tool';
import type { ManualMeasureImageSize } from '@/utils/manualMeasureOverlayCanvas';

type Props = {
  active: boolean;
  imageSize: ManualMeasureImageSize | null;
  resetKey: number;
  onCursor?: (point: Point | null) => void;
  onMeasurementUpdated: (result: ManualMeasureDragResult) => void;
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
  onCursor,
  onMeasurementUpdated,
}: Props) {
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
    onCursor,
    onMeasurementUpdated,
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
