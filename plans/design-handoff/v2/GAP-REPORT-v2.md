# GAP REPORT v2 — Shipped Beta vs. Approved Prototype

**From:** Skyy's design session
**To:** Claude Code chat "Mythos Writer" (linked to the Mythos-Writer repo)
**Date:** 2026-07-09
**Shipped build reviewed:** v0.4.0-beta.1 · Electron 42.3.0 · win32 · "Liquid Neon" (installed at `C:\...\Mythos Writer\`, screenshots taken 2026-07-09)
**Source of truth:** `prototype/Mythos Writer - Liquid Neon.dc.html` (refreshed in this package — it supersedes the 07-05 copy; every interaction referenced below is wired and clickable in it)

---

## How to use this document

The first handoff (README/DESIGN-SPEC/PROCESS) still stands. This document is the **delta review**: what the shipped beta gets wrong compared to the prototype, organized by surface, with the exact expected behavior for each. Work top-to-bottom; the P0s are visual-integrity bugs a user hits in the first minute. **Also read `PERFORMANCE.md`** — the shipped beta drops frames and lags input by up to a minute; the perf work there is as important as any P0 below.

Rule of thumb for every ambiguity: **open the prototype and click it.** If the prototype and this doc ever disagree, the prototype wins.

---

## P0 — Bugs and structural defects

### 1. Notes Vault seeding runs on every boot (data corruption)
The shipped tree shows `Archive` ×4, `Systems` ×4, `Universes` ×9, `scenes` ×3, plus raw UUID folders (`3f6a804a-…`, `f8c62a1a-…` ×5) at the root. The SKY-15 seed layout (`Universes/, Stories/, Inbox/, Research/, Daily Notes/, Archive/`) is being re-created on every run instead of once, and story-internal folders (scene UUID dirs) are leaking into the Notes Vault tree.
**Expected:** seed once (marker file or DB flag); story-vault internals never appear in the Notes tree; UUID folders are display-mapped to their story/scene titles. Prototype tree shows the model: human-named folders with counts, one level of nesting, no duplicates.

### 2. Rich view renders frontmatter as body text
`board.md` in Rich mode renders `kanban-plugin: board mythos-board-version: 1 story-id: …` as a giant bold heading.
**Expected:** YAML frontmatter is stripped from Rich/Preview render (shown only in Source mode). Kanban/board files should render as a board or at minimum hide the `%% kanban:settings %%` block.

### 3. Right-panel layout collisions
- Notes tab agent panel: the `← Back` button overlaps the `Epic Fantasy ▾` dropdown (both absolutely placed in the same row).
- Writing Assistant: `Heartbeat tipsScan now` has no gap between label and button; `Reviewing sceene 2` title wraps awkwardly against the Beta-Read button.
**Expected:** panels are flex rows with `gap`; see prototype right-panel spacing (12px padding, 8px gaps, buttons never overlap at 280–320px panel width).

### 4. Editor chrome is duplicated
The Story editor stacks TWO breadcrumb/zoom rows (`Full Book / Chapter / Scene` appears in the top bar *and* again below it) and TWO `Read` buttons, and `Dictate / Assist` appear both in the format toolbar and in a second floating row in scene view.
**Expected (prototype):** ONE bar: breadcrumb + zoom segmented control + title on the left; N/F/E, Story Assist, swatches, Writing Focus on the right. Below it ONE formatting toolbar (Body Text · font · size · B/I/U/S · align · lists · Read/Dictate/Assist right-aligned). Nothing repeats.

---

## P1 — Surfaces that diverge from the prototype

### 5. Scene-level editor
Shipped: a small dark card floating top-left in a huge empty canvas; page-setup controls (`PAGE Letter A4 A5 Manuscript / WIDTH / MARGINS / FONT SIZE / LINE SPACING / Serif Sans Mono / Reset`) exposed as a permanent full-width strip; `Save snapshot now` / `History` as a second strip.
**Expected:** the manuscript page is centered, page-width driven by the slider in the status bar (drag page edge also works); page-setup lives behind the toolbar's page chip (compact popover), not an always-on strip; snapshots/History live in the ⋯ menu + status bar. In-progress/Review/Final status is cycled from the scene dot in the navigator and shown as one chip, not three buttons above the text.

### 6. Brainstorm — Clusters and Map
Shipped Clusters: one flat full-width ellipse labeled CHARACTERS with a single chip; Map: not reviewed/likely placeholder.
**Expected (prototype):** Clusters = multiple rounded cluster bubbles positioned across the canvas, each with a colored halo, count, and member chips; Map = radial node map with hub nodes, connecting lines, zoom controls (50–200%) and the bottom tool dock (Select / Connect / Frame + zoom). Bottom status: `N ideas · M clusters`.

### 7. Timeline
Shipped: spreadsheet mode is a near-empty table with dashes; Plan-vs-Progress/Subway/Relationships exist as tabs but the toolbar (Group None/Arc/Character, Year…Scene, Today) is disconnected from content.
**Expected:** all five modes render from the same event data (see `tlEvents` in the prototype); `Today` jumps/selects the current event and toasts; View/Group/Show filter selects actually re-group the bands; the Suggest-with-AI button proposes dates for undated scenes.

### 8. Settings
Shipped: a modal with 8 tabs that wrap into two ragged rows; About shows fine but Appearance scroll shows chunky native scrollbars.
**Expected (prototype):** Settings is a full workspace view (left section rail: General / Appearance / Agents / Vault & Files / Sync & Backup / Account / Shortcuts / About) — not a modal; thin styled scrollbars (`::-webkit-scrollbar` 8px, translucent thumb) app-wide.

### 9. Window & navigation chrome
- Left rail: icon labels appear only on some views (Brainstorm shows `Mythos/Story/Notes/Brainstorm/Settings`, Story view shows bare icons). **Expected:** consistent — labels always visible (slim mode is a user toggle, not per-view).
- Workspace tabs: shipped tabs (Story/Notes/Brainstorm) duplicate the nav rail one-to-one, so the tab strip carries no information. **Expected:** tabs are *documents/workspaces* (scenes, notes, boards can open as tabs; drag-reorder; right-click menu: open to the side / pop out / close), per prototype tab strip.
- The `+` next to tabs opens the tab-kind picker (prototype behavior), not a dead button.

### 10. Bottom status bar
Shipped: two stat rows (one inside the page card zone, one app-level) with duplicated word counts; goal chip reads `0 / 500 today` while the assistant panel shows a separate `0/500` — fine — but Prev/Next scene buttons live in the shipped bar already ✓.
**Expected:** ONE app status bar: `‹ Prev / Next ›` · breadcrumb · words · characters · read time · page-width hint · (right) status chip · goal chip · Saved indicator with pulse dot.

---

## P2 — Polish deltas (do after P0/P1)

11. **Scrollbars:** native gray scrollbars everywhere (notes tree, right panel, settings). Prototype styles them thin/translucent globally.
12. **Empty states:** shipped empty states are plain text ("Select a note from the sidebar…"). Prototype pairs a glyph + one-line hint + a primary action button. Copy them (Notes editor, Timeline, Graph, Scene Crafter drop zone).
13. **Typo:** status/tab copy shows user data faithfully (`sceene 2` is user content — leave it), but system copy like `chaper 1` template names in Suggested Cards comes from filenames — display-map to title case where the file has a `title:` frontmatter.
14. **Genre preset control** appears 3× on Brainstorm (header, right panel, tip). Prototype: once in the agent header; right-panel tip links to it (`Show Presets` scrolls/opens the same control).
15. **Beta-Read panel** copy: `Reviewing sceene 2 / No active Beta-Read comments / No feedback yet…` — three stacked empty statements. Prototype: one empty state + one action.

---

## What the prototype intentionally mocks (build these for real)

- Anything that toasts "not mocked / Electron feature": folder pickers, sign out, pop-out windows, vault relocation, update check.
- Agent runs (Writing Assistant scans, Brainstorm replies, Scene Crafter drafts) — the prototype scripts the responses; wire to the real agent pipeline.
- Persistence — the prototype keeps state in memory; the app persists to the vaults per DESIGN-SPEC.

## Process

Same as PROCESS.md: write this up in-repo as the release goal with an end-to-end plan, then build; PRs as you go; ping Skyy only when blocked on a merge. Screenshot every surface against the prototype before calling it done — the P0 list above is exactly what a screenshot diff would have caught.
