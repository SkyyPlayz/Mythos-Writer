## Summary

<!-- What does this PR do? Reference the Paperclip issue if applicable (e.g. Refs: SKY-123). -->

## Definition of Done

_Every change must satisfy all items before merge. Reviewer confirms these hold._

- [ ] **Correct across the input space** — behavior verified at boundaries, edges, and the documented contract; happy path is not enough.
- [ ] **Clear** — names reveal intent; functions short and single-purpose; nesting flat; no hidden state or hidden side effects.
- [ ] **No new accidental complexity** — no speculative abstractions, no flags-for-the-future, no duplicated knowledge.
- [ ] **Error paths handled** — fails fast and loudly, never swallows errors, preserves invariants under failure.
- [ ] **Boundary tests with behavior-level assertions** — tests check observable behavior, not implementation; each test has been seen to fail before pass.
- [ ] **Regression test for any bug fixed** — a permanent test that reproduces the bug, kept forever.
- [ ] **Green CI** — lint, typecheck, tests, and build all pass on this branch before merge.

> Full rubric: [docs/code-review-rubric.md](../docs/code-review-rubric.md) · Standard: [SKY-356](https://github.com/SkyyPlayz/Mythos-Writer/blob/main/plans/ProjectGoalOverView/13-Code-Quality.md)

## Pre-merge checklist

- [ ] Branch is rebased on the latest `main` (`git fetch origin && git rebase origin/main`)
- [ ] `npm run lint -w frontend` passes locally
- [ ] `npm run typecheck` passes locally
- [ ] `npm run test` passes locally
- [ ] `npm run build:electron` succeeds locally
- [ ] All three required CI checks pass: `ci`, `build-macos`, `build-linux`
- [ ] No secrets, credentials, or customer data in the diff

## Test plan

<!-- How was this change verified? What edge cases were tested? -->
