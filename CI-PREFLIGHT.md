# CI Preflight

One command that reproduces the PR `ci` gate locally so your branch is green on the first try.

## Prerequisite

`xvfb-run` must be installed for the E2E suites (CI runs Electron headless via Xvfb):

```bash
sudo apt-get install xvfb
```

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
6. All E2E suites across shards 1–4, each via `xvfb-run --auto-servernum`

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
