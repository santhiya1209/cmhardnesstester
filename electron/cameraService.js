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
const fs = require('fs');
const { app } = require('electron');

const ADDON_RELATIVE = path.join('build', 'Release', 'hardness_addon.node');
const DEFAULT_OPENCV_DIR = 'C:\\Users\\SANTHIYA\\opencv\\build';

class CameraService {
  constructor() {
    this.webContents = null;
    this.addon = null;
    this.loadError = null;
    this.lastStatus = { sdkLoaded: false, open: false, streaming: false };
    this.latestFrame = null;
  }

  attach(webContents) {
    this.webContents = webContents;
    this.rendererReady = !webContents.isLoading();
    const onStartLoading = () => { this.rendererReady = false; };
    const onFinishLoad = () => { this.rendererReady = true; };
    const onGone = () => { this.rendererReady = false; this.webContents = null; };
    webContents.on('did-start-loading', onStartLoading);
    webContents.on('did-finish-load', onFinishLoad);
    webContents.on('render-process-gone', onGone);
    webContents.on('destroyed', onGone);
    // Lazy-load on first attach so a missing native build doesn't crash
    // window creation.
    this._tryLoad();
  }

  detach(webContents) {
    if (this.webContents === webContents) {
      this.webContents = null;
      this.rendererReady = false;
    }
  }

  _canSend() {
    const wc = this.webContents;
    if (!wc || wc.isDestroyed()) return false;
    if (!this.rendererReady) return false;
    try {
      if (!wc.mainFrame) return false;
    } catch { return false; }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                           */
  /* ------------------------------------------------------------------ */

  open(payload) {
    return this._call('cameraOpen', payload || {});
  }
  close() {
    return this._call('cameraClose').finally(() => {
      this.latestFrame = null;
    });
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
  setExposure(valueMs) {
    // eslint-disable-next-line no-console
    console.log('[cameraService] setExposure ms=', valueMs);
    return this._call('cameraSetExposure', { valueMs });
  }
  setGain(value) {
    // eslint-disable-next-line no-console
    console.log('[cameraService] setGain value=', value);
    return this._call('cameraSetGain', { value });
  }
  getExposureRange() {
    // eslint-disable-next-line no-console
    console.log('[cameraService] getExposureRange');
    return this._call('cameraGetExposureRange');
  }
  getGainRange() {
    // eslint-disable-next-line no-console
    console.log('[cameraService] getGainRange');
    return this._call('cameraGetGainRange');
  }
  setTriggerMode(value) {
    return this._call('cameraSetTriggerMode', { value: !!value });
  }
  async measureVickersAuto(parameters = {}) {
    this._tryLoad();
    if (!this.addon) {
      return {
        ok: false,
        source: parameters && parameters.source === 'uploaded-image' ? 'uploaded-image' : 'live-camera',
        confidence: 0,
        reason: this.loadError
          ? this.loadError.message
          : 'native addon not loaded; run `npm run rebuild-addon`',
        debug: { rejectionReason: 'ADDON_NOT_BUILT' },
      };
    }

    const fn = this.addon.camera && this.addon.camera.measureVickersAuto;
    if (typeof fn !== 'function') {
      return {
        ok: false,
        source: parameters && parameters.source === 'uploaded-image' ? 'uploaded-image' : 'live-camera',
        confidence: 0,
        reason: 'native measureVickersAuto function is missing',
        debug: { rejectionReason: 'NO_METHOD' },
      };
    }

    const frame = parameters && parameters.frameBuffer
      ? this._getProvidedFrameForAutoMeasure(parameters)
      : await this._getFrameForAutoMeasure(parameters);
    if (!frame.ok) {
      return {
        ok: false,
        source: parameters && parameters.source === 'uploaded-image' ? 'uploaded-image' : 'live-camera',
        confidence: 0,
        reason: frame.message || frame.error || 'unable to capture camera frame',
        debug: { rejectionReason: frame.error || 'FRAME_CAPTURE_FAILED' },
      };
    }

    const nativeParams = {
      ...(parameters && typeof parameters === 'object' ? parameters : {}),
      width: frame.meta.width,
      height: frame.meta.height,
      pixelFormat: frame.meta.pixelFormat,
      bits: frame.meta.bits,
      source: frame.meta.source || parameters.source || 'live-camera',
      bytes: frame.meta.bytes,
      timestamp: frame.meta.timestamp,
      seq: frame.meta.seq,
    };
    delete nativeParams.frameBuffer;

    try {
      // eslint-disable-next-line no-console
      console.log('[auto-measure] native measureVickersAuto →', {
        width: nativeParams.width,
        height: nativeParams.height,
        pixelFormat: nativeParams.pixelFormat,
        bits: nativeParams.bits,
        source: nativeParams.source,
        imageType: nativeParams.imageType,
        erosion: nativeParams.erosion,
        dilation: nativeParams.dilation,
        factor: nativeParams.factor,
        thresholdMode: nativeParams.thresholdMode,
        erosionIterations: nativeParams.erosionIterations,
        dilationIterations: nativeParams.dilationIterations,
        morphologyKernelSize: nativeParams.morphologyKernelSize,
        manualThreshold: nativeParams.manualThreshold,
        edgeFactor: nativeParams.edgeFactor,
        minContourArea: nativeParams.minContourArea,
        maxContourArea: nativeParams.maxContourArea,
        centerBias: nativeParams.centerBias,
        sideFitRoiWidth: nativeParams.sideFitRoiWidth,
        gradientStrengthFactor: nativeParams.gradientStrengthFactor,
        bytes: frame.data.byteLength,
      });
      const result = fn(
        frame.data,
        nativeParams.width,
        nativeParams.height,
        nativeParams.pixelFormat,
        nativeParams
      );
      // eslint-disable-next-line no-console
      console.log('[auto-measure] native measureVickersAuto ←', {
        ok: !!(result && result.ok),
        reason: result && result.reason,
        confidence: result && result.confidence,
        d1Pixels: result && result.d1Pixels,
        d2Pixels: result && result.d2Pixels,
        debug: result && result.debug,
      });
      return result;
    } catch (err) {
      return {
        ok: false,
        source: nativeParams.source,
        confidence: 0,
        reason: err && err.message ? err.message : String(err),
        debug: { rejectionReason: 'NATIVE_THREW' },
      };
    }
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
      this._prepareNativeDllSearchPath();
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

  _prepareNativeDllSearchPath() {
    const opencvDir = process.env.OPENCV_DIR || DEFAULT_OPENCV_DIR;
    const candidates = [
      process.env.OPENCV_BIN_DIR,
      path.join(opencvDir, 'x64', 'vc16', 'bin'),
      app && app.isPackaged
        ? path.join(process.resourcesPath, 'native', 'hardness-addon', 'opencv', 'bin')
        : null,
    ].filter(Boolean);

    const currentPath = process.env.PATH || '';
    for (const dir of candidates) {
      if (!fs.existsSync(dir)) continue;
      const alreadyPresent = currentPath
        .split(path.delimiter)
        .some((entry) => entry.toLowerCase() === dir.toLowerCase());
      if (!alreadyPresent) {
        process.env.PATH = `${dir}${path.delimiter}${process.env.PATH || ''}`;
      }
    }
  }

  async _getFrameForAutoMeasure(parameters) {
    const maxAgeMs = Number.isFinite(Number(parameters && parameters.maxFrameAgeMs))
      ? Number(parameters.maxFrameAgeMs)
      : 1200;
    const now = Date.now();
    if (
      this.latestFrame &&
      this.latestFrame.data &&
      now - this.latestFrame.capturedAt <= maxAgeMs
    ) {
      return {
        ok: true,
        meta: { ...this.latestFrame.meta, source: 'live-camera' },
        data: this.latestFrame.data,
      };
    }

    const timeoutMs = Number.isFinite(Number(parameters && parameters.timeoutMs))
      ? Number(parameters.timeoutMs)
      : 4000;
    const reply = await this._call('cameraGetFrame', { timeoutMs });
    if (!reply || !reply.ok) {
      return {
        ok: false,
        error: reply && reply.error ? reply.error : 'GET_FRAME_FAILED',
        message: reply && reply.message ? reply.message : 'camera frame capture failed',
      };
    }

    const data = toOwnedBuffer(reply.data);
    const meta = sanitizeMeta({
      width: reply.width,
      height: reply.height,
      pixelFormat: reply.pixelFormat,
      bits: reply.bits,
      timestamp: reply.timestamp,
      seq: reply.seq,
      bytes: reply.bytes,
      source: 'live-camera',
    });

    this.latestFrame = {
      meta,
      data,
      capturedAt: Date.now(),
    };

    return { ok: true, meta, data };
  }

  _getProvidedFrameForAutoMeasure(parameters) {
    const width = Number(parameters && parameters.width);
    const height = Number(parameters && parameters.height);
    const bits = Number(parameters && parameters.bits) === 16 ? 16 : 8;
    const pixelFormat =
      typeof parameters.pixelFormat === 'string' && parameters.pixelFormat.trim()
        ? parameters.pixelFormat.trim()
        : 'rgb32';
    const source =
      parameters.source === 'uploaded-image' || parameters.source === 'live-camera'
        ? parameters.source
        : 'uploaded-image';

    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return { ok: false, error: 'BAD_FRAME', message: 'displayed frame width/height are invalid' };
    }

    const data = toOwnedBuffer(parameters.frameBuffer);
    if (!data || !Number.isFinite(data.byteLength) || data.byteLength <= 0) {
      return { ok: false, error: 'BAD_FRAME', message: 'displayed frame buffer is empty' };
    }

    return {
      ok: true,
      meta: {
        width,
        height,
        pixelFormat,
        bits,
        source,
        timestamp: Date.now(),
        seq: 0,
        bytes: data.byteLength,
      },
      data,
    };
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
    if (!this._canSend()) return;
    // The native addon hands us an EXTERNAL buffer (zero-copy view over the
    // SDK's pixel memory). Electron's structured-clone IPC refuses external
    // buffers ("External buffers are not allowed"), so we must hand it a
    // freshly-allocated, fully-owned Buffer. `Buffer.from(x)` is NOT enough —
    // when x is an ArrayBuffer it returns a VIEW (still external), and even
    // for Buffer→Buffer it can keep referencing the external backing store on
    // some Node versions. Allocate + .set forces a real byte copy.
    const payload = toOwnedBuffer(data);
    const safeMeta = sanitizeMeta(meta);
    this.latestFrame = {
      meta: safeMeta,
      data: payload,
      capturedAt: Date.now(),
    };
    try {
      this.webContents.send('camera:frame', safeMeta, payload);
    } catch (_e) {
      this.rendererReady = false;
    }
  }

  _broadcastStatus(payload) {
    this.lastStatus = { ...this.lastStatus, ...payload };
    if (!this._canSend()) return;
    try {
      this.webContents.send('camera:status', payload);
    } catch (_e) {
      this.rendererReady = false;
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
