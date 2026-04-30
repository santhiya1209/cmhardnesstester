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

#include <atomic>
#include <chrono>
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

Napi::Object MakeError(Napi::Env env, const char* code, const std::string& msg) {
  auto o = MakeReply(env, false);
  o.Set("error", Napi::String::New(env, code));
  o.Set("message", Napi::String::New(env, msg));
  return o;
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

    // Copy the SDK buffer because it is reused on the next call.
    auto* bytes = new uint8_t[frame.uBytes];
    std::memcpy(bytes, pBuffer, frame.uBytes);

    s.lastWidth = frame.iWidth;
    s.lastHeight = frame.iHeight;

    struct FramePayload {
      uint8_t*     bytes;
      size_t       size;
      int          width;
      int          height;
      const char*  pixelFormat;
      int          bits;
      uint64_t     timestamp;
      uint64_t     seq;
    };
    auto* fp = new FramePayload{
        bytes, frame.uBytes,
        frame.iWidth, frame.iHeight,
        FormatToString(frame.format),
        frame.bits == BITS_16 ? 16 : 8,
        frame.uTimestamp,
        frame.uFrameID,
    };

    if (s.tsfFrame) {
      s.tsfFrame.NonBlockingCall(fp, [](Napi::Env env, Napi::Function fn, FramePayload* p) {
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
        meta.Set("bytes", Napi::Number::New(env, static_cast<double>(p->size)));
        fn.Call({meta, u8});
        delete p;
      });
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
  dvpStatus rs = s.dll.Start(s.handle);
  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "START_FAILED", "dvpStart status=" + std::to_string(rs));
  }
  s.stopRequested.store(false);
  s.isStreaming.store(true);
  s.streamThread = std::thread(StreamLoop);
  EmitStatus("event", "streaming");
  return MakeReply(env, true);
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
  auto data = Napi::Buffer<uint8_t>::Copy(env, static_cast<const uint8_t*>(pBuffer), frame.uBytes);
  auto r = MakeReply(env, true);
  r.Set("data", data);
  r.Set("width", Napi::Number::New(env, frame.iWidth));
  r.Set("height", Napi::Number::New(env, frame.iHeight));
  r.Set("pixelFormat", Napi::String::New(env, FormatToString(frame.format)));
  r.Set("bits", Napi::Number::New(env, frame.bits == BITS_16 ? 16 : 8));
  r.Set("timestamp", Napi::Number::New(env, static_cast<double>(frame.uTimestamp)));
  r.Set("seq", Napi::Number::New(env, static_cast<double>(frame.uFrameID)));
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
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");
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
  // Clamp against SDK descriptor range so out-of-bound values don't fail.
  if (s.dll.GetExposureDescr) {
    dvpDoubleDescr d{};
    if (s.dll.GetExposureDescr(s.handle, &d) == DVP_STATUS_OK) {
      if (ms < d.fMin) ms = d.fMin;
      if (ms > d.fMax) ms = d.fMax;
    }
  }
  fprintf(stderr, "[native] set exposure value: %.3f\n", ms);
  fflush(stderr);
  dvpStatus aeRs = s.dll.SetAeOperation(s.handle, AE_OP_OFF);
  dvpStatus rs = s.dll.SetExposure(s.handle, ms);
  fprintf(stderr, "[native] set exposure result: %d (ae=%d)\n", rs, aeRs);
  fflush(stderr);
  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "SET_EXPOSURE_FAILED", "dvpSetExposure status=" + std::to_string(rs));
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
  if (!s.isOpen.load()) return MakeError(env, "NOT_OPEN", "camera is not open");
  if (info.Length() < 1 || !info[0].IsObject()) return MakeError(env, "BAD_ARGS", "expected { value }");
  auto opts = info[0].As<Napi::Object>();
  if (!opts.Has("value") || !opts.Get("value").IsNumber()) {
    return MakeError(env, "BAD_ARGS", "expected numeric value");
  }
  float gain = opts.Get("value").As<Napi::Number>().FloatValue();
  if (s.dll.GetAnalogGainDescr) {
    dvpFloatDescr d{};
    if (s.dll.GetAnalogGainDescr(s.handle, &d) == DVP_STATUS_OK) {
      if (gain < d.fMin) gain = d.fMin;
      if (gain > d.fMax) gain = d.fMax;
    }
  }
  fprintf(stderr, "[native] set gain value: %.3f\n", gain);
  fflush(stderr);
  dvpStatus aeRs = s.dll.SetAeOperation(s.handle, AE_OP_OFF);
  dvpStatus rs = s.dll.SetAnalogGain(s.handle, gain);
  fprintf(stderr, "[native] set gain result: %d (ae=%d)\n", rs, aeRs);
  fflush(stderr);
  if (rs != DVP_STATUS_OK) {
    return MakeError(env, "SET_GAIN_FAILED", "dvpSetAnalogGain status=" + std::to_string(rs));
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
  cam.Set("cameraGetFrame",     Napi::Function::New(env, CameraGetFrame));
  cam.Set("cameraGetStatus",    Napi::Function::New(env, CameraGetStatus));
  cam.Set("cameraSetExposure",  Napi::Function::New(env, CameraSetExposure));
  cam.Set("cameraGetExposureRange", Napi::Function::New(env, CameraGetExposureRange));
  cam.Set("cameraSetGain",      Napi::Function::New(env, CameraSetGain));
  cam.Set("cameraGetGainRange", Napi::Function::New(env, CameraGetGainRange));
  cam.Set("cameraSetTriggerMode", Napi::Function::New(env, CameraSetTriggerMode));
  cam.Set("shutdown",           Napi::Function::New(env, Shutdown));
  exports.Set("camera", cam);
  return exports;
}

}  // namespace hardness_camera
