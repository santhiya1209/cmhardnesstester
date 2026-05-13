const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE = new Set([
  'app:getInfo',
  'app:ping',
  'camera:open',
  'camera:close',
  'camera:start-stream',
  'camera:stop-stream',
  'camera:get-frame',
  'camera:get-status',
  'camera:set-exposure',
  'camera:set-live-exposure-fps',
  'camera:set-live-mode',
  'camera:set-gain',
  'camera:get-exposure-range',
  'camera:get-gain-range',
  'camera:set-trigger-mode',
  'camera:measure-vickers-auto',
  'camera:frame-ack',
  'camera:flush-stream',
  'device:open',
  'device:close',
  'dialog:openImage',
  'dialog:saveImage',
  'micrometer:open',
  'micrometer:close',
  'micrometer:get-state',
  'micrometer:get-latest-reading',
  'machine:get-state',
  'machine:set-objective',
  'machine:set-force',
  'machine:set-lightness',
  'machine:set-load-time',
  'machine:set-hardness-level',
  'machine:start-indent',
  'machine:move-turret',
  'app:exit',
]);

const ALLOWED_EVENTS = new Set([
  'app:status',
  'camera:frame',
  'camera:status',
  'micrometer:state',
  'machine:state',
]);

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, payload) => {
    if (!ALLOWED_INVOKE.has(channel)) {
      return Promise.reject(new Error(`Blocked invoke channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on: (channel, listener) => {
    if (!ALLOWED_EVENTS.has(channel)) return () => {};
    let lastCamLogAt = 0;
    const wrapped = (_event, ...args) => {
      if (channel === 'micrometer:state') {
        // eslint-disable-next-line no-console
        console.log('[micrometer][preload-received] payload=', args[0]);
      } else if (channel === 'camera:frame') {
        const now = Date.now();
        if (now - lastCamLogAt >= 5000) {
          lastCamLogAt = now;
          const meta = args[0] || {};
          const body = args[1];
          const bytes = body && typeof body.byteLength === 'number' ? body.byteLength : 0;
          // eslint-disable-next-line no-console
          console.log(
            `[camera-preload-recv] frameId=${meta.frameId} bytes=${bytes} w=${meta.width} h=${meta.height}`
          );
        }
      }
      listener(...args);
    };
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  platform: process.platform,
});

// Hardness camera bridge — purpose-built typed surface for camera live-apply
// controls, on top of the same allowlisted IPC channels.
contextBridge.exposeInMainWorld('hardnessCamera', {
  setExposure: (valueMs) =>
    ipcRenderer.invoke('camera:set-exposure', { valueMs: Number(valueMs) }),
  setLiveExposureForFps: (targetFps) => {
    const fps = Number(targetFps);
    // eslint-disable-next-line no-console
    console.log(`[live-fps-preload-call] targetFps=${fps}`);
    return ipcRenderer.invoke('camera:set-live-exposure-fps', { targetFps: fps });
  },
  setLiveMode: (profile) => {
    // eslint-disable-next-line no-console
    console.log('[live-mode-preload-call] profile=', profile);
    return ipcRenderer.invoke('camera:set-live-mode', profile || {});
  },
  setGain: (value) =>
    ipcRenderer.invoke('camera:set-gain', { value: Number(value) }),
  getExposureRange: () => ipcRenderer.invoke('camera:get-exposure-range'),
  getGainRange: () => ipcRenderer.invoke('camera:get-gain-range'),
  openDevice: (payload) => ipcRenderer.invoke('device:open', payload || {}),
  closeDevice: () => ipcRenderer.invoke('device:close'),
});

contextBridge.exposeInMainWorld('machineControl', {
  getState: () => ipcRenderer.invoke('machine:get-state'),
  subscribeState: (listener) => {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on('machine:state', wrapped);
    void ipcRenderer
      .invoke('machine:get-state')
      .then((reply) => {
        if (reply && reply.state) listener(reply.state);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[machine-ipc] initial state failed:', err && err.message ? err.message : err);
      });
    return () => ipcRenderer.removeListener('machine:state', wrapped);
  },
  setObjective: (value) => ipcRenderer.invoke('machine:set-objective', { value }),
  setForce: (value) => ipcRenderer.invoke('machine:set-force', { value }),
  setLightness: (value) => ipcRenderer.invoke('machine:set-lightness', { value }),
  setLoadTime: (value) => ipcRenderer.invoke('machine:set-load-time', { value }),
  setHardnessLevel: (value) => ipcRenderer.invoke('machine:set-hardness-level', { value }),
  setValue: (key, value) => {
    switch (key) {
      case 'objective':
        return ipcRenderer.invoke('machine:set-objective', { value });
      case 'force':
        return ipcRenderer.invoke('machine:set-force', { value });
      case 'lightness':
        return ipcRenderer.invoke('machine:set-lightness', { value });
      case 'loadTime':
        return ipcRenderer.invoke('machine:set-load-time', { value });
      case 'hardnessLevel':
        return ipcRenderer.invoke('machine:set-hardness-level', { value });
      default:
        return Promise.reject(new Error(`Unsupported machine field: ${key}`));
    }
  },
  startIndent: () => ipcRenderer.invoke('machine:start-indent'),
  moveTurret: (direction) => ipcRenderer.invoke('machine:move-turret', { direction }),
});
