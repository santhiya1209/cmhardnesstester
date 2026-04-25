import { memo, useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useSaveDepthImageSetting } from '@/hooks/mutations/useSaveDepthImageSetting';
import { useDepthImageSettings } from '@/hooks/queries/useDepthImageSettings';

const SECTION_SX: SxProps<Theme> = { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 280 };
const PREVIEW_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 200,
  border: 1,
  borderColor: 'divider',
  m: 1.5,
  bgcolor: 'background.paper',
};
const ACTION_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 2, px: 1.5, pb: 1.5 };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const CHECK_SX: SxProps<Theme> = { '& .MuiFormControlLabel-label': { fontSize: 12 } };
const STATUS_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' };
const STATUS_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const ALERT_SX: SxProps<Theme> = { mx: 1.5, mb: 1.5 };

const DEFAULT_PREVIEW_LABEL = '';

type Props = {
  albumItemCount: number;
  onAlbumChanged: () => Promise<void>;
};

function DepthImageTabImpl({ albumItemCount, onAlbumChanged }: Props) {
  const { data, error: loadError, loading, refetch } = useDepthImageSettings();
  const { error: saveError, saveDepthImageSetting, saving } = useSaveDepthImageSetting();
  const [hardnessImage, setHardnessImage] = useState(false);

  useEffect(() => {
    if (!loading) {
      setHardnessImage(data?.hardnessImage ?? false);
    }
  }, [data?.hardnessImage, loading]);

  const isBusy = loading || saving;
  const errorMessage = loadError ?? saveError;

  const handleToggleHardnessImage = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.checked;
      setHardnessImage(next);

      try {
        await saveDepthImageSetting({
          id: data?.id,
          values: {
            hardnessImage: next,
            previewLabel: data?.previewLabel ?? DEFAULT_PREVIEW_LABEL,
          },
        });
        await refetch();
      } catch {
        setHardnessImage(data?.hardnessImage ?? false);
      }
    },
    [data?.hardnessImage, data?.id, data?.previewLabel, refetch, saveDepthImageSetting]
  );

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const handleSaveImage = useCallback(() => {
    void onAlbumChanged();
  }, [onAlbumChanged]);

  return (
    <Box sx={SECTION_SX}>
      <Box sx={PREVIEW_SX} />
      <Box sx={ACTION_ROW_SX}>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={isBusy} onClick={handleRefresh}>
          Fresh
        </Button>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={isBusy} onClick={handleSaveImage}>
          Save Image
        </Button>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={hardnessImage}
              disabled={isBusy}
              onChange={(event) => {
                void handleToggleHardnessImage(event);
              }}
            />
          }
          label="HardnessImage"
          sx={CHECK_SX}
        />
        <Box sx={STATUS_SX}>
          {isBusy ? <CircularProgress size={14} /> : null}
          <Typography sx={STATUS_TEXT_SX}>Album items: {albumItemCount}</Typography>
        </Box>
      </Box>
      {errorMessage ? (
        <Alert severity="error" sx={ALERT_SX}>
          {errorMessage}
        </Alert>
      ) : null}
    </Box>
  );
}

export default memo(DepthImageTabImpl);
