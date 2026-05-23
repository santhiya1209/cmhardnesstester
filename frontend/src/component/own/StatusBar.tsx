import { memo, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import type { SxProps, Theme } from '@mui/material/styles';

import { colors } from '@/theme/theme';
import { useMicrometerReading } from '@/hooks/useMicrometerReading';
import type { MachineState } from '@/types/machine';

const BAR_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  height: 28,
  px: 1.5,
  bgcolor: colors.panel,
  borderTop: 1,
  borderColor: colors.border,
  fontSize: 11,
  gap: 2,
};

const SETTINGS_ICON_SX: SxProps<Theme> = {
  fontSize: 16,
  color: colors.textMuted,
  mr: 0.5,
};

const MESSAGE_SX: SxProps<Theme> = {
  fontSize: 11,
  color: colors.textMuted,
  fontWeight: 500,
};

const READOUT_SX: SxProps<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  ml: 'auto',
};

const LABEL_SX: SxProps<Theme> = { fontSize: 11, color: colors.textMuted, fontWeight: 500 };
const VALUE_SX: SxProps<Theme> = {
  fontSize: 11,
  color: colors.headingPrimary,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};
const CONNECTION_SX: SxProps<Theme> = {
  fontSize: 11,
  color: colors.textMuted,
  fontWeight: 500,
};
const STATUS_ITEM_SX: SxProps<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.5,
  flexShrink: 0,
};
const STATUS_DOT_SX: SxProps<Theme> = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  flexShrink: 0,
};
const MACHINE_READOUT_SX: SxProps<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 1.5,
  color: colors.headingPrimary,
  flexShrink: 0,
};

export type CameraStatusState =
  | 'closed'
  | 'opening'
  | 'connected'
  | 'streaming'
  | 'frozen'
  | 'error'
  | 'reconnecting';

export type AutoMeasureStatusState =
  | 'idle'
  | 'detecting'
  | 'success'
  | 'duplicate'
  | 'failed';

const CAMERA_STATUS_LABEL: Record<CameraStatusState, string> = {
  closed: 'Closed',
  opening: 'Opening...',
  connected: 'Connected',
  streaming: 'Streaming',
  frozen: 'Frozen',
  error: 'Error',
  reconnecting: 'Reconnecting...',
};

const AUTO_MEASURE_STATUS_LABEL: Record<AutoMeasureStatusState, string> = {
  idle: 'Idle',
  detecting: 'Detecting...',
  success: 'Detection Success',
  duplicate: 'Duplicate measurement',
  failed: 'Detection Failed',
};

type Props = {
  message?: string;
  cameraStatus?: CameraStatusState;
  objective?: string | null;
  autoMeasureStatus?: AutoMeasureStatusState;
  machineState?: MachineState | null;
};

type MachineStatusLabel = 'Ready' | 'Moving' | 'Error';

function getMachineStatusLabel(machineState: MachineState | null | undefined): MachineStatusLabel {
  if (
    machineState?.lastError ||
    machineState?.syncStatus === 'failed' ||
    machineState?.indentStatus === 'error'
  ) {
    return 'Error';
  }

  if (
    machineState?.syncStatus === 'pending' ||
    machineState?.indenting ||
    machineState?.indentStatus === 'started' ||
    machineState?.indentStatus === 'running' ||
    machineState?.machineStatus?.toLowerCase().includes('running')
  ) {
    return 'Moving';
  }

  return 'Ready';
}

function getMachineDotColor(connected: boolean, status: MachineStatusLabel): string {
  if (!connected || status === 'Error') return 'error.main';
  if (status === 'Moving') return 'warning.main';
  return 'success.main';
}

type MachineReadoutProps = {
  connected: boolean;
  port: string;
  status: MachineStatusLabel;
};

function MachineReadoutImpl({ connected, port, status }: MachineReadoutProps) {
  return (
    <Box sx={MACHINE_READOUT_SX}>
      <Box sx={STATUS_ITEM_SX}>
        <Box sx={{ ...STATUS_DOT_SX, bgcolor: connected ? 'success.main' : 'error.main' }} />
        <Typography component="span" sx={VALUE_SX}>
          {`Machine: ${connected ? 'Connected' : 'Disconnected'}`}
        </Typography>
      </Box>
      <Typography component="span" sx={CONNECTION_SX}>
        {`COM: ${port}`}
      </Typography>
      <Box sx={STATUS_ITEM_SX}>
        <Box sx={{ ...STATUS_DOT_SX, bgcolor: getMachineDotColor(connected, status) }} />
        <Typography component="span" sx={VALUE_SX}>
          {`Status: ${status}`}
        </Typography>
      </Box>
    </Box>
  );
}
const MachineReadout = memo(MachineReadoutImpl);

function MicrometerReadoutImpl() {
  const { connected, displayText, updatedAt } = useMicrometerReading();
  const title = updatedAt ? new Date(updatedAt).toLocaleTimeString() : undefined;

  return (
    <Box sx={STATUS_ITEM_SX}>
      <Box sx={{ ...STATUS_DOT_SX, bgcolor: connected ? 'success.main' : 'warning.main' }} />
      <Typography component="span" sx={LABEL_SX}>
        Micrometer:
      </Typography>
      <Typography component="span" sx={VALUE_SX} title={title}>
        {connected ? displayText : 'Waiting for data...'}
      </Typography>
    </Box>
  );
}
const MicrometerReadout = memo(MicrometerReadoutImpl);

function StatusBarImpl({
  message = 'System Status: Failed To Load Hardness Tester',
  cameraStatus,
  objective,
  autoMeasureStatus,
  machineState,
}: Props) {
  const machineConnected = machineState?.connected ?? false;
  const machinePort = machineState?.port?.trim() || '-';
  const machineStatus = getMachineStatusLabel(machineState);

  useEffect(() => {
  }, [machineConnected, machinePort, machineStatus]);

  return (
    <Box component="footer" sx={BAR_SX}>
      <SettingsOutlinedIcon sx={SETTINGS_ICON_SX} />
      <Typography sx={MESSAGE_SX}>{message}</Typography>
      {cameraStatus ? (
        <Typography sx={MESSAGE_SX}>{`Camera: ${CAMERA_STATUS_LABEL[cameraStatus]}`}</Typography>
      ) : null}
      {objective ? (
        <Typography sx={MESSAGE_SX}>{`Objective: ${objective}`}</Typography>
      ) : null}
      {autoMeasureStatus ? (
        <Typography sx={MESSAGE_SX}>{`Auto Measure: ${AUTO_MEASURE_STATUS_LABEL[autoMeasureStatus]}`}</Typography>
      ) : null}
      <Box sx={READOUT_SX}>
        <MachineReadout
          connected={machineConnected}
          port={machinePort}
          status={machineStatus}
        />
        <MicrometerReadout />
      </Box>
    </Box>
  );
}

export default memo(StatusBarImpl);
