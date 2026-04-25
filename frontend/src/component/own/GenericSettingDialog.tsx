import { memo, useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useGenericSetting } from '@/hooks/queries/useGenericSetting';
import { useSaveGenericSetting } from '@/hooks/mutations/useSaveGenericSetting';
import {
  DEFAULT_GENERIC_SETTING,
  type GenericSetting,
  type HardnessTestMode,
} from '@/types/genericSetting';
import { colors } from '@/theme/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
};

type FormState = {
  caseDepthHardness: string;
  hardnessTestMode: HardnessTestMode;
};

function toFormState(settings: GenericSetting | null): FormState {
  if (!settings) {
    return {
      caseDepthHardness: String(DEFAULT_GENERIC_SETTING.caseDepthHardness),
      hardnessTestMode: DEFAULT_GENERIC_SETTING.hardnessTestMode,
    };
  }
  return {
    caseDepthHardness: String(settings.caseDepthHardness),
    hardnessTestMode: settings.hardnessTestMode,
  };
}

function parseHardness(value: string): number | null {
  const n = Number(value.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const TITLE_SX = { bgcolor: colors.headingPrimary, color: '#FFFFFF', py: 1.25 };
const SECTION_PAPER_SX = { p: 2, mb: 1.5 };
const SECTION_TITLE_SX = { color: colors.headingSecondary, fontWeight: 600, mb: 1 };
const ROW_LABEL_SX = { minWidth: 90 };

function GenericSettingDialogImpl({ open, onClose, onStatusChange }: Props) {
  const { data, error: loadError, loading, refetch } = useGenericSetting();
  const { saveGenericSetting, saving, error: saveError } = useSaveGenericSetting();
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

  const handleHardnessChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setValidationError(null);
      setForm((current) => ({ ...current, caseDepthHardness: value }));
    },
    []
  );

  const handleModeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({
      ...current,
      hardnessTestMode: event.target.value as HardnessTestMode,
    }));
  }, []);

  const handleConfirm = useCallback(async () => {
    const hardness = parseHardness(form.caseDepthHardness);
    if (hardness === null) {
      setValidationError('Please enter a valid non-negative hardness value.');
      return;
    }
    try {
      await saveGenericSetting({
        id: data?.id,
        values: { caseDepthHardness: hardness, hardnessTestMode: form.hardnessTestMode },
      });
      onStatusChange?.('Generic setting saved.');
      onClose();
    } catch {
      // surfaced via saveError
    }
  }, [data?.id, form, onClose, onStatusChange, saveGenericSetting]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={TITLE_SX}>Generic Setting</DialogTitle>
      <DialogContent dividers>
        <Paper variant="outlined" sx={SECTION_PAPER_SX}>
          <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
            Case Depth
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={ROW_LABEL_SX}>
              Hardness
            </Typography>
            <TextField
              fullWidth
              size="small"
              type="number"
              value={form.caseDepthHardness}
              onChange={handleHardnessChange}
              disabled={busy}
              slotProps={{ htmlInput: { min: 0, step: 'any' } }}
            />
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={SECTION_PAPER_SX}>
          <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
            Hardness Test Mode
          </Typography>
          <RadioGroup row value={form.hardnessTestMode} onChange={handleModeChange}>
            <FormControlLabel
              value="HV"
              control={<Radio size="small" disabled={busy} />}
              label="HV"
            />
            <FormControlLabel
              value="HK"
              control={<Radio size="small" disabled={busy} />}
              label="HK"
            />
          </RadioGroup>
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

export default memo(GenericSettingDialogImpl);
