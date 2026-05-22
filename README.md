# Vickers Measurement Software

Electron + React 19 + Node.js desktop app for Vickers hardness measurement.

## Development

```bash
npm run install:all
npm run dev
```

`npm run dev` starts the backend (nodemon), Vite dev server (port 5173), and
Electron pointing at the dev URL.

## Windows installer build

The project supports two packaging paths. Both produce a Windows NSIS
installer; use whichever you prefer.

### Option A — electron-builder (recommended for ad-hoc installer + portable build)

Produces `Vickers Measurement Software Setup <version>.exe` (NSIS) **and**
`Vickers Measurement Software Portable <version>.exe` in `release/`.

```bash
npm install
npm run rebuild:native
npm run dist:win
```

`npm run dist` runs the same flow for the current host platform. Output:
`release/`.

### Option B — Electron Forge (existing pipeline)

Same NSIS installer, via Forge + custom maker. Output: `out/make/nsis/win32-x64/`.

```bash
npm install
npm run rebuild-native
npm run build:prod
npm run make
```

## Bundling native runtime DLLs

The packaged app expects these DLLs to ship alongside the binaries:

| What                  | Drop into                | Lands at runtime under                                  |
| --------------------- | ------------------------ | ------------------------------------------------------- |
| OpenCV runtime DLLs   | `vendor/opencv/bin/`     | `<app>/resources/native/hardness-addon/opencv/bin/`     |
| Do3Think DVP2 SDK     | `vendor/camera-sdk/`     | `<app>/resources/camera-sdk/`                           |

`electron/cameraService.js` adds both directories to the DLL search path in
packaged mode. If `vendor/` folders are empty the installer still builds but
the camera will fail to initialize on machines that don't already have the
OpenCV/DVP2 DLLs installed system-wide.

## Packaging diagnostics

The Electron main process prints these log lines at startup; check them when
diagnosing missing files in a packaged build:

```
[packaging][mode] dev|packaged
[packaging][frontend-path] ...
[packaging][backend-path] ...
[packaging][resources-path] ...
[packaging][db-path] ...
[packaging][native-addon-path] ...
[packaging][opencv-dll-path] ...
[packaging][camera-sdk-path] ...
```
