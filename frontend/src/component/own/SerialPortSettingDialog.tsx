import { memo, useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useSerialPortSetting } from '@/hooks/queries/useSerialPortSetting';
import { useSaveSerialPortSetting } from '@/hooks/mutations/useSaveSerialPortSetting';
import {
  COM_PORT_OPTIONS,
  DEFAULT_SERIAL_PORT_SETTING,
  type ComPort,
  type SerialPortSetting,
  type SerialPortSettingPayload,
} from '@/types/serialPortSetting';
import { colors } from '@/theme/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
};

type FormField = 'mainPortName' | 'xyPortName' | 'zPortName';

function toFormState(settings: SerialPortSetting | null): SerialPortSettingPayload {
  if (!settings) return DEFAULT_SERIAL_PORT_SETTING;
  return {
    mainPortName: settings.mainPortName,
    xyPortName: settings.xyPortName,
    zPortName: settings.zPortName,
  };
}

const TITLE_SX = { bgcolor: colors.headingPrimary, color: '#FFFFFF', py: 1.25 };
const SECTION_PAPER_SX = { p: 2, mb: 1.5 };
const SECTION_TITLE_SX = { color: colors.headingSecondary, fontWeight: 600, mb: 1 };
const ROW_LABEL_SX = { minWidth: 90 };

type SectionProps = {
  title: string;
  value: ComPort;
  field: FormField;
  disabled: boolean;
  onChange: (field: FormField, value: ComPort) => void;
};

const PortSection = memo(function PortSection({
  title,
  value,
  field,
  disabled,
  onChange,
}: SectionProps) {
  const handleChange = useCallback(
    (event: SelectChangeEvent) => {
      onChange(field, event.target.value as ComPort);
    },
    [field, onChange]
  );

  return (
    <Paper variant="outlined" sx={SECTION_PAPER_SX}>
      <Typography variant="subtitle2" sx={SECTION_TITLE_SX}>
        {title}
      </Typography>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" sx={ROW_LABEL_SX}>
          Port Name
        </Typography>
        <FormControl size="small" sx={{ flex: 1 }}>
          <Select value={value} onChange={handleChange} disabled={disabled}>
            {COM_PORT_OPTIONS.map((opt) => (
              <MenuItem key={opt} value={opt}>
                {opt}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
    </Paper>
  );
});

function SerialPortSettingDialogImpl({ open, onClose, onStatusChange }: Props) {
  const { data, error: loadError, loading, refetch } = useSerialPortSetting();
  const { saveSerialPortSetting, saving, error: saveError } = useSaveSerialPortSetting();
  const [form, setForm] = useState<SerialPortSettingPayload>(DEFAULT_SERIAL_PORT_SETTING);

  const busy = loading || saving;
  const errorMessage = loadError ?? saveError;

  useEffect(() => {
    if (open) {
      void refetch();
    }
  }, [open, refetch]);

  useEffect(() => {
    if (open && !loading) {
      setForm(toFormState(data));
    }
  }, [data, loading, open]);

  const handleFieldChange = useCallback((field: FormField, value: ComPort) => {
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  const handleConfirm = useCallback(async () => {
    try {
      await saveSerialPortSetting({ id: data?.id, values: form });
      onStatusChange?.('Serial port setting saved.');
      onClose();
    } catch {
      // surfaced via saveError
    }
  }, [data?.id, form, onClose, onStatusChange, saveSerialPortSetting]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={TITLE_SX}>Serial Port Setting</DialogTitle>
      <DialogContent dividers>
        <PortSection
          title="Main"
          value={form.mainPortName}
          field="mainPortName"
          disabled={busy}
          onChange={handleFieldChange}
        />
        <PortSection
          title="X/Y"
          value={form.xyPortName}
          field="xyPortName"
          disabled={busy}
          onChange={handleFieldChange}
        />
        <PortSection
          title="Z"
          value={form.zPortName}
          field="zPortName"
          disabled={busy}
          onChange={handleFieldChange}
        />

        {errorMessage ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {errorMessage}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={() => void handleConfirm()} disabled={busy}>
          Confirm
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(SerialPortSettingDialogImpl);
