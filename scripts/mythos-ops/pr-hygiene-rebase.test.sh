#!/usr/bin/env bash
# Behavior tests for the mythos-pr-hygiene auto-rebase gate. No network.
# Pulls the gate step out of the workflow with yq and stubs gh.
#
# GUARD row draft+tip-freeze: the pre-existing tip-freeze skip already
# covers it, so that row stays green if the R-2 draft/do-not-merge filter
# is reverted. Do not treat it as red-on-revert evidence.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WF="${ROOT}/.github/workflows/mythos-pr-hygiene.yml"

fail=0
ok() { echo "ok $1"; }
bad() {
  echo "FAIL $1: $2" >&2
  fail=1
}

if ! command -v yq >/dev/null 2>&1; then
  echo "FAIL yq-present: yq is required to extract the gate script" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL jq-present: jq is required" >&2
  exit 1
fi

gate_raw="$(yq -r '.jobs["auto-rebase"].steps[] | select(.id == "gate") | .run' "$WF")"
if [ -z "$gate_raw" ] || [ "$gate_raw" = "null" ]; then
  echo "FAIL extract-gate: gate step run script is empty" >&2
  exit 1
fi

job_if="$(yq -r '.jobs["auto-rebase"]["if"]' "$WF")"
update_name="$(yq -r '.jobs["auto-rebase"].steps[] | select(.run != null and (.run | contains("update-branch"))) | .name' "$WF")"
update_run="$(yq -r '.jobs["auto-rebase"].steps[] | select(.run != null and (.run | contains("update-branch"))) | .run' "$WF")"

if printf '%s' "$job_if" | grep -q 'workflow_run'; then
  bad workflow_run-excluded "auto-rebase job if contains workflow_run"
else
  ok workflow_run-excluded
fi

triggers_ok=1
for ev in schedule workflow_dispatch pull_request; do
  if ! printf '%s' "$job_if" | grep -q "$ev"; then
    bad triggers-listed "job if missing $ev"
    triggers_ok=0
  fi
done
if [ "$triggers_ok" -eq 1 ]; then
  ok triggers-listed
fi

if printf '%s' "$gate_raw" | grep -q 'reviews'; then
  bad no-reviews "gate script reads reviews"
else
  ok no-reviews
fi

if printf '%s' "$gate_raw" | grep -F -q -- '--json isDraft,labels'; then
  ok view-isDraft-labels
else
  bad view-isDraft-labels "gh pr view does not fetch isDraft,labels"
fi

if [ "$update_name" = "Update branch (drafts only)" ]; then
  ok step-name
else
  bad step-name "expected 'Update branch (drafts only)' actual $(printf '%q' "$update_name")"
fi

if printf '%s' "$update_run" | grep -F -q 'gh api -X PUT "repos/${{ github.repository }}/pulls/$n/update-branch"' \
  && printf '%s' "$update_run" | grep -F -q 'expected_head_sha'; then
  ok put-unchanged
else
  bad put-unchanged "update-branch PUT drifted"
fi

SUBST="$(printf '%s\n' "$gate_raw" | sed \
  -e 's/\${{ github.event_name }}/$EVENT_NAME/g' \
  -e 's/\${{ github.event.pull_request.number }}/$PR_NUMBER/g' \
  -e 's/\${{ github.event.workflow_run.id }}/$RUN_ID/g' \
  -e 's/\${{ github.repository }}/$GITHUB_REPOSITORY/g')"

if printf '%s' "$SUBST" | grep -F -q '${{'; then
  bad subst-expressions "unsubstituted actions expression remains"
else
  ok subst-expressions
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FIXTURES="${TMP}/fixtures.json"
cat > "$FIXTURES" <<'JSON'
[
  {"number":101,"isDraft":true,"mergeStateStatus":"BEHIND","labels":[{"name":"tip-freeze"}]},
  {"number":102,"isDraft":true,"mergeStateStatus":"BEHIND","labels":[{"name":"do-not-merge"}]},
  {"number":103,"isDraft":false,"mergeStateStatus":"BEHIND","labels":[]},
  {"number":104,"isDraft":true,"mergeStateStatus":"BEHIND","labels":[]},
  {"number":105,"isDraft":true,"mergeStateStatus":"BEHIND","labels":[{"name":"tip-freeze"},{"name":"docs"}]},
  {"number":106,"isDraft":true,"mergeStateStatus":"CLEAN","labels":[]}
]
JSON

cat > "${TMP}/gh-stub.sh" <<'END_GH'
gh() {
  if [ "${1:-}" != "pr" ]; then
    echo "unexpected gh invocation: $*" >&2
    return 1
  fi
  local sub="${2:-}"
  shift 2
  local jqfilter="" num="" jsonfields=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --jq)
        jqfilter="${2:-}"
        shift 2
        ;;
      --json)
        jsonfields="${2:-}"
        shift 2
        ;;
      --repo|--state|--limit)
        shift 2
        ;;
      *)
        if [ -z "$num" ]; then
          num="$1"
        fi
        shift
        ;;
    esac
  done
  printf 'call pr %s num=%s json=%s\n' "$sub" "$num" "$jsonfields" >> "${GH_CALLS:?}"
  case "$jsonfields" in
    *reviews*)
      echo "refusing to read reviews" >&2
      return 1
      ;;
  esac
  if [ -z "$jqfilter" ]; then
    echo "gh pr $sub missing --jq" >&2
    return 1
  fi
  if [ "$sub" = "list" ]; then
    jq -r "$jqfilter" "${FIXTURES:?}"
    return 0
  fi
  if [ "$sub" = "view" ]; then
    local obj
    obj="$(jq -c --arg n "$num" '.[] | select(.number == ($n | tonumber))' "${FIXTURES:?}")"
    if [ -z "$obj" ]; then
      echo "no fixture for #$num" >&2
      return 1
    fi
    printf '%s\n' "$obj" | jq -r "$jqfilter"
    return 0
  fi
  echo "unexpected gh pr subcommand: $sub" >&2
  return 1
}
END_GH
cat "${TMP}/gh-stub.sh" > "${TMP}/gate.sh"
printf '%s\n' "$SUBST" >> "${TMP}/gate.sh"
bash -n "${TMP}/gate.sh"

run_gate() {
  local event="$1" prnum="$2" tag="$3"
  local out="${TMP}/out-${tag}" calls="${TMP}/calls-${tag}" stdout="${TMP}/stdout-${tag}" stderr="${TMP}/stderr-${tag}"
  : > "$calls"
  set +e
  EVENT_NAME="$event" PR_NUMBER="$prnum" RUN_ID="" \
    GITHUB_REPOSITORY="SkyyPlayz/Mythos-Writer" \
    GITHUB_WORKSPACE="$ROOT" \
    GITHUB_OUTPUT="$out" \
    FIXTURES="$FIXTURES" \
    GH_CALLS="$calls" \
    bash "${TMP}/gate.sh" >"$stdout" 2>"$stderr"
  local rc=$?
  set -e
  LAST_RC="$rc"
  LAST_STDOUT="$stdout"
  LAST_CALLS="$calls"
  LAST_STDERR="$stderr"
  # Kept ids are the numeric lines the gate emits: the GITHUB_OUTPUT prs
  # value, and/or the xargs echo in the gate script (that echo is not
  # redirected at the workflow's GITHUB_OUTPUT delimiter).
  LAST_KEPT="$(
    {
      awk 'BEGIN{p=0} $0=="prs<<EOF"{p=1;next} $0=="EOF"{p=0;next} p && $0 ~ /^[0-9]+$/{print}' "$out"
      grep -E '^[0-9]+$' "$stdout" || true
    } | awk 'NF && !seen[$0]++'
  )"
  if [ "$rc" -ne 0 ]; then
    bad "gate-exit-${tag}" "rc=$rc stderr=$(tr '\n' ' ' < "$stderr")"
  fi
}

has_line() {
  grep -F -x -q -- "$1" "$2"
}

kept_has() {
  printf '%s\n' "$LAST_KEPT" | grep -F -x -q -- "$1"
}

# schedule: shared per-PR loop (also the workflow_dispatch else-branch).
run_gate schedule "" schedule

if has_line "skip #101 tip-freeze" "$LAST_STDOUT" && ! kept_has 101; then
  ok tip-freeze
else
  bad tip-freeze "stdout=$(tr '\n' '|' < "$LAST_STDOUT") kept=$(printf '%s' "$LAST_KEPT" | tr '\n' ',')"
fi

if has_line "skip #102 do-not-merge" "$LAST_STDOUT" && ! kept_has 102; then
  ok do-not-merge
else
  bad do-not-merge "stdout=$(tr '\n' '|' < "$LAST_STDOUT") kept=$(printf '%s' "$LAST_KEPT" | tr '\n' ',')"
fi

if has_line "skip #103 non-draft" "$LAST_STDOUT" && ! kept_has 103; then
  ok non-draft
else
  bad non-draft "stdout=$(tr '\n' '|' < "$LAST_STDOUT") kept=$(printf '%s' "$LAST_KEPT" | tr '\n' ',')"
fi

if kept_has 104 && ! has_line "skip #104 non-draft" "$LAST_STDOUT" && ! has_line "skip #104 tip-freeze" "$LAST_STDOUT" && ! has_line "skip #104 do-not-merge" "$LAST_STDOUT"; then
  ok "draft unlabeled"
else
  bad "draft unlabeled" "stdout=$(tr '\n' '|' < "$LAST_STDOUT") kept=$(printf '%s' "$LAST_KEPT" | tr '\n' ',')"
fi

# GUARD: passes on revert too (pre-existing tip-freeze skip).
if has_line "skip #105 tip-freeze" "$LAST_STDOUT" && ! kept_has 105; then
  ok "draft+tip-freeze"
else
  bad "draft+tip-freeze" "stdout=$(tr '\n' '|' < "$LAST_STDOUT") kept=$(printf '%s' "$LAST_KEPT" | tr '\n' ',')"
fi

if kept_has 106; then
  bad clean-not-candidate "CLEAN PR 106 was rebased"
else
  ok clean-not-candidate
fi

if grep -F -q 'call pr list' "$LAST_CALLS" && grep -F -q 'call pr view' "$LAST_CALLS" && has_line "skip #103 non-draft" "$LAST_STDOUT"; then
  ok trigger-schedule
else
  bad trigger-schedule "calls=$(tr '\n' '|' < "$LAST_CALLS") stdout=$(tr '\n' '|' < "$LAST_STDOUT")"
fi

run_gate workflow_dispatch "" dispatch
if grep -F -q 'call pr list' "$LAST_CALLS" && grep -F -q 'call pr view' "$LAST_CALLS" && has_line "skip #102 do-not-merge" "$LAST_STDOUT"; then
  ok trigger-workflow_dispatch
else
  bad trigger-workflow_dispatch "calls=$(tr '\n' '|' < "$LAST_CALLS") stdout=$(tr '\n' '|' < "$LAST_STDOUT")"
fi

run_gate pull_request 103 pr-nondraft
if grep -F -q 'call pr view' "$LAST_CALLS" && ! grep -F -q 'call pr list' "$LAST_CALLS" && has_line "skip #103 non-draft" "$LAST_STDOUT" && ! kept_has 103; then
  ok trigger-pull_request
else
  bad trigger-pull_request "calls=$(tr '\n' '|' < "$LAST_CALLS") stdout=$(tr '\n' '|' < "$LAST_STDOUT") kept=$(printf '%s' "$LAST_KEPT" | tr '\n' ',')"
fi

run_gate pull_request nope pr-nan
if has_line "skip non-numeric token: nope" "$LAST_STDOUT" && ! grep -F -q 'call pr view' "$LAST_CALLS" && [ -z "$LAST_KEPT" ]; then
  ok non-numeric
else
  bad non-numeric "stdout=$(tr '\n' '|' < "$LAST_STDOUT") calls=$(tr '\n' '|' < "$LAST_CALLS") kept=$(printf '%s' "$LAST_KEPT" | tr '\n' ',')"
fi

if [ "$fail" -ne 0 ]; then
  echo "pr-hygiene-rebase tests failed" >&2
  exit 1
fi
echo "all pr-hygiene-rebase tests passed"
