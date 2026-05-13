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
// low-FPS operation passes through; only truly broken pipelines (>1s lag)
// trigger a drop. The atomic-slot in native already guarantees "freshest
// available" so a slightly old frame is the best the SDK can give us.
// Temporarily lenient (was 100ms) so post-stream-restart frames at 8 FPS
// don't all get dropped while we debug the display pipeline. Tighten
// back to ~50–100ms once the pipeline is verified end-to-end.
const STALE_AGE_MS = 500;
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
    // eslint-disable-next-line no-console
    console.log('[camera-render-latest-only] frameId=mainprocess-drop-enabled');
    this._resetFlowControl();
    this.rendererReady = false;
    this._canSend();
    const p = this._call('cameraStartStream');
    p.then((res) => {
      if (!res || !res.ok) return;
      // SDK runtime snapshot: emitted once per startStream so the diagnostic
      // log has a baseline for the rest of the session. Values queried lazily
      // — anything the addon doesn't expose is reported as 'unknown'.
      this._logSdkRuntime();
    }).catch(() => {});
    return p;
  }
  _logSdkRuntime() {
    if (!this.addon || !this.addon.camera) return;
    let exposureMs = 'unknown';
    let triggerMode = 'unknown';
    try {
      const er = this.addon.camera.cameraGetExposureRange();
      if (er && er.ok && typeof er.current === 'number') exposureMs = er.current;
    } catch { /* ignore */ }
    // No direct getter for trigger state via the JS layer; SetTriggerMode is
    // forced to false on cameraOpen so report continuous unless the renderer
    // toggled it. (The native struct has GetTriggerState but no JS wrapper.)
    triggerMode = 'continuous';
    const exposureUs = typeof exposureMs === 'number' ? Math.round(exposureMs * 1000) : 'unknown';
    // pixelFormat is filled by the first frame; bufferCount / grabMode are
    // SDK constants we cannot query here.
    // eslint-disable-next-line no-console
    console.log(
      `[camera-sdk-runtime] pixelFormat=tbd-first-frame exposureUs=${exposureUs} fps=tbd-first-second triggerMode=${triggerMode} bufferCount=sdk-default grabMode=continuous`
    );
    // eslint-disable-next-line no-console
    console.log(`[camera-exposure] exposureUs=${exposureUs}`);
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
        console.warn('[camera-sdk-buffer-flush] native flush threw:', err && err.message ? err.message : err);
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `[camera-sdk-buffer-flush] reason=${reason || 'objective-change'} drained=${nativeResult && nativeResult.drained != null ? nativeResult.drained : 'n/a'}`
    );
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
    this._markFrameBoundary('exposure-change');
    return this._call('cameraSetExposure', { valueMs });
  }
  setGain(value) {
    // eslint-disable-next-line no-console
    console.log('[cameraService] setGain value=', value);
    this._markFrameBoundary('gain-change');
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
  setLiveMode(profile) {
    // eslint-disable-next-line no-console
    console.log('[cameraService] setLiveMode profile=', profile);
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

    const debugLogs = process.env.AUTO_MEASURE_DEBUG === 'true';
    try {
      if (debugLogs) {
        // eslint-disable-next-line no-console
        console.log('[auto-measure] native →', {
          width: nativeParams.width,
          height: nativeParams.height,
          morphologyKernelSize: nativeParams.morphologyKernelSize,
          manualThreshold: nativeParams.manualThreshold,
          thresholdMode: nativeParams.thresholdMode,
          objectiveForMeasure: nativeParams.objectiveForMeasure,
        });
      }
      const result = fn(
        frame.data,
        nativeParams.width,
        nativeParams.height,
        nativeParams.pixelFormat,
        nativeParams
      );
      if (debugLogs) {
        // eslint-disable-next-line no-console
        console.log('[auto-measure] native ←', {
          ok: !!(result && result.ok),
          reason: result && result.reason,
          confidence: result && result.confidence,
        });
      }
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
      const resolved = this._addonPath();
      // Print the EXACT .node file Electron is about to load + its mtime so
      // stale-binary problems are visible without grepping. Any "addon stamp
      // doesn't match the source" question is answered by comparing this
      // path's mtime to the source .cpp mtime.
      let mtime = 'unknown';
      let sizeBytes = 'unknown';
      try {
        // eslint-disable-next-line global-require
        const fs = require('fs');
        const st = fs.statSync(resolved);
        mtime = st.mtime.toISOString();
        sizeBytes = String(st.size);
      } catch (statErr) {
        mtime = `stat-failed:${statErr.message}`;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[opencv-addon-load] path=${resolved} mtime=${mtime} sizeBytes=${sizeBytes}`
      );
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
    return ts;
  }

  _resetMainPending(reason) {
    const dropped = this._pendingFrame ? 1 : 0;
    if (dropped > 0) this._droppedSinceLastFrame += dropped;
    this._pendingFrame = null;
    this._inFlightSeq = 0;
    this._inFlightSentAt = 0;
    // eslint-disable-next-line no-console
    console.log(`[camera-main-pending-reset] reason=${reason || 'unknown'} dropped=${dropped}`);
  }

  _broadcastFrame(meta, data) {
    const capturedAt = Date.now();
    if (capturedAt - this._lastMainRecvLogAt >= 5000) {
      this._lastMainRecvLogAt = capturedAt;
      const grabTsLog = Number((meta && meta.grabTs) || 0);
      const ageMs = grabTsLog > 0 ? Math.max(0, capturedAt - grabTsLog) : 0;
      const frameIdLog =
        meta && Number.isFinite(Number(meta.frameId)) ? Number(meta.frameId) : 0;
      // eslint-disable-next-line no-console
      console.log(
        `[camera-main-recv] frameId=${frameIdLog} ageMs=${ageMs} canSend=${this._canSend()}`
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
        // eslint-disable-next-line no-console
        console.log(`[camera-stale-drop] frameId=${frameId} ageMs=${ageMs} stage=main-inbound`);
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
    const payload = toOwnedBuffer(data);
    this.latestFrame = {
      meta: safeMeta,
      data: payload,
      capturedAt,
    };

    // First-frame pixelFormat snapshot — closes the loop on the
    // [camera-sdk-runtime] line that started the session with "tbd-first-frame".
    if (safeMeta.pixelFormat && safeMeta.pixelFormat !== this._lastPixelFormatLogged) {
      this._lastPixelFormatLogged = safeMeta.pixelFormat;
      // eslint-disable-next-line no-console
      console.log(
        `[camera-sdk-runtime] pixelFormat=${safeMeta.pixelFormat} bits=${safeMeta.bits} width=${safeMeta.width} height=${safeMeta.height}`
      );
    }

    // Single-slot, latest-only. NEVER queue multiple frames. While a send
    // is in flight (sent to renderer but not yet ack'd), keep at most one
    // pending frame — the newest. A new arrival overwrites any older
    // pending without queueing it.
    const inFlight =
      this._inFlightSeq > 0 &&
      this._lastAckedSeq < this._inFlightSeq;

    if (inFlight) {
      const newFrameId = safeMeta.frameId;
      if (this._pendingFrame) {
        const oldFrameId = this._pendingFrame.meta.frameId;
        this._droppedSinceLastFrame += 1;
        // The older pending frame is being skipped because a newer one
        // arrived while the renderer is still busy with the in-flight send.
        // Always log overwrites — they're the signal of how far the
        // renderer is falling behind the SDK.
        // eslint-disable-next-line no-console
        console.log(
          `[camera-latest-overwrite] oldFrameId=${oldFrameId} newFrameId=${newFrameId}`
        );
      } else if (capturedAt - this._lastBusySkipLogAt >= 1000) {
        // First overwrite-less pending of this 1Hz window — useful as a
        // signal that the IPC pipeline is saturating without being noisy.
        this._lastBusySkipLogAt = capturedAt;
        // eslint-disable-next-line no-console
        console.log(`[camera-send-busy-skip] frameId=${newFrameId}`);
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
      // eslint-disable-next-line no-console
      console.log(
        `[camera-stale-drop] frameId=${safeMeta.frameId} ageMs=${ageMs} stage=main-send`
      );
      return;
    }
    safeMeta.sentAt = sentAt;
    safeMeta.droppedBeforeSend = this._droppedSinceLastFrame;
    this._droppedSinceLastFrame = 0;
    this._inFlightSeq = safeMeta.frameId;
    this._inFlightSentAt = sentAt;
    try {
      this.webContents.send('camera:frame', safeMeta, payload);
    } catch (_e) {
      this.rendererReady = false;
      this._inFlightSeq = 0;
      this._inFlightSentAt = 0;
      return;
    }
    // Successful IPC send. Throttle to 1Hz so the log line is a steady
    // heartbeat, not per-frame spam. The ageMs is the user-visible
    // "native grab → handed to renderer IPC" latency.
    if (sentAt - this._lastSendOkLogAt >= 5000) {
      this._lastSendOkLogAt = sentAt;
      // eslint-disable-next-line no-console
      console.log(`[camera-main-send-ok] frameId=${safeMeta.frameId} ageMs=${ageMs}`);
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
        // eslint-disable-next-line no-console
        console.log(`[camera-stale-drop] frameId=${meta.frameId} ageMs=${ageMs} stage=main-pending-drain`);
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
