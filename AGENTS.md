# Agent instructions

This repository is built by autonomous agents. The canonical working rules —
including the non-negotiable CI / merge-readiness contract — live in
[`CLAUDE.md`](CLAUDE.md). Read it before making changes.

Summary: a branch is not done until all three required PR checks pass —
`CI / build-linux`, `CI / build-macos`, and `CI / ci`. CI is part of the spec.

## Mandatory pre-close verification (MYT-766 merge gate)

Before you call `PATCH /api/issues/{id}` with `status: done` on ANY issue that
contains a GitHub PR link in its description or comments:

1. **Verify the PR is merged to `main`:**
   ```bash
   gh pr view <PR_NUMBER> --json state,mergedAt,baseRefName \
     --repo SkyyPlayz/Mythos-Writer
   ```
   The `state` must be `"MERGED"` and `mergedAt` must be non-null.

2. **If the PR is not yet merged:** do NOT mark the issue done. Instead:
   - If the PR is open and CI is green: merge it first.
   - If the PR is closed without merging: open a new PR with the same commits.
   - If you cannot merge: leave the issue `in_progress` and comment with the
     blocker.

3. **If the issue has no PR links:** it is a non-code/planning issue and this
   check does not apply.

**Why this is enforced:** The Paperclip merge-gate plugin ([MYT-766](/MYT/issues/MYT-766))
will automatically revert `done` back to `in_progress` if no merged PR is
detected. Do the check yourself first to avoid a phantom-close event waking
dependent issues.

**For `issue_children_completed` wakes:** When you wake because a child issue
completed, ALWAYS re-fetch the child's current status via
`GET /api/issues/{childId}` before acting. Do NOT trust the status from the
wake payload — it may be stale if the child was reverted by the merge gate.
If the child is `in_progress`, wait for it to actually complete before
resuming the parent's flow.
