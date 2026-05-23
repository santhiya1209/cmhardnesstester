import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useSaveDepthImageSetting } from '@/hooks/mutations/useSaveDepthImageSetting';
import { useDepthImageSettings } from '@/hooks/queries/useDepthImageSettings';
import { useCreateAlbumItem } from '@/hooks/mutations/useCreateAlbumItem';
import type { Measurement } from '@/types/measurement';
import DepthVsHvGraph, { buildAxisGraphPoints } from './DepthVsHvGraph';
import {
  AXIS_LABEL,
  X_AXIS_KEYS,
  Y_AXIS_KEYS,
  type XAxisKey,
  type YAxisKey,
} from './DepthVsHvGraph.utils';

const DEFAULT_X_AXIS: XAxisKey = 'depthUm';
const DEFAULT_Y_AXIS: YAxisKey = 'hv';
const LS_X_KEY = 'depthImage.xAxis';
const LS_Y_KEY = 'depthImage.yAxis';
function readPersistedAxis<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    if (value && (allowed as readonly string[]).includes(value)) return value as T;
  } catch {
    /* localStorage unavailable */
  }
  return fallback;
}

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
const AXIS_ROW_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  px: 1.5,
  pt: 1,
};
const AXIS_FIELD_SX: SxProps<Theme> = {
  minWidth: 160,
  '& .MuiInputBase-input': { fontSize: 12, py: 0.5 },
  '& .MuiInputLabel-root': { fontSize: 12 },
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
  const [xAxisKey, setXAxisKey] = useState<XAxisKey>(() =>
    readPersistedAxis(LS_X_KEY, X_AXIS_KEYS, DEFAULT_X_AXIS)
  );
  const [yAxisKey, setYAxisKey] = useState<YAxisKey>(() =>
    readPersistedAxis(LS_Y_KEY, Y_AXIS_KEYS, DEFAULT_Y_AXIS)
  );
  const previewRef = useRef<HTMLDivElement | null>(null);
  const points = useMemo(
    () => buildAxisGraphPoints(measurements, xAxisKey, yAxisKey),
    [measurements, xAxisKey, yAxisKey]
  );
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_X_KEY, xAxisKey);
      window.localStorage.setItem(LS_Y_KEY, yAxisKey);
    } catch {
      /* localStorage unavailable */
    }
  }, [xAxisKey, yAxisKey]);
  const handleXChange = useCallback((event: SelectChangeEvent) => {
    setXAxisKey(event.target.value as XAxisKey);
  }, []);
  const handleYChange = useCallback((event: SelectChangeEvent) => {
    setYAxisKey(event.target.value as YAxisKey);
  }, []);
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
    void refetch();
  }, [refetch]);

  const handleSaveImage = useCallback(async () => {
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
      ? `${AXIS_LABEL[yAxisKey]}: ${latest.y.toFixed(2)} @ ${AXIS_LABEL[xAxisKey]}: ${Math.round(latest.x)}`
      : 'Depth image';
    const title = `Depth Image ${new Date(capturedAt).toLocaleString('en-IN')}`;


    try {
      await addAlbumItem({
        title,
        previewLabel,
        hardnessImage,
        capturedAt,
        imageDataUrl,
      });
      await onAlbumChanged();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[album][save-image] failed', err);
      setSaveImageError(err instanceof Error ? err.message : String(err));
    }
  }, [addAlbumItem, hardnessImage, onAlbumChanged, points]);

  return (
    <Box sx={SECTION_SX}>
      <Box sx={AXIS_ROW_SX}>
        <FormControl size="small" sx={AXIS_FIELD_SX} disabled={isBusy}>
          <InputLabel id="depth-graph-x-axis-label">X Axis</InputLabel>
          <Select
            labelId="depth-graph-x-axis-label"
            label="X Axis"
            value={xAxisKey}
            onChange={handleXChange}
          >
            {X_AXIS_KEYS.map((key) => (
              <MenuItem key={key} value={key}>
                {AXIS_LABEL[key]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={AXIS_FIELD_SX} disabled={isBusy}>
          <InputLabel id="depth-graph-y-axis-label">Y Axis</InputLabel>
          <Select
            labelId="depth-graph-y-axis-label"
            label="Y Axis"
            value={yAxisKey}
            onChange={handleYChange}
          >
            {Y_AXIS_KEYS.map((key) => (
              <MenuItem key={key} value={key}>
                {AXIS_LABEL[key]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Box sx={PREVIEW_SX} ref={previewRef}>
        <DepthVsHvGraph
          points={points}
          chdTargetHv={chdTargetHv}
          xKey={xAxisKey}
          yKey={yAxisKey}
        />
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
