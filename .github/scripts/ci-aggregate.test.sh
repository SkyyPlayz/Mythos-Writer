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

# Workflow YAML via PyYAML. GitHub runners ship mikefarah yq; local images often
# ship kislyuk yq. Those flags are not the same, so the assertions do not call yq.
wfq() {
  python3 - "$1" "$2" "${3:-}" <<'PY'
import json
import sys
import yaml

path, query, arg = sys.argv[1], sys.argv[2], sys.argv[3]

def norm(obj):
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            if key is True:
                name = "on"
            elif key is False:
                name = "off"
            else:
                name = str(key)
            out[name] = norm(value)
        return out
    if isinstance(obj, list):
        return [norm(item) for item in obj]
    return obj

with open(path, encoding="utf-8") as handle:
    data = norm(yaml.safe_load(handle))

def emit(value):
    if isinstance(value, (dict, list)):
        sys.stdout.write(json.dumps(value, separators=(",", ":")))
    elif isinstance(value, bool):
        sys.stdout.write("true" if value else "false")
    elif value is None:
        sys.stdout.write("")
    else:
        sys.stdout.write(str(value))

def checkout(doc):
    for step in doc["jobs"]["mode"]["steps"]:
        if "uses" in step:
            return step
    return {}

jobs = data.get("jobs") or {}
if query == "ci-needs":
    emit(jobs["ci"]["needs"])
elif query == "ci-if":
    emit(jobs["ci"].get("if") or "")
elif query == "pr-types":
    emit(data["on"]["pull_request"]["types"])
elif query == "ci-light-if":
    emit(jobs["ci-light"].get("if") or "")
elif query == "job-names":
    sys.stdout.write("\n".join(jobs.keys()))
elif query == "job-if":
    emit(jobs[arg].get("if") or "")
elif query == "job-needs":
    emit(jobs[arg].get("needs") or [])
elif query == "has-job":
    emit(arg in jobs)
elif query == "mode-permissions":
    emit(jobs["mode"].get("permissions"))
elif query == "mode-uses":
    emit(checkout(data).get("uses") or "")
elif query == "mode-persist":
    emit((checkout(data).get("with") or {}).get("persist-credentials"))
elif query == "mode-sparse":
    emit((checkout(data).get("with") or {}).get("sparse-checkout") or "")
elif query == "mode-ref":
    emit((checkout(data).get("with") or {}).get("ref") or "")
elif query == "permissions":
    emit(data.get("permissions"))
elif query == "has-workflow-run":
    on = data.get("on")
    if isinstance(on, dict):
        emit("workflow_run" in on)
    elif isinstance(on, list):
        emit("workflow_run" in on)
    else:
        emit(False)
elif query == "comment-runs":
    parts = []
    for step in jobs["draft-ci-comment"]["steps"]:
        run = step.get("run")
        if isinstance(run, str):
            parts.append(run)
    sys.stdout.write("\n".join(parts))
elif query == "signal-run":
    text = ""
    for step in jobs["ci-light"]["steps"]:
        if step.get("id") == "signal":
            text = step.get("run") or ""
    sys.stdout.write(text)
else:
    sys.stderr.write("unknown query %s\n" % query)
    sys.exit(2)
PY
}

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

needs="$(wfq "$WF" ci-needs)"
want='["mode","lint","typecheck","unit","oracle-sweeps","build-electron","paths-filter","e2e-shard-1","e2e-shard-2","e2e-shard-3","e2e-shard-4","notes-windows"]'
if [ "$needs" = "$want" ]; then
  ok ci-needs
else
  bad ci-needs "$needs"
fi

# Each required job must appear in ci.needs. Removing one (oracle-sweeps, for
# example) fails here even when the rest of the list still parses.
required_jobs='mode lint typecheck unit oracle-sweeps build-electron paths-filter e2e-shard-1 e2e-shard-2 e2e-shard-3 e2e-shard-4 notes-windows'
missing_jobs=""
for job in $required_jobs; do
  case "$needs" in
    *"\"${job}\""*) ;;
    *) missing_jobs="${missing_jobs} ${job}" ;;
  esac
done
if [ -z "$missing_jobs" ]; then
  ok required-jobs-in-needs
else
  bad required-jobs-in-needs "missing:${missing_jobs}"
fi

ci_if="$(wfq "$WF" ci-if)"
if [ "$ci_if" = "always()" ]; then ok ci-always; else bad ci-always "$ci_if"; fi

types="$(wfq "$WF" pr-types)"
want_types='["opened","synchronize","reopened","ready_for_review","converted_to_draft"]'
if [ "$types" = "$want_types" ]; then ok pr-types; else bad pr-types "$types"; fi

light_if="$(wfq "$WF" ci-light-if)"
if printf '%s' "$light_if" | grep -F -q "needs.mode.outputs.full == 'false'" && printf '%s' "$light_if" | grep -q 'always()'; then
  ok ci-light-if
else
  bad ci-light-if "$light_if"
fi

while IFS= read -r job; do
  [ -n "$job" ] || continue
  job_if="$(wfq "$WF" job-if "$job")"
  needs_json="$(wfq "$WF" job-needs "$job")"
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
done < <(wfq "$WF" job-names)
if [ "$fail" -eq 0 ]; then ok job-partition; fi

while IFS= read -r name; do
  [ -n "$name" ] || continue
  if [ "$(wfq "$WF" has-job "$name")" != "true" ]; then
    bad "light-list-$name" "not a job"
  fi
done < "$LIGHT"

perm="$(wfq "$WF" mode-permissions)"
if [ "$perm" = "{}" ]; then ok mode-permissions; else bad mode-permissions "$perm"; fi

uses="$(wfq "$WF" mode-uses)"
persist="$(wfq "$WF" mode-persist)"
sparse="$(wfq "$WF" mode-sparse)"
ref="$(wfq "$WF" mode-ref)"
case "$uses" in
  actions/checkout@[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ok checkout-pin ;;
  *) bad checkout-pin "$uses" ;;
esac
if [ "$persist" = "false" ]; then ok persist-credentials; else bad persist-credentials "$persist"; fi
if [ "$sparse" = ".github/scripts" ]; then ok sparse-checkout; else bad sparse-checkout "$sparse"; fi
if [ -z "$ref" ]; then ok no-ref-main; else bad no-ref-main "$ref"; fi

ci_block="$(awk '
  /^  ci:$/ { capture=1; next }
  capture && /^  [A-Za-z0-9-]+:$/ { exit }
  capture { print }
' "$WF")"
ci_uses_line="$(printf '%s\n' "$ci_block" | grep -E 'uses: actions/checkout@' | head -n 1)"
if printf '%s\n' "$ci_uses_line" | grep -Eq 'actions/checkout@[0-9a-f]{40} # v[0-9]+\.[0-9]+\.[0-9]+'; then
  ok ci-checkout-pin
else
  bad ci-checkout-pin "$ci_uses_line"
fi
if printf '%s\n' "$ci_block" | grep -A 3 -E 'uses: actions/checkout@' | grep -q 'persist-credentials: false'; then
  ok ci-checkout-persist
else
  bad ci-checkout-persist "persist-credentials is not false"
fi

top="$(wfq "$WF" permissions)"
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
  if [ "$(wfq "$wf" has-workflow-run)" = "true" ]; then
    trig_files="${trig_files} $(basename "$wf")"
  fi
done
if [ "$trig_files" = " mythos-ops-health.yml mythos-pr-hygiene.yml" ]; then
  ok hygiene-workflow-run
else
  bad hygiene-workflow-run "$trig_files"
fi

hyg_perm="$(wfq "$ROOT/.github/workflows/mythos-pr-hygiene.yml" permissions)"
want_hyg='{"contents":"read","pull-requests":"write","issues":"write","actions":"read","checks":"read"}'
if [ "$hyg_perm" = "$want_hyg" ]; then ok hygiene-permissions; else bad hygiene-permissions "$hyg_perm"; fi

if [ "$(wfq "$ROOT/.github/workflows/mythos-pr-hygiene.yml" has-job draft-ready-on-green)" = "true" ]; then
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

comment_run="$(wfq "$ROOT/.github/workflows/mythos-pr-hygiene.yml" comment-runs)"
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

signal="$(wfq "$WF" signal-run)"
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
