const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu } = require('electron');

const APP_TITLE = 'Vickers Measurement Software';
// Resolve the app icon. In dev we look under <repo>/build/icon.ico; in the
// packaged app we look next to the executable and in resources. If none of
// the candidates exist, Electron falls back to its default icon — the title
// still gets set either way.
function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(process.resourcesPath || '', 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.png'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

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

// Live camera streaming continuously repaints a full-resolution <canvas> in
// the renderer. Chromium's disk-resident caches grow on this workload and
// were eating C: drive space (Cache/, GPUCache/, Code Cache/ under
// %APPDATA%\Vickers Measurement Software\). This app loads only local files
// from the packaged bundle, so the HTTP cache provides no benefit — we cap
// it tight and disable the GPU shader disk cache outright. Shader compiles
// stay in process memory and are released on quit.
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disk-cache-size', '0');
app.commandLine.appendSwitch('media-cache-size', '0');
// V8 Code Cache (bytecode) writes to `Code Cache/` and isn't covered by the
// flags above. On a long camera session the worker's hot decode paths keep
// re-warming the cache; cap it to zero like the others.
app.commandLine.appendSwitch('v8-cache-options', 'none');

const { registerIpc } = require('./ipc');
const { cameraService } = require('./cameraService');
const { micrometerService } = require('./micrometerService');

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
  const iconPath = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: APP_TITLE,
    icon: iconPath ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Some Windows builds ignore the constructor `title` once the renderer
  // sets <title>; force it again so the title bar / taskbar match the brand.
  mainWindow.setTitle(APP_TITLE);

  // Hide the native Electron menu bar (File / Edit / View / Window / Help).
  // The app's own blue toolbar/menu (rendered in the renderer) stays visible.
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);

  const targetUrl = isDev ? DEV_URL : await startEmbeddedBackend();
  if (!isDev) {
    process.env.MACHINE_BACKEND_URL = targetUrl;
  }
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
  micrometerService.attach(mainWindow.webContents);

  // Re-attach on every page load (Vite full reload, Ctrl+R, in-app navigation)
  // so micrometer:state/camera:* events keep flowing after the renderer is
  // re-created. Without this, the service's `destroyed` listener nulls
  // webContents and _emit silently no-ops for the rest of the session.
  mainWindow.webContents.on('did-finish-load', () => {
    cameraService.attach(mainWindow.webContents);
    micrometerService.attach(mainWindow.webContents);
  });

  const wcRef = mainWindow.webContents;
  mainWindow.on('closed', () => {
    try { cameraService.detach(wcRef); } catch { /* ignore */ }
    try { micrometerService.detach(wcRef); } catch { /* ignore */ }
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Menu.setApplicationMenu(null);
  // Brand the Windows taskbar group so pinning/launch shows the productName
  // and our icon instead of the bare electron.exe label.
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.chennaimetco.vickersmeasurementsoftware');
  }
  app.setName('Vickers Measurement Software');
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  if (backendServer) {
    backendServer.close();
    backendServer = null;
  }
  void cameraService.shutdown();
  void micrometerService.shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void cameraService.shutdown();
  void micrometerService.shutdown();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
