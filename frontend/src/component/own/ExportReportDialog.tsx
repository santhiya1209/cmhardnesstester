import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import ShowChartOutlinedIcon from '@mui/icons-material/ShowChartOutlined';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import { useReportHeaderSetting } from '@/hooks/queries/useReportHeaderSetting';
import { useMachineSnapshot } from '@/contexts/MachineStateContext';
import type { Measurement } from '@/types/measurement';
import { exportReport, type ReportType } from '@/utils/exportReport';

const NAVY = '#123B6D';
const NAVY_DARK = '#0E2E55';
const BLUE = '#1E88E5';
const SOFT = '#EAF1FB';

type TemplateKey = 'summary' | 'images' | 'chd' | 'complete';
type FormatKey = 'word' | 'excel' | 'csv';

const TEMPLATES: {
  key: TemplateKey;
  title: string;
  subtitle: string;
  Icon: typeof DescriptionOutlinedIcon;
}[] = [
  { key: 'summary', title: 'Measurement Summary', subtitle: 'Data table only', Icon: DescriptionOutlinedIcon },
  { key: 'images', title: 'With Images', subtitle: 'Data + image thumbnails + overlays', Icon: ImageOutlinedIcon },
  { key: 'chd', title: 'Case Hardness', subtitle: 'Data + graph + CHD calculation', Icon: ShowChartOutlinedIcon },
  { key: 'complete', title: 'Complete Laboratory', subtitle: 'Full industrial report package', Icon: AssignmentOutlinedIcon },
];

function toReportType(template: TemplateKey, format: FormatKey): ReportType {
  if (format === 'excel') return 'xlsx';
  if (format === 'csv') return 'csv';
  switch (template) {
    case 'summary': return 'word-data';
    case 'images': return 'word-image';
    case 'chd': return 'word-depth';
    case 'complete': return 'word-image-depth';
  }
}

const SECTION_LABEL_SX: SxProps<Theme> = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  color: NAVY,
  mb: 1,
};

type TemplateCardProps = {
  title: string;
  subtitle: string;
  Icon: typeof DescriptionOutlinedIcon;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
};

const TemplateCard = memo(function TemplateCard({
  title,
  subtitle,
  Icon,
  active,
  disabled,
  onSelect,
}: TemplateCardProps) {
  return (
    <Box
      role="button"
      aria-pressed={active}
      onClick={disabled ? undefined : onSelect}
      sx={{
        position: 'relative',
        border: '1.5px solid',
        borderColor: active ? NAVY : 'divider',
        borderRadius: 1.5,
        p: 1.25,
        pl: 1.5,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        bgcolor: active ? SOFT : 'background.paper',
        transition: 'all .15s ease',
        '&:hover': disabled
          ? undefined
          : { transform: 'translateY(-2px)', boxShadow: '0 6px 16px rgba(18,59,109,.14)', borderColor: BLUE },
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          borderRadius: '6px 0 0 6px',
          bgcolor: active ? NAVY : 'transparent',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon fontSize="small" sx={{ color: active ? NAVY : 'text.secondary' }} />
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: active ? NAVY : 'text.primary' }}>
          {title}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25 }}>{subtitle}</Typography>
    </Box>
  );
});

type Props = {
  open: boolean;
  onClose: () => void;
  measurements: Measurement[];
  cameraImageDataUrl?: string | null;
  targetMinHv?: number | null;
  targetMaxHv?: number | null;
  chdTargetInput: string;
  onChdTargetInputChange: (value: string) => void;
};

function ExportReportDialogImpl({
  open,
  onClose,
  measurements,
  targetMinHv = null,
  targetMaxHv = null,
  chdTargetInput,
  onChdTargetInputChange,
}: Props) {
  const [template, setTemplate] = useState<TemplateKey>('summary');
  const [format, setFormat] = useState<FormatKey>('word');
  const [material, setMaterial] = useState('');
  const [machineName, setMachineName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { values: header, setValues, persist, loading } = useReportHeaderSetting(open);
  const machineState = useMachineSnapshot();

  const includesDepth = template === 'chd' || template === 'complete';
  const isWord = format === 'word';
  const showChd = isWord && includesDepth;
  const chdTargetHv = (() => {
    const parsed = Number(chdTargetInput.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  })();

  const imageCount = useMemo(
    () => measurements.filter((m) => typeof m.imageDataUrl === 'string' && m.imageDataUrl.length > 0).length,
    [measurements]
  );
  const graphIncluded = isWord && includesDepth;

  useEffect(() => {
    if (open) {
      setTemplate('summary');
      setFormat('word');
      setMaterial('');
      setMachineName('');
      setError(null);
      setSuccess(null);
    }
  }, [open]);

  const handleExport = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      try {
        await persist();
      } catch (err) {
        console.error('[report-export] persist header failed:', (err as Error)?.message ?? err);
      }
      const loadTimeSeconds = (() => {
        const lt = machineState?.loadTime;
        if (typeof lt === 'number' && Number.isFinite(lt)) return lt;
        if (typeof lt === 'string' && lt.trim() !== '' && Number.isFinite(Number(lt))) {
          return Number(lt);
        }
        return null;
      })();
      const { filename } = await exportReport({
        type: toReportType(template, format),
        measurements,
        header,
        loadTimeSeconds,
        chdTargetHv: showChd ? chdTargetHv : null,
        targetMinHv,
        targetMaxHv,
        material,
        machineName,
      });
      setSuccess(`Saved as ${filename}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[report-export] failed: ${message}`);
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [
    chdTargetHv,
    format,
    header,
    machineName,
    machineState?.loadTime,
    material,
    measurements,
    persist,
    showChd,
    targetMaxHv,
    targetMinHv,
    template,
  ]);

  const formatLabel = format === 'word' ? 'Word (.docx)' : format === 'excel' ? 'Excel (.xlsx)' : 'CSV (.csv)';

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <Box
        sx={{
          position: 'relative',
          px: 3,
          py: 2,
          background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY_DARK} 100%)`,
          color: '#fff',
          borderLeft: `5px solid ${BLUE}`,
        }}
      >
        <Typography sx={{ fontSize: 17, fontWeight: 600, letterSpacing: 0.4 }}>EXPORT REPORT</Typography>
        <Typography sx={{ fontSize: 12, opacity: 0.78, fontWeight: 500 }}>
          Professional Report Generator
        </Typography>
        <IconButton
          onClick={onClose}
          disabled={busy}
          size="small"
          sx={{ position: 'absolute', right: 10, top: 10, color: '#fff', opacity: 0.8 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr' }}>
          <Box sx={{ p: 2.5, borderRight: 1, borderColor: 'divider' }}>
            <Typography sx={SECTION_LABEL_SX}>Report Information</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
              <TextField label="Sample Name" value={header.sampleName} onChange={(e) => setValues({ sampleName: e.target.value })} disabled={busy || loading} />
              <TextField label="Sample Number" value={header.sampleSerialNumber} onChange={(e) => setValues({ sampleSerialNumber: e.target.value })} disabled={busy || loading} />
              <TextField label="Inspection Company" value={header.inspectionCompany} onChange={(e) => setValues({ inspectionCompany: e.target.value })} disabled={busy || loading} />
              <TextField label="Operator" value={header.tester} onChange={(e) => setValues({ tester: e.target.value })} disabled={busy || loading} />
              <TextField label="Reviewer" value={header.reviewer} onChange={(e) => setValues({ reviewer: e.target.value })} disabled={busy || loading} />
              <TextField label="Machine Name" value={machineName} onChange={(e) => setMachineName(e.target.value)} disabled={busy} placeholder="Not Specified" />
              <TextField label="Material" value={material} onChange={(e) => setMaterial(e.target.value)} disabled={busy} placeholder="Not Specified" sx={{ gridColumn: '1 / -1' }} />
            </Box>

            <Typography sx={{ ...SECTION_LABEL_SX, mt: 2.5 }}>Acceptance Criteria</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
              <TextField
                label="Minimum HV"
                type="number"
                value={header.hardnessMin ?? ''}
                onChange={(e) => {
                  const n = e.target.value === '' ? null : Number(e.target.value);
                  setValues({ hardnessMin: n !== null && Number.isFinite(n) ? n : null });
                }}
                disabled={busy || loading}
              />
              <TextField
                label="Maximum HV"
                type="number"
                value={header.hardnessMax ?? ''}
                onChange={(e) => {
                  const n = e.target.value === '' ? null : Number(e.target.value);
                  setValues({ hardnessMax: n !== null && Number.isFinite(n) ? n : null });
                }}
                disabled={busy || loading}
              />
            </Box>

            <Typography sx={{ ...SECTION_LABEL_SX, mt: 2.5 }}>Report Templates</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
              {TEMPLATES.map((t) => (
                <TemplateCard
                  key={t.key}
                  title={t.title}
                  subtitle={t.subtitle}
                  Icon={t.Icon}
                  active={isWord && template === t.key}
                  disabled={busy || !isWord}
                  onSelect={() => setTemplate(t.key)}
                />
              ))}
            </Box>
            {!isWord ? (
              <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 1 }}>
                Excel and CSV export the data table only — templates apply to Word output.
              </Typography>
            ) : null}
          </Box>

          <Box sx={{ p: 2.5, bgcolor: '#FAFBFD' }}>
            <Typography sx={SECTION_LABEL_SX}>Live Preview</Typography>
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'background.paper' }}>
              <Box sx={{ bgcolor: NAVY, color: '#fff', px: 1.75, py: 1, fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                Output Summary
              </Box>
              <PreviewRow k="Measurements" v={String(measurements.length)} />
              <PreviewRow k="Images" v={String(imageCount)} />
              <PreviewRow k="Graph Included" v={graphIncluded ? 'Yes' : 'No'} highlight={graphIncluded} />
              <PreviewRow k="Output Format" v={formatLabel} last />
            </Box>

            <Typography sx={{ ...SECTION_LABEL_SX, mt: 2.5 }}>Output Format</Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              value={format}
              onChange={(_e, v: FormatKey | null) => v && setFormat(v)}
              disabled={busy}
              sx={{
                '& .MuiToggleButton-root.Mui-selected': { bgcolor: NAVY, color: '#fff', '&:hover': { bgcolor: NAVY_DARK } },
              }}
            >
              <ToggleButton value="word">Word</ToggleButton>
              <ToggleButton value="excel">Excel</ToggleButton>
              <ToggleButton value="csv">CSV</ToggleButton>
            </ToggleButtonGroup>

            {showChd ? (
              <Box sx={{ mt: 2 }}>
                <Typography sx={SECTION_LABEL_SX}>Case Hardness</Typography>
                <TextField
                  label="CHD Reference (HV)"
                  type="number"
                  value={chdTargetInput}
                  onChange={(e) => onChdTargetInputChange(e.target.value)}
                  disabled={busy}
                  slotProps={{ htmlInput: { min: 1, step: 1 } }}
                  helperText="Reference hardness for the CHD red line"
                  fullWidth
                />
              </Box>
            ) : null}

            {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
            {success ? <Alert severity="success" sx={{ mt: 2 }}>{success}</Alert> : null}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={busy} sx={{ textTransform: 'none' }}>
          Cancel
        </Button>
        <Button
          onClick={() => void handleExport()}
          disabled={busy || measurements.length === 0}
          variant="contained"
          sx={{ textTransform: 'none', bgcolor: NAVY, '&:hover': { bgcolor: NAVY_DARK } }}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          Generate Report
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PreviewRow({ k, v, highlight, last }: { k: string; v: string; highlight?: boolean; last?: boolean }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        px: 1.75,
        py: 1.1,
        borderBottom: last ? 0 : 1,
        borderColor: 'divider',
      }}
    >
      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{k}</Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 700, color: highlight ? '#2E7D32' : NAVY, fontVariantNumeric: 'tabular-nums' }}>
        {v}
      </Typography>
    </Box>
  );
}

export default memo(ExportReportDialogImpl);
