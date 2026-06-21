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
#
# Close-ping mode (ACTION=closed):
#   Only the shared vars above are needed — CI result vars are absent.

set -euo pipefail

ACTION=${ACTION:-}

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

  # Close GHM ping issues
  paperclipai issue list \
    -C "$PAPERCLIP_COMPANY_ID" \
    --status todo,in_progress,in_review,blocked \
    --assignee-agent-id "$PAPERCLIP_ASSIGNEE" \
    --match "$MATCH_PREFIX" \
    --json >"$LIST_FILE" 2>/dev/null || echo '[]' >"$LIST_FILE"

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
    paperclipai issue list \
      -C "$PAPERCLIP_COMPANY_ID" \
      --status todo,in_progress,in_review,blocked \
      --assignee-agent-id "$FE_AGENT_ID" \
      --match "$FIX_MATCH_PREFIX" \
      --json >"$FIX_LIST_FILE" 2>/dev/null || echo '[]' >"$FIX_LIST_FILE"

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

if [[ "$LINT_RESULT" == "success" && "$TYPECHECK_RESULT" == "success" && "$UNIT_RESULT" == "success" && "$CI_RESULT" == "success" && "$BUILD_LINUX_RESULT" == "success" && "$BUILD_MACOS_RESULT" == "success" ]]; then
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

Action: evaluate merge gate. **GREEN ≠ merge.** If all required checks are green + reviewed + clean: PR is merge-READY — do NOT merge. Post it as ready-for-sign-off and open a `request_confirmation` routed to Ivy; wait for recorded owner sign-off before any merge (chain: agent → CEO → Ivy → Skyy, SKY-3009). Only merge after sign-off is recorded. On red/conflict/high-risk: escalate via Ivy. No auto-merge on green under any path.
EOF

# Dedup: look for an already-open ping issue for this PR. The CLI's --match
# filters client-side across identifier/title/description, so we add a strict
# title-prefix check in python before reusing the id.
MATCH_PREFIX="PR #${PR_NUMBER} CI"
export MATCH_PREFIX LIST_FILE

paperclipai issue list \
  -C "$PAPERCLIP_COMPANY_ID" \
  --status todo,in_progress,in_review,blocked \
  --assignee-agent-id "$PAPERCLIP_ASSIGNEE" \
  --match "$MATCH_PREFIX" \
  --json >"$LIST_FILE" 2>/dev/null || echo '[]' >"$LIST_FILE"

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
  paperclipai issue comment "$EXISTING_ID" --body "$(cat "$DESC_FILE")"
else
  echo "No open ping issue for PR #${PR_NUMBER} — creating new"
  paperclipai issue create \
    -C "$PAPERCLIP_COMPANY_ID" \
    --project-id "$PAPERCLIP_PROJECT_ID" \
    --assignee-agent-id "$PAPERCLIP_ASSIGNEE" \
    --priority high \
    --title "$TITLE" \
    --description "$(cat "$DESC_FILE")"
fi

# ── Auto-fix trigger (SKY-3006) ───────────────────────────────────────────────
# On failure: create a fix-request issue for FoundingEngineer so CI red is
# addressed automatically. On success: close any open fix-request for this
# branch (green CI means the fix landed).
PAPERCLIP_FE_AGENT_ID="${PAPERCLIP_FE_AGENT_ID:-}"
if [[ -z "$PAPERCLIP_FE_AGENT_ID" ]]; then
  echo "PAPERCLIP_FE_AGENT_ID not set — skipping auto-fix trigger"
  exit 0
fi

FIX_TITLE_PREFIX="[auto-fix] PR #${PR_NUMBER}"
FIX_LIST_FILE=$(mktemp)
trap 'rm -f "$DESC_FILE" "$LIST_FILE" "$FIX_LIST_FILE"' EXIT

paperclipai issue list \
  -C "$PAPERCLIP_COMPANY_ID" \
  --status todo,in_progress,in_review,blocked \
  --assignee-agent-id "$PAPERCLIP_FE_AGENT_ID" \
  --match "$FIX_TITLE_PREFIX" \
  --json >"$FIX_LIST_FILE" 2>/dev/null || echo '[]' >"$FIX_LIST_FILE"

export FIX_TITLE_PREFIX FIX_LIST_FILE
EXISTING_FIX=$(python3 <<'PY' || true
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
for it in issues:
    title = (it.get("title") or "")
    if title.startswith(prefix):
        print(it.get("id") or "")
        break
PY
)
EXISTING_FIX=${EXISTING_FIX:-}

if [[ "$CONCLUSION" == "success" ]]; then
  if [[ -n "$EXISTING_FIX" ]]; then
    echo "CI green — closing fix-request ${EXISTING_FIX} for PR #${PR_NUMBER}"
    paperclipai issue update "$EXISTING_FIX" \
      --status done \
      --comment "Branch \`${BRANCH:-?}\` is now green (run: ${RUN_URL}). Auto-fix complete."
  else
    echo "CI green — no open fix-request for PR #${PR_NUMBER} (nothing to close)"
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

if [[ -n "$EXISTING_FIX" ]]; then
  # A fix-request is already open — add a retry comment instead of a duplicate issue.
  # The FE agent reads this comment to increment its retry_count.
  echo "Found open fix-request ${EXISTING_FIX} — commenting retry trigger"
  paperclipai issue comment "$EXISTING_FIX" --body "New CI failure on \`${BRANCH:-?}\` after previous fix attempt.

- **Stage:** ${FAILED_STAGE_DESC}
- **Run:** ${RUN_URL}
- **Run ID:** \`${GITHUB_RUN_ID}\`

Read ALL failures via \`gh run view ${GITHUB_RUN_ID} --log-failed\` before applying the next fix. Increment retry_count. If retry_count > 3 or failures are identical to prior attempt, escalate."
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
