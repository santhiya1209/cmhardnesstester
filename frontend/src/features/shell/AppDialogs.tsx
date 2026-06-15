import { useCallback } from 'react';
import AutoMeasureSettingsDialog from '@/component/own/AutoMeasureSettingsDialog';
import CameraSettingDialog from '@/component/own/CameraSettingDialog';
import CrosshairSettingsDialog from '@/component/own/CrosshairSettingsDialog';
import LineColorSettingDialog from '@/component/own/LineColorSettingDialog';
import MicrometerConfigDialog from '@/component/own/MicrometerConfigDialog';
import GenericSettingDialog from '@/component/own/GenericSettingDialog';
import OtherSettingDialog from '@/component/own/OtherSettingDialog';
import RestoreFactoryDialog from '@/component/own/RestoreFactoryDialog';
import SerialPortSettingDialog from '@/component/own/SerialPortSettingDialog';
import TestRecordsDialog from '@/component/own/TestRecordsDialog';
import XYPlatformSettingsDialog from '@/component/own/XYPlatformSettingsDialog';
import ZAxisSettingsDialog from '@/component/own/ZAxisSettingsDialog';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DialogContentText from '@mui/material/DialogContentText';
import MuiButton from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { exitApp } from '@/api/system';
import type { DialogKey } from '@/contexts/DialogContext';
import type { AutoMeasureSettingsPayload } from '@/types/autoMeasureSettings';
import type { CrosshairConfig } from '@/types/crosshair';
import type { Measurement } from '@/types/measurement';

export type AppDialogsProps = {
  activeDialog: DialogKey;
  closeDialog: () => void;
  setStatusMessage: (message: string) => void;
  activeObjective: string | null;
  handleAutoMeasureSettingsPreviewChange: (settings: AutoMeasureSettingsPayload) => void;
  handleAutoMeasureSettingsSaved: (settings: AutoMeasureSettingsPayload) => void;
  refetchLineColor: () => void;
  refetchMicrometerConfig: () => void;
  refetchMeasurements: () => void;
  refetchToolbarState: () => void;
  currentMachinePort: string | null;
  applyMachinePort: (nextPort: string | null) => Promise<void>;
  exitConfirmOpen: boolean;
  setExitConfirmOpen: (next: boolean) => void;
  unavailableMsg: string | null;
  setUnavailableMsg: React.Dispatch<React.SetStateAction<string | null>>;
  calibrationRequiredMsg: string | null;
  setCalibrationRequiredMsg: React.Dispatch<React.SetStateAction<string | null>>;
  openCalibrationPanel: (source?: 'menu' | 'toolbar' | 'snackbar') => void;
  measurements: Measurement[];
  testRecordMeasurementIds: string[];
  crosshairConfig: CrosshairConfig;
  onCrosshairConfigChange: (next: Partial<CrosshairConfig>) => void;
  crossLineVisible: boolean;
  onToggleCrossLine: () => void;
};

function AppDialogs({
  activeDialog,
  closeDialog,
  setStatusMessage,
  activeObjective,
  handleAutoMeasureSettingsPreviewChange,
  handleAutoMeasureSettingsSaved,
  refetchLineColor,
  refetchMicrometerConfig,
  refetchMeasurements,
  refetchToolbarState,
  currentMachinePort,
  applyMachinePort,
  exitConfirmOpen,
  setExitConfirmOpen,
  unavailableMsg,
  setUnavailableMsg,
  calibrationRequiredMsg,
  setCalibrationRequiredMsg,
  openCalibrationPanel,
  measurements,
  testRecordMeasurementIds,
  crosshairConfig,
  onCrosshairConfigChange,
  crossLineVisible,
  onToggleCrossLine,
}: AppDialogsProps) {
  const handleDialogStatusChange = useCallback(
    (message: string) => setStatusMessage(`System Status: ${message}`),
    [setStatusMessage]
  );
  return (
    <>
      <AutoMeasureSettingsDialog
        open={activeDialog === 'autoMeasure'}
        onClose={closeDialog}
        onPreviewChange={handleAutoMeasureSettingsPreviewChange}
        onSaved={handleAutoMeasureSettingsSaved}
        onStatusChange={handleDialogStatusChange}
        activeObjective={activeObjective}
      />
      <LineColorSettingDialog
        open={activeDialog === 'lineColor'}
        onClose={closeDialog}
        onStatusChange={handleDialogStatusChange}
        onSaved={() => {
          void refetchLineColor();
        }}
      />
      <MicrometerConfigDialog
        open={activeDialog === 'micrometer'}
        onClose={closeDialog}
        onStatusChange={handleDialogStatusChange}
        onSaved={() => {
          void refetchMicrometerConfig();
        }}
      />
      <SerialPortSettingDialog
        open={activeDialog === 'serialPort'}
        onClose={closeDialog}
        onStatusChange={handleDialogStatusChange}
        currentMachinePort={currentMachinePort}
        onApplyMachinePort={applyMachinePort}
      />
      <CameraSettingDialog
        open={activeDialog === 'camera'}
        onClose={closeDialog}
        onStatusChange={handleDialogStatusChange}
      />
      <CrosshairSettingsDialog
        open={activeDialog === 'crosshair'}
        onClose={closeDialog}
        config={crosshairConfig}
        onChange={onCrosshairConfigChange}
        visible={crossLineVisible}
        onToggleVisible={onToggleCrossLine}
      />
      <GenericSettingDialog
        open={activeDialog === 'generic'}
        onClose={closeDialog}
        onStatusChange={handleDialogStatusChange}
      />
      <OtherSettingDialog
        open={activeDialog === 'other'}
        onClose={closeDialog}
        onStatusChange={handleDialogStatusChange}
      />
      <ZAxisSettingsDialog
        open={activeDialog === 'zAxis'}
        onClose={closeDialog}
        onStatusChange={handleDialogStatusChange}
      />
      <XYPlatformSettingsDialog
        open={activeDialog === 'xyPlatform'}
        onClose={closeDialog}
      />
      <RestoreFactoryDialog
        open={activeDialog === 'restoreFactory'}
        onClose={closeDialog}
        onStatusChange={handleDialogStatusChange}
        onRestored={() => {
          void refetchLineColor();
          void refetchMeasurements();
          void refetchToolbarState();
        }}
      />
      <Dialog
        open={exitConfirmOpen}
        onClose={() => setExitConfirmOpen(false)}
      >
        <DialogTitle>Exit Hardness Tester?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Any unsaved measurements will be lost. Continue?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <MuiButton onClick={() => setExitConfirmOpen(false)}>Cancel</MuiButton>
          <MuiButton
            color="error"
            variant="contained"
            onClick={() => {
              void exitApp().catch((err) => {
                setExitConfirmOpen(false);
                setUnavailableMsg(
                  `Exit failed: ${err instanceof Error ? err.message : String(err)}`
                );
              });
            }}
          >
            Exit
          </MuiButton>
        </DialogActions>
      </Dialog>

      <Dialog
        open={calibrationRequiredMsg !== null}
        onClose={() => setCalibrationRequiredMsg(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Calibration Required</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ whiteSpace: 'pre-line' }}>
            {calibrationRequiredMsg}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <MuiButton onClick={() => setCalibrationRequiredMsg(null)}>Close</MuiButton>
          <MuiButton
            variant="contained"
            onClick={() => {
              setCalibrationRequiredMsg(null);
              openCalibrationPanel('snackbar');
            }}
          >
            Open Calibration
          </MuiButton>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={unavailableMsg !== null}
        autoHideDuration={unavailableMsg?.startsWith('Calibration not found') ? null : 3000}
        onClose={() => setUnavailableMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="warning"
          variant="filled"
          onClose={() => setUnavailableMsg(null)}
          action={
            unavailableMsg?.startsWith('Calibration not found') ? (
              <MuiButton
                color="inherit"
                size="small"
                onClick={() => {
                  setUnavailableMsg(null);
                  openCalibrationPanel('snackbar');
                }}
              >
                Go to Calibration
              </MuiButton>
            ) : undefined
          }
          sx={{ width: '100%' }}
        >
          {unavailableMsg}
        </Alert>
      </Snackbar>

      <TestRecordsDialog
        open={activeDialog === 'testRecords'}
        onClose={closeDialog}
        measurements={measurements}
        initialMeasurementIds={testRecordMeasurementIds}
        onStatusChange={handleDialogStatusChange}
      />
    </>
  );
}

export default AppDialogs;
