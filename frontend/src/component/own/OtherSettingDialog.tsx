import { memo, useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useOtherSetting } from '@/hooks/queries/useOtherSetting';
import { useSaveOtherSetting } from '@/hooks/mutations/useSaveOtherSetting';
import {
  ACCURACY_OPTIONS,
  DEFAULT_OTHER_SETTING,
  HARDNESS_CONVERT_TABLE_OPTIONS,
  LANGUAGE_OPTIONS,
  type HardnessConvertTable,
  type Language,
  type OtherSetting,
  type OtherSettingPayload,
} from '@/types/otherSetting';
import { colors } from '@/theme/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
};

type FormState = {
  language: Language;
  hardnessValueAccuracy: number;
  conversionValueAccuracy: number;
  hardnessConvertTable: HardnessConvertTable;
  trimFast: string;
  trimSlow: string;
};

function toFormState(settings: OtherSetting | null): FormState {
  const src = settings ?? DEFAULT_OTHER_SETTING;
  return {
    language: src.language,
    hardnessValueAccuracy: src.hardnessValueAccuracy,
    conversionValueAccuracy: src.conversionValueAccuracy,
    hardnessConvertTable: src.hardnessConvertTable,
    trimFast: String(src.trimFast),
    trimSlow: String(src.trimSlow),
  };
}

function parseInteger(value: string): number | null {
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

const TITLE_SX = { bgcolor: colors.headingPrimary, color: '#FFFFFF', py: 1.25 };
const SECTION_PAPER_SX = { p: 2, mb: 1.5 };
const SECTION_TITLE_SX = { color: colors.headingSecondary, fontWeight: 600, mb: 1 };
const ROW_LABEL_SX = { minWidth: 170 };
const SHORT_LABEL_SX = { minWidth: 90 };

function OtherSettingDialogImpl({ open, onClose, onStatusChange }: Props) {
  const { data, error: loadError, loading, refetch } = useOtherSetting();
  const { saveOtherSetting, saving, error: saveError } = useSaveOtherSetting();
  const [form, setForm] = useState<FormState>(() => toFormState(null));
  const [validationError, setValidationError] = useState<string | null>(null);

  const busy = loading || saving;
  const errorMessage = loadError ?? saveError ?? validationError;

  useEffect(() => {
    if (open) {
      void refetch();
    }
  }, [open, refetch]);

  useEffect(() => {
    if (open && !loading) {
      setForm(toFormState(data));
      setValidationError(null);
    }
  }, [data, loading, open]);

  const handleLanguageChange = useCallback((event: SelectChangeEvent) => {
    setForm((current) => ({ ...current, language: event.target.value as Language }));
  }, []);

  const handleAccuracyChange = useCallback(
    (field: 'hardnessValueAccuracy' | 'conversionValueAccuracy') =>
      (event: SelectChangeEvent<number>) => {
        const value = Number(event.target.value);
        setForm((current) => ({ ...current, [field]: value }));
      },
    []
  );

  const handleConvertTableChange = useCallback((event: SelectChangeEvent) => {
    setForm((current) => ({
      ...current,
      hardnessConvertTable: event.target.value as HardnessConvertTable,
    }));
  }, []);

  const handleTrimChange = useCallback(
    (field: 'trimFast' | 'trimSlow') => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setValidationError(null);
      setForm((current) => ({ ...current, [field]: value }));
    },
    []
  );

  const handleViewHistory = useCallback(() => {
    onStatusChange?.('History images view (UI placeholder).');
  }, [onStatusChange]);

  const handleConfirm = useCallback(async () => {
    const trimFast = parseInteger(form.trimFast);
    const trimSlow = parseInteger(form.trimSlow);
    if (trimFast === null || trimSlow === null) {
      setValidationError('Trim Step values must be non-negative integers.');
      return;
    }

    const payload: OtherSettingPayload = {
      language: form.language,
      hardnessValueAccuracy: form.hardnessValueAccuracy,
      conversionValueAccuracy: form.conversionValueAccuracy,
      hardnessConvertTable: form.hardnessConvertTable,
      trimFast,
      trimSlow,
      historyImageCount: data?.historyImageCount ?? DEFAULT_OTHER_SETTING.historyImageCount,
      historyImageSizeMb:
        data?.historyImageSizeMb ?? DEFAULT_OTHER_SETTING.historyImageSizeMb,
    };

    try {
      await saveOtherSetting({ id: data?.id, values: payload });
      onStatusChange?.('Other setting saved.');
      onClose();
    } catch {
      // surfaced via saveError
    }
  }, [data, form, onClose, onStatusChange, saveOtherSetting]);

  const historyCount = data?.historyImageCount ?? DEFAULT_OTHER_SETTING.historyImageCount;
  const historySize = data?.historyImageSizeMb ?? DEFAULT_OTHER_SETTING.historyImageSizeMb;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={TITLE_SX}>Other Setting</DialogTitle>
      <DialogContent dividers>
        <Paper variant="outlined" sx={SECTION_PAPER_SX}>
          <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
            Language Setting
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={SHORT_LABEL_SX}>
              Language
            </Typography>
            <FormControl size="small" sx={{ flex: 1 }}>
              <Select value={form.language} onChange={handleLanguageChange} disabled={busy}>
                {LANGUAGE_OPTIONS.map((opt) => (
                  <MenuItem key={opt} value={opt}>
                    {opt}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={SECTION_PAPER_SX}>
          <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
            Accuracy
          </Typography>
          <Grid container spacing={1.5} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 6 }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={ROW_LABEL_SX}>
                  HardnessValueAccuracy
                </Typography>
                <FormControl size="small" sx={{ flex: 1 }}>
                  <Select
                    value={form.hardnessValueAccuracy}
                    onChange={handleAccuracyChange('hardnessValueAccuracy')}
                    disabled={busy}
                  >
                    {ACCURACY_OPTIONS.map((opt) => (
                      <MenuItem key={opt} value={opt}>
                        {opt}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={ROW_LABEL_SX}>
                  ConversionValueAccuracy
                </Typography>
                <FormControl size="small" sx={{ flex: 1 }}>
                  <Select
                    value={form.conversionValueAccuracy}
                    onChange={handleAccuracyChange('conversionValueAccuracy')}
                    disabled={busy}
                  >
                    {ACCURACY_OPTIONS.map((opt) => (
                      <MenuItem key={opt} value={opt}>
                        {opt}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            </Grid>
          </Grid>
        </Paper>

        <Paper variant="outlined" sx={SECTION_PAPER_SX}>
          <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
            HardnessConvertTable
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={ROW_LABEL_SX}>
              HardnessTable
            </Typography>
            <FormControl size="small" sx={{ flex: 1 }}>
              <Select
                value={form.hardnessConvertTable}
                onChange={handleConvertTableChange}
                disabled={busy}
              >
                {HARDNESS_CONVERT_TABLE_OPTIONS.map((opt) => (
                  <MenuItem key={opt} value={opt}>
                    {opt}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={SECTION_PAPER_SX}>
          <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
            Trim Step
          </Typography>
          <Stack direction="row" spacing={2}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flex: 1 }}>
              <Typography variant="body2" sx={SHORT_LABEL_SX}>
                Fast
              </Typography>
              <TextField
                fullWidth
                size="small"
                type="number"
                value={form.trimFast}
                onChange={handleTrimChange('trimFast')}
                disabled={busy}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
            </Stack>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flex: 1 }}>
              <Typography variant="body2" sx={SHORT_LABEL_SX}>
                Slow
              </Typography>
              <TextField
                fullWidth
                size="small"
                type="number"
                value={form.trimSlow}
                onChange={handleTrimChange('trimSlow')}
                disabled={busy}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
            </Stack>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={SECTION_PAPER_SX}>
          <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
            History Image
          </Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Typography variant="body2">{historyCount} Pictures</Typography>
            <Typography variant="body2">{historySize} MB</Typography>
            <Box sx={{ flex: 1 }} />
            <Button variant="outlined" size="small" onClick={handleViewHistory} disabled={busy}>
              View
            </Button>
          </Stack>
        </Paper>

        {errorMessage ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {errorMessage}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={() => void handleConfirm()} disabled={busy}>
          Confirm
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(OtherSettingDialogImpl);
