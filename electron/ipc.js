const path = require('path');
const fs = require('fs/promises');
const { TextDecoder } = require('node:util');
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

function optionalFiniteNumber(payload, key) {
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, key)) return undefined;
  const value = Number(payload[key]);
  return Number.isFinite(value) ? value : undefined;
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function smoothingToKernel(smoothing) {
  if (smoothing <= 0) return 1;
  const bucket = Math.min(5, Math.max(1, Math.ceil(smoothing / 4)));
  return bucket * 2 + 1;
}

function validateAutoMeasurePayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const out = {};

  // Frame metadata.
  for (const key of [
    'width', 'height', 'bits',
    'micronPerPixel', 'pxPerMm', 'testForceKgf',
    'minConfidence', 'timeoutMs', 'maxFrameAgeMs',
  ]) {
    const v = optionalFiniteNumber(source, key);
    if (v !== undefined) out[key] = v;
  }

  // Primary user-facing controls.
  const smoothing = clampInt(Number(source.smoothing), 0, 20);
  const thresholdRaw = clampInt(
    Number(source.threshold ?? source.manualThreshold),
    0,
    255
  );

  // Map → native legacy fields. Native pipeline runs:
  //   GaussianBlur(kernel=morphologyKernelSize) → THRESH_BINARY_INV @ manualThreshold.
  if (smoothing !== null) {
    out.smoothing = smoothing;
    out.morphologyKernelSize = smoothingToKernel(smoothing);
  }
  if (thresholdRaw !== null) {
    out.threshold = thresholdRaw;
    out.manualThreshold = thresholdRaw;
    out.thresholdMode = thresholdRaw > 0 ? 'manual' : 'otsu';
  }

  // Pass-through optional native tuning if a caller supplies it (debug/testing).
  for (const key of [
    'erosion', 'dilation', 'factor',
    'erosionIterations', 'dilationIterations',
    'edgeFactor', 'minContourArea', 'maxContourArea',
    'centerBias', 'sideFitRoiWidth', 'gradientStrengthFactor',
    'minAreaRatio', 'maxAreaRatio',
    'maxCenterDistanceRatio',
    'minDiagonalRatio', 'maxDiagonalRatio', 'maxSideLengthRatio',
    'angleToleranceDeg', 'minLinePoints',
  ]) {
    const v = optionalFiniteNumber(source, key);
    if (v !== undefined) out[key] = v;
  }

  if (typeof source.imageType === 'string') out.imageType = source.imageType;
  if (typeof source.objectiveForMeasure === 'string') {
    out.objectiveForMeasure = source.objectiveForMeasure;
  }
  if (typeof source.pixelFormat === 'string') out.pixelFormat = source.pixelFormat;
  if (source.source === 'uploaded-image' || source.source === 'live-camera') {
    out.source = source.source;
  }
  if (source.frameBuffer instanceof ArrayBuffer || ArrayBuffer.isView(source.frameBuffer)) {
    out.frameBuffer = source.frameBuffer;
  }
  return out;
}

function getMachineBackendUrl() {
  const url =
    process.env.MACHINE_BACKEND_URL ||
    process.env.VITE_API_PROXY_TARGET ||
    process.env.BACKEND_URL ||
    `http://localhost:${process.env.PORT || 4000}`;
  return url.replace(/\/+$/, '');
}

function validateMachineValuePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('machine value payload must be an object');
  }
  const value = payload.value;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('machine value must be a string or number');
  }
  return value;
}

function validateTurretPayload(payload) {
  const direction = payload && typeof payload.direction === 'string' ? payload.direction : '';
  if (!['left', 'front', 'right'].includes(direction)) {
    throw new Error('invalid turret direction');
  }
  return direction;
}

async function machineBackendRequest(pathname, options = {}) {
  const response = await fetch(`${getMachineBackendUrl()}${pathname}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok && data && typeof data === 'object') {
    return { ok: false, state: data.state, error: data.error, message: data.message };
  }
  return data;
}

let machineEventBridgeStarted = false;

function broadcastMachineState(state) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('machine:state', state);
    }
  }
}

function startMachineEventBridge() {
  if (machineEventBridgeStarted) return;
  machineEventBridgeStarted = true;
  const decoder = new TextDecoder();

  const loop = async () => {
    while (!app.isQuitting) {
      try {
        const response = await fetch(`${getMachineBackendUrl()}/api/machine/events`);
        if (!response.ok || !response.body) {
          throw new Error(`machine event stream failed: ${response.status}`);
        }
        // eslint-disable-next-line no-console
        console.log('[machine-ipc] event bridge connected');
        const reader = response.body.getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let marker = buffer.indexOf('\n\n');
          while (marker >= 0) {
            const block = buffer.slice(0, marker);
            buffer = buffer.slice(marker + 2);
            const dataLine = block
              .split(/\r?\n/)
              .find((line) => line.startsWith('data: '));
            if (dataLine) {
              const state = JSON.parse(dataLine.slice(6));
              broadcastMachineState(state);
            }
            marker = buffer.indexOf('\n\n');
          }
        }
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn('[machine-ipc] event bridge retry:', message);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };

  void loop();
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

  // Dedicated channel for the "Live N FPS" UI action. Bypasses the
  // dialog's slider throttle/dedupe (which silently skipped earlier
  // clicks) and logs at every layer so the wiring is traceable end-to-end.
  ipcMain.handle('camera:set-live-mode', async (_e, payload) => {
    // eslint-disable-next-line no-console
    console.log('[ipc] camera:set-live-mode payload=', payload);
    return cameraService.setLiveMode(payload || {});
  });

  ipcMain.handle('camera:set-live-exposure-fps', async (_e, payload) => {
    const targetFps = Number(payload && payload.targetFps);
    // eslint-disable-next-line no-console
    console.log(`[live-fps-ipc-main] targetFps=${targetFps}`);
    if (!Number.isFinite(targetFps) || targetFps <= 0) {
      return { ok: false, error: 'BAD_ARGS', message: `targetFps must be > 0 (got ${targetFps})` };
    }
    const exposureMs = 1000 / targetFps;
    // eslint-disable-next-line no-console
    console.log(`[live-fps-service-call] valueMs=${exposureMs.toFixed(3)}`);
    const reply = await cameraService.setExposure(exposureMs);
    // eslint-disable-next-line no-console
    console.log('[live-fps-service-reply]', reply);
    return reply;
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
  ipcMain.handle('camera:frame-ack', (_e, payload) => {
    return cameraService.ackFrame(payload && payload.frameId);
  });
  ipcMain.handle('camera:flush-stream', (_e, payload) => {
    const reason = payload && typeof payload.reason === 'string' ? payload.reason : undefined;
    return cameraService.flushStream(reason);
  });
  ipcMain.handle('camera:measure-vickers-auto', (_e, payload) => {
    const safePayload = validateAutoMeasurePayload(payload);
    if (process.env.AUTO_MEASURE_DEBUG === 'true') {
      // eslint-disable-next-line no-console
      console.log('[ipc] camera:measure-vickers-auto payload=', safePayload);
    }
    return cameraService.measureVickersAuto(safePayload);
  });

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
  ipcMain.handle('micrometer:get-latest-reading', () => ({
    ok: true,
    reading: micrometerService.getLatestReading(),
  }));

  /* ------------------ machine RS232 channels ------------------ */
  ipcMain.handle('machine:get-state', async () => {
    startMachineEventBridge();
    // eslint-disable-next-line no-console
    console.log('[machine-ipc] get-state');
    return machineBackendRequest('/api/machine/state');
  });

  const setMachineValue = (key) => async (_e, payload) => {
    startMachineEventBridge();
    const value = validateMachineValuePayload(payload);
    // eslint-disable-next-line no-console
    console.log('[machine-ipc] set', { key, value });
    return machineBackendRequest('/api/machine/set', {
      method: 'POST',
      body: { key, value },
    });
  };

  ipcMain.handle('machine:set-objective', setMachineValue('objective'));
  ipcMain.handle('machine:set-force', setMachineValue('force'));
  ipcMain.handle('machine:set-lightness', setMachineValue('lightness'));
  ipcMain.handle('machine:set-load-time', setMachineValue('loadTime'));
  ipcMain.handle('machine:set-hardness-level', setMachineValue('hardnessLevel'));

  ipcMain.handle('machine:start-indent', async () => {
    startMachineEventBridge();
    // eslint-disable-next-line no-console
    console.log('[machine-ipc] start-indent');
    return machineBackendRequest('/api/machine/indent', { method: 'POST', body: {} });
  });

  ipcMain.handle('machine:move-turret', async (_e, payload) => {
    startMachineEventBridge();
    const direction = validateTurretPayload(payload);
    // eslint-disable-next-line no-console
    console.log('[machine-ipc] move-turret', { direction });
    return machineBackendRequest('/api/machine/turret', {
      method: 'POST',
      body: { direction },
    });
  });

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
