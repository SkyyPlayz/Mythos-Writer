#!/usr/bin/env bash
# Prototype freshness gate (SKY-8962).
#
# Root cause it fixes: PR #1156's own commit message admits "the repo copy
# predates these Timeline right-panel changes, so M25 was built without them."
# The owner supplies a new prototype export as a file drop; nothing checked
# whether a branch's copy of that file was the one the owner most recently
# supplied. This script makes that check mechanical instead of tribal memory.
#
# What it checks: your branch's copy of the v2 Liquid Neon prototype export
# byte-for-byte against origin/main's copy. A mismatch means one of two things
# and the message tells you which:
#   - your branch predates a design refresh already on main -> rebase.
#   - your branch carries an unmerged design refresh the owner just supplied
#     -> that's expected on the design-refresh PR itself; everyone else must
#     rebase once it merges.
#
# Usage:
#   npm run check:prototype-freshness
#   scripts/check-prototype-freshness.sh --ref origin/main   (default)
set -euo pipefail

PROTOTYPE_PATH='plans/design-handoff/v2/prototype/Mythos Writer - Liquid Neon.dc.html'
REF='origin/main'

for arg in "$@"; do
  case "$arg" in
    --ref) shift ;;
    *) REF="$arg" ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

if [ ! -f "$PROTOTYPE_PATH" ]; then
  echo -e "${RED}✗  Prototype file not found at: $PROTOTYPE_PATH${NC}" >&2
  echo "   Has plans/design-handoff/v2/prototype/ moved? Update PROTOTYPE_PATH in this script." >&2
  exit 1
fi

git fetch origin main --quiet 2>/dev/null || true

if ! git cat-file -e "$REF:$PROTOTYPE_PATH" 2>/dev/null; then
  echo -e "${YELLOW}⚠  Could not read $PROTOTYPE_PATH from $REF — skipping (offline or shallow clone?).${NC}"
  exit 0
fi

LOCAL_HASH=$(git hash-object "$PROTOTYPE_PATH")
REF_HASH=$(git rev-parse "$REF:$PROTOTYPE_PATH")

if [ "$LOCAL_HASH" = "$REF_HASH" ]; then
  echo -e "${GREEN}✓  Prototype copy matches $REF — building against the current export.${NC}"
  exit 0
fi

# Is the local copy an ancestor state (branch is behind) or does it lead
# (branch carries a design refresh not yet on main)? Check whether $REF's
# last commit touching the file is already in this branch's history.
# NOTE: capture into a variable rather than piping through head/grep — under
# `pipefail`, grep -q's early exit sends SIGPIPE upstream and git log's 141
# status trips `set -e` even though grep matched. Command substitution avoids it.
REF_COMMIT=$(git log -1 --format=%H "$REF" -- "$PROTOTYPE_PATH")

if [ -n "$REF_COMMIT" ] && ! git merge-base --is-ancestor "$REF_COMMIT" HEAD 2>/dev/null; then
  echo -e "${RED}✗  PROTOTYPE FRESHNESS: your branch's copy of the Liquid Neon prototype is${NC}" >&2
  echo -e "${RED}   BEHIND $REF (missing commit $REF_COMMIT).${NC}" >&2
  echo "   Rebase onto $REF before building/QA-ing any fidelity surface — the owner" >&2
  echo "   supplied a newer export and building against the stale copy repeats the" >&2
  echo "   SKY-8962/PR-#1156 failure (M25 built without the Timeline right-panel refresh)." >&2
  exit 1
fi

echo -e "${YELLOW}⚠  Prototype copy differs from $REF but this branch's history is ahead of it —${NC}"
echo -e "${YELLOW}   this looks like the design-refresh commit itself. Confirm before merging.${NC}"
exit 0
