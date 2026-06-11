# Bug Hunt Core Plan

## Objective

Shift the daily rhythm from manual issue triage to a lightweight, repeatable hunt that produces **1 to 3 high-confidence GitHub issues** per run with enough context to open them quickly.

## Scope

- Prioritize surfaces with the highest customer impact and highest regressions:
  - Authentication and permission boundaries.
  - Core CRUD and persistence flows.
  - Scene/story data integrity paths.
  - Background tasks and asynchronous processing.
  - Edge-case handling (empty payloads, null states, malformed markdown/frontmatter).
- Keep each finding scoped to a single actionable issue.
- Prefer deterministic discovery signals over random or speculative behavior.

## Output standard

- Each hunt run outputs:
  - A daily markdown report.
  - A machine-readable artifact for automation hooks.
  - 0 to 3 findings, each with a clear repro idea.

## Acceptance notes

- If no safe findings are found, the run is allowed to emit zero findings.
- Any proposed issue must include reproducibility hints and a concrete expected behavior.
