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

# Newest completed run + newest success from a newest-first run array.
# Stdin: JSON array of {conclusion,status,createdAt,updatedAt,url}.
# Stdout: {"latest": <object|null>, "success": <object|null>}
# "Newest" is list order (primary index, created_at desc), matching
# the unfiltered runs API. Age is still computed by the caller from
# updatedAt // createdAt.
pick_hygiene_runs() {
  jq -c '
    if type != "array" then
      error("expected run array")
    else
      {
        latest: ([.[] | select(.status == "completed")] | .[0] // null),
        success: ([.[] | select(.conclusion == "success")] | .[0] // null)
      }
    end
  '
}

# Page the primary workflow-run list until it includes the newest success,
# or history ends. Prints a JSON array (newest first).
#
# Do not query ?status=success / `gh run list --status success`. That
# parameter is a search index (capped, and it lags the primary list).
# On 2026-09-29 the ops canary's `--status success --limit 1` returned
# run 36389147752 (31h old) while the unfiltered list in the same job
# already saw a run from that minute, and newer successes existed.
# A larger --limit on the same status filter still misses runs the
# index has not ingested. Select conclusion=="success" client-side.
#
# Exit 0: array on stdout (success may be absent only when history ended).
# Exit 1: API or payload failure.
# Exit 2: hit max_pages on a full page with no success — caller must
# fail closed, not treat that as "no success ever" (that would WARN
# a real silence).
# Args: repo workflow [max_pages]
list_workflow_runs_until_success() {
  local repo="${1:-}"
  local workflow="${2:-}"
  local max_pages="${3:-20}"
  local page=1
  local combined='[]'
  local saw_success=0
  local url=""
  local payload=""
  local runs=""
  local count=0

  case "$max_pages" in
    ''|*[!0-9]*) return 1 ;;
  esac
  if [ -z "$repo" ] || [ -z "$workflow" ]; then
    return 1
  fi

  while [ "$page" -le "$max_pages" ]; do
    url="repos/${repo}/actions/workflows/${workflow}/runs?per_page=100&page=${page}&exclude_pull_requests=true"
    if ! payload=$(gh api "$url" 2>/dev/null); then
      return 1
    fi
    if ! runs=$(printf '%s' "$payload" | jq -c '
      if (.workflow_runs | type) != "array" then
        error("workflow_runs missing")
      else
        [.workflow_runs[] | {
          conclusion: (.conclusion // ""),
          status: (.status // ""),
          createdAt: (.created_at // ""),
          updatedAt: (.updated_at // .created_at // ""),
          url: (.html_url // "")
        }]
      end
    '); then
      return 1
    fi
    count=$(printf '%s' "$runs" | jq 'length')
    if ! combined=$(printf '%s\n%s\n' "$combined" "$runs" | jq -sc '.[0] + .[1]'); then
      return 1
    fi
    if printf '%s' "$runs" | jq -e 'any(.[]; .conclusion == "success")' >/dev/null; then
      saw_success=1
      break
    fi
    if [ "$count" -lt 100 ]; then
      break
    fi
    page=$((page + 1))
  done

  if [ "$saw_success" -eq 0 ] && [ "$page" -gt "$max_pages" ]; then
    return 2
  fi
  printf '%s\n' "$combined"
}

# Retry a workflow-run list that came back empty, truncated, or non-zero.
# Accept only exit 0 plus a JSON array. `[]` is a real empty history and
# is not retried. 5 attempts, backoff 1s, 2s, 4s, 8s between them, then return 1
# so the canary FAILs ("could not list") instead of treating the empty
# body as bootstrap WARN.
#
# Exit 2 is pass-through on every wrapped command, including token-audit
# `gh run list` and list_workflow_runs_until_success. One attempt, return
# 2, no retry. Callers fail closed on 2 (truncated primary scan, or a
# gh status of 2). They must not score that as WARN.
#
# Args: label command...
# Stdout: the JSON array on success. Empty on exit 1 and exit 2.
gh_list_with_retry() {
  local label="$1"
  shift
  local attempt=1
  local max_attempts=5
  local delay=1
  local out=""
  local rc=0
  local detail=""
  while [ "$attempt" -le "$max_attempts" ]; do
    out=$("$@") && rc=0 || rc=$?
    if [ "$rc" -eq 2 ]; then
      return 2
    fi
    if [ "$rc" -eq 0 ] && printf '%s' "$out" | jq -e 'type == "array"' >/dev/null 2>&1; then
      printf '%s\n' "$out"
      return 0
    fi
    if [ "$rc" -ne 0 ]; then
      detail="rc=${rc}"
    else
      detail="rc=0 but body was empty or not a JSON array"
    fi
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "${label} list failed after ${max_attempts} attempts (${detail})" >&2
      return 1
    fi
    echo "::warning::${label} list attempt ${attempt}/${max_attempts} failed (${detail}); retrying in ${delay}s" >&2
    sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
  return 1
}

# Newest completed run in a token-audit `gh run list` JSON array.
# Stdout: that run object, or empty when nothing has completed
# (canary bootstrap WARN). A newer queued or in-progress run must not
# hide a completed failure. The emptiness check is AND: a present
# completed row is printed; it is not forced down the WARN path.
token_audit_completed_row() {
  local json="${1-}"
  local row=""
  if row=$(printf '%s' "$json" | jq -c '[.[] | select(.status=="completed")] | .[0] // empty') && { [ -z "$row" ] || [ "$row" = "null" ]; }; then
    return 0
  fi
  printf '%s\n' "$row"
}
