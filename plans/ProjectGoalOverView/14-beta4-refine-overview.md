# 14 — Beta 4 "Refine" · Full Project Overview (CURRENT SOURCE OF TRUTH)

> **Status: ACTIVE — this document supersedes docs 00–13 as the product overview.**
> Source design package: [`plans/design-handoff/v2/`](../design-handoff/v2/) — read
> `FULL-SPEC.md` first; the interactive prototype
> (`prototype/Mythos Writer - Liquid Neon.dc.html`) is the pixel- and
> behavior-authoritative reference. **When any doc and the prototype disagree, the
> prototype wins.** Owner decisions recorded 2026-07-10 are folded in below and in
> [`00-decisions-log.md`](00-decisions-log.md).
> The build plan for this release: [`docs/releases/BETA-REFINE.md`](../../docs/releases/BETA-REFINE.md).

## What Mythos Writer is (v1.1 definition)

A desktop (Electron) writing studio for fiction authors. One **Mythos Vault** — a
plain folder of Markdown files the user can put anywhere — holds a **Story Vault**
(manuscripts) and a **Notes Vault** (an Obsidian-compatible worldbuilding wiki).
Around them: a rich heading-zoom manuscript editor, a Plottr/Aeon-class
multi-timeline system, a brainstorm canvas, a knowledge graph, and four AI agents.
Every AI-judged feature has a manual path — a user with zero AI budget can do
everything by hand. Local files are the database; no cloud requirement for core
features.

## The four agents (renames and contracts are binding)

| Agent | Contract |
|---|---|
| **Writing Coach** (was "Writing Assistant") | Teaches the writer using their own pages — lessons, drills, per-chapter suggestions, scene analysis. **Never ghost-writes manuscript prose.** Its only drafting surface is the Scene Crafter first-pass scaffold, which exists to be annotated and rewritten. |
| **Brainstorm Agent** | Curator of the Notes Vault: chat → files notes, builds idea cards, asks questions, pre-fills templates. |
| **Archive Agent** | Continuity (story↔story, story↔vault), fact checks with citations, **auto-builds timelines**, flags → actionable margin comments. |
| **Beta Reader** | First-time-reader reactions: chapter reads, margin reactions, pacing/clarity reports. Reacts emotionally, never edits. |

**Note linking is not an agent job.** It is the deterministic built-in
**Auto Note Linker** (behavioral port of `kdnk/obsidian-automatic-linker`):
trie-matched titles/aliases → `[[wiki links]]`, frontmatter opt-outs, excluded
folders, format-on-save. Badge everywhere: `BUILT-IN · NO AI`.

Agent sessions are universal: every chat surface has a session dropdown
(rename/duplicate/delete, per-agent seeded greeting). The Coach page and Coach
panel chat share one conversation store.

## Data architecture (owner-ratified 2026-07-10)

```
MythosVault/                    ← ONE folder, user-placed (local/Dropbox/network)
  mythos.json                   ← vault id, name, default theme, story list, seed marker
  settings.json                 ← per-vault user settings
  timelines.json                ← all timelines, eras, spans, events, custom rows
  Story Vault/<Story>/
    book.md                     ← compiled order + metadata
    Part 1/Chapter 01/Scene 01.md   ← scene = md + frontmatter {title,status,pov,when}
    drafts/Scene 01.draft-6.md      ← numbered snapshots (files, not DB)
  Notes Vault/…                 ← Obsidian-style .md + frontmatter
```

**The storage rule:** user work lives in the vault as files; SQLite holds only
regenerable machine-local state. Concretely — **comments, draft snapshots, and
agent chat sessions are files inside the vault** (sidecar JSON / numbered draft
`.md`) so they survive vault copy and Dropbox sync. SQLite keeps continuity
flags, budgets, caches, FTS indexes. App-global prefs (window size, last vault)
stay in AppData. Existing v0.4 vaults are converted by a **one-time migration
wizard**; old-structure data (brainstorm card positions, timeline events) is
migrated into the new models before the old structures are deleted.

New vaults are seeded **once** (marker in `mythos.json`) with the demo project
"The Last City of Veynn" so every screen demos itself. Story-internal folders
(scene UUID dirs) must never appear in the Notes tree.

## Design system — Liquid Neon (refined)

Dark glassmorphism over a wallpaper: wallpaper art → scrim → glass panels →
1px neon borders + glow. Six neon slots A–F (left panel/primary · center/wiki ·
right/agents · warm data · cool data · nav rail/timeline). Lora for manuscript
and titles, Inter for UI. Ten presets, each with unique wallpaper art and idle
border animation. Preset import/export as JSON. Per-vault default theme.

**Removed by owner decision (2026-07-10):** the neon window frame ring (no
legacy toggle) and window transparency ("No background" = plain dark backdrop;
the window is always opaque). `PERFORMANCE.md` governs all effects: animations
are transform/opacity only, at most one live backdrop-filter surface, ambient
layers pause when hidden, reduce-motion kills everything in one switch.

## The modules

- **Story Writer** — sub-tabs Editor · Coach · Structure · Book. Heading-zoom
  manuscript (Full Book/Part/Chapter/Scene), single doc-header row + single
  format toolbar, margin ruler with diamond page-width handles, draggable
  paragraph blocks, comments with agent actions, drafts compare/full-diff/load
  with Undo, TTS Reader, provisional scenes, Alt+←/→ scene hops. **Coach page**:
  lesson cards, drills, skill chips, suggestions rail. **Scene Analysis** with
  the release's signature pattern — `COMPUTED · LOCAL · FREE` vs
  `COACH'S READ · AI` — computed analytics always available without a model.
- **Notes Editor** — Obsidian-parity explorer toolbar (template picker, new
  folder, sort cycle, auto-reveal, collapse all), wiki links with hover
  preview + create-on-click, tags/properties/backlinks, Brainstorm-first right
  panel with Archive continuity flags, frontmatter never renders in Rich view.
- **Scene Crafter** — setup form (POV/goal/conflict/beats/tone/length),
  suggested cards from the vault, canvas boards (Obsidian-canvas-style), Coach
  scaffold generation with Insert/Retry/Discard — summaries land on the board,
  never silently into the manuscript.
- **Brainstorm Center** — Agent Chat (default) + **one** Board canvas (Map and
  Clusters modes are deleted): floating category regions, drag-anywhere cards,
  connect tool, inline card edit, starter library (beats, 12 tropes, 6 themes,
  4 sparks), idea collections left panel, live activity/questions/needs-work
  right panel.
- **Timeline** — flagship rebuild. Multiple timelines per vault with
  **embedding** (a span can open another timeline, with mini preview strips),
  per-timeline **custom calendars** (default 12×30×24; e.g. 13×28×18h), time as
  year×10 floats encoded through the active calendar. Modes: Progress
  (default) · Structure · Plotlines (Plottr grid) · Spreadsheet · Tension ·
  Relationships · Subway. Eras, arcs, chapters, plotlines, key events,
  characters, world events, themes, and user-defined **custom rows** — all
  direct-manipulation (drag to move in time, edge-resize spans, exact-time
  picker, auto-stacking lanes). Templates (Three-Act, Save the Cat, Hero's
  Journey) create dashed beat plotlines. Right panel: Inspector · Brainstorm ·
  Archive tabs.
- **Vault Graph** — force-directed star graph, category recoloring, physics
  sliders, hover neighbor-dimming, node inspector.
- **Beta Reader view** — Reports + Chat (opened from the agent hub / Tools
  menu; not on the nav rail).
- **Settings** — full workspace view (not a modal). Rail: Account & profile ·
  Appearance · AI Agents · Editor · Vault & Files · Sync & Backup · Shortcuts ·
  About. AI Agents page includes provider seg, masked key + Test, and a
  `Log in with Claude` button shipped in **connect-later** state (explains that
  account linking is coming; points to the API-key path). Vault & Files leads
  with the Auto Note Linker card.

## Shell

Title bar (44px): logo click = Mythos-vault switcher; real File/Edit/View/
Insert/Tools/Help menus; center search + Ctrl+K command palette; bell feed;
window controls. Nav rail 72px (slim 44px): Story Writer, Notes Editor, Scene
Crafter, Brainstorm, Timeline, Vault Graph + Settings; edit popover to
reorder/hide. Workspace tab strip only on Story + Notes views: document tabs,
provisional `+`, drag down/right to open **split panes**, right-click menu.
Status bar (26px): nav, live counts, page-width hint, status/goal chips, saved
pulse.

## Interaction principles (apply to every surface)

Direct manipulation first · nothing is dead (every control works or explains
itself) · popover backdrops stop propagation · numeric fields keep a raw draft
while focused and commit on blur/Enter · provisional creation discards empties
silently · toasts confirm every action · destructive actions are undoable ·
styled 8px scrollbars everywhere · hit targets ≥24px panels / ≥32px toolbars ·
60fps target with user-tunable blur.

## Quality bars (unchanged from Beta 3 era — still binding)

- CI is part of the spec: `ci`, `build-linux`, `build-macos` green before merge
  (owner decision 2026-07-10 — the handoff's "don't worry about CI" is
  superseded).
- The performance acceptance targets in `design-handoff/v2/PERFORMANCE.md`:
  keystroke→paint <16ms, idle ≈0% CPU, 60fps ambients, no dropped frames while
  typing with agents live.
- The 10-point acceptance checklist in `FULL-SPEC.md` §14 runs before the
  release is called done.

## Release framing

Target: **v0.5.0-beta.1 "Liquid Neon — Refined"**. Sequencing (owner-approved):
**Wave 0** = GAP-REPORT-v2 P0 bugs + remaining PERFORMANCE work, then a **smoke
pass on a packaged build to confirm those fixes land for a real user**, then the
module builds, with demo seed + welcome wizard last. Full milestone plan:
[`docs/releases/BETA-REFINE.md`](../../docs/releases/BETA-REFINE.md).
