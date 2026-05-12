// addon.cpp — N-API module entry point.
#include <napi.h>
#include <cstdio>
#include "camera.h"

// Build stamp baked in at compile time. If this line does NOT print on
// Electron startup, the running .node is stale (node-gyp skipped this TU)
// and the rest of the cpp changes are not active either. Bump the version
// suffix when you want to force-verify a fresh rebuild.
#ifndef HARDNESS_ADDON_BUILD_TAG
#define HARDNESS_ADDON_BUILD_TAG "10x-minarea-fix-v1"
#endif

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  std::fprintf(stderr,
    "[opencv-addon-build] version=%s built=%s %s\n",
    HARDNESS_ADDON_BUILD_TAG, __DATE__, __TIME__);
  std::fflush(stderr);
  return hardness_camera::Init(env, exports);
}

NODE_API_MODULE(hardness_addon, Init)
