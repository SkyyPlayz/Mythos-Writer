#!/usr/bin/env bash
# Shared guards for mythos-pr-hygiene and mythos-ops-health.
# Creed: cut waste, don't weaken quality.
#
# Main-push workflow_run: GET /actions/runs/{id}/pull_requests is HTTP 404.
# `gh api` still writes the error JSON to stdout (`{\r` is the first word).
# Callers must use resolve_run_prs — never `gh api ... || true` into a for-loop.

# Print decimal PR numbers from a pull_requests JSON payload (one per line).
# Non-arrays (404 error objects) and non-numeric .number values yield nothing.
pr_numbers_from_json() {
  jq -r 'if type == "array" then .[].number else empty end' | while IFS= read -r n; do
    n=${n//$'\r'/}
    case "$n" in
      ''|*[!0-9]*) continue ;;
      *) printf '%s\n' "$n" ;;
    esac
  done
}

# Resolve PR numbers for a workflow run.
# Stdout: decimal PR numbers, one per line (empty when there is nothing to do).
# Stderr: soft-skip reason. Always returns 0 — a 404 / empty list is not a job failure.
resolve_run_prs() {
  local run_id="${1:-}"
  if [ -z "$run_id" ]; then
    echo "no workflow_run id — soft skip" >&2
    return 0
  fi
  local prs_json=""
  if ! prs_json=$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/pull_requests" 2>/dev/null); then
    echo "no pull_requests for run ${run_id} (main push / 404) — soft skip" >&2
    return 0
  fi
  local prs=""
  if ! prs=$(printf '%s\n' "$prs_json" | pr_numbers_from_json); then
    echo "pull_requests payload not usable for run ${run_id} — soft skip" >&2
    return 0
  fi
  if [ -z "$(printf '%s' "$prs" | tr -d '[:space:]')" ]; then
    echo "empty PR list for run ${run_id} — soft skip" >&2
    return 0
  fi
  printf '%s\n' "$prs"
}

# Hours since an ISO timestamp. Unparseable → 9999 (fail closed). Future → 0.
age_hours() {
  local ts="${1:-}"
  local now="${2:-}"
  if [ -z "$now" ]; then
    now=$(date -u +%s)
  fi
  local s=0
  if [ -n "$ts" ]; then
    s=$(date -u -d "$ts" +%s 2>/dev/null || echo 0)
  fi
  if [ "$s" -le 0 ]; then
    printf '%s\n' 9999
    return 0
  fi
  local age=$(( (now - s) / 3600 ))
  if [ "$age" -lt 0 ]; then
    printf '%s\n' 0
    return 0
  fi
  printf '%s\n' "$age"
}

# present | missing | unknown. Unknown (rate limit, network) is not "missing".
workflow_file_state() {
  local name="$1"
  local raw=""
  raw=$(gh api -i "repos/${GITHUB_REPOSITORY}/contents/.github/workflows/${name}" 2>/dev/null || true)
  local status
  status=$(printf '%s\n' "$raw" | head -n 1 || true)
  status=${status//$'\r'/}
  case "$status" in
    *" 404"*) printf '%s\n' missing ;;
    *" 200"*) printf '%s\n' present ;;
    *) printf '%s\n' unknown ;;
  esac
}

_hours_or_closed() {
  local v="${1:-}"
  case "$v" in
    ''|*[!0-9]*) printf '%s\n' 9999 ;;
    *) printf '%s\n' "$v" ;;
  esac
}

# fail | warn | ok
# No completed runs → warn (workflow just landed; first Wed cron has not fired).
# Missing workflow file → fail. Latest failure / timeout / cancel → fail.
# Success older than max_age_h → fail (silence).
verdict_token_audit() {
  local file_state="$1"
  local has_completed="$2"
  local conclusion="$3"
  local age_h
  age_h=$(_hours_or_closed "$4")
  local max_age_h
  max_age_h=$(_hours_or_closed "$5")
  if [ "$file_state" = "missing" ]; then
    printf '%s\n' fail
    return 0
  fi
  if [ "$has_completed" != "1" ]; then
    printf '%s\n' warn
    return 0
  fi
  case "$conclusion" in
    failure|timed_out|cancelled)
      printf '%s\n' fail
      return 0
      ;;
  esac
  if [ "$age_h" -gt "$max_age_h" ]; then
    printf '%s\n' fail
    return 0
  fi
  printf '%s\n' ok
}

# fail | warn | ok
# Silence is >max_age_h since the last *success*, not "latest run failed".
# No success yet and the newest completed run is inside the grace window → warn.
# No success yet and that run is older than grace → fail.
# Latest failure with a success inside the window → ok.
verdict_hygiene() {
  local file_state="$1"
  local has_completed="$2"
  # $3 is the latest conclusion. The canary notes it; it does not flip OK→fail
  # while a success is still inside the window.
  : "${3:-}"
  local latest_age_h
  latest_age_h=$(_hours_or_closed "$4")
  local has_success="$5"
  local success_age_h
  success_age_h=$(_hours_or_closed "$6")
  local max_age_h
  max_age_h=$(_hours_or_closed "$7")
  if [ "$file_state" = "missing" ]; then
    printf '%s\n' fail
    return 0
  fi
  if [ "$has_completed" != "1" ]; then
    printf '%s\n' warn
    return 0
  fi
  if [ "$has_success" = "1" ]; then
    if [ "$success_age_h" -gt "$max_age_h" ]; then
      printf '%s\n' fail
      return 0
    fi
    printf '%s\n' ok
    return 0
  fi
  if [ "$latest_age_h" -gt "$max_age_h" ]; then
    printf '%s\n' fail
    return 0
  fi
  printf '%s\n' warn
}
