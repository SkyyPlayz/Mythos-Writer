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
#   PR_TITLE, PR_URL, REPO, BRANCH, RUN_URL,
#   LINT_RESULT, TYPECHECK_RESULT, UNIT_RESULT,
#   CI_RESULT, BUILD_LINUX_RESULT, BUILD_MACOS_RESULT
#
# Close-ping mode (ACTION=closed):
#   Only the shared vars above are needed — CI result vars are absent.

set -euo pipefail

ACTION=${ACTION:-}

# ── Close-ping path ────────────────────────────────────────────────────────────
# When a PR merges or closes, auto-resolve any open board ping for it so the
# GHM sweep does not re-evaluate already-resolved state (SKY-3005).
if [[ "$ACTION" == "closed" ]]; then
  : "${PR_NUMBER:?missing PR_NUMBER}"
  : "${PAPERCLIP_COMPANY_ID:?missing PAPERCLIP_COMPANY_ID}"
  : "${PAPERCLIP_ASSIGNEE:?missing PAPERCLIP_ASSIGNEE}"

  if ! command -v paperclipai >/dev/null 2>&1; then
    echo "::error::paperclipai CLI not on runner PATH — cannot close ping" >&2
    exit 1
  fi

  echo "PR #${PR_NUMBER} closed — scanning for open ping issues to resolve."

  MATCH_PREFIX="PR #${PR_NUMBER} CI"
  LIST_FILE=$(mktemp)
  trap 'rm -f "$LIST_FILE"' EXIT

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
    exit 0
  fi

  while IFS= read -r ISSUE_ID; do
    [[ -z "$ISSUE_ID" ]] && continue
    echo "Closing ping ${ISSUE_ID} for PR #${PR_NUMBER}"
    paperclipai issue update "$ISSUE_ID" \
      --status done \
      --comment "PR #${PR_NUMBER} merged/closed — auto-resolved."
  done <<< "$ISSUE_IDS"

  echo "All open pings resolved for PR #${PR_NUMBER}."
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

echo "PR #${PR_NUMBER} conclusion=${CONCLUSION} (lint=${LINT_RESULT}, typecheck=${TYPECHECK_RESULT}, unit=${UNIT_RESULT}, ci=${CI_RESULT}, build-linux=${BUILD_LINUX_RESULT}, build-macos=${BUILD_MACOS_RESULT})"

TITLE="PR #${PR_NUMBER} CI ${CONCLUSION} — evaluate merge gate"
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
- \`ci\` (fuzz + build + E2E): ${CI_RESULT}
- \`build-linux\`: ${BUILD_LINUX_RESULT}
- \`build-macos\`: ${BUILD_MACOS_RESULT}

Action: evaluate merge gate (squash if all required green + reviewed + clean; escalate via Ivy on red/conflict/high-risk).
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
