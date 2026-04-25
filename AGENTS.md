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

## 4. Styling — Tailwind + Material UI

Two styling tools are allowed and they have **distinct, non-overlapping roles**:

- **Tailwind CSS v4** (`@tailwindcss/vite`, zero-config) — for layout, spacing, alignment, responsive utilities, quick one-off styling on plain HTML elements.
- **Material UI v6** (`@mui/material`, with `@emotion/react` + `@emotion/styled` engine, plus `@mui/icons-material`) — for complex interactive components: data grids, dialogs, menus, autocompletes, snackbars, form controls, etc.

### Rules

- Theme lives at `frontend/src/theme/theme.ts` (single source of truth). Use `createTheme` with `cssVariables: true` so MUI's CSS vars play nicely with Tailwind utilities.
- The app is wrapped in `<ThemeProvider theme={theme}>` + `<CssBaseline />` in `main.tsx`. Don't add a second `ThemeProvider` deeper in the tree unless intentionally scoping a sub-theme.
- Tailwind customizations go in `frontend/src/index.css` via `@theme { ... }` blocks. Keep it lean.
- **Do not** restyle MUI components with Tailwind `className`s for things MUI's `sx`/theme already covers. Use MUI's `sx` prop, `styled()`, or theme overrides for MUI internals.
- **Do** use Tailwind classes on the OUTER wrapper around MUI components (layout/spacing) — e.g. `<div className="grid grid-cols-2 gap-4"><Card>...</Card></div>`.
- Don't introduce: CSS Modules, styled-components, sass/scss, Chakra, Bootstrap, daisyUI, Ant Design, or any other component/styling framework.
- No vanilla `.css` files outside `index.css`.
- Icons come from `@mui/icons-material`. Don't add `lucide-react`, `react-icons`, `heroicons`, etc.

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

- Backend is **TypeScript** (`tsx watch` in dev, `tsc` build to `backend/dist/` for prod). Electron loads `backend/dist/index.js` in production, so `npm run build:backend` runs as part of `build:prod`.
- Backend exports `{ createApp, start }` so Electron can call `start()` in-process for the single-process production model. Don't refactor it into a CLI-only script.
- In production (`isProd === true`), backend serves `frontend/dist` as static + SPA fallback. Don't remove that branch.
- CORS is enabled only in development. Don't enable it in prod — same-origin in the packaged app.
- New routes live under `/api/*` so the Vite proxy handles them in dev with no extra config.

### 9.1 Backend folder layout

```
backend/src/
├── index.ts             # createApp() + start(); mounts /api router
├── routes/              # express Router definitions, one file per resource
│   ├── index.ts         # combines all sub-routers under /api
│   └── health.ts
├── controllers/         # handler functions (req, res) → business logic
│   └── health.ts
├── lib/                 # shared infrastructure (env, validate middleware, db, logger)
│   ├── env.ts           # parses + exports validated env via zod
│   └── validate.ts      # zod request-validation middleware factory
└── zod/                 # all zod schemas live here, suffix `.schema.ts`
    └── env.schema.ts
```

### 9.2 Layering rules (do not violate)

- **routes/** — thin. Only mounts URL paths to validation middleware + controller functions. No business logic.
- **controllers/** — handler functions. Receive validated input from `req.validated`, call `lib/` helpers, send response. No direct DB/IO calls — go through `lib/`.
- **lib/** — pure(ish) modules (env, db client, third-party adapters, validators). No express/route knowledge.
- **zod/** — schema definitions only. One file per logical group, suffix `.schema.ts` (e.g. `reading.schema.ts`, `env.schema.ts`). Re-export both the schema and the inferred type. Schemas are imported by controllers/middleware/lib — they don't import anything else from the app.

### 9.3 Validation rules

- All input from the renderer/network is validated with **zod** before reaching controllers. Use the `validate(schema, source)` middleware from `lib/validate.ts` in route definitions.
- Validated payloads are read from `req.validated.body` / `.query` / `.params`, not from `req.body` directly.
- Env is also zod-validated at startup (`lib/env.ts`). Don't read `process.env.X` anywhere else — import from `@/lib/env` (or relative `../lib/env`).
- IPC payloads in the Electron main process should also be zod-validated using schemas from `backend/src/zod/` (or a shared package later) — never trust the renderer.

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

### 10.5 Component-based design

- The frontend MUST be built as a tree of small, focused components — never as one giant `App.tsx` or screen file with everything inline.
- A "screen" lives in `component/own/<ScreenName>/index.tsx` (or as a flat `<ScreenName>.tsx` if it doesn't yet need siblings) and composes smaller components + primitives from `component/ui/`.
- Co-locate hooks (`useXxx.ts`) with the component(s) that consume them when single-use. Promote to a top-level `src/hooks/` only when shared across features.
- Props must be typed explicitly. Don't pass entire objects when only 2 fields are needed — that bloats re-renders and hides dependencies.

#### Don't over-split components

Splitting too eagerly is just as bad as a 1000-line monolith. Premature splitting creates folder noise, prop-drilling for nothing, and a maze of files for what is conceptually one widget.

- **Default to a single file.** A component, its sub-pieces, its config arrays, its small private memo'd helpers, and its types all start in one `.tsx`. Only split when one of the triggers below fires.
- **Triggers to actually split:**
  1. The file exceeds **~250 lines** of meaningful code (not imports/types).
  2. A sub-piece is **reused** outside this component.
  3. A sub-piece has **independent state/effects** that meaningfully benefit from its own render scope (e.g. a memoized leaf in a long list).
  4. The sub-piece is **independently testable** and a test would be cleaner against it directly.
- **Anti-patterns to avoid:**
  - A `MenuBar/` folder with `index.tsx` + `MenuBarItem.tsx` + `menus.ts` + `types.ts` when the whole thing is 200 lines used in one place — keep it as `MenuBar.tsx`.
  - Extracting a static config array into a separate `*.config.ts` / `*.items.ts` / `*.menus.ts` file. If the data is only used by one component and isn't large, keep it as a `const` at the top of the same file.
  - Pulling small types into a separate `types.ts` next to the component. Co-locate types in the same file unless they're shared.
  - One-line "wrapper" components that just rename props of an MUI primitive — use the primitive directly with `sx`.
- A flat `Foo.tsx` is preferred over `Foo/index.tsx` until at least one sibling file is justified.
- When in doubt, **inline first, refactor on the second use, not the first.** "Maybe we'll reuse this" is not a trigger.

### 10.6 Render performance — avoid unnecessary re-renders

The whole app must NOT re-render on every state change. Default to local state, lift only when needed, isolate updates.

- **Default to local `useState`/`useReducer`** in the leaf component that owns the state. Don't lift state up the tree until two siblings actually need it.
- **Never put rapidly-changing state into a global/Context store.** Form inputs, hover, focus, scroll position, modal open flags scoped to one screen — keep them local.
- **Context discipline:**
  - Split contexts by update frequency. A `ThemeContext` (changes rarely) must NOT be the same context as a `CurrentReadingContext` (changes constantly). Every consumer of a context re-renders when its value changes.
  - The `value` passed to `<Context.Provider value={...}>` must be **memoized** (`useMemo`) — otherwise every render of the provider re-renders every consumer.
  - Wrap callbacks placed in context with `useCallback`.
- **Memoization rules:**
  - Use `React.memo` on components that take stable props and render expensive trees (lists, charts, tables).
  - Use `useMemo` for derived values that are expensive to compute OR are passed as props/context to memoized children.
  - Use `useCallback` for functions passed to memoized children or into dependency arrays.
  - Don't memoize blindly — memoization has its own cost. If the parent re-renders rarely or the child is cheap, skip it.
- **Lists:** stable `key` per item (real id, not array index). For long lists, use virtualization (MUI's `DataGrid` for tabular, or `react-window` for arbitrary).
- **Avoid prop drilling without memoization** — passing fresh inline objects/arrays/functions through 5 layers re-renders the entire subtree on every parent update.
- **Don't recreate values inside JSX** unless trivial: `style={{ marginTop: 8 }}` and `onClick={() => doX(id)}` are fine on small leaves but harmful on memoized components — hoist them with `useMemo`/`useCallback`.
- **Selector pattern for shared state:** when global state grows, use Redux Toolkit + memoized selectors (Reselect) so consumers re-render only on the slice they read, instead of a single fat React Context.
- React 19 specifics:
  - Use `useTransition` / `startTransition` to mark non-urgent updates (filter changes, tab switches) so urgent ones (typing) stay snappy.
  - `useDeferredValue` for expensive derived UI driven by frequent input.
  - The React Compiler (when enabled) auto-memoizes — but write code as if it isn't enabled. Don't rely on it as an excuse to skip the rules above.

### 10.7 UI consistency via MUI

The UI must look and behave consistently. Achieve this by going through MUI's theme + primitives, not by reinventing styles per component.

- **Theme is the single source of truth** for color, spacing, radius, typography. All values come from `frontend/src/theme/theme.ts`. Never hardcode hex colors, px font sizes, or border radii in components.
- Use MUI's spacing scale: `theme.spacing(2)` or the `sx={{ p: 2, mt: 1 }}` shortcut. Don't write `padding: '16px'`.
- Use MUI's typography variants (`<Typography variant="h6">`) instead of raw `<h1>`/`<p>` with custom Tailwind sizes for in-app text.
- Surface variants: prefer `<Paper>`, `<Card>`, `<Dialog>`, `<Snackbar>` over hand-rolled divs.
- Form controls: `<TextField>`, `<Select>`, `<Checkbox>`, `<Switch>`, `<Autocomplete>` from MUI — never raw `<input>` for user-facing forms.
- Buttons: `<Button>` with `variant`/`color` from theme. Don't reskin with Tailwind classes — extend the theme's `components.MuiButton` overrides if you need a new variant globally.
- Icons exclusively from `@mui/icons-material`.
- Tailwind is for **layout/positioning around** MUI components (grids, flex, spacing of containers) and for plain HTML where MUI is overkill — not for restyling MUI internals.
- When adding a new visual pattern (e.g. a custom card style used 3+ times), promote it to a `component/ui/` primitive that wraps MUI with the agreed styling — don't copy-paste the `sx` block everywhere.
- Dark/light mode: rely on `theme.palette.mode` and the CSS-vars-enabled theme. Never branch on color scheme manually in components.

### 10.8 State management — base level

Use the simplest layer that works. Don't reach for a library until the lower tiers genuinely fail.

**Layer 1 — local component state (default):** `useState`, `useReducer` for anything scoped to one component or its children. Most state belongs here.

**Layer 2 — server state:** components need data fetched from the backend (axios calls in `@/api/*`). Do NOT call axios directly inside components.
- Each api function in `@/api/*` is wrapped by a **custom hook** in `src/hooks/queries/` (reads) or `src/hooks/mutations/` (writes). Example: `useHealth.ts` exposes `{ data, error, loading, refetch }` and internally manages `useState` + `useEffect` calling `getHealth()`.
- Components consume hooks only — never axios, never `fetch`.
- If two components need the same data, the hook owner lifts the call to the nearest common parent and passes the result down (or, if truly app-wide, mirrors a slim copy into a Redux slice — see Layer 3).
- When caching, deduplication, refetch-on-focus, or background revalidation become real needs across multiple endpoints, escalate to **RTK Query** (`@reduxjs/toolkit/query/react`) — it's already bundled with Redux Toolkit, no new dependency. Define the API in `src/store/api/` using `createApi` and consume via the generated hooks. Do NOT introduce TanStack Query, SWR, or any other server-state library — RTK Query is the only sanctioned escalation.
- For one-off mutations (POST/PUT/DELETE that don't need caching), a plain custom hook calling the api function is fine — don't reach for RTK Query just for a single submit button.

**Layer 3 — global UI state (rare):** for things that span the app and don't belong in server state — current user, theme override, sidebar open, active tester device, app-wide modals.
- Start with **React Context**, split by update frequency (see §10.6 context discipline). Memoize the value.
- Promote to **Redux Toolkit** (`@reduxjs/toolkit` + `react-redux`) ONLY when: (a) you need selector-based subscriptions so consumers re-render only on the slice they read, (b) you need updates from outside React (timers, IPC events from preload), (c) Context refactors are getting tangled, (d) you need devtools / time-travel for debugging complex flows, or (e) you've hit the server-state escalation point and need RTK Query.
- Layout when Redux is added:
  ```
  src/store/
  ├── index.ts          # configureStore, RootState, AppDispatch types
  ├── hooks.ts          # typed useAppSelector / useAppDispatch
  └── slices/
      ├── ui.slice.ts   # one slice per concern (createSlice)
      └── tester.slice.ts
  ```
- Each slice owns its own state, reducers, and action creators (`createSlice`). Selectors live next to the slice.
- The `<Provider store={store}>` wraps the app once in `main.tsx`, inside `<ThemeProvider>`.
- Components consume state via `useAppSelector(selectFoo)` — never `useSelector(state => state.foo.bar)` inline (use a memoized selector).
- For derived/cross-slice selectors use **Reselect** (`createSelector` from RTK).
- Async work that doesn't fit TanStack Query (e.g. multi-step IPC flows) goes in `createAsyncThunk` — but server CRUD still belongs in TanStack Query, not in thunks.

**Forbidden until justified:**
- Zustand, Recoil, Jotai, MobX, Valtio — Redux Toolkit is the pre-approved choice. Don't introduce a second store library.
- TanStack Query, SWR, or any other dedicated server-state library — server state goes through custom hooks first, RTK Query when caching genuinely matters.
- Storing server data in a regular Redux slice as a manual cache instead of using RTK Query for it. Plain slices are for client UI state.
- Putting form state in Redux (use `react-hook-form` locally if forms get complex, otherwise `useState`).
- Plain Redux (without Toolkit) — always `@reduxjs/toolkit`. No hand-written action types or switch-case reducers.

### 10.9 Path alias

- `@` is aliased to `frontend/src/`. Configured in both `vite.config.ts` (`resolve.alias`) and `tsconfig.json` (`paths`).
- **Use `@/...` for all cross-folder imports.** Examples:
  - `import { getHealth } from '@/api/getHealth'`
  - `import { http } from '@/utils/http'`
  - `import type { Health } from '@/types/health'`
  - `import HealthPanel from '@/component/own/HealthPanel'`
- Relative imports (`./`, `../`) are only acceptable for files **in the same folder** (e.g. an index file pulling in siblings).
- Don't introduce additional aliases (`@api`, `@types`, etc.) — `@` is enough.

### 10.10 Desktop-only target

This app ships **only as a packaged desktop binary via Electron**. There is no web build, no mobile build, no tablet build. Design and code accordingly.

- **No responsive design.** Don't write Tailwind `sm:`/`md:`/`lg:` variants. Don't use MUI's `useMediaQuery` for layout. Don't add breakpoints to the theme beyond defaults.
- **No mobile-first patterns.** No collapsible hamburger menus, no swipe gestures, no bottom navigation, no "drawer on small screens, sidebar on large."
- **No touch optimizations.** Hover states are first-class — assume mouse + keyboard exist. Don't tune hit targets to 44px for fingers; use whatever fits the desktop UI density.
- **Assume a real keyboard.** Wire keyboard shortcuts (the menubar already exposes them in the dropdown). Don't avoid `Ctrl`/`Alt`/`F-keys`.
- **Assume a fixed minimum window size.** The Electron `BrowserWindow` has a known starting size (`1280x800` currently). Layouts target that range and up. If something doesn't fit at 1024×768, that's a real bug — but going below 800px wide isn't a supported scenario.
- **Use density-appropriate MUI variants.** Prefer `dense` lists, `size="small"` buttons/inputs, compact toolbars — desktop tools, not phone apps.
- **Don't import or test against viewport-emulating tools** (Chrome DevTools device toolbar, react-responsive helpers, etc.).
- **Don't add a `viewport` meta tag for mobile zoom.** The default Electron renderer doesn't need it.

If the user later asks for a web/mobile build, that becomes an explicit project. Until then, every line of responsive code is dead code.

### 10.11 Definition of "done" for any frontend change

Before marking a UI task complete, verify:

1. The change is split into appropriately small components — no monolithic file.
2. State lives at the lowest level it can; contexts are split + memoized.
3. New visual styles come from the MUI theme, not hardcoded values.
4. Server data goes through a custom hook in `src/hooks/queries|mutations/` (or RTK Query once introduced) — never an inline axios/fetch in a component.
5. Lists have stable keys; expensive children are memoized; callbacks/objects in props are stable.
6. The change works in both dark and light theme modes (if light is in use).
7. No new dependencies introduced without justification (see §11).

## 11. General behavior

- Match existing code style. Don't reformat untouched code.
- Don't add comments that just restate what code does. Only comment non-obvious WHY.
- No backward-compat shims for code we just changed — this is a fresh codebase.
- Don't introduce dependencies casually. Each new dep should have a clear, called-out reason.
- Don't run destructive commands (`rm -rf node_modules`, `git reset --hard`, force pushes) without confirmation.
- When unsure between two valid approaches, ask — don't pick silently.
