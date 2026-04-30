const path = require('path');
const fs = require('fs/promises');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { cameraService } = require('./cameraService');
const { micrometerService } = require('./micrometerService');

const DEFAULT_MICROMETER_PORT = process.env.MICROMETER_PORT || 'COM3';

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff'] },
  { name: 'All Files', extensions: ['*'] },
];

function ownerWindow(event) {
  return BrowserWindow.fromWebContents(event.sender) ?? null;
}

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

  ipcMain.handle('app:exit', () => {
    // Defer one tick so the IPC reply is delivered before the window goes away.
    setImmediate(() => app.quit());
    return { ok: true };
  });

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
  ipcMain.handle('camera:set-exposure', (_e, payload) => {
    // Accept canonical valueMs; fall back to legacy valueUs (microseconds → ms).
    let ms = 0;
    if (payload && Number.isFinite(Number(payload.valueMs))) {
      ms = Number(payload.valueMs);
    } else if (payload && Number.isFinite(Number(payload.valueUs))) {
      ms = Number(payload.valueUs) / 1000;
    }
    // eslint-disable-next-line no-console
    console.log('[ipc] camera:set-exposure payload=', payload, '→ ms=', ms);
    return cameraService.setExposure(ms);
  });
  ipcMain.handle('camera:set-gain', (_e, payload) => {
    const v = num(payload && payload.value, 0);
    // eslint-disable-next-line no-console
    console.log('[ipc] camera:set-gain payload=', payload, '→ value=', v);
    return cameraService.setGain(v);
  });
  ipcMain.handle('camera:get-exposure-range', () => {
    // eslint-disable-next-line no-console
    console.log('[ipc] camera:get-exposure-range');
    return cameraService.getExposureRange();
  });
  ipcMain.handle('camera:get-gain-range', () => {
    // eslint-disable-next-line no-console
    console.log('[ipc] camera:get-gain-range');
    return cameraService.getGainRange();
  });
  ipcMain.handle('camera:set-trigger-mode', (_e, payload) =>
    cameraService.setTriggerMode(!!(payload && payload.value))
  );

  /* ------------------ micrometer channels ------------------ */
  ipcMain.handle('micrometer:open', async (_e, payload) => {
    const portName =
      payload && typeof payload.port === 'string' && payload.port.trim().length > 0
        ? payload.port.trim()
        : DEFAULT_MICROMETER_PORT;
    // eslint-disable-next-line no-console
    console.log('[ipc] micrometer:open port=', portName);
    return micrometerService.open(portName);
  });
  ipcMain.handle('micrometer:close', async () => {
    // eslint-disable-next-line no-console
    console.log('[ipc] micrometer:close');
    return micrometerService.close();
  });
  ipcMain.handle('micrometer:get-state', () => ({
    ok: true,
    state: micrometerService.getState(),
  }));

  /* ------------------ device channels ------------------ */
  // "Open Device" — opens camera, starts stream, and opens the micrometer
  // serial port (default COM3). The micrometer port is opened ONLY here, never
  // on app startup.
  ipcMain.handle('device:open', async (_e, payload) => {
    const index = payload && Number.isFinite(Number(payload.index)) ? Number(payload.index) : 0;
    // eslint-disable-next-line no-console
    console.log('[ipc] device:open index=', index);

    const camOpen = await cameraService.open({ index });
    // eslint-disable-next-line no-console
    console.log('[ipc] device:open camera→open ok=', camOpen.ok);
    if (!camOpen.ok) {
      return {
        ok: true,
        camera: { connected: false, streaming: false, error: camOpen.error, message: camOpen.message },
      };
    }
    const camStream = await cameraService.startStream();
    // eslint-disable-next-line no-console
    console.log('[ipc] device:open camera→start-stream ok=', camStream.ok);

    // Best-effort: open micrometer COM3 as part of the same Open Device action.
    // A failure here MUST NOT break the camera flow — surface as { connected:false, error }.
    let micrometer;
    try {
      const micPortName =
        payload && typeof payload.micrometerPort === 'string' && payload.micrometerPort.trim().length > 0
          ? payload.micrometerPort.trim()
          : DEFAULT_MICROMETER_PORT;
      const micResult = await micrometerService.open(micPortName);
      // eslint-disable-next-line no-console
      console.log('[ipc] device:open micrometer→open ok=', !!micResult.ok, 'port=', micPortName);
      micrometer = {
        connected: !!micResult.ok,
        port: micPortName,
        error: micResult.ok ? undefined : micResult.error,
        message: micResult.ok ? undefined : micResult.message,
      };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn('[ipc] device:open micrometer threw:', msg);
      micrometer = { connected: false, port: DEFAULT_MICROMETER_PORT, error: 'OPEN_THREW', message: msg };
    }

    return {
      ok: true,
      camera: {
        connected: true,
        streaming: !!camStream.ok,
        error: camStream.ok ? undefined : camStream.error,
        message: camStream.ok ? undefined : camStream.message,
      },
      micrometer,
    };
  });

  ipcMain.handle('device:close', async () => {
    // eslint-disable-next-line no-console
    console.log('[ipc] device:close');
    await cameraService.stopStream().catch(() => {});
    const cam = await cameraService.close();
    const mic = await micrometerService.close().catch((err) => ({
      ok: false,
      error: 'CLOSE_THREW',
      message: err && err.message ? err.message : String(err),
    }));
    return { ok: true, camera: cam, micrometer: mic };
  });

  /* ------------------ dialog channels ------------------ */
  ipcMain.handle('dialog:openImage', async (event) => {
    const win = ownerWindow(event);
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: 'Open Image',
          properties: ['openFile'],
          filters: IMAGE_FILTERS,
        })
      : await dialog.showOpenDialog({
          title: 'Open Image',
          properties: ['openFile'],
          filters: IMAGE_FILTERS,
        });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    const filePath = result.filePaths[0];
    try {
      const data = await fs.readFile(filePath);
      return {
        ok: true,
        canceled: false,
        filePath,
        fileName: path.basename(filePath),
        size: data.byteLength,
        // Send as a transferable ArrayBuffer slice for the renderer.
        buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      };
    } catch (err) {
      return {
        ok: false,
        canceled: false,
        error: 'read-failed',
        message: err && err.message ? err.message : String(err),
      };
    }
  });

  ipcMain.handle('dialog:saveImage', async (event, payload) => {
    const win = ownerWindow(event);
    const defaultName =
      payload && typeof payload.defaultName === 'string' && payload.defaultName.trim().length > 0
        ? payload.defaultName
        : `image-${Date.now()}.png`;

    const result = win
      ? await dialog.showSaveDialog(win, {
          title: 'Save Image',
          defaultPath: defaultName,
          filters: IMAGE_FILTERS,
        })
      : await dialog.showSaveDialog({
          title: 'Save Image',
          defaultPath: defaultName,
          filters: IMAGE_FILTERS,
        });

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }
    return {
      ok: true,
      canceled: false,
      filePath: result.filePath,
      fileName: path.basename(result.filePath),
    };
  });
}

module.exports = { registerIpc };
