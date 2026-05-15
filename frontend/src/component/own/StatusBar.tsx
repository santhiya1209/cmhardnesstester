import { memo, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { colors } from '@/theme/theme';
import { useMicrometerReading } from '@/hooks/useMicrometerReading';
import type { MachineState } from '@/types/machine';

const BAR_SX: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  height: 24,
  px: 1.5,
  bgcolor: colors.headingPrimary,
  borderTop: 1,
  borderColor: colors.border,
  fontSize: 12,
  gap: 2,
};

const MESSAGE_SX: SxProps<Theme> = {
  fontSize: 12,
  color: 'common.white',
};

const READOUT_SX: SxProps<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 1.5,
  ml: 'auto',
};

const LABEL_SX: SxProps<Theme> = { fontSize: 12, color: 'common.white', opacity: 0.7 };
const VALUE_SX: SxProps<Theme> = {
  fontSize: 12,
  color: 'common.white',
  fontVariantNumeric: 'tabular-nums',
};
const CONNECTION_SX: SxProps<Theme> = {
  fontSize: 12,
  color: 'common.white',
  opacity: 0.86,
};
const MACHINE_READOUT_SX: SxProps<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  color: 'common.white',
  flexShrink: 0,
};
const MACHINE_DOT_SX: SxProps<Theme> = {
  width: 8,
  height: 8,
  borderRadius: '50%',
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
      <Box sx={{ ...MACHINE_DOT_SX, bgcolor: getMachineDotColor(connected, status) }} />
      <Typography component="span" sx={VALUE_SX}>
        {`Machine: ${connected ? 'Connected' : 'Disconnected'}`}
      </Typography>
      <Typography component="span" sx={VALUE_SX}>
        {`COM: ${port}`}
      </Typography>
      <Typography component="span" sx={VALUE_SX}>
        {`Status: ${status}`}
      </Typography>
    </Box>
  );
}
const MachineReadout = memo(MachineReadoutImpl);

function MicrometerReadoutImpl() {
  const { connected, displayText, updatedAt } = useMicrometerReading();
  const title = updatedAt ? new Date(updatedAt).toLocaleTimeString() : undefined;

  return (
    <>
      <Typography component="span" sx={LABEL_SX}>
        Micrometer:
      </Typography>
      <Typography component="span" sx={VALUE_SX} title={title}>
        {displayText}
      </Typography>
      <Typography component="span" sx={CONNECTION_SX}>
        {connected ? 'Connected' : 'Disconnected'}
      </Typography>
    </>
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
    // eslint-disable-next-line no-console
    console.log(
      `[machine-statusbar-render] machine=${machineConnected ? 'Connected' : 'Disconnected'} com=${machinePort} status=${machineStatus}`
    );
  }, [machineConnected, machinePort, machineStatus]);

  return (
    <Box component="footer" sx={BAR_SX}>
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
