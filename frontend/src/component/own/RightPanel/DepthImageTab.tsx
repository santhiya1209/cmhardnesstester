import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';
import { useSaveDepthImageSetting } from '@/hooks/mutations/useSaveDepthImageSetting';
import { useDepthImageSettings } from '@/hooks/queries/useDepthImageSettings';
import type { Measurement } from '@/types/measurement';

const SECTION_SX: SxProps<Theme> = { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 280 };
const PREVIEW_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 200,
  border: 1,
  borderColor: 'divider',
  m: 1.5,
  bgcolor: 'background.paper',
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'stretch',
  overflow: 'hidden',
};
const EMPTY_SX: SxProps<Theme> = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  color: 'text.secondary',
};
const ACTION_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 2, px: 1.5, pb: 1.5 };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const CHECK_SX: SxProps<Theme> = { '& .MuiFormControlLabel-label': { fontSize: 12 } };
const STATUS_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' };
const STATUS_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const ALERT_SX: SxProps<Theme> = { mx: 1.5, mb: 1.5 };

const DEFAULT_PREVIEW_LABEL = '';

type Props = {
  albumItemCount: number;
  onAlbumChanged: () => Promise<void>;
  measurements: Measurement[];
};

type ChartPoint = { x: number; y: number; label: string };

const CHART_PADDING = { top: 16, right: 24, bottom: 36, left: 56 };
const Y_TICKS = 10;
const X_TICKS = 10;

function buildPoints(measurements: Measurement[]): ChartPoint[] {
  const usable = measurements.filter((m) => typeof m.hv === 'number' && Number.isFinite(m.hv));
  if (usable.length === 0) return [];

  const hasDepth = usable.some((m) => typeof m.depthMm === 'number' && Number.isFinite(m.depthMm) && (m.depthMm ?? 0) > 0);

  return usable.map((m, idx) => {
    const x = hasDepth
      ? Number.isFinite(m.depthMm) && (m.depthMm ?? 0) > 0
        ? (m.depthMm as number)
        : (idx + 1) * 0.2
      : (idx + 1) * 0.2;
    const y = m.hv as number;
    const unit = m.method ? `HV${m.testForceKgf ?? ''}`.trim() : 'HV';
    return { x, y, label: unit };
  });
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count <= 0) return [];
  if (min === max) return [min];
  const step = (max - min) / count;
  const ticks: number[] = [];
  for (let i = 0; i <= count; i += 1) ticks.push(min + step * i);
  return ticks;
}

type ChartProps = {
  points: ChartPoint[];
  stroke: string;
  axis: string;
  grid: string;
  text: string;
};

function DepthChart({ points, stroke, axis, grid, text }: ChartProps) {
  const width = 640;
  const height = 280;
  const innerW = width - CHART_PADDING.left - CHART_PADDING.right;
  const innerH = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = 0;
  const xMax = Math.max(...xs, 0.2) * 1.05;
  const yMin = 0;
  const yMax = Math.max(...ys, 10) * 1.1;

  const sx = (v: number) => CHART_PADDING.left + ((v - xMin) / (xMax - xMin || 1)) * innerW;
  const sy = (v: number) => CHART_PADDING.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const xTicks = niceTicks(xMin, xMax, X_TICKS);
  const yTicks = niceTicks(yMin, yMax, Y_TICKS);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`).join(' ');
  const yLabel = points[0]?.label ?? 'HV';
  const firstPoint = points[0];

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={`y${i}`}>
          <line x1={CHART_PADDING.left} x2={width - CHART_PADDING.right} y1={sy(t)} y2={sy(t)} stroke={grid} strokeWidth={0.5} />
          <text x={CHART_PADDING.left - 6} y={sy(t)} fontSize={10} fill={text} textAnchor="end" dominantBaseline="middle">
            {Math.round(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <g key={`x${i}`}>
          <line x1={sx(t)} x2={sx(t)} y1={CHART_PADDING.top} y2={height - CHART_PADDING.bottom} stroke={grid} strokeWidth={0.5} />
          <text x={sx(t)} y={height - CHART_PADDING.bottom + 14} fontSize={10} fill={text} textAnchor="middle">
            {t.toFixed(3)}
          </text>
        </g>
      ))}
      <line x1={CHART_PADDING.left} x2={CHART_PADDING.left} y1={CHART_PADDING.top} y2={height - CHART_PADDING.bottom} stroke={axis} strokeWidth={1} />
      <line x1={CHART_PADDING.left} x2={width - CHART_PADDING.right} y1={height - CHART_PADDING.bottom} y2={height - CHART_PADDING.bottom} stroke={axis} strokeWidth={1} />
      <text x={CHART_PADDING.left - 40} y={CHART_PADDING.top + innerH / 2} fontSize={11} fill={text} textAnchor="middle" transform={`rotate(-90 ${CHART_PADDING.left - 40} ${CHART_PADDING.top + innerH / 2})`}>
        {yLabel}
      </text>
      <text x={CHART_PADDING.left + innerW / 2} y={height - 6} fontSize={10} fill={text} textAnchor="middle">
        mm
      </text>
      {points.length > 1 ? <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} /> : null}
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={3} fill={stroke} />
      ))}
      {firstPoint ? (
        <text x={sx(firstPoint.x) + 6} y={sy(firstPoint.y) - 6} fontSize={10} fill={text}>
          ({firstPoint.x.toFixed(4)},{Math.round(firstPoint.y)})
        </text>
      ) : null}
    </svg>
  );
}

function DepthImageTabImpl({ albumItemCount, onAlbumChanged, measurements }: Props) {
  const theme = useTheme();
  const { data, error: loadError, loading, refetch } = useDepthImageSettings();
  const { error: saveError, saveDepthImageSetting, saving } = useSaveDepthImageSetting();
  const [hardnessImage, setHardnessImage] = useState(false);
  const points = useMemo(() => buildPoints(measurements), [measurements]);
  const chartColors = useMemo(
    () => ({
      stroke: theme.palette.primary.main,
      axis: theme.palette.text.primary,
      grid: theme.palette.divider,
      text: theme.palette.text.secondary,
    }),
    [theme]
  );

  useEffect(() => {
    if (!loading) {
      setHardnessImage(data?.hardnessImage ?? false);
    }
  }, [data?.hardnessImage, loading]);

  const isBusy = loading || saving;
  const errorMessage = loadError ?? saveError;

  const handleToggleHardnessImage = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.checked;
      setHardnessImage(next);

      try {
        await saveDepthImageSetting({
          id: data?.id,
          values: {
            hardnessImage: next,
            previewLabel: data?.previewLabel ?? DEFAULT_PREVIEW_LABEL,
          },
        });
        await refetch();
      } catch {
        setHardnessImage(data?.hardnessImage ?? false);
      }
    },
    [data?.hardnessImage, data?.id, data?.previewLabel, refetch, saveDepthImageSetting]
  );

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const handleSaveImage = useCallback(() => {
    void onAlbumChanged();
  }, [onAlbumChanged]);

  return (
    <Box sx={SECTION_SX}>
      <Box sx={PREVIEW_SX}>
        {points.length === 0 ? (
          <Box sx={EMPTY_SX}>No measurements yet</Box>
        ) : (
          <DepthChart
            points={points}
            stroke={chartColors.stroke}
            axis={chartColors.axis}
            grid={chartColors.grid}
            text={chartColors.text}
          />
        )}
      </Box>
      <Box sx={ACTION_ROW_SX}>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={isBusy} onClick={handleRefresh}>
          Fresh
        </Button>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={isBusy} onClick={handleSaveImage}>
          Save Image
        </Button>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={hardnessImage}
              disabled={isBusy}
              onChange={(event) => {
                void handleToggleHardnessImage(event);
              }}
            />
          }
          label="HardnessImage"
          sx={CHECK_SX}
        />
        <Box sx={STATUS_SX}>
          {isBusy ? <CircularProgress size={14} /> : null}
          <Typography sx={STATUS_TEXT_SX}>Album items: {albumItemCount}</Typography>
        </Box>
      </Box>
      {errorMessage ? (
        <Alert severity="error" sx={ALERT_SX}>
          {errorMessage}
        </Alert>
      ) : null}
    </Box>
  );
}

export default memo(DepthImageTabImpl);
