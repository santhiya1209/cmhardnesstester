const path = require('path');
const { app, BrowserWindow, Menu } = require('electron');

// NODE_OPTIONS=--force-node-api-uncaught-exceptions-policy=true is set by
// scripts/dev-electron.js so throws inside native callbacks become real
// uncaughtException events instead of the silent DEP0168 warning.
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[main] uncaughtException:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[main] unhandledRejection:', reason);
});

if (app.isPackaged) {
  const dotenv = require('dotenv');
  const resources = process.resourcesPath;
  dotenv.config({ path: path.join(resources, '.env.prod') });
  dotenv.config({ path: path.join(resources, 'backend', '.env.prod') });
  dotenv.config({ path: path.join(resources, 'frontend', '.env.prod') });
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';
}

const { registerIpc } = require('./ipc');
const { cameraService } = require('./cameraService');

const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_URL || 'http://localhost:5173';

let mainWindow = null;
let backendServer = null;

async function startEmbeddedBackend() {
  const { start } = require(path.join(__dirname, '..', 'backend', 'dist', 'index.js'));
  const { server, port } = await start();
  backendServer = server;
  return `http://localhost:${port}`;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const targetUrl = isDev ? DEV_URL : await startEmbeddedBackend();
  // Vite/dev server can briefly refuse connections right after wait-on returns.
  // Retry a few times so we don't crash the renderer in the dev race window.
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await mainWindow.loadURL(targetUrl);
      break;
    } catch (err) {
      if (attempt === 8) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  cameraService.attach(mainWindow.webContents);

  mainWindow.on('closed', () => {
    cameraService.detach(mainWindow ? mainWindow.webContents : null);
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  if (backendServer) {
    backendServer.close();
    backendServer = null;
  }
  void cameraService.shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void cameraService.shutdown();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
