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
  'camera:set-trigger-mode',
]);

const ALLOWED_EVENTS = new Set(['app:status', 'camera:frame', 'camera:status']);

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, payload) => {
    if (!ALLOWED_INVOKE.has(channel)) {
      return Promise.reject(new Error(`Blocked invoke channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on: (channel, listener) => {
    if (!ALLOWED_EVENTS.has(channel)) return () => {};
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  platform: process.platform,
});
