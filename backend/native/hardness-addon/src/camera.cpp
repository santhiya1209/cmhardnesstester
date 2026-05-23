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

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

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

  // Atomic LATEST-FRAME-ONLY slot between the native stream thread and the
  // JS callback. The stream thread ALWAYS overwrites the slot with the newest
  // pixels; the TSF task carries no payload. When JS finally dispatches the
  // TSF callback, it pulls *whatever is currently in the slot* — that is
  // ALWAYS the freshest grab, never a stale one that was queued seconds ago
  // while the event loop was blocked. This kills the prior failure mode
  // where TSF would deliver an N00ms-old frame and we'd drop it as
  // "stale-native-send", losing one full SDK→JS round trip.
  struct LatestSlot {
    std::mutex            mu;
    std::vector<uint8_t>  bytes;       // pixel buffer; capacity is reused
    int                   width = 0;
    int                   height = 0;
    const char*           pixelFormat = "raw";
    int                   bits = 8;
    uint64_t              timestamp = 0;
    uint64_t              seq = 0;
    uint64_t              grabTs = 0;
    uint64_t              generation = 0;
    bool                  hasFrame = false;
  };
  LatestSlot             latestSlot;
  // Buffer reused by DispatchLatest. On each dispatch we SWAP slot.bytes
  // with this buffer instead of MOVE'ing — preserves capacity across calls
  // so vector::assign on the stream-thread hot path never reallocates
  // after the first few frames. Accessed only from the JS thread inside
  // DispatchLatest (protected indirectly by tsfDispatchPending exclusion).
  std::vector<uint8_t>   dispatchSpare;
  // True iff a TSF task is currently queued / executing. CAS'd false→true
  // by the stream thread when it queues a dispatch, set back to false by
  // the TSF callback after it has taken its snapshot from the slot.
  std::atomic<bool>      tsfDispatchPending{false};

  std::atomic<uint64_t>  latestGrabbedFrameId{0};
  std::atomic<uint64_t>  droppedFrames{0};
  std::atomic<uint64_t>  streamGeneration{0};

  // 1Hz throttle anchors for per-stage diagnostic logs. Per-frame logs at
  // full FPS flood stderr and themselves add latency (stdio is line-buffered).
  // Drops are ALWAYS logged (not throttled) — they are the signal.
  std::atomic<uint64_t>  lastGrabLogMs{0};
  std::atomic<uint64_t>  lastAgeLogMs{0};
  std::atomic<uint64_t>  lastSendLogMs{0};
  std::atomic<uint64_t>  lastLoopLogMs{0};
  std::atomic<uint64_t>  lastSlotAgeLogMs{0};
  // Wallclock of previous stream-loop slot write — used to compute the
  // actual native cycle interval (SDK delivery cadence + drain + copy).
  std::atomic<uint64_t>  lastSlotWriteMs{0};

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

void LogSdkBufferFlush(const char* reason, int drained) {
}

void ResetNativeLatestSlot(const char* reason, bool clearDispatchPending) {
  auto& s = S();
  bool hadFrame = false;
  {
    std::lock_guard<std::mutex> lk(s.latestSlot.mu);
    hadFrame = s.latestSlot.hasFrame;
    s.latestSlot.hasFrame = false;
    s.latestSlot.bytes.clear();
  }
  if (clearDispatchPending) {
    s.tsfDispatchPending.store(false, std::memory_order_release);
  }
  s.latestGrabbedFrameId.store(0, std::memory_order_release);
  s.lastSlotWriteMs.store(0, std::memory_order_release);
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
  ResetNativeLatestSlot("open", true);
  s.lastError.clear();

  // Default to continuous streaming mode (trigger off).
  s.dll.SetTriggerState(h, false);

  // Disable auto-exposure so manual exposure/gain settings actually stick.
  // Without this, the SDK's continuous AE loop overrides every value we set
  // a few frames later, and the user sees the slider have no effect.
  s.dll.SetAeOperation(h, AE_OP_OFF);
  if (s.dll.SetRoiState) {
    s.dll.SetRoiState(h, false);
  }
  ConfigureLowLatencyBufferLocked("open");
  LogSdkBufferFlush("open", DrainSdkFrames(0, 16));
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
  ResetNativeLatestSlot("close", true);
  EmitStatus("event", "closed");
  return MakeReply(env, true);
}

/* ------------------------------------------------------------------ */
/* Stream worker                                                        */
/* ------------------------------------------------------------------ */

// Forward declaration: TSF callback that pulls the latest frame from the slot.
void DispatchLatest(Napi::Env env, Napi::Function fn);

// Native age threshold (ms). A frame older than this at TSF dispatch time
// is dropped before crossing into JS. Mirrors STALE_AGE_MS on the JS side.
constexpr uint64_t kNativeStaleAgeMs = 100;

void StreamLoop() {
  auto& s = S();

#ifdef _WIN32
  // Boost the grab thread above normal so the OS doesn't preempt us for
  // background work between SDK frames. HIGHEST is enough — TIME_CRITICAL
  // risks starving the JS event loop. Stream thread spends most of its
  // time blocked inside dvpGetFrame, so this priority is not abusive.
  SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
#endif

  // Thread-local staging buffer. memcpy happens INTO this OUTSIDE the slot
  // lock; we then swap pointers under the lock (sub-microsecond). After
  // the swap, staging holds whatever was previously in the slot — its
  // capacity is preserved, so subsequent assign() calls do not reallocate.
  std::vector<uint8_t> streamStaging;

  while (!s.stopRequested.load()) {
    dvpFrame frame{};
    void* pBuffer = nullptr;
    // 500ms timeout (was 4000ms). Shorter timeout means a stalled camera
    // is detected — and stopRequested re-checked — within 0.5s instead of
    // 4s. Does NOT affect steady-state FPS: GetFrame returns as soon as a
    // frame arrives. TIME_OUT just causes a loop continue.
    const auto getFrameT0 = std::chrono::steady_clock::now();
    dvpStatus rs = s.dll.GetFrame(s.handle, &frame, &pBuffer, 500);
    const auto getFrameT1 = std::chrono::steady_clock::now();
    const double getFrameMs =
        std::chrono::duration<double, std::milli>(getFrameT1 - getFrameT0).count();
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

    s.latestGrabbedFrameId.store(
        static_cast<uint64_t>(frame.uFrameID),
        std::memory_order_release);

    const uint64_t grabTs = NowMs();

    // [camera-sdk-grab] — throttled 1Hz.
    {
      const uint64_t last = s.lastGrabLogMs.load(std::memory_order_relaxed);
      if (grabTs - last >= 5000) {
        s.lastGrabLogMs.store(grabTs, std::memory_order_relaxed);
      }
    }

    // memcpy OUTSIDE the slot mutex. vector::assign on a buffer whose
    // capacity already matches is just a memcpy; on the first frame after
    // a buffer rotation it may reallocate, but capacity stabilizes after
    // ~3 frames and stays put.
    const auto copyT0 = std::chrono::steady_clock::now();
    {
      const uint8_t* src = static_cast<const uint8_t*>(pBuffer);
      streamStaging.assign(src, src + frame.uBytes);
    }
    const auto copyT1 = std::chrono::steady_clock::now();
    const double copyMs =
        std::chrono::duration<double, std::milli>(copyT1 - copyT0).count();

    // Lock + swap. Hold time is sub-microsecond: a metadata write plus a
    // std::vector pointer-swap. Previously this section memcpy'd 15MB
    // under the lock for ~5–10ms per frame; that contention is gone.
    {
      std::lock_guard<std::mutex> lk(s.latestSlot.mu);
      if (s.latestSlot.hasFrame) {
        const uint64_t prevAgeMs =
            grabTs > s.latestSlot.grabTs ? grabTs - s.latestSlot.grabTs : 0;
        s.droppedFrames.fetch_add(1, std::memory_order_relaxed);
      }
      std::swap(s.latestSlot.bytes, streamStaging);
      s.latestSlot.width = frame.iWidth;
      s.latestSlot.height = frame.iHeight;
      s.latestSlot.pixelFormat = FormatToString(frame.format);
      s.latestSlot.bits = frame.bits == BITS_16 ? 16 : 8;
      s.latestSlot.timestamp = frame.uTimestamp;
      s.latestSlot.seq = frame.uFrameID;
      s.latestSlot.grabTs = grabTs;
      s.latestSlot.generation = s.streamGeneration.load(std::memory_order_acquire);
      s.latestSlot.hasFrame = true;
    }

    // Track and log the stream-loop interval — the actual cadence at which
    // we are able to write fresh frames into the slot. If this is, say,
    // 150ms, then the slot CAN be 150ms old at peak and there is nothing
    // the JS side can do about it. This number is the floor of live
    // latency; everything above must come from JS/IPC/render.
    {
      const uint64_t prevLoopMs =
          s.lastSlotWriteMs.exchange(grabTs, std::memory_order_acq_rel);
      const uint64_t lastLog = s.lastLoopLogMs.load(std::memory_order_relaxed);
      if (prevLoopMs > 0 && grabTs - lastLog >= 5000) {
        s.lastLoopLogMs.store(grabTs, std::memory_order_relaxed);
        const uint64_t intervalMs = grabTs > prevLoopMs ? grabTs - prevLoopMs : 0;
        const double fps = intervalMs > 0 ? 1000.0 / static_cast<double>(intervalMs) : 0.0;
        // Pull current exposure live so the FPS-limit correlation is
        // visible in the same line — if exposureUs / 1000 ≈ intervalMs,
        // the bottleneck is the camera sensor, not the software.
        // SDK GetExposure returns microseconds; convert to ms here.
        double exposureMs = -1.0;
        if (s.dll.GetExposure && s.handle) {
          double curUs = 0.0;
          if (s.dll.GetExposure(s.handle, &curUs) == DVP_STATUS_OK) {
            exposureMs = curUs / 1000.0;
          }
        }
        const double fpsLimit =
            exposureMs > 0.0 ? 1000.0 / exposureMs : -1.0;
        // Per-frame work breakdown. Together with intervalMs these tell
        // you exactly where the cycle time lives:
        //   getFrameMs ≈ intervalMs → SDK/USB/sensor is the floor (blocking
        //     on the next frame). Lowering exposure helps; otherwise this
        //     is a hardware ceiling at the current ROI + pixel format.
        //   copyMs large (10–30ms) → 15MB memcpy is significant. mono8 at
        //     same resolution would be 3× smaller, but the SDK build does
        //     not expose SetImageFormat to switch.
        //   getFrameMs small + intervalMs large → something else is pacing
        //     the loop (rare; would be unexpected).
        // Frame-shape facts. These are constant unless the SDK's ROI /
        // pixel format change (which our current bindings cannot trigger
        // — verified against include/dvp.h, no SetRoi/SetImageFormat).
        // Printed at the same 5s heartbeat for easy correlation.
      }
    }

    // Ensure one TSF dispatch is queued. If pending=true a callback is
    // already in flight (or queued) and will pick up the slot — no need
    // to enqueue another. If pending=false, CAS to true and post the task.
    bool expected = false;
    if (s.tsfDispatchPending.compare_exchange_strong(
            expected, true, std::memory_order_acq_rel)) {
      if (s.tsfFrame) {
        auto status = s.tsfFrame.NonBlockingCall(DispatchLatest);
        if (status != napi_ok) {
          // Couldn't enqueue (queue closed / shutting down). Clear the
          // pending flag so a later attempt can retry; the slot data is
          // already safe in the mutex-protected slot — no leak.
          s.tsfDispatchPending.store(false, std::memory_order_release);
        }
      } else {
        s.tsfDispatchPending.store(false, std::memory_order_release);
      }
    }
  }
  s.isStreaming.store(false);
  EmitStatus("event", "streaming-stopped");
}

// TSF callback. Pulls the LATEST frame currently in the slot — not whatever
// was newest when this task was queued. This is the entire point of the
// atomic-slot design: when the JS event loop unblocks after a long pause,
// we deliver fresh pixels (1–5ms old), never the stale frame that was
// queued 200+ms ago.
void DispatchLatest(Napi::Env env, Napi::Function fn) {
  auto& st = S();
  int width = 0, height = 0, bits = 8;
  const char* pixelFormat = "raw";
  uint64_t timestamp = 0, seq = 0, grabTs = 0, generation = 0;
  bool valid = false;
  {
    std::lock_guard<std::mutex> lk(st.latestSlot.mu);
    if (st.latestSlot.hasFrame) {
      // Swap (not move) so slot.bytes inherits dispatchSpare's preserved
      // capacity. Lock hold time is one pointer-swap + metadata copy.
      std::swap(st.latestSlot.bytes, st.dispatchSpare);
      width = st.latestSlot.width;
      height = st.latestSlot.height;
      pixelFormat = st.latestSlot.pixelFormat;
      bits = st.latestSlot.bits;
      timestamp = st.latestSlot.timestamp;
      seq = st.latestSlot.seq;
      grabTs = st.latestSlot.grabTs;
      generation = st.latestSlot.generation;
      st.latestSlot.hasFrame = false;
      valid = true;
    }
  }
  // Reference to the just-swapped-out buffer for the V8 copy below. The
  // V8 Buffer::Copy memcpy happens OUTSIDE the slot lock.
  std::vector<uint8_t>& bytes = st.dispatchSpare;
  // Release the pending flag BEFORE the (long) V8 copy + fn.Call. If the
  // stream thread writes a new frame after this point, it will see
  // pending=false and CAS in a fresh dispatch — at most one extra TSF task
  // queued in parallel, which is fine (next dispatch will find an empty
  // slot and exit cheaply).
  st.tsfDispatchPending.store(false, std::memory_order_release);
  if (!valid) return;

  // Flush guard — discard frames captured before the most recent generation.
  if (generation < st.streamGeneration.load(std::memory_order_acquire)) {
    st.droppedFrames.fetch_add(1, std::memory_order_relaxed);
    return;
  }

  const uint64_t sendTs = NowMs();
  const uint64_t ageMs = sendTs >= grabTs ? sendTs - grabTs : 0;

  // [camera-native-slot-age] — the wallclock age of the frame currently in
  // the slot at dispatch time. ALWAYS log when > 50ms (rare, important
  // signal that the stream loop interval is the bottleneck). Otherwise
  // throttle to 1Hz as a heartbeat.
  {
    const bool stale = ageMs > kNativeStaleAgeMs;
    const uint64_t lastSlot = st.lastSlotAgeLogMs.load(std::memory_order_relaxed);
    if (stale || sendTs - lastSlot >= 5000) {
      st.lastSlotAgeLogMs.store(sendTs, std::memory_order_relaxed);
    }
  }
  // NOTE: We do NOT drop here on age. The slot IS the newest available
  // frame — dropping it produces no fresher replacement, only a longer gap
  // until the next SDK delivery. The JS-side age gate still applies for
  // the live render path; the snapshot pool (latestFullFrame) accepts
  // whatever native delivers so Auto Measure is never starved.

  // [camera-sdk-age] and [camera-js-dispatch-ms] — same wallclock value
  // (slot-write → JS-dispatch latency), throttled 5s. If this is small
  // (<10ms) but per-frame intervalMs is large, the SDK loop is the cap,
  // not the native→JS handoff. If this spikes, the JS event loop is
  // blocked on something.
  {
    const uint64_t lastAge = st.lastAgeLogMs.load(std::memory_order_relaxed);
    if (sendTs - lastAge >= 5000) {
      st.lastAgeLogMs.store(sendTs, std::memory_order_relaxed);
    }
  }

  // V8-owned copy. Electron's IPC structured-clone refuses external buffers.
  auto u8 = Napi::Buffer<uint8_t>::Copy(env, bytes.data(), bytes.size());
  auto meta = Napi::Object::New(env);
  meta.Set("width", Napi::Number::New(env, width));
  meta.Set("height", Napi::Number::New(env, height));
  meta.Set("pixelFormat", Napi::String::New(env, pixelFormat));
  meta.Set("bits", Napi::Number::New(env, bits));
  meta.Set("timestamp", Napi::Number::New(env, static_cast<double>(timestamp)));
  meta.Set("seq", Napi::Number::New(env, static_cast<double>(seq)));
  meta.Set("frameId", Napi::Number::New(env, static_cast<double>(seq)));
  meta.Set("grabTs", Napi::Number::New(env, static_cast<double>(grabTs)));
  meta.Set("bytes", Napi::Number::New(env, static_cast<double>(bytes.size())));
  meta.Set("generation", Napi::Number::New(env, static_cast<double>(generation)));

  // [camera-frame-send] — throttled 1Hz.
  {
    const uint64_t lastSend = st.lastSendLogMs.load(std::memory_order_relaxed);
    if (sendTs - lastSend >= 5000) {
      st.lastSendLogMs.store(sendTs, std::memory_order_relaxed);
    }
  }

  fn.Call({meta, u8});
}

void StopStreamLocked() {
  auto& s = S();
  if (!s.isStreaming.load()) return;
  s.stopRequested.store(true);
  if (s.dll.Stop && s.handle) s.dll.Stop(s.handle);
  if (s.streamThread.joinable()) s.streamThread.join();
  s.isStreaming.store(false);
  s.stopRequested.store(false);
  ResetNativeLatestSlot("stop-stream", true);
  s.streamGeneration.fetch_add(1, std::memory_order_acq_rel);
  fprintf(stderr,
          "[camera-stream-stop] droppedFrames=%llu\n",
          static_cast<unsigned long long>(s.droppedFrames.load()));
  fflush(stderr);
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
    LogSdkBufferFlush("stream-start", drained);
  }
  s.stopRequested.store(false);
  s.isStreaming.store(true);
  ResetNativeLatestSlot("stream-start", true);
  s.droppedFrames.store(0, std::memory_order_release);

  s.streamGeneration.fetch_add(1, std::memory_order_acq_rel);
  s.streamThread = std::thread(StreamLoop);

  // One-shot stream-start summary. Replaces the per-frame and per-stage
  // spam stripped from this file; logged once per stream activation.
  {
    double exposureMs = -1.0;
    if (s.dll.GetExposure && s.handle) {
      double curUs = 0.0;
      if (s.dll.GetExposure(s.handle, &curUs) == DVP_STATUS_OK) {
        exposureMs = curUs / 1000.0;
      }
    }
    const double fpsLimit = exposureMs > 0.0 ? 1000.0 / exposureMs : -1.0;
    fprintf(stderr,
            "[camera-stream-start] width=%d height=%d exposureMs=%.2f fpsLimit=%.1f\n",
            s.lastWidth, s.lastHeight, exposureMs, fpsLimit);
    fflush(stderr);
  }

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
  ResetNativeLatestSlot(reason.c_str(), false);

  // Reset the native latest slot immediately so no pre-change frame can be
  // dispatched after the SDK flush.
  // Best-effort drain. The stream thread is concurrent and will pick up after
  // we return — the generation bump guarantees already-queued TSF frames drop.
  int drained = DrainSdkFrames(10, 16);
  LogSdkBufferFlush(reason.c_str(), drained);
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
  double uiMs = 0.0;
  if (opts.Has("valueMs") && opts.Get("valueMs").IsNumber()) {
    uiMs = opts.Get("valueMs").As<Napi::Number>().DoubleValue();
  } else if (opts.Has("valueUs") && opts.Get("valueUs").IsNumber()) {
    uiMs = opts.Get("valueUs").As<Napi::Number>().DoubleValue() / 1000.0;
  } else {
    return MakeError(env, "BAD_ARGS", "expected numeric valueMs");
  }

  // DVP SDK unit is MICROSECONDS, not milliseconds. Empirical proof from
  // earlier session: requesting 33 (as-if-ms) → SDK clamped to its real
  // minimum (~10000 µs) and read back 10009.56; under a "ms" reading that
  // would be 10s exposure / 0.1 FPS — matched. Prior steady-state value
  // 30028.69 with 8 FPS only fits if interpreted as 30028 µs = 30 ms
  // (33 FPS theoretical, USB-bound to 8). All SDK calls below pass µs;
  // we convert at this single boundary.
  double sdkUs = uiMs * 1000.0;

  std::lock_guard<std::mutex> lk(s.mu);
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");

  // Clamp against SDK descriptor range (descriptor is also in µs).
  if (s.dll.GetExposureDescr) {
    dvpDoubleDescr d{};
    if (s.dll.GetExposureDescr(s.handle, &d) == DVP_STATUS_OK) {
      const double snapped = SnapDoubleToStep(sdkUs, d.fMin, d.fMax, d.fStep);
      sdkUs = snapped;
    } else {
    }
  }


  const bool restartStreaming = s.isStreaming.load();
  if (restartStreaming) StopStreamLocked();

  dvpStatus aeRs = s.dll.SetAeOperation(s.handle, AE_OP_OFF);
  dvpStatus rs = s.dll.SetExposure(s.handle, sdkUs);

  dvpStatus restartRs = DVP_STATUS_OK;
  if (restartStreaming && s.isOpen.load()) {
    ConfigureLowLatencyBufferLocked("exposure-change");
    restartRs = s.dll.Start(s.handle);
    if (restartRs == DVP_STATUS_OK) {
      const int drained = DrainSdkFrames(0, 16);
      if (drained > 0) {
        LogSdkBufferFlush("exposure-change", drained);
      }
      s.stopRequested.store(false);
      s.isStreaming.store(true);
      ResetNativeLatestSlot("exposure-change", true);
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

  // Read back in SDK units (µs) then convert to ms for the JS reply.
  double readbackUs = sdkUs;
  s.dll.GetExposure(s.handle, &readbackUs);
  const double readbackMs = readbackUs / 1000.0;

  // The DVP SDK in this build exposes no SetFrameRate. Max attainable FPS
  // = 1000 / exposureMs (sensor readout / USB bandwidth is a separate cap).
  const double fpsTarget = uiMs > 0.0 ? 1000.0 / uiMs : -1.0;
  const double fpsConfirmed = readbackMs > 0.0 ? 1000.0 / readbackMs : -1.0;

  auto r = MakeReply(env, true);
  r.Set("exposureMs", Napi::Number::New(env, readbackMs));
  r.Set("fpsCeiling", Napi::Number::New(env, fpsConfirmed));
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
  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "GET_EXP_RANGE_FAILED",
                     "dvpGetExposureDescr status=" + std::to_string(rs));
  }
  double curUs = d.fDefault;
  if (s.dll.GetExposure) s.dll.GetExposure(s.handle, &curUs);
  // Descriptor + current are in microseconds (SDK unit). Convert to
  // milliseconds for the JS reply so the renderer's slider operates in
  // true ms — matching the unit our setExposure receives.
  auto r = MakeReply(env, true);
  r.Set("min", Napi::Number::New(env, d.fMin / 1000.0));
  r.Set("max", Napi::Number::New(env, d.fMax / 1000.0));
  r.Set("step", Napi::Number::New(env, d.fStep / 1000.0));
  r.Set("default", Napi::Number::New(env, d.fDefault / 1000.0));
  r.Set("current", Napi::Number::New(env, curUs / 1000.0));
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

  const bool restartStreaming = s.isStreaming.load();
  if (restartStreaming) StopStreamLocked();

  dvpStatus aeRs = s.dll.SetAeOperation(s.handle, AE_OP_OFF);
  dvpStatus rs = s.dll.SetAnalogGain(s.handle, gain);

  dvpStatus restartRs = DVP_STATUS_OK;
  if (restartStreaming && s.isOpen.load()) {
    ConfigureLowLatencyBufferLocked("gain-change");
    restartRs = s.dll.Start(s.handle);
    if (restartRs == DVP_STATUS_OK) {
      const int drained = DrainSdkFrames(0, 16);
      if (drained > 0) {
        LogSdkBufferFlush("gain-change", drained);
      }
      s.stopRequested.store(false);
      s.isStreaming.store(true);
      ResetNativeLatestSlot("gain-change", true);
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

/* ------------------------------------------------------------------ */
/* Fast Live Preview surface                                           */
/* ------------------------------------------------------------------ */
//
// All four functions below assume the SDK extensions are present (the
// loader resolved them in dvp_dll.cpp via GetProcAddress). If a function
// pointer is null, the camera/firmware doesn't support that knob —
// return NO_METHOD instead of crashing so the renderer can fall back.
//
// Stream restart pattern (used by all setters that affect the data
// stream): Stop → apply → restart with same StreamLoop machinery the
// other Set* functions already use. The atomic-slot architecture
// (latestSlot, streamGeneration, tsfDispatchPending) is preserved.

static Napi::Value MakeNoMethod(Napi::Env env, const char* fnName) {
  return MakeError(env, "NO_METHOD",
                   std::string("camera SDK does not export ") + fnName);
}

static void RestartStreamLocked(State& s, const char* reason) {
  if (!s.isOpen.load() || !s.handle) return;
  ConfigureLowLatencyBufferLocked(reason);
  dvpStatus rs = s.dll.Start(s.handle);
  if (rs != DVP_STATUS_OK) {
    s.lastError = "dvpStart status=" + std::to_string(rs);
    return;
  }
  const int drained = DrainSdkFrames(0, 16);
  if (drained > 0) {
    LogSdkBufferFlush(reason, drained);
  }
  s.stopRequested.store(false);
  s.isStreaming.store(true);
  ResetNativeLatestSlot(reason, true);
  s.streamThread = std::thread(StreamLoop);
  EmitStatus("event", "streaming");
}

// Map a renderer-supplied format name to the SDK enum. Returns -1 on
// unknown name so the caller can BAD_ARGS.
static int ParseStreamFormat(const std::string& name) {
  if (name == "mono8")  return S_MONO8;
  if (name == "mono16") return S_MONO16;
  if (name == "raw8")   return S_RAW8;
  if (name == "raw10")  return S_RAW10;
  if (name == "raw12")  return S_RAW12;
  if (name == "raw14")  return S_RAW14;
  if (name == "raw16")  return S_RAW16;
  if (name == "bgr24")  return S_BGR24;
  if (name == "bgr32")  return S_BGR32;
  if (name == "rgb24")  return S_RGB24;
  if (name == "rgb32")  return S_RGB32;
  if (name == "ycbcr422") return S_YCBCR_422;
  return -1;
}

// cameraSetRoi({ x, y, w, h }) — sets ROI relative to the sensor. The
// SDK descriptor (dvpGetRoiDescr) reports legal min/max/step; we snap
// the caller's values to step and clamp to range so a bad input doesn't
// reject the whole call. Stream is restarted in-place; latest-only slot
// architecture is preserved.
Napi::Value CameraSetRoi(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  if (info.Length() < 1 || !info[0].IsObject()) {
    return MakeError(env, "BAD_ARGS", "expected { x, y, w, h }");
  }
  auto opts = info[0].As<Napi::Object>();
  auto readInt = [&](const char* key) -> int {
    if (!opts.Has(key) || !opts.Get(key).IsNumber()) return -1;
    return opts.Get(key).As<Napi::Number>().Int32Value();
  };
  int x = readInt("x"), y = readInt("y"), w = readInt("w"), h = readInt("h");
  if (x < 0 || y < 0 || w <= 0 || h <= 0) {
    return MakeError(env, "BAD_ARGS",
                     "x,y must be >=0 and w,h must be >0");
  }

  std::lock_guard<std::mutex> lk(s.mu);
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");
  if (!s.dll.SetRoi)   return MakeNoMethod(env, "dvpSetRoi");

  // Clamp + snap against descriptor if available.
  dvpRegionDescr descr{};
  bool haveDescr = false;
  if (s.dll.GetRoiDescr && s.dll.GetRoiDescr(s.handle, &descr) == DVP_STATUS_OK) {
    haveDescr = true;
    if (w < descr.iMinW) w = descr.iMinW;
    if (h < descr.iMinH) h = descr.iMinH;
    if (w > descr.iMaxW) w = descr.iMaxW;
    if (h > descr.iMaxH) h = descr.iMaxH;
    if (descr.iStepW > 0) w = (w / descr.iStepW) * descr.iStepW;
    if (descr.iStepH > 0) h = (h / descr.iStepH) * descr.iStepH;
  }

  const bool restartStreaming = s.isStreaming.load();
  if (restartStreaming) StopStreamLocked();

  // RoiState must be enabled before SetRoi takes effect on most DVP
  // cameras. Enable it (no-op if already enabled).
  if (s.dll.SetRoiState) s.dll.SetRoiState(s.handle, true);

  dvpRegion roi{};
  roi.X = x; roi.Y = y; roi.W = w; roi.H = h;
  dvpStatus rs = s.dll.SetRoi(s.handle, roi);

  if (restartStreaming) RestartStreamLocked(s, "roi-change");

  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "SET_ROI_FAILED", "dvpSetRoi status=" + std::to_string(rs));
  }
  auto r = MakeReply(env, true);
  r.Set("x", Napi::Number::New(env, x));
  r.Set("y", Napi::Number::New(env, y));
  r.Set("w", Napi::Number::New(env, w));
  r.Set("h", Napi::Number::New(env, h));
  return r;
}

// cameraSetTargetFormat({ format: "mono8" | "rgb24" | ... }) — output
// pixel format. S_MONO8 (3× bandwidth reduction vs rgb24) is the main
// reason this exists. Stream restart required for the format change to
// affect the live wire.
Napi::Value CameraSetTargetFormat(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  if (info.Length() < 1 || !info[0].IsObject()) {
    return MakeError(env, "BAD_ARGS", "expected { format }");
  }
  auto opts = info[0].As<Napi::Object>();
  if (!opts.Has("format") || !opts.Get("format").IsString()) {
    return MakeError(env, "BAD_ARGS", "expected string format");
  }
  std::string name = opts.Get("format").As<Napi::String>().Utf8Value();
  int code = ParseStreamFormat(name);
  if (code < 0) return MakeError(env, "BAD_ARGS", "unknown format: " + name);

  std::lock_guard<std::mutex> lk(s.mu);
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");
  if (!s.dll.SetTargetFormat) return MakeNoMethod(env, "dvpSetTargetFormat");

  const bool restartStreaming = s.isStreaming.load();
  if (restartStreaming) StopStreamLocked();

  dvpStatus rs = s.dll.SetTargetFormat(s.handle, static_cast<dvpStreamFormat>(code));

  if (restartStreaming) RestartStreamLocked(s, "target-format-change");

  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "SET_TARGET_FORMAT_FAILED",
                     "dvpSetTargetFormat status=" + std::to_string(rs));
  }
  auto r = MakeReply(env, true);
  r.Set("format", Napi::String::New(env, name));
  return r;
}

// cameraSetResolutionMode({ index }) — vendor-defined preset for binning
// / decimation / downscale. Each camera defines its own set of modes;
// index 0 is typically "full resolution" and higher indices are smaller
// / faster. Use cameraGetResolutionModeSel (not exposed here yet) or
// trial-and-error to find the right indices for your camera.
Napi::Value CameraSetResolutionMode(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  if (info.Length() < 1 || !info[0].IsObject()) {
    return MakeError(env, "BAD_ARGS", "expected { index }");
  }
  auto opts = info[0].As<Napi::Object>();
  if (!opts.Has("index") || !opts.Get("index").IsNumber()) {
    return MakeError(env, "BAD_ARGS", "expected numeric index");
  }
  const dvpUint32 idx = opts.Get("index").As<Napi::Number>().Uint32Value();

  std::lock_guard<std::mutex> lk(s.mu);
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");
  if (!s.dll.SetResolutionModeSel) return MakeNoMethod(env, "dvpSetResolutionModeSel");

  const bool restartStreaming = s.isStreaming.load();
  if (restartStreaming) StopStreamLocked();

  dvpStatus rs = s.dll.SetResolutionModeSel(s.handle, idx);

  if (restartStreaming) RestartStreamLocked(s, "resolution-mode-change");

  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "SET_RESOLUTION_MODE_FAILED",
                     "dvpSetResolutionModeSel status=" + std::to_string(rs));
  }
  auto r = MakeReply(env, true);
  r.Set("index", Napi::Number::New(env, idx));
  return r;
}

// cameraSetLiveMode({ roi?, format?, resolutionMode?, exposureMs?, mono? })
// Convenience: apply all live-preview settings in one Stop → apply → Start
// cycle so the stream restarts once, not four times. Any field omitted is
// left unchanged. Each individual call still works via the methods above.
Napi::Value CameraSetLiveMode(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto& s = S();
  if (info.Length() < 1 || !info[0].IsObject()) {
    return MakeError(env, "BAD_ARGS", "expected { roi?, format?, resolutionMode?, exposureMs?, mono? }");
  }
  auto opts = info[0].As<Napi::Object>();

  // Parse all inputs up front. Don't restart the stream until we know we
  // have at least one valid knob to apply.
  bool wantRoi = false, wantFormat = false, wantMode = false, wantExposure = false, wantMono = false;
  int roiX = 0, roiY = 0, roiW = 0, roiH = 0;
  int formatCode = 0;
  dvpUint32 modeIdx = 0;
  double exposureUs = 0.0;
  bool monoState = false;
  std::string formatName;

  if (opts.Has("roi") && opts.Get("roi").IsObject()) {
    auto r = opts.Get("roi").As<Napi::Object>();
    if (r.Has("x") && r.Has("y") && r.Has("w") && r.Has("h")) {
      roiX = r.Get("x").As<Napi::Number>().Int32Value();
      roiY = r.Get("y").As<Napi::Number>().Int32Value();
      roiW = r.Get("w").As<Napi::Number>().Int32Value();
      roiH = r.Get("h").As<Napi::Number>().Int32Value();
      if (roiW > 0 && roiH > 0) wantRoi = true;
    }
  }
  if (opts.Has("format") && opts.Get("format").IsString()) {
    formatName = opts.Get("format").As<Napi::String>().Utf8Value();
    int code = ParseStreamFormat(formatName);
    if (code >= 0) { formatCode = code; wantFormat = true; }
  }
  if (opts.Has("resolutionMode") && opts.Get("resolutionMode").IsNumber()) {
    modeIdx = opts.Get("resolutionMode").As<Napi::Number>().Uint32Value();
    wantMode = true;
  }
  if (opts.Has("exposureMs") && opts.Get("exposureMs").IsNumber()) {
    exposureUs = opts.Get("exposureMs").As<Napi::Number>().DoubleValue() * 1000.0;
    if (exposureUs > 0.0) wantExposure = true;
  }
  if (opts.Has("mono") && opts.Get("mono").IsBoolean()) {
    monoState = opts.Get("mono").As<Napi::Boolean>().Value();
    wantMono = true;
  }

  std::lock_guard<std::mutex> lk(s.mu);
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");

  const bool restartStreaming = s.isStreaming.load();
  if (restartStreaming) StopStreamLocked();


  // Order: format first, then ROI / resolution mode (so the new format's
  // descriptor is in effect), then exposure (its descriptor may depend
  // on the new ROI), then mono toggle.
  if (wantFormat && s.dll.SetTargetFormat) {
    dvpStatus rs = s.dll.SetTargetFormat(s.handle, static_cast<dvpStreamFormat>(formatCode));
  }
  if (wantMode && s.dll.SetResolutionModeSel) {
    dvpStatus rs = s.dll.SetResolutionModeSel(s.handle, modeIdx);
  }
  if (wantRoi && s.dll.SetRoi) {
    if (s.dll.SetRoiState) s.dll.SetRoiState(s.handle, true);
    dvpRegionDescr descr{};
    if (s.dll.GetRoiDescr && s.dll.GetRoiDescr(s.handle, &descr) == DVP_STATUS_OK) {
      if (roiW < descr.iMinW) roiW = descr.iMinW;
      if (roiH < descr.iMinH) roiH = descr.iMinH;
      if (roiW > descr.iMaxW) roiW = descr.iMaxW;
      if (roiH > descr.iMaxH) roiH = descr.iMaxH;
      if (descr.iStepW > 0) roiW = (roiW / descr.iStepW) * descr.iStepW;
      if (descr.iStepH > 0) roiH = (roiH / descr.iStepH) * descr.iStepH;
    }
    dvpRegion roi{};
    roi.X = roiX; roi.Y = roiY; roi.W = roiW; roi.H = roiH;
    dvpStatus rs = s.dll.SetRoi(s.handle, roi);
  }
  if (wantMono && s.dll.SetMonoState) {
    dvpStatus rs = s.dll.SetMonoState(s.handle, monoState);
  }
  if (wantExposure && s.dll.SetExposure) {
    s.dll.SetAeOperation(s.handle, AE_OP_OFF);
    dvpStatus rs = s.dll.SetExposure(s.handle, exposureUs);
  }

  if (restartStreaming) RestartStreamLocked(s, "live-mode-change");

  auto r = MakeReply(env, true);
  r.Set("appliedRoi", Napi::Boolean::New(env, wantRoi));
  r.Set("appliedFormat", Napi::Boolean::New(env, wantFormat));
  r.Set("appliedResolutionMode", Napi::Boolean::New(env, wantMode));
  r.Set("appliedExposure", Napi::Boolean::New(env, wantExposure));
  r.Set("appliedMono", Napi::Boolean::New(env, wantMono));
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
  // Release the recycled buffer pool at process shutdown.
  s.dispatchSpare.clear();
  s.dispatchSpare.shrink_to_fit();
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
  cam.Set("cameraSetRoi",       Napi::Function::New(env, CameraSetRoi));
  cam.Set("cameraSetTargetFormat", Napi::Function::New(env, CameraSetTargetFormat));
  cam.Set("cameraSetResolutionMode", Napi::Function::New(env, CameraSetResolutionMode));
  cam.Set("cameraSetLiveMode",  Napi::Function::New(env, CameraSetLiveMode));
  cam.Set("measureVickersAuto",  Napi::Function::New(env, hardness_vickers::MeasureVickersAuto));
  cam.Set("shutdown",           Napi::Function::New(env, Shutdown));
  exports.Set("camera", cam);
  return exports;
}

}  // namespace hardness_camera
