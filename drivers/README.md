# drivers/

Third-party runtime binaries and installer scaffolding bundled with the
packaged app so the camera pipeline works on a fresh Windows PC that does not
have the Do3Think DVP SDK, OpenCV, or the Microsoft VC++ runtime installed.

Runtime DLLs are **shipped to end users** via `forge.config.js` →
`extraResource: ['drivers/opencv', 'drivers/DVP2 x64', 'drivers/redist']`.
They land at `<install>/resources/opencv/`, `<install>/resources/DVP2 x64/`,
and `<install>/resources/redist/`. `electron/cameraService.js` adds the first
two to the DLL search path at startup and passes `resources/DVP2 x64` as the
DVP `dllSearchDir`. `build/installer.nsh` chains `vc_redist.x64.exe` silently
during install.

## Layout

```
drivers/
├── DVP2/                    # legacy scaffold (kept for backward layout)
├── DVP2 x64/                # Do3Think DVP2 SDK x64 runtime DLLs (shipped)
├── BasedCam3 x64/           # legacy scaffold
├── GigE Camera/             # legacy scaffold
├── USB Camera/              # legacy scaffold
├── USB3 Vision Camera/      # legacy scaffold
├── XGigeGrabber/            # legacy scaffold
├── opencv/bin/              # OpenCV release runtime (shipped)
├── redist/                  # VC++ x64 redist (fetched, gitignored, shipped)
└── installers/              # OPTIONAL per-camera vendor setup .exe files
    ├── BasedCam3/
    ├── DVP2/
    ├── GigE/
    └── USB3Vision/
```

`installers/` is the active hook used by the NSIS installer. Drop a vendor
setup `.exe` into the appropriate subfolder and the installer will prompt the
user to run it during installation (silent `/S` flag). Empty subfolders are
harmless — they are skipped at install time.

The `scaffold` folders are intentionally empty (`.gitkeep` only). The product
currently supports only the Do3Think DVP2 camera; the other folders exist so
per-camera installers can be dropped in without restructuring later. To wire a
new camera installer:

1. Drop the vendor's setup `.exe` into the appropriate `drivers/<camera>/`
   subfolder.
2. Add the subfolder to `forge.config.js` `extraResource`.
3. Uncomment / extend the chaining block in `build/installer.nsh` —
   `customInstall` already has a scaffold stub for the DVP2 installer.

## Contents (shipped today)

### `opencv/bin/` — OpenCV 4.10.0 release runtime (~87 MB)
Source: `C:\Users\SANTHIYA\opencv\build\x64\vc16\bin\`
Linked against by `backend/native/hardness-addon/binding.gyp`
(`opencv_world4100.lib`).

- `opencv_world4100.dll` — main runtime, required.
- `opencv_videoio_ffmpeg4100_64.dll` — FFmpeg backend for VideoIO.
- `opencv_videoio_msmf4100_64.dll` — Media Foundation backend.

Debug variants (`*d.dll`) are intentionally excluded — they're for debug
builds only.

### `DVP2 x64/` — Do3Think DVP2 SDK runtime (~55 MB, 28 DLLs)
Source: `C:\Program Files (x86)\Do3think\DVP2 x64\`
Loaded at runtime by `cameraService.js` via
`addon.camera.bootstrap({ dllSearchDir })`.

Includes `DVPCamera64.dll` (entry point), all `dscam64` transport modules
(USB2/USB3/GigE), GenICam runtime DLLs (`GenApi`, `GCBase`, etc.), and the
VS2013 C++ redistributable runtime (`msvcp120.dll`, `msvcr120.dll`) which the
SDK depends on and which Windows 10/11 do not ship by default.

### `redist/` — gitignored
The VS2015-2022 VC++ Redistributable installer (`vc_redist.x64.exe`) is
fetched on demand by `scripts/fetch-vc-redist.js` from
https://aka.ms/vs/17/release/vc_redist.x64.exe before `npm run make` runs.
Not committed (free download, ~25 MB).

## Updating

If you upgrade OpenCV or the DVP SDK on your dev PC, re-run the manual copy:

```powershell
# OpenCV (release variants only)
Copy-Item C:\Users\SANTHIYA\opencv\build\x64\vc16\bin\opencv_world4100.dll              drivers\opencv\bin\
Copy-Item C:\Users\SANTHIYA\opencv\build\x64\vc16\bin\opencv_videoio_ffmpeg4100_64.dll  drivers\opencv\bin\
Copy-Item C:\Users\SANTHIYA\opencv\build\x64\vc16\bin\opencv_videoio_msmf4100_64.dll    drivers\opencv\bin\

# DVP SDK (all .dll files)
Copy-Item "C:\Program Files (x86)\Do3think\DVP2 x64\*.dll" "drivers\DVP2 x64\"
```

Then commit the changes.

## Verification

`npm run prepackage` runs `scripts/fetch-vc-redist.js` (downloads the redist
if missing) and `scripts/verify-drivers.js` (**warn-only** for missing camera
DLLs — the build still produces an installer; the camera will report a clear
"driver not installed" message at runtime if the DLLs are still absent on the
target machine).

## Licensing

- **OpenCV** is Apache 2.0 — redistribution is permitted.
- **Do3Think DVP SDK** — redistribution rights depend on the OEM/license
  agreement with Do3Think. Confirm with the vendor before shipping the
  installer to external customers. This bundle is included on the assumption
  that the agreement permits it.
- **VS2013 redist DLLs (`msvcp120.dll`, `msvcr120.dll`)** — Microsoft's
  redistributable terms allow shipping these alongside an application that
  depends on them.
