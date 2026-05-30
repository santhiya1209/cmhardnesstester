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

// Industrial live-view stale threshold. Originally 50ms to catch IPC-stall
// bursts, but the camera's real-world FPS is exposure-bound — at e.g. 200ms
// exposure the slot is naturally 200ms old between frames and a 50ms gate
// drops EVERY frame, blanking the live view. Set high enough that healthy
// low-FPS operation passes through; only truly broken pipelines trigger a
// drop. The atomic-slot in native already guarantees "freshest available" so
// a slightly old frame is the best the SDK can give us.
// Tightened 500 → 300 now the pipeline is verified: the renderer's live gate
// is 250ms, so any frame older than ~300ms here is guaranteed to be discarded
// downstream (it only ages further through IPC + decode). Shipping it spends a
// ~15MB structured-clone copy on a frame the renderer always drops. 300 leaves
// headroom over the exposure-bound floor (frames are naturally ~exposure_ms
// old by grabTs; current exposures are ~130ms) so healthy low-FPS operation
// still passes — do NOT drop this below the max usable exposure or the live
// view blanks.
const STALE_AGE_MS = 300;

// Fixed-size in-memory ring buffer for the latest live frames. Live frames are
// memory-only — NEVER written to disk. Capacity 3 keeps at most the 3 newest
// frames resident and recycles each slot's backing Buffer instead of
// allocating a fresh ~multi-MB Buffer per frame at full FPS (kills the GC
// churn). Safety invariant: at most two live references exist at any instant
// (`latestFrame` and an in-flight/pending frame — both always the newest
// write), so a slot is only recycled after 3 newer writes, long after any
// consumer (the renderer's structured-clone IPC copy, or the Auto Measure
// fast-path read of `latestFrame.data`) has finished with it.
const FRAME_RING_CAPACITY = 3;

class FrameRingBuffer {
  constructor(capacity = FRAME_RING_CAPACITY) {
    this.capacity = Math.max(1, capacity);
    this.slots = new Array(this.capacity).fill(null);
    this.next = 0;
    this.writes = 0;
    this.drops = 0;
    this.bytesPerSlot = 0;
  }

  // Copy `view` (Uint8Array) into the next slot, reusing the slot's Buffer when
  // the byte length matches. Returns the owned Buffer (safe to hand to IPC,
  // which structured-clone-copies it synchronously on send).
  write(view) {
    const i = this.next;
    let buf = this.slots[i];
    if (!buf || buf.length !== view.byteLength) {
      buf = Buffer.allocUnsafe(view.byteLength);
      this.slots[i] = buf;
      this.bytesPerSlot = view.byteLength;
    }
    buf.set(view);
    this.next = (this.next + 1) % this.capacity;
    this.writes += 1;
    return buf;
  }

  lastSlotIndex() {
    return (this.next + this.capacity - 1) % this.capacity;
  }
}

class CameraService {
  constructor() {
    this.webContents = null;
    this.addon = null;
    this.loadError = null;
    this.lastStatus = { sdkLoaded: false, open: false, streaming: false };
    this.latestFrame = null;
    // Ack-based main-process drop policy. Native pushes frames into our
    // onFrame callback at full FPS; without backpressure they all get sent
    // over IPC and pile up in the renderer's channel queue. Policy:
    //   - At most ONE in-flight frame (sent but not yet ack'd by renderer).
    //   - New frame arrives in flight → keep it as `pending`, drop older
    //     pending.
    //   - Ack arrives → if pending exists, send the newest pending frame.
    this._frameSeq = 0;
    this._inFlightSeq = 0;
    this._inFlightSentAt = 0;
    this._lastAckedSeq = 0;
    this._pendingFrame = null;
    this._dropFramesBeforeTs = 0;
    this._staleDropReason = 'stale';
    this._lastFlushUntilAt = 0;
    this._latestGrabbedFrameId = 0;
    this._droppedSinceLastFrame = 0;
    this._lastPixelFormatLogged = '';
    this._lastIpcSendLogAt = 0;
    this._lastSendOkLogAt = 0;
    this._lastBusySkipLogAt = 0;
    this._lastMainRecvLogAt = 0;
    this._lastCanSendFalseResetAt = 0;
    // In-memory ring buffer for the latest live frames (memory-only, never
    // persisted). See FrameRingBuffer above.
    this.frameRing = new FrameRingBuffer();
    this._ringInitLogged = false;
    this._diskWriteCheckLogged = false;
    this._lastRingWriteLogAt = 0;
    this._lastRingDropLogAt = 0;
    this._lastFrameTransferLogAt = 0;
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
    if (!this.rendererReady) {
      try {
        if (typeof wc.isLoading === 'function' && wc.isLoading()) return false;
      } catch {
        return false;
      }
      this.rendererReady = true;
    }
    try {
      if (!wc.mainFrame) return false;
    } catch { return false; }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                           */
  /* ------------------------------------------------------------------ */

  open(payload) {
    this._markFrameBoundary('camera-open');
    return this._call('cameraOpen', payload || {});
  }
  close() {
    return this._call('cameraClose').finally(() => {
      this.latestFrame = null;
      this._resetFlowControl();
    });
  }
  startStream() {
    this._resetFlowControl();
    this.rendererReady = false;
    this._canSend();
    return this._call('cameraStartStream');
  }
  ackFrame(seq) {
    const n = Number(seq);
    if (!Number.isFinite(n) || n <= 0) return { ok: false };
    if (n > this._lastAckedSeq) this._lastAckedSeq = n;
    if (n >= this._inFlightSeq) {
      this._inFlightSeq = 0;
      this._inFlightSentAt = 0;
    }
    this._drainPending();
    return { ok: true };
  }
  flushStream(reason) {
    this._lastFlushUntilAt = this._markFrameBoundary(reason || 'objective-change');
    // Ask the native addon to drain the SDK ring AND bump the stream
    // generation so any frames already in flight through TSF get dropped on
    // arrival. Falls back silently to the JS-layer guard if the rebuilt
    // addon isn't deployed yet (older binary without cameraFlushStream).
    let nativeResult = null;
    if (this.addon && this.addon.camera && typeof this.addon.camera.cameraFlushStream === 'function') {
      try {
        nativeResult = this.addon.camera.cameraFlushStream({ reason: reason || 'objective-change' });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[camera-sdk-buffer-flush] native flush threw:', err && err.message ? err.message : err);
      }
    }
    void nativeResult;
    return { ok: true, flushUntilAt: this._lastFlushUntilAt };
  }
  _resetFlowControl() {
    this._resetMainPending('flow-reset');
    this._frameSeq = 0;
    this._lastAckedSeq = 0;
    this._lastFlushUntilAt = 0;
    this._dropFramesBeforeTs = 0;
    this._staleDropReason = 'stale';
    this._latestGrabbedFrameId = 0;
    this._droppedSinceLastFrame = 0;
    this._lastPixelFormatLogged = '';
  }
  stopStream() {
    return this._call('cameraStopStream');
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
    this._markFrameBoundary('exposure-change');
    return this._call('cameraSetExposure', { valueMs });
  }
  setGain(value) {
    this._markFrameBoundary('gain-change');
    return this._call('cameraSetGain', { value });
  }
  getExposureRange() {
    return this._call('cameraGetExposureRange');
  }
  getGainRange() {
    return this._call('cameraGetGainRange');
  }
  setTriggerMode(value) {
    return this._call('cameraSetTriggerMode', { value: !!value });
  }
  setLiveMode(profile) {
    // Same frame-boundary handling as setExposure: drop in-flight + pending,
    // reset the JS-side stale tracker so post-restart SDK frame counters
    // don't get falsely flagged.
    this._markFrameBoundary('live-mode-change');
    return this._call('cameraSetLiveMode', profile || {});
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
      const result = fn(
        frame.data,
        nativeParams.width,
        nativeParams.height,
        nativeParams.pixelFormat,
        nativeParams
      );
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
    // The .node binary now lives inside app.asar in the packaged build, with
    // @electron-forge/plugin-auto-unpack-natives transparently extracting it
    // to app.asar.unpacked/ at package time. Node's require() resolves the
    // asar virtual path to the unpacked file automatically, so the same
    // __dirname-relative path works for both dev and packaged modes.
    return path.join(__dirname, '..', 'native', 'hardness-addon', ADDON_RELATIVE);
  }

  _tryLoad() {
    if (this.addon || this.loadError) return;
    try {
      this._prepareNativeDllSearchPath();
      const resolved = this._addonPath();
      // eslint-disable-next-line no-console
      console.log(`[cameraService] loading native addon: ${resolved}`);
      // eslint-disable-next-line import/no-dynamic-require, global-require
      this.addon = require(resolved);
    } catch (err) {
      this.loadError = err;
      this._broadcastStatus({
        event: 'addon-missing',
        error: 'ADDON_NOT_BUILT',
        message: err.message,
      });
      return;
    }

    const dllSearchDir = app && app.isPackaged
      ? path.join(process.resourcesPath, 'DVP2 x64')
      : (process.env.DO3THINK_SDK_DIR || 'C:\\Program Files (x86)\\Do3think\\DVP2 x64');

    const driverMissingMessage =
      'Camera driver/runtime is not installed. Please install the required ' +
      'camera driver from the installer package or contact support.';
    try {
      const boot = this.addon.camera.bootstrap({ dllSearchDir });
      if (!boot || !boot.ok) {
        this._broadcastStatus({
          event: 'sdk-missing',
          error: boot && boot.error ? boot.error : 'SDK_NOT_FOUND',
          message: driverMissingMessage,
          detail: boot && boot.message ? boot.message : 'failed to load DVPCamera64.dll',
        });
      }
    } catch (err) {
      this._broadcastStatus({
        event: 'sdk-missing',
        error: 'BOOTSTRAP_THREW',
        message: driverMissingMessage,
        detail: err.message,
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
      console.error('[cameraService] setEventCallbacks failed:', err.message);
    }
  }

  _prepareNativeDllSearchPath() {
    const opencvDir = process.env.OPENCV_DIR || DEFAULT_OPENCV_DIR;
    const isPackaged = Boolean(app && app.isPackaged);
    // Order matters: env overrides win, then dev-machine local installs, then
    // packaged-bundle directories. Existence-check skips entries that don't
    // resolve so PATH never collects bogus references.
    const candidates = [
      process.env.OPENCV_BIN_DIR,
      path.join(opencvDir, 'x64', 'vc16', 'bin'),
      isPackaged ? path.join(process.resourcesPath, 'opencv', 'bin') : null,
      isPackaged ? path.join(process.resourcesPath, 'DVP2 x64') : null,
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
      frameId: reply.frameId,
      grabTs: reply.grabTs,
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

  _markFrameBoundary(reason) {
    const ts = Date.now();
    const dropReason = reason === 'objective-change' ? 'stale-pre-objective-change' : 'stale';
    this._dropFramesBeforeTs = ts;
    this._staleDropReason = dropReason;
    this._resetMainPending(reason || dropReason);
    // Native restarts the SDK stream on exposure/gain/objective change and
    // its frame counter may reset. If we keep the old high value here,
    // every fresh frame after restart would look "older by frameId" — the
    // exact false-positive that surfaced as the persistent stale-native-send
    // log. Wall-clock age is the authority; this is just a max-tracker.
    this._latestGrabbedFrameId = 0;
    this._lastAckedSeq = 0;
    // Re-arm post-boundary frame logging so [camera-native-frame-check]
    // fires once after every settings change, confirming the native restart
    // actually delivered a fresh frame.
    this._boundaryLogPending = { reason: reason || dropReason, at: ts };
    return ts;
  }

  _resetMainPending(_reason) {
    const dropped = this._pendingFrame ? 1 : 0;
    if (dropped > 0) this._droppedSinceLastFrame += dropped;
    this._pendingFrame = null;
    this._inFlightSeq = 0;
    this._inFlightSentAt = 0;
  }

  _broadcastFrame(meta, data) {
    const capturedAt = Date.now();
    if (this._boundaryLogPending) {
      const { reason, at } = this._boundaryLogPending;
      this._boundaryLogPending = null;
      const grabTs = Number(meta && meta.grabTs ? meta.grabTs : 0);
      // eslint-disable-next-line no-console
      console.log(
        `[camera-native-frame-check] post-${reason} first-frame-arrived sinceBoundaryMs=${capturedAt - at} grabTs=${grabTs} ${meta && meta.width}x${meta && meta.height}`
      );
    }
    if (!this._canSend()) {
      if (capturedAt - this._lastCanSendFalseResetAt >= 1000) {
        this._lastCanSendFalseResetAt = capturedAt;
        this._resetMainPending('canSend-false');
        this._lastAckedSeq = 0;
      }
      return;
    }
    this._frameSeq += 1;
    const rawFrameId = meta && Number.isFinite(Number(meta.frameId)) ? Number(meta.frameId) : 0;
    const frameId = rawFrameId > 0 ? rawFrameId : this._frameSeq;
    // Track only the maximum observed frameId for diagnostics. We do NOT
    // drop on frameId<latest anymore — the SDK frame counter can reset on
    // stream restarts (exposure/gain/objective change) and a counter-reset
    // does NOT mean the frame is stale. Wall-clock age is the authority.
    if (frameId > this._latestGrabbedFrameId) {
      this._latestGrabbedFrameId = frameId;
    }
    const safeMeta = {
      ...sanitizeMeta(meta),
      frameId,
      capturedAt,
    };
    const grabTs = Number(safeMeta.grabTs || safeMeta.capturedAt || 0);
    if (this._dropFramesBeforeTs > 0 && grabTs > 0 && grabTs < this._dropFramesBeforeTs) {
      this._droppedSinceLastFrame += 1;
      return;
    }
    // Age gate (main process inbound). Wall-clock age is the only authority
    // for "stale". If the grab happened > STALE_AGE_MS ago, the physical
    // machine has already moved past what this frame depicts. Drop now —
    // a fresher frame is on its way from native.
    if (grabTs > 0) {
      const ageMs = Math.max(0, capturedAt - grabTs);
      if (ageMs > STALE_AGE_MS) {
        this._droppedSinceLastFrame += 1;
        return;
      }
    }
    // The native addon hands us an EXTERNAL buffer (zero-copy view over the
    // SDK's pixel memory). Electron's structured-clone IPC refuses external
    // buffers ("External buffers are not allowed"), so we must hand it a
    // freshly-allocated, fully-owned Buffer. `Buffer.from(x)` is NOT enough —
    // when x is an ArrayBuffer it returns a VIEW (still external), and even
    // for Buffer→Buffer it can keep referencing the external backing store on
    // some Node versions. Allocate + .set forces a real byte copy.
    // Write into the fixed-size in-memory ring (recycles backing buffers; no
    // per-frame multi-MB allocation). The ring copies the bytes, so the
    // native external buffer is not retained. Live frames stay memory-only.
    const view = toUint8View(data);
    if (!this._ringInitLogged) {
      this._ringInitLogged = true;
      const bytes = view ? view.byteLength : 0;
      // eslint-disable-next-line no-console
      console.log(
        `[camera-shared-buffer-init] capacity=${this.frameRing.capacity} bytesPerFrame=${bytes} maxBytes=${bytes * this.frameRing.capacity}`
      );
      if (!this._diskWriteCheckLogged) {
        this._diskWriteCheckLogged = true;
        // eslint-disable-next-line no-console
        console.log('[camera-disk-write-check] liveFrameDiskWrite=false');
      }
    }
    const payload = view ? this.frameRing.write(view) : toOwnedBuffer(data);
    const nowRingLog = Date.now();
    if (nowRingLog - this._lastRingWriteLogAt >= 5000) {
      this._lastRingWriteLogAt = nowRingLog;
      // eslint-disable-next-line no-console
      console.log(
        `[camera-shared-buffer-write] writes=${this.frameRing.writes} slot=${this.frameRing.lastSlotIndex()} bytes=${payload.length}`
      );
    }
    this.latestFrame = {
      meta: safeMeta,
      data: payload,
      capturedAt,
    };

    // Single-slot, latest-only. NEVER queue multiple frames. While a send
    // is in flight (sent to renderer but not yet ack'd), keep at most one
    // pending frame — the newest. A new arrival overwrites any older
    // pending without queueing it.
    const inFlight =
      this._inFlightSeq > 0 &&
      this._lastAckedSeq < this._inFlightSeq;

    if (inFlight) {
      if (this._pendingFrame) {
        this._droppedSinceLastFrame += 1;
        this.frameRing.drops += 1;
        const nowDropLog = Date.now();
        if (nowDropLog - this._lastRingDropLogAt >= 5000) {
          this._lastRingDropLogAt = nowDropLog;
          // eslint-disable-next-line no-console
          console.log(
            `[camera-shared-buffer-drop] reason=superseded-newer-frame totalDrops=${this.frameRing.drops}`
          );
        }
      }
      this._pendingFrame = { meta: safeMeta, data: payload };
      return;
    }

    this._sendFrame(safeMeta, payload);
  }

  _sendFrame(safeMeta, payload) {
    const sentAt = Date.now();
    const grabTs = Number(safeMeta.grabTs || safeMeta.capturedAt || 0);
    const ageMs = grabTs > 0 ? Math.max(0, sentAt - grabTs) : 0;
    // Final age check at the IPC boundary. Frames cannot age between here
    // and `_broadcastFrame` (microseconds apart on the same call stack)
    // except via _drainPending which calls us after an ack — and ack
    // latency CAN push us past STALE_AGE_MS. Drop instead of sending; the
    // next native frame will take the in-flight slot.
    if (grabTs > 0 && ageMs > STALE_AGE_MS) {
      this._droppedSinceLastFrame += 1;
      return;
    }
    safeMeta.sentAt = sentAt;
    safeMeta.droppedBeforeSend = this._droppedSinceLastFrame;
    this._droppedSinceLastFrame = 0;
    this._inFlightSeq = safeMeta.frameId;
    this._inFlightSentAt = sentAt;
    if (sentAt - this._lastFrameTransferLogAt >= 5000) {
      this._lastFrameTransferLogAt = sentAt;
      // eslint-disable-next-line no-console
      console.log(
        `[camera-frame-transfer] direction=main-to-renderer frameId=${safeMeta.frameId} bytes=${payload.length}`
      );
    }
    try {
      this.webContents.send('camera:frame', safeMeta, payload);
    } catch (_e) {
      this.rendererReady = false;
      this._inFlightSeq = 0;
      this._inFlightSentAt = 0;
      return;
    }
  }

  _drainPending() {
    if (!this._pendingFrame) return;
    if (!this._canSend()) {
      this._resetMainPending('canSend-false-drain');
      this._lastAckedSeq = 0;
      return;
    }
    const { meta, data } = this._pendingFrame;
    this._pendingFrame = null;
    const grabTs = Number(meta.grabTs || meta.capturedAt || 0);
    if (this._dropFramesBeforeTs > 0 && grabTs > 0 && grabTs < this._dropFramesBeforeTs) {
      this._droppedSinceLastFrame += 1;
      return;
    }
    // Age gate on the queued newest-pending. While we were waiting for the
    // renderer ack, this frame may have aged out. Drop without sending —
    // native is producing live frames and the next _broadcastFrame will hand
    // us a fresh one (inFlight is already cleared by ackFrame above).
    if (grabTs > 0) {
      const ageMs = Math.max(0, Date.now() - grabTs);
      if (ageMs > STALE_AGE_MS) {
        this._droppedSinceLastFrame += 1;
        return;
      }
    }
    this._sendFrame(meta, data);
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

// Return a zero-copy Uint8Array view of any buffer-ish source (the ring does
// the actual byte copy). null for unsupported inputs.
function toUint8View(src) {
  if (src == null) return null;
  if (Buffer.isBuffer(src) || src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  return null;
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
