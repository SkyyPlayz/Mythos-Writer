# GitHub Issue Fishing Plan

## Goal

Produce 1 to 3 evidence-backed issue candidates per run with enough context for immediate assignment.

## Criteria for a valid candidate

- Reproducible: a concise sequence of steps exists.
- Scoped: one bug, one component, one expected correction.
- Useful: user-visible impact or testability risk.
- Verifiable: file-level evidence can be traced in repo.

## Prioritization

- Permission and auth edge cases.
- Core writing/data pathways (vault, scenes, notes).
- Persistence and migration reliability.
- Empty state and malformed input handling.
- Startup/command-run and async pipeline failures.

## Output contract

- Emit findings in `daily_bug_hunt_<YYYYMMDD>.md`.
- Keep finding count capped at 3.
- Append a machine-readable JSON artifact for downstream automation.
