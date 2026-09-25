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

if [ "$fail" -ne 0 ]; then
  echo "ops-guards tests failed" >&2
  exit 1
fi
echo "all ops-guards tests passed"
