#!/usr/bin/env bash
# Smoke test: BugHunt-Fisher.sh zero-findings run.
# Verifies that when Probes 1+2 produce 0 findings (clean tree, no TODO markers),
# the script exits 0, emits 0 findings, and JSON `findings` is [].
#
# We set up an isolated minimal git repo so real TODO markers and git history
# don't interfere. The Fisher script is copied in with its required plan files.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FISHER="$SCRIPT_DIR/BugHunt-Fisher.sh"
TMP_DIR="$(mktemp -d)"
ARTIFACT="$TMP_DIR/daily_bug_hunt_19700101.json"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# Build a clean git sandbox: no TODO/FIXME markers, single commit so
# HEAD~1 diff is empty (or the diff shows only harmless plan files).
SANDBOX="$TMP_DIR/sandbox"
mkdir -p "$SANDBOX/electron-main" "$SANDBOX/frontend" "$SANDBOX/scripts" "$SANDBOX/plans"

# Minimal plan files so the Fisher doesn't fall back to "No ... found".
cp "$SCRIPT_DIR/plans/bug_hunt_core_plan.md"       "$SANDBOX/plans/" 2>/dev/null || echo "# stub" > "$SANDBOX/plans/bug_hunt_core_plan.md"
cp "$SCRIPT_DIR/plans/github_issue_fishing_plan.md" "$SANDBOX/plans/"
cp "$SCRIPT_DIR/plans/daily_run_template.md"        "$SANDBOX/plans/" 2>/dev/null || echo "{{RUN_DATE}}" > "$SANDBOX/plans/daily_run_template.md"

# Source files with zero TODO/FIXME/HACK.
echo "// clean" > "$SANDBOX/electron-main/index.js"
echo "// clean" > "$SANDBOX/frontend/App.jsx"
echo "# clean" > "$SANDBOX/scripts/helper.sh"

# Single-commit git repo: HEAD~1 doesn't exist, so Probe 2's
# `git diff HEAD~1` produces no output (error swallowed by `|| true`).
git -C "$SANDBOX" init -q
git -C "$SANDBOX" config user.email "smoke@test"
git -C "$SANDBOX" config user.name "Smoke"
git -C "$SANDBOX" add .
git -C "$SANDBOX" commit -q -m "init"

# Run Fisher from inside the sandbox so both probes see the clean state.
cp "$FISHER" "$SANDBOX/BugHunt-Fisher.sh"
chmod +x "$SANDBOX/BugHunt-Fisher.sh"
(cd "$SANDBOX" && ./BugHunt-Fisher.sh --run-date 19700101 --output-dir "$TMP_DIR" >/dev/null 2>&1) \
  || fail "BugHunt-Fisher.sh exited non-zero"

[[ -f "$ARTIFACT" ]] || fail "JSON artifact not written"

findings_count="$(python3 -c "
import json
with open('$ARTIFACT') as f:
    data = json.load(f)
print(len(data['findings']))
")"

[[ "$findings_count" == "0" ]] \
  || fail "Expected 0 findings, got $findings_count"

findings_array="$(python3 -c "
import json
with open('$ARTIFACT') as f:
    data = json.load(f)
print(json.dumps(data['findings']))
")"

[[ "$findings_array" == "[]" ]] \
  || fail "Expected findings=[], got: $findings_array"

pass "0-finding run: exit 0, findings=[]"

# Exclusion regression: seed the sandbox with this smoke-test script (which
# contains TODO/FIXME/HACK in its own comments) and assert Fisher still emits
# 0 findings — proving the -g exclusion glob is wired correctly.
cp "${BASH_SOURCE[0]}" "$SANDBOX/scripts/test-bughunt-fisher-smoke.sh"
ARTIFACT2="$TMP_DIR/daily_bug_hunt_19700102.json"
(cd "$SANDBOX" && ./BugHunt-Fisher.sh --run-date 19700102 --output-dir "$TMP_DIR" >/dev/null 2>&1) \
  || fail "BugHunt-Fisher.sh (exclusion run) exited non-zero"

[[ -f "$ARTIFACT2" ]] || fail "JSON artifact not written for exclusion run"

exclusion_count="$(python3 -c "
import json
with open('$ARTIFACT2') as f:
    data = json.load(f)
print(len(data['findings']))
")"

[[ "$exclusion_count" == "0" ]] \
  || fail "Exclusion regression: smoke-test file seeded in scripts/ but Fisher still returned $exclusion_count finding(s); -g exclusion glob is broken"

pass "exclusion regression: smoke-test markers in scripts/ correctly excluded, findings=[]"
echo "Smoke test passed."
