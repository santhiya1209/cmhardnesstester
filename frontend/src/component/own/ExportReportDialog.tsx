import { memo, useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
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

function ExportReportDialogImpl({ open, onClose, measurements, cameraImageDataUrl }: Props) {
  const [selected, setSelected] = useState<ReportType>('word-data');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected('word-data');
      setError(null);
      // eslint-disable-next-line no-console
      console.log('[report] dialog opened');
    }
  }, [open]);

  const handleSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value as ReportType;
    setSelected(next);
    // eslint-disable-next-line no-console
    console.log('[report] selected type=', next);
  }, []);

  const handleExport = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { filename } = await exportReport(selected, measurements, cameraImageDataUrl);
      // eslint-disable-next-line no-console
      console.log('[report] export success path=', filename);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[report] export failed error=', message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [cameraImageDataUrl, measurements, onClose, selected]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 14, fontWeight: 600 }}>Export Report</DialogTitle>
      <DialogContent dividers>
        <FormControl>
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
        {error ? (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy} size="small" sx={{ textTransform: 'none' }}>
          Cancel
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
