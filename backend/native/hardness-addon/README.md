# hardness-addon

Native N-API addon that talks to the Do3Think DVP2 camera.

- Runtime-links `DVPCamera64.dll` from `C:\Program Files (x86)\Do3think\DVP2 x64\` via `LoadLibraryW` + `GetProcAddress`. No SDK `.lib` needed at compile time.
- Vendor function prototypes are bundled in `include/dvp.h` (extracted from the official `DVPCamera.chm` Doxygen output, kept minimal — only the calls the addon uses).
- Streaming runs on a dedicated `std::thread`. Frames are pushed back to the JS thread via `Napi::ThreadSafeFunction` as a transferable `Uint8Array` over a heap-owned `ArrayBuffer`.
- Path to the runtime DLLs is set per-process from the Electron main via `cameraService.bootstrap({ dllSearchDir })`.

## Build prerequisites (Windows)

1. **Visual Studio Build Tools 2022** with the *Desktop development with C++* workload (MSVC v143, Windows 11 SDK).
2. **Python 3.x** on `PATH` (node-gyp).
3. **Node.js** matching the version Electron expects (run from the repo root).

## Build

From the repo root:

```bash
npm run rebuild-addon
```

Or, against system Node (not Electron's ABI):

```bash
cd backend/native/hardness-addon
npm install
```

The compiled artifact is at:

```
backend/native/hardness-addon/build/Release/hardness_addon.node
```

## Runtime DLL discovery

Set `DO3THINK_SDK_DIR` in the repo `.env` / `.env.prod`:

```
DO3THINK_SDK_DIR=C:\Program Files (x86)\Do3think\DVP2 x64
```

`electron/cameraService.js` reads this and calls `addon.bootstrap({ dllSearchDir })`, which uses `AddDllDirectory` + `LoadLibraryExW(LOAD_WITH_ALTERED_SEARCH_PATH)` so dependent DLLs (`GenApi*`, transports, GenICam runtime) resolve from the same directory as `DVPCamera64.dll`.

## Surface

```
camera.bootstrap({ dllSearchDir })
camera.setEventCallbacks({ onFrame(meta, u8), onStatus(payload) })
camera.cameraOpen({ index })
camera.cameraClose()
camera.cameraStartStream()
camera.cameraStopStream()
camera.cameraGetFrame({ timeoutMs })
camera.cameraGetStatus()
camera.cameraSetExposure({ valueUs })
camera.cameraSetGain({ value })
camera.cameraSetTriggerMode({ value })
camera.shutdown()
```

All entries return `{ ok: boolean, ... }`. Errors carry `{ error: 'CODE', message: '...' }`. There are no mock fallbacks: when the DLL is missing or the camera is unplugged, every call returns `ok:false` with a real error code.
