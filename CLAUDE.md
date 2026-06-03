# Mythos-Writer — Agent Working Rules

This repository is built by autonomous agents. Behave like a software engineer
who is responsible for delivering merge-ready branches, not a code drafter who
waits for humans to discover breakage.

## Read the plans first (required for all agents)

Before asking the Board (`@Board`) any question, **read the project plans and
goals in [`plans/ProjectGoalOverView/`](plans/ProjectGoalOverView/)**.

The Board has already documented the product vision, feature goals, design
system, and decisions. Most questions are already answered there.

Mandatory reading before starting any task:
- [`plans/ProjectGoalOverView/01-overview.md`](plans/ProjectGoalOverView/01-overview.md) — vision, guiding principles, two-vault model
- [`plans/ProjectGoalOverView/00-decisions-log.md`](plans/ProjectGoalOverView/00-decisions-log.md) — decisions already made by the Board/CEO
- [`plans/ProjectGoalOverView/questions.md`](plans/ProjectGoalOverView/questions.md) — open and answered questions
- [`plans/ProjectGoalOverView/13-team-goals.md`](plans/ProjectGoalOverView/13-team-goals.md) — this policy in full, with a complete index of plan files
- [`plans/PROJECT_PLAN.md`](plans/PROJECT_PLAN.md) — feature roadmap

Only escalate to the Board after you have checked those files and the answer is
genuinely not there. When you do ask, state which plan files you already read.

## CI is part of the spec

Every branch must pass all three required pull-request checks before it is
considered done:

1. `CI / build-linux (pull_request)`
2. `CI / build-macos (pull_request)`
3. `CI / ci (pull_request)`

A branch with any failing required check is **not done**. Passing these checks
is part of the implementation, not a follow-up step.

These checks are defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
as the `ci`, `build-macos`, and `build-linux` jobs.

## Never merge a PR with failing required checks

This rule is non-negotiable, regardless of whether GitHub branch protection
currently enforces it:

- Before clicking `gh pr merge` or the Merge button, confirm `gh pr checks <num>`
  shows **all three** of `ci`, `build-linux`, and `build-macos` as `pass`.
- If a required check is red, fix the cause on the PR branch and push again.
  Do not merge "to fix on main" — that is what produced the SKY-143 and SKY-157
  incidents (PRs #156 and #162 merged with red `ci` + `build-linux`, leaving
  main red until subsequent fix-forward commits).
- A red required check that is unrelated to the PR's diff (e.g. inherited from
  a previously merged broken commit on main) is still a hard block on merging.
  Open a separate fix issue, get main green first, then rebase the PR.
- If you believe a required check is genuinely broken (infra, runner, flake)
  and not testing real product code, escalate and get explicit human approval
  before merging — do not unilaterally override.

Pre-merge command:

```bash
gh pr checks <num>   # all three required checks must show `pass`
```

## What each check enforces

- **`ci`** (ubuntu): frontend lint, frontend + electron-main type-checks,
  electron-main + frontend unit tests, `electron-vite` build, and headless
  Playwright E2E (vault CRUD + brainstorm).
- **`build-macos`** (macos-latest): runs `npm run dist:mac` to produce an unsigned DMG
  (Phase 1). Notarization is skipped automatically when `APPLE_CERT_P12_BASE64` is
  absent. Phase 2 (signing + notarization) tracked separately once Apple Developer
  Program certs are provisioned.
- **`build-linux`** (ubuntu): lint, type-checks, unit tests, then packages the
  Linux AppImage (`npm run dist:linux`) and smoke-tests that it launches.

## Validate locally before declaring completion

Run the same commands CI runs. From the repo root:

```bash
npm ci                          # deterministic install (matches CI)
npm run lint -w frontend        # frontend lint
npm run typecheck               # frontend + electron-main type-checks
npm run test                    # electron-main + frontend unit tests
npm run build:electron          # electron-vite production build
npm run test:e2e:crud           # headless E2E (needs a display; xvfb in CI)
npm run test:e2e:brainstorm
```

Packaging steps (`dist:mac` / `dist:linux`) are platform-specific; if you cannot
run them locally, reason explicitly about why your change is safe for that
platform.

## Standard of completion

- A code issue may only move to `done` when its PR is **merged to main** (closed-unmerged PRs and absent commits do not count).
- Take responsibility for the full impact of your change.
- Do not rely on "humans will fix CI later."
- Do not treat broken builds, lint failures, type errors, or test regressions as
  acceptable intermediate outcomes — unless you were explicitly asked for a
  draft-only change.
- If a change alters behavior, update or add tests in the same task.
- Output should be **merge-oriented**, not merely code-generating.

## Cross-platform discipline

CI runs on Linux and macOS. Avoid breakage that only shows up on one OS:

- Use correct import casing — imports are case-sensitive on Linux even when they
  resolve on a case-insensitive filesystem.
- Use `path` helpers for filesystem paths; don't hardcode separators.
- Avoid platform-specific shell behavior and environment assumptions.
- Don't introduce new type debt, flaky tests, hidden side effects, or
  unvalidated dependencies.

## Decision rules

- If a change risks CI, choose the safer implementation.
- If a dependency or config update is unnecessary, avoid it.
- If uncertainty remains, call it out explicitly and reduce scope rather than
  shipping fragile code.
- Optimize for **passing branches**, not maximum code volume.

## Required final report for each task

When you finish, state:

- what you changed,
- why it should pass `build-linux`,
- why it should pass `build-macos`,
- why it should pass `ci`,
- what tests were added / updated / relied on,
- and any remaining risk areas.
