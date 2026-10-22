#!/usr/bin/env bash
# is-light-run.sh against fixtures/light-runs. Red when the predicate drifts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${ROOT}/is-light-run.sh"
FIX="${ROOT}/fixtures/light-runs"

fail=0
ok() { echo "ok $1"; }
bad() {
  echo "FAIL $1: $2" >&2
  fail=1
}

expect() {
  local file="$1"
  local want="$2"
  local got
  if [ ! -f "${FIX}/${file}" ]; then
    bad "$file" "missing fixture"
    return
  fi
  got="$(bash "$SCRIPT" "${FIX}/${file}")"
  if [ "$got" = "$want" ]; then
    ok "$file"
  else
    bad "$file" "got $(printf '%q' "$got") want $want"
  fi
}

expect light-green.json LIGHT-GREEN
expect full-ci-only-failed.json NOT-LIGHT
expect cancelled-only-heavy.json NOT-LIGHT
expect timed-out-heavy.json NOT-LIGHT
expect heavy-success.json NOT-LIGHT
expect ci-light-failure.json NOT-LIGHT
expect failed-ci-and-unit.json NOT-LIGHT
expect ready-light.json READY-LIGHT
expect moved-head.json NOT-LIGHT
expect other-workflow.json NOT-LIGHT
expect draft-unreadable.json NOT-LIGHT

key="$(printf '%s_%s' workflow run)"
assembled="$(jq -n --arg key "$key" --slurpfile body "${FIX}/light-green.json" \
  '{($key): $body[0].workflow_run, jobs: $body[0].jobs, pull_request: $body[0].pull_request}')"
assembled_file="$(mktemp)"
printf '%s\n' "$assembled" > "$assembled_file"
assembled_got="$(bash "$SCRIPT" "$assembled_file")"
rm -f "$assembled_file"
if [ "$assembled_got" = "LIGHT-GREEN" ]; then
  ok assembled-run-key
else
  bad assembled-run-key "$(printf '%q' "$assembled_got")"
fi

missing="$(bash "$SCRIPT" "${FIX}/does-not-exist.json" || true)"
if [ "$missing" = "NOT-LIGHT" ]; then
  ok missing-file
else
  bad missing-file "$(printf '%q' "$missing")"
fi

if [ "$fail" -ne 0 ]; then
  echo "is-light-run tests failed" >&2
  exit 1
fi
echo "all is-light-run tests passed"
