import { memo, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import type { EnginePhase } from '@/types/multipointExecution';
import { ACTIVE_PHASES } from '@/types/multipointExecution';

const WRAP_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0.75,
  p: 1.25,
  borderRadius: 2,
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.default',
};
const ROW_SX: SxProps<Theme> = { display: 'flex', justifyContent: 'space-between', gap: 1 };
const LABEL_SX: SxProps<Theme> = { fontSize: 11, color: 'text.secondary' };
const VALUE_SX: SxProps<Theme> = { fontSize: 12, fontWeight: 600 };

const PHASE_LABEL: Record<EnginePhase, string> = {
  idle: 'Idle',
  moving: 'Moving',
  focusing: 'Focusing',
  indenting: 'Indenting',
  measuring: 'Measuring',
  saving: 'Saving',
  paused: 'Paused',
  stopped: 'Stopped',
  completed: 'Completed',
  error: 'Error',
};

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type Props = {
  phase: EnginePhase;
  currentPointNo: number | null;
  total: number;
  completedCount: number;
  progressPct: number;
  pass: 1 | 2 | null;
  startedAtMs: number | null;
};

function ExecutionStatusPanelImpl({
  phase,
  currentPointNo,
  total,
  completedCount,
  progressPct,
  pass,
  startedAtMs,
}: Props) {
  const live = ACTIVE_PHASES.has(phase) || phase === 'paused';
  // Tick once a second only while a run is live so elapsed/remaining update.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);

  const elapsedMs = startedAtMs ? now - startedAtMs : 0;
  const remainingMs =
    completedCount > 0 && total > completedCount
      ? (elapsedMs / completedCount) * (total - completedCount)
      : null;

  return (
    <Box sx={WRAP_SX}>
      <Box sx={ROW_SX}>
        <Typography sx={LABEL_SX}>Operation</Typography>
        <Typography sx={VALUE_SX}>
          {PHASE_LABEL[phase]}
          {pass ? ` · Pass ${pass}` : ''}
        </Typography>
      </Box>
      <Box sx={ROW_SX}>
        <Typography sx={LABEL_SX}>Current point</Typography>
        <Typography sx={VALUE_SX}>{currentPointNo ? `${currentPointNo} / ${total}` : `— / ${total}`}</Typography>
      </Box>
      <LinearProgress variant="determinate" value={Math.min(100, Math.max(0, progressPct))} />
      <Box sx={ROW_SX}>
        <Typography sx={LABEL_SX}>{`Progress ${progressPct}% (${completedCount}/${total})`}</Typography>
      </Box>
      <Box sx={ROW_SX}>
        <Typography sx={LABEL_SX}>Elapsed</Typography>
        <Typography sx={VALUE_SX}>{fmtDuration(elapsedMs)}</Typography>
      </Box>
      <Box sx={ROW_SX}>
        <Typography sx={LABEL_SX}>Remaining (est.)</Typography>
        <Typography sx={VALUE_SX}>{remainingMs == null ? '—' : fmtDuration(remainingMs)}</Typography>
      </Box>
    </Box>
  );
}

export default memo(ExecutionStatusPanelImpl);
