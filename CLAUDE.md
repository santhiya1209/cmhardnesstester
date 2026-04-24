# Project Rules — Hardness Tester

An Electron desktop application. React 19 + Vite (TypeScript) frontend, Node.js (Express) backend, Electron shell. Distributed as an NSIS installer on Windows via a custom Electron Forge maker that wraps `electron-builder`.

Read this file before changing anything. Follow these rules unless the user explicitly overrides one in conversation.

---

## 1. Project structure (do not restructure without asking)

```
hardness-tester/
├── package.json          # Electron app shell. main = electron/main.js
├── forge.config.js       # Electron Forge config (NSIS maker)
├── makers/nsis-maker.js  # Custom Forge maker → electron-builder NSIS
├── .env / .env.prod      # Root: NODE_ENV, APP_NAME
├── backend/              # Independent npm project (express, cors, dotenv)
│   ├── package.json
│   ├── .env / .env.prod  # PORT, DB_LOCATION, DB_FILENAME
│   └── src/index.js      # exports start() — serves frontend/dist in prod
├── frontend/             # Independent npm project (Vite + React 19 + TS)
│   ├── package.json
│   ├── .env / .env.prod  # VITE_MODE, VITE_API_BASE_URL, VITE_API_PROXY_TARGET
│   ├── vite.config.ts    # has `/api` proxy + tailwind plugin
│   └── src/
└── electron/             # Source files only (no package.json)
    ├── main.js
    ├── preload.js
    └── ipc.js
```

- **No npm workspaces.** Each subproject installs independently. `npm run install:all` orchestrates.
- **No monorepo tooling.** No turbo, nx, lerna, pnpm workspaces, etc.
- The Electron app's `package.json` is the **root** package.json — that's where `electron`, `@electron-forge/*`, `electron-builder`, and Forge devDeps live.

## 2. Electron security — non-negotiable

The `BrowserWindow` config in `electron/main.js` MUST keep:

```js
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,    // never disable
  nodeIntegration: false,    // never enable
  sandbox: false,            // false only because preload uses ipcRenderer; do NOT enable nodeIntegration to compensate
}
```

**Renderer code (`frontend/src/**`) must never:**
- Use `require()`, `process`, `__dirname`, or any Node API directly.
- Receive raw `ipcRenderer` — only the allowlisted `window.api` from `preload.js`.
- Disable CSP, allow remote code execution, or load remote URLs into the main window.

**IPC discipline:**
- All IPC channels are allowlisted in `electron/preload.js` (`ALLOWED_INVOKE`, `ALLOWED_EVENTS`).
- New channels: add to BOTH the allowlist in `preload.js` AND a handler in `electron/ipc.js`. AND add the channel name to the `window.api` type in `frontend/src/global.d.ts`.
- Never expose a generic `invoke(anyChannel)` — the allowlist is the security boundary.
- Validate IPC payloads in main-process handlers. Treat renderer input as untrusted.

**Other defaults:**
- Never set `webSecurity: false`.
- Never use `shell.openExternal` with user-controlled strings without URL validation.
- Don't load external URLs into the main `BrowserWindow`. Open external links via `shell.openExternal` after validating scheme.

## 3. Native addons (future)

Native modules (e.g., `serialport`, `better-sqlite3`, `node-hid` for tester hardware) will be added later. When that happens:

- Install in `backend/` (the process that talks to hardware), not the renderer.
- The `@electron-forge/plugin-auto-unpack-natives` plugin is already wired in `forge.config.js` — it unpacks `.node` binaries from asar at package time. Do not remove it.
- After installing a native module, run `npx electron-rebuild` (install `@electron/rebuild` as a devDep when needed) so the binary matches Electron's Node ABI, not the system Node ABI.
- If a native module needs prebuilt binaries per arch, configure Forge `packagerConfig.platform`/`arch` accordingly.
- Never `require()` a native addon from the renderer. Bridge through IPC.

## 4. Styling — Tailwind only

- **All styling uses Tailwind CSS v4** (`@tailwindcss/vite` plugin, zero-config, no `tailwind.config.js`, no `postcss.config.js`).
- Theme customizations go in `frontend/src/index.css` via `@theme { ... }` blocks.
- Do not introduce: CSS Modules, styled-components, emotion, sass/scss, vanilla CSS files (other than `index.css`), MUI, Chakra, Bootstrap, daisyUI, or any other styling framework.
- `index.css` keeps a small base layer (font, color-scheme). Do not bloat it.
- One-off vanilla CSS for a single component is not allowed — express it as Tailwind utilities or extend the theme.
- Class lists getting long is fine. Refactor into a component or use `@apply` inside `@layer components` only when the same composition repeats 3+ times.

## 5. Environment variables

Two layers, three scopes (root, backend, frontend):

| File                  | Loaded when                     | Purpose                          |
| --------------------- | ------------------------------- | -------------------------------- |
| `.env`                | dev scripts                     | development values               |
| `.env.prod`           | `build:prod`, `start:prod`      | production values                |
| `backend/.env(.prod)` | backend processes               | PORT, DB_LOCATION, DB_FILENAME   |
| `frontend/.env(.prod)`| Vite (build & dev)              | VITE_* vars (baked into bundle)  |

**Rules:**
- Both `.env` and `.env.prod` must declare the **same set of keys**, only values differ. Don't let them drift.
- Vite-exposed vars MUST be prefixed `VITE_`. Never put secrets there — they end up in the shipped bundle.
- Backend reads env from `process.env`. In dev, `dotenv-cli` injects them; in the packaged app, `electron/main.js` calls `dotenv.config()` against `process.resourcesPath` before requiring the backend.
- `extraResource` in `forge.config.js` ships the three `.env.prod` files alongside `app.asar`. Don't move them inside the asar.
- Never hardcode env values in source. Add a key to the env files instead.

## 6. Dev / build / package commands

| Command              | What it does                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `npm run install:all`| install root + backend + frontend                                         |
| `npm run dev`        | concurrently: backend (nodemon) + Vite (5173) + Electron (waits on 5173)  |
| `npm run build:prod` | dotenv-cli loads prod envs → tsc + vite build → emits `frontend/dist`     |
| `npm run start:prod` | run Electron with prod envs against the built frontend (smoke test)       |
| `npm run package`    | `electron-forge package` (unpacked binary, no installer)                  |
| `npm run make`       | `electron-forge make` → NSIS installer at `out/make/nsis/win32-x64/...`   |

**Production flow is exactly two commands:** `npm run build:prod` then `npm run make`. Don't add steps that require the user to run more.

## 7. Shell / scripting rules

- **Do not write PowerShell scripts** (`.ps1`) or invoke PowerShell-only syntax in npm scripts unless the user explicitly asks for PowerShell.
- npm script bodies stay cross-shell: use `&&`, `||`, forward slashes, no PowerShell pipelines. If chaining is too complex, write a Node script in `scripts/` and invoke it with `node scripts/foo.js`.
- For one-off commands you need to run during development, use plain shell `exec`-style commands (bash-compatible) — not PowerShell.
- File-system operations in scripts use Node's `fs` (cross-platform), not `xcopy`/`robocopy`/PowerShell `Copy-Item`.
- The dev environment runs on Windows, but scripts must not assume Windows-only tools.

## 8. Forge / packaging rules

- Don't switch from Forge to plain `electron-builder` without asking. The custom maker at `makers/nsis-maker.js` is the bridge.
- Don't remove `extraResource` entries — runtime env loading depends on them.
- Don't widen the `ignore` list to drop `frontend/dist` or `backend/node_modules`. The packaged app needs both at runtime.
- Don't enable code signing without explicit credentials provided by the user.
- The NSIS maker config (`oneClick: false`, `allowToChangeInstallationDirectory: true`, `perMachine: false`) is intentional. Don't flip these without asking.

## 9. Backend rules

- Backend exports `{ createApp, start }` so Electron can call `start()` in-process for the single-process production model. Don't refactor it into a CLI-only script.
- In production (`isProd === true`), backend serves `frontend/dist` as static + SPA fallback. Don't remove that branch.
- CORS is enabled only in development. Don't enable it in prod — same-origin in the packaged app.
- New routes live under `/api/*` so the Vite proxy handles them in dev with no extra config.

## 10. Frontend rules

- All API calls use **relative paths** like `fetch('/api/...')`. Never hardcode `http://localhost:4000`. The Vite dev proxy + same-origin prod serving handle both modes.
- TypeScript only — no plain `.js`/`.jsx` in `frontend/src/`.
- React 19 — use the new APIs (`use`, actions, `useOptimistic`) where appropriate. Don't pull in legacy patterns.
- Do not add a router until needed. When added, prefer `react-router` (the official one) unless the user requests otherwise.
- Do not add state management libraries (Redux, Zustand, Jotai) until a real need arises. Lift state or use context.

### 10.1 Frontend folder layout (do not flatten or nest differently)

```
frontend/src/
├── api/              # one exported function per file (e.g. getHealth.ts, postReading.ts)
├── utils/            # cross-cutting helpers (baseUrl, http, formatters)
├── component/
│   ├── own/          # app-specific components (feature panels, screens)
│   └── ui/           # primitive / shared UI building blocks
├── types/            # shared type definitions (DTOs, IPC channel maps)
├── assets/           # static imports (svgs, images)
├── vite-env.d.ts     # vite/client + window.api global augmentation
├── index.css         # tailwind import + minimal base styles
├── App.tsx
└── main.tsx
```

### 10.2 API layer rules

- **One function per file** in `src/api/`. The filename matches the function (`getHealth.ts` exports `getHealth`).
- API functions use **axios directly** (`import axios from 'axios'`) and build the URL using `API_BASE_URL` from `@/utils/baseUrl`. Do NOT introduce a shared axios instance / wrapper — each api function owns its call so the developer keeps full control over headers, params, and response handling per endpoint.
- Components never call axios or fetch directly — they import from `@/api/*`.
- `utils/baseUrl.ts` is the **single** place that resolves the backend base URL. It reads `import.meta.env.MODE` / `VITE_MODE` and `VITE_API_BASE_URL`. Both dev and prod default to relative `/api/...` (Vite proxy in dev, same-origin in prod). All api functions import `API_BASE_URL` from it. Never hardcode a URL.
- DTOs live in `src/types/<entity>.ts` and are imported by both the api function and any consumer.

Example api function:

```ts
import axios from 'axios';
import type { Health } from '@/types/health';
import { API_BASE_URL } from '@/utils/baseUrl';

export async function getHealth(): Promise<Health> {
  const { data } = await axios.get<Health>(`${API_BASE_URL}/api/health`);
  return data;
}
```

### 10.3 Components rules

- App-specific components (anything tied to a feature/screen) live under `component/own/`.
- Reusable primitives (Button, Card, Input, etc.) live under `component/ui/`.
- One component per file. Filename = component name in PascalCase (e.g. `HealthPanel.tsx`).
- Components in `ui/` must not import from `own/` or `api/`. Keep them dumb and reusable.
- Components in `own/` may import from `ui/`, `api/`, `utils/`, `types/`.

### 10.4 IPC type exposure

- `src/vite-env.d.ts` augments `Window` with `api: ElectronApi` (typed via `src/types/ipc.ts`).
- Keep the `IpcInvokeMap` and channel union types in `types/ipc.ts` in sync with `electron/preload.js` allowlists. New channel = update both ends + the type map.
- Do not add a separate `global.d.ts`. All globals belong in `vite-env.d.ts`.

### 10.5 Path alias

- `@` is aliased to `frontend/src/`. Configured in both `vite.config.ts` (`resolve.alias`) and `tsconfig.json` (`paths`).
- **Use `@/...` for all cross-folder imports.** Examples:
  - `import { getHealth } from '@/api/getHealth'`
  - `import { http } from '@/utils/http'`
  - `import type { Health } from '@/types/health'`
  - `import HealthPanel from '@/component/own/HealthPanel'`
- Relative imports (`./`, `../`) are only acceptable for files **in the same folder** (e.g. an index file pulling in siblings).
- Don't introduce additional aliases (`@api`, `@types`, etc.) — `@` is enough.

## 11. General behavior

- Match existing code style. Don't reformat untouched code.
- Don't add comments that just restate what code does. Only comment non-obvious WHY.
- No backward-compat shims for code we just changed — this is a fresh codebase.
- Don't introduce dependencies casually. Each new dep should have a clear, called-out reason.
- Don't run destructive commands (`rm -rf node_modules`, `git reset --hard`, force pushes) without confirmation.
- When unsure between two valid approaches, ask — don't pick silently.
