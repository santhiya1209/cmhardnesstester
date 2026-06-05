import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from '@/theme/theme';
import { store } from '@/store';
import { StatusMessageProvider } from '@/contexts/StatusMessageContext';
import { DialogProvider } from '@/contexts/DialogContext';
import { MachineStateProvider } from '@/contexts/MachineStateContext';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <MachineStateProvider>
          <StatusMessageProvider>
            <DialogProvider>
              <App />
            </DialogProvider>
          </StatusMessageProvider>
        </MachineStateProvider>
      </ThemeProvider>
    </Provider>
  </StrictMode>
);
