// Centralized report generation. CSV is hand-rolled; XLSX uses exceljs for
// styled headers/borders; DOCX uses the docx package. See CLAUDE.md §11.
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  PageBreak,
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
import {
  buildAxis,
  buildDepthHvGraphPoints,
  buildMinorTicks,
  buildSmoothPath,
  findChdIntersection,
  formatChdDepth,
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

function formatClockTime(d = new Date()): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatTimestamp(d = new Date()): string {
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${formatInspectionDate(d)} ${formatClockTime(d)}:${ss}`;
}

function buildReportId(header: ReportHeaderSettingPayload, d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const sn = formatBlank(header.sampleSerialNumber).replace(/\s+/g, '-');
  return sn ? `CM-${y}${m}${day}-${sn}` : `CM-${y}${m}${day}`;
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

  // Resolve depth from the saved row only — never from a live micrometer
  // reading. depthMm is the effective value; fall back to the per-source
  // fields for legacy rows that may have one populated but not the other.
  const isFiniteNum = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v);
  const resolvedDepthMm =
    (isFiniteNum(m.depthMm) ? m.depthMm : null) ??
    (isFiniteNum(m.manualDepthMm) ? m.manualDepthMm : null) ??
    (isFiniteNum(m.deviceDepthMm) ? m.deviceDepthMm : null);
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
  return measurements.map((m, i) => normalizeReportRow(m, i));
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
  const ipc = typeof window !== 'undefined' ? window.api : undefined;
  if (!ipc || typeof ipc.invoke !== 'function') {
    downloadBlobBrowser(blob, filename);
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
        return;
      }
      const message = 'message' in reply && reply.message ? reply.message : 'unknown';
      throw new Error(`Report save failed: ${message}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[report-save-failed] ${err instanceof Error ? err.message : String(err)}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Industrial report palette — the single source of truth for every color in
// the generated .docx. docx wants bare 6-char hex (no leading '#').
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  navy: '123B6D',
  navyDark: '0E2E55',
  blue: '1E88E5',
  green: '2E7D32',
  greenBg: 'E7F2E8',
  red: 'C62828',
  ink: '1F2937',
  ink2: '475569',
  muted: '6B7280',
  line: 'D8DEE7',
  soft: 'EAF1FB',
  zebra: 'F4F7FB',
  white: 'FFFFFF',
} as const;

// Match the on-screen DepthVsHvGraph layout 1:1 so the report image is a
// faithful rasterization of what the user just saw on the Depth Image tab.
const DEPTH_SIZE = { w: 900, h: 380 };
// Right padding is intentionally generous (vs. the on-screen graph) so the
// right-axis reference label, the last X-axis tick label, and the CHD callout
// never sit flush against the image edge — the cause of right-side cropping in
// the Word export. Left padding holds the Y-axis labels + rotated title.
const DEPTH_PAD = { top: 66, right: 96, bottom: 62, left: 92 };
const DEPTH_X_TICK_COUNT = 5;
const DEPTH_Y_TICK_COUNT = 8;
const DEPTH_COLORS = {
  axis: '#1F2937',
  curve: '#1E88E5',
  gridMajor: '#E0E6EE',
  gridMinor: '#F2F5F9',
  label: '#123B6D',
  muted: '#6B7280',
  paper: '#ffffff',
  pointFill: '#ffffff',
  reference: '#C62828',
};

function buildDepthSvg(measurements: Measurement[], chdTargetHv: number | null): string {
  const { w, h } = DEPTH_SIZE;
  const pad = DEPTH_PAD;
  const points = buildDepthHvGraphPoints(measurements);

  if (points.length === 0) {
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
        `<text x="${pad.left - 10}" y="${sy(t)}" font-size="13" font-weight="600" fill="${DEPTH_COLORS.axis}" text-anchor="end" dominant-baseline="middle">${formatHv(t)}</text>`
    )
    .join('');
  const majorX = xAxis.ticks
    .map(
      (t) =>
        `<line x1="${sx(t)}" x2="${sx(t)}" y1="${pad.top}" y2="${plotBottom}" stroke="${DEPTH_COLORS.gridMajor}" stroke-width="1"/>` +
        `<text x="${sx(t)}" y="${plotBottom + 23}" font-size="13" font-weight="600" fill="${DEPTH_COLORS.axis}" text-anchor="middle">${Math.round(t)}</text>`
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
      const labelW = 100;
      const overflowsRight = ix + 10 + labelW > plotRight;
      const lx = overflowsRight ? ix - 10 : ix + 10;
      const anchor = overflowsRight ? 'end' : 'start';
      const labelLine1Y = Math.min(refY + 20, plotBottom - 24);
      // Report X axis is always µm here, so the CHD depth is shown in µm.
      chdOverlay +=
        `<line x1="${ix}" x2="${ix}" y1="${refY}" y2="${plotBottom}" stroke="${DEPTH_COLORS.reference}" stroke-width="2" stroke-dasharray="8 6"/>` +
        `<circle cx="${ix}" cy="${refY}" r="5" fill="${DEPTH_COLORS.paper}" stroke="${DEPTH_COLORS.reference}" stroke-width="2"/>` +
        `<text x="${lx}" y="${labelLine1Y}" font-size="13" font-weight="700" fill="${DEPTH_COLORS.reference}" stroke="${DEPTH_COLORS.paper}" stroke-width="3" paint-order="stroke" text-anchor="${anchor}">` +
        `<tspan x="${lx}" dy="0">CHD = ${formatChdDepth(chdIntersection, true)}</tspan>` +
        `<tspan x="${lx}" dy="16">HV = ${formatHv(chdTargetHv)}</tspan>` +
        `</text>`;
    } else {
      chdOverlay +=
        `<text x="${plotRight - 10}" y="${labelY + 18}" font-size="13" font-weight="700" fill="${DEPTH_COLORS.reference}" text-anchor="end">CHD: Not found</text>`;
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
}

// --- Excel via exceljs (styled headers, borders, autoFilter) ---

async function exportXlsx(rows: ReportRow[], header: ReportHeaderSettingPayload): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Chennai Metco Vickers Measurement Software';
  wb.created = new Date();
  const ws = wb.addWorksheet('Measurements', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  // Title row (merged)
  ws.mergeCells(1, 1, 1, HEADERS.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = 'CHENNAI METCO — VICKERS HARDNESS TEST REPORT';
  titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123B6D' } };
  ws.getRow(1).height = 26;

  // Sub-header (sample / tester)
  ws.mergeCells(2, 1, 2, HEADERS.length);
  const subCell = ws.getCell(2, 1);
  subCell.value = `Sample: ${safeText(header.sampleName, '-')}    SN: ${safeText(header.sampleSerialNumber, '-')}    Tester: ${safeText(header.tester, '-')}    Date: ${formatInspectionDate()}`;
  subCell.font = { name: 'Arial', size: 10, italic: true };
  subCell.alignment = { horizontal: 'center' };

  // Column header row
  const headerRow = ws.addRow(HEADERS);
  headerRow.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF123B6D' },
  };
  headerRow.height = 20;

  rows.forEach((r, i) => {
    const dataRow = ws.addRow(rowAsArray(r));
    dataRow.font = { name: 'Arial', size: 10 };
    dataRow.alignment = { horizontal: 'center', vertical: 'middle' };
    // Zebra striping on alternate data rows.
    if (i % 2 === 1) {
      dataRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F7FB' } };
    }
  });

  // Borders
  const lastRow = ws.lastRow?.number ?? 3;
  for (let r = 3; r <= lastRow; r += 1) {
    for (let c = 1; c <= HEADERS.length; c += 1) {
      ws.getCell(r, c).border = {
        top: { style: 'thin', color: { argb: 'FFD8DEE7' } },
        bottom: { style: 'thin', color: { argb: 'FFD8DEE7' } },
        left: { style: 'thin', color: { argb: 'FFD8DEE7' } },
        right: { style: 'thin', color: { argb: 'FFD8DEE7' } },
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Industrial Word certificate
// ─────────────────────────────────────────────────────────────────────────────

const DOCX_FONT = 'Arial';
const DOCX_BODY_SIZE = 18; // 9pt (docx sizes are half-points)

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const LINE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: C.line };
const TABLE_BORDERS = {
  top: LINE_BORDER,
  bottom: LINE_BORDER,
  left: LINE_BORDER,
  right: LINE_BORDER,
  insideHorizontal: LINE_BORDER,
  insideVertical: LINE_BORDER,
};
const CARD_BORDERS = {
  top: LINE_BORDER,
  bottom: LINE_BORDER,
  left: LINE_BORDER,
  right: LINE_BORDER,
};

// A4 landscape: 16838 dxa wide × 11906 tall. Minus 720 margins → ~15398 usable.
const PAGE_WIDTH_DXA = 15400;

function makeCell(
  text: string,
  width: number,
  opts?: {
    bold?: boolean;
    size?: number;
    align?: typeof AlignmentType[keyof typeof AlignmentType];
    shaded?: boolean;
    fill?: string;
    columnSpan?: number;
    color?: string;
    compact?: boolean;
  }
): TableCell {
  const margin = opts?.compact ? 36 : 80;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: opts?.columnSpan,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: margin, bottom: margin, left: 120, right: 120 },
    shading: opts?.fill
      ? { fill: opts.fill }
      : opts?.shaded
        ? { fill: C.soft }
        : undefined,
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
  return new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: '' })] });
}

function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 130 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: C.navy, space: 4 } },
    children: [
      new TextRun({ text: text.toUpperCase(), bold: true, size: 24, color: C.navy, font: DOCX_FONT }),
    ],
  });
}

// ── Repeating page header band (navy, left/center/right) ──────────────────────
function buildHeaderBand(reportId: string, dateStr: string, timeStr: string): Header {
  const leftW = 4200;
  const centerW = 7000;
  const rightW = PAGE_WIDTH_DXA - leftW - centerW;
  const white = (text: string, size: number, bold = false) =>
    new TextRun({ text, size, bold, color: C.white, font: DOCX_FONT });

  const bandCell = (
    children: Paragraph[],
    width: number
  ): TableCell =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      shading: { fill: C.navy },
      borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
      children,
    });

  const left = bandCell(
    [
      new Paragraph({ children: [white('CHENNAI METCO', 26, true)] }),
      new Paragraph({ spacing: { before: 20 }, children: [white('Industrial Material Inspection', 14)] }),
    ],
    leftW
  );
  const center = bandCell(
    [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [white('VICKERS HARDNESS TEST REPORT', 28, true)],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 20 },
        children: [white('Industrial Material Inspection Report', 16)],
      }),
    ],
    centerW
  );
  const right = bandCell(
    [
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [white(`Report ID: ${reportId}`, 15)] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [white(`Date: ${dateStr}    Time: ${timeStr}`, 15)] }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          white('Page ', 15),
          new TextRun({ children: [PageNumber.CURRENT], size: 15, color: C.white, font: DOCX_FONT }),
          new TextRun({ children: [' / ', PageNumber.TOTAL_PAGES], size: 15, color: C.white, font: DOCX_FONT }),
        ],
      }),
    ],
    rightW
  );

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [leftW, centerW, rightW],
    borders: {
      top: NO_BORDER,
      bottom: { style: BorderStyle.SINGLE, size: 24, color: C.blue },
      left: NO_BORDER,
      right: NO_BORDER,
      insideHorizontal: NO_BORDER,
      insideVertical: NO_BORDER,
    },
    rows: [new TableRow({ children: [left, center, right] })],
  });

  return new Header({ children: [table, new Paragraph({ spacing: { after: 40 }, children: [] })] });
}

// ── Footer band (navy divider + left/center/right) ────────────────────────────
function buildFooter(timestamp: string): Footer {
  const colW = PAGE_WIDTH_DXA / 3;
  const small = (children: TextRun[], align: typeof AlignmentType[keyof typeof AlignmentType]) =>
    new TableCell({
      width: { size: colW, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 60, bottom: 20, left: 100, right: 100 },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 12, color: C.navy },
        bottom: NO_BORDER,
        left: NO_BORDER,
        right: NO_BORDER,
      },
      children: [new Paragraph({ alignment: align, children })],
    });

  const txt = (text: string, opts?: { bold?: boolean; color?: string }) =>
    new TextRun({ text, size: 14, font: DOCX_FONT, bold: opts?.bold, color: opts?.color ?? C.muted });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [colW, colW, colW],
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      insideHorizontal: NO_BORDER,
      insideVertical: NO_BORDER,
    },
    rows: [
      new TableRow({
        children: [
          small(
            [txt('Generated by '), txt('Chennai Metco Vickers Measurement Software', { bold: true, color: C.navy })],
            AlignmentType.LEFT
          ),
          small([txt('www.chennaimetco.com', { color: C.blue })], AlignmentType.CENTER),
          small(
            [
              txt('Page '),
              new TextRun({ children: [PageNumber.CURRENT], size: 14, font: DOCX_FONT, color: C.muted }),
              txt(' of '),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, font: DOCX_FONT, color: C.muted }),
              txt(`  |  ${timestamp}`),
            ],
            AlignmentType.RIGHT
          ),
        ],
      }),
    ],
  });

  return new Footer({ children: [table] });
}

// ── 2-column key/value card table (Sample Information, Test Conditions) ────────
function buildKvTable(pairs: [string, string][]): Table {
  const colW = PAGE_WIDTH_DXA / 4;
  const keyCell = (k: string) =>
    makeCell(k, colW, { bold: true, fill: C.soft, color: C.navy, align: AlignmentType.LEFT });
  const valCell = (v: string) => makeCell(v, colW, { align: AlignmentType.LEFT, color: C.ink });

  const rows: TableRow[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i];
    const b = pairs[i + 1] ?? ['', ''];
    rows.push(
      new TableRow({
        children: [keyCell(a[0]), valCell(a[1]), keyCell(b[0]), valCell(b[1])],
      })
    );
  }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [colW, colW, colW, colW],
    borders: TABLE_BORDERS,
    rows,
  });
}

function buildSampleInfoTable(
  header: ReportHeaderSettingPayload,
  material: string,
  machineName: string
): Table {
  const pairs: [string, string][] = [
    ['Sample Name', safeText(header.sampleName, '-')],
    ['Sample No', safeText(header.sampleSerialNumber, '-')],
    ['Inspection Company', safeText(header.inspectionCompany, '-')],
    ['Inspection Date', formatInspectionDate()],
    ['Tester / Operator', safeText(header.tester, '-')],
    ['Reviewer', safeText(header.reviewer, '-')],
    ['Material', material.trim() || 'Not Specified'],
    ['Machine Name', machineName.trim() || 'Not Specified'],
  ];
  return buildKvTable(pairs);
}

function buildTestConditionsTable(
  rows: ReportRow[],
  measurements: Measurement[],
  loadTimeSeconds: number | null,
  minHv: number | null,
  maxHv: number | null
): Table {
  const latest = measurements[measurements.length - 1] ?? null;
  const lastRow = rows[rows.length - 1] ?? null;
  const force =
    typeof latest?.testForceKgf === 'number' && Number.isFinite(latest.testForceKgf)
      ? `${latest.testForceKgf} kgf`
      : '-';
  const loadTime =
    typeof loadTimeSeconds === 'number' && Number.isFinite(loadTimeSeconds)
      ? `${loadTimeSeconds} s`
      : '-';
  const pairs: [string, string][] = [
    ['Force', force],
    ['Load Time', loadTime],
    ['Objective', safeText(latest?.objective, '-')],
    ['Hardness Type', lastRow ? lastRow.hardnessType : '-'],
    ['Min HV', minHv !== null ? String(minHv) : '-'],
    ['Max HV', maxHv !== null ? String(maxHv) : '-'],
  ];
  return buildKvTable(pairs);
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
  return { count, max, min, avg, variance, std, cp, cpk };
}

function fmtStat(v: number | null, decimals = 2): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(decimals) : '-';
}

type Verdict = { label: string; fill: string; hasCriteria: boolean };

function computeVerdict(stats: Statistics, minHv: number | null, maxHv: number | null): Verdict {
  const hasCriteria = minHv !== null && maxHv !== null;
  if (!hasCriteria || stats.min === null || stats.max === null) {
    return { label: 'NO CRITERIA', fill: C.muted, hasCriteria: false };
  }
  const pass = stats.min >= minHv && stats.max <= maxHv;
  return { label: pass ? 'PASS' : 'FAIL', fill: pass ? C.green : C.red, hasCriteria: true };
}

// ── Result Summary KPI dashboard ──────────────────────────────────────────────
function kpiCell(
  label: string,
  value: string,
  width: number,
  opts?: { fill?: string; valueColor?: string; whiteText?: boolean }
): TableCell {
  const valueColor = opts?.whiteText ? C.white : opts?.valueColor ?? C.navy;
  const labelColor = opts?.whiteText ? C.white : C.muted;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 140, bottom: 140, left: 80, right: 80 },
    shading: opts?.fill ? { fill: opts.fill } : undefined,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 20, color: opts?.fill ?? C.blue },
      bottom: LINE_BORDER,
      left: LINE_BORDER,
      right: LINE_BORDER,
    },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 14, color: labelColor, font: DOCX_FONT })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60 },
        children: [new TextRun({ text: value, bold: true, size: 38, color: valueColor, font: DOCX_FONT })],
      }),
    ],
  });
}

function buildResultSummaryDashboard(stats: Statistics, verdict: Verdict): Table {
  const colW = PAGE_WIDTH_DXA / 6;
  const range =
    stats.max !== null && stats.min !== null ? fmtStat(stats.max - stats.min, 1) : '-';
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: new Array(6).fill(colW),
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      insideHorizontal: NO_BORDER,
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: C.white },
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          kpiCell('Average HV', fmtStat(stats.avg, 1), colW),
          kpiCell('Minimum HV', fmtStat(stats.min, 1), colW),
          kpiCell('Maximum HV', fmtStat(stats.max, 1), colW),
          kpiCell('Range', range, colW),
          kpiCell('Measurements', String(stats.count), colW),
          kpiCell('Result', verdict.label, colW, { fill: verdict.fill, whiteText: true }),
        ],
      }),
    ],
  });
}

// ── Detailed measurement data table ───────────────────────────────────────────
function buildDetailedDataTable(rows: ReportRow[]): Table {
  const headers = [
    '#',
    'D1 (µm)',
    'D2 (µm)',
    'Davg (µm)',
    'Depth (mm)',
    'Hardness Type',
    'Hardness Value',
    'Convert Type',
    'Convert Value',
    'Qualified',
  ];
  const widths = [600, 1500, 1500, 1500, 1500, 1750, 1750, 1750, 1750, 1700];
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      makeCell(h, widths[i], { bold: true, fill: C.navy, color: C.white, compact: true })
    ),
  });
  const dataRows = rows.map((r, idx) => {
    const zebra = idx % 2 === 1 ? C.zebra : undefined;
    const cell = (text: string, w: number, o?: { bold?: boolean; color?: string }) =>
      makeCell(text, w, { compact: true, fill: zebra, color: o?.color ?? C.ink2, bold: o?.bold });
    const qualifiedColor = r.qualified === 'YES' ? C.green : C.red;
    return new TableRow({
      cantSplit: true,
      children: [
        cell(r.index, widths[0]),
        cell(r.d1Um, widths[1]),
        cell(r.d2Um, widths[2]),
        cell(r.davgUm, widths[3]),
        cell(r.depth || '-', widths[4]),
        cell(r.hardnessType, widths[5]),
        cell(r.hardness || '-', widths[6], { bold: true, color: C.red }),
        cell(r.convertType, widths[7]),
        cell(r.convertValue, widths[8]),
        cell(r.qualified, widths[9], { bold: true, color: qualifiedColor }),
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

// ── Measurement image cards (2 × 2) ───────────────────────────────────────────
async function buildPictureCards(
  measurements: Measurement[],
  rows: ReportRow[]
): Promise<{ table: Table | null; count: number }> {
  const entries = measurements
    .map((m, i) => ({ idx: i + 1, m, row: rows[i] }))
    .filter((e) => typeof e.m.imageDataUrl === 'string' && (e.m.imageDataUrl as string).length > 0);
  if (entries.length === 0) return { table: null, count: 0 };

  const cardW = PAGE_WIDTH_DXA / 2;

  const buildCard = async (entry: { idx: number; m: Measurement; row: ReportRow }): Promise<TableCell> => {
    const { idx, m, row } = entry;
    const dataUrl = m.imageDataUrl as string;
    const imageType: 'jpg' | 'png' = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
    let imagePara: Paragraph;
    try {
      const buf = await dataUrlToArrayBuffer(dataUrl);
      imagePara = new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 80, after: 60 },
        children: [
          new ImageRun({ data: buf, transformation: { width: 360, height: 270 }, type: imageType }),
        ],
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[report-image] picture cell failed idx=', idx, err);
      imagePara = new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: '(image unavailable)', italics: true, size: 16, color: C.muted, font: DOCX_FONT })],
      });
    }

    const hvText = row?.hardness ? `HV ${row.hardness}` : 'HV -';
    const objective = row?.objective && row.objective !== '-' ? row.objective : 'Objective —';
    const headerPara = new Paragraph({
      shading: { fill: C.navy },
      spacing: { before: 40, after: 60 },
      children: [
        new TextRun({ text: `  Measurement #${idx}`, bold: true, size: 18, color: C.white, font: DOCX_FONT }),
        new TextRun({ text: `      ${objective}      ${hvText}  `, size: 16, color: C.white, font: DOCX_FONT }),
      ],
    });
    const metricsPara = new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `D1 ${row?.d1Um ?? '-'}     D2 ${row?.d2Um ?? '-'}     Davg ${row?.davgUm ?? '-'}`, size: 16, color: C.ink2, font: DOCX_FONT }),
      ],
    });
    const qualifiedColor = row?.qualified === 'YES' ? C.green : C.red;
    const qualifiedPara = new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 30 },
      children: [
        new TextRun({ text: 'Qualified: ', size: 16, color: C.muted, font: DOCX_FONT }),
        new TextRun({ text: row?.qualified ?? '-', bold: true, size: 16, color: qualifiedColor, font: DOCX_FONT }),
      ],
    });

    return new TableCell({
      width: { size: cardW, type: WidthType.DXA },
      verticalAlign: VerticalAlign.TOP,
      margins: { top: 60, bottom: 100, left: 120, right: 120 },
      borders: CARD_BORDERS,
      children: [headerPara, imagePara, metricsPara, qualifiedPara],
    });
  };

  const cards: TableCell[] = [];
  for (const entry of entries) {
    cards.push(await buildCard(entry));
  }

  const emptyCell = () =>
    new TableCell({
      width: { size: cardW, type: WidthType.DXA },
      borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
      children: [new Paragraph({ children: [] })],
    });

  const rowsOut: TableRow[] = [];
  for (let i = 0; i < cards.length; i += 2) {
    rowsOut.push(
      new TableRow({
        cantSplit: true,
        children: [cards[i], cards[i + 1] ?? emptyCell()],
      })
    );
  }

  return {
    table: new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [cardW, cardW],
      borders: {
        top: NO_BORDER,
        bottom: NO_BORDER,
        left: NO_BORDER,
        right: NO_BORDER,
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: C.white },
        insideVertical: { style: BorderStyle.SINGLE, size: 4, color: C.white },
      },
      rows: rowsOut,
    }),
    count: cards.length,
  };
}

// ── CHD page: callout + statistics / notes / acceptance cards ──────────────────
function buildChdCallout(text: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [PAGE_WIDTH_DXA],
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: { style: BorderStyle.SINGLE, size: 30, color: C.navy },
      right: NO_BORDER,
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
            shading: { fill: C.soft },
            margins: { top: 140, bottom: 140, left: 200, right: 160 },
            children: [
              new Paragraph({
                children: [new TextRun({ text, bold: true, size: 22, color: C.navy, font: DOCX_FONT })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function infoCard(title: string, lines: string[], width: number): TableCell {
  const titlePara = new Paragraph({
    shading: { fill: C.navy },
    spacing: { after: 80 },
    children: [new TextRun({ text: `  ${title}`, bold: true, size: 18, color: C.white, font: DOCX_FONT })],
  });
  const bodyParas = lines.map(
    (line) =>
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: line, size: 16, color: C.ink2, font: DOCX_FONT })],
      })
  );
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 60, bottom: 100, left: 140, right: 140 },
    borders: CARD_BORDERS,
    children: [titlePara, ...bodyParas],
  });
}

function buildChdCardsRow(
  stats: Statistics,
  minHv: number | null,
  maxHv: number | null,
  chdTargetHv: number | null,
  verdict: Verdict
): Table {
  const colW = PAGE_WIDTH_DXA / 3;
  const range = stats.max !== null && stats.min !== null ? fmtStat(stats.max - stats.min, 2) : '-';
  const statsCard = infoCard(
    'Statistics Summary',
    [
      `Mean: ${fmtStat(stats.avg, 2)} HV`,
      `Std Deviation: ${fmtStat(stats.std, 3)}`,
      `Minimum: ${fmtStat(stats.min, 2)} HV`,
      `Maximum: ${fmtStat(stats.max, 2)} HV`,
      `Range: ${range} HV`,
      `Measurements: ${stats.count}`,
    ],
    colW
  );
  const notesCard = infoCard(
    'Notes',
    [
      'Test method: Vickers (HV).',
      'Hardness values are as-measured.',
      'Conversions per the selected scale.',
      'Diagonals measured in micrometres (µm).',
      'Depth referenced from the surface.',
    ],
    colW
  );
  const acceptanceCard = infoCard(
    'Acceptance Criteria',
    [
      `Minimum HV: ${minHv !== null ? String(minHv) : 'Not Specified'}`,
      `Maximum HV: ${maxHv !== null ? String(maxHv) : 'Not Specified'}`,
      `CHD Target: ${chdTargetHv !== null ? `${formatHv(chdTargetHv)} HV` : 'Not Specified'}`,
      `Result: ${verdict.label}`,
    ],
    colW
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [colW, colW, colW],
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      insideHorizontal: NO_BORDER,
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: C.white },
    },
    rows: [new TableRow({ cantSplit: true, children: [statsCard, notesCard, acceptanceCard] })],
  });
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
}

async function exportWord(
  type: 'word-data' | 'word-image' | 'word-depth' | 'word-image-depth',
  rows: ReportRow[],
  measurements: Measurement[],
  header: ReportHeaderSettingPayload,
  loadTimeSeconds: number | null,
  chdTargetHv: number | null,
  material: string,
  machineName: string,
  minHv: number | null,
  maxHv: number | null
): Promise<void> {
  const includeImage = type === 'word-image' || type === 'word-image-depth';
  const includeDepth = type === 'word-depth' || type === 'word-image-depth';

  const now = new Date();
  const reportId = buildReportId(header, now);
  const dateStr = formatInspectionDate(now);
  const timeStr = formatClockTime(now);
  const timestamp = formatTimestamp(now);

  const stats = computeStatistics(measurements, minHv, maxHv);
  const verdict = computeVerdict(stats, minHv, maxHv);

  const children: (Paragraph | Table)[] = [];

  // PAGE 1 — Sample Information
  children.push(sectionTitle('Sample Information'));
  children.push(buildSampleInfoTable(header, material, machineName));
  children.push(blankParagraph());

  // PAGE 1 — Test Conditions
  children.push(sectionTitle('Test Conditions'));
  children.push(buildTestConditionsTable(rows, measurements, loadTimeSeconds, minHv, maxHv));
  children.push(blankParagraph());

  // PAGE 1 — Result Summary dashboard
  children.push(sectionTitle('Result Summary'));
  children.push(buildResultSummaryDashboard(stats, verdict));
  children.push(blankParagraph());

  // PAGE 1 — Detailed measurement data
  children.push(sectionTitle('Detailed Measurement Data'));
  children.push(buildDetailedDataTable(rows));

  // IMAGE PAGE
  if (includeImage) {
    const { table } = await buildPictureCards(measurements, rows);
    if (table) {
      children.push(pageBreak());
      children.push(sectionTitle('Measurement Images'));
      children.push(table);
    }
  }

  // CHD PAGE
  if (includeDepth) {
    children.push(pageBreak());
    children.push(sectionTitle('Case Hardness Profile'));
    try {
      const svg = buildDepthSvg(measurements, chdTargetHv);
      const png = await svgStringToPngBuffer(svg, DEPTH_SIZE.w, DEPTH_SIZE.h);
      // Insert at a width comfortably below the usable page width (twips→px at
      // 96 dpi, then 85%) and derive the height from the SVG aspect ratio.
      // Explicit sizing avoids relying on Word auto-scaling, which can clip a
      // full-width image at the right margin.
      const usablePx = Math.floor((PAGE_WIDTH_DXA / 1440) * 96);
      const imgW = Math.min(DEPTH_SIZE.w, Math.floor(usablePx * 0.85));
      const imgH = Math.round(imgW * (DEPTH_SIZE.h / DEPTH_SIZE.w));
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [
            new ImageRun({ data: png, transformation: { width: imgW, height: imgH }, type: 'png' }),
          ],
        })
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[report-depth-chart] embed failed', err);
    }

    const points = buildDepthHvGraphPoints(measurements);
    const chdIntersection = findChdIntersection(points, chdTargetHv);
    const calloutText =
      chdTargetHv === null
        ? 'CHD target hardness not specified.'
        : chdIntersection
          ? `Case Hardening Depth (CHD) @ target ${formatHv(chdTargetHv)} HV = ${formatChdDepth(chdIntersection, false)}`
          : 'CHD not found within measured depth range.';
    children.push(buildChdCallout(calloutText));
    children.push(blankParagraph());
    children.push(buildChdCardsRow(stats, minHv, maxHv, chdTargetHv, verdict));
  }

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
            margin: { top: 1700, right: 720, bottom: 900, left: 720 },
          },
        },
        headers: { default: buildHeaderBand(reportId, dateStr, timeStr) },
        footers: { default: buildFooter(timestamp) },
        children,
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  await saveReportBlob(blob, REPORT_FILENAMES[type]);
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
  // Operator-configured target HV band. Used as a fallback for the acceptance
  // criteria when the report header's Min/Max HV are not set.
  targetMinHv?: number | null;
  targetMaxHv?: number | null;
  // Ephemeral, dialog-only fields — NOT persisted to the DB. Shown in the
  // Sample Information section; rendered as "Not Specified" when empty.
  material?: string | null;
  machineName?: string | null;
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
    material = null,
    machineName = null,
  } = input;
  const rows = normalizeAll(measurements);
  const minHv = header.hardnessMin ?? targetMinHv;
  const maxHv = header.hardnessMax ?? targetMaxHv;

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
        material ?? '',
        machineName ?? '',
        minHv,
        maxHv
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[report-error] type=', type, 'reason=', err);
    throw err;
  }

  const filename = REPORT_FILENAMES[type];
  return { filename };
}
