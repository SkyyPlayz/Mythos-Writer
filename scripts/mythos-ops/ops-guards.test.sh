#!/usr/bin/env bash
# Behavior tests for ops-guards.sh. No network.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/ops-guards.sh"

fail=0
assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" != "$actual" ]; then
    echo "FAIL ${name}: expected $(printf '%q' "$expected") actual $(printf '%q' "$actual")" >&2
    fail=1
  else
    echo "ok ${name}"
  fi
}

assert_eq token-missing fail "$(verdict_token_audit missing 0 "" 9999 192)"
assert_eq token-bootstrap warn "$(verdict_token_audit present 0 "" 9999 192)"
assert_eq token-unknown-noruns warn "$(verdict_token_audit unknown 0 "" 9999 192)"
assert_eq token-failure fail "$(verdict_token_audit present 1 failure 1 192)"
assert_eq token-timeout fail "$(verdict_token_audit present 1 timed_out 1 192)"
assert_eq token-cancelled fail "$(verdict_token_audit present 1 cancelled 1 192)"
assert_eq token-silent fail "$(verdict_token_audit present 1 success 200 192)"
assert_eq token-ok ok "$(verdict_token_audit present 1 success 10 192)"
assert_eq token-age-boundary-ok ok "$(verdict_token_audit present 1 success 192 192)"
assert_eq token-age-boundary-fail fail "$(verdict_token_audit present 1 success 193 192)"
assert_eq token-bad-age fail "$(verdict_token_audit present 1 success nope 192)"
assert_eq token-unknown-failure fail "$(verdict_token_audit unknown 1 failure 1 192)"

assert_eq hy-missing fail "$(verdict_hygiene missing 1 failure 1 0 9999 26)"
assert_eq hy-noruns warn "$(verdict_hygiene present 0 "" 9999 0 9999 26)"
assert_eq hy-latest-fail-success-in-window ok "$(verdict_hygiene present 1 failure 1 1 2 26)"
assert_eq hy-timeout-success-in-window ok "$(verdict_hygiene present 1 timed_out 1 1 5 26)"
assert_eq hy-success-stale fail "$(verdict_hygiene present 1 failure 1 1 30 26)"
assert_eq hy-no-success-recent warn "$(verdict_hygiene present 1 failure 1 0 9999 26)"
assert_eq hy-no-success-boundary warn "$(verdict_hygiene present 1 failure 26 0 9999 26)"
assert_eq hy-no-success-old fail "$(verdict_hygiene present 1 failure 27 0 9999 26)"
assert_eq hy-success-ok ok "$(verdict_hygiene present 1 success 2 1 2 26)"
assert_eq hy-success-exact-26 ok "$(verdict_hygiene present 1 success 26 1 26 26)"
assert_eq hy-success-27 fail "$(verdict_hygiene present 1 success 27 1 27 26)"
assert_eq hy-unknown-success-in-window ok "$(verdict_hygiene unknown 1 failure 1 1 2 26)"

now=$(date -u -d '2026-09-25T12:00:00Z' +%s)
assert_eq age-2h 2 "$(age_hours '2026-09-25T10:00:00Z' "$now")"
assert_eq age-bad 9999 "$(age_hours 'not-a-date' "$now")"
assert_eq age-empty 9999 "$(age_hours '' "$now")"
assert_eq age-future 0 "$(age_hours '2026-09-25T13:00:00Z' "$now")"

# Exact 404 body shape: gh writes CRLF JSON to stdout and exits 1.
# Word-splitting that body yields $'{\r' which `gh pr view` rejects.
json_404=$'{\r\n  "message": "Not Found",\r\n  "status": "404"\r\n}\r\n'
first=""
for n in $json_404; do
  first="$n"
  break
done
assert_eq first-token-is-cr-brace $'{\r' "$first"

leaked=0
for n in $json_404; do
  case "$n" in
    ''|*[!0-9]*) continue ;;
  esac
  leaked=1
done
assert_eq guard-blocks-404-tokens 0 "$leaked"

nums=$(printf '%s' "$json_404" | pr_numbers_from_json || true)
assert_eq error-object-no-numbers "" "$(printf '%s' "$nums" | tr -d '[:space:]')"

arr='[{"number":1619},{"number":42},{"number":"nope"},{"number":null}]'
nums=$(printf '%s' "$arr" | pr_numbers_from_json)
assert_eq pr-numbers $'1619\n42' "$nums"

export GITHUB_REPOSITORY="SkyyPlayz/Mythos-Writer"

gh() {
  printf '%s' "$json_404"
  return 1
}
out=$(resolve_run_prs 36184282872 2>/tmp/ops-guards-404.txt || true)
assert_eq resolve-404-stdout "" "$(printf '%s' "$out" | tr -d '[:space:]')"
if ! grep -q "soft skip" /tmp/ops-guards-404.txt; then
  echo "FAIL resolve-404-stderr" >&2
  fail=1
else
  echo "ok resolve-404-stderr"
fi

gh() {
  printf '%s' '[]'
  return 0
}
out=$(resolve_run_prs 1 2>/tmp/ops-guards-empty.txt || true)
assert_eq resolve-empty-stdout "" "$(printf '%s' "$out" | tr -d '[:space:]')"
if ! grep -q "empty PR list" /tmp/ops-guards-empty.txt; then
  echo "FAIL resolve-empty-stderr" >&2
  fail=1
else
  echo "ok resolve-empty-stderr"
fi

gh() {
  printf '%s' '{"message":"Not Found"}'
  return 0
}
out=$(resolve_run_prs 1 2>/tmp/ops-guards-obj.txt || true)
assert_eq resolve-object-exit0 "" "$(printf '%s' "$out" | tr -d '[:space:]')"

gh() {
  printf '%s' '[{"number":7},{"number":8}]'
  return 0
}
out=$(resolve_run_prs 1 2>/dev/null || true)
assert_eq resolve-ok $'7\n8' "$out"

out=$(resolve_run_prs "" 2>/tmp/ops-guards-noid.txt || true)
assert_eq resolve-noid "" "$(printf '%s' "$out" | tr -d '[:space:]')"
if ! grep -q "no workflow_run id" /tmp/ops-guards-noid.txt; then
  echo "FAIL resolve-noid-stderr" >&2
  fail=1
else
  echo "ok resolve-noid-stderr"
fi

gh() {
  printf '%s\n' 'HTTP/2.0 404 Not Found'
  printf '%s\n' '{"message":"Not Found"}'
  return 1
}
assert_eq file-404 missing "$(workflow_file_state mythos-token-audit.yml)"

gh() {
  printf '%s\n' 'HTTP/2.0 200 OK'
  printf '%s\n' '{"name":"mythos-token-audit.yml"}'
  return 0
}
assert_eq file-200 present "$(workflow_file_state mythos-token-audit.yml)"

gh() {
  echo "gh: rate limit" >&2
  return 1
}
assert_eq file-blip unknown "$(workflow_file_state mythos-token-audit.yml)"

# 2026-09-29 canary 36584459444: newest completed was skipped, a success
# existed the same hour, and `--status success --limit 1` returned the
# 31h-old run. Selection must use primary-list order.
incident='[
  {"conclusion":"skipped","status":"completed","createdAt":"2026-09-29T14:40:31Z","updatedAt":"2026-09-29T14:40:42Z","url":"https://github.com/SkyyPlayz/Mythos-Writer/actions/runs/36584431883"},
  {"conclusion":"success","status":"completed","createdAt":"2026-09-29T14:30:39Z","updatedAt":"2026-09-29T14:30:54Z","url":"https://github.com/SkyyPlayz/Mythos-Writer/actions/runs/36583205363"},
  {"conclusion":"success","status":"completed","createdAt":"2026-09-28T06:58:29Z","updatedAt":"2026-09-28T06:58:42Z","url":"https://github.com/SkyyPlayz/Mythos-Writer/actions/runs/36389147752"}
]'
pick=$(printf '%s' "$incident" | pick_hygiene_runs)
assert_eq incident-latest-skipped skipped "$(printf '%s' "$pick" | jq -r '.latest.conclusion')"
assert_eq incident-newest-success 36583205363 "$(printf '%s' "$pick" | jq -r '.success.url | split("/") | last')"
canary_now=$(date -u -d '2026-09-29T14:40:45Z' +%s)
incident_age=$(age_hours '2026-09-29T14:30:54Z' "$canary_now")
assert_eq incident-verdict-ok ok "$(verdict_hygiene present 1 skipped 0 1 "$incident_age" 26)"
stale_age=$(age_hours '2026-09-28T06:58:42Z' "$canary_now")
assert_eq incident-stale-would-fail fail "$(verdict_hygiene present 1 skipped 0 1 "$stale_age" 26)"

# Keeping an old success is what makes real silence a fail. Dropping it
# would look like bootstrap and WARN.
assert_eq silence-kept-old-success fail "$(verdict_hygiene present 1 failure 1 1 "$stale_age" 26)"

inflight='[
  {"conclusion":"","status":"in_progress","createdAt":"2026-09-29T14:45:20Z","updatedAt":"2026-09-29T14:45:20Z","url":"https://example.test/new"},
  {"conclusion":"skipped","status":"completed","createdAt":"2026-09-29T14:40:31Z","updatedAt":"2026-09-29T14:40:42Z","url":"https://example.test/skip"},
  {"conclusion":"success","status":"completed","createdAt":"2026-09-29T14:30:39Z","updatedAt":"2026-09-29T14:30:54Z","url":"https://example.test/ok"}
]'
pick=$(printf '%s' "$inflight" | pick_hygiene_runs)
assert_eq inflight-latest-completed skipped "$(printf '%s' "$pick" | jq -r '.latest.conclusion')"
assert_eq inflight-success ok "$(printf '%s' "$pick" | jq -r '.success.url | split("/") | last')"

empty_pick=$(printf '%s' '[]' | pick_hygiene_runs)
assert_eq empty-latest null "$(printf '%s' "$empty_pick" | jq -r '.latest')"
assert_eq empty-success null "$(printf '%s' "$empty_pick" | jq -r '.success')"

if printf '%s' '{"workflow_runs":[]}' | pick_hygiene_runs >/dev/null 2>/tmp/ops-guards-pick-bad.txt; then
  echo "FAIL pick-rejects-object" >&2
  fail=1
else
  echo "ok pick-rejects-object"
fi

health_yml="${ROOT}/../../.github/workflows/mythos-ops-health.yml"
# Comments may name the broken flag. A non-comment use is the regression.
if grep -nE -- '--status([ =]|$)|\?status=success|status=success' "$health_yml" | grep -vE '^[0-9]+:[[:space:]]*#' | grep -q .; then
  echo "FAIL health-yml-no-status-success-filter" >&2
  grep -nE -- '--status([ =]|$)|\?status=success|status=success' "$health_yml" | grep -vE '^[0-9]+:[[:space:]]*#' >&2 || true
  fail=1
else
  echo "ok health-yml-no-status-success-filter"
fi
if ! grep -F 'list_workflow_runs_until_success' "$health_yml" >/dev/null; then
  echo "FAIL health-yml-uses-primary-list" >&2
  fail=1
else
  echo "ok health-yml-uses-primary-list"
fi

: > /tmp/ops-guards-pages.txt
gh() {
  printf '%s\n' "$*" >> /tmp/ops-guards-pages.txt
  case "$*" in
    *'status='*|*'--status'*)
      echo "status filter must not be used: $*" >&2
      return 1
      ;;
    *'&page=1&'*)
      printf '%s' '{"workflow_runs":[
        {"conclusion":"skipped","status":"completed","created_at":"2026-09-29T14:40:31Z","updated_at":"2026-09-29T14:40:42Z","html_url":"https://github.com/SkyyPlayz/Mythos-Writer/actions/runs/36584431883"},
        {"conclusion":"success","status":"completed","created_at":"2026-09-29T14:30:39Z","updated_at":"2026-09-29T14:30:54Z","html_url":"https://github.com/SkyyPlayz/Mythos-Writer/actions/runs/36583205363"},
        {"conclusion":"success","status":"completed","created_at":"2026-09-28T06:58:29Z","updated_at":"2026-09-28T06:58:42Z","html_url":"https://github.com/SkyyPlayz/Mythos-Writer/actions/runs/36389147752"}
      ]}'
      ;;
    *)
      echo "unexpected page: $*" >&2
      return 1
      ;;
  esac
}
out=$(list_workflow_runs_until_success SkyyPlayz/Mythos-Writer mythos-pr-hygiene.yml)
assert_eq primary-list-one-page 1 "$(wc -l < /tmp/ops-guards-pages.txt | tr -d ' ')"
pick=$(printf '%s' "$out" | pick_hygiene_runs)
assert_eq primary-list-picks-fresh-success 36583205363 "$(printf '%s' "$pick" | jq -r '.success.url | split("/") | last')"
if grep -q 'status=' /tmp/ops-guards-pages.txt; then
  echo "FAIL primary-list-query-has-status" >&2
  fail=1
else
  echo "ok primary-list-query-has-no-status"
fi

: > /tmp/ops-guards-pages.txt
gh() {
  printf '%s\n' "$*" >> /tmp/ops-guards-pages.txt
  case "$*" in
    *'&page=1&'*)
      jq -nc '{workflow_runs: [range(100) | {conclusion:"skipped", status:"completed", created_at:"2026-09-29T14:00:00Z", updated_at:"2026-09-29T14:00:00Z", html_url:"https://github.com/SkyyPlayz/Mythos-Writer/actions/runs/1"}]}'
      ;;
    *'&page=2&'*)
      printf '%s' '{"workflow_runs":[{"conclusion":"success","status":"completed","created_at":"2026-09-28T06:58:29Z","updated_at":"2026-09-28T06:58:42Z","html_url":"https://github.com/SkyyPlayz/Mythos-Writer/actions/runs/36389147752"}]}'
      ;;
    *)
      echo "unexpected page: $*" >&2
      return 1
      ;;
  esac
}
out=$(list_workflow_runs_until_success SkyyPlayz/Mythos-Writer mythos-pr-hygiene.yml)
assert_eq scan-past-skips-pages 2 "$(wc -l < /tmp/ops-guards-pages.txt | tr -d ' ')"
pick=$(printf '%s' "$out" | pick_hygiene_runs)
assert_eq scan-past-skips-finds-old-success 36389147752 "$(printf '%s' "$pick" | jq -r '.success.url | split("/") | last')"
assert_eq scan-past-skips-latest-skipped skipped "$(printf '%s' "$pick" | jq -r '.latest.conclusion')"

: > /tmp/ops-guards-pages.txt
gh() {
  printf '%s\n' "$*" >> /tmp/ops-guards-pages.txt
  jq -nc '{workflow_runs: [range(100) | {conclusion:"failure", status:"completed", created_at:"2026-09-29T14:00:00Z", updated_at:"2026-09-29T14:00:00Z", html_url:"https://github.com/SkyyPlayz/Mythos-Writer/actions/runs/9"}]}'
}
set +e
trunc=$(list_workflow_runs_until_success SkyyPlayz/Mythos-Writer mythos-pr-hygiene.yml 1 2>/dev/null)
trunc_rc=$?
set -e
assert_eq truncated-scan-rc 2 "$trunc_rc"
assert_eq truncated-scan-stdout "" "$(printf '%s' "$trunc" | tr -d '[:space:]')"
assert_eq truncated-scan-one-page 1 "$(wc -l < /tmp/ops-guards-pages.txt | tr -d ' ')"

gh() {
  printf '%s' '{"message":"Not Found"}'
  return 0
}
set +e
bad=$(list_workflow_runs_until_success SkyyPlayz/Mythos-Writer mythos-pr-hygiene.yml 1 2>/dev/null)
bad_rc=$?
set -e
assert_eq bad-payload-rc 1 "$bad_rc"

gh() {
  return 1
}
set +e
api=$(list_workflow_runs_until_success SkyyPlayz/Mythos-Writer mythos-pr-hygiene.yml 2>/dev/null)
api_rc=$?
set -e
assert_eq api-fail-rc 1 "$api_rc"

set +e
list_workflow_runs_until_success "" mythos-pr-hygiene.yml >/dev/null
args_rc=$?
set -e
assert_eq missing-repo-rc 1 "$args_rc"

gh() {
  printf '%s' '{"workflow_runs":[{"conclusion":"failure","status":"completed","created_at":"2026-09-29T14:00:00Z","updated_at":"2026-09-29T14:00:00Z","html_url":"https://example.test/only"}]}'
}
out=$(list_workflow_runs_until_success SkyyPlayz/Mythos-Writer mythos-pr-hygiene.yml)
pick=$(printf '%s' "$out" | pick_hygiene_runs)
assert_eq bootstrap-no-success null "$(printf '%s' "$pick" | jq -r '.success')"
assert_eq bootstrap-latest-failure failure "$(printf '%s' "$pick" | jq -r '.latest.conclusion')"

if [ "$fail" -ne 0 ]; then
  echo "ops-guards tests failed" >&2
  exit 1
fi
echo "all ops-guards tests passed"
