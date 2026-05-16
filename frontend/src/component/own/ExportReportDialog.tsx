import { memo, useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useReportHeaderSetting } from '@/hooks/queries/useReportHeaderSetting';
import { useMachineState } from '@/hooks/queries/useMachineState';
import type { Measurement } from '@/types/measurement';
import { exportReport, type ReportType } from '@/utils/exportReport';

const REPORT_OPTIONS: { value: ReportType; label: string }[] = [
  { value: 'csv', label: 'CSV Report' },
  { value: 'xlsx', label: 'Excel Report' },
  { value: 'word-data', label: 'Word With Data Only' },
  { value: 'word-image', label: 'Word With Image' },
  { value: 'word-depth', label: 'Word With Deep Hardness' },
  { value: 'word-image-depth', label: 'Word With Image And Deep Hardness' },
];

type Props = {
  open: boolean;
  onClose: () => void;
  measurements: Measurement[];
  cameraImageDataUrl?: string | null;
};

function ExportReportDialogImpl({ open, onClose, measurements }: Props) {
  const [selected, setSelected] = useState<ReportType>('word-data');
  const [chdTargetInput, setChdTargetInput] = useState('550');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { values: header, setValues, persist, loading } = useReportHeaderSetting(open);
  const { data: machineState } = useMachineState();
  const showChdInput = selected === 'word-depth' || selected === 'word-image-depth';
  const chdTargetHv = (() => {
    const parsed = Number(chdTargetInput.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  })();

  useEffect(() => {
    if (open) {
      setSelected('word-data');
      setError(null);
      setSuccess(null);
      // eslint-disable-next-line no-console
      console.log('[report-export] dialog opened');
    }
  }, [open]);

  const handleSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value as ReportType;
    setSelected(next);
    // eslint-disable-next-line no-console
    console.log('[report-export] selected type=', next);
  }, []);

  const handleExport = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      // Persist header values so next export prefills them.
      try {
        await persist();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[report-export] persist header failed (continuing)', err);
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
        type: selected,
        measurements,
        header,
        loadTimeSeconds,
        chdTargetHv: showChdInput ? chdTargetHv : null,
      });
      // eslint-disable-next-line no-console
      console.log('[report-export] success path=', filename);
      setSuccess(`Saved as ${filename}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[report-error] export failed reason=', message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [
    chdTargetHv,
    header,
    machineState?.loadTime,
    measurements,
    persist,
    selected,
    showChdInput,
  ]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 14, fontWeight: 600 }}>Export Report</DialogTitle>
      <DialogContent dividers>
        <Typography variant="caption" color="text.secondary">
          Report header
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 1,
            mt: 0.5,
            mb: 1.5,
          }}
        >
          <TextField
            label="Sample Name"
            size="small"
            value={header.sampleName}
            onChange={(e) => setValues({ sampleName: e.target.value })}
            disabled={busy || loading}
          />
          <TextField
            label="Sample Sn"
            size="small"
            value={header.sampleSerialNumber}
            onChange={(e) => setValues({ sampleSerialNumber: e.target.value })}
            disabled={busy || loading}
          />
          <TextField
            label="Inspection Company"
            size="small"
            value={header.inspectionCompany}
            onChange={(e) => setValues({ inspectionCompany: e.target.value })}
            disabled={busy || loading}
          />
          <TextField
            label="Tester"
            size="small"
            value={header.tester}
            onChange={(e) => setValues({ tester: e.target.value })}
            disabled={busy || loading}
          />
          <TextField
            label="Reviewer"
            size="small"
            value={header.reviewer}
            onChange={(e) => setValues({ reviewer: e.target.value })}
            disabled={busy || loading}
          />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              label="Min HV"
              size="small"
              type="number"
              fullWidth
              value={header.hardnessMin ?? ''}
              onChange={(e) => {
                const n = e.target.value === '' ? null : Number(e.target.value);
                setValues({ hardnessMin: n !== null && Number.isFinite(n) ? n : null });
              }}
              disabled={busy || loading}
            />
            <TextField
              label="Max HV"
              size="small"
              type="number"
              fullWidth
              value={header.hardnessMax ?? ''}
              onChange={(e) => {
                const n = e.target.value === '' ? null : Number(e.target.value);
                setValues({ hardnessMax: n !== null && Number.isFinite(n) ? n : null });
              }}
              disabled={busy || loading}
            />
          </Box>
        </Box>

        <Divider sx={{ mb: 1.5 }} />

        <Typography variant="caption" color="text.secondary">
          Report type
        </Typography>
        <FormControl sx={{ mt: 0.5, display: 'block' }}>
          <RadioGroup value={selected} onChange={handleSelect}>
            {REPORT_OPTIONS.map((opt) => (
              <FormControlLabel
                key={opt.value}
                value={opt.value}
                control={<Radio size="small" />}
                label={opt.label}
                disabled={busy}
                sx={{ '& .MuiFormControlLabel-label': { fontSize: 13 } }}
              />
            ))}
          </RadioGroup>
        </FormControl>
        {showChdInput ? (
          <Box sx={{ mt: 1.5 }}>
            <TextField
              label="CHD HV"
              size="small"
              type="number"
              value={chdTargetInput}
              onChange={(e) => setChdTargetInput(e.target.value)}
              disabled={busy}
              inputProps={{ min: 1, step: 1 }}
              helperText="Reference hardness for the Case Hardness Profile red line"
              sx={{ width: 200 }}
            />
          </Box>
        ) : null}
        {error ? (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        ) : null}
        {success ? (
          <Alert severity="success" sx={{ mt: 1.5 }}>
            {success}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy} size="small" sx={{ textTransform: 'none' }}>
          Close
        </Button>
        <Button
          onClick={() => {
            void handleExport();
          }}
          disabled={busy || measurements.length === 0}
          size="small"
          variant="contained"
          sx={{ textTransform: 'none' }}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          Export
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(ExportReportDialogImpl);
