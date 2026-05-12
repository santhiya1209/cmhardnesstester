// camera.cpp — N-API surface for the Do3Think DVP2 camera.
//
// Loads `DVPCamera64.dll` at runtime via DvpDll_Load (LoadLibrary +
// GetProcAddress). All DVP* prototypes come from the vendor-extracted
// `dvp.h` (see ../include/dvp.h). No mock fallbacks: every entry returns
// {ok:false, error} when the SDK is missing or the camera is not connected.
//
// Streaming model: a single std::thread loop calls dvpGetFrame and pushes
// each frame to JS via a Napi::ThreadSafeFunction. The ArrayBuffer wraps
// a heap copy of the SDK's internal buffer (the SDK reuses its buffer
// across calls — we must copy before the next dvpGetFrame).

#include "camera.h"
#include "dvp_dll.h"
#include "vickers_auto_measure.h"

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace hardness_camera {

namespace {

struct State {
  std::mutex             mu;
  DvpDll                 dll;
  bool                   bootstrapped = false;
  std::wstring           searchDir;

  dvpHandle              handle = 0;
  std::atomic<bool>      isOpen{false};
  std::atomic<bool>      isStreaming{false};

  std::thread            streamThread;
  std::atomic<bool>      stopRequested{false};

  Napi::ThreadSafeFunction tsfFrame;   // called from stream thread
  Napi::ThreadSafeFunction tsfStatus;  // called for state transitions

  // Latest-frame-only flow control between the native stream thread and the
  // JS callback. The stream thread increments pendingTsfFrames when it pushes
  // a frame into the TSF queue; the JS-side trampoline decrements it after
  // dispatching to JS. While pendingTsfFrames > 0 the stream thread STILL
  // pulls from the SDK (so the SDK ring drains) but DROPS the frame instead
  // of allocating + copying + queueing it. This matches the behavior of a
  // vendor in-process viewer that simply paints the newest frame and lets
  // older ones fall off the floor when the painter is busy.
  std::atomic<int>       pendingTsfFrames{0};
  std::atomic<uint64_t>  droppedFrames{0};
  std::atomic<uint64_t>  streamGeneration{0};

  int                    lastWidth = 0;
  int                    lastHeight = 0;
  std::string            lastError;
};

State& S() {
  static State s;
  return s;
}

const char* FormatToString(dvpImageFormat f) {
  switch (f) {
    case FORMAT_MONO:     return "mono8";
    case FORMAT_BAYER_BG: return "bayer_bg";
    case FORMAT_BAYER_GB: return "bayer_gb";
    case FORMAT_BAYER_GR: return "bayer_gr";
    case FORMAT_BAYER_RG: return "bayer_rg";
    case FORMAT_BGR24:    return "bgr24";
    case FORMAT_BGR32:    return "bgr32";
    case FORMAT_RGB24:    return "rgb24";
    case FORMAT_RGB32:    return "rgb32";
    default:              return "raw";
  }
}

Napi::Object MakeReply(Napi::Env env, bool ok) {
  auto o = Napi::Object::New(env);
  o.Set("ok", Napi::Boolean::New(env, ok));
  return o;
}

uint64_t NowMs() {
  using namespace std::chrono;
  return static_cast<uint64_t>(
      duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count());
}

Napi::Object MakeError(Napi::Env env, const char* code, const std::string& msg) {
  auto o = MakeReply(env, false);
  o.Set("error", Napi::String::New(env, code));
  o.Set("message", Napi::String::New(env, msg));
  return o;
}

double SnapDoubleToStep(double value, double min, double max, double step) {
  if (step > 0.0 && std::isfinite(step)) {
    value = min + std::round((value - min) / step) * step;
  }
  if (value < min) value = min;
  if (value > max) value = max;
  return value;
}

float SnapFloatToStep(float value, float min, float max, float step) {
  if (step > 0.0f && std::isfinite(step)) {
    value = min + std::round((value - min) / step) * step;
  }
  if (value < min) value = min;
  if (value > max) value = max;
  return value;
}

bool EnsureLoaded(Napi::Env env, Napi::Object& outErr) {
  auto& s = S();
  if (s.dll.loaded()) return true;
  if (!DvpDll_Load(s.dll, s.searchDir)) {
    outErr = MakeError(env, "SDK_NOT_FOUND", s.dll.loadError);
    return false;
  }
  return true;
}

const char* BufferModeName(dvpBufferMode mode) {
  switch (mode) {
    case BUFFER_MODE_NEWEST: return "newest";
    case BUFFER_MODE_FIFO:   return "fifo";
    default:                 return "unknown";
  }
}

void ConfigureLowLatencyBufferLocked(const char* reason) {
  auto& s = S();
  if (!s.handle) return;

  dvpStatus setQueueRs = DVP_STATUS_NOT_SUPPORTED;
  dvpStatus setConfigRs = DVP_STATUS_NOT_SUPPORTED;
  dvpStatus getQueueRs = DVP_STATUS_NOT_SUPPORTED;
  dvpStatus getConfigRs = DVP_STATUS_NOT_SUPPORTED;
  dvpInt32 actualQueueSize = -1;
  dvpBufferConfig cfg{};
  cfg.mode = BUFFER_MODE_NEWEST;
  cfg.uQueueSize = 1;
  cfg.bDropNew = false;
  cfg.bLite = false;

  if (s.dll.GetBufferConfig) {
    dvpBufferConfig current{};
    getConfigRs = s.dll.GetBufferConfig(s.handle, &current);
    if (getConfigRs == DVP_STATUS_OK) {
      cfg = current;
      cfg.mode = BUFFER_MODE_NEWEST;
      cfg.uQueueSize = 1;
      cfg.bDropNew = false;
    }
  }
  if (s.dll.SetBufferConfig) {
    setConfigRs = s.dll.SetBufferConfig(s.handle, cfg);
  }
  if (s.dll.SetBufferQueueSize) {
    setQueueRs = s.dll.SetBufferQueueSize(s.handle, 1);
  }
  if (s.dll.GetBufferQueueSize) {
    getQueueRs = s.dll.GetBufferQueueSize(s.handle, &actualQueueSize);
  }
  if (s.dll.GetBufferConfig) {
    dvpBufferConfig actual{};
    dvpStatus rs = s.dll.GetBufferConfig(s.handle, &actual);
    if (rs == DVP_STATUS_OK) {
      cfg = actual;
      getConfigRs = rs;
    }
  }

  fprintf(
      stderr,
      "[camera-buffer-config] reason=%s bufferCount=%s grabMode=%s actualQueueSize=%d queueStatus=%d configStatus=%d actualMode=%s\n",
      reason ? reason : "unknown",
      s.dll.SetBufferQueueSize ? "1" : "unsupported",
      s.dll.SetBufferConfig ? "newest" : "drain-to-newest",
      actualQueueSize,
      getQueueRs == DVP_STATUS_OK ? setQueueRs : getQueueRs,
      setConfigRs,
      getConfigRs == DVP_STATUS_OK ? BufferModeName(cfg.mode) : "unknown");
  fflush(stderr);
}

int DrainSdkFrames(dvpUint32 timeoutMs, int maxFrames) {
  auto& s = S();
  if (!s.handle || !s.dll.GetFrame) return 0;
  int drained = 0;
  for (int i = 0; i < maxFrames; ++i) {
    dvpFrame f{};
    void* p = nullptr;
    dvpStatus rs = s.dll.GetFrame(s.handle, &f, &p, timeoutMs);
    if (rs != DVP_STATUS_OK || !p || f.uBytes == 0) break;
    drained++;
  }
  if (drained > 0) {
    s.droppedFrames.fetch_add(static_cast<uint64_t>(drained), std::memory_order_relaxed);
  }
  return drained;
}

/* ------------------------------------------------------------------ */
/* bootstrap({ dllSearchDir })                                         */
/*   Sets the search dir for DVPCamera64.dll and tries to load it.     */
/* ------------------------------------------------------------------ */
Napi::Value Bootstrap(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  std::wstring dir;
  if (info.Length() > 0 && info[0].IsObject()) {
    auto opts = info[0].As<Napi::Object>();
    if (opts.Has("dllSearchDir") && opts.Get("dllSearchDir").IsString()) {
      auto u16 = opts.Get("dllSearchDir").As<Napi::String>().Utf16Value();
      dir.assign(reinterpret_cast<const wchar_t*>(u16.data()), u16.size());
    }
  }
  s.searchDir = dir;
  s.bootstrapped = true;

  // Try eager-load so the renderer gets an early error if the DLL is missing.
  if (!s.dll.loaded()) {
    if (!DvpDll_Load(s.dll, s.searchDir)) {
      return MakeError(env, "SDK_NOT_FOUND", s.dll.loadError);
    }
  }
  auto r = MakeReply(env, true);
  r.Set("sdkLoaded", Napi::Boolean::New(env, true));
  return r;
}

/* ------------------------------------------------------------------ */
/* setEventCallbacks({ onFrame(meta, buf), onStatus(payload) })        */
/* ------------------------------------------------------------------ */
Napi::Value SetEventCallbacks(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    return MakeError(env, "BAD_ARGS", "expected { onFrame, onStatus }");
  }
  auto opts = info[0].As<Napi::Object>();
  auto& s = S();
  if (opts.Has("onFrame") && opts.Get("onFrame").IsFunction()) {
    if (s.tsfFrame) s.tsfFrame.Release();
    s.tsfFrame = Napi::ThreadSafeFunction::New(env, opts.Get("onFrame").As<Napi::Function>(),
                                               "dvp-frame", 0, 1);
  }
  if (opts.Has("onStatus") && opts.Get("onStatus").IsFunction()) {
    if (s.tsfStatus) s.tsfStatus.Release();
    s.tsfStatus = Napi::ThreadSafeFunction::New(env, opts.Get("onStatus").As<Napi::Function>(),
                                                "dvp-status", 0, 1);
  }
  return MakeReply(env, true);
}

void EmitStatus(const std::string& key, const std::string& value) {
  auto& s = S();
  if (!s.tsfStatus) return;
  // Marshal into JS thread; allocate strings on heap.
  auto payload = new std::pair<std::string, std::string>(key, value);
  s.tsfStatus.NonBlockingCall(payload, [](Napi::Env env, Napi::Function fn,
                                          std::pair<std::string, std::string>* p) {
    auto o = Napi::Object::New(env);
    o.Set(p->first, Napi::String::New(env, p->second));
    fn.Call({o});
    delete p;
  });
}

/* ------------------------------------------------------------------ */
/* cameraOpen({ index })                                                */
/* ------------------------------------------------------------------ */
Napi::Value CameraOpen(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  std::lock_guard<std::mutex> lk(s.mu);

  Napi::Object errObj;
  if (!EnsureLoaded(env, errObj)) return errObj;
  if (s.isOpen.load()) {
    auto r = MakeReply(env, true);
    r.Set("alreadyOpen", Napi::Boolean::New(env, true));
    return r;
  }

  dvpUint32 deviceIndex = 0;
  if (info.Length() > 0 && info[0].IsObject()) {
    auto opts = info[0].As<Napi::Object>();
    if (opts.Has("index") && opts.Get("index").IsNumber()) {
      deviceIndex = opts.Get("index").As<Napi::Number>().Uint32Value();
    }
  }

  dvpUint32 count = 0;
  dvpStatus rs = s.dll.Refresh(&count);
  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "REFRESH_FAILED", "dvpRefresh status=" + std::to_string(rs));
  }
  if (count == 0) {
    return MakeError(env, "CAMERA_NOT_CONNECTED", "no Do3Think cameras detected");
  }
  if (deviceIndex >= count) {
    return MakeError(env, "INDEX_OUT_OF_RANGE",
                     "index " + std::to_string(deviceIndex) +
                         " >= count " + std::to_string(count));
  }

  dvpHandle h = 0;
  rs = s.dll.Open(deviceIndex, OPEN_NORMAL, &h);
  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "OPEN_FAILED", "dvpOpen status=" + std::to_string(rs));
  }
  s.handle = h;
  s.isOpen.store(true);
  s.lastError.clear();

  // Default to continuous streaming mode (trigger off).
  s.dll.SetTriggerState(h, false);

  // Disable auto-exposure so manual exposure/gain settings actually stick.
  // Without this, the SDK's continuous AE loop overrides every value we set
  // a few frames later, and the user sees the slider have no effect.
  s.dll.SetAeOperation(h, AE_OP_OFF);
  ConfigureLowLatencyBufferLocked("open");
  fprintf(stderr, "[dvp] cameraOpen ok handle=%u, AE forced OFF\n", h);
  fflush(stderr);

  auto r = MakeReply(env, true);
  r.Set("count", Napi::Number::New(env, count));
  r.Set("index", Napi::Number::New(env, deviceIndex));

  dvpCameraInfo ci{};
  if (s.dll.GetCameraInfo(h, &ci) == DVP_STATUS_OK) {
    r.Set("name", Napi::String::New(env, ci.FriendlyName));
    r.Set("model", Napi::String::New(env, ci.Model));
    r.Set("serial", Napi::String::New(env, ci.SerialNumber));
  }
  dvpRegion roi{};
  if (s.dll.GetRoi(h, &roi) == DVP_STATUS_OK) {
    r.Set("width", Napi::Number::New(env, roi.W));
    r.Set("height", Napi::Number::New(env, roi.H));
    s.lastWidth = roi.W;
    s.lastHeight = roi.H;
  }
  EmitStatus("event", "opened");
  return r;
}

/* ------------------------------------------------------------------ */
/* cameraClose()                                                        */
/* ------------------------------------------------------------------ */
void StopStreamLocked();

Napi::Value CameraClose(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  std::lock_guard<std::mutex> lk(s.mu);
  if (!s.isOpen.load()) {
    auto r = MakeReply(env, true);
    r.Set("alreadyClosed", Napi::Boolean::New(env, true));
    return r;
  }
  if (s.isStreaming.load()) StopStreamLocked();
  if (s.dll.Close && s.handle) s.dll.Close(s.handle);
  s.handle = 0;
  s.isOpen.store(false);
  EmitStatus("event", "closed");
  return MakeReply(env, true);
}

/* ------------------------------------------------------------------ */
/* Stream worker                                                        */
/* ------------------------------------------------------------------ */
void StreamLoop() {
  auto& s = S();
  while (!s.stopRequested.load()) {
    dvpFrame frame{};
    void* pBuffer = nullptr;
    dvpStatus rs = s.dll.GetFrame(s.handle, &frame, &pBuffer, 4000);
    if (rs == DVP_STATUS_TIME_OUT) continue;
    if (rs != DVP_STATUS_OK || !pBuffer || frame.uBytes == 0) {
      s.lastError = "dvpGetFrame status=" + std::to_string(rs);
      EmitStatus("error", s.lastError);
      break;
    }

    s.lastWidth = frame.iWidth;
    s.lastHeight = frame.iHeight;

    // ─────────────────────────────────────────────────────────────────
    // Drain-to-newest: the DVP SDK's GetFrame returns the OLDEST frame
    // from its internal ring (FIFO). The ring is several frames deep on
    // most DVP cameras and the SDK exposes no buffer-count knob, so by
    // the time the OS-level call returns, two or three newer frames may
    // already be sitting behind it. Without this loop we always show
    // frame N-k where k is the live ring depth — that is the residual
    // "physical move → visible" latency the user is complaining about.
    //
    // Strategy: keep calling GetFrame with timeout=0 (non-blocking) and
    // overwrite `frame`/`pBuffer` with whatever the SDK returns. The
    // previous pBuffer is invalidated by each successful GetFrame (the
    // SDK reuses the slot), so it is safe — and correct — to discard
    // intermediate frames without copying them. We stop as soon as
    // GetFrame returns non-OK (typically TIMEOUT → ring is empty).
    int extraFramesDrained = 0;
    for (int i = 0; i < 16; ++i) {
      dvpFrame nf{};
      void* np = nullptr;
      dvpStatus nrs = s.dll.GetFrame(s.handle, &nf, &np, 0);
      if (nrs != DVP_STATUS_OK || !np || nf.uBytes == 0) break;
      frame = nf;
      pBuffer = np;
      s.lastWidth = nf.iWidth;
      s.lastHeight = nf.iHeight;
      extraFramesDrained++;
    }
    if (extraFramesDrained > 0) {
      s.droppedFrames.fetch_add(extraFramesDrained, std::memory_order_relaxed);
    }
    // ─────────────────────────────────────────────────────────────────

    // Latest-frame-only drop at the native source. If JS hasn't drained the
    // previous frame from the TSF queue, skip this one entirely — no alloc,
    // no memcpy, no TSF push. The SDK buffer is already consumed (we called
    // dvpGetFrame), so the SDK ring advances and we don't backlog there.
    if (s.pendingTsfFrames.load(std::memory_order_acquire) > 0) {
      s.droppedFrames.fetch_add(1, std::memory_order_relaxed);
      continue;
    }

    const uint64_t grabTs = NowMs();
    fprintf(
        stderr,
        "[camera-native-grab] frameId=%llu grabTs=%llu width=%d height=%d\n",
        static_cast<unsigned long long>(frame.uFrameID),
        static_cast<unsigned long long>(grabTs),
        frame.iWidth,
        frame.iHeight);
    fflush(stderr);

    // Copy the SDK buffer because it is reused on the next call.
    auto* bytes = new uint8_t[frame.uBytes];
    std::memcpy(bytes, pBuffer, frame.uBytes);

    struct FramePayload {
      uint8_t*     bytes;
      size_t       size;
      int          width;
      int          height;
      const char*  pixelFormat;
      int          bits;
      uint64_t     timestamp;
      uint64_t     seq;
      uint64_t     grabTs;
      uint64_t     generation;
    };
    auto* fp = new FramePayload{
        bytes, frame.uBytes,
        frame.iWidth, frame.iHeight,
        FormatToString(frame.format),
        frame.bits == BITS_16 ? 16 : 8,
        frame.uTimestamp,
        frame.uFrameID,
        grabTs,
        s.streamGeneration.load(std::memory_order_acquire),
    };

    if (s.tsfFrame) {
      s.pendingTsfFrames.fetch_add(1, std::memory_order_acq_rel);
      auto status = s.tsfFrame.NonBlockingCall(fp, [](Napi::Env env, Napi::Function fn, FramePayload* p) {
        auto& st = S();
        // Decrement the in-flight counter no matter what happens below —
        // exceptions, drops, anything. RAII via a tiny guard.
        struct Decrement {
          ~Decrement() { S().pendingTsfFrames.fetch_sub(1, std::memory_order_acq_rel); }
        } _dec;

        // If a flush bumped the generation while this frame was queued, drop
        // it before paying the JS dispatch cost.
        if (p->generation < st.streamGeneration.load(std::memory_order_acquire)) {
          fprintf(
              stderr,
              "[camera-frame-drop] frameId=%llu reason=stale-pre-objective-change\n",
              static_cast<unsigned long long>(p->seq));
          fflush(stderr);
          delete[] p->bytes;
          delete p;
          st.droppedFrames.fetch_add(1, std::memory_order_relaxed);
          return;
        }

        const uint64_t sendTs = NowMs();
        fprintf(
            stderr,
            "[camera-native-send] frameId=%llu sendTs=%llu ageMs=%llu\n",
            static_cast<unsigned long long>(p->seq),
            static_cast<unsigned long long>(sendTs),
            static_cast<unsigned long long>(sendTs >= p->grabTs ? sendTs - p->grabTs : 0));
        fflush(stderr);

        // V8-owned copy. Electron's IPC structured-clone refuses external
        // buffers ("External buffers are not allowed"), so we cannot hand the
        // renderer a Buffer that wraps our heap allocation via a finalizer.
        auto u8 = Napi::Buffer<uint8_t>::Copy(env, p->bytes, p->size);
        delete[] p->bytes;
        auto meta = Napi::Object::New(env);
        meta.Set("width", Napi::Number::New(env, p->width));
        meta.Set("height", Napi::Number::New(env, p->height));
        meta.Set("pixelFormat", Napi::String::New(env, p->pixelFormat));
        meta.Set("bits", Napi::Number::New(env, p->bits));
        meta.Set("timestamp", Napi::Number::New(env, static_cast<double>(p->timestamp)));
        meta.Set("seq", Napi::Number::New(env, static_cast<double>(p->seq)));
        meta.Set("frameId", Napi::Number::New(env, static_cast<double>(p->seq)));
        meta.Set("grabTs", Napi::Number::New(env, static_cast<double>(p->grabTs)));
        meta.Set("bytes", Napi::Number::New(env, static_cast<double>(p->size)));
        meta.Set("generation", Napi::Number::New(env, static_cast<double>(p->generation)));
        fn.Call({meta, u8});
        delete p;
      });
      // If TSF enqueue failed (queue closed, env shutdown), reverse the
      // increment and free the buffer ourselves.
      if (status != napi_ok) {
        s.pendingTsfFrames.fetch_sub(1, std::memory_order_acq_rel);
        delete[] bytes;
        delete fp;
      }
    } else {
      // No subscriber — drop the buffer to avoid leaks.
      delete[] bytes;
      delete fp;
    }
  }
  s.isStreaming.store(false);
  EmitStatus("event", "streaming-stopped");
}

void StopStreamLocked() {
  auto& s = S();
  if (!s.isStreaming.load()) return;
  s.stopRequested.store(true);
  if (s.dll.Stop && s.handle) s.dll.Stop(s.handle);
  if (s.streamThread.joinable()) s.streamThread.join();
  s.isStreaming.store(false);
  s.stopRequested.store(false);
  s.pendingTsfFrames.store(0, std::memory_order_release);
  s.streamGeneration.fetch_add(1, std::memory_order_acq_rel);
}

Napi::Value CameraStartStream(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  std::lock_guard<std::mutex> lk(s.mu);
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");
  if (s.isStreaming.load()) {
    auto r = MakeReply(env, true);
    r.Set("alreadyStreaming", Napi::Boolean::New(env, true));
    return r;
  }
  ConfigureLowLatencyBufferLocked("stream-start");
  dvpStatus rs = s.dll.Start(s.handle);
  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "START_FAILED", "dvpStart status=" + std::to_string(rs));
  }
  const int drained = DrainSdkFrames(0, 16);
  if (drained > 0) {
    fprintf(stderr, "[camera-sdk-flush] reason=stream-start drained=%d\n", drained);
    fflush(stderr);
  }
  s.stopRequested.store(false);
  s.isStreaming.store(true);
  s.pendingTsfFrames.store(0, std::memory_order_release);
  s.droppedFrames.store(0, std::memory_order_release);
  s.streamGeneration.fetch_add(1, std::memory_order_acq_rel);
  s.streamThread = std::thread(StreamLoop);
  EmitStatus("event", "streaming");
  return MakeReply(env, true);
}

// cameraFlushStream({ reason }) — drain the SDK's internal ring buffer of
// pre-objective-change frames. Bumps the stream generation so any frame that
// was already queued into the TSF callback gets dropped on arrival in JS.
// Then pulls frames from the SDK with a short timeout until the ring is
// empty, discarding them without queueing to TSF.
Napi::Value CameraFlushStream(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  std::string reason = "objective-change";
  if (info.Length() > 0 && info[0].IsObject()) {
    auto opts = info[0].As<Napi::Object>();
    if (opts.Has("reason") && opts.Get("reason").IsString()) {
      reason = opts.Get("reason").As<Napi::String>().Utf8Value();
    }
  }
  // No mutex — flush is called from the same JS thread as start/stop, and
  // the stream thread reads streamGeneration with acquire ordering.
  if (!s.isStreaming.load()) {
    auto r = MakeReply(env, true);
    r.Set("notStreaming", Napi::Boolean::New(env, true));
    return r;
  }
  const uint64_t newGen = s.streamGeneration.fetch_add(1, std::memory_order_acq_rel) + 1;

  // Best-effort drain. The stream thread is concurrent and will pick up after
  // we return — the generation bump guarantees already-queued TSF frames drop.
  int drained = DrainSdkFrames(10, 16);
  fprintf(stderr, "[camera-sdk-flush] reason=%s drained=%d\n", reason.c_str(), drained);
  fflush(stderr);
  auto r = MakeReply(env, true);
  r.Set("generation", Napi::Number::New(env, static_cast<double>(newGen)));
  r.Set("drained", Napi::Number::New(env, drained));
  return r;
}

Napi::Value CameraStopStream(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  std::lock_guard<std::mutex> lk(s.mu);
  if (!s.isStreaming.load()) {
    auto r = MakeReply(env, true);
    r.Set("alreadyStopped", Napi::Boolean::New(env, true));
    return r;
  }
  StopStreamLocked();
  EmitStatus("event", "stopped");
  return MakeReply(env, true);
}

/* ------------------------------------------------------------------ */
/* cameraGetFrame({ timeoutMs }) — one-shot snapshot                    */
/* ------------------------------------------------------------------ */
Napi::Value CameraGetFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");
  dvpUint32 timeoutMs = 4000;
  if (info.Length() > 0 && info[0].IsObject()) {
    auto opts = info[0].As<Napi::Object>();
    if (opts.Has("timeoutMs") && opts.Get("timeoutMs").IsNumber()) {
      timeoutMs = opts.Get("timeoutMs").As<Napi::Number>().Uint32Value();
    }
  }
  bool startedHere = false;
  if (!s.isStreaming.load()) {
    if (s.dll.Start(s.handle) != DVP_STATUS_OK) {
      return MakeError(env, "START_FAILED", "dvpStart failed for one-shot");
    }
    startedHere = true;
  }
  dvpFrame frame{};
  void* pBuffer = nullptr;
  dvpStatus rs = s.dll.GetFrame(s.handle, &frame, &pBuffer, timeoutMs);
  if (startedHere) s.dll.Stop(s.handle);
  if (rs == DVP_STATUS_TIME_OUT) return MakeError(env, "STREAM_TIMEOUT", "dvpGetFrame timed out");
  if (rs != DVP_STATUS_OK || !pBuffer || frame.uBytes == 0) {
    return MakeError(env, "GET_FRAME_FAILED", "dvpGetFrame status=" + std::to_string(rs));
  }
  // V8-owned copy — Electron's IPC structured-clone refuses external buffers,
  // so we must not return a Buffer that wraps SDK or heap memory via a
  // finalizer. Buffer::Copy allocates inside V8 and memcpys for us.
  for (int i = 0; i < 16; ++i) {
    dvpFrame nf{};
    void* np = nullptr;
    dvpStatus nrs = s.dll.GetFrame(s.handle, &nf, &np, 0);
    if (nrs != DVP_STATUS_OK || !np || nf.uBytes == 0) break;
    frame = nf;
    pBuffer = np;
  }
  const uint64_t grabTs = NowMs();
  fprintf(
      stderr,
      "[camera-native-grab] frameId=%llu grabTs=%llu width=%d height=%d\n",
      static_cast<unsigned long long>(frame.uFrameID),
      static_cast<unsigned long long>(grabTs),
      frame.iWidth,
      frame.iHeight);
  fprintf(
      stderr,
      "[camera-native-send] frameId=%llu sendTs=%llu ageMs=0\n",
      static_cast<unsigned long long>(frame.uFrameID),
      static_cast<unsigned long long>(grabTs));
  fflush(stderr);
  auto data = Napi::Buffer<uint8_t>::Copy(env, static_cast<const uint8_t*>(pBuffer), frame.uBytes);
  auto r = MakeReply(env, true);
  r.Set("data", data);
  r.Set("width", Napi::Number::New(env, frame.iWidth));
  r.Set("height", Napi::Number::New(env, frame.iHeight));
  r.Set("pixelFormat", Napi::String::New(env, FormatToString(frame.format)));
  r.Set("bits", Napi::Number::New(env, frame.bits == BITS_16 ? 16 : 8));
  r.Set("timestamp", Napi::Number::New(env, static_cast<double>(frame.uTimestamp)));
  r.Set("seq", Napi::Number::New(env, static_cast<double>(frame.uFrameID)));
  r.Set("frameId", Napi::Number::New(env, static_cast<double>(frame.uFrameID)));
  r.Set("grabTs", Napi::Number::New(env, static_cast<double>(grabTs)));
  r.Set("bytes", Napi::Number::New(env, static_cast<double>(frame.uBytes)));
  return r;
}

/* ------------------------------------------------------------------ */
/* cameraGetStatus()                                                    */
/* ------------------------------------------------------------------ */
Napi::Value CameraGetStatus(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  auto r = MakeReply(env, true);
  r.Set("sdkLoaded", Napi::Boolean::New(env, s.dll.loaded()));
  r.Set("open", Napi::Boolean::New(env, s.isOpen.load()));
  r.Set("streaming", Napi::Boolean::New(env, s.isStreaming.load()));
  r.Set("width", Napi::Number::New(env, s.lastWidth));
  r.Set("height", Napi::Number::New(env, s.lastHeight));
  if (!s.lastError.empty()) r.Set("lastError", Napi::String::New(env, s.lastError));
  if (!s.dll.loaded() && !s.dll.loadError.empty()) {
    r.Set("loadError", Napi::String::New(env, s.dll.loadError));
  }
  return r;
}

Napi::Value CameraSetExposure(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  if (info.Length() < 1 || !info[0].IsObject()) return MakeError(env, "BAD_ARGS", "expected { valueMs }");
  auto opts = info[0].As<Napi::Object>();
  double ms = 0.0;
  if (opts.Has("valueMs") && opts.Get("valueMs").IsNumber()) {
    ms = opts.Get("valueMs").As<Napi::Number>().DoubleValue();
  } else if (opts.Has("valueUs") && opts.Get("valueUs").IsNumber()) {
    ms = opts.Get("valueUs").As<Napi::Number>().DoubleValue() / 1000.0;
  } else {
    return MakeError(env, "BAD_ARGS", "expected numeric valueMs");
  }

  std::lock_guard<std::mutex> lk(s.mu);
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");

  // Clamp against SDK descriptor range so out-of-bound values don't fail.
  if (s.dll.GetExposureDescr) {
    dvpDoubleDescr d{};
    if (s.dll.GetExposureDescr(s.handle, &d) == DVP_STATUS_OK) {
      ms = SnapDoubleToStep(ms, d.fMin, d.fMax, d.fStep);
    }
  }
  fprintf(stderr, "[native] set exposure value: %.3f\n", ms);
  fflush(stderr);

  const bool restartStreaming = s.isStreaming.load();
  if (restartStreaming) StopStreamLocked();

  dvpStatus aeRs = s.dll.SetAeOperation(s.handle, AE_OP_OFF);
  dvpStatus rs = s.dll.SetExposure(s.handle, ms);
  fprintf(stderr, "[native] set exposure result: %d (ae=%d)\n", rs, aeRs);
  fflush(stderr);

  dvpStatus restartRs = DVP_STATUS_OK;
  if (restartStreaming && s.isOpen.load()) {
    ConfigureLowLatencyBufferLocked("exposure-change");
    restartRs = s.dll.Start(s.handle);
    if (restartRs == DVP_STATUS_OK) {
      const int drained = DrainSdkFrames(0, 16);
      if (drained > 0) {
        fprintf(stderr, "[camera-sdk-flush] reason=exposure-change drained=%d\n", drained);
        fflush(stderr);
      }
      s.stopRequested.store(false);
      s.isStreaming.store(true);
      s.streamThread = std::thread(StreamLoop);
      EmitStatus("event", "streaming");
    }
  }

  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "SET_EXPOSURE_FAILED", "dvpSetExposure status=" + std::to_string(rs));
  }
  if (restartRs != DVP_STATUS_OK) {
    return MakeError(env, "RESTART_STREAM_FAILED", "dvpStart status=" + std::to_string(restartRs));
  }
  double cur = ms;
  s.dll.GetExposure(s.handle, &cur);
  auto r = MakeReply(env, true);
  r.Set("exposureMs", Napi::Number::New(env, cur));
  return r;
}

Napi::Value CameraGetExposureRange(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");
  if (!s.dll.GetExposureDescr) {
    return MakeError(env, "NO_DESCR", "dvpGetExposureDescr not loaded");
  }
  dvpDoubleDescr d{};
  dvpStatus rs = s.dll.GetExposureDescr(s.handle, &d);
  fprintf(stderr, "[native] GetExposureDescr result: %d min=%.3f max=%.3f step=%.3f def=%.3f\n",
          rs, d.fMin, d.fMax, d.fStep, d.fDefault);
  fflush(stderr);
  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "GET_EXP_RANGE_FAILED",
                     "dvpGetExposureDescr status=" + std::to_string(rs));
  }
  double cur = d.fDefault;
  if (s.dll.GetExposure) s.dll.GetExposure(s.handle, &cur);
  auto r = MakeReply(env, true);
  r.Set("min", Napi::Number::New(env, d.fMin));
  r.Set("max", Napi::Number::New(env, d.fMax));
  r.Set("step", Napi::Number::New(env, d.fStep));
  r.Set("default", Napi::Number::New(env, d.fDefault));
  r.Set("current", Napi::Number::New(env, cur));
  return r;
}

Napi::Value CameraSetGain(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  if (info.Length() < 1 || !info[0].IsObject()) return MakeError(env, "BAD_ARGS", "expected { value }");
  auto opts = info[0].As<Napi::Object>();
  if (!opts.Has("value") || !opts.Get("value").IsNumber()) {
    return MakeError(env, "BAD_ARGS", "expected numeric value");
  }
  float gain = opts.Get("value").As<Napi::Number>().FloatValue();

  std::lock_guard<std::mutex> lk(s.mu);
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");

  if (s.dll.GetAnalogGainDescr) {
    dvpFloatDescr d{};
    if (s.dll.GetAnalogGainDescr(s.handle, &d) == DVP_STATUS_OK) {
      gain = SnapFloatToStep(gain, d.fMin, d.fMax, d.fStep);
    }
  }
  fprintf(stderr, "[native] set gain value: %.3f\n", gain);
  fflush(stderr);

  const bool restartStreaming = s.isStreaming.load();
  if (restartStreaming) StopStreamLocked();

  dvpStatus aeRs = s.dll.SetAeOperation(s.handle, AE_OP_OFF);
  dvpStatus rs = s.dll.SetAnalogGain(s.handle, gain);
  fprintf(stderr, "[native] set gain result: %d (ae=%d)\n", rs, aeRs);
  fflush(stderr);

  dvpStatus restartRs = DVP_STATUS_OK;
  if (restartStreaming && s.isOpen.load()) {
    ConfigureLowLatencyBufferLocked("gain-change");
    restartRs = s.dll.Start(s.handle);
    if (restartRs == DVP_STATUS_OK) {
      const int drained = DrainSdkFrames(0, 16);
      if (drained > 0) {
        fprintf(stderr, "[camera-sdk-flush] reason=gain-change drained=%d\n", drained);
        fflush(stderr);
      }
      s.stopRequested.store(false);
      s.isStreaming.store(true);
      s.streamThread = std::thread(StreamLoop);
      EmitStatus("event", "streaming");
    }
  }

  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "SET_GAIN_FAILED", "dvpSetAnalogGain status=" + std::to_string(rs));
  }
  if (restartRs != DVP_STATUS_OK) {
    return MakeError(env, "RESTART_STREAM_FAILED", "dvpStart status=" + std::to_string(restartRs));
  }
  float cur = gain;
  s.dll.GetAnalogGain(s.handle, &cur);
  auto r = MakeReply(env, true);
  r.Set("gain", Napi::Number::New(env, cur));
  return r;
}

Napi::Value CameraGetGainRange(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");
  if (!s.dll.GetAnalogGainDescr) {
    return MakeError(env, "NO_DESCR", "dvpGetAnalogGainDescr not loaded");
  }
  dvpFloatDescr d{};
  dvpStatus rs = s.dll.GetAnalogGainDescr(s.handle, &d);
  fprintf(stderr, "[native] GetAnalogGainDescr result: %d min=%.3f max=%.3f step=%.3f def=%.3f\n",
          rs, d.fMin, d.fMax, d.fStep, d.fDefault);
  fflush(stderr);
  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "GET_GAIN_RANGE_FAILED",
                     "dvpGetAnalogGainDescr status=" + std::to_string(rs));
  }
  float cur = d.fDefault;
  if (s.dll.GetAnalogGain) s.dll.GetAnalogGain(s.handle, &cur);
  auto r = MakeReply(env, true);
  r.Set("min", Napi::Number::New(env, d.fMin));
  r.Set("max", Napi::Number::New(env, d.fMax));
  r.Set("step", Napi::Number::New(env, d.fStep));
  r.Set("default", Napi::Number::New(env, d.fDefault));
  r.Set("current", Napi::Number::New(env, cur));
  return r;
}

Napi::Value CameraSetTriggerMode(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");
  bool value = false;
  if (info.Length() > 0 && info[0].IsObject()) {
    auto opts = info[0].As<Napi::Object>();
    if (opts.Has("value")) value = opts.Get("value").ToBoolean().Value();
  }
  dvpStatus rs = s.dll.SetTriggerState(s.handle, value);
  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "SET_TRIGGER_FAILED", "dvpSetTriggerState status=" + std::to_string(rs));
  }
  bool cur = value;
  s.dll.GetTriggerState(s.handle, &cur);
  auto r = MakeReply(env, true);
  r.Set("triggerState", Napi::Boolean::New(env, cur));
  return r;
}

Napi::Value Shutdown(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  std::lock_guard<std::mutex> lk(s.mu);
  if (s.isStreaming.load()) StopStreamLocked();
  if (s.isOpen.load() && s.dll.Close && s.handle) s.dll.Close(s.handle);
  s.handle = 0;
  s.isOpen.store(false);
  if (s.tsfFrame) { s.tsfFrame.Release(); s.tsfFrame = Napi::ThreadSafeFunction(); }
  if (s.tsfStatus) { s.tsfStatus.Release(); s.tsfStatus = Napi::ThreadSafeFunction(); }
  DvpDll_Unload(s.dll);
  return MakeReply(env, true);
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  auto cam = Napi::Object::New(env);
  cam.Set("bootstrap",          Napi::Function::New(env, Bootstrap));
  cam.Set("setEventCallbacks",  Napi::Function::New(env, SetEventCallbacks));
  cam.Set("cameraOpen",         Napi::Function::New(env, CameraOpen));
  cam.Set("cameraClose",        Napi::Function::New(env, CameraClose));
  cam.Set("cameraStartStream",  Napi::Function::New(env, CameraStartStream));
  cam.Set("cameraStopStream",   Napi::Function::New(env, CameraStopStream));
  cam.Set("cameraFlushStream",  Napi::Function::New(env, CameraFlushStream));
  cam.Set("cameraGetFrame",     Napi::Function::New(env, CameraGetFrame));
  cam.Set("cameraGetStatus",    Napi::Function::New(env, CameraGetStatus));
  cam.Set("cameraSetExposure",  Napi::Function::New(env, CameraSetExposure));
  cam.Set("cameraGetExposureRange", Napi::Function::New(env, CameraGetExposureRange));
  cam.Set("cameraSetGain",      Napi::Function::New(env, CameraSetGain));
  cam.Set("cameraGetGainRange", Napi::Function::New(env, CameraGetGainRange));
  cam.Set("cameraSetTriggerMode", Napi::Function::New(env, CameraSetTriggerMode));
  cam.Set("measureVickersAuto",  Napi::Function::New(env, hardness_vickers::MeasureVickersAuto));
  cam.Set("shutdown",           Napi::Function::New(env, Shutdown));
  exports.Set("camera", cam);
  return exports;
}

}  // namespace hardness_camera
