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

if [ "$fail" -ne 0 ]; then
  echo "ops-guards tests failed" >&2
  exit 1
fi
echo "all ops-guards tests passed"
