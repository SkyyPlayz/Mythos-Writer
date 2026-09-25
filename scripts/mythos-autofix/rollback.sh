#!/usr/bin/env bash
# One-command Mythos autofix rollbacks. Creed: cut waste, don't weaken quality.
# Usage: scripts/mythos-autofix/rollback.sh <action> [pr_number]
# Actions: breaker | tip-window | mode-disable | draft-undo
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-SkyyPlayz/Mythos-Writer}"
ACTION="${1:-}"
PR="${2:-}"

usage() {
  cat <<EOF
Usage: $0 <breaker|tip-window|mode-disable|draft-undo> [pr_number]

  breaker       Clear MYTHOS_WAKE_CIRCUIT_BREAKER
  tip-window    Set MYTHOS_TIP_FIX_WINDOW_MINUTES=20
  mode-disable  Set MYTHOS_AUTOFIX_MODE=disabled
  draft-undo    gh pr ready <n> --undo  (requires pr_number)
EOF
  exit 1
}

[[ -z "$ACTION" ]] && usage

case "$ACTION" in
  breaker)
    gh variable delete MYTHOS_WAKE_CIRCUIT_BREAKER -R "$REPO" 2>/dev/null \
      || gh variable set MYTHOS_WAKE_CIRCUIT_BREAKER -R "$REPO" -b ""
    echo "OK: circuit breaker cleared"
    ;;
  tip-window)
    gh variable set MYTHOS_TIP_FIX_WINDOW_MINUTES -R "$REPO" -b 20
    echo "OK: tip-fix window → 20"
    ;;
  mode-disable)
    gh variable set MYTHOS_AUTOFIX_MODE -R "$REPO" -b disabled
    echo "OK: autofix mode → disabled"
    ;;
  draft-undo)
    [[ -z "$PR" ]] && { echo "need pr_number"; usage; }
    if gh pr ready "$PR" --undo -R "$REPO" 2>/dev/null; then
      echo "OK: PR #$PR converted back to draft"
    else
      NODE_ID=$(gh api "repos/$REPO/pulls/$PR" --jq .node_id)
      gh api graphql -f query='mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){pullRequest{number}}}' -F id="$NODE_ID"
      echo "OK: PR #$PR converted to draft via GraphQL"
    fi
    ;;
  *)
    usage
    ;;
esac
