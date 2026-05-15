import { memo, useEffect, useRef } from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { alpha, type SxProps, type Theme } from '@mui/material/styles';

type Accent = 'primary' | 'secondary' | 'success' | 'warning';

type Props = {
  title: string;
  value: string;
  subtitle: string;
  accent: Accent;
};

function buildCardSx(accent: Accent): SxProps<Theme> {
  return (theme) => {
    const accentColor = theme.palette[accent].main;
    return {
      position: 'relative',
      height: '100%',
      minHeight: theme.spacing(18),
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      p: 2,
      borderRadius: 2,
      border: 1,
      borderColor: alpha(accentColor, 0.65),
      background: `linear-gradient(145deg, ${alpha(theme.palette.primary.dark, 0.98)} 0%, ${alpha(theme.palette.common.black, 0.92)} 100%)`,
      boxShadow: `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.12)}, 0 0 0 1px ${alpha(accentColor, 0.18)}, 0 16px 36px ${alpha(accentColor, 0.2)}`,
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(90deg, ${alpha(accentColor, 0.24)}, transparent 36%)`,
        pointerEvents: 'none',
      },
      '&::after': {
        content: '""',
        position: 'absolute',
        left: theme.spacing(2),
        right: theme.spacing(2),
        top: 0,
        height: theme.spacing(0.35),
        borderRadius: 1,
        background: `linear-gradient(90deg, ${accentColor}, ${alpha(accentColor, 0.2)})`,
      },
    };
  };
}

const TITLE_SX: SxProps<Theme> = {
  position: 'relative',
  color: 'common.white',
  opacity: 0.78,
  fontWeight: 800,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
};

const VALUE_SX: SxProps<Theme> = {
  position: 'relative',
  color: 'common.white',
  fontSize: (theme) => theme.typography.pxToRem(34),
  fontWeight: 800,
  lineHeight: 1,
  letterSpacing: 0,
  fontVariantNumeric: 'tabular-nums',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const SUBTITLE_SX: SxProps<Theme> = {
  position: 'relative',
  color: 'common.white',
  opacity: 0.68,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
};

function IndustrialStatCardImpl({ title, value, subtitle, accent }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(`[machine-control-industrial-card-render] title=${title} value=${value} subtitle=${subtitle}`);
  }, [subtitle, title, value]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // eslint-disable-next-line no-console
      console.log(
        `[machine-control-industrial-card-resize] title=${title} width=${Math.round(width)} height=${Math.round(height)}`
      );
    });
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, [title]);

  return (
    <Paper ref={rootRef} elevation={0} sx={buildCardSx(accent)}>
      <Typography variant="overline" sx={TITLE_SX}>
        {title}
      </Typography>
      <Typography title={value} sx={VALUE_SX}>
        {value}
      </Typography>
      <Typography variant="caption" sx={SUBTITLE_SX}>
        {subtitle}
      </Typography>
    </Paper>
  );
}

export default memo(IndustrialStatCardImpl);
