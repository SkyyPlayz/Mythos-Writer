# Mythos Writer — Plans & Goals (single source of truth)

> This document states, in one place, **what we are building, why, and to what standard.**
> It mirrors the goals tracked on the Sky High board so the whole picture lives in the repo.
> Detailed feature plans live in [`plans/ProjectGoalOverView/`](ProjectGoalOverView/); the
> current build roadmap lives in [`plans/BETA-2-ROADMAP.md`](BETA-2-ROADMAP.md).

---

## The mission — "We Build Nothing Less Than the Best"

Our one mission: build the most polished, smooth, beautiful, and flawlessly running apps the
world has ever touched. Not "good enough." Not "functional." Not "fine." **Exceptional** — because
anything less betrays who we are.

Great software isn't just code — it's craftsmanship: making something so seamless people forget
they're using technology. We obsess over the details others ignore, polish the edges no one sees,
and smooth the friction most teams accept as normal. **Excellence isn't the goal — it's the baseline.**
Nothing gets called "done" if it betrays that bar.

## The product — "a writing app with an extra brain"

**Mythos Writer — a writing app, with an extra brain, to keep everything in mind so you don't have to.**

It feels as comfortable as a word processor while quietly managing the complex parts of
worldbuilding for you. You write in a clean, familiar editor; the app organizes your ideas, notes,
characters, locations, and timelines in the background.

**Two vaults, one purpose** (local-first, files as plain Markdown, no cloud / no lock-in):
- **Story Vault** — your manuscript (chapters/scenes, versioned drafts). **AI never edits story files directly.**
- **Notes Vault** — worldbuilding, characters, lore, timelines. **Obsidian-compatible** (open existing Obsidian vaults, and open these in Obsidian).

**Core promise:** familiar Word-like writing + Obsidian-like linked notes, with three AI agents
(Brainstorm, Writing Assistant, Archive) that assist across both surfaces. **Every agent action is
a suggestion by default — the author confirms before anything is applied. The author stays in
control of every word.** Standalone app (not an Obsidian plugin); we implement all editor, layout,
AI, versioning, timeline, and planning surfaces ourselves.

## The current target — Beta Release 2 (the MVP bar)

The prior MVP shipped as **v0.2.1**. The current bar is **Beta Release 2**: **everything in the app
plans, shipped to the "Build Nothing Less Than the Best" standard** — polished, smooth, flawless;
**nothing half-finished ships.** The build is organized into parts **A–I** — see
[`plans/BETA-2-ROADMAP.md`](BETA-2-ROADMAP.md) for the plan and live status.

## The engineering standard — Correct, Clear, Simple, Tested, Bulletproof

Every person who writes, reviews, or tests code holds to the **Code Quality Standard**
([`13-Code-Quality.md`](ProjectGoalOverView/13-Code-Quality.md)). Two facts drive it: (1) code is
read far more than written — optimize for the next human (often future-you); (2) defects get
exponentially more expensive the later they're caught. So: correct first, then clear, then simple;
every change tested; nothing bulletproofed later that could be bulletproofed now. PRs are expected
**green on the first CI run** ([`../CI-PREFLIGHT.md`](../CI-PREFLIGHT.md)).

## How we work — plans-first, readiness before assignment

- **Plans-first:** read the plans + goals before asking the board — the vision, feature goals, and
  decisions are already documented here ([`ProjectGoalOverView/`](ProjectGoalOverView/),
  [`00-decisions-log.md`](ProjectGoalOverView/00-decisions-log.md)).
- **Issue readiness:** work is planned into a full execution path (contracts, slices, acceptance
  criteria) **before** it's assigned, so builders never stall for lack of direction.
- **Owner sign-off gate:** heavy features are planned, then get owner sign-off, then build; nothing
  significant merges to `main` without review.

## Locked product decisions (do not re-litigate)

- **Editors:** Word-like Story editor + Obsidian-like Notes editor share one rich-text core; Notes
  source-mode is the source of truth (lossless), rich mode is opt-in.
- **AI is suggestion-only:** the Archive agent (incl. Scene Crafter) *suggests* via the Suggestion
  Inbox; it never adds/removes/changes content itself — the user applies.
- **Timeline:** an **AEON-style subway/track visual** is required (the spreadsheet timeline alone is
  not sufficient).
- **Accessibility:** the whole app is being made **dyslexia-friendly via deep, adjustable
  customization** — adjustable, not forced.
- **Distribution:** the repo stays **private**; Windows builds are for the owner's own testing;
  shipping unsigned is acceptable — release polish is convenience, not a gate.

---

*Sky High Infinite Techwork. This file is the human-readable mirror of the board's goals; when the
two disagree, the board is authoritative and this file should be updated to match.*
