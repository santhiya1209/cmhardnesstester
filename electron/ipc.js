const { app, ipcMain } = require('electron');
const { cameraService } = require('./cameraService');

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function registerIpc() {
  ipcMain.handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    env: process.env.NODE_ENV,
  }));

  ipcMain.handle('app:ping', (_event, payload) => ({
    pong: true,
    received: payload ?? null,
    at: Date.now(),
  }));

  /* ------------------ camera channels ------------------ */
  ipcMain.handle('camera:open', (_e, payload) => {
    const index = payload && Number.isFinite(Number(payload.index)) ? Number(payload.index) : 0;
    return cameraService.open({ index });
  });
  ipcMain.handle('camera:close', () => cameraService.close());
  ipcMain.handle('camera:start-stream', () => cameraService.startStream());
  ipcMain.handle('camera:stop-stream', () => cameraService.stopStream());
  ipcMain.handle('camera:get-frame', (_e, payload) =>
    cameraService.getFrame(num(payload && payload.timeoutMs, 4000))
  );
  ipcMain.handle('camera:get-status', () => cameraService.getStatus());
  ipcMain.handle('camera:set-exposure', (_e, payload) =>
    cameraService.setExposure(num(payload && payload.valueUs, 0))
  );
  ipcMain.handle('camera:set-gain', (_e, payload) =>
    cameraService.setGain(num(payload && payload.value, 0))
  );
  ipcMain.handle('camera:set-trigger-mode', (_e, payload) =>
    cameraService.setTriggerMode(!!(payload && payload.value))
  );
}

module.exports = { registerIpc };
