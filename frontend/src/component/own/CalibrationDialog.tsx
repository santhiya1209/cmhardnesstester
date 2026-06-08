import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
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
import { getApiErrorMessage } from '@/utils/getApiErrorMessage';
import type {
  Calibration,
  CalibrationSavePayload,
  CalibrationType,
  LengthMode,
} from '@/types/calibration';
import { tokens } from '@/theme/theme';

const HARDNESS_LEVEL_OPTIONS = ['Low', 'Middle', 'High'] as const;

// Shown when Machine Control reports no value yet (e.g. before the machine
// connects). The displayed objective and force always mirror Machine Control —
// there is no separate calibration objective/force state.
const DEFAULT_OBJECTIVE = '10X';
const DEFAULT_FORCE = '1kgf';

type FormState = {
  hardnessLevel: string;
  pixelLengthX: string;
  pixelLengthY: string;
  hardness: string;
  lengthMode: LengthMode;
};

const DEFAULT_FORM_STATE: FormState = {
  hardnessLevel: 'Middle',
  pixelLengthX: '0',
  pixelLengthY: '0',
  hardness: '0',
  lengthMode: 'linear',
};

function diagonalUmFromHv(forceKgf: number, hv: number): number | null {
  if (!Number.isFinite(forceKgf) || forceKgf <= 0) return null;
  if (!Number.isFinite(hv) || hv <= 0) return null;
  const dMm = Math.sqrt((1.8544 * forceKgf) / hv);
  if (!Number.isFinite(dMm) || dMm <= 0) return null;
  return dMm * 1000;
}

function parseForceKgfFromLabel(value: string): number | null {
  const match = String(value ?? '').match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
  onChanged?: () => void;
  /**
   * Latest measured pixel diagonals from the live image (Manual Measure).
   * When the dialog opens, these auto-fill Pixel Length X / Y so the user
   * doesn't have to retype what they just measured. Editable after the
   * auto-fill â€” typing into the fields wins. Pass null/0 to skip auto-fill.
   */
  autoFillPixelLengthX?: number | null;
  autoFillPixelLengthY?: number | null;
  /**
   * Active objective from App's committed objective state. Used to default the
   * Zoom Time selector so the saved row lands under the right objective
   * without the user having to re-pick it.
   */
  defaultObjective?: string | null;
  /**
   * Active force from Machine Control. The Calibration force field mirrors it
   * live (read-only) — there is no separate calibration force state.
   */
  defaultForce?: string | null;
  /**
   * Run native Auto Measure detection on the current live frame using the
   * dialog's selected objective. Returns detected pixel diagonals so the
   * dialog can fill Pixel Length X / Y. NO measurement row is created
   * (calibration mode is pixels-only). Returns null when detection fails
   * or no frame is available.
   */
  onRequestAutoMeasure?: (objective: string) => Promise<{ d1Px: number; d2Px: number } | null>;
  /**
   * Switch the app into Manual Measure mode for calibration. The dialog is
   * closed by the parent so the user can drag the cross on the live image;
   * each drag emits [calibration-drag-update]. When the user re-opens this
   * dialog, the `autoFillPixelLength*` props provide the captured values.
   */
  onRequestManualMeasure?: () => void;
  /**
   * Fired immediately after a successful Add Calibration. Receives the saved
   * calibration and the payload that produced it. The parent uses this to
   * commit a measurement row from the CURRENT D1/D2 line pixels
   * (payload.pixelLengthX/Y) so the table is populated automatically.
   */
  onAutoCreateMeasurementRow?: (args: {
    savedCalibration: Calibration;
    payload: CalibrationSavePayload;
  }) => Promise<void> | void;
};

function nonNeg(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function buildHardnessPayload(
  form: FormState,
  objective: string,
  force: string
): CalibrationSavePayload | null {
  const px = nonNeg(form.pixelLengthX);
  const py = nonNeg(form.pixelLengthY);
  const h = nonNeg(form.hardness);
  const forceKgf = parseForceKgfFromLabel(force);
  if (!objective || !force || !form.hardnessLevel) return null;
  if (px === null || py === null || h === null || forceKgf === null) return null;
  const diagonalUm = diagonalUmFromHv(forceKgf, h);
  if (diagonalUm === null) return null;
  return {
    zoomTime: objective,
    force,
    hardnessLevel: form.hardnessLevel,
    pixelLengthX: px,
    pixelLengthY: py,
    hardness: h,
    calibrationType: 'hardness',
    realDistanceX: diagonalUm,
    realDistanceY: diagonalUm,
  };
}

function buildLengthPayload(
  form: FormState,
  objective: string,
  force: string
): CalibrationSavePayload | null {
  const px = nonNeg(form.pixelLengthX);
  const py = nonNeg(form.pixelLengthY);
  const h = nonNeg(form.hardness);
  const forceKgf = parseForceKgfFromLabel(force);
  if (!objective || !force || !form.hardnessLevel) return null;
  if (px === null || py === null || h === null || forceKgf === null) return null;
  const diagonalUm = diagonalUmFromHv(forceKgf, h);
  if (diagonalUm === null) return null;
  return {
    zoomTime: objective,
    force,
    hardnessLevel: form.hardnessLevel,
    pixelLengthX: px,
    pixelLengthY: py,
    hardness: h,
    calibrationType: 'length',
    lengthMode: form.lengthMode,
    realDistanceX: diagonalUm,
    realDistanceY: diagonalUm,
  };
}

const HEADER_CELL_SX = {
  fontWeight: 600,
  bgcolor: tokens.accent.base,
  color: '#FFFFFF',
};

const SECTION_TITLE_SX = { color: tokens.status.success, fontWeight: 600 };
const NUMBER_SLOT_PROPS = { htmlInput: { min: 0, step: 'any' } } as const;

function CalibrationDialogImpl({
  open,
  onClose,
  onStatusChange,
  onChanged,
  autoFillPixelLengthX,
  autoFillPixelLengthY,
  defaultObjective,
  defaultForce,
  onRequestAutoMeasure,
  onRequestManualMeasure,
  onAutoCreateMeasurementRow,
}: Props) {
  const { data: items, error: loadError, loading, refetch } = useCalibrations();
  const { saveCalibration, saving } = useCreateCalibration();
  const { removeCalibration, deleting } = useDeleteCalibration();

  const [tab, setTab] = useState<CalibrationType>('hardness');
  const [form, setForm] = useState<FormState>(DEFAULT_FORM_STATE);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectionStatus, setSelectionStatus] = useState<
    { mode: 'update' | 'insert'; message: string } | null
  >(null);
  const panelLoggedOpenRef = useRef(false);
  const lastLivePixelLogRef = useRef<string | null>(null);
  const lastSelectionKeyRef = useRef<string | null>(null);

  // Objective is the live Machine Control objective (defaultObjective). It is
  // NOT held in form state, so it updates immediately when Machine Control
  // changes — there is no separate calibration objective to keep in sync.
  const objective = useMemo(() => {
    const normalized =
      typeof defaultObjective === 'string' ? defaultObjective.trim().toUpperCase() : '';
    return normalized || DEFAULT_OBJECTIVE;
  }, [defaultObjective]);

  // Force mirrors the live Machine Control force (defaultForce) the same way —
  // not held in form state, updates immediately when Machine Control changes.
  const force = useMemo(() => {
    const normalized = typeof defaultForce === 'string' ? defaultForce.trim() : '';
    return normalized || DEFAULT_FORCE;
  }, [defaultForce]);

  const busy = loading || saving || deleting;
  const errorMessage = loadError ?? validationError ?? actionError;

  useEffect(() => {
    if (!open) return;
    void refetch();
    const pxX =
      typeof autoFillPixelLengthX === 'number' &&
      Number.isFinite(autoFillPixelLengthX) &&
      autoFillPixelLengthX > 0
        ? String(Number(autoFillPixelLengthX.toFixed(2)))
        : DEFAULT_FORM_STATE.pixelLengthX;
    const pxY =
      typeof autoFillPixelLengthY === 'number' &&
      Number.isFinite(autoFillPixelLengthY) &&
      autoFillPixelLengthY > 0
        ? String(Number(autoFillPixelLengthY.toFixed(2)))
        : DEFAULT_FORM_STATE.pixelLengthY;
    setForm({
      ...DEFAULT_FORM_STATE,
      pixelLengthX: pxX,
      pixelLengthY: pxY,
    });
    setSelectedIds([]);
    setValidationError(null);
    setActionError(null);
    const hasMeasuredPixels =
      pxX !== DEFAULT_FORM_STATE.pixelLengthX || pxY !== DEFAULT_FORM_STATE.pixelLengthY;
    setTab(hasMeasuredPixels ? 'length' : 'hardness');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (
      typeof autoFillPixelLengthX !== 'number' ||
      typeof autoFillPixelLengthY !== 'number' ||
      !Number.isFinite(autoFillPixelLengthX) ||
      !Number.isFinite(autoFillPixelLengthY) ||
      autoFillPixelLengthX <= 0 ||
      autoFillPixelLengthY <= 0
    ) {
      return;
    }
    const pxX = String(Number(autoFillPixelLengthX.toFixed(2)));
    const pxY = String(Number(autoFillPixelLengthY.toFixed(2)));
    const logKey = `${pxX}|${pxY}`;
    setForm((current) =>
      current.pixelLengthX === pxX && current.pixelLengthY === pxY
        ? current
        : { ...current, pixelLengthX: pxX, pixelLengthY: pxY }
    );
    if (lastLivePixelLogRef.current !== logKey) {
      lastLivePixelLogRef.current = logKey;
    }
  }, [open, autoFillPixelLengthX, autoFillPixelLengthY]);

  useEffect(() => {
    if (!open) {
      lastSelectionKeyRef.current = null;
      return;
    }
    if (loading) return;

    const hardnessLevel = form.hardnessLevel;
    const selectionKey = `${objective}|${force}|${hardnessLevel}`;
    const keyChanged = lastSelectionKeyRef.current !== selectionKey;

    const anyForObjectiveForce = items.find(
      (it) => it.zoomTime === objective && it.force === force
    );
    const exactForHardnessLevel = items.find(
      (it) =>
        it.zoomTime === objective &&
        it.force === force &&
        it.hardnessLevel === hardnessLevel
    );

    if (anyForObjectiveForce) {
      const message = `${objective} / ${force} is already calibrated. Updating Middle, Low, and High values will overwrite the existing calibration.`;
      setSelectionStatus({ mode: 'update', message });

      if (keyChanged) {
        lastSelectionKeyRef.current = selectionKey;
        if (exactForHardnessLevel) {
          setForm((current) => ({
            ...current,
            pixelLengthX: String(exactForHardnessLevel.pixelLengthX),
            pixelLengthY: String(exactForHardnessLevel.pixelLengthY),
            hardness: String(exactForHardnessLevel.hardness),
          }));
        } else {
          setForm((current) => ({
            ...current,
            pixelLengthX: DEFAULT_FORM_STATE.pixelLengthX,
            pixelLengthY: DEFAULT_FORM_STATE.pixelLengthY,
            hardness: DEFAULT_FORM_STATE.hardness,
          }));
        }
      }
    } else {
      const message = `${objective} / ${force} is not calibrated yet. Please enter Middle, Low, and High values to calibrate.`;
      setSelectionStatus({ mode: 'insert', message });

      if (keyChanged) {
        lastSelectionKeyRef.current = selectionKey;
        setForm((current) => ({
          ...current,
          pixelLengthX: DEFAULT_FORM_STATE.pixelLengthX,
          pixelLengthY: DEFAULT_FORM_STATE.pixelLengthY,
          hardness: DEFAULT_FORM_STATE.hardness,
        }));
      }
    }
  }, [open, loading, items, objective, force, form.hardnessLevel]);

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
    const pixelX = Number(form.pixelLengthX);
    const pixelY = Number(form.pixelLengthY);
    if (
      !Number.isFinite(pixelX) ||
      !Number.isFinite(pixelY) ||
      pixelX <= 0 ||
      pixelY <= 0
    ) {
      setValidationError(
        'Pixel X and Pixel Y must be greater than 0. Please run Auto Measure first.'
      );
      return;
    }
    const hardnessRaw = form.hardness.trim();
    const hardnessValue = Number(hardnessRaw);
    if (hardnessRaw === '' || !Number.isFinite(hardnessValue) || hardnessValue <= 0) {
      setValidationError('Please enter hardness value before calibration.');
      return;
    }
    const payload =
      tab === 'hardness'
        ? buildHardnessPayload(form, objective, force)
        : buildLengthPayload(form, objective, force);
    if (!payload) {
      setValidationError('Please fill all fields with valid values.');
      return;
    }
    setValidationError(null);
    setActionError(null);
    try {
      const savedCalibration = await saveCalibration(payload);
      const umPerPixel =
        payload.pixelLengthX > 0 && (payload.realDistanceX ?? 0) > 0
          ? (payload.realDistanceX as number) / payload.pixelLengthX
          : 0;
      // eslint-disable-next-line no-console
      console.log(
        `[calibration-save] objective=${payload.zoomTime} force=${payload.force} hardnessLevel=${payload.hardnessLevel} umPerPixel=${umPerPixel.toFixed(4)}`
      );
      await refetch();
      onChanged?.();
      onStatusChange?.('Calibration saved.');

      const currentD1Px = payload.pixelLengthX;
      const currentD2Px = payload.pixelLengthY;
      if (
        !Number.isFinite(currentD1Px) ||
        !Number.isFinite(currentD2Px) ||
        currentD1Px <= 0 ||
        currentD2Px <= 0
      ) {
        setActionError(
          'Calibration saved, but D1/D2 line pixels are zero â€” no measurement row was created. Run Manual or Auto Measure first, then Add Calibration.'
        );
      } else if (onAutoCreateMeasurementRow) {
        try {
          await onAutoCreateMeasurementRow({ savedCalibration, payload });
        } catch (rowErr) {
          console.error(
            `[calibration] auto-row failed: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`
          );
          setActionError(
            `Calibration saved, but creating the measurement row failed: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`
          );
        }
      }
    } catch (e) {
      console.error(`[calibration] save failed: ${getApiErrorMessage(e, 'Failed to save calibration.')}`);
      setActionError(getApiErrorMessage(e, 'Failed to save calibration.'));
    }
  }, [form, objective, force, onAutoCreateMeasurementRow, onChanged, onStatusChange, refetch, saveCalibration, tab]);

  const handleManual = useCallback(() => {
    if (!onRequestManualMeasure) {
      onStatusChange?.('Manual measurement not wired.');
      return;
    }
    onRequestManualMeasure();
  }, [onRequestManualMeasure, onStatusChange]);

  const handleAutoMeasure = useCallback(async () => {
    if (!onRequestAutoMeasure) {
      onStatusChange?.('Auto measurement not wired.');
      return;
    }
    setActionError(null);
    try {
      const detected = await onRequestAutoMeasure(objective);
      if (!detected) {
        setActionError('Auto Measure could not detect a diamond. Try Manual Measure instead.');
        return;
      }
      const pxX = String(Number(detected.d1Px.toFixed(2)));
      const pxY = String(Number(detected.d2Px.toFixed(2)));
      setForm((current) => ({
        ...current,
        pixelLengthX: pxX,
        pixelLengthY: pxY,
      }));
      lastLivePixelLogRef.current = `${pxX}|${pxY}`;
      onStatusChange?.(`Auto Measure filled Pixel X=${pxX}, Pixel Y=${pxY}.`);
    } catch (e) {
      console.error(`[calibration] auto-measure failed: ${getApiErrorMessage(e, 'Auto Measure failed.')}`);
      setActionError(getApiErrorMessage(e, 'Auto Measure failed.'));
    }
  }, [objective, onRequestAutoMeasure, onStatusChange]);

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
      onChanged?.();
      onStatusChange?.('Calibration(s) deleted.');
    } catch (e) {
      setActionError(getApiErrorMessage(e, 'Failed to delete calibration.'));
    }
  }, [onChanged, onStatusChange, refetch, removeCalibration, selectedIds]);

  const tableRows = useMemo(() => items, [items]);

  useEffect(() => {
    if (open) {
      if (panelLoggedOpenRef.current) return;
      panelLoggedOpenRef.current = true;
      return;
    }
    if (!panelLoggedOpenRef.current) return;
    panelLoggedOpenRef.current = false;
    lastLivePixelLogRef.current = null;
  }, [open]);

  if (!open) return null;

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          bgcolor: tokens.accent.base,
          color: '#FFFFFF',
          px: 2,
          py: 1.25,
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: 0.3,
        }}
      >
        <Box sx={{ flex: 1 }}>Calibration</Box>
        <IconButton
          size="small"
          onClick={busy ? undefined : onClose}
          disabled={busy}
          sx={{ color: '#FFFFFF' }}
          aria-label="Close calibration"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 1, maxHeight: 220 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" sx={HEADER_CELL_SX} />
                <TableCell sx={HEADER_CELL_SX}>#</TableCell>
                <TableCell sx={HEADER_CELL_SX}>Zoom Time / Objective</TableCell>
                <TableCell sx={HEADER_CELL_SX}>Force</TableCell>
                <TableCell sx={HEADER_CELL_SX}>Hardness Level</TableCell>
                <TableCell sx={HEADER_CELL_SX} align="right">
                  X Pixel Length (Âµm/px)
                </TableCell>
                <TableCell sx={HEADER_CELL_SX} align="right">
                  Y Pixel Length (Âµm/px)
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tableRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ color: tokens.text.muted }}>
                    {loading ? 'Loading...' : 'No calibrations yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                tableRows.map((it, idx) => {
                  const knownReferenceUm =
                    typeof it.realDistanceX === 'number' && it.realDistanceX > 0
                      ? it.realDistanceX
                      : typeof it.realDistanceY === 'number' && it.realDistanceY > 0
                        ? it.realDistanceY
                        : 0;
                  const xUmPerPixel =
                    it.pixelLengthX > 0 && knownReferenceUm > 0
                      ? knownReferenceUm / it.pixelLengthX
                      : 0;
                  const yUmPerPixel =
                    it.pixelLengthY > 0 && knownReferenceUm > 0
                      ? knownReferenceUm / it.pixelLengthY
                      : 0;
                  return (
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
                      <TableCell align="right">{xUmPerPixel.toFixed(5)}</TableCell>
                      <TableCell align="right">{yUmPerPixel.toFixed(5)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Button
            variant="outlined"
            color="error"
            onClick={() => void handleDelete()}
            disabled={busy || selectedIds.length === 0}
          >
            Delete
          </Button>
        </Stack>

        <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
          Add Calibration
        </Typography>

        {selectionStatus ? (
          <Alert
            severity={selectionStatus.mode === 'update' ? 'warning' : 'info'}
            sx={{ mt: 1 }}
          >
            {selectionStatus.message}
          </Alert>
        ) : null}

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
            <Typography variant="caption">Zoom Time / Objective</Typography>
            <TextField
              fullWidth
              size="small"
              value={objective}
              slotProps={{ input: { readOnly: true } }}
            />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <Typography variant="caption">Force</Typography>
            <TextField
              fullWidth
              size="small"
              value={force}
              slotProps={{ input: { readOnly: true } }}
            />
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
            <Typography variant="caption">Pixel X</Typography>
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
            <Typography variant="caption">Pixel Y</Typography>
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

          <Grid size={{ xs: 4 }}>
            <Typography variant="caption">Hardness Value</Typography>
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
        </Grid>

        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="outlined" onClick={handleManual} disabled={busy}>
            Manual Measure
          </Button>
          <Button variant="outlined" onClick={() => void handleAutoMeasure()} disabled={busy}>
            Auto Measure
          </Button>
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
      </Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          px: 2,
          py: 1,
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
      </Box>
    </Box>
  );
}

export default memo(CalibrationDialogImpl);
