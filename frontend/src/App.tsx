import { useCallback } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import MenuBar from '@/component/own/MenuBar';
import Toolbar from '@/component/own/Toolbar';
import LeftPanel from '@/component/own/LeftPanel';
import RightPanel from '@/component/own/RightPanel';
import StatusBar from '@/component/own/StatusBar';

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

function App() {
  const handleMenuSelect = useCallback((action: string) => {
    console.log('[action]', action);
  }, []);

  return (
    <Box sx={ROOT_SX}>
      <MenuBar onSelect={handleMenuSelect} />
      <Toolbar onSelect={handleMenuSelect} />

      <Box sx={WORKSPACE_SX}>
        <LeftPanel />
        <RightPanel />
      </Box>

      <StatusBar message="System Status: Failed To Load Hardness Tester" />
    </Box>
  );
}

export default App;
