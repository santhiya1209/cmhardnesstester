#pragma once

#include <napi.h>

namespace hardness_vickers {

Napi::Value MeasureVickersAuto(const Napi::CallbackInfo& info);

}
