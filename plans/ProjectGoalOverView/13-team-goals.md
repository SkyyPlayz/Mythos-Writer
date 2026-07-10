> **Index update (2026-07-10):** the product source of truth is now
> [`14-beta4-refine-overview.md`](14-beta4-refine-overview.md) +
> [`plans/design-handoff/v2/FULL-SPEC.md`](../design-handoff/v2/FULL-SPEC.md)
> (prototype-authoritative) + the build plan
> [`docs/releases/BETA-REFINE.md`](../../docs/releases/BETA-REFINE.md).
> Docs 01–12 and `questions.md` are historical; binding carry-overs live in
> [`15-beta4-comparison-and-carryovers.md`](15-beta4-comparison-and-carryovers.md).
> [`13-Code-Quality.md`](13-Code-Quality.md) remains fully in force.
> The read-the-plans-first policy below is unchanged.

# Team Goal: Plans-First Policy

## Goal

Every agent working on Mythos Writer **must read the project plans and goals before asking the Board any questions.**

## Why

The Board has already documented the product vision, feature goals, design decisions, and open questions in this directory. Asking the Board about something already covered in the plans wastes their time and creates unnecessary interruptions.

## Where to look

0. **Goals & current plan (start here for the big picture)** → [`plans/GOALS.md`](../GOALS.md) — the mission, product vision, current target (Beta 2), engineering standard, and locked decisions — and [`plans/BETA-2-ROADMAP.md`](../BETA-2-ROADMAP.md) — the parts A–I and live status.
1. **Start here** → [`plans/ProjectGoalOverView/01-overview.md`](01-overview.md) — core product vision, guiding principles, and the two-vault model.
2. **Feature goals** → all numbered files in this folder (`02-storage-and-organization.md`, `03-writing-experience-and-modes.md`, ..., `12-visual-design-system.md`).
3. **Decisions log** → [`plans/ProjectGoalOverView/00-decisions-log.md`](00-decisions-log.md) — CEO and Board decisions already made.
4. **Open questions** → [`plans/ProjectGoalOverView/questions.md`](questions.md) — questions the Board has already flagged or answered.
5. **Project plan / roadmap** → [`plans/PROJECT_PLAN.md`](../PROJECT_PLAN.md).
6. **Visual design** → [`plans/ProjectGoalOverView/12-visual-design-system.md`](12-visual-design-system.md) and [`plans/ProjectGoalOverView/Liquid-Neon-theme-examples/`](Liquid-Neon-theme-examples/).
7. **Performance budget** → [`plans/PERF_BUDGET.md`](../PERF_BUDGET.md).

## Required behavior for all agents

Before raising a question to the Board (`@Board` / `user://local-board`):

1. **Read the relevant plan files listed above.**
2. **Search for the answer** in the overview, the decisions log, and the questions file.
3. Only if the answer is genuinely not there, **ask the Board** — and when you do, reference which plan files you already checked.

## Asking the Board

When you must ask the Board a question:
- Tag `@Board` in the Paperclip issue thread or comment.
- State clearly which plan files you already read.
- Keep the question specific and actionable.

The Board is the authoritative source for new decisions. The plans are the authoritative source for existing decisions. Use both in the right order.
