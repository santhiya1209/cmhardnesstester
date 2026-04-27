// addon.cpp — N-API module entry point.
#include <napi.h>
#include "camera.h"

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  return hardness_camera::Init(env, exports);
}

NODE_API_MODULE(hardness_addon, Init)
