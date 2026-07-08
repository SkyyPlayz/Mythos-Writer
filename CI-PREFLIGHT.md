# CI Preflight

One command that reproduces the PR `ci` gate locally so your branch is green on the first try.

## Prerequisite

The E2E suites need a display. `scripts/preflight.sh` selects the runner per platform (GH#846):

| Platform | E2E runner |
|----------|-----------|
| Linux without `DISPLAY`/`WAYLAND_DISPLAY` (headless — matches CI) | `xvfb-run --auto-servernum` — requires `sudo apt-get install xvfb` |
| Linux with a live display | Playwright/Electron run directly against your session |
| macOS / Windows | run directly — Xvfb does not exist there and nothing extra is required |

Only headless Linux has an install prerequisite; the full preflight is runnable on macOS and Windows out of the box.

### Verifying runner selection

The selection logic is a pure `uname -s` + display-variable check at the top of the E2E section of `scripts/preflight.sh` (syntax-check with `bash -n scripts/preflight.sh`):

- `uname -s` is `Linux` **and** neither `DISPLAY` nor `WAYLAND_DISPLAY` is set → suites run under `xvfb-run --auto-servernum`; if `xvfb-run` is missing the script aborts with the `apt-get install xvfb` hint before starting any suite.
- Anything else (macOS `Darwin`, Windows `MINGW*`/`MSYS*`, Linux desktop session) → suites run directly, no wrapper.

## Usage

```bash
npm run preflight
```

Runs the exact sequence the `ci` aggregator job requires:

1. `npm ci` — deterministic install
2. `npm run lint -w frontend` — ESLint
3. `npm run typecheck -w frontend` + `npm run typecheck -w electron-main` — TypeScript
4. `npm run test -w electron-main -- --coverage` + `npm run test -w frontend -- --coverage` — Vitest unit
5. `npm run build:electron` — electron-vite production build
6. All E2E suites across shards 1–4 (under `xvfb-run --auto-servernum` on headless Linux, directly elsewhere — see Prerequisite)

The script exits non-zero at the first failure and prints which step failed.

## Fast gate (no E2E)

For a quick local sanity check on a non-UI change:

```bash
npm run preflight -- --fast
```

Runs steps 1–5 only (lint → typecheck → unit → build). Catches ~80% of CI failures in a fraction of the time.

## Skip install

When `node_modules` is already up to date:

```bash
npm run preflight -- --skip-install
```

## What the CI `ci` job checks

The `ci` job in `.github/workflows/ci.yml` aggregates these required jobs:

| Job | What it runs |
|-----|-------------|
| `lint` | `npm run lint -w frontend` |
| `typecheck` | frontend + electron-main type-checks |
| `unit` | Vitest with coverage, both workspaces |
| `build-electron` | `electron-vite build` |
| `e2e-shard-1` | crud · draft-history · brainstorm · export · visual-capture · writing-modes · depth-slider · a11y · settings-background |
| `e2e-shard-2` | writing-assistant-tips · two-vault · versioned-drafts · entity |
| `e2e-shard-3` | visual-regression · entity-creation · vault-graph · vault-graph-v0 |
| `e2e-shard-4` | entity-mention · timeline · entries · post-onboarding · continuity-panel · scene-crafter · onboarding-v2 · writing-assistant |

`build-macos` is on-demand only (not a PR check). `build-linux` and `build-windows` fast-exit as no-ops on PRs.

## Policy

Per the owner's first-run-green directive: open a PR only after `npm run preflight` (or at minimum `npm run preflight -- --fast` for non-UI changes) exits 0 locally. A PR that comes back red on the first CI run is a process miss.
