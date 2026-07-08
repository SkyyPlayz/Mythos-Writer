#!/usr/bin/env bash
# CI-parity preflight gate — mirrors the required `ci` check exactly.
# Usage:
#   npm run preflight              full suite (exact CI parity)
#   npm run preflight -- --fast   lint + typecheck + unit + build only (no e2e)
#   npm run preflight -- --skip-install  skip npm ci (deps already installed)
set -euo pipefail

FAST=false
SKIP_INSTALL=false
for arg in "$@"; do
  case "$arg" in
    --fast)          FAST=true ;;
    --skip-install)  SKIP_INSTALL=true ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

step()  { echo -e "\n${YELLOW}${BOLD}==> $1${NC}"; }
pass()  { echo -e "${GREEN}✓  $1${NC}"; }
abort() { echo -e "\n${RED}✗  PREFLIGHT FAILED: $1${NC}\n" >&2; exit 1; }

echo -e "${BOLD}Mythos-Writer preflight — CI parity gate${NC}"
if $FAST; then echo -e "${YELLOW}(--fast: e2e skipped)${NC}"; fi

# ── 1. Install ───────────────────────────────────────────────────────────────
if $SKIP_INSTALL; then
  echo "(--skip-install: skipping npm ci)"
else
  step "npm ci (deterministic install)"
  npm ci || abort "npm ci"
  pass "Dependencies installed"
fi

# ── 2. Lint ──────────────────────────────────────────────────────────────────
step "Lint (frontend)"
npm run lint -w frontend || abort "lint"
pass "Lint"

# ── 3. Type-check ────────────────────────────────────────────────────────────
step "Type-check (frontend)"
npm run typecheck -w frontend || abort "typecheck (frontend)"
pass "Type-check (frontend)"

step "Type-check (electron-main)"
npm run typecheck -w electron-main || abort "typecheck (electron-main)"
pass "Type-check (electron-main)"

# ── 4. Unit tests ────────────────────────────────────────────────────────────
step "Unit tests (electron-main)"
npm run test -w electron-main -- --coverage || abort "unit tests (electron-main)"
pass "Unit tests (electron-main)"

step "Unit tests (frontend)"
npm run test -w frontend -- --coverage || abort "unit tests (frontend)"
pass "Unit tests (frontend)"

# ── 5. Build ─────────────────────────────────────────────────────────────────
step "Build (electron-vite)"
NODE_OPTIONS="--max-old-space-size=4096" npm run build:electron || abort "build:electron"
pass "Build"

# ── 6. E2E ───────────────────────────────────────────────────────────────────
if $FAST; then
  echo -e "\n${YELLOW}Fast gate complete — e2e skipped (--fast).${NC}"
  echo -e "${YELLOW}Run without --fast for full CI parity.${NC}"
  exit 0
fi

OS="$(uname -s)"
if [ "$OS" = "Linux" ]; then
  if ! command -v xvfb-run >/dev/null 2>&1; then
    abort "xvfb-run not found — install with: sudo apt-get install xvfb"
  fi
  e2e() {
    local label="$1"; shift
    xvfb-run --auto-servernum npm run "$@" || abort "e2e $label"
    pass "E2E $label"
  }
else
  echo -e "${YELLOW}(macOS: running e2e against native display, xvfb not required)${NC}"
  e2e() {
    local label="$1"; shift
    npm run "$@" || abort "e2e $label"
    pass "E2E $label"
  }
fi

step "E2E — Shard 1 (crud · draft-history · brainstorm · export · visual-capture · writing-modes · depth-slider · a11y · settings-background)"
e2e crud               test:e2e:crud
e2e draft-history      test:e2e:draft-history
e2e brainstorm         test:e2e:brainstorm
e2e export             test:e2e:export
e2e visual-capture     test:e2e:visual-capture
e2e writing-modes      test:e2e:writing-modes
e2e depth-slider       test:e2e:depth-slider
e2e a11y               test:e2e:a11y
e2e settings-background test:e2e:settings-background

step "E2E — Shard 2 (writing-assistant-tips · two-vault · versioned-drafts · entity)"
e2e writing-assistant-tips test:e2e:writing-assistant-tips
e2e two-vault              test:e2e:two-vault
e2e versioned-drafts       test:e2e:versioned-drafts
e2e entity                 test:e2e:entity

step "E2E — Shard 3 (visual-regression · entity-creation · vault-graph · vault-graph-v0)"
e2e visual-regression  test:e2e:visual-regression
e2e entity-creation    test:e2e:entity-creation
e2e vault-graph        test:e2e:vault-graph
e2e vault-graph-v0     test:e2e:vault-graph-v0

step "E2E — Shard 4 (entity-mention · timeline · entries · post-onboarding · continuity-panel · scene-crafter · onboarding-v2 · writing-assistant)"
e2e entity-mention     test:e2e:entity-mention
e2e timeline           test:e2e:timeline
e2e entries            test:e2e:entries
e2e post-onboarding    test:e2e:post-onboarding
e2e continuity-panel   test:e2e:continuity-panel
e2e scene-crafter      test:e2e:scene-crafter
e2e onboarding-v2      test:e2e:onboarding-v2
e2e writing-assistant  test:e2e:writing-assistant

echo -e "\n${GREEN}${BOLD}✓ Preflight complete — all checks passed. This branch is green.${NC}\n"
