import { memo, useCallback, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import { useRestoreFactorySettings } from '@/hooks/mutations/useRestoreFactorySettings';
import { tokens } from '@/theme/theme';

type Props = {
  open: boolean;
  onClose: () => void;
  onStatusChange?: (message: string) => void;
  onRestored?: () => void;
};

function RestoreFactoryDialogImpl({ open, onClose, onStatusChange, onRestored }: Props) {
  const { restore, restoring, error } = useRestoreFactorySettings();
  const [localError, setLocalError] = useState<string | null>(null);

  const errorMessage = error ?? localError;

  const handleYes = useCallback(async () => {
    setLocalError(null);
    try {
      await restore();
      onStatusChange?.('Factory settings restored.');
      onRestored?.();
      onClose();
    } catch {
      // surfaced via error
    }
  }, [onClose, onRestored, onStatusChange, restore]);

  return (
    <Dialog open={open} onClose={restoring ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ bgcolor: tokens.accent.base, color: '#FFFFFF', py: 1.25 }}>
        Info
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', py: 1 }}>
          <InfoOutlinedIcon sx={{ fontSize: 40, color: tokens.accent.base }} />
          <Typography variant="body1">Restore Factory Settings?</Typography>
        </Stack>
        {errorMessage ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {errorMessage}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button
          variant="contained"
          onClick={() => void handleYes()}
          disabled={restoring}
        >
          Yes
        </Button>
        <Button onClick={onClose} disabled={restoring}>
          No
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(RestoreFactoryDialogImpl);
