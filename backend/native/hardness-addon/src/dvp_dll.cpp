// dvp_dll.cpp — runtime loader for DVPCamera64.dll.
#include "dvp_dll.h"

#include <vector>

static std::string FormatLastError(DWORD code) {
  LPSTR buffer = nullptr;
  DWORD len = FormatMessageA(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
      nullptr, code, 0, reinterpret_cast<LPSTR>(&buffer), 0, nullptr);
  std::string out;
  if (buffer && len > 0) {
    out.assign(buffer, len);
    while (!out.empty() && (out.back() == '\r' || out.back() == '\n' || out.back() == ' ')) out.pop_back();
  } else {
    out = "win32 error " + std::to_string(code);
  }
  if (buffer) LocalFree(buffer);
  return out;
}

#define LOAD_PFN(field, name)                                                              \
  do {                                                                                     \
    dll.field = reinterpret_cast<pfn_##name>(GetProcAddress(dll.hModule, #name));          \
    if (!dll.field) {                                                                      \
      dll.loadError = "GetProcAddress failed for " #name;                                  \
      DvpDll_Unload(dll);                                                                  \
      return false;                                                                        \
    }                                                                                      \
  } while (0)

#define LOAD_OPTIONAL_PFN(field, name)                                                     \
  do {                                                                                     \
    dll.field = reinterpret_cast<pfn_##name>(GetProcAddress(dll.hModule, #name));          \
  } while (0)

bool DvpDll_Load(DvpDll& dll, const std::wstring& searchDir) {
  if (dll.loaded()) return true;

  // Prefer the modern, secure search-path API if available.
  using AddDllDirectoryFn = DLL_DIRECTORY_COOKIE (WINAPI*)(PCWSTR);
  using SetDefaultDllDirectoriesFn = BOOL (WINAPI*)(DWORD);
  HMODULE k32 = GetModuleHandleW(L"kernel32.dll");
  auto pAddDllDirectory = reinterpret_cast<AddDllDirectoryFn>(GetProcAddress(k32, "AddDllDirectory"));
  auto pSetDefaultDllDirectories = reinterpret_cast<SetDefaultDllDirectoriesFn>(
      GetProcAddress(k32, "SetDefaultDllDirectories"));

  if (!searchDir.empty()) {
    if (pSetDefaultDllDirectories) {
      // 0x00001000 LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, 0x00000100 USER_DIRS, 0x00000800 SYSTEM32, 0x00000200 APPLICATION_DIR
      pSetDefaultDllDirectories(0x00001000 | 0x00000100 | 0x00000800 | 0x00000200);
    }
    if (pAddDllDirectory) {
      pAddDllDirectory(searchDir.c_str());
    } else {
      SetDllDirectoryW(searchDir.c_str());
    }
  }

  // Try absolute path first if searchDir is provided, else just the name.
  HMODULE h = nullptr;
  if (!searchDir.empty()) {
    std::wstring full = searchDir;
    if (!full.empty() && full.back() != L'\\') full.push_back(L'\\');
    full += L"DVPCamera64.dll";
    h = LoadLibraryExW(full.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
  }
  if (!h) {
    h = LoadLibraryW(L"DVPCamera64.dll");
  }
  if (!h) {
    dll.loadError = "LoadLibrary(DVPCamera64.dll) failed: " + FormatLastError(GetLastError());
    return false;
  }
  dll.hModule = h;

  // Resolve every entry point we need. Any miss aborts and unloads.
  LOAD_PFN(Refresh,         dvpRefresh);
  LOAD_PFN(Open,            dvpOpen);
  LOAD_PFN(OpenByName,      dvpOpenByName);
  LOAD_PFN(Close,           dvpClose);
  LOAD_PFN(Start,           dvpStart);
  LOAD_PFN(Stop,            dvpStop);
  LOAD_PFN(GetFrame,        dvpGetFrame);
  LOAD_PFN(GetExposure,     dvpGetExposure);
  LOAD_PFN(SetExposure,     dvpSetExposure);
  LOAD_PFN(GetExposureDescr, dvpGetExposureDescr);
  LOAD_PFN(GetAnalogGain,   dvpGetAnalogGain);
  LOAD_PFN(SetAnalogGain,   dvpSetAnalogGain);
  LOAD_PFN(GetAnalogGainDescr, dvpGetAnalogGainDescr);
  LOAD_PFN(GetTriggerState, dvpGetTriggerState);
  LOAD_PFN(SetTriggerState, dvpSetTriggerState);
  LOAD_PFN(SetAeOperation,  dvpSetAeOperation);
  LOAD_PFN(GetCameraInfo,   dvpGetCameraInfo);
  LOAD_PFN(GetRoi,          dvpGetRoi);
  LOAD_OPTIONAL_PFN(GetBufferQueueSize, dvpGetBufferQueueSize);
  LOAD_OPTIONAL_PFN(SetBufferQueueSize, dvpSetBufferQueueSize);
  LOAD_OPTIONAL_PFN(GetBufferConfig,    dvpGetBufferConfig);
  LOAD_OPTIONAL_PFN(SetBufferConfig,    dvpSetBufferConfig);

  return true;
}

void DvpDll_Unload(DvpDll& dll) {
  if (dll.hModule) {
    FreeLibrary(dll.hModule);
    dll.hModule = nullptr;
  }
  dll.Refresh = nullptr;
  dll.Open = nullptr;
  dll.OpenByName = nullptr;
  dll.Close = nullptr;
  dll.Start = nullptr;
  dll.Stop = nullptr;
  dll.GetFrame = nullptr;
  dll.GetExposure = nullptr;
  dll.SetExposure = nullptr;
  dll.GetExposureDescr = nullptr;
  dll.GetAnalogGain = nullptr;
  dll.SetAnalogGain = nullptr;
  dll.GetAnalogGainDescr = nullptr;
  dll.GetTriggerState = nullptr;
  dll.SetTriggerState = nullptr;
  dll.SetAeOperation = nullptr;
  dll.GetCameraInfo = nullptr;
  dll.GetRoi = nullptr;
  dll.GetBufferQueueSize = nullptr;
  dll.SetBufferQueueSize = nullptr;
  dll.GetBufferConfig = nullptr;
  dll.SetBufferConfig = nullptr;
}
