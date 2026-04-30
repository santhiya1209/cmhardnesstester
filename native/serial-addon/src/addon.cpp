#include <napi.h>
#include "serial.h"

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("openPort", Napi::Function::New(env, SerialPort::OpenPort));
  exports.Set("closePort", Napi::Function::New(env, SerialPort::ClosePort));
  exports.Set("writeData", Napi::Function::New(env, SerialPort::WriteData));
  exports.Set("startReading", Napi::Function::New(env, SerialPort::StartReading));
  exports.Set("stopReading", Napi::Function::New(env, SerialPort::StopReading));
  exports.Set("setControlLines", Napi::Function::New(env, SerialPort::SetControlLines));
  return exports;
}

NODE_API_MODULE(serial, Init)
