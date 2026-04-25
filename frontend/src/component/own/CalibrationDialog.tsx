import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useCalibrations } from '@/hooks/queries/useCalibrations';
import { useCreateCalibration } from '@/hooks/mutations/useCreateCalibration';
import { useDeleteCalibration } from '@/hooks/mutations/useDeleteCalibration';
import { useClearCalibrations } from '@/hooks/mutations/useClearCalibrations';
import { useImportCalibrations } from '@/hooks/mutations/useImportCalibrations';
import { exportCalibrations } from '@/api/exportCalibrations';
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';
import type {
  Calibration,
  CalibrationSavePayload,
  CalibrationType,
  LengthMode,
} from '@/types/calibration';
import { colors } from '@/theme/theme';

const ZOOM_OPTIONS = ['2.5X', '5X', '10X', '20X', '40X', '50X'] as const;
const FORCE_OPTIONS = ['0.05kgf', '0.1kgf', '0.2kgf', '0.3kgf', '0.5kgf', '1kgf'] as const;
const HARDNESS_LEVEL_OPTIONS = ['Low', 'Middle', 'High'] as const;

type FormState = {
  zoomTime: string;
  force: string;
  hardnessLevel: string;
  pixelLengthX: string;
  pixelLengthY: string;
  hardness: string;
  lengthMode: LengthMode;
  realDistanceX: string;
  realDistanceY: string;
};

const DEFAULT_FORM_STATE: FormState = {
  zoomTime: '10X',
  force: '1kgf',
  hardnessLevel: 'Middle',
  pixelLengthX: '0',
  pixelLengthY: '0',
  hardness: '0',
  lengthMode: 'linear',
  realDistanceX: '0',
  realDistanceY: '0',
};

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
};

function nonNeg(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function buildHardnessPayload(form: FormState): CalibrationSavePayload | null {
  const px = nonNeg(form.pixelLengthX);
  const py = nonNeg(form.pixelLengthY);
  const h = nonNeg(form.hardness);
  if (!form.zoomTime || !form.force || !form.hardnessLevel) return null;
  if (px === null || py === null || h === null) return null;
  return {
    zoomTime: form.zoomTime,
    force: form.force,
    hardnessLevel: form.hardnessLevel,
    pixelLengthX: px,
    pixelLengthY: py,
    hardness: h,
    calibrationType: 'hardness',
  };
}

function buildLengthPayload(form: FormState): CalibrationSavePayload | null {
  const px = nonNeg(form.pixelLengthX);
  const py = nonNeg(form.pixelLengthY);
  const rx = nonNeg(form.realDistanceX);
  const ry = nonNeg(form.realDistanceY);
  if (!form.zoomTime || !form.force || !form.hardnessLevel) return null;
  if (px === null || py === null || rx === null || ry === null) return null;
  return {
    zoomTime: form.zoomTime,
    force: form.force,
    hardnessLevel: form.hardnessLevel,
    pixelLengthX: px,
    pixelLengthY: py,
    hardness: 0,
    calibrationType: 'length',
    lengthMode: form.lengthMode,
    realDistanceX: rx,
    realDistanceY: ry,
  };
}

const HEADER_CELL_SX = {
  fontWeight: 600,
  bgcolor: colors.headingPrimary,
  color: '#FFFFFF',
};

const SECTION_TITLE_SX = { color: colors.headingSecondary, fontWeight: 600 };
const MICRON_ADORNMENT = {
  input: { endAdornment: <InputAdornment position="end">µm</InputAdornment> },
  htmlInput: { min: 0, step: 'any' },
};
const NUMBER_SLOT_PROPS = { htmlInput: { min: 0, step: 'any' } } as const;

function CalibrationDialogImpl({ open, onClose, onStatusChange }: Props) {
  const { data: items, error: loadError, loading, refetch } = useCalibrations();
  const { saveCalibration, saving } = useCreateCalibration();
  const { removeCalibration, deleting } = useDeleteCalibration();
  const { clearAll, clearing } = useClearCalibrations();
  const { importItems, importing } = useImportCalibrations();

  const [tab, setTab] = useState<CalibrationType>('hardness');
  const [form, setForm] = useState<FormState>(DEFAULT_FORM_STATE);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const busy = loading || saving || deleting || clearing || importing;
  const errorMessage = loadError ?? validationError ?? actionError;

  useEffect(() => {
    if (open) {
      void refetch();
      setForm(DEFAULT_FORM_STATE);
      setSelectedIds([]);
      setValidationError(null);
      setActionError(null);
      setTab('hardness');
    }
  }, [open, refetch]);

  const handleTabChange = useCallback((_e: unknown, value: CalibrationType) => {
    setTab(value);
    setValidationError(null);
  }, []);

  const handleSelectChange = useCallback(
    (field: keyof FormState) => (event: SelectChangeEvent) => {
      const value = event.target.value;
      setForm((current) => ({ ...current, [field]: value }));
      setValidationError(null);
    },
    []
  );

  const handleInputChange = useCallback(
    (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setForm((current) => ({ ...current, [field]: value }));
      setValidationError(null);
    },
    []
  );

  const handleLengthModeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setForm((current) => ({ ...current, lengthMode: event.target.value as LengthMode }));
    },
    []
  );

  const handleAdd = useCallback(async () => {
    const payload = tab === 'hardness' ? buildHardnessPayload(form) : buildLengthPayload(form);
    if (!payload) {
      setValidationError('Please fill all fields with valid values.');
      return;
    }
    setValidationError(null);
    setActionError(null);
    try {
      await saveCalibration(payload);
      await refetch();
      onStatusChange?.('Calibration added.');
    } catch (e) {
      setActionError(getApiErrorMessage(e, 'Failed to save calibration.'));
    }
  }, [form, onStatusChange, refetch, saveCalibration, tab]);

  const handleManual = useCallback(() => {
    onStatusChange?.('Manual measurement (UI placeholder).');
  }, [onStatusChange]);

  const handleAutoMeasure = useCallback(() => {
    onStatusChange?.('Auto measurement (UI placeholder).');
  }, [onStatusChange]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }, []);

  const handleDelete = useCallback(async () => {
    if (selectedIds.length === 0) {
      setActionError('Select at least one row to delete.');
      return;
    }
    setActionError(null);
    try {
      for (const id of selectedIds) {
        await removeCalibration(id);
      }
      setSelectedIds([]);
      await refetch();
      onStatusChange?.('Calibration(s) deleted.');
    } catch (e) {
      setActionError(getApiErrorMessage(e, 'Failed to delete calibration.'));
    }
  }, [onStatusChange, refetch, removeCalibration, selectedIds]);

  const handleClearRequest = useCallback(() => {
    if (items.length === 0) return;
    setConfirmClear(true);
  }, [items.length]);

  const handleClearConfirm = useCallback(async () => {
    setConfirmClear(false);
    setActionError(null);
    try {
      await clearAll();
      setSelectedIds([]);
      await refetch();
      onStatusChange?.('Calibration list cleared.');
    } catch (e) {
      setActionError(getApiErrorMessage(e, 'Failed to clear calibrations.'));
    }
  }, [clearAll, onStatusChange, refetch]);

  const handleExport = useCallback(async () => {
    setActionError(null);
    try {
      const data = await exportCalibrations();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `calibrations-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      onStatusChange?.('Calibrations exported.');
    } catch (e) {
      setActionError(getApiErrorMessage(e, 'Failed to export calibrations.'));
    }
  }, [onStatusChange]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setActionError(null);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const rawItems: unknown[] = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.items)
            ? parsed.items
            : [];
        const importedItems: CalibrationSavePayload[] = rawItems.map((it) => {
          const r = it as Partial<Calibration>;
          return {
            zoomTime: String(r.zoomTime ?? ''),
            force: String(r.force ?? ''),
            hardnessLevel: String(r.hardnessLevel ?? ''),
            pixelLengthX: Number(r.pixelLengthX ?? 0),
            pixelLengthY: Number(r.pixelLengthY ?? 0),
            hardness: Number(r.hardness ?? 0),
            calibrationType: (r.calibrationType ?? 'hardness') as CalibrationType,
            lengthMode: r.lengthMode,
            realDistanceX:
              typeof r.realDistanceX === 'number' ? r.realDistanceX : undefined,
            realDistanceY:
              typeof r.realDistanceY === 'number' ? r.realDistanceY : undefined,
          };
        });
        await importItems({ items: importedItems });
        await refetch();
        onStatusChange?.(`Imported ${importedItems.length} calibration(s).`);
      } catch (e) {
        setActionError(getApiErrorMessage(e, 'Failed to import calibrations.'));
      }
    },
    [importItems, onStatusChange, refetch]
  );

  const tableRows = useMemo(() => items, [items]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ bgcolor: colors.headingPrimary, color: '#FFFFFF', py: 1.25 }}>
        Calibration
      </DialogTitle>
      <DialogContent dividers>
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 1, maxHeight: 220 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" sx={HEADER_CELL_SX} />
                <TableCell sx={HEADER_CELL_SX}>#</TableCell>
                <TableCell sx={HEADER_CELL_SX}>Zoom Time</TableCell>
                <TableCell sx={HEADER_CELL_SX}>Force</TableCell>
                <TableCell sx={HEADER_CELL_SX}>Hardness Level</TableCell>
                <TableCell sx={HEADER_CELL_SX} align="right">
                  X Pixel Length (µm/px)
                </TableCell>
                <TableCell sx={HEADER_CELL_SX} align="right">
                  Y Pixel Length (µm/px)
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tableRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ color: colors.textMuted }}>
                    {loading ? 'Loading...' : 'No calibrations yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                tableRows.map((it, idx) => (
                  <TableRow key={it.id} hover selected={selectedIds.includes(it.id)}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selectedIds.includes(it.id)}
                        onChange={() => toggleSelected(it.id)}
                      />
                    </TableCell>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell>{it.zoomTime}</TableCell>
                    <TableCell>{it.force}</TableCell>
                    <TableCell>{it.hardnessLevel}</TableCell>
                    <TableCell align="right">{it.pixelLengthX}</TableCell>
                    <TableCell align="right">{it.pixelLengthY}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Button variant="outlined" onClick={handleImportClick} disabled={busy}>
            Import
          </Button>
          <Button variant="outlined" onClick={() => void handleExport()} disabled={busy}>
            Export
          </Button>
          <Button
            variant="outlined"
            color="error"
            onClick={() => void handleDelete()}
            disabled={busy || selectedIds.length === 0}
          >
            Delete
          </Button>
          <Button
            variant="outlined"
            color="warning"
            onClick={handleClearRequest}
            disabled={busy || items.length === 0}
          >
            Clear
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => void handleImportFile(e)}
          />
        </Stack>

        <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
          Add Calibration
        </Typography>

        <Tabs value={tab} onChange={handleTabChange} sx={{ mt: 0.5, mb: 1 }}>
          <Tab value="hardness" label="Hardness Calibration" />
          <Tab value="length" label="Length Calibration" />
        </Tabs>

        {tab === 'length' ? (
          <RadioGroup
            row
            value={form.lengthMode}
            onChange={handleLengthModeChange}
            sx={{ mb: 1 }}
          >
            <FormControlLabel value="linear" control={<Radio size="small" />} label="Linear" />
            <FormControlLabel value="plane" control={<Radio size="small" />} label="Plane" />
          </RadioGroup>
        ) : null}

        <Grid container spacing={1.5}>
          <Grid size={{ xs: 4 }}>
            <Typography variant="caption">Zoom Time</Typography>
            <FormControl fullWidth size="small">
              <Select
                value={form.zoomTime}
                onChange={handleSelectChange('zoomTime')}
                disabled={busy}
              >
                {ZOOM_OPTIONS.map((o) => (
                  <MenuItem key={o} value={o}>
                    {o}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 4 }}>
            <Typography variant="caption">Force</Typography>
            <FormControl fullWidth size="small">
              <Select value={form.force} onChange={handleSelectChange('force')} disabled={busy}>
                {FORCE_OPTIONS.map((o) => (
                  <MenuItem key={o} value={o}>
                    {o}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 4 }}>
            <Typography variant="caption">Hardness Level</Typography>
            <FormControl fullWidth size="small">
              <Select
                value={form.hardnessLevel}
                onChange={handleSelectChange('hardnessLevel')}
                disabled={busy}
              >
                {HARDNESS_LEVEL_OPTIONS.map((o) => (
                  <MenuItem key={o} value={o}>
                    {o}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 4 }}>
            <Typography variant="caption">Pixel Length X</Typography>
            <TextField
              fullWidth
              size="small"
              type="number"
              value={form.pixelLengthX}
              onChange={handleInputChange('pixelLengthX')}
              disabled={busy}
              slotProps={NUMBER_SLOT_PROPS}
            />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <Typography variant="caption">Pixel Length Y</Typography>
            <TextField
              fullWidth
              size="small"
              type="number"
              value={form.pixelLengthY}
              onChange={handleInputChange('pixelLengthY')}
              disabled={busy}
              slotProps={NUMBER_SLOT_PROPS}
            />
          </Grid>

          {tab === 'hardness' ? (
            <Grid size={{ xs: 4 }}>
              <Typography variant="caption">Hardness</Typography>
              <TextField
                fullWidth
                size="small"
                type="number"
                value={form.hardness}
                onChange={handleInputChange('hardness')}
                disabled={busy}
                slotProps={NUMBER_SLOT_PROPS}
              />
            </Grid>
          ) : (
            <Grid size={{ xs: 4 }} />
          )}

          {tab === 'length' ? (
            <>
              <Grid size={{ xs: 4 }}>
                <Typography variant="caption">Real Distance X</Typography>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  value={form.realDistanceX}
                  onChange={handleInputChange('realDistanceX')}
                  disabled={busy}
                  slotProps={MICRON_ADORNMENT}
                />
              </Grid>
              <Grid size={{ xs: 4 }}>
                <Typography variant="caption">Real Distance Y</Typography>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  value={form.realDistanceY}
                  onChange={handleInputChange('realDistanceY')}
                  disabled={busy}
                  slotProps={MICRON_ADORNMENT}
                />
              </Grid>
            </>
          ) : null}
        </Grid>

        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          {tab === 'hardness' ? (
            <>
              <Button variant="outlined" onClick={handleManual} disabled={busy}>
                Manual
              </Button>
              <Button variant="outlined" onClick={handleAutoMeasure} disabled={busy}>
                Auto Measure
              </Button>
            </>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" onClick={() => void handleAdd()} disabled={busy}>
            Add Calibration
          </Button>
        </Stack>

        {errorMessage ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
      </DialogActions>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)}>
        <DialogTitle>Clear all calibrations?</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            This will permanently remove all {items.length} calibration record(s) from the
            database. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void handleClearConfirm()}>
            Clear All
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

export default memo(CalibrationDialogImpl);
