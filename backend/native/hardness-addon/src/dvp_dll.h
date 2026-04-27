// dvp_dll.h — runtime DLL loader for DVPCamera64.dll.
#pragma once

#include "../include/dvp.h"
#include <string>

struct DvpDll {
  HMODULE                hModule = nullptr;
  std::string            dllPath;
  std::string            loadError;

  pfn_dvpRefresh         Refresh         = nullptr;
  pfn_dvpOpen            Open            = nullptr;
  pfn_dvpOpenByName      OpenByName      = nullptr;
  pfn_dvpClose           Close           = nullptr;
  pfn_dvpStart           Start           = nullptr;
  pfn_dvpStop            Stop            = nullptr;
  pfn_dvpGetFrame        GetFrame        = nullptr;
  pfn_dvpGetExposure     GetExposure     = nullptr;
  pfn_dvpSetExposure     SetExposure     = nullptr;
  pfn_dvpGetAnalogGain   GetAnalogGain   = nullptr;
  pfn_dvpSetAnalogGain   SetAnalogGain   = nullptr;
  pfn_dvpGetTriggerState GetTriggerState = nullptr;
  pfn_dvpSetTriggerState SetTriggerState = nullptr;
  pfn_dvpSetAeOperation  SetAeOperation  = nullptr;
  pfn_dvpGetCameraInfo   GetCameraInfo   = nullptr;
  pfn_dvpGetRoi          GetRoi          = nullptr;

  bool loaded() const { return hModule != nullptr && Open != nullptr && GetFrame != nullptr; }
};

/**
 * Loads `DVPCamera64.dll`. If `searchDir` is non-empty, it is added to the
 * DLL search path first via AddDllDirectory + LOAD_LIBRARY_SEARCH_*.
 * Returns true on success; on failure, fills `dll.loadError` with a human
 * message (GetLastError + FormatMessage).
 */
bool DvpDll_Load(DvpDll& dll, const std::wstring& searchDir);

/** Frees the DLL. Safe to call multiple times. */
void DvpDll_Unload(DvpDll& dll);
