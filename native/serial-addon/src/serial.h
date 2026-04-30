#pragma once

#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#endif

#include <atomic>
#include <mutex>
#include <string>
#include <thread>

class SerialPort {
public:
  static Napi::Value OpenPort(const Napi::CallbackInfo& info);
  static Napi::Value ClosePort(const Napi::CallbackInfo& info);
  static Napi::Value WriteData(const Napi::CallbackInfo& info);
  static Napi::Value StartReading(const Napi::CallbackInfo& info);
  static Napi::Value StopReading(const Napi::CallbackInfo& info);
  static Napi::Value SetControlLines(const Napi::CallbackInfo& info);

private:
  static std::string NormalizePortName(const std::string& portName);
  static bool IsSupportedBaudRate(int baudRate);
  static void ReadLoop();
  static void StopReadingInternal();
  static void ClosePortInternal();

#ifdef _WIN32
  static HANDLE portHandle_;
#endif
  static std::mutex portMutex_;
  static std::thread readThread_;
  static std::atomic<bool> running_;
  static Napi::ThreadSafeFunction* readCallback_;
};
