# vendor/

Third-party runtime binaries bundled with the installer so the packaged app
works on a fresh Windows PC that does not have the Do3Think DVP SDK or OpenCV
installed.

These files are **shipped to end users** via `forge.config.js` →
`extraResource: ['vendor/opencv', 'vendor/camera-sdk']`. They land at
`<install>/resources/opencv/` and `<install>/resources/sdk/` respectively, and
`electron/cameraService.js` adds those directories to the DLL search path at
startup before loading `hardness_addon.node`.

## Contents

### `opencv/bin/` — OpenCV 4.10.0 release runtime (~87 MB)
Source: `C:\Users\SANTHIYA\opencv\build\x64\vc16\bin\`
Linked against by `backend/native/hardness-addon/binding.gyp` (opencv_world4100.lib).

- `opencv_world4100.dll` — main runtime, required.
- `opencv_videoio_ffmpeg4100_64.dll` — FFmpeg backend for VideoIO.
- `opencv_videoio_msmf4100_64.dll` — Media Foundation backend.

Debug variants (`*d.dll`) are intentionally excluded — they're for debug builds only.

### `sdk/` — Do3Think DVP2 SDK runtime (~55 MB, 28 DLLs)
Source: `C:\Program Files (x86)\Do3think\DVP2 x64\`
Loaded at runtime by `cameraService.js` via `addon.camera.bootstrap({ dllSearchDir })`.

The set includes `DVPCamera64.dll` (the entry point), all `dscam64` transport
modules (USB2/USB3/GigE), GenICam runtime DLLs (`GenApi`, `GCBase`, etc.), and
the VS2013 C++ redistributable runtime (`msvcp120.dll`, `msvcr120.dll`) which
the SDK depends on and which Windows 10/11 do not ship by default.

### `redist/` — gitignored
The VS2015-2022 VC++ Redistributable installer (`vc_redist.x64.exe`) is
fetched on demand by `scripts/fetch-vc-redist.js` from
https://aka.ms/vs/17/release/vc_redist.x64.exe before `npm run make` runs.
It is not committed to the repo (free download, ~25 MB).

## Updating

If you upgrade OpenCV or the DVP SDK on your dev PC, re-run the manual copy:

```powershell
# OpenCV (release variants only)
Copy-Item C:\Users\SANTHIYA\opencv\build\x64\vc16\bin\opencv_world4100.dll vendor\opencv\bin\
Copy-Item C:\Users\SANTHIYA\opencv\build\x64\vc16\bin\opencv_videoio_ffmpeg4100_64.dll vendor\opencv\bin\
Copy-Item C:\Users\SANTHIYA\opencv\build\x64\vc16\bin\opencv_videoio_msmf4100_64.dll vendor\opencv\bin\

# DVP SDK (all .dll files)
Copy-Item "C:\Program Files (x86)\Do3think\DVP2 x64\*.dll" vendor\sdk\
```

Then commit the changes.

## Licensing

- **OpenCV** is Apache 2.0 — redistribution is permitted.
- **Do3Think DVP SDK** — redistribution rights depend on the OEM/license
  agreement with Do3Think. Confirm with the vendor before shipping the
  installer to external customers. This bundle is included on the assumption
  that the agreement permits it.
- **VS2013 redist DLLs (`msvcp120.dll`, `msvcr120.dll`)** — Microsoft's
  redistributable terms allow shipping these alongside an application that
  depends on them.
