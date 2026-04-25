import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import AutoMeasureSettingsDialog from '@/component/own/AutoMeasureSettingsDialog';
import CalibrationSettingsDialog from '@/component/own/CalibrationSettingsDialog';
import MenuBar from '@/component/own/MenuBar';
import Toolbar from '@/component/own/Toolbar';
import LeftPanel from '@/component/own/LeftPanel';
import RightPanel from '@/component/own/RightPanel';
import StatusBar from '@/component/own/StatusBar';
import TestRecordsDialog from '@/component/own/TestRecordsDialog';
import { useSaveToolbarState } from '@/hooks/mutations/useSaveToolbarState';
import { useMeasurements } from '@/hooks/queries/useMeasurements';
import { useToolbarState } from '@/hooks/queries/useToolbarState';

const ROOT_SX: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100%',
  overflow: 'hidden',
};

// Workspace = two side-by-side panels:
//   [ LeftPanel ] [ RightPanel ]
const WORKSPACE_SX: SxProps<Theme> = {
  flex: 1,
  display: 'flex',
  flexDirection: 'row',
  minHeight: 0,
  minWidth: 0,
};

type DialogKey = 'autoMeasure' | 'calibration' | 'testRecords' | null;

function App() {
  const [activeDialog, setActiveDialog] = useState<DialogKey>(null);
  const [statusMessage, setStatusMessage] = useState('System Status: Ready');
  const [initialTestRecordMeasurementIds, setInitialTestRecordMeasurementIds] = useState<string[]>([]);
  const {
    data: measurements,
    error: measurementsError,
    loading: measurementsLoading,
    refetch: refetchMeasurements,
  } = useMeasurements();
  const {
    data: toolbarState,
    error: toolbarStateError,
    loading: toolbarStateLoading,
    refetch: refetchToolbarState,
  } = useToolbarState();
  const { saveToolbarState } = useSaveToolbarState();
  const restoredToolbarActionRef = useRef(false);

  const testRecordMeasurementIds = useMemo(() => {
    if (initialTestRecordMeasurementIds.length > 0) {
      return initialTestRecordMeasurementIds;
    }

    return measurements.map((measurement) => measurement.id);
  }, [initialTestRecordMeasurementIds, measurements]);

  const closeDialog = useCallback(() => {
    setActiveDialog(null);
    setInitialTestRecordMeasurementIds([]);
  }, []);

  const handleMenuSelect = useCallback((action: string) => {
    switch (action) {
      case 'config:autoMeasure':
        setActiveDialog('autoMeasure');
        setStatusMessage('System Status: Auto Measure Setting opened');
        return;
      case 'config:calibration':
        setActiveDialog('calibration');
        setStatusMessage('System Status: Calibration opened');
        return;
      case 'data:sampleInfo':
        setInitialTestRecordMeasurementIds([]);
        setActiveDialog('testRecords');
        setStatusMessage('System Status: Test Records opened');
        return;
      default:
        setStatusMessage(`System Status: ${action}`);
    }
  }, []);

  const handleToolbarSelect = useCallback(
    (action: string) => {
      setStatusMessage(`System Status: ${action}`);
      void (async () => {
        try {
          await saveToolbarState({
            id: toolbarState?.id,
            values: { lastAction: action },
          });
          await refetchToolbarState();
        } catch {
          // error surfaces via useSaveToolbarState's own error state
        }
      })();
    },
    [refetchToolbarState, saveToolbarState, toolbarState?.id]
  );

  useEffect(() => {
    if (toolbarStateLoading || restoredToolbarActionRef.current) {
      return;
    }

    restoredToolbarActionRef.current = true;

    if (toolbarStateError) {
      setStatusMessage(`System Status: ${toolbarStateError}`);
      return;
    }

    if (toolbarState) {
      setStatusMessage(`System Status: Last toolbar action: ${toolbarState.lastAction}`);
    }
  }, [toolbarState, toolbarStateError, toolbarStateLoading]);

  const handleOpenTestRecords = useCallback((measurementIds: string[]) => {
    setInitialTestRecordMeasurementIds(measurementIds);
    setActiveDialog('testRecords');
    setStatusMessage('System Status: Test Records opened');
  }, []);

  return (
    <Box sx={ROOT_SX}>
      <MenuBar onSelect={handleMenuSelect} />
      <Toolbar onSelect={handleToolbarSelect} />

      <Box sx={WORKSPACE_SX}>
        <LeftPanel />
        <RightPanel
          measurements={measurements}
          measurementsError={measurementsError}
          measurementsLoading={measurementsLoading}
          refetchMeasurements={refetchMeasurements}
          onOpenTestRecords={handleOpenTestRecords}
        />
      </Box>

      <StatusBar message={statusMessage} />

      <AutoMeasureSettingsDialog
        open={activeDialog === 'autoMeasure'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
      <CalibrationSettingsDialog
        open={activeDialog === 'calibration'}
        onClose={closeDialog}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
      <TestRecordsDialog
        open={activeDialog === 'testRecords'}
        onClose={closeDialog}
        measurements={measurements}
        initialMeasurementIds={testRecordMeasurementIds}
        onStatusChange={(message) => setStatusMessage(`System Status: ${message}`)}
      />
    </Box>
  );
}

export default App;
