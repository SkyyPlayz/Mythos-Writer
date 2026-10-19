#!/usr/bin/env bash
# ci-aggregate.sh behavior and the ci.yml mode contract. Red when a rule is dropped.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WF="${ROOT}/.github/workflows/ci.yml"
AGG="${ROOT}/.github/scripts/ci-aggregate.sh"
LIGHT="${ROOT}/.github/scripts/light-jobs.txt"
CHECK="${ROOT}/.github/scripts/check-workflow-yaml.py"

fail=0
ok() { echo "ok $1"; }
bad() {
  echo "FAIL $1: $2" >&2
  fail=1
}

if ! command -v yq >/dev/null 2>&1; then
  echo "FAIL tools: yq is required" >&2
  exit 1
fi

run_agg() {
  env \
    -u MODE_RESULT -u FULL -u LINT_RESULT -u TYPECHECK_RESULT -u UNIT_RESULT \
    -u ORACLE_SWEEPS_RESULT -u BUILD_ELECTRON_RESULT -u NOTES_WINDOWS_RESULT \
    -u E2E_SHARD_1_RESULT -u E2E_SHARD_2_RESULT -u E2E_SHARD_3_RESULT -u E2E_SHARD_4_RESULT \
    -u PATHS_FILTER_RUN_E2E \
    "$@" \
    bash "$AGG"
}

expect_exit() {
  local name="$1"
  local want="$2"
  shift 2
  local out status
  set +e
  out="$(run_agg "$@")"
  status=$?
  set -e
  if [ "$status" -eq "$want" ]; then
    printf '%s' "$out"
    return 0
  fi
  bad "$name" "exit $status want $want output $(printf '%q' "$out")"
  return 1
}

set_full() {
  full_env=(
    MODE_RESULT=success FULL=true
    LINT_RESULT=success TYPECHECK_RESULT=success UNIT_RESULT=success
    ORACLE_SWEEPS_RESULT=success BUILD_ELECTRON_RESULT=success NOTES_WINDOWS_RESULT=success
    "E2E_SHARD_1_RESULT=$1" "E2E_SHARD_2_RESULT=$2" "E2E_SHARD_3_RESULT=$3" "E2E_SHARD_4_RESULT=$4"
    "PATHS_FILTER_RUN_E2E=$5"
  )
}

if out="$(expect_exit light-exits-1 1 FULL=false MODE_RESULT=success LINT_RESULT=success TYPECHECK_RESULT=success UNIT_RESULT=success)"; then
  if printf '%s' "$out" | grep -q 'DRAFT-LIGHT' && ! printf '%s' "$out" | grep -q 'All checks passed'; then
    ok light-exits-1
  else
    bad light-exits-1 "stdout $(printf '%q' "$out")"
  fi
else
  bad light-exits-1 "light branch did not exit 1"
fi

if expect_exit full-empty 1 MODE_RESULT=success FULL='' >/dev/null; then ok full-empty; fi
if expect_exit full-TRUE 1 MODE_RESULT=success FULL='TRUE' >/dev/null; then ok full-TRUE; fi
if expect_exit full-true-newline 1 MODE_RESULT=success FULL=$'true\n' >/dev/null; then ok full-true-newline; fi
if expect_exit mode-not-success 1 MODE_RESULT=failure FULL=true LINT_RESULT=success >/dev/null; then ok mode-not-success; fi

set_full success success success success false
if out="$(expect_exit notes-windows-skipped 1 "${full_env[@]}" NOTES_WINDOWS_RESULT=skipped)"; then
  ok notes-windows-skipped
else
  bad notes-windows-skipped "unexpected exit"
fi
if out="$(expect_exit build-electron-skipped 1 "${full_env[@]}" BUILD_ELECTRON_RESULT=skipped)"; then
  ok build-electron-skipped
else
  bad build-electron-skipped "unexpected exit"
fi
if out="$(expect_exit all-success 0 "${full_env[@]}")"; then
  if printf '%s' "$out" | grep -q 'All checks passed'; then
    ok all-success
  else
    bad all-success "missing success line"
  fi
else
  bad all-success "unexpected exit"
fi
set_full skipped skipped skipped skipped false
if expect_exit e2e-skipped-when-filtered 0 "${full_env[@]}" >/dev/null; then
  ok e2e-skipped-when-filtered
fi
set_full skipped skipped skipped skipped true
if expect_exit e2e-all-skipped-but-required 1 "${full_env[@]}" >/dev/null; then
  ok e2e-all-skipped-but-required
fi
set_full failure success success success true
if expect_exit e2e-failure 1 "${full_env[@]}" >/dev/null; then
  ok e2e-failure
fi

needs="$(yq -c '.jobs.ci.needs' "$WF")"
want='["mode","lint","typecheck","unit","oracle-sweeps","build-electron","paths-filter","e2e-shard-1","e2e-shard-2","e2e-shard-3","e2e-shard-4","notes-windows"]'
if [ "$needs" = "$want" ]; then
  ok ci-needs
else
  bad ci-needs "$needs"
fi

ci_if="$(yq -r '.jobs.ci.if' "$WF")"
if [ "$ci_if" = "always()" ]; then ok ci-always; else bad ci-always "$ci_if"; fi

types="$(yq -c '.on.pull_request.types' "$WF")"
want_types='["opened","synchronize","reopened","ready_for_review","converted_to_draft"]'
if [ "$types" = "$want_types" ]; then ok pr-types; else bad pr-types "$types"; fi

light_if="$(yq -r '.jobs["ci-light"].if' "$WF")"
if printf '%s' "$light_if" | grep -F -q "needs.mode.outputs.full == 'false'" && printf '%s' "$light_if" | grep -q 'always()'; then
  ok ci-light-if
else
  bad ci-light-if "$light_if"
fi

while IFS= read -r job; do
  [ -n "$job" ] || continue
  job_if="$(yq -r --arg job "$job" '.jobs[$job].if // ""' "$WF")"
  needs_json="$(yq -c --arg job "$job" '.jobs[$job].needs // []' "$WF")"
  if grep -qx "$job" "$LIGHT"; then
    if [ "$job" = "ci-light" ]; then
      continue
    fi
    if printf '%s' "$job_if" | grep -F -q "needs.mode.outputs.full == 'true'"; then
      bad "light-not-gated-$job" "light job is mode-gated off"
    fi
  else
    if ! printf '%s' "$job_if" | grep -F -q "needs.mode.outputs.full == 'true'"; then
      bad "mode-gated-$job" "if is $(printf '%q' "$job_if")"
    fi
    if ! printf '%s' "$needs_json" | grep -q '"mode"'; then
      bad "needs-mode-$job" "$needs_json"
    fi
  fi
done < <(yq -r '.jobs | keys[]' "$WF")
if [ "$fail" -eq 0 ]; then ok job-partition; fi

while IFS= read -r name; do
  [ -n "$name" ] || continue
  if ! yq -e --arg name "$name" '.jobs | has($name)' "$WF" >/dev/null; then
    bad "light-list-$name" "not a job"
  fi
done < "$LIGHT"

perm="$(yq -c '.jobs.mode.permissions' "$WF")"
if [ "$perm" = "{}" ]; then ok mode-permissions; else bad mode-permissions "$perm"; fi

uses="$(yq -r '.jobs.mode.steps[] | select(.uses != null) | .uses' "$WF")"
persist="$(yq -r '.jobs.mode.steps[] | select(.uses != null) | .with["persist-credentials"]' "$WF")"
sparse="$(yq -r '.jobs.mode.steps[] | select(.uses != null) | .with["sparse-checkout"]' "$WF")"
ref="$(yq -r '.jobs.mode.steps[] | select(.uses != null) | .with.ref // ""' "$WF")"
case "$uses" in
  actions/checkout@[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ok checkout-pin ;;
  *) bad checkout-pin "$uses" ;;
esac
if [ "$persist" = "false" ]; then ok persist-credentials; else bad persist-credentials "$persist"; fi
if [ "$sparse" = ".github/scripts" ]; then ok sparse-checkout; else bad sparse-checkout "$sparse"; fi
if [ -z "$ref" ]; then ok no-ref-main; else bad no-ref-main "$ref"; fi

top="$(yq -c '.permissions' "$WF")"
if [ "$top" = '{"contents":"read"}' ]; then ok ci-permissions; else bad ci-permissions "$top"; fi

if grep -n 'pull_request_target' "$ROOT"/.github/workflows/*.yml >/dev/null; then
  bad no-pull-request-target "found"
else
  ok no-pull-request-target
fi
if grep -n 'workflow_run' "$WF" >/dev/null; then
  bad ci-no-workflow-run "found"
else
  ok ci-no-workflow-run
fi
# Trigger keys only. Payload field names are not a new workflow_run trigger.
trig_files=""
for wf in "$ROOT"/.github/workflows/*.yml; do
  if yq -e '.on | has("workflow_run")' "$wf" >/dev/null 2>&1; then
    trig_files="${trig_files} $(basename "$wf")"
  fi
done
if [ "$trig_files" = " mythos-ops-health.yml mythos-pr-hygiene.yml" ]; then
  ok hygiene-workflow-run
else
  bad hygiene-workflow-run "$trig_files"
fi

hyg_perm="$(yq -c '.permissions' "$ROOT/.github/workflows/mythos-pr-hygiene.yml")"
want_hyg='{"contents":"read","pull-requests":"write","issues":"write","actions":"read","checks":"read"}'
if [ "$hyg_perm" = "$want_hyg" ]; then ok hygiene-permissions; else bad hygiene-permissions "$hyg_perm"; fi

if yq -e '.jobs | has("draft-ready-on-green")' "$ROOT/.github/workflows/mythos-pr-hygiene.yml" >/dev/null; then
  bad draft-ready-deleted "job still present"
else
  ok draft-ready-deleted
fi

header="$(sed -n '1,20p' "$ROOT/.github/workflows/mythos-pr-hygiene.yml")"
if printf '%s' "$header" | grep -F -q 'auto ready-for-review'; then
  bad hygiene-header "auto ready text remains"
else
  ok hygiene-header
fi

comment_run="$(yq -r '.jobs["draft-ci-comment"].steps[].run' "$ROOT/.github/workflows/mythos-pr-hygiene.yml")"
if printf '%s' "$comment_run" | grep -F -q 'is-light-run.sh' && printf '%s' "$comment_run" | grep -F -q 'LIGHT-GREEN'; then
  ok hygiene-skips-light-green
else
  bad hygiene-skips-light-green "draft-ci-comment does not skip LIGHT-GREEN"
fi

# Forbidden marker is built here so this test file does not contain it.
phrase=$(printf '%s%s' 'gh pr ' 'ready')
bad_root="$(mktemp -d)"
mkdir -p "$bad_root/.github/workflows" "$bad_root/.github/scripts"
printf 'name: bad\njobs: {}\nrun: %s\n' "$phrase" > "$bad_root/.github/workflows/bad.yml"
if python3 "$CHECK" "$bad_root" >/dev/null 2>"$bad_root/err"; then
  bad banned-marker "checker passed a forbidden workflow"
else
  if grep -q 'forbidden auto-ready marker' "$bad_root/err"; then
    ok banned-marker
  else
    bad banned-marker "$(cat "$bad_root/err")"
  fi
fi
rm -rf "$bad_root"

if python3 "$CHECK" "$ROOT" >"$ROOT/out-check.txt"; then
  ok workflow-yaml
else
  bad workflow-yaml "$(cat "$ROOT/out-check.txt")"
fi
rm -f "$ROOT/out-check.txt"

signal="$(yq -r '.jobs["ci-light"].steps[] | select(.id == "signal") | .run' "$WF")"
if [ -z "$signal" ] || [ "$signal" = "null" ]; then
  bad ci-light-step "missing"
else
  set +e
  out="$(MODE_RESULT=success LINT_RESULT=success TYPECHECK_RESULT=success UNIT_RESULT=success bash -c "$signal")"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then ok ci-light-green; else bad ci-light-green "exit $status $out"; fi
  set +e
  out="$(MODE_RESULT=success LINT_RESULT=success TYPECHECK_RESULT=success UNIT_RESULT=failure bash -c "$signal")"
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then ok ci-light-red; else bad ci-light-red "exit 0"; fi
fi

if [ "$fail" -ne 0 ]; then
  echo "ci-aggregate tests failed" >&2
  exit 1
fi
echo "all ci-aggregate tests passed"
