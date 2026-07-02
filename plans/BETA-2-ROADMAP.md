# Mythos Writer — Beta Release 2 Roadmap

> The current build plan and live status. Goals + standard: [`plans/GOALS.md`](GOALS.md).
> Feature detail per surface: [`plans/ProjectGoalOverView/`](ProjectGoalOverView/).
> **Status as of 2026-07-02.** Update this table as parts land.

**Beta Release 2 = the MVP bar:** everything in the app plans, shipped to the "Build Nothing Less
Than the Best" standard — polished, smooth, flawless; nothing half-finished ships. The work is
sliced into **parts A–I**, each planned as a deep-dive (contracts → slices → acceptance criteria),
owner-signed for the heavy ones, then built in parallel behind green CI.

## Status at a glance

| Part | Scope | Tier | Status |
|------|-------|------|--------|
| **A** | App Shell & Navigation relayout (AppNavRail, workspace tabs, Settings split, onboarding) | heavy | ✅ **done** |
| **B** | Story & Notes editors — Word-like + Obsidian parity (shared `<RichTextEditor>` core) | heavy | ✅ **done** |
| **C** | Heading-driven manuscript views (full-book / H1 / H2, edge-arrow scene nav) | heavy | ✅ **done** |
| **D** | Settings & Configuration UX (Vaults / Agents / Appearance categories) | standard | 🔨 in progress |
| **E** | Agent Suite parity + Suggestion Inbox + Scene Crafter (suggestion-only) | heavy | 🔨 integrating |
| **F** | Timeline — AEON-style subway/track visual (on the existing spreadsheet timeline) | heavy | 🔨 integrating |
| **G** | Voice I/O completion (STT/TTS pipeline, settings, a11y) | standard | 🔨 in progress |
| **H** | Design System final polish (Liquid-Neon tokens, contrast, motion) | light | ⏳ pending |
| **I** | Release Readiness (auto-update, runbook, owner-gated ship of v0.3.0-beta) | standard | ⏳ pending (gates ship) |

*Related standing direction (planned, owner-gated): whole-app **dyslexia-friendly** overhaul via
deep, adjustable customization.*

## What each part delivers

- **A — App Shell.** The navigation + layout foundation everything else sits in: nav rail, workspace
  tabs (Story / Notes), Settings split, onboarding improvements.
- **B — Editors.** One shared rich-text core powering a **Word-like Story editor** and an
  **Obsidian-like Notes editor** (wiki-links, @entity-mentions, underline, tri-mode
  source/rich/preview with a markdown-fidelity guard). *Contract: never regress markdown round-trip
  or draft-state; Notes source-mode is lossless source-of-truth.*
- **C — Manuscript views.** Heading-driven full-book / chapter / scene views with on-canvas
  edge-arrow navigation. *Contract: must not break scene-version backups.*
- **D — Settings UX.** Split Settings into Vaults / Agents / Appearance, with a category registry and
  sub-nav so configuration is discoverable and clean.
- **E — Agent suite & Scene Crafter.** Brainstorm parity (standalone tab + Notes sidebar + Story
  assist), a unified **Suggestion Inbox**, and **Scene Crafter**. *Locked contract: Scene Crafter is
  AI-powered but **suggestion-only** — the Archive agent suggests; it never mutates the Scene Crafter
  itself; all apply/reject is user-driven via the Inbox.*
- **F — Timeline.** The **AEON-style subway/track visual** (lanes, scene-cards, span-bars,
  interactions, view switcher) built on top of the existing tested spreadsheet timeline. *Owner
  decision: the subway visual is **required** for Beta 2 — the spreadsheet alone is not enough.*
- **G — Voice I/O.** Complete the speech-to-text / text-to-speech pipeline, voice settings UX, and
  cross-platform engine validation, with E2E + a11y coverage.
- **H — Design polish.** Final Liquid-Neon design-system pass: tokenization, contrast floor,
  reduced-motion, visual consistency across every shipped surface.
- **I — Release readiness.** Auto-update on the beta channel, the release runbook
  ([`docs/RELEASE_RUNBOOK.md`](../docs/RELEASE_RUNBOOK.md)), and the **owner-gated** ship of the beta
  build. Repo stays private; Windows builds are for owner testing; unsigned is acceptable.

## How the parts get built

1. **Deep-dive plan** — each part is authored as a plan: interface contracts, a slice map (each slice
   owns its files — no two slices touch the same file), acceptance criteria, risks, and a
   no-backtrack build schedule (foundations frozen first, cohesive waves).
2. **Owner sign-off** — heavy parts are signed off before their build wave starts.
3. **Parallel build** — slices are built by different agents in parallel behind green CI, each meeting
   its acceptance criteria, pre-flighted to CI parity locally so PRs are green on the first run.
4. **Integrate → polish** — the CTO reconciles wave-by-wave; QA verifies against the whole-part
   acceptance criteria before it's called done.
5. **Merge gate** — nothing merges to `main` without review; high-risk changes (workflows,
   migrations, auth, release config) route to the owner.

---

*This roadmap is the human-readable mirror of the Beta 2 master plan on the board. When they
disagree, the board is authoritative — update this file to match.*
