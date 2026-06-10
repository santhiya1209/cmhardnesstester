const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE = new Set([
  'app:getInfo',
  'app:ping',
  'camera:open',
  'camera:close',
  'camera:start-stream',
  'camera:stop-stream',
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
  'dialog:saveReport',
  'serial:list-ports',
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
  'machine:apply-objective-brightness',
  'machine:start-indent',
  'machine:move-turret',
  'xyz-platform:get-state',
  'xyz-platform:connect',
  'xyz-platform:disconnect',
  'xyz-platform:diagnose',
  'xyz-platform:test-line-control',
  'xyz-platform:probe',
  'xyz-platform:move-stage',
  'xyz-platform:move-step',
  'xyz-platform:stop-stage',
  'xyz-platform:move-z',
  'xyz-platform:stop-z',
  'xyz-platform:connect-z',
  'xyz-platform:disconnect-z',
  'xyz-platform:start-z-jog',
  'xyz-platform:stop-z-jog',
  'xyz-platform:poll-z-status',
  'xyz-platform:probe-z',
  'xyz-platform:diagnose-stop-z',
  'xyz-platform:diagnose-z',
  'xyz-platform:lock-z',
  'xyz-platform:unlock-z',
  'xyz-platform:lock-xy',
  'xyz-platform:unlock-xy',
  'xyz-platform:set-focus-mode',
  'xyz-platform:set-xy-speed',
  'xyz-platform:set-z-speed',
  'xyz-platform:get-position',
  'xyz-platform:move-center',
  'xyz-platform:locate-center',
  'xyz-platform:set-center',
  'xyz-platform:home',
  'xyz-platform:get-z-settings',
  'xyz-platform:save-z-settings',
  'xyz-platform:preview-z-settings',
  'xyz-platform:revert-z-settings',
  'app:exit',
]);

const ALLOWED_EVENTS = new Set([
  'app:status',
  'camera:frame',
  'camera:status',
  'micrometer:state',
  'machine:state',
  'xyz-platform:state',
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
    return ipcRenderer.invoke('camera:set-live-exposure-fps', { targetFps: fps });
  },
  setLiveMode: (profile) => {
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
        console.error('[machine-ipc] initial state failed:', err && err.message ? err.message : err);
      });
    return () => ipcRenderer.removeListener('machine:state', wrapped);
  },
  setObjective: (value) => ipcRenderer.invoke('machine:set-objective', { value }),
  setForce: (value) => ipcRenderer.invoke('machine:set-force', { value }),
  setLightness: (value) => ipcRenderer.invoke('machine:set-lightness', { value }),
  setLoadTime: (value) => ipcRenderer.invoke('machine:set-load-time', { value }),
  setHardnessLevel: (value) => ipcRenderer.invoke('machine:set-hardness-level', { value }),
  applyObjectiveBrightness: (objective) =>
    ipcRenderer.invoke('machine:apply-objective-brightness', { objective }),
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

// XYZ motion-stage bridge — purpose-built typed surface for live stage
// actuation. Hardware-only: UI-state persistence stays on the HTTP CRUD layer.
contextBridge.exposeInMainWorld('xyzPlatform', {
  getState: () => ipcRenderer.invoke('xyz-platform:get-state'),
  subscribeState: (listener) => {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on('xyz-platform:state', wrapped);
    void ipcRenderer
      .invoke('xyz-platform:get-state')
      .then((reply) => {
        if (reply && reply.state) listener(reply.state);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[xyz-ipc] initial state failed:', err && err.message ? err.message : err);
      });
    return () => ipcRenderer.removeListener('xyz-platform:state', wrapped);
  },
  connect: (opts) => ipcRenderer.invoke('xyz-platform:connect', opts || {}),
  disconnect: () => ipcRenderer.invoke('xyz-platform:disconnect'),
  diagnose: () => ipcRenderer.invoke('xyz-platform:diagnose'),
  // RTS/DTR line-control diagnostic — sweeps the four combos sending safe #10!.
  testLineControl: () => ipcRenderer.invoke('xyz-platform:test-line-control'),
  // Expert dev-console probe. WARNING: a moving command WILL move the stage.
  probe: (commandText, options) =>
    ipcRenderer.invoke('xyz-platform:probe', { commandText, options: options || {} }),
  moveStage: (direction) =>
    ipcRenderer.invoke('xyz-platform:move-stage', { direction }),
  moveStep: (direction) =>
    ipcRenderer.invoke('xyz-platform:move-step', { direction }),
  stopStage: () => ipcRenderer.invoke('xyz-platform:stop-stage'),
  moveZ: (direction, speed) => ipcRenderer.invoke('xyz-platform:move-z', { direction, speed }),
  stopZ: () => ipcRenderer.invoke('xyz-platform:stop-z'),
  connectZ: (opts) => ipcRenderer.invoke('xyz-platform:connect-z', opts || {}),
  disconnectZ: () => ipcRenderer.invoke('xyz-platform:disconnect-z'),
  startZJog: (direction) => ipcRenderer.invoke('xyz-platform:start-z-jog', { direction }),
  stopZJog: () => ipcRenderer.invoke('xyz-platform:stop-z-jog'),
  pollZStatus: () => ipcRenderer.invoke('xyz-platform:poll-z-status'),
  // Manual Z probe (dev console). probeZ('LK') → sends #LK#; probeZ('+Z 15') → #+Z 15#.
  probeZ: (payload) => ipcRenderer.invoke('xyz-platform:probe-z', { payload }),
  // Diagnostic: probe candidate stop payloads to find the real stop command.
  diagnoseStopZ: () => ipcRenderer.invoke('xyz-platform:diagnose-stop-z'),
  diagnoseZ: (options) => ipcRenderer.invoke('xyz-platform:diagnose-z', options || {}),
  lockZ: () => ipcRenderer.invoke('xyz-platform:lock-z'),
  unlockZ: () => ipcRenderer.invoke('xyz-platform:unlock-z'),
  lockXy: () => ipcRenderer.invoke('xyz-platform:lock-xy'),
  unlockXy: () => ipcRenderer.invoke('xyz-platform:unlock-xy'),
  setFocusMode: (mode) => ipcRenderer.invoke('xyz-platform:set-focus-mode', { mode }),
  setXySpeed: (speed) => ipcRenderer.invoke('xyz-platform:set-xy-speed', { speed }),
  setZSpeed: (speed) => ipcRenderer.invoke('xyz-platform:set-z-speed', { speed }),
  getPosition: () => ipcRenderer.invoke('xyz-platform:get-position'),
  moveToCenter: () => ipcRenderer.invoke('xyz-platform:move-center'),
  locateCenter: () => ipcRenderer.invoke('xyz-platform:locate-center'),
  setCenter: () => ipcRenderer.invoke('xyz-platform:set-center'),
  home: () => ipcRenderer.invoke('xyz-platform:home'),
  // Z Axis settings — backend-owned config singleton. Read/save/preview/revert
  // only; no Z hardware movement is involved.
  getZSettings: () => ipcRenderer.invoke('xyz-platform:get-z-settings'),
  saveZSettings: (settings) => ipcRenderer.invoke('xyz-platform:save-z-settings', settings || {}),
  previewZSettings: (imageSelection) =>
    ipcRenderer.invoke('xyz-platform:preview-z-settings', { imageSelection }),
  revertZSettings: () => ipcRenderer.invoke('xyz-platform:revert-z-settings'),
});
