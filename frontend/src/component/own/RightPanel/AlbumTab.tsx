import { memo, useCallback, useEffect } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import ImageIcon from '@mui/icons-material/Image';
import type { SxProps, Theme } from '@mui/material/styles';
import type { Measurement } from '@/types/measurement';

const SECTION_SX: SxProps<Theme> = {
  px: 1.5,
  py: 1.5,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  minHeight: 220,
};
const GRID_WRAP_SX: SxProps<Theme> = {
  flex: 1,
  minHeight: 200,
  maxHeight: 380,
  overflowY: 'auto',
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  p: 1,
};
const GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: 1,
};
const CARD_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  border: 1,
  borderColor: 'divider',
  overflow: 'hidden',
};
const THUMB_SX: SxProps<Theme> = {
  width: '100%',
  aspectRatio: '4 / 3',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  bgcolor: 'action.hover',
  color: 'text.disabled',
  overflow: 'hidden',
};
const THUMB_IMG_SX: SxProps<Theme> = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};
const FOOTER_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  px: 0.75,
  py: 0.5,
  borderTop: 1,
  borderColor: 'divider',
};
const INDEX_SX: SxProps<Theme> = { fontSize: 11, fontWeight: 700, minWidth: 26 };
const SCALE_SX: SxProps<Theme> = { fontSize: 11, color: 'text.secondary', minWidth: 38 };
const VALUE_SX: SxProps<Theme> = { fontSize: 12, fontWeight: 600, flex: 1, fontVariantNumeric: 'tabular-nums' };
const GO_BTN_SX: SxProps<Theme> = {
  textTransform: 'none',
  fontSize: 11,
  fontWeight: 600,
  minWidth: 0,
  px: 1,
  py: 0,
  height: 22,
};
const EMPTY_SX: SxProps<Theme> = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  color: 'text.secondary',
  py: 6,
};

type Props = {
  measurements: Measurement[];
};

function formatHardnessScale(testForceKgf: number | null | undefined): string {
  if (testForceKgf === null || testForceKgf === undefined || !Number.isFinite(testForceKgf)) {
    return 'HV';
  }
  const trimmed = Number.isInteger(testForceKgf) ? String(testForceKgf) : String(testForceKgf);
  return `HV${trimmed}`;
}

function formatHv(hv: number | null | undefined): string {
  if (hv === null || hv === undefined || !Number.isFinite(hv)) return '--';
  return hv.toFixed(2);
}

function AlbumTabImpl({ measurements }: Props) {
  useEffect(() => {
  }, [measurements.length]);

  const handleGo = useCallback((_m: Measurement) => {
  }, []);

  return (
    <Box sx={SECTION_SX}>
      <Box sx={GRID_WRAP_SX}>
        {measurements.length === 0 ? (
          <Box sx={EMPTY_SX}>No album items</Box>
        ) : (
          <Box sx={GRID_SX}>
            {measurements.map((m, index) => {
              const scale = formatHardnessScale(m.testForceKgf);
              const value = formatHv(m.hv);
              const hasImage = !!m.imageDataUrl;
              if (!hasImage) {
                // eslint-disable-next-line no-console
                console.warn('[album] missing image for measurementId=', m.id);
              }
              return (
                <Paper key={m.id} elevation={0} sx={CARD_SX}>
                  <Box sx={THUMB_SX}>
                    {m.imageDataUrl ? (
                      <Box
                        component="img"
                        src={m.imageDataUrl}
                        alt={`Measurement ${index + 1}`}
                        sx={THUMB_IMG_SX}
                      />
                    ) : (
                      <ImageIcon fontSize="large" />
                    )}
                  </Box>
                  <Box sx={FOOTER_SX}>
                    <Typography sx={INDEX_SX}>#{index + 1}</Typography>
                    <Typography sx={SCALE_SX}>{scale}</Typography>
                    <Typography sx={VALUE_SX}>{value}</Typography>
                    <Button
                      variant="outlined"
                      size="small"
                      sx={GO_BTN_SX}
                      onClick={() => handleGo(m)}
                    >
                      GO
                    </Button>
                  </Box>
                </Paper>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default memo(AlbumTabImpl);
