#include "serial.h"

#ifdef _WIN32
#include <algorithm>
#include <cctype>
#include <vector>

HANDLE SerialPort::portHandle_ = INVALID_HANDLE_VALUE;
std::mutex SerialPort::portMutex_;
std::thread SerialPort::readThread_;
std::atomic<bool> SerialPort::running_{false};
Napi::ThreadSafeFunction* SerialPort::readCallback_ = nullptr;

namespace {
std::string LastErrorMessage(const std::string& prefix) {
  const DWORD err = GetLastError();
  LPSTR message = nullptr;
  const DWORD size = FormatMessageA(
    FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
    nullptr,
    err,
    MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
    reinterpret_cast<LPSTR>(&message),
    0,
    nullptr
  );

  std::string result = prefix + " failed";
  if (size > 0 && message) {
    result += ": ";
    result += message;
  }
  result += " (error ";
  result += std::to_string(err);
  result += ")";

  if (message) LocalFree(message);
  return result;
}

void ThrowLastError(const Napi::Env& env, const std::string& prefix) {
  Napi::Error::New(env, LastErrorMessage(prefix)).ThrowAsJavaScriptException();
}

std::string Lowercase(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return value;
}

BYTE ParseParity(const std::string& parity) {
  const std::string value = Lowercase(parity);
  if (value == "even") return EVENPARITY;
  if (value == "odd") return ODDPARITY;
  if (value == "mark") return MARKPARITY;
  if (value == "space") return SPACEPARITY;
  return NOPARITY;
}

BYTE ParseStopBits(int stopBits) {
  return stopBits == 2 ? TWOSTOPBITS : ONESTOPBIT;
}
} // namespace

bool SerialPort::IsSupportedBaudRate(int baudRate) {
  return baudRate == 1200 || baudRate == 2300 || baudRate == 2400 || baudRate == 4800 || baudRate == 9600;
}

std::string SerialPort::NormalizePortName(const std::string& portName) {
  if (portName.rfind("\\\\.\\", 0) == 0) return portName;
  if (portName.rfind("COM", 0) == 0 || portName.rfind("com", 0) == 0) {
    return "\\\\.\\" + portName;
  }
  return portName;
}

Napi::Value SerialPort::OpenPort(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "openPort(portName: string, baudRate: number) expected")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const std::string portName = info[0].As<Napi::String>().Utf8Value();
  const int baudRate = info[1].As<Napi::Number>().Int32Value();
  const int dataBits = info.Length() >= 3 && info[2].IsNumber()
    ? info[2].As<Napi::Number>().Int32Value()
    : 8;
  const std::string parity = info.Length() >= 4 && info[3].IsString()
    ? info[3].As<Napi::String>().Utf8Value()
    : "none";
  const int stopBits = info.Length() >= 5 && info[4].IsNumber()
    ? info[4].As<Napi::Number>().Int32Value()
    : 1;

  if (!IsSupportedBaudRate(baudRate)) {
    Napi::RangeError::New(env, "Only baud rates 1200, 2300, 2400, 4800, and 9600 are supported").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (dataBits < 5 || dataBits > 8) {
    Napi::RangeError::New(env, "dataBits must be between 5 and 8").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (stopBits != 1 && stopBits != 2) {
    Napi::RangeError::New(env, "stopBits must be 1 or 2").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  StopReadingInternal();
  ClosePortInternal();

  const std::string devicePath = NormalizePortName(portName);
  HANDLE handle = CreateFileA(
    devicePath.c_str(),
    GENERIC_READ | GENERIC_WRITE,
    0,
    nullptr,
    OPEN_EXISTING,
    FILE_ATTRIBUTE_NORMAL,
    nullptr
  );

  if (handle == INVALID_HANDLE_VALUE) {
    ThrowLastError(env, "CreateFileA(" + devicePath + ")");
    return env.Undefined();
  }

  DCB dcb;
  SecureZeroMemory(&dcb, sizeof(dcb));
  dcb.DCBlength = sizeof(dcb);
  if (!GetCommState(handle, &dcb)) {
    CloseHandle(handle);
    ThrowLastError(env, "GetCommState");
    return env.Undefined();
  }

  dcb.BaudRate = static_cast<DWORD>(baudRate);
  dcb.ByteSize = static_cast<BYTE>(dataBits);
  dcb.Parity = ParseParity(parity);
  dcb.StopBits = ParseStopBits(stopBits);
  dcb.fBinary = TRUE;
  dcb.fParity = dcb.Parity == NOPARITY ? FALSE : TRUE;
  dcb.fOutxCtsFlow = FALSE;
  dcb.fOutxDsrFlow = FALSE;
  dcb.fDtrControl = DTR_CONTROL_ENABLE;
  dcb.fDsrSensitivity = FALSE;
  dcb.fTXContinueOnXoff = TRUE;
  dcb.fOutX = FALSE;
  dcb.fInX = FALSE;
  dcb.fErrorChar = FALSE;
  dcb.fNull = FALSE;
  dcb.fRtsControl = RTS_CONTROL_ENABLE;
  dcb.fAbortOnError = FALSE;

  if (!SetCommState(handle, &dcb)) {
    CloseHandle(handle);
    ThrowLastError(env, "SetCommState");
    return env.Undefined();
  }

  COMMTIMEOUTS timeouts;
  SecureZeroMemory(&timeouts, sizeof(timeouts));
  timeouts.ReadIntervalTimeout = 20;
  timeouts.ReadTotalTimeoutMultiplier = 0;
  timeouts.ReadTotalTimeoutConstant = 50;
  timeouts.WriteTotalTimeoutMultiplier = 10;
  timeouts.WriteTotalTimeoutConstant = 100;
  if (!SetCommTimeouts(handle, &timeouts)) {
    CloseHandle(handle);
    ThrowLastError(env, "SetCommTimeouts");
    return env.Undefined();
  }

  SetupComm(handle, 4096, 4096);
  PurgeComm(handle, PURGE_RXCLEAR | PURGE_TXCLEAR | PURGE_RXABORT | PURGE_TXABORT);
  EscapeCommFunction(handle, SETDTR);
  EscapeCommFunction(handle, SETRTS);

  {
    std::lock_guard<std::mutex> lock(portMutex_);
    portHandle_ = handle;
  }

  return Napi::Boolean::New(env, true);
}

Napi::Value SerialPort::ClosePort(const Napi::CallbackInfo& info) {
  StopReadingInternal();
  ClosePortInternal();
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value SerialPort::WriteData(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "writeData(buffer: Buffer) expected").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
  HANDLE handle;
  {
    std::lock_guard<std::mutex> lock(portMutex_);
    handle = portHandle_;
  }

  if (handle == INVALID_HANDLE_VALUE) {
    Napi::Error::New(env, "Serial port is not open").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  DWORD written = 0;
  const BOOL ok = WriteFile(
    handle,
    buffer.Data(),
    static_cast<DWORD>(buffer.Length()),
    &written,
    nullptr
  );

  if (!ok) {
    ThrowLastError(env, "WriteFile");
    return env.Undefined();
  }

  return Napi::Number::New(env, written);
}

Napi::Value SerialPort::StartReading(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "startReading(callback) expected").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  {
    std::lock_guard<std::mutex> lock(portMutex_);
    if (portHandle_ == INVALID_HANDLE_VALUE) {
      Napi::Error::New(env, "Serial port is not open").ThrowAsJavaScriptException();
      return env.Undefined();
    }
  }

  StopReadingInternal();
  Napi::Function callback = info[0].As<Napi::Function>();
  readCallback_ = new Napi::ThreadSafeFunction(Napi::ThreadSafeFunction::New(
    env,
    callback,
    "serial-read-callback",
    0,
    1
  ));

  running_.store(true);
  readThread_ = std::thread(&SerialPort::ReadLoop);
  return Napi::Boolean::New(env, true);
}

Napi::Value SerialPort::StopReading(const Napi::CallbackInfo& info) {
  StopReadingInternal();
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value SerialPort::SetControlLines(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsBoolean() || !info[1].IsBoolean()) {
    Napi::TypeError::New(env, "setControlLines(dtr: boolean, rts: boolean) expected").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  HANDLE handle;
  {
    std::lock_guard<std::mutex> lock(portMutex_);
    handle = portHandle_;
  }

  if (handle == INVALID_HANDLE_VALUE) {
    Napi::Error::New(env, "Serial port is not open").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const bool dtr = info[0].As<Napi::Boolean>().Value();
  const bool rts = info[1].As<Napi::Boolean>().Value();
  if (!EscapeCommFunction(handle, dtr ? SETDTR : CLRDTR)) {
    ThrowLastError(env, dtr ? "SETDTR" : "CLRDTR");
    return env.Undefined();
  }
  if (!EscapeCommFunction(handle, rts ? SETRTS : CLRRTS)) {
    ThrowLastError(env, rts ? "SETRTS" : "CLRRTS");
    return env.Undefined();
  }

  return Napi::Boolean::New(env, true);
}

void SerialPort::ReadLoop() {
  uint8_t buffer[256];

  while (running_.load()) {
    HANDLE handle;
    {
      std::lock_guard<std::mutex> lock(portMutex_);
      handle = portHandle_;
    }

    if (handle == INVALID_HANDLE_VALUE) break;

    DWORD bytesRead = 0;
    const BOOL ok = ReadFile(handle, buffer, sizeof(buffer), &bytesRead, nullptr);
    if (!running_.load()) break;

    if (!ok) {
      const DWORD err = GetLastError();
      if (err == ERROR_OPERATION_ABORTED || err == ERROR_INVALID_HANDLE) break;
      Sleep(5);
      continue;
    }

    if (bytesRead == 0) {
      Sleep(2);
      continue;
    }

    std::vector<uint8_t>* chunk = new std::vector<uint8_t>(buffer, buffer + bytesRead);
    Napi::ThreadSafeFunction* callback = readCallback_;
    if (!callback) {
      delete chunk;
      continue;
    }

    napi_status status = callback->BlockingCall(chunk, [](Napi::Env env, Napi::Function jsCallback, std::vector<uint8_t>* data) {
      Napi::Buffer<uint8_t> nodeBuffer = Napi::Buffer<uint8_t>::Copy(env, data->data(), data->size());
      jsCallback.Call({ nodeBuffer });
      delete data;
    });

    if (status != napi_ok) {
      delete chunk;
      break;
    }
  }
}

void SerialPort::StopReadingInternal() {
  running_.store(false);
  HANDLE handle;
  {
    std::lock_guard<std::mutex> lock(portMutex_);
    handle = portHandle_;
  }
  if (handle != INVALID_HANDLE_VALUE) {
    CancelIoEx(handle, nullptr);
  }
  if (readThread_.joinable()) {
    readThread_.join();
  }
  if (readCallback_) {
    readCallback_->Release();
    delete readCallback_;
    readCallback_ = nullptr;
  }
}

void SerialPort::ClosePortInternal() {
  HANDLE handle = INVALID_HANDLE_VALUE;
  {
    std::lock_guard<std::mutex> lock(portMutex_);
    handle = portHandle_;
    portHandle_ = INVALID_HANDLE_VALUE;
  }
  if (handle != INVALID_HANDLE_VALUE) {
    CloseHandle(handle);
  }
}

#else

HANDLE SerialPort::portHandle_ = INVALID_HANDLE_VALUE;
std::mutex SerialPort::portMutex_;
std::thread SerialPort::readThread_;
std::atomic<bool> SerialPort::running_{false};
Napi::ThreadSafeFunction* SerialPort::readCallback_ = nullptr;

Napi::Value SerialPort::OpenPort(const Napi::CallbackInfo& info) {
  Napi::Error::New(info.Env(), "serial addon is Windows-only").ThrowAsJavaScriptException();
  return info.Env().Undefined();
}
Napi::Value SerialPort::ClosePort(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), true); }
Napi::Value SerialPort::WriteData(const Napi::CallbackInfo& info) { return info.Env().Undefined(); }
Napi::Value SerialPort::StartReading(const Napi::CallbackInfo& info) { return info.Env().Undefined(); }
Napi::Value SerialPort::StopReading(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), true); }
Napi::Value SerialPort::SetControlLines(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), true); }

#endif
