import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useSaveDepthImageSetting } from '@/hooks/mutations/useSaveDepthImageSetting';
import { useDepthImageSettings } from '@/hooks/queries/useDepthImageSettings';
import { useCreateAlbumItem } from '@/hooks/mutations/useCreateAlbumItem';
import type { Measurement } from '@/types/measurement';
import DepthVsHvGraph, { buildDepthHvGraphPoints } from './DepthVsHvGraph';

const SECTION_SX: SxProps<Theme> = { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 280 };
const PREVIEW_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 260,
  border: 1,
  borderColor: 'divider',
  m: 1.5,
  bgcolor: 'background.paper',
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'stretch',
  overflow: 'hidden',
};
const ACTION_ROW_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 2, px: 1.5, pb: 1.5 };
const BTN_SX: SxProps<Theme> = { textTransform: 'none', fontSize: 12, py: 0.5, minWidth: 96 };
const CHECK_SX: SxProps<Theme> = { '& .MuiFormControlLabel-label': { fontSize: 12 } };
const CHD_FIELD_SX: SxProps<Theme> = {
  width: 108,
  '& .MuiInputBase-input': { fontSize: 12, py: 0.5 },
  '& .MuiInputLabel-root': { fontSize: 12 },
};
const STATUS_SX: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' };
const STATUS_TEXT_SX: SxProps<Theme> = { fontSize: 12, color: 'text.secondary' };
const ALERT_SX: SxProps<Theme> = { mx: 1.5, mb: 1.5 };

const DEFAULT_PREVIEW_LABEL = 'HardnessImage';

type Props = {
  albumItemCount: number;
  onAlbumChanged: () => Promise<void>;
  measurements: Measurement[];
};

function DepthImageTabImpl({ albumItemCount, onAlbumChanged, measurements }: Props) {
  const { data, error: loadError, loading, refetch } = useDepthImageSettings();
  const { error: saveError, saveDepthImageSetting, saving } = useSaveDepthImageSetting();
  const { addAlbumItem, creating: creatingAlbumItem, error: createAlbumError } = useCreateAlbumItem();
  const [hardnessImage, setHardnessImage] = useState(false);
  const [saveImageError, setSaveImageError] = useState<string | null>(null);
  const [chdTargetInput, setChdTargetInput] = useState('550');
  const previewRef = useRef<HTMLDivElement | null>(null);
  const points = useMemo(() => buildDepthHvGraphPoints(measurements), [measurements]);
  const chdTargetHv = useMemo(() => {
    const trimmed = chdTargetInput.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [chdTargetInput]);

  useEffect(() => {
    if (!loading) {
      setHardnessImage(data?.hardnessImage ?? false);
    }
  }, [data?.hardnessImage, loading]);

  const isBusy = loading || saving || creatingAlbumItem;
  const errorMessage = loadError ?? saveError ?? createAlbumError ?? saveImageError;

  const handleToggleHardnessImage = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.checked;
      setHardnessImage(next);

      const previewLabel =
        data?.previewLabel && data.previewLabel.trim().length > 0
          ? data.previewLabel
          : DEFAULT_PREVIEW_LABEL;

      try {
        await saveDepthImageSetting({
          id: data?.id,
          values: {
            hardnessImage: next,
            previewLabel,
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
    // eslint-disable-next-line no-console
    console.log('[depth-image] fresh clicked');
    void refetch();
  }, [refetch]);

  const handleSaveImage = useCallback(async () => {
    // eslint-disable-next-line no-console
    console.log('[depth-image] save image clicked');
    setSaveImageError(null);

    const svg = previewRef.current?.querySelector('svg');
    if (!svg) {
      // eslint-disable-next-line no-console
      console.warn('[album][save-image] no chart to save');
      setSaveImageError('Nothing to save: chart is empty.');
      return;
    }

    const cloned = svg.cloneNode(true) as SVGSVGElement;
    if (!cloned.getAttribute('xmlns')) cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!cloned.getAttribute('width')) cloned.setAttribute('width', '760');
    if (!cloned.getAttribute('height')) cloned.setAttribute('height', '360');
    const serialized = new XMLSerializer().serializeToString(cloned);
    const imageDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(serialized)}`;
    const capturedAt = new Date().toISOString();
    const latest = points[points.length - 1];
    const previewLabel = latest
      ? `HV ${latest.hv.toFixed(2)} @ ${Math.round(latest.distanceUm)} \u00B5m`
      : 'Depth image';
    const title = `Depth Image ${new Date(capturedAt).toLocaleString('en-IN')}`;

    // eslint-disable-next-line no-console
    console.log('[album][save-image] payload', {
      title,
      previewLabel,
      capturedAt,
      bytes: imageDataUrl.length,
    });

    try {
      await addAlbumItem({
        title,
        previewLabel,
        hardnessImage,
        capturedAt,
        imageDataUrl,
      });
      // eslint-disable-next-line no-console
      console.log('[album][save-image] saved ok');
      await onAlbumChanged();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[album][save-image] failed', err);
      setSaveImageError(err instanceof Error ? err.message : String(err));
    }
  }, [addAlbumItem, hardnessImage, onAlbumChanged, points]);

  return (
    <Box sx={SECTION_SX}>
      <Box sx={PREVIEW_SX} ref={previewRef}>
        <DepthVsHvGraph points={points} chdTargetHv={chdTargetHv} />
      </Box>
      <Box sx={ACTION_ROW_SX}>
        <Button variant="outlined" size="small" sx={BTN_SX} disabled={isBusy} onClick={handleRefresh}>
          Fresh
        </Button>
        <Button
          variant="outlined"
          size="small"
          sx={BTN_SX}
          disabled={isBusy}
          onClick={() => {
            void handleSaveImage();
          }}
        >
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
        <TextField
          label="CHD HV"
          size="small"
          type="number"
          value={chdTargetInput}
          disabled={isBusy}
          onChange={(event) => setChdTargetInput(event.target.value)}
          sx={CHD_FIELD_SX}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
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
