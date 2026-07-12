#!/usr/bin/env bash
# notify-board.sh — Ping the Paperclip board when a Mythos-Writer PR finishes CI.
#
# Invoked from the CI `report` job on the self-hosted runner. Uses the
# `paperclipai` CLI under the runner's OS user (trusted loopback — no token
# embedded in the workflow). One-shot per workflow run; dedups multiple
# runs against the same PR by reusing an already-open ping issue.
#
# Required env vars (shared by both modes):
#   PR_NUMBER, PAPERCLIP_COMPANY_ID, PAPERCLIP_PROJECT_ID, PAPERCLIP_ASSIGNEE
#
# CI ping mode (ACTION != closed):
#   PR_TITLE, PR_URL, REPO, BRANCH, RUN_URL, GITHUB_RUN_ID,
#   LINT_RESULT, TYPECHECK_RESULT, UNIT_RESULT, BUILD_ELECTRON_RESULT,
#   CI_RESULT, BUILD_LINUX_RESULT, BUILD_MACOS_RESULT
#   Optional: PAPERCLIP_FE_AGENT_ID — enables auto-fix issue creation on failure (SKY-3006)
#   Optional: PAPERCLIP_CTO_AGENT_ID — enables repo-wide [ci-infra] root ticket on shared main failure (SKY-3907)
#
# Close-ping mode (ACTION=closed):
#   Only the shared vars above are needed — CI result vars are absent.

set -euo pipefail

ACTION=${ACTION:-}

# Retry an `issue list` lookup to survive transient API/rate-limit blips
# (SKY-6050 documented shared-PAT secondary-limit trips under fleet load).
# Writes the JSON array to $1; all remaining args pass through to
# `paperclipai issue list`. Falls back to '[]' only after 3 attempts, and
# logs a visible warning first — a silent '[]' fallback is what let the
# dedupe/auto-close checks below silently no-op and pile up duplicate
# [auto-fix] tickets forever (SKY-6531).
list_issues_retry() {
  local out_file="$1"
  shift
  local attempt
  for attempt in 1 2 3; do
    if paperclipai issue list "$@" --json >"$out_file" 2>/dev/null; then
      return 0
    fi
    sleep "$attempt"
  done
  echo "::warning::paperclipai issue list failed after 3 attempts ($*) — assuming no existing issues; dedupe/auto-close may miss this run" >&2
  echo '[]' >"$out_file"
}

# ── Close-ping path ────────────────────────────────────────────────────────────
# When a PR merges or closes, auto-resolve any open board ping or fix-request
# issue for it so the GHM sweep does not re-evaluate already-resolved state
# (SKY-3005) and stale fix-requests don't linger for abandoned PRs (SKY-3006).
if [[ "$ACTION" == "closed" ]]; then
  : "${PR_NUMBER:?missing PR_NUMBER}"
  : "${PAPERCLIP_COMPANY_ID:?missing PAPERCLIP_COMPANY_ID}"
  : "${PAPERCLIP_ASSIGNEE:?missing PAPERCLIP_ASSIGNEE}"

  if ! command -v paperclipai >/dev/null 2>&1; then
    echo "::error::paperclipai CLI not on runner PATH — cannot close ping" >&2
    exit 1
  fi

  echo "PR #${PR_NUMBER} closed — scanning for open ping and fix-request issues to resolve."

  MATCH_PREFIX="PR #${PR_NUMBER} CI"
  FIX_MATCH_PREFIX="[auto-fix] PR #${PR_NUMBER}"
  LIST_FILE=$(mktemp)
  FIX_LIST_FILE=$(mktemp)
  trap 'rm -f "$LIST_FILE" "$FIX_LIST_FILE"' EXIT

  # Close GHM ping issues. Deliberately NOT scoped by --assignee-agent-id: these
  # tickets get reassigned (triage, audits) after creation, and an
  # assignee-scoped search would silently miss a reassigned ticket and mint a
  # duplicate instead of closing the original (SKY-6528 root cause).
  list_issues_retry "$LIST_FILE" \
    -C "$PAPERCLIP_COMPANY_ID" \
    --status todo,in_progress,in_review,blocked \
    --match "$MATCH_PREFIX"

  export MATCH_PREFIX LIST_FILE
  ISSUE_IDS=$(python3 <<'PY' || true
import json, os
prefix = os.environ["MATCH_PREFIX"]
path = os.environ["LIST_FILE"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read().strip() or "[]"
    data = json.loads(raw)
except Exception:
    raise SystemExit(0)
issues = data if isinstance(data, list) else (data.get("issues") or data.get("data") or [])
ids = [it.get("id") or "" for it in issues if (it.get("title") or "").startswith(prefix)]
print("\n".join(i for i in ids if i))
PY
  )

  if [[ -z "$ISSUE_IDS" ]]; then
    echo "No open ping issues for PR #${PR_NUMBER} — nothing to close (idempotent)."
  else
    while IFS= read -r ISSUE_ID; do
      [[ -z "$ISSUE_ID" ]] && continue
      echo "Closing ping ${ISSUE_ID} for PR #${PR_NUMBER}"
      paperclipai issue update "$ISSUE_ID" \
        --status done \
        --comment "PR #${PR_NUMBER} merged/closed — auto-resolved."
    done <<< "$ISSUE_IDS"
    echo "All open pings resolved for PR #${PR_NUMBER}."
  fi

  # Close any open fix-request issues for this PR (FoundingEngineer assignee)
  FE_AGENT_ID="${PAPERCLIP_FE_AGENT_ID:-}"
  if [[ -n "$FE_AGENT_ID" ]]; then
    # Not scoped by --assignee-agent-id: fix-requests get reassigned (e.g. to
    # CTO for audit) after creation, and a FE-only search would miss them.
    list_issues_retry "$FIX_LIST_FILE" \
      -C "$PAPERCLIP_COMPANY_ID" \
      --status todo,in_progress,in_review,blocked \
      --match "$FIX_MATCH_PREFIX"

    export FIX_MATCH_PREFIX FIX_LIST_FILE
    FIX_IDS=$(python3 <<'PY' || true
import json, os
prefix = os.environ["FIX_MATCH_PREFIX"]
path = os.environ["FIX_LIST_FILE"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read().strip() or "[]"
    data = json.loads(raw)
except Exception:
    raise SystemExit(0)
issues = data if isinstance(data, list) else (data.get("issues") or data.get("data") or [])
ids = [it.get("id") or "" for it in issues if (it.get("title") or "").startswith(prefix)]
print("\n".join(i for i in ids if i))
PY
    )

    if [[ -n "$FIX_IDS" ]]; then
      while IFS= read -r FIX_ID; do
        [[ -z "$FIX_ID" ]] && continue
        echo "Closing fix-request ${FIX_ID} for PR #${PR_NUMBER} (abandoned)"
        paperclipai issue update "$FIX_ID" \
          --status done \
          --comment "PR #${PR_NUMBER} closed without merge — fix-request auto-resolved."
      done <<< "$FIX_IDS"
      echo "All open fix-requests resolved for PR #${PR_NUMBER}."
    fi
  fi

  exit 0
fi

# ── Normal CI ping path ────────────────────────────────────────────────────────
: "${PR_NUMBER:?missing PR_NUMBER}"
: "${REPO:?missing REPO}"
: "${RUN_URL:?missing RUN_URL}"
: "${LINT_RESULT:?missing LINT_RESULT}"
: "${TYPECHECK_RESULT:?missing TYPECHECK_RESULT}"
: "${UNIT_RESULT:?missing UNIT_RESULT}"
: "${CI_RESULT:?missing CI_RESULT}"
: "${BUILD_LINUX_RESULT:?missing BUILD_LINUX_RESULT}"
: "${BUILD_MACOS_RESULT:?missing BUILD_MACOS_RESULT}"
: "${PAPERCLIP_COMPANY_ID:?missing PAPERCLIP_COMPANY_ID}"
: "${PAPERCLIP_PROJECT_ID:?missing PAPERCLIP_PROJECT_ID}"
: "${PAPERCLIP_ASSIGNEE:?missing PAPERCLIP_ASSIGNEE}"

if ! command -v paperclipai >/dev/null 2>&1; then
  echo "::error::paperclipai CLI not on runner PATH — cannot ping board" >&2
  exit 1
fi

# macOS packaging is owner-deferred and skipped on pull_request events in this
# workflow; treat either success or skipped as acceptable for PR merge-gate
# reporting so the notifier does not reclassify green product CI as red.
if [[ "$LINT_RESULT" == "success" && "$TYPECHECK_RESULT" == "success" && "$UNIT_RESULT" == "success" && "$CI_RESULT" == "success" && "$BUILD_LINUX_RESULT" == "success" && ( "$BUILD_MACOS_RESULT" == "success" || "$BUILD_MACOS_RESULT" == "skipped" ) ]]; then
  CONCLUSION=success
else
  CONCLUSION=failure
fi

BUILD_ELECTRON_RESULT="${BUILD_ELECTRON_RESULT:-}"
GITHUB_RUN_ID="${GITHUB_RUN_ID:-}"

echo "PR #${PR_NUMBER} conclusion=${CONCLUSION} (lint=${LINT_RESULT}, typecheck=${TYPECHECK_RESULT}, unit=${UNIT_RESULT}, build-electron=${BUILD_ELECTRON_RESULT}, ci=${CI_RESULT}, build-linux=${BUILD_LINUX_RESULT}, build-macos=${BUILD_MACOS_RESULT})"

TITLE="PR #${PR_NUMBER} CI ${CONCLUSION} — merge gate (green = sign-off req, NOT merge)"
DESC_FILE=$(mktemp)
LIST_FILE=$(mktemp)
trap 'rm -f "$DESC_FILE" "$LIST_FILE"' EXIT

cat >"$DESC_FILE" <<EOF
**${PR_TITLE:-(no title)}**

- Repo: \`${REPO}\`
- Branch: \`${BRANCH:-?}\`
- PR: ${PR_URL:-https://github.com/${REPO}/pull/${PR_NUMBER}}
- Run: ${RUN_URL}
- Conclusion: **${CONCLUSION}**

Per-job results:
- \`lint\`: ${LINT_RESULT}
- \`typecheck\`: ${TYPECHECK_RESULT}
- \`unit\`: ${UNIT_RESULT}
- \`build-electron\`: ${BUILD_ELECTRON_RESULT:-n/a}
- \`ci\` (build + E2E): ${CI_RESULT}
- \`build-linux\`: ${BUILD_LINUX_RESULT}
- \`build-macos\`: ${BUILD_MACOS_RESULT}

Action: evaluate merge gate. **GREEN ≠ merge.** If all required checks are green + reviewed + clean: PR is merge-READY — do NOT merge. Post it as ready-for-sign-off and open a \`request_confirmation\` routed to Ivy. **Ivy signs off routine/low-risk merges of already-approved scope directly** — that recorded Ivy sign-off is sufficient to merge. Ivy escalates **owner-reserved** merges to Skyy (release cuts, scope/product-direction changes, irreversible/high-risk or security-sensitive merges, anything not already owner-approved). Merge ONLY after a sign-off is recorded (chain: agent → CEO → Ivy → Skyy, SKY-3009). On red/conflict/high-risk: escalate via Ivy. No auto-merge on green under any path.
EOF

# Dedup: look for an already-open ping issue for this PR. The CLI's --match
# filters client-side across identifier/title/description, so we add a strict
# title-prefix check in python before reusing the id.
MATCH_PREFIX="PR #${PR_NUMBER} CI"
export MATCH_PREFIX LIST_FILE

# Not scoped by --assignee-agent-id: a reassigned ping ticket must still be
# found, or this mints a duplicate instead of reusing/closing it (SKY-6528).
list_issues_retry "$LIST_FILE" \
  -C "$PAPERCLIP_COMPANY_ID" \
  --status todo,in_progress,in_review,blocked \
  --match "$MATCH_PREFIX"

EXISTING_ID=$(python3 <<'PY' || true
import json, os
prefix = os.environ["MATCH_PREFIX"]
path = os.environ["LIST_FILE"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read().strip() or "[]"
    data = json.loads(raw)
except Exception:
    raise SystemExit(0)
issues = data if isinstance(data, list) else (data.get("issues") or data.get("data") or [])
for it in issues:
    title = (it.get("title") or "")
    if title.startswith(prefix):
        print(it.get("id") or "")
        break
PY
)
EXISTING_ID=${EXISTING_ID:-}

if [[ -n "$EXISTING_ID" ]]; then
  echo "Found open ping issue ${EXISTING_ID} for PR #${PR_NUMBER} — commenting instead of stacking duplicate"
  if ! paperclipai issue comment "$EXISTING_ID" --body "$(cat "$DESC_FILE")"; then
    echo "::warning::Could not comment on existing ping issue ${EXISTING_ID}; continuing so board-notification auth does not fail green product CI." >&2
  fi
else
  echo "No open ping issue for PR #${PR_NUMBER} — creating new"
  if ! paperclipai issue create \
    -C "$PAPERCLIP_COMPANY_ID" \
    --project-id "$PAPERCLIP_PROJECT_ID" \
    --assignee-agent-id "$PAPERCLIP_ASSIGNEE" \
    --priority high \
    --title "$TITLE" \
    --description "$(cat "$DESC_FILE")"; then
    echo "::warning::Could not create Paperclip ping issue; continuing so board-notification auth does not fail product CI." >&2
  fi
fi

# ── Auto-fix trigger (SKY-3006) ───────────────────────────────────────────────
# On failure: create a fix-request issue for FoundingEngineer so CI red is
# addressed automatically (deduped per (PR, stage) — SKY-6528). On success:
# close every open fix-request AND merge-gate ticket for this PR/branch (green
# CI means the fix landed and the gate ticket's job is done).
PAPERCLIP_FE_AGENT_ID="${PAPERCLIP_FE_AGENT_ID:-}"
if [[ -z "$PAPERCLIP_FE_AGENT_ID" ]]; then
  echo "PAPERCLIP_FE_AGENT_ID not set — skipping auto-fix trigger"
  exit 0
fi

FIX_TITLE_PREFIX="[auto-fix] PR #${PR_NUMBER}"
FIX_LIST_FILE=$(mktemp)
trap 'rm -f "$DESC_FILE" "$LIST_FILE" "$FIX_LIST_FILE"' EXIT

# Not scoped by --assignee-agent-id: fix-requests get reassigned (e.g. to CTO
# for audit) after creation. An assignee-scoped search misses the reassigned
# ticket and mints a duplicate instead of reusing/closing it (SKY-6528).
list_issues_retry "$FIX_LIST_FILE" \
  -C "$PAPERCLIP_COMPANY_ID" \
  --status todo,in_progress,in_review,blocked \
  --match "$FIX_TITLE_PREFIX"

# Every currently-open [auto-fix] ticket for this PR, any stage, any assignee —
# used to close ALL of them on green. (Dedupe-on-create for a specific stage
# happens separately below, once FAILED_STAGE_DESC is known.)
export FIX_TITLE_PREFIX FIX_LIST_FILE
EXISTING_FIX_IDS=$(python3 <<'PY' || true
import json, os
prefix = os.environ["FIX_TITLE_PREFIX"]
path = os.environ["FIX_LIST_FILE"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read().strip() or "[]"
    data = json.loads(raw)
except Exception:
    raise SystemExit(0)
issues = data if isinstance(data, list) else (data.get("issues") or data.get("data") or [])
ids = [it.get("id") or "" for it in issues if (it.get("title") or "").startswith(prefix)]
print("\n".join(i for i in ids if i))
PY
)

if [[ "$CONCLUSION" == "success" ]]; then
  if [[ -n "$EXISTING_FIX_IDS" ]]; then
    while IFS= read -r FIX_ID; do
      [[ -z "$FIX_ID" ]] && continue
      echo "CI green — closing fix-request ${FIX_ID} for PR #${PR_NUMBER}"
      paperclipai issue update "$FIX_ID" \
        --status done \
        --comment "Branch \`${BRANCH:-?}\` is now green (run: ${RUN_URL}). Auto-fix complete." \
        || echo "Warning: could not close fix-request ${FIX_ID} (403 cross-agent boundary — owning agent will close via heartbeat)" >&2
    done <<< "$EXISTING_FIX_IDS"
  else
    echo "CI green — no open fix-request for PR #${PR_NUMBER} (nothing to close)"
  fi

  # Close this PR's merge-gate ping ticket too — its job (notify) is done, and
  # a red-history "merge gate" ticket left open after green is exactly the
  # churn SKY-6528 asked to stop. GHM's own separate merge-gate/sign-off
  # ticket for this PR is untouched by this script.
  if [[ -n "$EXISTING_ID" ]]; then
    echo "CI green — closing merge-gate ping ${EXISTING_ID} for PR #${PR_NUMBER}"
    paperclipai issue update "$EXISTING_ID" \
      --status done \
      --comment "PR #${PR_NUMBER} is green (run: ${RUN_URL}). Ping resolved — see GHM's live merge-gate ticket for sign-off." \
      || echo "Warning: could not close ping ${EXISTING_ID} (403 cross-agent boundary)" >&2
  fi

  # ── Close [ci-infra] root ticket if main is also green now (SKY-3907) ──────
  # When the report job sees a green PR run, check whether main's HEAD CI is
  # also green. If yes, auto-close any open auto-generated [ci-infra] repo-wide
  # root tickets (the root cause that triggered them has been resolved).
  PAPERCLIP_CTO_AGENT_ID="${PAPERCLIP_CTO_AGENT_ID:-}"
  if [[ -n "$PAPERCLIP_CTO_AGENT_ID" ]]; then
    MAIN_GREEN_TMP=$(mktemp)
    gh run list \
      --repo "$REPO" \
      --branch main \
      --workflow "CI" \
      --status completed \
      --limit 1 \
      --json conclusion \
      >"$MAIN_GREEN_TMP" 2>/dev/null || echo '[]' >"$MAIN_GREEN_TMP"

    export MAIN_GREEN_TMP
    MAIN_IS_GREEN=$(python3 <<'PY' || true
import json, os
path = os.environ["MAIN_GREEN_TMP"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, list) and data and data[0].get("conclusion") == "success":
        print("true")
    else:
        print("false")
except Exception:
    print("false")
PY
    )
    rm -f "$MAIN_GREEN_TMP"

    if [[ "$MAIN_IS_GREEN" == "true" ]]; then
      INFRA_CLOSE_TMP=$(mktemp)
      # "[ci-infra] main " (note trailing space) is the exact prefix this
      # script uses for its own auto-generated repo-wide alert tickets — see
      # INFRA_TITLE below. Do NOT loosen this to bare "[ci-infra]": that
      # prefix is also used by manually-titled CTO work tickets (e.g. this
      # very SKY-6531 ticket), and a loose match here would auto-close one of
      # those the moment main next goes green — a false-positive close of
      # unrelated work, not just a missed dedup.
      list_issues_retry "$INFRA_CLOSE_TMP" \
        -C "$PAPERCLIP_COMPANY_ID" \
        --status todo,in_progress,in_review,blocked \
        --match "[ci-infra] main "

      export INFRA_CLOSE_TMP
      INFRA_IDS_TO_CLOSE=$(python3 <<'PY' || true
import json, os
path = os.environ["INFRA_CLOSE_TMP"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read().strip() or "[]"
    data = json.loads(raw)
except Exception:
    raise SystemExit(0)
issues = data if isinstance(data, list) else (data.get("issues") or data.get("data") or [])
ids = [it.get("id") or "" for it in issues if (it.get("title") or "").startswith("[ci-infra] main ")]
print("\n".join(i for i in ids if i))
PY
      )
      rm -f "$INFRA_CLOSE_TMP"

      if [[ -n "$INFRA_IDS_TO_CLOSE" ]]; then
        while IFS= read -r INFRA_ID; do
          [[ -z "$INFRA_ID" ]] && continue
          echo "main is green — closing root infra ticket ${INFRA_ID}"
          paperclipai issue update "$INFRA_ID" \
            --status done \
            --comment "main branch CI is now green (detected via PR #${PR_NUMBER} run: ${RUN_URL}). Root cause resolved — auto-closing."
        done <<< "$INFRA_IDS_TO_CLOSE"
      fi
    fi
  fi

  exit 0
fi

# CONCLUSION=failure: determine failed stage for the fix-request description
if [[ "$LINT_RESULT" != "success" || "$TYPECHECK_RESULT" != "success" || "$UNIT_RESULT" != "success" ]]; then
  FAILED_STAGE=1
  FAILED_STAGE_DESC="Stage 1 — lint/typecheck/unit"
elif [[ "$BUILD_ELECTRON_RESULT" == "failure" || "$BUILD_ELECTRON_RESULT" == "cancelled" ]]; then
  FAILED_STAGE=2
  FAILED_STAGE_DESC="Stage 2 — build-electron"
else
  FAILED_STAGE=3
  FAILED_STAGE_DESC="Stage 3 — E2E shards"
fi

echo "PR #${PR_NUMBER} CI failure: ${FAILED_STAGE_DESC}"

# ── Repo-wide failure detection (SKY-3907 / SKY-998) ─────────────────────────
# If main's HEAD CI is also red on the same stage, this failure is repo-wide —
# every open PR inherits it. Mint ONE [ci-infra] root ticket assigned to CTO
# and skip the per-PR [auto-fix] fix-request entirely. Create a per-PR
# fix-request ONLY when main is green (failure is isolated to this PR's branch).
PAPERCLIP_CTO_AGENT_ID="${PAPERCLIP_CTO_AGENT_ID:-}"
REPO_WIDE=false

if [[ -n "$PAPERCLIP_CTO_AGENT_ID" ]]; then
  MAIN_RUN_TMP=$(mktemp)
  gh run list \
    --repo "$REPO" \
    --branch main \
    --workflow "CI" \
    --status completed \
    --limit 1 \
    --json databaseId,conclusion \
    >"$MAIN_RUN_TMP" 2>/dev/null || echo '[]' >"$MAIN_RUN_TMP"

  export MAIN_RUN_TMP
  MAIN_RUN_ID=$(python3 <<'PY' || true
import json, os
path = os.environ["MAIN_RUN_TMP"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, list) and data:
        print(str(data[0].get("databaseId", "")))
except Exception:
    pass
PY
  )
  MAIN_RUN_ID=${MAIN_RUN_ID:-}

  MAIN_CONCLUSION=$(python3 <<'PY' || true
import json, os
path = os.environ["MAIN_RUN_TMP"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, list) and data:
        print(data[0].get("conclusion", "unknown"))
    else:
        print("unknown")
except Exception:
    print("unknown")
PY
  )
  MAIN_CONCLUSION=${MAIN_CONCLUSION:-unknown}
  rm -f "$MAIN_RUN_TMP"

  if [[ -n "$MAIN_RUN_ID" && "$MAIN_CONCLUSION" == "failure" ]]; then
    MAIN_JOBS_TMP=$(mktemp)
    gh run view "$MAIN_RUN_ID" \
      --repo "$REPO" \
      --json jobs \
      >"$MAIN_JOBS_TMP" 2>/dev/null || echo '{"jobs":[]}' >"$MAIN_JOBS_TMP"

    export MAIN_JOBS_TMP FAILED_STAGE
    STAGE_RED_ON_MAIN=$(python3 <<'PY' || true
import json, os, sys
stage = os.environ.get("FAILED_STAGE", "1")
path = os.environ["MAIN_JOBS_TMP"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    jobs = data.get("jobs", []) if isinstance(data, dict) else []
except Exception:
    print("false")
    sys.exit(0)
if stage == "1":
    check = {"lint", "typecheck", "unit"}
elif stage == "2":
    check = {"build-electron"}
else:
    check = {"e2e-shard-1", "e2e-shard-2", "e2e-shard-3", "e2e-shard-4", "ci"}
for job in jobs:
    if job.get("name", "") in check and job.get("conclusion", "") == "failure":
        print("true")
        sys.exit(0)
print("false")
PY
    )
    rm -f "$MAIN_JOBS_TMP"
    [[ "$STAGE_RED_ON_MAIN" == "true" ]] && REPO_WIDE=true
  fi
fi

if [[ "$REPO_WIDE" == "true" ]]; then
  echo "Repo-wide ${FAILED_STAGE_DESC} failure detected (main also red) — minting ONE root infra ticket, skipping per-PR fix-request (SKY-998)"

  INFRA_TITLE="[ci-infra] main ${FAILED_STAGE_DESC} red — repo-wide"
  INFRA_LIST_TMP=$(mktemp)
  trap 'rm -f "$DESC_FILE" "$LIST_FILE" "$FIX_LIST_FILE" "$INFRA_LIST_TMP"' EXIT

  # Match on the generic "[ci-infra] main " prefix (not the full stage-specific
  # title): collapses repeat repo-wide failures on ANY stage into the single
  # existing root ticket instead of minting a new one per stage (SKY-6528).
  # Not scoped by --assignee-agent-id for the same reassignment-evasion reason
  # as the auto-fix search above.
  list_issues_retry "$INFRA_LIST_TMP" \
    -C "$PAPERCLIP_COMPANY_ID" \
    --status todo,in_progress,in_review,blocked \
    --match "[ci-infra] main "

  export INFRA_LIST_TMP
  EXISTING_INFRA=$(python3 <<'PY' || true
import json, os
path = os.environ["INFRA_LIST_TMP"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read().strip() or "[]"
    data = json.loads(raw)
except Exception:
    raise SystemExit(0)
issues = data if isinstance(data, list) else (data.get("issues") or data.get("data") or [])
for it in issues:
    if (it.get("title") or "").startswith("[ci-infra] main "):
        print(it.get("id") or "")
        break
PY
  )
  EXISTING_INFRA=${EXISTING_INFRA:-}
  rm -f "$INFRA_LIST_TMP"

  if [[ -n "$EXISTING_INFRA" ]]; then
    echo "Root infra ticket ${EXISTING_INFRA} already open — commenting new stage instead of stacking duplicate"
    paperclipai issue comment "$EXISTING_INFRA" \
      --body "Repo-wide failure recurred (or a new stage went red): **${FAILED_STAGE_DESC}**. Run: ${RUN_URL} (main run: ${MAIN_RUN_ID:-unknown})." \
      || echo "Warning: could not comment on root infra ticket ${EXISTING_INFRA}" >&2
  else
    echo "Creating root infra ticket: ${INFRA_TITLE}"
    INFRA_DESC_TMP=$(mktemp)
    trap 'rm -f "$DESC_FILE" "$LIST_FILE" "$FIX_LIST_FILE" "$INFRA_DESC_TMP"' EXIT
    cat >"$INFRA_DESC_TMP" <<INFRADESC
## Repo-wide CI failure — ${FAILED_STAGE_DESC}

\`main\`'s HEAD CI is also red on **${FAILED_STAGE_DESC}**. Every open PR inherits this failure.

This is the single root-cause ticket for the shared breakage on \`main\` (SKY-998 policy: one infra ticket per root cause, not one per open PR).

### Context
- **Failed stage:** ${FAILED_STAGE_DESC}
- **Detected via:** PR #${PR_NUMBER} CI report (${RUN_URL})
- **main run ID:** ${MAIN_RUN_ID:-unknown}

### Action required
Diagnose and fix the failing ${FAILED_STAGE_DESC} jobs on \`main\`. Per-PR auto-fix tickets for this stage are suppressed until \`main\` returns green (the report job auto-closes this ticket when main is green again).

\`\`\`bash
gh run view ${MAIN_RUN_ID:-<run-id>} --log-failed   # fetch main failure logs
\`\`\`

**Do NOT commit to \`main\` directly.** Open a fix PR, get it green, merge through the normal sign-off gate (SKY-3109).
INFRADESC
    paperclipai issue create \
      -C "$PAPERCLIP_COMPANY_ID" \
      --project-id "$PAPERCLIP_PROJECT_ID" \
      --assignee-agent-id "$PAPERCLIP_CTO_AGENT_ID" \
      --priority critical \
      --title "$INFRA_TITLE" \
      --description "$(cat "$INFRA_DESC_TMP")"
    rm -f "$INFRA_DESC_TMP"
  fi

  # Comment on the PR's ping issue that it is blocked on the repo-wide failure.
  # EXISTING_ID is only set when a prior ping issue existed for this PR; on first
  # run, the ping issue was just created above without a captured ID — skip then.
  if [[ -n "$EXISTING_ID" ]]; then
    paperclipai issue comment "$EXISTING_ID" \
      --body "⚠️ **Blocked on repo-wide ${FAILED_STAGE_DESC} failure on \`main\`.** Per-PR auto-fix ticket suppressed (SKY-998 / SKY-3907). Root-cause ticket: \`${INFRA_TITLE}\`."
  fi

  echo "Repo-wide failure — per-PR fix-request skipped."
  exit 0
fi

# ── Per-PR fix-request (main is green; failure is PR-branch-specific) ─────────
# Dedupe key is (PR, stage): a specific stage prefix, checked against the
# already-fetched company-wide EXISTING_FIX_IDS list (no extra API call, and
# no assignee scoping — same reassignment-evasion fix as above, SKY-6528).
FIX_STAGE_PREFIX="${FIX_TITLE_PREFIX} — CI red (${FAILED_STAGE_DESC}"
export FIX_STAGE_PREFIX FIX_LIST_FILE
EXISTING_FIX=$(python3 <<'PY' || true
import json, os
prefix = os.environ["FIX_STAGE_PREFIX"]
path = os.environ["FIX_LIST_FILE"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read().strip() or "[]"
    data = json.loads(raw)
except Exception:
    raise SystemExit(0)
issues = data if isinstance(data, list) else (data.get("issues") or data.get("data") or [])
for it in issues:
    if (it.get("title") or "").startswith(prefix):
        print(it.get("id") or "")
        break
PY
)
EXISTING_FIX=${EXISTING_FIX:-}

if [[ -n "$EXISTING_FIX" ]]; then
  # A fix-request for this exact (PR, stage) is already open — add a retry
  # comment instead of a duplicate issue. The owning agent reads this comment
  # to increment its retry_count.
  echo "Found open fix-request ${EXISTING_FIX} for this (PR, stage) — commenting retry trigger"
  paperclipai issue comment "$EXISTING_FIX" --body "New CI failure on \`${BRANCH:-?}\` after previous fix attempt.

- **Stage:** ${FAILED_STAGE_DESC}
- **Run:** ${RUN_URL}
- **Run ID:** \`${GITHUB_RUN_ID}\`

Read ALL failures via \`gh run view ${GITHUB_RUN_ID} --log-failed\` before applying the next fix. Increment retry_count. If retry_count > 3 or failures are identical to prior attempt, escalate." \
    || echo "Warning: could not comment on fix-request ${EXISTING_FIX} (403 cross-agent boundary — FE agent will pick up next CI failure via heartbeat)" >&2
else
  # No open fix-request — create one assigned to FoundingEngineer.
  FIX_TITLE="${FIX_TITLE_PREFIX} — CI red (${FAILED_STAGE_DESC})"
  FIX_DESC_FILE=$(mktemp)
  trap 'rm -f "$DESC_FILE" "$LIST_FILE" "$FIX_LIST_FILE" "$FIX_DESC_FILE"' EXIT

  cat >"$FIX_DESC_FILE" <<FIXDESC
## CI Fix Request — ${FAILED_STAGE_DESC}

**This is an auto-generated fix-request. Read ALL failures before writing any fix.**

### Context

- **Branch:** \`${BRANCH:-?}\`
- **PR:** [#${PR_NUMBER}](${PR_URL:-https://github.com/${REPO}/pull/${PR_NUMBER}})
- **GitHub Run:** ${RUN_URL}
- **Run ID:** \`${GITHUB_RUN_ID}\`
- **Failed stage:** ${FAILED_STAGE_DESC}
- **retry_count:** 1

### Per-job results

- \`lint\`: ${LINT_RESULT}
- \`typecheck\`: ${TYPECHECK_RESULT}
- \`unit\`: ${UNIT_RESULT}
- \`build-electron\`: ${BUILD_ELECTRON_RESULT:-n/a}
- \`ci\` aggregator: ${CI_RESULT}
- \`build-linux\`: ${BUILD_LINUX_RESULT}
- \`build-macos\`: ${BUILD_MACOS_RESULT}

### Fix recipe

\`\`\`
1. gh run view ${GITHUB_RUN_ID} --log-failed   # fetch ALL failure logs at once
2. Identify root causes — look for shared patterns across ALL failures in the stage
3. Apply fixes (git commit + push to feature branch)
4. Poll: gh run list --branch ${BRANCH:-?} --limit 1 (30s interval, inline while loop)
5. Green → mark this issue done; comment on PR issue that branch is green. Do NOT merge — a fixed-to-green PR stops at the sign-off gate (SKY-3109); GHM posts it ready-for-sign-off and routes a request_confirmation to Ivy. Never auto-merge from the fix loop.
6. Red   → add retry comment here; if retry_count > 3 OR same failures twice → escalate
\`\`\`

**CRITICAL:** Commits go to \`${BRANCH:-?}\` only — NEVER to \`main\`. Reaching green does NOT authorize a merge — owner sign-off via Ivy is still required (SKY-3109).

**Escalation path:** After 3 retries or identical failures × 2, create \`request_confirmation\`
on the PR issue with: full log excerpts, list of attempted fixes, recommendation.
\`continuationPolicy: wake_assignee_on_accept\`
FIXDESC

  echo "Creating fix-request for PR #${PR_NUMBER} (${FAILED_STAGE_DESC})"
  paperclipai issue create \
    -C "$PAPERCLIP_COMPANY_ID" \
    --project-id "$PAPERCLIP_PROJECT_ID" \
    --assignee-agent-id "$PAPERCLIP_FE_AGENT_ID" \
    --priority high \
    --title "$FIX_TITLE" \
    --description "$(cat "$FIX_DESC_FILE")"

  rm -f "$FIX_DESC_FILE"
fi
