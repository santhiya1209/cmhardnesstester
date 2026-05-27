const path = require('path');
const fs = require('fs/promises');
const { TextDecoder } = require('node:util');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { cameraService } = require('./cameraService');
const { micrometerService } = require('./micrometerService');

// Resolve SerialPort lazily so the rest of the IPC layer still works even if
// the native module isn't rebuilt for the current Electron ABI yet. The list
// endpoint will return an empty array + a clear error message in that case
// instead of crashing the renderer.
function loadSerialPortClass() {
  try {
    const mod = require('serialport');
    return mod && mod.SerialPort ? mod.SerialPort : null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[serial-ports-list] serialport require failed:', err && err.message);
    return null;
  }
}

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff'] },
  { name: 'All Files', extensions: ['*'] },
];

const REPORT_FILTERS_BY_EXT = {
  docx: [
    { name: 'Word Document', extensions: ['docx'] },
    { name: 'All Files', extensions: ['*'] },
  ],
  pdf: [
    { name: 'PDF Document', extensions: ['pdf'] },
    { name: 'All Files', extensions: ['*'] },
  ],
  xlsx: [
    { name: 'Excel Workbook', extensions: ['xlsx'] },
    { name: 'All Files', extensions: ['*'] },
  ],
  csv: [
    { name: 'CSV', extensions: ['csv'] },
    { name: 'All Files', extensions: ['*'] },
  ],
};

function reportFiltersFor(defaultName) {
  const ext = String(defaultName || '').split('.').pop().toLowerCase();
  return REPORT_FILTERS_BY_EXT[ext] ?? [{ name: 'All Files', extensions: ['*'] }];
}

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
        console.log('[machine-ipc] event bridge started');
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
        console.error('[machine-ipc] event bridge error:', message);
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
    // eslint-disable-next-line no-console
    console.log('[camera-ipc][open] index=' + index);
    return cameraService.open({ index });
  });
  ipcMain.handle('camera:close', () => {
    // eslint-disable-next-line no-console
    console.log('[camera-ipc][close]');
    return cameraService.close();
  });
  ipcMain.handle('camera:start-stream', () => {
    // eslint-disable-next-line no-console
    console.log('[camera-ipc][start-stream]');
    return cameraService.startStream();
  });
  ipcMain.handle('camera:stop-stream', () => cameraService.stopStream());
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
    console.log('[camera-ipc][settings] exposure ms=' + ms);
    return cameraService.setExposure(ms);
  });

  // Dedicated channel for the "Live N FPS" UI action. Bypasses the
  // dialog's slider throttle/dedupe (which silently skipped earlier
  // clicks) and logs at every layer so the wiring is traceable end-to-end.
  ipcMain.handle('camera:set-live-mode', async (_e, payload) => {
    return cameraService.setLiveMode(payload || {});
  });

  ipcMain.handle('camera:set-live-exposure-fps', async (_e, payload) => {
    const targetFps = Number(payload && payload.targetFps);
    if (!Number.isFinite(targetFps) || targetFps <= 0) {
      return { ok: false, error: 'BAD_ARGS', message: `targetFps must be > 0 (got ${targetFps})` };
    }
    const exposureMs = 1000 / targetFps;
    return cameraService.setExposure(exposureMs);
  });
  ipcMain.handle('camera:set-gain', (_e, payload) => {
    const v = num(payload && payload.value, 0);
    // eslint-disable-next-line no-console
    console.log('[camera-ipc][settings] gain=' + v);
    return cameraService.setGain(v);
  });
  ipcMain.handle('camera:get-exposure-range', () => {
    return cameraService.getExposureRange();
  });
  ipcMain.handle('camera:get-gain-range', () => {
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
    return cameraService.measureVickersAuto(safePayload);
  });

  /* ------------------ serial port enumeration ------------------ */
  // Lists the operating system's currently-available serial ports so the
  // Configuration dialogs can populate Machine / Micrometer dropdowns from
  // real hardware instead of hardcoded COM numbers.
  ipcMain.handle('serial:list-ports', async () => {
    const SerialPort = loadSerialPortClass();
    if (!SerialPort || typeof SerialPort.list !== 'function') {
      return { ok: false, ports: [], error: 'serialport-unavailable' };
    }
    try {
      const raw = await SerialPort.list();
      const ports = Array.isArray(raw)
        ? raw.map((entry) => ({
            path: typeof entry.path === 'string' ? entry.path : '',
            manufacturer: typeof entry.manufacturer === 'string' ? entry.manufacturer : null,
            serialNumber: typeof entry.serialNumber === 'string' ? entry.serialNumber : null,
            pnpId: typeof entry.pnpId === 'string' ? entry.pnpId : null,
            friendlyName:
              typeof entry.friendlyName === 'string'
                ? entry.friendlyName
                : typeof entry.locationId === 'string'
                  ? entry.locationId
                  : null,
            vendorId: typeof entry.vendorId === 'string' ? entry.vendorId : null,
            productId: typeof entry.productId === 'string' ? entry.productId : null,
          }))
        : [];
      return { ok: true, ports };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[serial-ports-list] error: ${message}`);
      return { ok: false, ports: [], error: message };
    }
  });

  /* ------------------ micrometer channels ------------------ */
  ipcMain.handle('micrometer:open', async (_e, payload) => {
    const portName =
      payload && typeof payload.port === 'string' && payload.port.trim().length > 0
        ? payload.port.trim()
        : null;
    if (!portName) {
      return {
        ok: false,
        error: 'NO_PORT_SELECTED',
        message: 'Select micrometer COM port first',
      };
    }
    return micrometerService.open(portName);
  });
  ipcMain.handle('micrometer:close', async () => {
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
    return machineBackendRequest('/api/machine/state');
  });

  const setMachineValue = (key) => async (_e, payload) => {
    startMachineEventBridge();
    const value = validateMachineValuePayload(payload);
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
    return machineBackendRequest('/api/machine/indent', { method: 'POST', body: {} });
  });

  ipcMain.handle('machine:move-turret', async (_e, payload) => {
    startMachineEventBridge();
    const direction = validateTurretPayload(payload);
    return machineBackendRequest('/api/machine/turret', {
      method: 'POST',
      body: { direction },
    });
  });

  /* ------------------ device channels ------------------ */
  // "Open Device" — opens camera, starts stream, and (if the renderer
  // supplied a micrometer port) opens the micrometer serial port. There is no
  // default port: the operator picks one in the Micrometer dialog.
  ipcMain.handle('device:open', async (_e, payload) => {
    const index = payload && Number.isFinite(Number(payload.index)) ? Number(payload.index) : 0;
    // eslint-disable-next-line no-console
    console.log('[ipc] device:open index=', index);

    const camOpen = await cameraService.open({ index });
    if (!camOpen.ok) {
      return {
        ok: true,
        camera: { connected: false, streaming: false, error: camOpen.error, message: camOpen.message },
      };
    }
    const camStream = await cameraService.startStream();

    // Best-effort: open the micrometer ONLY if the renderer explicitly passed
    // a port. No hardcoded fallback — if the operator hasn't selected one,
    // the device stays closed and depth entry remains manual.
    const micPortName =
      payload && typeof payload.micrometerPort === 'string' && payload.micrometerPort.trim().length > 0
        ? payload.micrometerPort.trim()
        : null;
    let micrometer;
    if (!micPortName) {
      micrometer = undefined;
    } else {
      try {
        const micResult = await micrometerService.open(micPortName);
        micrometer = {
          connected: !!micResult.ok,
          port: micPortName,
          error: micResult.ok ? undefined : micResult.error,
          message: micResult.ok ? undefined : micResult.message,
        };
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error('[device:open] micrometer threw:', msg);
        micrometer = { connected: false, port: micPortName, error: 'OPEN_THREW', message: msg };
      }
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
    // Camera-only teardown. The micrometer (and machine) are independent
    // serial devices and must remain connected across a camera close — they
    // are only torn down via their own explicit disconnect channels or at
    // app shutdown.
    await cameraService.stopStream().catch(() => {});
    const cam = await cameraService.close();
    return { ok: true, camera: cam };
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

  // Save a generated report (docx/pdf/xlsx/csv) and auto-open it. The renderer
  // hands us the bytes + a default filename; we prompt for a path, write the
  // file, then shell.openPath the result so MS Word (or the OS default) picks
  // it up immediately. The renderer's old <a download> path doesn't expose
  // the saved file path, which is why we round-trip through main here.
  ipcMain.handle('dialog:saveReport', async (event, payload) => {
    const win = ownerWindow(event);
    const defaultName =
      payload && typeof payload.defaultName === 'string' && payload.defaultName.trim().length > 0
        ? payload.defaultName
        : `report-${Date.now()}.docx`;
    const bytes = payload && payload.bytes;
    if (!(bytes instanceof Uint8Array) && !Buffer.isBuffer(bytes) && !(bytes instanceof ArrayBuffer)) {
      // eslint-disable-next-line no-console
      console.error('[report-save] invalid payload: missing bytes');
      return { ok: false, canceled: false, error: 'invalid-payload' };
    }
    const buffer = Buffer.isBuffer(bytes)
      ? bytes
      : bytes instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(bytes))
        : Buffer.from(bytes);
    const autoOpen = payload && payload.autoOpen !== false;
    const filters = reportFiltersFor(defaultName);
    const opts = { title: 'Save Report', defaultPath: defaultName, filters };

    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts);

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    try {
      await fs.writeFile(result.filePath, buffer);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[report-save-failed] path=${result.filePath} error=${message}`);
      return {
        ok: false,
        canceled: false,
        filePath: result.filePath,
        error: 'write-failed',
        message,
      };
    }

    let opened = false;
    let openError = null;
    if (autoOpen) {
      try {
        // openPath returns '' on success or an error string. Falls back to the
        // OS default handler for the extension, so .docx hits Word (or
        // LibreOffice / Pages / whatever the user has registered).
        const openMessage = await shell.openPath(result.filePath);
        if (openMessage) {
          openError = openMessage;
          // eslint-disable-next-line no-console
          console.error(`[report-auto-open-failed] path=${result.filePath} error=${openMessage}`);
        } else {
          opened = true;
        }
      } catch (err) {
        openError = err && err.message ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(`[report-auto-open-failed] path=${result.filePath} error=${openError}`);
      }
    }

    return {
      ok: true,
      canceled: false,
      filePath: result.filePath,
      fileName: path.basename(result.filePath),
      opened,
      openError,
    };
  });
}

module.exports = { registerIpc };
