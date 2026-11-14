#!/usr/bin/env bash
# Shared guards for mythos-pr-hygiene.
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
