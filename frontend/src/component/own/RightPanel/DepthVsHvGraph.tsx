import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';
import {
  buildAxis,
  buildDepthHvGraphPoints,
  buildMinorTicks,
  buildSmoothPath,
  formatDistance,
  formatHv,
  type Axis,
  type DepthHvGraphPoint,
} from './DepthVsHvGraph.utils';

export { buildDepthHvGraphPoints };
export type { DepthHvGraphPoint };

const GRAPH_SX: SxProps<Theme> = { flex: 1, minHeight: 0, display: 'flex', p: 1 };
const EMPTY_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'text.secondary',
  gap: 1,
};

const SIZE = { w: 760, h: 360 };
const PAD = { top: 66, right: 32, bottom: 62, left: 86 };
const POINT_RADIUS = 4.5;
const HIT_RADIUS = 11;
const X_TICK_COUNT = 5;
const Y_TICK_COUNT = 8;

type Plot = {
  xAxis: Axis;
  yAxis: Axis;
  sx: (value: number) => number;
  sy: (value: number) => number;
  linePath: string;
  minorXTicks: number[];
  minorYTicks: number[];
};

type GraphColors = {
  axis: string;
  curve: string;
  gridMajor: string;
  gridMinor: string;
  label: string;
  muted: string;
  pointFill: string;
  paper: string;
  tooltipBg: string;
  tooltipText: string;
};

type Props = {
  points: DepthHvGraphPoint[];
};

function renderTooltip(point: DepthHvGraphPoint, plot: Plot, colors: GraphColors): ReactNode {
  const tipW = 158;
  const tipH = 42;
  const px = plot.sx(point.distanceUm);
  const py = plot.sy(point.hv);
  const tipX = px + 12 + tipW > SIZE.w - PAD.right ? px - 12 - tipW : px + 12;
  const tipY = Math.max(PAD.top + 4, py - tipH - 8);

  return (
    <g pointerEvents="none">
      <line x1={px} x2={px} y1={PAD.top} y2={SIZE.h - PAD.bottom} stroke={colors.axis} strokeWidth={0.9} strokeDasharray="4 4" />
      <line x1={PAD.left} x2={SIZE.w - PAD.right} y1={py} y2={py} stroke={colors.axis} strokeWidth={0.9} strokeDasharray="4 4" />
      <rect x={tipX} y={tipY} width={tipW} height={tipH} fill={colors.tooltipBg} stroke={colors.curve} strokeWidth={0.8} rx={3} ry={3} />
      <text x={tipX + 9} y={tipY + 17} fontSize={12} fill={colors.tooltipText}>{`Distance: ${formatDistance(point.distanceUm)}`}</text>
      <text x={tipX + 9} y={tipY + 33} fontSize={12} fill={colors.tooltipText}>{`HV: ${formatHv(point.hv)}`}</text>
    </g>
  );
}

function DepthVsHvGraphImpl({ points }: Props) {
  const theme = useTheme();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const colors = useMemo<GraphColors>(
    () => ({
      axis: theme.palette.grey[900],
      curve: theme.palette.primary.main,
      gridMajor: theme.palette.grey[300],
      gridMinor: theme.palette.grey[100],
      label: theme.palette.grey[900],
      muted: theme.palette.grey[700],
      pointFill: theme.palette.common.white,
      paper: theme.palette.common.white,
      tooltipBg: theme.palette.grey[900],
      tooltipText: theme.palette.common.white,
    }),
    [theme]
  );
  const plot = useMemo<Plot | null>(() => {
    if (points.length === 0) return null;

    const xAxis = buildAxis(points.map((point) => point.distanceUm), X_TICK_COUNT, true);
    const yAxis = buildAxis(points.map((point) => point.hv), Y_TICK_COUNT, false);
    const innerW = SIZE.w - PAD.left - PAD.right;
    const innerH = SIZE.h - PAD.top - PAD.bottom;
    const sx = (value: number) => PAD.left + ((value - xAxis.min) / (xAxis.max - xAxis.min || 1)) * innerW;
    const sy = (value: number) => PAD.top + innerH - ((value - yAxis.min) / (yAxis.max - yAxis.min || 1)) * innerH;

    return {
      xAxis,
      yAxis,
      sx,
      sy,
      linePath: buildSmoothPath(points, sx, sy),
      minorXTicks: buildMinorTicks(xAxis.ticks),
      minorYTicks: buildMinorTicks(yAxis.ticks),
    };
  }, [points]);

  useEffect(() => {
    console.log(`[case-hardness-profile-render] points=${points.length}`);
    if (plot) {
      console.log(
        `[case-hardness-profile-axis] xMinUm=${plot.xAxis.min} xMaxUm=${plot.xAxis.max} yMinHv=${plot.yAxis.min} yMaxHv=${plot.yAxis.max}`
      );
    }
    points.forEach((point) => {
      console.log(`[case-hardness-profile-point] distanceUm=${point.distanceUm} hv=${point.hv}`);
    });
  }, [plot, points]);

  if (!plot) {
    return (
      <Box sx={EMPTY_SX}>
        <Typography variant="h3">Case Hardness Profile</Typography>
        <Typography variant="body2">No measurement data available</Typography>
      </Box>
    );
  }

  const hovered = hoverIndex === null ? null : points[hoverIndex] ?? null;
  const plotBottom = SIZE.h - PAD.bottom;
  const plotRight = SIZE.w - PAD.right;

  return (
    <Box sx={GRAPH_SX}>
      <svg width="100%" height="100%" viewBox={`0 0 ${SIZE.w} ${SIZE.h}`} preserveAspectRatio="xMidYMid meet" onPointerLeave={() => setHoverIndex(null)}>
        <rect x={0} y={0} width={SIZE.w} height={SIZE.h} fill={colors.paper} />
        <text x={SIZE.w / 2} y={29} fontSize={21} fontWeight={700} fill={colors.label} textAnchor="middle">Case Hardness Profile</text>
        <text x={SIZE.w / 2} y={49} fontSize={12} fontWeight={600} fill={colors.muted} textAnchor="middle">Industrial metallurgical hardness profile</text>
        {plot.minorYTicks.map((tick) => <line key={`my-${tick}`} x1={PAD.left} x2={plotRight} y1={plot.sy(tick)} y2={plot.sy(tick)} stroke={colors.gridMinor} strokeWidth={0.7} />)}
        {plot.minorXTicks.map((tick) => <line key={`mx-${tick}`} x1={plot.sx(tick)} x2={plot.sx(tick)} y1={PAD.top} y2={plotBottom} stroke={colors.gridMinor} strokeWidth={0.7} />)}
        {plot.yAxis.ticks.map((tick) => (
          <g key={`y-${tick}`}>
            <line x1={PAD.left} x2={plotRight} y1={plot.sy(tick)} y2={plot.sy(tick)} stroke={colors.gridMajor} strokeWidth={1} />
            <text x={PAD.left - 10} y={plot.sy(tick)} fontSize={13} fontWeight={600} fill={colors.label} textAnchor="end" dominantBaseline="middle">{formatHv(tick)}</text>
          </g>
        ))}
        {plot.xAxis.ticks.map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={plot.sx(tick)} x2={plot.sx(tick)} y1={PAD.top} y2={plotBottom} stroke={colors.gridMajor} strokeWidth={1} />
            <text x={plot.sx(tick)} y={plotBottom + 23} fontSize={13} fontWeight={600} fill={colors.label} textAnchor="middle">{Math.round(tick)}</text>
          </g>
        ))}
        <rect x={PAD.left} y={PAD.top} width={plotRight - PAD.left} height={plotBottom - PAD.top} fill="none" stroke={colors.axis} strokeWidth={1.5} />
        <text x={PAD.left + (plotRight - PAD.left) / 2} y={SIZE.h - 14} fontSize={15} fontWeight={700} fill={colors.label} textAnchor="middle">Distance from Surface (µm)</text>
        <text x={24} y={PAD.top + (plotBottom - PAD.top) / 2} fontSize={15} fontWeight={700} fill={colors.label} textAnchor="middle" transform={`rotate(-90 24 ${PAD.top + (plotBottom - PAD.top) / 2})`}>Hardness (HV)</text>
        {points.length >= 2 ? <path d={plot.linePath} fill="none" stroke={colors.curve} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {points.map((point, index) => (
          <circle key={`${point.id}-${point.index}`} cx={plot.sx(point.distanceUm)} cy={plot.sy(point.hv)} r={POINT_RADIUS} fill={index === hoverIndex ? colors.curve : colors.pointFill} stroke={colors.curve} strokeWidth={2} />
        ))}
        {points.map((point, index) => (
          <circle key={`${point.id}-${point.index}-hit`} cx={plot.sx(point.distanceUm)} cy={plot.sy(point.hv)} r={HIT_RADIUS} fill="transparent" onPointerEnter={() => setHoverIndex(index)} onPointerMove={() => setHoverIndex(index)}>
            <title>{`Distance: ${formatDistance(point.distanceUm)}\nHV: ${formatHv(point.hv)}`}</title>
          </circle>
        ))}
        {hovered ? renderTooltip(hovered, plot, colors) : null}
      </svg>
    </Box>
  );
}

export default memo(DepthVsHvGraphImpl);
