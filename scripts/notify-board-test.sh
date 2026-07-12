#!/usr/bin/env bash
# notify-board-test.sh — unit tests for notify-board.sh repo-wide failure dedup
#
# Tests the SKY-3907 changes: when main's HEAD CI is also red on the same stage
# as the PR's CI failure, the script mints ONE [ci-infra] root ticket (assigned
# to CTO) instead of per-PR [auto-fix] fix-requests.
#
# Stubs gh + paperclipai via PATH injection. No network calls made.
#
# Tests:
#   1. Repo-wide Stage-1 failure → ONE [ci-infra] ticket created, no [auto-fix]
#   2. Dedup — existing [ci-infra] ticket → no second ticket created
#   3. PR-specific failure (main green) → per-PR [auto-fix] fix-request created
#   4. Root infra ticket auto-closes when CI success run detects main is green
#
# SKY-6531 additions:
#   5. Dedup — existing [auto-fix] ticket → no second ticket created (comment only)
#   6. Existing [auto-fix] ticket auto-closes when the PR's CI goes green
#   7. Transient `paperclipai issue list` failures are retried and do not
#      defeat dedup (list_issues_retry recovers within its 3 attempts)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTIFY="$SCRIPT_DIR/notify-board.sh"

FAIL_COUNT=0
fail() { echo "FAIL: $*" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); }
pass() { echo "PASS: $*"; }

# ── Shared fake env (all runs get these unless overridden) ────────────────────
COMPANY="test-company-id"
PROJECT="test-project-id"
GHM_AGENT="ghm-agent-id"
FE_AGENT="fe-agent-id"
CTO_AGENT="cto-agent-id"
BASE_ENV=(
  PR_NUMBER=42
  "REPO=owner/repo"
  "BRANCH=feat/sky-3907"
  "PR_TITLE=Test PR"
  "PR_URL=https://github.com/owner/repo/pull/42"
  "RUN_URL=https://github.com/owner/repo/actions/runs/99"
  GITHUB_RUN_ID=99
  LINT_RESULT=success
  TYPECHECK_RESULT=success
  UNIT_RESULT=success
  BUILD_ELECTRON_RESULT=success
  CI_RESULT=success
  BUILD_LINUX_RESULT=success
  BUILD_MACOS_RESULT=success
  "PAPERCLIP_COMPANY_ID=$COMPANY"
  "PAPERCLIP_PROJECT_ID=$PROJECT"
  "PAPERCLIP_ASSIGNEE=$GHM_AGENT"
  "PAPERCLIP_FE_AGENT_ID=$FE_AGENT"
  "PAPERCLIP_CTO_AGENT_ID=$CTO_AGENT"
)

# ── Helper: build stub binaries in a given directory ─────────────────────────
#
# Reads response fixtures from env vars set by the caller:
#   GH_RUN_LIST_JSON  — response for `gh run list --branch main ...`
#   GH_RUN_VIEW_JSON  — response for `gh run view <id> ...`
#   PC_LIST_PING_JSON — paperclipai list response for GHM ping issues
#   PC_LIST_FIX_JSON  — paperclipai list response for [auto-fix] issues (FE)
#   PC_LIST_INFRA_JSON — paperclipai list response for [ci-infra] issues (CTO)
#
# Returns (stdout) the path to the call log file.
make_stubs() {
  local bindir="$1"

  # Write JSON fixture files; kept outside the stub scripts so embedding quotes
  # never causes eval/heredoc expansion issues.
  local _dflt_run_view='{"jobs":[]}'
  printf '%s\n' "${GH_RUN_LIST_JSON:-[]}" > "$bindir/gh_run_list.json"
  printf '%s\n' "${GH_RUN_VIEW_JSON:-$_dflt_run_view}" > "$bindir/gh_run_view.json"
  printf '%s\n' "${PC_LIST_PING_JSON:-[]}" > "$bindir/pc_ping.json"
  printf '%s\n' "${PC_LIST_FIX_JSON:-[]}" > "$bindir/pc_fix.json"
  printf '%s\n' "${PC_LIST_INFRA_JSON:-[]}" > "$bindir/pc_infra.json"

  local calllog="$bindir/calls.log"
  > "$calllog"

  # Optional: simulate N transient failures of the [auto-fix] `issue list`
  # call before it starts succeeding (SKY-6531 retry coverage).
  if [[ -n "${PC_LIST_FIX_FLAKY_COUNT:-}" ]]; then
    echo "$PC_LIST_FIX_FLAKY_COUNT" > "$bindir/fix_flaky_remaining"
  fi

  # gh stub — matches subcommand by scanning $*
  cat > "$bindir/gh" <<GHEOF
#!/usr/bin/env bash
echo "gh \$*" >> "$calllog"
if echo "\$*" | grep -q "run list"; then
  cat "$bindir/gh_run_list.json"
elif echo "\$*" | grep -q "run view"; then
  cat "$bindir/gh_run_view.json"
fi
GHEOF
  chmod +x "$bindir/gh"

  # paperclipai stub — routes list responses by --match content
  cat > "$bindir/paperclipai" <<PCEOF
#!/usr/bin/env bash
ARGS="\$*"
echo "paperclipai \$ARGS" >> "$calllog"
case "\$1 \$2" in
  "issue list")
    if echo "\$ARGS" | grep -q "auto-fix" && [[ -f "$bindir/fix_flaky_remaining" ]]; then
      remaining=\$(cat "$bindir/fix_flaky_remaining")
      if [[ "\$remaining" -gt 0 ]]; then
        echo \$((remaining - 1)) > "$bindir/fix_flaky_remaining"
        echo "stub: simulated transient list failure" >&2
        exit 1
      fi
    fi
    if echo "\$ARGS" | grep -q "ci-infra"; then
      cat "$bindir/pc_infra.json"
    elif echo "\$ARGS" | grep -q "auto-fix"; then
      cat "$bindir/pc_fix.json"
    else
      cat "$bindir/pc_ping.json"
    fi
    ;;
  "issue create")
    echo "fake-created-id"
    ;;
  "issue update"|"issue comment")
    ;;
esac
exit 0
PCEOF
  chmod +x "$bindir/paperclipai"

  echo "$calllog"
}

# Helper: run notify-board.sh with stub PATH and extra env overrides
run_notify() {
  local bindir="$1"; shift
  local extra_env=("$@")
  env -i "PATH=$bindir:$PATH" "HOME=$HOME" \
    "${BASE_ENV[@]}" "${extra_env[@]}" \
    bash "$NOTIFY" 2>&1 || true
}

# ═════════════════════════════════════════════════════════════════════════════
# Test 1: Repo-wide Stage-1 failure
#   main's lint job is also red → ONE [ci-infra] ticket created; no [auto-fix]
# ═════════════════════════════════════════════════════════════════════════════
T1=$(mktemp -d)
CLEANUP_DIRS=("$T1")

export GH_RUN_LIST_JSON='[{"databaseId":5001,"conclusion":"failure"}]'
export GH_RUN_VIEW_JSON='{"jobs":[{"name":"lint","conclusion":"failure"},{"name":"typecheck","conclusion":"success"},{"name":"unit","conclusion":"success"}]}'
export PC_LIST_PING_JSON='[]'
export PC_LIST_FIX_JSON='[]'
export PC_LIST_INFRA_JSON='[]'

T1_LOG=$(make_stubs "$T1")

run_notify "$T1" \
  LINT_RESULT=failure \
  CI_RESULT=failure \
  BUILD_LINUX_RESULT=failure \
  > /dev/null

if grep "issue create" "$T1_LOG" | grep -q "ci-infra"; then
  pass "T1: [ci-infra] root ticket created for repo-wide Stage-1 failure"
else
  fail "T1: expected [ci-infra] ticket to be created. Log:
$(cat "$T1_LOG")"
fi

if grep "issue create" "$T1_LOG" | grep -q "auto-fix"; then
  fail "T1: [auto-fix] per-PR ticket should NOT be created for a repo-wide failure"
else
  pass "T1: [auto-fix] per-PR ticket correctly suppressed"
fi

# ═════════════════════════════════════════════════════════════════════════════
# Test 2: Dedup — existing [ci-infra] ticket → no second ticket created
# ═════════════════════════════════════════════════════════════════════════════
T2=$(mktemp -d)
CLEANUP_DIRS+=("$T2")

# The fake issue title must exactly match the INFRA_TITLE the script will compute.
# FAILED_STAGE_DESC for stage 1 is "Stage 1 — lint/typecheck/unit" (em dash);
# JSON — decodes to the same em dash character Python sees in the env var.
export PC_LIST_INFRA_JSON='[{"id":"existing-infra-123","title":"[ci-infra] main Stage 1 — lint/typecheck/unit red — repo-wide","status":"todo"}]'
export PC_LIST_FIX_JSON='[]'
export PC_LIST_PING_JSON='[]'

T2_LOG=$(make_stubs "$T2")

run_notify "$T2" \
  LINT_RESULT=failure \
  CI_RESULT=failure \
  BUILD_LINUX_RESULT=failure \
  > /dev/null

if grep "issue create" "$T2_LOG" | grep -q "ci-infra"; then
  fail "T2: second [ci-infra] ticket created; expected dedup to suppress it. Log:
$(cat "$T2_LOG")"
else
  pass "T2: no second [ci-infra] ticket created when one already exists (dedup OK)"
fi

# ═════════════════════════════════════════════════════════════════════════════
# Test 3: PR-specific failure — main green → per-PR [auto-fix] fix-request
# ═════════════════════════════════════════════════════════════════════════════
T3=$(mktemp -d)
CLEANUP_DIRS+=("$T3")

export GH_RUN_LIST_JSON='[{"databaseId":5001,"conclusion":"success"}]'
export GH_RUN_VIEW_JSON='{"jobs":[{"name":"lint","conclusion":"success"},{"name":"typecheck","conclusion":"success"},{"name":"unit","conclusion":"success"}]}'
export PC_LIST_INFRA_JSON='[]'
export PC_LIST_FIX_JSON='[]'
export PC_LIST_PING_JSON='[]'

T3_LOG=$(make_stubs "$T3")

run_notify "$T3" \
  LINT_RESULT=failure \
  CI_RESULT=failure \
  BUILD_LINUX_RESULT=failure \
  > /dev/null

if grep "issue create" "$T3_LOG" | grep -q "auto-fix"; then
  pass "T3: per-PR [auto-fix] fix-request created when main is green"
else
  fail "T3: expected [auto-fix] per-PR ticket to be created. Log:
$(cat "$T3_LOG")"
fi

if grep "issue create" "$T3_LOG" | grep -q "ci-infra"; then
  fail "T3: [ci-infra] root ticket should NOT be created when main is green"
else
  pass "T3: [ci-infra] correctly not created when main is green"
fi

# ═════════════════════════════════════════════════════════════════════════════
# Test 4: Root infra ticket auto-closes when main returns green (success run)
# ═════════════════════════════════════════════════════════════════════════════
T4=$(mktemp -d)
CLEANUP_DIRS+=("$T4")

export GH_RUN_LIST_JSON='[{"databaseId":5002,"conclusion":"success"}]'
export GH_RUN_VIEW_JSON='{"jobs":[]}'
export PC_LIST_PING_JSON='[]'
export PC_LIST_FIX_JSON='[]'
export PC_LIST_INFRA_JSON='[{"id":"old-infra-456","title":"[ci-infra] main Stage 1 — lint/typecheck/unit red — repo-wide","status":"todo"}]'

T4_LOG=$(make_stubs "$T4")

# All results green (success path) — BASE_ENV already has all=success
run_notify "$T4" > /dev/null

if grep "issue update" "$T4_LOG" | grep -q "old-infra-456"; then
  pass "T4: [ci-infra] root ticket closed when main returns green"
else
  fail "T4: expected [ci-infra] ticket (old-infra-456) to be closed via issue update. Log:
$(cat "$T4_LOG")"
fi

# ═════════════════════════════════════════════════════════════════════════════
# Test 5 (SKY-6531): Dedup — existing [auto-fix] ticket for the SAME (PR, stage)
#   → comment on it instead of minting a second ticket
# ═════════════════════════════════════════════════════════════════════════════
T5=$(mktemp -d)
CLEANUP_DIRS+=("$T5")

export GH_RUN_LIST_JSON='[{"databaseId":6001,"conclusion":"success"}]'
export GH_RUN_VIEW_JSON='{"jobs":[{"name":"lint","conclusion":"success"},{"name":"typecheck","conclusion":"success"},{"name":"unit","conclusion":"success"}]}'
export PC_LIST_INFRA_JSON='[]'
export PC_LIST_PING_JSON='[]'
export PC_LIST_FIX_JSON='[{"id":"existing-fix-555","title":"[auto-fix] PR #42 — CI red (Stage 1 — lint/typecheck/unit)","status":"todo"}]'

T5_LOG=$(make_stubs "$T5")

run_notify "$T5" \
  LINT_RESULT=failure \
  CI_RESULT=failure \
  BUILD_LINUX_RESULT=failure \
  > /dev/null

if grep "issue create" "$T5_LOG" | grep -q "auto-fix"; then
  fail "T5: second [auto-fix] ticket created for a (PR, stage) that already has one open. Log:
$(cat "$T5_LOG")"
else
  pass "T5: no duplicate [auto-fix] ticket created for the same (PR, stage) (dedup OK)"
fi

if grep "issue comment" "$T5_LOG" | grep -q "existing-fix-555"; then
  pass "T5: retry comment posted on the existing (PR, stage) fix-request instead"
else
  fail "T5: expected a retry comment on existing-fix-555. Log:
$(cat "$T5_LOG")"
fi

# ═════════════════════════════════════════════════════════════════════════════
# Test 6 (SKY-6531): CI goes green → both the open [auto-fix] ticket AND the
#   merge-gate ping ticket for this PR auto-close (no manual cleanup needed)
# ═════════════════════════════════════════════════════════════════════════════
T6=$(mktemp -d)
CLEANUP_DIRS+=("$T6")

export GH_RUN_LIST_JSON='[{"databaseId":6002,"conclusion":"success"}]'
export GH_RUN_VIEW_JSON='{"jobs":[]}'
export PC_LIST_INFRA_JSON='[]'
export PC_LIST_PING_JSON='[{"id":"existing-ping-321","title":"PR #42 CI failure — merge gate (green = sign-off req, NOT merge)","status":"todo"}]'
export PC_LIST_FIX_JSON='[{"id":"existing-fix-789","title":"[auto-fix] PR #42 — CI red (Stage 3 — E2E shards)","status":"todo"}]'

T6_LOG=$(make_stubs "$T6")

# All results green (success path) — BASE_ENV already has all=success
run_notify "$T6" > /dev/null

if grep "issue update" "$T6_LOG" | grep -q "existing-fix-789"; then
  pass "T6: open [auto-fix] ticket closed when the PR's CI goes green"
else
  fail "T6: expected existing-fix-789 to be closed via issue update. Log:
$(cat "$T6_LOG")"
fi

if grep "issue update" "$T6_LOG" | grep -q "existing-ping-321"; then
  pass "T6: open merge-gate ping ticket closed when the PR's CI goes green"
else
  fail "T6: expected existing-ping-321 to be closed via issue update. Log:
$(cat "$T6_LOG")"
fi

# ═════════════════════════════════════════════════════════════════════════════
# Test 7 (SKY-6531): transient `paperclipai issue list` failures are retried
#   (list_issues_retry) instead of silently defeating dedup on the first blip
# ═════════════════════════════════════════════════════════════════════════════
T7=$(mktemp -d)
CLEANUP_DIRS+=("$T7")

export GH_RUN_LIST_JSON='[{"databaseId":6003,"conclusion":"success"}]'
export GH_RUN_VIEW_JSON='{"jobs":[{"name":"lint","conclusion":"success"},{"name":"typecheck","conclusion":"success"},{"name":"unit","conclusion":"success"}]}'
export PC_LIST_INFRA_JSON='[]'
export PC_LIST_PING_JSON='[]'
export PC_LIST_FIX_JSON='[]'
export PC_LIST_FIX_FLAKY_COUNT=2

T7_LOG=$(make_stubs "$T7")

run_notify "$T7" \
  LINT_RESULT=failure \
  CI_RESULT=failure \
  BUILD_LINUX_RESULT=failure \
  > /dev/null

unset PC_LIST_FIX_FLAKY_COUNT

FIX_LIST_ATTEMPTS=$(grep -c "issue list.*auto-fix" "$T7_LOG" || true)
if [[ "$FIX_LIST_ATTEMPTS" -eq 3 ]]; then
  pass "T7: list_issues_retry retried the flaky [auto-fix] list call (2 failures + 1 success)"
else
  fail "T7: expected exactly 3 [auto-fix] list attempts (2 flaky + 1 success), saw ${FIX_LIST_ATTEMPTS}. Log:
$(cat "$T7_LOG")"
fi

if grep "issue create" "$T7_LOG" | grep -q "auto-fix"; then
  pass "T7: fix-request still created correctly once the list call recovered"
else
  fail "T7: expected [auto-fix] ticket to be created after retry recovery. Log:
$(cat "$T7_LOG")"
fi

# ═════════════════════════════════════════════════════════════════════════════
# Test 8 (SKY-6528): a manually-titled CTO work ticket that happens to start
#   with "[ci-infra]" (e.g. "[ci-infra] Root-cause fix: ...") must NOT be
#   treated as an existing auto-generated repo-wide ticket on create-dedup —
#   confirmed root cause of SKY-6531 self-closing mid-flight.
# ═════════════════════════════════════════════════════════════════════════════
T8=$(mktemp -d)
CLEANUP_DIRS+=("$T8")

export GH_RUN_LIST_JSON='[{"databaseId":7001,"conclusion":"failure"}]'
export GH_RUN_VIEW_JSON='{"jobs":[{"name":"lint","conclusion":"failure"}]}'
export PC_LIST_PING_JSON='[]'
export PC_LIST_FIX_JSON='[]'
export PC_LIST_INFRA_JSON='[{"id":"manual-work-ticket-999","title":"[ci-infra] Root-cause fix: refresh VR baselines + raise threshold, and dedupe/auto-close notify-board.sh","status":"in_progress"}]'

T8_LOG=$(make_stubs "$T8")

run_notify "$T8" \
  LINT_RESULT=failure \
  CI_RESULT=failure \
  BUILD_LINUX_RESULT=failure \
  > /dev/null

if grep "issue create" "$T8_LOG" | grep -q "ci-infra"; then
  pass "T8: new repo-wide [ci-infra] ticket created even though a manually-titled work ticket shares the bare prefix (no false dedup)"
else
  fail "T8: expected a new [ci-infra] ticket — the manually-titled work ticket must not have been mistaken for an existing repo-wide alert. Log:
$(cat "$T8_LOG")"
fi

if grep "issue update" "$T8_LOG" | grep -q "manual-work-ticket-999"; then
  fail "T8: the manually-titled work ticket was touched by create-dedup logic — it must be untouched. Log:
$(cat "$T8_LOG")"
else
  pass "T8: manually-titled work ticket left untouched by create-dedup"
fi

# ═════════════════════════════════════════════════════════════════════════════
# Test 9 (SKY-6528): on CI green + main green, close-on-green must NOT sweep up
#   a manually-titled CTO work ticket sharing the bare "[ci-infra]" prefix —
#   this exact loose match auto-closed SKY-6531 (a live work ticket) mid-flight.
# ═════════════════════════════════════════════════════════════════════════════
T9=$(mktemp -d)
CLEANUP_DIRS+=("$T9")

export GH_RUN_LIST_JSON='[{"databaseId":7002,"conclusion":"success"}]'
export GH_RUN_VIEW_JSON='{"jobs":[]}'
export PC_LIST_PING_JSON='[]'
export PC_LIST_FIX_JSON='[]'
export PC_LIST_INFRA_JSON='[{"id":"manual-work-ticket-999","title":"[ci-infra] Fix notify-board.sh churn + regen VR baselines + raise threshold (owner-approved)","status":"in_progress"}]'

T9_LOG=$(make_stubs "$T9")

# All results green (success path) — BASE_ENV already has all=success
run_notify "$T9" > /dev/null

if grep "issue update" "$T9_LOG" | grep -q "manual-work-ticket-999"; then
  fail "T9: manually-titled work ticket was auto-closed by the repo-wide close-on-green sweep — this is the exact bug that self-closed SKY-6531. Log:
$(cat "$T9_LOG")"
else
  pass "T9: manually-titled work ticket sharing the bare [ci-infra] prefix survives close-on-green"
fi

# ── Cleanup ───────────────────────────────────────────────────────────────────
for d in "${CLEANUP_DIRS[@]}"; do
  rm -rf "$d"
done

# ── Summary ───────────────────────────────────────────────────────────────────
TOTAL_TESTS=9
echo ""
if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo "All ${TOTAL_TESTS} tests passed."
  exit 0
else
  echo "${FAIL_COUNT} test(s) FAILED (out of ${TOTAL_TESTS})." >&2
  exit 1
fi
