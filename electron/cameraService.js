/*
 * cameraService.js
 *
 * Loads the native hardness_addon (DVP2 N-API addon) and exposes a thin
 * Promise-based surface that the IPC layer calls into. Forwards the addon's
 * frame/status callbacks to the renderer via webContents.send.
 *
 * Design notes:
 *  - Renderer NEVER `require()`s the addon. Only this file does.
 *  - On addon load failure (missing .node, missing DLL, missing entry
 *    points) every method resolves `{ok:false, error, message}`. No mocks.
 *  - Frame events arrive as a Node Buffer/Uint8Array; we forward them as
 *    they are — Electron's structured-clone bridge transfers the bytes
 *    efficiently to the renderer where the worker takes ownership.
 */

const path = require('path');
const { app } = require('electron');

const ADDON_RELATIVE = path.join('build', 'Release', 'hardness_addon.node');

class CameraService {
  constructor() {
    this.webContents = null;
    this.addon = null;
    this.loadError = null;
    this.lastStatus = { sdkLoaded: false, open: false, streaming: false };
  }

  attach(webContents) {
    this.webContents = webContents;
    // Lazy-load on first attach so a missing native build doesn't crash
    // window creation.
    this._tryLoad();
  }

  detach(webContents) {
    if (this.webContents === webContents) this.webContents = null;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                           */
  /* ------------------------------------------------------------------ */

  open(payload) {
    return this._call('cameraOpen', payload || {});
  }
  close() {
    return this._call('cameraClose');
  }
  startStream() {
    return this._call('cameraStartStream');
  }
  stopStream() {
    return this._call('cameraStopStream');
  }
  getFrame(timeoutMs = 4000) {
    return this._call('cameraGetFrame', { timeoutMs });
  }
  getStatus() {
    if (!this.addon) {
      return Promise.resolve({
        ok: true,
        sdkLoaded: false,
        open: false,
        streaming: false,
        width: 0,
        height: 0,
        loadError: this.loadError ? this.loadError.message : null,
      });
    }
    try {
      return Promise.resolve(this.addon.camera.cameraGetStatus());
    } catch (err) {
      return Promise.resolve({ ok: false, error: 'STATUS_FAILED', message: err.message });
    }
  }
  setExposure(valueUs) {
    return this._call('cameraSetExposure', { valueUs });
  }
  setGain(value) {
    return this._call('cameraSetGain', { value });
  }
  setTriggerMode(value) {
    return this._call('cameraSetTriggerMode', { value: !!value });
  }

  async shutdown() {
    if (!this.addon) return;
    try {
      this.addon.camera.shutdown();
    } catch (_e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  _addonPath() {
    const isPackaged = app && app.isPackaged;
    if (isPackaged) {
      // Packaged via forge `extraResource: ['backend/native']` → resourcesPath/native
      return path.join(process.resourcesPath, 'native', 'hardness-addon', ADDON_RELATIVE);
    }
    return path.join(__dirname, '..', 'backend', 'native', 'hardness-addon', ADDON_RELATIVE);
  }

  _tryLoad() {
    if (this.addon || this.loadError) return;
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      this.addon = require(this._addonPath());
    } catch (err) {
      this.loadError = err;
      this._broadcastStatus({
        event: 'addon-missing',
        error: 'ADDON_NOT_BUILT',
        message: err.message,
      });
      return;
    }

    const dllSearchDir =
      process.env.DO3THINK_SDK_DIR || 'C:\\Program Files (x86)\\Do3think\\DVP2 x64';

    try {
      const boot = this.addon.camera.bootstrap({ dllSearchDir });
      if (!boot || !boot.ok) {
        this._broadcastStatus({
          event: 'sdk-missing',
          error: boot && boot.error ? boot.error : 'SDK_NOT_FOUND',
          message: boot && boot.message ? boot.message : 'failed to load DVPCamera64.dll',
        });
      }
    } catch (err) {
      this._broadcastStatus({
        event: 'sdk-missing',
        error: 'BOOTSTRAP_THREW',
        message: err.message,
      });
    }

    // Wire the addon's callbacks to webContents.send. These callbacks are
    // invoked from the native ThreadSafeFunction — any throw here would be
    // swallowed by N-API and surface only as DEP0168, so we hard-guard them.
    try {
      this.addon.camera.setEventCallbacks({
        onFrame: (meta, data) => {
          try {
            this._broadcastFrame(meta, data);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[cameraService] onFrame threw:', e && e.stack ? e.stack : e);
          }
        },
        onStatus: (payload) => {
          try {
            this._broadcastStatus(payload);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[cameraService] onStatus threw:', e && e.stack ? e.stack : e);
          }
        },
      });
    } catch (err) {
      // Non-fatal — single-shot getFrame still works without subscribers.
      // eslint-disable-next-line no-console
      console.warn('[cameraService] setEventCallbacks failed:', err.message);
    }
  }

  _call(method, payload) {
    this._tryLoad();
    if (!this.addon) {
      return Promise.resolve({
        ok: false,
        error: 'ADDON_NOT_BUILT',
        message: this.loadError
          ? this.loadError.message
          : 'native addon not loaded; run `npm run rebuild-addon`',
      });
    }
    try {
      const fn = this.addon.camera[method];
      if (typeof fn !== 'function') {
        return Promise.resolve({ ok: false, error: 'NO_METHOD', message: `addon.${method} missing` });
      }
      const result = payload === undefined ? fn() : fn(payload);
      return Promise.resolve(result);
    } catch (err) {
      return Promise.resolve({ ok: false, error: 'NATIVE_THREW', message: err.message });
    }
  }

  _broadcastFrame(meta, data) {
    if (!this.webContents || this.webContents.isDestroyed()) return;
    // The native addon hands us an EXTERNAL buffer (zero-copy view over the
    // SDK's pixel memory). Electron's structured-clone IPC refuses external
    // buffers ("External buffers are not allowed"), so we must hand it a
    // freshly-allocated, fully-owned Buffer. `Buffer.from(x)` is NOT enough —
    // when x is an ArrayBuffer it returns a VIEW (still external), and even
    // for Buffer→Buffer it can keep referencing the external backing store on
    // some Node versions. Allocate + .set forces a real byte copy.
    const payload = toOwnedBuffer(data);
    const safeMeta = sanitizeMeta(meta);
    try {
      this.webContents.send('camera:frame', safeMeta, payload);
    } catch (_e) {
      /* webContents went away */
    }
  }

  _broadcastStatus(payload) {
    this.lastStatus = { ...this.lastStatus, ...payload };
    if (!this.webContents || this.webContents.isDestroyed()) return;
    try {
      this.webContents.send('camera:status', payload);
    } catch (_e) {
      /* ignore */
    }
  }
}

function toOwnedBuffer(src) {
  if (src == null) return src;
  let view;
  if (Buffer.isBuffer(src) || src instanceof Uint8Array) {
    view = src;
  } else if (src instanceof ArrayBuffer) {
    view = new Uint8Array(src);
  } else if (ArrayBuffer.isView(src)) {
    view = new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  } else {
    return src;
  }
  const out = Buffer.allocUnsafe(view.byteLength);
  out.set(view);
  return out;
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = {};
  for (const k of Object.keys(meta)) {
    const v = meta[k];
    if (v && (Buffer.isBuffer(v) || v instanceof ArrayBuffer || ArrayBuffer.isView(v))) {
      out[k] = toOwnedBuffer(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const cameraService = new CameraService();
module.exports = { cameraService };
