import type { ReactNode } from 'react';
import {
  formatDistance,
  formatHv,
  type ChdIntersection,
  type DepthHvGraphPoint,
} from './DepthVsHvGraph.utils';

type GraphLayout = {
  size: { w: number; h: number };
  pad: { top: number; right: number; bottom: number; left: number };
};

type OverlayPlot = {
  sx: (value: number) => number;
  sy: (value: number) => number;
};

type OverlayColors = {
  axis: string;
  curve: string;
  paper: string;
  reference: string;
  tooltipBg: string;
  tooltipText: string;
};

export function renderTooltip(
  point: DepthHvGraphPoint,
  plot: OverlayPlot,
  colors: OverlayColors,
  layout: GraphLayout
): ReactNode {
  const { pad, size } = layout;
  const tipW = 158;
  const tipH = 42;
  const px = plot.sx(point.distanceUm);
  const py = plot.sy(point.hv);
  const tipX = px + 12 + tipW > size.w - pad.right ? px - 12 - tipW : px + 12;
  const tipY = Math.max(pad.top + 4, py - tipH - 8);

  return (
    <g pointerEvents="none">
      <line x1={px} x2={px} y1={pad.top} y2={size.h - pad.bottom} stroke={colors.axis} strokeWidth={0.9} strokeDasharray="4 4" />
      <line x1={pad.left} x2={size.w - pad.right} y1={py} y2={py} stroke={colors.axis} strokeWidth={0.9} strokeDasharray="4 4" />
      <rect x={tipX} y={tipY} width={tipW} height={tipH} fill={colors.tooltipBg} stroke={colors.curve} strokeWidth={0.8} rx={3} ry={3} />
      <text x={tipX + 9} y={tipY + 17} fontSize={12} fill={colors.tooltipText}>{`Distance: ${formatDistance(point.distanceUm)}`}</text>
      <text x={tipX + 9} y={tipY + 33} fontSize={12} fill={colors.tooltipText}>{`HV: ${formatHv(point.hv)}`}</text>
    </g>
  );
}

export function renderChdReference(
  chdTargetHv: number | null,
  chdIntersection: ChdIntersection | null,
  plot: OverlayPlot,
  colors: OverlayColors,
  layout: GraphLayout
): ReactNode {
  if (chdTargetHv === null || !Number.isFinite(chdTargetHv)) return null;

  const { pad, size } = layout;
  const y = plot.sy(chdTargetHv);
  const x = chdIntersection ? plot.sx(chdIntersection.distanceUm) : null;
  const labelY = Math.max(pad.top + 14, y - 8);

  return (
    <g pointerEvents="none">
      <line x1={pad.left} x2={size.w - pad.right} y1={y} y2={y} stroke={colors.reference} strokeWidth={2} strokeDasharray="8 6" />
      <text x={size.w - pad.right - 10} y={labelY} fontSize={14} fontWeight={700} fill={colors.reference} textAnchor="end">{`${formatHv(chdTargetHv)} HV`}</text>
      {x !== null ? (
        <>
          <line x1={x} x2={x} y1={y} y2={size.h - pad.bottom} stroke={colors.reference} strokeWidth={2} strokeDasharray="8 6" />
          <circle cx={x} cy={y} r={5} fill={colors.paper} stroke={colors.reference} strokeWidth={2} />
          <text x={x + 8} y={size.h - pad.bottom - 10} fontSize={14} fontWeight={700} fill={colors.reference}>CHD</text>
        </>
      ) : null}
    </g>
  );
}
