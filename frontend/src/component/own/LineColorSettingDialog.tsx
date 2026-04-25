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
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useLineColorSetting } from '@/hooks/queries/useLineColorSetting';
import { useSaveLineColorSetting } from '@/hooks/mutations/useSaveLineColorSetting';
import {
  DEFAULT_LINE_COLOR,
  LINE_COLOR_HEX,
  LINE_COLOR_OPTIONS,
  type LineColor,
} from '@/types/lineColorSetting';
import { colors } from '@/theme/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
  onSaved?: (color: LineColor) => void;
};

function LineColorSettingDialogImpl({ open, onClose, onStatusChange, onSaved }: Props) {
  const { data, error: loadError, loading, refetch } = useLineColorSetting();
  const { saveLineColorSetting, saving, error: saveError } = useSaveLineColorSetting();
  const [selected, setSelected] = useState<LineColor>(DEFAULT_LINE_COLOR);

  const busy = loading || saving;
  const errorMessage = loadError ?? saveError;

  useEffect(() => {
    if (open) {
      void refetch();
    }
  }, [open, refetch]);

  useEffect(() => {
    if (open && !loading) {
      setSelected(data?.lineColor ?? DEFAULT_LINE_COLOR);
    }
  }, [data, loading, open]);

  const handleChange = useCallback((event: SelectChangeEvent) => {
    setSelected(event.target.value as LineColor);
  }, []);

  const handleSave = useCallback(async () => {
    try {
      await saveLineColorSetting({ id: data?.id, values: { lineColor: selected } });
      onStatusChange?.(`Line color set to ${selected}.`);
      onSaved?.(selected);
      onClose();
    } catch {
      // error surfaced via saveError
    }
  }, [data?.id, onClose, onSaved, onStatusChange, saveLineColorSetting, selected]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ bgcolor: colors.headingPrimary, color: '#FFFFFF', py: 1.25 }}>
        Line Color Setting
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ minWidth: 110 }}>
            Color Selection
          </Typography>
          <FormControl size="small" sx={{ flex: 1 }}>
            <Select value={selected} onChange={handleChange} disabled={busy}>
              {LINE_COLOR_OPTIONS.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box
            sx={{
              width: 36,
              height: 28,
              bgcolor: LINE_COLOR_HEX[selected],
              border: 1,
              borderColor: colors.border,
            }}
            aria-label={`Preview ${selected}`}
          />
        </Stack>

        {errorMessage ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={busy}
        >
          Save
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(LineColorSettingDialogImpl);
