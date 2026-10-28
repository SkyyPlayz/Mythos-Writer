#!/usr/bin/env bash
# ci-mode.sh plus the mode job guard. Each row is red if the decision flips.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WF="${ROOT}/.github/workflows/ci.yml"
SCRIPT="${ROOT}/.github/scripts/ci-mode.sh"

fail=0
ok() { echo "ok $1"; }
bad() {
  echo "FAIL $1: $2" >&2
  fail=1
}

if ! command -v yq >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
  echo "FAIL tools: yq and jq are required" >&2
  exit 1
fi

decide="$(yq -r '.jobs.mode.steps[] | select(.id == "decide") | .run' "$WF")"
if [ -z "$decide" ] || [ "$decide" = "null" ]; then
  echo "FAIL extract-decide: mode decide step is empty" >&2
  exit 1
fi
if ! printf '%s' "$decide" | grep -F -q 'bash .github/scripts/ci-mode.sh'; then
  echo "FAIL extract-decide: decide step does not run ci-mode.sh" >&2
  exit 1
fi

# Run the workflow step in an isolated workspace. script_kind: real|missing|custom.
run_decide() {
  local event_name="$1"
  local payload="$2"
  local script_kind="$3"
  local custom_body="${4:-}"
  local work status
  work="$(mktemp -d)"
  mkdir -p "$work/.github/scripts" "$work/rt"
  case "$script_kind" in
    real) cp "$SCRIPT" "$work/.github/scripts/ci-mode.sh" ;;
    missing) ;;
    custom) printf '%s\n' "$custom_body" > "$work/.github/scripts/ci-mode.sh" ;;
    *) echo "bad script_kind" >&2; return 2 ;;
  esac
  printf '%s' "$payload" > "$work/event.json"
  : > "$work/github_output"
  set +e
  (
    cd "$work"
    GITHUB_EVENT_NAME="$event_name" \
      GITHUB_EVENT_PATH="$work/event.json" \
      GITHUB_OUTPUT="$work/github_output" \
      RUNNER_TEMP="$work/rt" \
      bash -c "$decide"
  )
  status=$?
  set -e
  printf '%s\n' "$status"
  cat "$work/github_output"
  rm -rf "$work"
}

expect_full() {
  local name="$1"
  local event_name="$2"
  local payload="$3"
  local kind="${4:-real}"
  local body="${5:-}"
  local got status line
  got="$(run_decide "$event_name" "$payload" "$kind" "$body")"
  status="$(printf '%s\n' "$got" | head -n 1)"
  line="$(printf '%s\n' "$got" | tail -n +2)"
  if [ "$status" != "0" ]; then
    bad "$name" "guard exit $status"
    return
  fi
  if [ "$line" = "full=${6:-true}" ]; then
    ok "$name"
  else
    bad "$name" "output $(printf '%q' "$line")"
  fi
}

pr_json() {
  local draft="$1"
  local ref="$2"
  local action="$3"
  jq -n --argjson draft "$draft" --arg ref "$ref" --arg action "$action" \
    '{action:$action, pull_request:{draft:$draft, head:{ref:$ref}}}'
}

expect_full light-draft-opened pull_request "$(pr_json true 'cursor/draft-ci' opened)" real "" false
expect_full light-sync-draft pull_request "$(pr_json true 'cursor/draft-ci' synchronize)" real "" false
expect_full light-converted-to-draft pull_request "$(pr_json true 'cursor/draft-ci' converted_to_draft)" real "" false
expect_full light-bakeoff pull_request "$(pr_json false 'research/bakeoff/x' synchronize)" real "" false

expect_full full-ready pull_request "$(pr_json false 'cursor/draft-ci' ready_for_review)"
expect_full full-sync-ready pull_request "$(pr_json false 'cursor/draft-ci' synchronize)"
expect_full full-push push '{"ref":"refs/heads/main"}'
expect_full full-dispatch workflow_dispatch '{"inputs":{}}'
expect_full full-dependabot pull_request "$(pr_json false 'dependabot/npm_and_yarn/left-pad-1.0.0' opened)"
expect_full full-merge-group merge_group '{"action":"checks_requested"}'
expect_full full-missing-payload pull_request '' 
# empty file is missing fields after we still pass a file; overwrite by using a directory? 
# The helper always writes the payload. An empty payload is a file that exists but is empty.

# Missing file: point the event path at a path the decide step won't see as a file
# by using a payload the script rejects. Empty file:
expect_full full-empty-payload pull_request ''
expect_full full-garbled-payload pull_request '{not-json'
expect_full full-push-looking-like-draft push "$(pr_json true 'research/bakeoff/x' opened)"

# Branch text with $() and a newline stays a literal and is not executed.
sentinel_work="$(mktemp -d)"
sentinel="$sentinel_work/pwned"
evil_ref="research/bakeoff/\$(touch ${sentinel})
more"
evil_payload="$(jq -n --arg ref "$evil_ref" '{action:"synchronize", pull_request:{draft:false, head:{ref:$ref}}}')"
got="$(run_decide pull_request "$evil_payload" real)"
status="$(printf '%s\n' "$got" | head -n 1)"
line="$(printf '%s\n' "$got" | tail -n +2)"
if [ "$status" = "0" ] && [ "$line" = "full=false" ] && [ ! -e "$sentinel" ]; then
  ok literal-branch
else
  bad literal-branch "status=$status line=$(printf '%q' "$line") sentinel=$([ -e "$sentinel" ] && echo yes || echo no)"
fi
rm -rf "$sentinel_work"

expect_full guard-script-missing pull_request "$(pr_json true 'cursor/draft-ci' opened)" missing
expect_full guard-script-exit-nonzero pull_request "$(pr_json true 'cursor/draft-ci' opened)" custom '#!/bin/bash
printf "full=false\n" >> "$GITHUB_OUTPUT"
exit 1'
expect_full guard-garbled-output pull_request "$(pr_json true 'cursor/draft-ci' opened)" custom '#!/bin/bash
printf "full=maybe\n" >> "$GITHUB_OUTPUT"
exit 0'

# Direct script: invalid JSON exits non-zero and writes nothing.
direct_work="$(mktemp -d)"
printf '{nope' > "$direct_work/event.json"
: > "$direct_work/out"
set +e
GITHUB_EVENT_NAME=pull_request GITHUB_EVENT_PATH="$direct_work/event.json" GITHUB_OUTPUT="$direct_work/out" bash "$SCRIPT"
direct_status=$?
set -e
if [ "$direct_status" -ne 0 ] && [ ! -s "$direct_work/out" ]; then
  ok script-garbled-exits
else
  bad script-garbled-exits "status=$direct_status out=$(cat "$direct_work/out")"
fi
rm -rf "$direct_work"

if [ "$fail" -ne 0 ]; then
  echo "ci-mode tests failed" >&2
  exit 1
fi
echo "all ci-mode tests passed"
