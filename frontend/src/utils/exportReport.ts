// Centralized report generation. CSV is hand-rolled; XLSX uses exceljs for
// styled headers/borders; DOCX uses the docx package. See CLAUDE.md §11.
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import type { Measurement } from '@/types/measurement';
import type { ReportHeaderSettingPayload } from '@/types/reportHeaderSetting';
import { getHardnessColor } from '@/utils/hardnessColor';
import {
  buildAxis,
  buildDepthHvGraphPoints,
  buildMinorTicks,
  buildSmoothPath,
  findChdIntersection,
  formatHv,
} from '@/component/own/RightPanel/DepthVsHvGraph.utils';

export type ReportType =
  | 'csv'
  | 'xlsx'
  | 'word-data'
  | 'word-image'
  | 'word-depth'
  | 'word-image-depth';

export const REPORT_FILENAMES: Record<ReportType, string> = {
  csv: 'vickers-report.csv',
  xlsx: 'vickers-report.xlsx',
  'word-data': 'vickers-report-data.docx',
  'word-image': 'vickers-report-image.docx',
  'word-depth': 'vickers-report-depth.docx',
  'word-image-depth': 'vickers-report-image-depth.docx',
};

const HEADERS = [
  '#',
  'X(mm)',
  'Y(mm)',
  'Hardness',
  'Objective',
  'Method',
  'Hardness Type',
  'Qualified',
  'D1(um)',
  'D2(um)',
  'Davg(um)',
  'Convert Type',
  'Convert Value',
  'Depth',
];

// eslint-disable-next-line no-console
console.log(
  '[report-layout-update]\nremoveCp=true\nremoveCpk=true\nremoveMeasureTime=true'
);

// --- formatters (single source of truth for CSV / XLSX / DOCX) ---

function safeText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  const s = String(value).trim();
  return s === '' ? fallback : s;
}

function formatBlank(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  return s.trim();
}

function formatCoordinate(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : '0.0000';
}

function formatMicron(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '0.000';
}

function formatHardness(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatQualified(value: unknown): 'YES' | 'NO' {
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'yes' || v === 'pass' || v === 'true' || v === '1' || v === 'qualified') return 'YES';
    return 'NO';
  }
  if (typeof value === 'number') return value > 0 ? 'YES' : 'NO';
  return 'NO';
}

function formatDepth(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(3)} mm`
    : '-';
}

function formatInspectionDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

type ReportRow = {
  index: string;
  xMm: string;
  yMm: string;
  hardness: string;
  // Raw HV number (null when missing). Used to color the Hardness Value cell
  // in DOCX exports against the operator's target HV band.
  hardnessNumeric: number | null;
  objective: string;
  method: string;
  hardnessType: string;
  qualified: string;
  d1Um: string;
  d2Um: string;
  davgUm: string;
  convertType: string;
  convertValue: string;
  depth: string;
};

function normalizeReportRow(m: Measurement, idx: number): ReportRow {
  const d1Um = m.d1Um ?? (m.unit === 'um' ? m.d1 : null);
  const d2Um = m.d2Um ?? (m.unit === 'um' ? m.d2 : null);
  const davgUm =
    m.averageUm ??
    (m.unit === 'um' ? m.average : null) ??
    (typeof d1Um === 'number' && typeof d2Um === 'number' ? (d1Um + d2Um) / 2 : null);

  const hardnessType =
    formatBlank(m.hardnessType) ||
    (typeof m.testForceKgf === 'number' && Number.isFinite(m.testForceKgf)
      ? `HV${m.testForceKgf}`
      : 'HV');

  // Match the in-app MeasurementsTable rendering exactly so the report
  // never disagrees with what the user just saw on screen. The table falls
  // back to hardnessType when no convertType was saved on the row, and uses
  // the row's HV as the convertValue whenever the resolved type is HV.
  const convertTypeRaw = formatBlank(m.convertType);
  const convertType = convertTypeRaw || hardnessType || 'NONE';

  let convertValueNum: number | null = null;
  if (typeof m.convertValue === 'number' && Number.isFinite(m.convertValue)) {
    convertValueNum = m.convertValue;
  } else if (typeof m.convertValue === 'string' && m.convertValue.trim() !== '') {
    const parsed = Number(m.convertValue);
    if (Number.isFinite(parsed)) convertValueNum = parsed;
  }
  const convertTypeIsHv =
    convertType === 'HV' ||
    convertType === 'NONE' ||
    /^HV\d/i.test(convertType);
  if (
    convertValueNum === null &&
    convertTypeIsHv &&
    typeof m.hv === 'number' &&
    Number.isFinite(m.hv)
  ) {
    convertValueNum = m.hv;
  }
  const convertValue: string =
    convertValueNum !== null ? formatHardness(convertValueNum) : '-';
  // eslint-disable-next-line no-console
  console.log(
    `[report-row-map] id=${m.id} convertType=${convertType} convertValue=${convertValue} rawConvertType=${m.convertType ?? 'null'} rawConvertValue=${m.convertValue ?? 'null'}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `[report-render-conversion] type=${convertType} value=${convertValue}`
  );

  // Resolve depth from the saved row only — never from a live micrometer
  // reading. depthMm is the effective value; fall back to the per-source
  // fields for legacy rows that may have one populated but not the other.
  const isFiniteNum = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v);
  const resolvedDepthMm =
    (isFiniteNum(m.depthMm) ? m.depthMm : null) ??
    (isFiniteNum(m.manualDepthMm) ? m.manualDepthMm : null) ??
    (isFiniteNum(m.deviceDepthMm) ? m.deviceDepthMm : null);
  const depthSourceLabel =
    m.depthSource === 'device' || m.depthSource === 'manual'
      ? m.depthSource
      : isFiniteNum(m.manualDepthMm) && !isFiniteNum(m.deviceDepthMm)
        ? 'manual'
        : isFiniteNum(m.deviceDepthMm)
          ? 'device'
          : 'unknown';
  // eslint-disable-next-line no-console
  console.log(
    `[report-row-depth] id=${m.id} depth=${resolvedDepthMm ?? 'null'} source=${depthSourceLabel}`
  );

  const row: ReportRow = {
    index: String(idx + 1),
    xMm: formatCoordinate(m.xMm),
    yMm: formatCoordinate(m.yMm),
    hardness: formatHardness(m.hv),
    hardnessNumeric: typeof m.hv === 'number' && Number.isFinite(m.hv) ? m.hv : null,
    objective: safeText(m.objective, '-'),
    method: safeText(m.method, '-'),
    hardnessType,
    qualified: formatQualified(m.qualified),
    d1Um: formatMicron(d1Um),
    d2Um: formatMicron(d2Um),
    davgUm: formatMicron(davgUm),
    convertType,
    convertValue,
    depth: formatDepth(resolvedDepthMm),
  };

  // eslint-disable-next-line no-console
  console.log(
    `[report-data] row id=${m.id} hardnessType=${row.hardnessType} qualified=${row.qualified} convertType=${row.convertType} convertValue=${row.convertValue || '-'} depth=${row.depth || '-'}`
  );
  // eslint-disable-next-line no-console
  console.log(`[report-depth] row=${row.index} depth=${row.depth || '-'}`);
  // eslint-disable-next-line no-console
  console.log(
    `[report-convert] row=${row.index} convertType=${row.convertType} convertValue=${row.convertValue}`
  );
  return row;
}

function rowAsArray(row: ReportRow): string[] {
  return [
    row.index, row.xMm, row.yMm, row.hardness, row.objective, row.method,
    row.hardnessType, row.qualified, row.d1Um, row.d2Um, row.davgUm,
    row.convertType, row.convertValue, row.depth,
  ];
}

function normalizeAll(measurements: Measurement[]): ReportRow[] {
  const rows = measurements.map((m, i) => normalizeReportRow(m, i));
  // eslint-disable-next-line no-console
  console.log('[report-table] rows normalized count=', rows.length);
  return rows;
}

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function buildCsv(rows: ReportRow[]): string {
  const lines = [HEADERS.map(csvEscape).join(',')];
  rows.forEach((row) => lines.push(rowAsArray(row).map(csvEscape).join(',')));
  return lines.join('\r\n');
}

function downloadBlobBrowser(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Save the generated report. In Electron, round-trip through the main process
// so we end up with a concrete file path and can auto-open the file in MS Word
// (or the OS default handler). When the IPC bridge isn't present (pure-web
// dev, tests), fall back to the <a download> path.
async function saveReportBlob(blob: Blob, filename: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[report-save-start] filename=${filename} size=${blob.size}`);
  const ipc = typeof window !== 'undefined' ? window.api : undefined;
  if (!ipc || typeof ipc.invoke !== 'function') {
    downloadBlobBrowser(blob, filename);
    // eslint-disable-next-line no-console
    console.log(`[report-save-success] path=${filename} mode=browser-download`);
    return;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    const reply = await ipc.invoke('dialog:saveReport', {
      defaultName: filename,
      bytes,
      autoOpen: true,
    });
    if (!reply.ok) {
      if ('canceled' in reply && reply.canceled) {
        // eslint-disable-next-line no-console
        console.log('[report-save-canceled]');
        return;
      }
      const message = 'message' in reply && reply.message ? reply.message : 'unknown';
      // eslint-disable-next-line no-console
      console.warn(`[report-save-failed] error=${message}`);
      throw new Error(`Report save failed: ${message}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[report-save-success] path=${reply.filePath}`);
    if (reply.opened) {
      // eslint-disable-next-line no-console
      console.log(`[report-auto-open-success] path=${reply.filePath}`);
    } else if (reply.openError) {
      // eslint-disable-next-line no-console
      console.warn(
        `[report-auto-open-failed] path=${reply.filePath} error=${reply.openError}`
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[report-auto-open-failed] reason=ipc-error error=${err instanceof Error ? err.message : String(err)} — falling back to browser download`
    );
    downloadBlobBrowser(blob, filename);
  }
}

async function dataUrlToArrayBuffer(dataUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(dataUrl);
  return res.arrayBuffer();
}

async function svgStringToPngBuffer(
  svg: string,
  width: number,
  height: number
): Promise<ArrayBuffer> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('depth-svg load failed'));
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no-2d-context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const pngBlob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob-failed'))),
        'image/png'
      )
    );
    return pngBlob.arrayBuffer();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Match the on-screen DepthVsHvGraph layout 1:1 so the report image is a
// faithful rasterization of what the user just saw on the Depth Image tab.
const DEPTH_SIZE = { w: 760, h: 360 };
const DEPTH_PAD = { top: 66, right: 32, bottom: 62, left: 86 };
const DEPTH_X_TICK_COUNT = 5;
const DEPTH_Y_TICK_COUNT = 8;
// MUI default palette equivalents (theme is not available in this util).
const DEPTH_COLORS = {
  axis: '#212121',
  curve: '#1976d2',
  gridMajor: '#e0e0e0',
  gridMinor: '#f5f5f5',
  label: '#212121',
  muted: '#616161',
  paper: '#ffffff',
  pointFill: '#ffffff',
  reference: '#d32f2f',
};

function buildDepthSvg(measurements: Measurement[], chdTargetHv: number | null): string {
  const { w, h } = DEPTH_SIZE;
  const pad = DEPTH_PAD;
  const points = buildDepthHvGraphPoints(measurements);

  // eslint-disable-next-line no-console
  console.log(
    `[report-depth-graph-data] points=${points.length} chdTargetHv=${chdTargetHv ?? 'null'}`
  );

  if (points.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[report-depth-graph-render] rendered=false reason=no-valid-rows');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="${DEPTH_COLORS.paper}"/>
  <text x="${w / 2}" y="${h / 2 - 8}" font-size="21" font-weight="700" fill="${DEPTH_COLORS.label}" text-anchor="middle">Case Hardness Profile</text>
  <text x="${w / 2}" y="${h / 2 + 14}" font-size="12" fill="${DEPTH_COLORS.muted}" text-anchor="middle">No measurement data available</text>
</svg>`;
  }

  const xAxis = buildAxis(points.map((p) => p.distanceUm), DEPTH_X_TICK_COUNT, true);
  const yValues =
    chdTargetHv !== null && Number.isFinite(chdTargetHv)
      ? [...points.map((p) => p.hv), chdTargetHv]
      : points.map((p) => p.hv);
  const yAxis = buildAxis(yValues, DEPTH_Y_TICK_COUNT, false);
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const sx = (v: number) => pad.left + ((v - xAxis.min) / (xAxis.max - xAxis.min || 1)) * innerW;
  const sy = (v: number) => pad.top + innerH - ((v - yAxis.min) / (yAxis.max - yAxis.min || 1)) * innerH;
  const linePath = buildSmoothPath(points, sx, sy);
  const minorXTicks = buildMinorTicks(xAxis.ticks);
  const minorYTicks = buildMinorTicks(yAxis.ticks);
  const chdIntersection = findChdIntersection(points, chdTargetHv);
  const plotBottom = h - pad.bottom;
  const plotRight = w - pad.right;

  // eslint-disable-next-line no-console
  console.log(
    `[report-depth-graph-render] points=${points.length} xMinUm=${xAxis.min} xMaxUm=${xAxis.max} yMinHv=${yAxis.min} yMaxHv=${yAxis.max}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `[report-depth-graph-chd] targetHv=${chdTargetHv ?? 'null'} intersectionUm=${chdIntersection ? chdIntersection.distanceUm : 'none'} intersectionMm=${chdIntersection ? chdIntersection.depthMm : 'none'}`
  );

  const minorY = minorYTicks
    .map(
      (t) => `<line x1="${pad.left}" x2="${plotRight}" y1="${sy(t)}" y2="${sy(t)}" stroke="${DEPTH_COLORS.gridMinor}" stroke-width="0.7"/>`
    )
    .join('');
  const minorX = minorXTicks
    .map(
      (t) => `<line x1="${sx(t)}" x2="${sx(t)}" y1="${pad.top}" y2="${plotBottom}" stroke="${DEPTH_COLORS.gridMinor}" stroke-width="0.7"/>`
    )
    .join('');
  const majorY = yAxis.ticks
    .map(
      (t) =>
        `<line x1="${pad.left}" x2="${plotRight}" y1="${sy(t)}" y2="${sy(t)}" stroke="${DEPTH_COLORS.gridMajor}" stroke-width="1"/>` +
        `<text x="${pad.left - 10}" y="${sy(t)}" font-size="13" font-weight="600" fill="${DEPTH_COLORS.label}" text-anchor="end" dominant-baseline="middle">${formatHv(t)}</text>`
    )
    .join('');
  const majorX = xAxis.ticks
    .map(
      (t) =>
        `<line x1="${sx(t)}" x2="${sx(t)}" y1="${pad.top}" y2="${plotBottom}" stroke="${DEPTH_COLORS.gridMajor}" stroke-width="1"/>` +
        `<text x="${sx(t)}" y="${plotBottom + 23}" font-size="13" font-weight="600" fill="${DEPTH_COLORS.label}" text-anchor="middle">${Math.round(t)}</text>`
    )
    .join('');
  const frame = `<rect x="${pad.left}" y="${pad.top}" width="${plotRight - pad.left}" height="${plotBottom - pad.top}" fill="none" stroke="${DEPTH_COLORS.axis}" stroke-width="1.5"/>`;
  const xTitle = `<text x="${pad.left + (plotRight - pad.left) / 2}" y="${h - 14}" font-size="15" font-weight="700" fill="${DEPTH_COLORS.label}" text-anchor="middle">Distance from Surface (µm)</text>`;
  const yTitleY = pad.top + (plotBottom - pad.top) / 2;
  const yTitle = `<text x="24" y="${yTitleY}" font-size="15" font-weight="700" fill="${DEPTH_COLORS.label}" text-anchor="middle" transform="rotate(-90 24 ${yTitleY})">Hardness (HV)</text>`;
  const titleEl = `<text x="${w / 2}" y="29" font-size="21" font-weight="700" fill="${DEPTH_COLORS.label}" text-anchor="middle">Case Hardness Profile</text>`;
  const subtitleEl = `<text x="${w / 2}" y="49" font-size="12" font-weight="600" fill="${DEPTH_COLORS.muted}" text-anchor="middle">Industrial metallurgical hardness profile</text>`;

  const curvePath = points.length >= 2
    ? `<path d="${linePath}" fill="none" stroke="${DEPTH_COLORS.curve}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
    : '';
  const dots = points
    .map(
      (p) =>
        `<circle cx="${sx(p.distanceUm)}" cy="${sy(p.hv)}" r="4.5" fill="${DEPTH_COLORS.pointFill}" stroke="${DEPTH_COLORS.curve}" stroke-width="2"/>`
    )
    .join('');

  let chdOverlay = '';
  if (chdTargetHv !== null && Number.isFinite(chdTargetHv)) {
    const refY = sy(chdTargetHv);
    const labelY = Math.max(pad.top + 14, refY - 8);
    chdOverlay =
      `<line x1="${pad.left}" x2="${plotRight}" y1="${refY}" y2="${refY}" stroke="${DEPTH_COLORS.reference}" stroke-width="2" stroke-dasharray="8 6"/>` +
      `<text x="${plotRight - 10}" y="${labelY}" font-size="14" font-weight="700" fill="${DEPTH_COLORS.reference}" text-anchor="end">${formatHv(chdTargetHv)} HV</text>`;
    if (chdIntersection) {
      const ix = sx(chdIntersection.distanceUm);
      chdOverlay +=
        `<line x1="${ix}" x2="${ix}" y1="${refY}" y2="${plotBottom}" stroke="${DEPTH_COLORS.reference}" stroke-width="2" stroke-dasharray="8 6"/>` +
        `<circle cx="${ix}" cy="${refY}" r="5" fill="${DEPTH_COLORS.paper}" stroke="${DEPTH_COLORS.reference}" stroke-width="2"/>` +
        `<text x="${ix + 8}" y="${plotBottom - 10}" font-size="14" font-weight="700" fill="${DEPTH_COLORS.reference}">CHD</text>`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="${DEPTH_COLORS.paper}"/>
  ${titleEl}${subtitleEl}${minorY}${minorX}${majorY}${majorX}${frame}${xTitle}${yTitle}${curvePath}${chdOverlay}${dots}
</svg>`;
}

async function exportCsv(rows: ReportRow[]): Promise<void> {
  const csv = buildCsv(rows);
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  await saveReportBlob(blob, REPORT_FILENAMES.csv);
  // eslint-disable-next-line no-console
  console.log('[report-csv] rows=', rows.length, 'path=', REPORT_FILENAMES.csv);
}

// --- Excel via exceljs (styled headers, borders, autoFilter) ---

async function exportXlsx(rows: ReportRow[], header: ReportHeaderSettingPayload): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hardness Tester';
  wb.created = new Date();
  const ws = wb.addWorksheet('Measurements', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Title row (merged)
  ws.mergeCells(1, 1, 1, HEADERS.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = 'Vickers Hardness Report';
  titleCell.font = { name: 'Arial', size: 14, bold: true };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 24;

  // Sub-header (sample / tester)
  ws.mergeCells(2, 1, 2, HEADERS.length);
  const subCell = ws.getCell(2, 1);
  subCell.value = `Sample: ${safeText(header.sampleName, '-')}    SN: ${safeText(header.sampleSerialNumber, '-')}    Tester: ${safeText(header.tester, '-')}    Date: ${formatInspectionDate()}`;
  subCell.font = { name: 'Arial', size: 10, italic: true };
  subCell.alignment = { horizontal: 'center' };

  // Column header row
  const headerRow = ws.addRow(HEADERS);
  headerRow.font = { name: 'Arial', size: 10, bold: true };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8E8E8' },
  };
  headerRow.height = 20;

  rows.forEach((r) => {
    const dataRow = ws.addRow(rowAsArray(r));
    dataRow.font = { name: 'Arial', size: 10 };
    dataRow.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // Borders
  const lastRow = ws.lastRow?.number ?? 3;
  for (let r = 3; r <= lastRow; r += 1) {
    for (let c = 1; c <= HEADERS.length; c += 1) {
      ws.getCell(r, c).border = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' },
      };
    }
  }

  // Column widths (chars)
  const widths = [4, 9, 9, 10, 10, 12, 14, 10, 11, 11, 11, 13, 14, 12];
  ws.columns = widths.map((w) => ({ width: w }));

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: lastRow, column: HEADERS.length } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  await saveReportBlob(blob, REPORT_FILENAMES.xlsx);
  // eslint-disable-next-line no-console
  console.log('[report-excel] rows=', rows.length, 'path=', REPORT_FILENAMES.xlsx);
}

// --- Industrial Word report (matches reference layout) ---

const DOCX_FONT = 'Arial';
const DOCX_BODY_SIZE = 18; // 9pt
const DOCX_TITLE_SIZE = 36; // 18pt
const DOCX_SECTION_SIZE = 24; // 12pt

const THIN_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const TABLE_BORDERS = {
  top: THIN_BORDER,
  bottom: THIN_BORDER,
  left: THIN_BORDER,
  right: THIN_BORDER,
  insideHorizontal: THIN_BORDER,
  insideVertical: THIN_BORDER,
};

function makeCell(
  text: string,
  width: number,
  opts?: {
    bold?: boolean;
    size?: number;
    align?: typeof AlignmentType[keyof typeof AlignmentType];
    shaded?: boolean;
    columnSpan?: number;
    // Hex color for the text run (e.g. 'D32F2F'). Pass without '#'; the docx
    // library accepts both, but bare 6-char hex is the canonical form.
    color?: string;
  }
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: opts?.columnSpan,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    shading: opts?.shaded ? { fill: 'E8E8E8' } : undefined,
    children: [
      new Paragraph({
        alignment: opts?.align ?? AlignmentType.CENTER,
        children: [
          new TextRun({
            text,
            bold: opts?.bold ?? false,
            size: opts?.size ?? DOCX_BODY_SIZE,
            font: DOCX_FONT,
            color: opts?.color,
          }),
        ],
      }),
    ],
  });
}

function blankParagraph(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: '' })] });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 120 },
    children: [
      new TextRun({ text, bold: true, size: DOCX_SECTION_SIZE, font: DOCX_FONT }),
    ],
  });
}

// A4 landscape: 16838 dxa wide × 11906 tall. Minus 720 margins → ~15398 usable.
const PAGE_WIDTH_DXA = 15400;

function buildSampleInfoTable(
  measurements: Measurement[],
  header: ReportHeaderSettingPayload,
  loadTimeSeconds: number | null
): Table {
  const colW = PAGE_WIDTH_DXA / 4;
  const latest = measurements[measurements.length - 1] ?? null;
  const today = formatInspectionDate();

  const force =
    typeof latest?.testForceKgf === 'number' && Number.isFinite(latest.testForceKgf)
      ? `${latest.testForceKgf}kgf`
      : '-';
  const loadTime =
    typeof loadTimeSeconds === 'number' && Number.isFinite(loadTimeSeconds)
      ? String(loadTimeSeconds)
      : '-';

  const rows: [string, string, string, string][] = [
    ['Sample Name', safeText(header.sampleName, '-'), 'Sample Sn', safeText(header.sampleSerialNumber, '-')],
    [
      'Min Value',
      header.hardnessMin !== null ? String(header.hardnessMin) : '-',
      'Max Value',
      header.hardnessMax !== null ? String(header.hardnessMax) : '-',
    ],
    ['Inspection Company', safeText(header.inspectionCompany, '-'), 'Inspection Date', today],
    ['Tester', safeText(header.tester, '-'), 'Reviewer', safeText(header.reviewer, '-')],
    ['Force', force, 'Load Time (s)', loadTime],
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [colW, colW, colW, colW],
    borders: TABLE_BORDERS,
    rows: rows.map(
      ([k1, v1, k2, v2]) =>
        new TableRow({
          children: [
            makeCell(k1, colW, { bold: true, shaded: true, align: AlignmentType.LEFT }),
            makeCell(v1, colW, { align: AlignmentType.LEFT }),
            makeCell(k2, colW, { bold: true, shaded: true, align: AlignmentType.LEFT }),
            makeCell(v2, colW, { align: AlignmentType.LEFT }),
          ],
        })
    ),
  });
}

type Statistics = {
  count: number;
  max: number | null;
  min: number | null;
  avg: number | null;
  variance: number | null;
  std: number | null;
  cp: number | null;
  cpk: number | null;
};

function computeStatistics(
  measurements: Measurement[],
  lsl: number | null,
  usl: number | null
): Statistics {
  const values = measurements
    .map((m) => m.hv)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const count = values.length;
  if (count === 0) {
    return {
      count: 0,
      max: null,
      min: null,
      avg: null,
      variance: null,
      std: null,
      cp: null,
      cpk: null,
    };
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const avg = values.reduce((a, b) => a + b, 0) / count;
  const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / count;
  const std = Math.sqrt(variance);
  const hasRange = typeof lsl === 'number' && typeof usl === 'number';
  const cp = std > 0 && hasRange ? (usl! - lsl!) / (6 * std) : null;
  const cpk = std > 0 && hasRange
    ? Math.min((usl! - avg) / (3 * std), (avg - lsl!) / (3 * std))
    : null;
  // eslint-disable-next-line no-console
  console.log(
    `[report-stats] ave=${avg.toFixed(3)} std=${std.toFixed(3)} lsl=${lsl ?? '-'} usl=${usl ?? '-'} cp=${cp !== null ? cp.toFixed(3) : '-'} cpk=${cpk !== null ? cpk.toFixed(3) : '-'}`
  );
  if (!hasRange) {
    // eslint-disable-next-line no-console
    console.log('[report-stats] cp-cpk skipped reason=missing-target-range');
  } else if (std === 0) {
    // eslint-disable-next-line no-console
    console.log('[report-stats] cp-cpk skipped reason=std-zero');
  }
  return { count, max, min, avg, variance, std, cp, cpk };
}

function fmtStat(v: number | null, decimals = 2): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(decimals) : '-';
}

function buildStatisticsTable(stats: Statistics): Table {
  const headers = ['NO', 'MAX', 'MIN', 'AVE', 'VAR', 'STD'];
  const colW = PAGE_WIDTH_DXA / headers.length;
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) => makeCell(h, colW, { bold: true, shaded: true })),
  });
  const dataRow = new TableRow({
    children: [
      makeCell(String(stats.count), colW),
      makeCell(fmtStat(stats.max, 2), colW),
      makeCell(fmtStat(stats.min, 2), colW),
      makeCell(fmtStat(stats.avg, 2), colW),
      makeCell(fmtStat(stats.variance, 3), colW),
      makeCell(fmtStat(stats.std, 3), colW),
    ],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: new Array(headers.length).fill(colW),
    borders: TABLE_BORDERS,
    rows: [headerRow, dataRow],
  });
}

function buildDetailedDataTable(
  rows: ReportRow[],
  targetMinHv: number | null,
  targetMaxHv: number | null
): Table {
  const headers = [
    '#',
    'D1(um)',
    'D2(um)',
    'Davg(um)',
    'Depth(mm)',
    'Hardness Type',
    'Hardness Value',
    'Convert Type',
    'Convert Value',
    'Qualified',
  ];
  // Widths sum to ~15400 (same target as before); Depth(mm) carved out of the
  // hardness/convert columns so the table still fills the page width.
  const widths = [600, 1500, 1500, 1500, 1500, 1750, 1750, 1750, 1750, 1700];
  // eslint-disable-next-line no-console
  console.log('[report-depth-column-render]');
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => makeCell(h, widths[i], { bold: true, shaded: true })),
  });
  const dataRows = rows.map((r) => {
    // eslint-disable-next-line no-console
    console.log(
      `[report-detail] row=${r.index} convertType=${r.convertType} convertValue=${r.convertValue}`
    );
    // docx TextRun.color wants a bare hex string with no '#'. Strip it.
    const hardnessColor = getHardnessColor(r.hardnessNumeric, targetMinHv, targetMaxHv).color.replace(
      /^#/,
      ''
    );
    return new TableRow({
      children: [
        makeCell(r.index, widths[0]),
        makeCell(r.d1Um, widths[1]),
        makeCell(r.d2Um, widths[2]),
        makeCell(r.davgUm, widths[3]),
        makeCell(r.depth || '-', widths[4]),
        makeCell(r.hardnessType, widths[5]),
        makeCell(r.hardness, widths[6], { color: hardnessColor, bold: true }),
        makeCell(r.convertType, widths[7]),
        makeCell(r.convertValue, widths[8]),
        makeCell(r.qualified, widths[9]),
      ],
    });
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    borders: TABLE_BORDERS,
    rows: [headerRow, ...dataRows],
  });
}

async function buildPictureTable(
  measurements: Measurement[]
): Promise<{ table: Table | null; count: number }> {
  const withImage = measurements
    .map((m, i) => ({ idx: i + 1, m }))
    .filter((entry) => typeof entry.m.imageDataUrl === 'string' && entry.m.imageDataUrl.length > 0);
  if (withImage.length === 0) return { table: null, count: 0 };

  const indexCellW = 800;
  const pictureCellW = (PAGE_WIDTH_DXA - indexCellW * 2) / 2;
  const widths = [indexCellW, pictureCellW, indexCellW, pictureCellW];

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      makeCell('#', widths[0], { bold: true, shaded: true }),
      makeCell('Picture', widths[1], { bold: true, shaded: true }),
      makeCell('#', widths[2], { bold: true, shaded: true }),
      makeCell('Picture', widths[3], { bold: true, shaded: true }),
    ],
  });

  type Entry = { idx: number; image: TableCell };
  const cells: Entry[] = [];
  for (const entry of withImage) {
    const dataUrl = entry.m.imageDataUrl as string;
    try {
      const buf = await dataUrlToArrayBuffer(dataUrl);
      const imageType: 'jpg' | 'png' = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
      const cell = new TableCell({
        width: { size: pictureCellW, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                data: buf,
                transformation: { width: 300, height: 225 },
                type: imageType,
              }),
            ],
          }),
        ],
      });
      cells.push({ idx: entry.idx, image: cell });
      // eslint-disable-next-line no-console
      console.log('[report-image] embedded idx=', entry.idx, 'bytes=', buf.byteLength);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[report-image] picture cell failed idx=', entry.idx, err);
    }
  }

  const rows: TableRow[] = [headerRow];
  for (let i = 0; i < cells.length; i += 2) {
    const left = cells[i];
    const right = cells[i + 1];
    rows.push(
      new TableRow({
        children: [
          makeCell(String(left.idx), indexCellW, { bold: true }),
          left.image,
          right
            ? makeCell(String(right.idx), indexCellW, { bold: true })
            : makeCell('', indexCellW),
          right
            ? right.image
            : new TableCell({
                width: { size: pictureCellW, type: WidthType.DXA },
                children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
              }),
        ],
      })
    );
  }

  return {
    table: new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: widths,
      borders: TABLE_BORDERS,
      rows,
    }),
    count: cells.length,
  };
}

function buildFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Page ', size: DOCX_BODY_SIZE, font: DOCX_FONT }),
          new TextRun({ children: [PageNumber.CURRENT], size: DOCX_BODY_SIZE, font: DOCX_FONT }),
          new TextRun({ text: ' of ', size: DOCX_BODY_SIZE, font: DOCX_FONT }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: DOCX_BODY_SIZE, font: DOCX_FONT }),
        ],
      }),
    ],
  });
}

async function exportWord(
  type: 'word-data' | 'word-image' | 'word-depth' | 'word-image-depth',
  rows: ReportRow[],
  measurements: Measurement[],
  header: ReportHeaderSettingPayload,
  loadTimeSeconds: number | null,
  chdTargetHv: number | null,
  targetMinHv: number | null,
  targetMaxHv: number | null
): Promise<void> {
  const includeImage = type === 'word-image' || type === 'word-image-depth';
  const includeDepth = type === 'word-depth' || type === 'word-image-depth';
  // eslint-disable-next-line no-console
  console.log(
    `[report-mode] mode=${type === 'word-depth' ? 'depth-hardness' : type === 'word-image-depth' ? 'image-depth-hardness' : type}`
  );

  // eslint-disable-next-line no-console
  console.log('[report-word] building type=', type, 'rows=', rows.length);

  const children: (Paragraph | Table)[] = [];

  // 1. Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 240 },
      children: [
        new TextRun({ text: 'Report', bold: true, size: DOCX_TITLE_SIZE, font: DOCX_FONT }),
      ],
    })
  );

  // 2. Sample / Inspection Info
  children.push(buildSampleInfoTable(measurements, header, loadTimeSeconds));
  children.push(blankParagraph());

  // 3. Statistical Data
  const stats = computeStatistics(measurements, header.hardnessMin, header.hardnessMax);
  children.push(sectionHeading('Statistical data'));
  children.push(buildStatisticsTable(stats));
  // eslint-disable-next-line no-console
  console.log(
    `[report-word] stats count=${stats.count} max=${fmtStat(stats.max)} min=${fmtStat(stats.min)} avg=${fmtStat(stats.avg)}`
  );
  children.push(blankParagraph());

  // 4. Detailed Data
  children.push(sectionHeading('Detailed data'));
  children.push(buildDetailedDataTable(rows, targetMinHv, targetMaxHv));
  children.push(blankParagraph());

  // 5. Pictures
  if (includeImage) {
    const { table, count } = await buildPictureTable(measurements);
    if (table) {
      children.push(sectionHeading('Pictures'));
      children.push(table);
      children.push(blankParagraph());
    }
    // eslint-disable-next-line no-console
    console.log('[report-image] images embedded count=', count);
  }

  // 6. Deep Hardness chart
  let depthAdded = false;
  if (includeDepth) {
    try {
      const svg = buildDepthSvg(measurements, chdTargetHv);
      const png = await svgStringToPngBuffer(svg, DEPTH_SIZE.w, DEPTH_SIZE.h);
      children.push(sectionHeading('Case Hardness Profile'));
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: png,
              transformation: { width: DEPTH_SIZE.w, height: DEPTH_SIZE.h },
              type: 'png',
            }),
          ],
        })
      );
      depthAdded = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[report-depth-chart] embed failed', err);
    }
  }
  // eslint-disable-next-line no-console
  console.log('[report-word] depth image added=', depthAdded);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: DOCX_FONT, size: DOCX_BODY_SIZE },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
              width: 16838,
              height: 11906,
            },
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        footers: { default: buildFooter() },
        children,
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  await saveReportBlob(blob, REPORT_FILENAMES[type]);
  // eslint-disable-next-line no-console
  console.log('[report-word] export success path=', REPORT_FILENAMES[type]);
}

export type ExportReportInput = {
  type: ReportType;
  measurements: Measurement[];
  header: ReportHeaderSettingPayload;
  loadTimeSeconds: number | null;
  // CHD target hardness (HV) for the Case Hardness Profile reference line.
  // Pass the same value the user has in the Depth Image tab's "CHD HV" field;
  // null hides the reference line.
  chdTargetHv?: number | null;
  // Operator-configured target HV band. Drives the hardness color rule in the
  // detailed-data table (red inside the band, dark blue outside).
  targetMinHv?: number | null;
  targetMaxHv?: number | null;
};

export async function exportReport(input: ExportReportInput): Promise<{ filename: string }> {
  const {
    type,
    measurements,
    header,
    loadTimeSeconds,
    chdTargetHv = null,
    targetMinHv = null,
    targetMaxHv = null,
  } = input;
  const t0 = performance.now();
  // eslint-disable-next-line no-console
  console.log(
    '[report-export] start type=',
    type,
    'measurements=',
    measurements.length,
    'header.sample=',
    header.sampleName || '-'
  );
  const missing: string[] = [];
  if (!header.sampleName) missing.push('sampleName');
  if (!header.tester) missing.push('tester');
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.log('[report-data] missing optional fields=', missing.join(','));
  }
  const rows = normalizeAll(measurements);

  try {
    if (type === 'csv') await exportCsv(rows);
    else if (type === 'xlsx') await exportXlsx(rows, header);
    else
      await exportWord(
        type,
        rows,
        measurements,
        header,
        loadTimeSeconds,
        chdTargetHv,
        targetMinHv,
        targetMaxHv
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[report-error] type=', type, 'reason=', err);
    throw err;
  }

  const filename = REPORT_FILENAMES[type];
  // eslint-disable-next-line no-console
  console.log('[report-export] success path=', filename, 'ms=', Math.round(performance.now() - t0));
  return { filename };
}
