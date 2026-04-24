const path = require('path');
const { app, BrowserWindow, Menu } = require('electron');

if (app.isPackaged) {
  const dotenv = require('dotenv');
  const resources = process.resourcesPath;
  dotenv.config({ path: path.join(resources, '.env.prod') });
  dotenv.config({ path: path.join(resources, 'backend', '.env.prod') });
  dotenv.config({ path: path.join(resources, 'frontend', '.env.prod') });
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';
}

const { registerIpc } = require('./ipc');

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

  if (isDev) {
    await mainWindow.loadURL(DEV_URL);
  } else {
    const url = await startEmbeddedBackend();
    await mainWindow.loadURL(url);
  }

  mainWindow.on('closed', () => {
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
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
