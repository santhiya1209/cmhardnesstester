import { memo } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { tokens } from '@/theme/theme';
import { useActiveCalibration } from '@/features/calibration/useActiveCalibration';

const PANEL_SX: SxProps<Theme> = {
  px: 1.5,
  py: 1.25,
  borderRadius: 1.5,
  border: 1,
  borderColor: tokens.border.subtle,
  bgcolor: tokens.surface.base,
};

const HEADER_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  mb: 1,
};

const TITLE_SX: SxProps<Theme> = {
  fontSize: 12,
  fontWeight: 600,
  color: tokens.text.secondary,
  letterSpacing: 0.2,
};

const GRID_SX: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  columnGap: 1.5,
  rowGap: 0.5,
  alignItems: 'baseline',
};

const ROW_LABEL_SX: SxProps<Theme> = {
  fontSize: 11,
  color: tokens.text.muted,
  fontWeight: 500,
};

const ROW_VALUE_SX: SxProps<Theme> = {
  fontSize: 11,
  color: tokens.text.primary,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

function statusChipSx(calibrated: boolean): SxProps<Theme> {
  const color = calibrated ? tokens.status.success : tokens.status.error;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.5,
    px: 0.75,
    py: 0.25,
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: 0.3,
    color,
    bgcolor: `${color}14`,
    border: `1px solid ${color}33`,
    textTransform: 'uppercase',
  };
}

const DOT_SX = (calibrated: boolean): SxProps<Theme> => ({
  width: 7,
  height: 7,
  borderRadius: '50%',
  bgcolor: calibrated ? tokens.status.success : tokens.status.error,
});

const DASH = '—';

function formatDate(iso: string | null): string {
  if (!iso) return DASH;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? DASH : parsed.toLocaleString();
}

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <>
      <Typography component="span" sx={ROW_LABEL_SX}>
        {label}
      </Typography>
      <Typography component="span" sx={ROW_VALUE_SX} title={title ?? value}>
        {value}
      </Typography>
    </>
  );
}

type Props = {
  activeObjective: string | null;
};

/**
 * Read-only status of the calibration that Manual Measure and Auto Measure will
 * actually apply for the active objective + force. The single source is
 * `useActiveCalibration` → `resolveActiveCalibration` — the same resolver the
 * measurement pipeline uses — so this panel can never disagree with the applied
 * calibration. It never queries the calibration tables directly and holds no
 * calibration state of its own; it re-renders automatically as objective,
 * force, or calibration records change (the hook subscribes to both).
 */
function CalibrationStatusPanelImpl({ activeObjective }: Props) {
  const active = useActiveCalibration(activeObjective);
  const calibrated = active.status === 'calibrated';

  return (
    <Paper elevation={0} sx={PANEL_SX}>
      <Box sx={HEADER_SX}>
        <Typography sx={TITLE_SX}>Calibration Status</Typography>
        <Box component="span" sx={statusChipSx(calibrated)}>
          <Box component="span" sx={DOT_SX(calibrated)} />
          {calibrated ? 'Calibrated' : 'Not Calibrated'}
        </Box>
      </Box>

      <Box sx={GRID_SX}>
        <Row label="Objective" value={active.objective ?? DASH} />
        <Row label="Force" value={active.force ?? DASH} />
        <Row
          label="Calibration ID"
          value={active.calibrationId ?? DASH}
          title={active.calibrationId ?? undefined}
        />
        <Row
          label="Certified Hardness"
          value={
            active.certifiedHardnessHv != null ? `${active.certifiedHardnessHv} HV` : DASH
          }
        />
        <Row label="Calibration Date" value={formatDate(active.calibratedAt)} />
      </Box>
    </Paper>
  );
}

export default memo(CalibrationStatusPanelImpl);
