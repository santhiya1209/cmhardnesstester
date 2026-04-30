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
  'camera:set-gain',
  'camera:get-exposure-range',
  'camera:get-gain-range',
  'camera:set-trigger-mode',
  'device:open',
  'device:close',
  'dialog:openImage',
  'dialog:saveImage',
  'micrometer:open',
  'micrometer:close',
  'micrometer:get-state',
  'micrometer:get-latest-reading',
  'app:exit',
]);

const ALLOWED_EVENTS = new Set([
  'app:status',
  'camera:frame',
  'camera:status',
  'micrometer:state',
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
    const wrapped = (_event, ...args) => {
      if (channel === 'micrometer:state') {
        // eslint-disable-next-line no-console
        console.log('[micrometer][preload-received] payload=', args[0]);
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
  setGain: (value) =>
    ipcRenderer.invoke('camera:set-gain', { value: Number(value) }),
  getExposureRange: () => ipcRenderer.invoke('camera:get-exposure-range'),
  getGainRange: () => ipcRenderer.invoke('camera:get-gain-range'),
  openDevice: (payload) => ipcRenderer.invoke('device:open', payload || {}),
  closeDevice: () => ipcRenderer.invoke('device:close'),
});
