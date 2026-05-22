# Mythos Writer

AI-powered creative writing and story generation tool — desktop-first Electron app built with React + TypeScript.

## Tech Stack

| Layer         | Technology                                              |
| ------------- | ------------------------------------------------------- |
| Shell         | Electron 33, electron-vite, electron-builder            |
| Renderer      | React 18, Vite, TypeScript, TipTap                      |
| Main process  | Node.js 20, TypeScript, better-sqlite3, Anthropic SDK   |
| AI            | Anthropic Claude API (`@anthropic-ai/sdk`)              |
| Tooling       | ESLint, Prettier, Vitest, GitHub Actions                |

## Architecture

Mythos Writer is a **desktop Electron app**, not a web app. There is no HTTP server. The React renderer and Electron main process communicate exclusively over Electron IPC — all AI calls, vault file I/O, and SQLite access happen in the main process and are exposed to the renderer through typed IPC channels defined in `electron-main/src/ipc.ts`.

```
mythos-writer/
├── electron-main/        # Electron main process + IPC handlers
│   └── src/
│       ├── main.ts       # App lifecycle, BrowserWindow, IPC setup
│       ├── ipc.ts        # Channel definitions + typed handler contract
│       ├── vault.ts      # Vault file I/O (markdown, manifest)
│       ├── manifest.ts   # manifest.json schema + migration
│       ├── entities.ts   # Entity CRUD
│       ├── snapshots.ts  # Scene snapshot history
│       └── db.ts         # SQLite (suggestions, audit log, timeline)
├── frontend/             # React renderer (Vite)
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       └── ...
├── out/                  # electron-vite build output (gitignored)
│   ├── main/             # Compiled main process
│   ├── preload/          # Compiled preload script
│   └── renderer/         # Compiled renderer (loaded by Electron in prod)
├── dist-electron/        # electron-builder packaged artifacts (gitignored)
├── electron.vite.config.ts
├── electron-builder.json
└── package.json          # Root workspace: frontend + electron-main
```

## Prerequisites

- Node.js 20+
- npm 10+
- An [Anthropic API key](https://console.anthropic.com/) — set in-app via Settings, or via `ANTHROPIC_API_KEY` env var

## Local setup

```bash
# 1. Clone
git clone https://github.com/SkyyPlayz/Mythos-Writer.git
cd Mythos-Writer

# 2. Install all workspace dependencies
npm install
```

No `.env` file is needed for local dev. The API key is entered directly in the app's Settings panel (persisted to Electron's `userData`). Alternatively, export `ANTHROPIC_API_KEY` before starting.

## Development

```bash
npm run dev
```

Starts `electron-vite dev`: hot-reloads the React renderer in a live Electron window, watches the main process, and sets `VITE_DEV_SERVER_URL` so Electron loads the Vite dev server instead of the built renderer.

## Production build and start

```bash
# 1. Compile main process + renderer to out/
npm run build:electron

# 2. Launch the compiled app (no packaging — fast local test of prod mode)
npm start

# 3. (Optional) Package as a distributable Windows zip
npm run build         # → dist-electron/Mythos Writer-<version>.zip

# 4. (Optional) Build a Windows NSIS installer
npm run build:installer  # → dist-electron/Mythos Writer-<version>.exe
```

`npm start` runs `electron .` against the files in `out/` (built by the previous step). In production mode, `VITE_DEV_SERVER_URL` is not set, so Electron loads `out/renderer/index.html` directly — no HTTP server involved.

## Available scripts (run from repo root)

| Script                  | What it does                                          |
| ----------------------- | ----------------------------------------------------- |
| `npm run dev`           | Start Electron app in hot-reload dev mode             |
| `npm run build:electron`| Compile main + preload + renderer to `out/`           |
| `npm start`             | Launch the already-built app from `out/` (prod mode)  |
| `npm run build`         | Compile + package as Windows zip to `dist-electron/`  |
| `npm run build:installer` | Compile + package as Windows NSIS installer         |
| `npm run lint`          | ESLint across frontend                                |
| `npm run test`          | Vitest across both packages                           |
| `npm run typecheck`     | `tsc --noEmit` across both packages                   |

## Environment variables

| Variable            | Description                                                     |
| ------------------- | --------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | Anthropic API key — fallback if not set in app Settings         |

The API key is primarily stored via the in-app Settings panel (Electron `userData/app-settings.json`). The env var is a fallback for CI or headless use.

## CI

GitHub Actions runs on every push and pull request to `main`:

1. `npm ci` — install dependencies
2. Lint — ESLint on frontend
3. Type-check — `tsc --noEmit` on frontend and electron-main
4. Test — Vitest on electron-main and frontend
5. Build — `npm run build:electron` (compiles main + renderer to `out/`, no packaging)

## Releasing

The release workflow (`.github/workflows/release.yml`) runs automatically when a version tag is pushed.

```bash
# 1. Tag the release
git tag v0.x.y
git push --tags
```

2. GitHub Actions builds the Windows NSIS installer and ZIP on `windows-latest`.
3. A **draft** GitHub Release is created with both artifacts attached — no assets are published automatically.
4. Go to the [Releases page](https://github.com/SkyyPlayz/Mythos-Writer/releases), review the draft, and click **Publish release** when ready.

> Mac and Linux builds are stubbed (`if: false`) pending code signing setup in Phase 4.

To test the workflow without shipping a real release, push a pre-release tag and delete the resulting draft immediately:

```bash
git tag v0.0.0-test
git push origin v0.0.0-test
# after verifying the draft release is created, delete tag and release:
git push --delete origin v0.0.0-test
git tag -d v0.0.0-test
```
