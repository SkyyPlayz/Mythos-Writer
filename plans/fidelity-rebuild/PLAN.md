# Mythos Writer — Fidelity Rebuild Plan

**Target:** the next beta after v0.5.0. Working name: **Fidelity Rebuild**.
**Goal in one sentence:** the app matches the Liquid Neon prototype exactly — same layout, same chrome, same behaviour on every surface — except for the owner exceptions listed in §1.
**Repo home after sign-off:** `plans/fidelity-rebuild/PLAN.md` (this document, committed verbatim).
**Prototype of record:** the owner's **2026-07-30 07:09 export** — **859,135 bytes, md5 `66fe4a2a0ec8…`** — plus `support.js` (61,032 bytes, unchanged), committed in Phase 0 at `plans/design-handoff/v2/prototype/`. This export contains the **dual-diamond margin ruler** (M1 row 6) and the **AI master toggle / manual mode** (M11). The 850,695-byte copy in the repo is superseded. P0.1 accepts a prototype only if its render shows both diamond pairs on the ruler **and** the AI-features toggle at the top of Settings → AI Agents. Nothing else is the prototype.

---

## §0 Authority stack — how to resolve ANY ambiguity

When two sources disagree, the higher one wins. There is no fifth source. "I thought it looked better" is not a source.

1. **Owner rulings** (§1 of this document — verbatim from Skyy, 2026-07-30)
2. **This plan's milestone specs** (§4)
3. **The prototype, rendered and clicked** (never a screenshot from memory, never a stale copy)
4. **Obsidian's actual behaviour** — for Notes-workspace *behaviour* only

If a case is genuinely not covered by any of the four: **stop and ask Ivy.** Do not guess. Do not invent. A wrong guess here is how the last three weeks of drift happened.

**Out of scope for the entire plan:** colors, palette, theme values. The app and prototype may render different color sets — that is a settings choice, never a defect, never a fix. No PR in this plan may change palette tokens.

---

## §1 Owner rulings (verbatim scope law)

These override the prototype where they conflict with it.

| # | Ruling | Consequence |
|---|--------|-------------|
| R1 | **Split-screen is KEPT.** The app's split-screen works better than the prototype's. | Never regress it toward the prototype. It survives every milestone. |
| R2 | **Notes workspace behaves like Obsidian**, looks like the prototype. Especially per-pane tab strips. | Obsidian = behaviour authority for Notes. Prototype = appearance authority. |
| R3 | **Emoji are allowed** in user content and in note/folder **names**. | The names bug (works in body, fails in name) is a defect to fix — M8. |
| R4 | **Rail icons are drawn icons**, not emoji. | Replace `✍ 📝 🗂️ 💡 📅 🕸️` with line icons matching the prototype — M5. |
| R5 | **Both sidebars match the prototype.** The pop-out/re-organizable panel system is buggy and is removed. | Story Navigator / Entity Browser / Vault Browser panel stack, `+ Add Panel`, `⧉ ⊞ ×` controls, `N F E` toggles, `⬜⬜ Custom ▾` layout presets: all removed — M6. |
| R6 | **Part tier exists**, and Parts and Chapters each own a prose slot that is not a scene (Sanderson epigraph model). | Document model change — M2. |
| R7 | **Create story → immediately writable.** Scaffold chapter+scene with the story; default to Full Book view. | M3. |
| R8 | **Iconize-style icons**: notes and folders can carry an icon separate from their name. | New feature — M8. |
| R9 | **Everything on the same render path.** One editor shell for all depths; no surface gets its own divergent chrome. | The architectural core — M1, M4, M5. |
| R10 | **Margin slider on the ruler** (owner prototype edit, 2026-07-30): second diamond pair, locked to the page pair. | M1 row 6. |
| R11 | **Manual mode**: a master toggle at the top of Settings → AI Agents hides every AI feature app-wide; the app looks and feels the same; everything remains doable by hand. | M11 + a cross-cutting rule on every AI-bearing milestone. **Scoping was delegated to Ivy — decision: build it into THIS beta** (rationale in M11). |

**Keep-list (features that exist in the app but not the prototype, and MUST survive):**

- K1 Split-screen editing (R1)
- K2 Three beat-sheet templates in Structure (Save the Cat 3-Act / Three-Act / Hero's Journey)
- K3 Book narration player (7 voices, ±10s, speed, From start)
- K4 Coach skill meters (Dialogue / Pacing / Description)
- K5 `+ Chapter` / per-chapter `+` add-affordances in Structure
- K6 Entity Browser (relocated, not deleted — see M5)
- K7 "Story Timeline DEMO" labelling convention for demo content
- K8 High-contrast accessibility overrides (`[data-contrast="high"]` opaque surfaces are intentional)

Deleting a keep-list item, or reducing its function, is an automatic carve-out: the PR stops and goes to Ivy. No exceptions.

---

## §2 The three architecture defects this plan is built around

Everything cosmetic in the audit traces to one of these. Fix the root; the symptoms close without being individually touched.

**A. Two editors.** `DesktopShell.tsx` renders Full Book (`:5071`) and Chapter (`:5109`) through `ManuscriptView`, but Scene (`:5143`) through a separate legacy tree (`DocHeader` + `PageChromeToolbar` + snapshot strip + `MarginRuler` + `BlockEditor`), and Part through nothing at all. Every editor chrome defect lives only on the scene path. → **M1**

**B. Settings paints over the ambient layer.** The app's entire atmosphere is one `BackgroundStack` mounted at `DesktopShell.tsx:4569`. `.settings-overlay` (`SettingsPanel.css:9`) covers it with opaque `var(--bg-canvas)` at `inset:0; z-index:1000`. The glass panel above it is correctly translucent — with nothing behind it. → **M4**

**C. One navigation state, two UIs.** `type NavRailModuleId = AppTab | 'crafter' | 'timeline' | 'graph'` (`global.d.ts:695`): three rail items are aliases into sub-views instead of destinations. Hence Scene Crafter and Timeline appear in both the rail *and* the editor sub-tab strip, and Vault Graph lands inside the Notes vault. → **M5**

**Standing rule derived from history (the GAP P0 #4 incident):** a PR that fixes a *symptom* by adding a conditional render path, depth-specific chrome, or a second copy of a component is **rejected in review regardless of how it looks**. The fix for duplication is unification, never divergence. The comment at `DesktopShell.tsx:4887` is the tombstone of the last time this rule didn't exist.

---

## §3 Phase 0 — guardrails (before any UI code merges)

**P0.1 — Make the prototype runnable in-repo.**
- **DONE at handover (Ivy, 2026-07-30):** the 859,135-byte export, `support.js`, vendored `react@18.3.1` / `react-dom@18.3.1` / `@babel/standalone@7.29.0`, a README, and `MOVED.md` stubs replacing the two stale copies (`design-handoff/prototype/`, `plans/design-handoff/prototype/`) are committed. The export was render-verified: dual-diamond ruler ✓, AI master toggle ✓.
- **Remaining team task:** patch `support.js`'s loader to prefer the vendored local files over unpkg so the prototype renders fully offline; verify by rendering with network blocked.

**P0.2 — Commit the fidelity harness.**
- **Ivy committed the proven working scripts at `plans/fidelity-rebuild/harness/` at handover** — they are the reference implementation (they produced every capture in the audit). Team task: wire them into `e2e/fidelity/` with repo-relative imports (`import { chromium, _electron } from 'playwright'`), repo-relative output dirs, and no absolute host paths.
- npm scripts: `fidelity:proto`, `fidelity:app`, `fidelity:both`.
- Harness rules learned the hard way (encode as comments): never click selectors matching `Close`/`aria-label*="lose"` (kills the Electron window); dismiss the vault-format modal (`Not now`) before first navigation; verify navigation landed via the `--active` class; don't pipe the runner through `head`.

**P0.3 — The fidelity gate (Definition of Done change).**
Every PR in this plan must attach **side-by-side screenshots** (app surface vs same prototype surface, same color set) in the PR body, and every milestone closes with an Ivy fidelity pass against the rendered prototype. "CI green" alone closes nothing in this plan.

**P0.4 — VR baseline discipline.**
Milestones will legitimately change most visual baselines. Baselines are regenerated **once per milestone, in a dedicated PR containing only baselines**, with the side-by-side shots as justification. Baseline changes smuggled into feature PRs are rejected.

**P0.5 — Quick hygiene (small independent fixes, may merge any time in Phase 0):**
- The **"New vault format available" modal must never appear over the UI on boot** stealing the first click. Convert to a non-blocking banner at the bottom of the Notes sidebar with the same two actions.
- Everywhere the UI currently displays a raw vault directory name (`MythosVault-xxxx`) as a workspace/header title, display the **story title** (single-story vault) or project name instead. The directory path appears only in Settings → Vault & Files.

---

## §4 Milestones

Format per milestone: **Root cause → Exact spec → Out of scope → Acceptance criteria → Tests.** Acceptance criteria are checkboxes; every box must be literally true, verified in the running app, before the milestone closes.

**Cross-cutting rule (R11):** every milestone that rebuilds a surface containing AI elements implements **both states** — AI on and AI off — from the start, reading the single master setting (M11a). Its fidelity side-by-sides include an AI-off shot, compared against the prototype with the toggle off. Retrofitting the off-state later is exactly the double-touch this plan exists to avoid.

---

### M1 — One editor shell for all four depths

**Root cause:** §2-A.

**Spec:**
1. `ManuscriptView` becomes the *only* editor renderer. The depth ternary in `DesktopShell.tsx` collapses to a single `<ManuscriptView story… scope={viewDepth}>` where scope ∈ `book | part | chapter | scene`.
2. Add the `part` scope: renders one part — part heading, part note, its chapters (each with chapter heading, chapter note, scenes). Until M2 lands the data model, `part` scope may ship behind the M2 flag rendering the whole story's chapters ungrouped — but the branch and button exist from M1.
3. `scene` scope renders exactly one scene's blocks through the same component, same chrome, same page. Editing capability is identical at every depth (ManuscriptView's paragraph handlers already provide this — this also closes "you can only type in scene view").
4. **Delete from the render tree** (not hide — delete the mount): the legacy scene branch at `:5143`, `DocHeader` usage there, always-on `PageChromeToolbar` strip, `scene-snapshot-toolbar` ("Save snapshot now" / "History" row), the second `MarginRuler`, the `75%/100%/125%/Fit` zoom row, the `N F E` toggles and `⬜⬜ Custom ▾` control (R5), and the `DepthSlider` special-case at `:4891`. Components that remain referenced elsewhere may keep their files; nothing may keep mounting them in the editor.
5. Where their *functions* live now:
   - Page setup → the existing `PageSetupPopover` (`DesktopShell.tsx:5163`), opened from a page chip in the format toolbar. The popover is already built; wire it, delete the strip.
   - Save snapshot / History → the title-row `⋯` menu + the Drafts control. Autosave note ("Snapshot saved …") → status bar Saved indicator.
   - Zoom → not a chrome row. Page width is the slider in the status bar + dragging the ruler diamonds (prototype behaviour).
   - Scene status (In Progress / Review / Final buttons) → **one chip** on the title row (the `Draft ▾` position), cycled by clicking the scene's status dot in the navigator or the chip itself. The three-button row is deleted.

**The canonical chrome inventory.** At *every* depth, the editor column renders exactly these rows, in this order, and nothing else. Only row 3's text and the page content change with depth:

| Row | Contents (left → right) |
|-----|--------------------------|
| 1 | Document tab strip: open docs as tabs, each `● Title ✕`, then `+`. Right: agent status ("All agents idle") |
| 2 | Sub-tabs: `Editor · Coach · Structure · Book` (four — see M5) |
| 3 | Title row: depth chip + title + ☆ — Full Book: story title, no chip · Part: `PART ONE` chip + part title · Chapter: `CHAPTER 2` chip + chapter title · Scene: `SCENE 2` chip + scene title. Right: status chip (`Draft ▾`) · word count · 💬 comment count · `Drafts` · `Focus` · `⋯` |
| 4 | Depth row: `‹` `[Full Book | Part | Chapter | Scene]` `›` + breadcrumb (`Story › Part › Ch. N: Title › Scene`). All four depth buttons always visible, never collapsed to scroll arrows |
| 5 | Format toolbar: `Body Text ▾` (Body/H1/H2/H3/Quote) · font `Lora ▾` (Lora/Georgia/Palatino Linotype/Inter) · size `− 12 +` · line-height `▾` (1.15/1.3/1.5/1.85/2/2.5/3/3.5/4/5/6) · `B I U S` · align ×4 · list/indent ×4 · `+ Part` `+ Chapter` `+ Scene` · page chip (opens PageSetupPopover). Right: `Read · Dictate · Coach` |
| 6 | **One ruler, two diamond pairs on the same track** (owner edit 2026-07-30): the **outer pair** drags page width; the **inner pair** drags margins. The two are **locked**: margins are stored as absolute px, so dragging the page diamonds moves the page edges and carries the margin diamonds with them — the margin px value never changes when the page resizes (exactly how it behaves today, now with a ruler handle). Dragging a margin diamond adjusts the margin symmetrically. During any diamond drag, a live-value badge shows at the page's top corner (e.g. `170 px margin`). Both diamond pairs write the same prefs as `PageSetupPopover`'s width/margin controls — two controls, one pref, always in agreement (same contract as the existing GH #842 width slider) |
| — | The page: centered, default width 1000px, text **directly on the page surface** (the inset dark inner box is deleted), drop cap on the first paragraph of each scene, `+ CHAPTER NOTE` / `+ PART NOTE` affordances (M2), comments gutter docked right of the page at every depth |
| — | ONE status bar: `‹ Prev · Next ›` · breadcrumb · words · characters · read time · `Page N px · margin N px — drag the ruler diamonds` · status chip · goal chip (`0 / 500 today`) · `Saved …` with pulse dot · `Synced`. The second stat row is deleted |

Duplication rules, verified literally: breadcrumb appears **once** (row 4) plus once in the status bar; `Drafts` appears **once**; the current title appears at most **twice** (tab + row 3) plus the page heading; **one** ruler; **one** status bar.

**Split-screen (K1) under the unified shell:** split is entered from a tab's context menu ("Open to the side") and the existing shortcut; each pane is a full instance of rows 3–6 + page; the tab strip is **per-pane** (R2 pattern). The `⬜⬜` toggle and `Custom` presets are gone; split itself must demonstrably still work (E2E below).

**Out of scope:** part/chapter note *data* (M2 — render affordances may be feature-flagged until M2), sub-tab reduction (M5), sidebar contents (M6).

**Acceptance criteria:**
- [ ] Switching Full Book → Part → Chapter → Scene changes only row-3 text and page content; a pixel-diff of the chrome region between depths shows no layout change
- [ ] Typing works at all four depths on the same component; edits at Full Book depth persist and appear at Scene depth
- [ ] Every deleted element from spec #4 has zero mounts (grep + runtime assert in E2E)
- [ ] `PageSetupPopover` opens from the page chip; changing width/margins/font applies live; the strip does not exist
- [ ] Ruler has both diamond pairs; dragging page diamonds resizes the page with margin px unchanged; dragging margin diamonds adjusts margins; drag shows the live-value badge; ruler and popover stay in sync both directions
- [ ] One scene status chip; cycling from navigator dot and from chip both work and persist
- [ ] Prototype side-by-side attached for all four depths at 1920×1080
- [ ] Split-screen: open-to-side produces two panes, both fully editable, both with their own tab strip

**Tests:** E2E — depth-switch chrome invariance (DOM row snapshot per depth); edit-at-every-depth → disk round-trip; split-screen open/edit/close; status-cycle persistence. Keep the existing selector-compat anchor classnames (`book-outline-view`, `chapter-continuous-view`) on the unified wrapper — CI depends on them.

---

### M2 — Document model: Parts + part/chapter note slots  ⚠️ owner sign-off gate

**Root cause:** R6. The model has no Part tier and no prose slots above scene level.

**Spec:**
1. Manifest schema: `story.parts[] → { id, title, order, note: Block[], chapters[] }`; `chapter` gains `note: Block[]`. Scenes unchanged.
2. **Migration** (vault-data migration → per standing policy SKY-6626 this requires explicit Ivy/owner sign-off before merge, even with green CI): existing stories are wrapped in a single Part with `title: ""`. Migration is idempotent, lossless, and covered by a fixture round-trip E2E (old vault in → migrate → every block byte-identical, re-run → no-op). `paperclipai`-side: back up before first run on a real vault.
3. **Rendering rule for the single-untitled-part case:** a story whose only part has an empty title renders **no part heading and no part-note affordance** — simple stories stay clean. Creating a second part, or titling the first, turns part rendering on. `+ Part` in the toolbar (row 5) does exactly this.
4. Note slots render as the prototype does: filled → epigraph block (italic, centered, distinct from body prose) above the chapters/scenes; empty → `+ PART NOTE` / `+ CHAPTER NOTE` affordance, clickable, edits inline through the same editor. Visible at every depth that composes that level (chapter note shows at book/part/chapter depth; part note at book/part).
5. Navigator tree becomes Story → Part → Chapter → Scene (untitled single part renders its chapters at top level). Structure view groups cards under `PART ONE / PART TWO` headers. Book compile renders `PART ONE` + part title pages, part notes, chapter notes.
6. Book compile heading rule: `CHAPTER N` label is generated; a chapter *title* beginning `Chapter N:` has that prefix stripped for display (fixes `CHAPTER 1 / Chapter 1: The Quiet Before`). Add the author byline under the story title (from a `story.author` field; empty → omitted).
7. Structure cards gain a `POV` chip sourced from a new optional scene property `pov` (editable in the scene ⋯ menu and Scene Analysis panel); unset → no chip.

**Acceptance criteria:**
- [ ] Fixture vault (pre-Part format) migrates losslessly; re-migration is a no-op; sign-off recorded on the PR by Ivy/owner before merge
- [ ] Prototype's Full Book composition reproduced exactly with sample data: `PART ONE · Ash and Oath → part epigraph → CHAPTER 1 → chapter epigraph → scenes`, `+ CHAPTER NOTE` on note-less Chapter 2, `+ PART NOTE` on note-less Part Two
- [ ] Single-untitled-part story shows no part chrome anywhere (editor, tree, Structure, Book)
- [ ] Book compile: part headings, stripped chapter numbers, byline, `◆ ◆ ◆` separators (existing), END OF DRAFT (existing K-list item)
- [ ] Part depth (M1's branch) now renders real parts

**Tests:** migration round-trip E2E (UI→IPC→disk per company standard, not mock-only); note-slot create/edit/persist at each depth; compile snapshot test.

---

### M3 — Create story → instantly writable

**Root cause:** R7. Today: create story → no writing surface until chapter and scene are manually created.

**Spec:** the create-story action (any entry point: onboarding, `+` in navigator, File menu) creates in one transaction: story + Part 1 (`title:""`) + `Chapter 1` + one untitled scene → opens Story Writer → **Full Book depth** → caret placed in the empty scene's first paragraph → placeholder text "Start writing…". No dialog, modal, toast, or Getting Started panel may interpose between the click and the caret. The story title is editable inline in row 3 (Full Book depth title = story title).

**Acceptance criteria:**
- [ ] E2E: click create → `page.keyboard.type("hello")` → text is on disk in the new scene, with zero interposed clicks
- [ ] New story lands at Full Book depth every time
- [ ] All create-story entry points behave identically

---

### M4 — Settings: transparent overlay, live ambient background

**Root cause:** §2-B.

**Spec:**
1. `.settings-overlay` → `background: transparent` (the shell's `BackgroundStack` stays visible; the wallpaper, particle drift, scrim and vignette read through the glass). `.settings-panel` keeps `--glass-fill` + backdrop blur. Focus trap, `role`/`aria-modal`, and Esc-to-close unchanged. High-contrast mode (K8) keeps its opaque override.
2. Appearance tab honors its own subtitle ("every change applies live"): appearance changes apply live with `Reset appearance to defaults` (prototype behaviour); the `Cancel / Save` footer is removed **for the Appearance tab only** — tabs with credentials or destructive actions keep explicit save.
3. Layout matches the prototype's three-column workspace: left section rail · content · live preview column. (The app already has the structure — this is styling, not rebuild.)

**Acceptance criteria:**
- [ ] Open Settings over the editor: the animated background is visibly moving behind the glass (screenshot + a video frame-diff in E2E: two frames 2s apart inside Settings differ in the background region)
- [ ] Appearance slider changes reflect in the app behind the panel in real time, no Save
- [ ] Esc closes; focus trap holds; high-contrast mode still renders opaque
- [ ] Side-by-side vs prototype Settings attached

---

### M5 — Navigation: rail and sub-tabs become orthogonal

**Root cause:** §2-C.

**Spec:**
1. Retire the alias type. Rail destinations, in order: **Story Writer · Notes Editor · Scene Crafter · Brainstorm · Timeline · Vault Graph**, then workspace switcher (`MV / SW / +` avatars wired to the existing project switcher), then **Settings** and the collapse control at the bottom. Labels always visible; slim mode is a user toggle, never per-view.
2. **Drawn icons** (R4): line-icon set matching the prototype's visual weight. Emoji glyphs removed from the rail. (Emoji remain legal everywhere in user content.)
3. Editor sub-tabs reduce to **Editor · Coach · Structure · Book**. Scene Crafter and Timeline no longer appear as sub-tabs — they are rail destinations only. Deep links that used those sub-tabs route to the rail destination with story context preserved.
4. **Vault Graph is a standalone destination** (prototype: full-screen graph, category legend with counts, `N notes · M links` footer, zoom controls). The Notes workspace's internal `Editor/Graph/Entities` mode strip is removed; the graph has one home.
5. **Entity Browser (K6) relocates, not deletes:** it becomes an openable document type — available from the tab strip's `+` picker and the Insert menu, opening as a tab in any pane (Notes or Story). It is no longer a sidebar panel or a mode.
6. Rule enforced from here on: **no surface appears in two navigation systems.** One home per surface.

**Acceptance criteria:**
- [ ] `NavRailModuleId` no longer contains sub-view aliases; type-level check
- [ ] Rail matches the prototype inventory + order exactly (side-by-side)
- [ ] Sub-tab strip shows exactly four items at every depth
- [ ] Vault Graph from the rail opens the standalone graph with legend and footer
- [ ] Entity Browser opens as a tab from `+`; all its existing functions work there (K6)

---

### M6 — Sidebars to prototype spec (both sides)

**Root cause:** R5 — panel system removed.

**Spec — left sidebar (Story Writer):** exactly the prototype's three zones:
1. **Story card**: story icon, title, `Genre · N words`, progress bar, collapse `«`.
2. **STORY NAVIGATOR** label + `+` + collapse, then the tree (Part → Chapter → Scene; scene rows show `Scene N · Title`, word count, status dot; status dot click cycles status per M1).
3. **PROJECT footer**: `Words / Scenes / On Track%` stat trio.
Removed entirely: the collapsible panel stack (Story Navigator / Entity Browser / Vault Browser as panels), `+ Add Panel`, per-panel `⧉ ⊞ ×`, drag-reorder of panels. (Entity Browser lives on per M5.5; Vault Browser's function = the Notes workspace sidebar, which is its one home.)

**Spec — right sidebar (Story Writer):** prototype inventory, top to bottom:
1. Tabs: `Assistant · Scenes · Notes · References` (contents of the last three per M9).
2. **AGENTS**: four rich cards — name, live status line (`Ready` / `Watching session` / `2 flags open` / `2 reactions · Ch. 2`), status dot, chevron into detail.
3. **Suggestions**: source badge (`WRITING COACH`), count, up to three cards, `See All Suggestions`.
4. **Scene Analysis** (BETA): Purpose / Tension / Pacing / POV / Word Count / Read Time + one-line note + `View Full Analysis`.
5. **Continuity**: **one** header (delete the duplicate — `GlobalRightSidebar.tsx:22` section header vs `ContinuityPanel.tsx:241` internal title; exactly one survives).
6. **Research Quick Links** collapsed row.
7. **Getting Started** becomes a dismissible card at the top of the Assistant tab. It never occupies the panel, never hides the tab strip, and its dismissal persists.

**Acceptance criteria:**
- [ ] Left sidebar renders the three zones and nothing else; no panel controls exist in the DOM
- [ ] Right sidebar order matches the list above; one Continuity header (DOM assert)
- [ ] Fresh profile: tab strip visible immediately; Getting Started is a card inside Assistant
- [ ] Side-by-sides for both sidebars attached
- [ ] Split-screen still fully functional after panel-system removal (K1 E2E re-run)

---

### M7 — Editor detail polish (on the unified shell)

Everything here assumes M1's shell; none of it may reintroduce a second path.

**Spec:**
1. **Comments gutter** docked right of the page at every depth: agent/user comments anchored to phrases, inline highlight in the prose, count chip on row 3 opens/closes it. (Component exists — `story/CommentsGutter.tsx`; wire it on the ManuscriptView path.)
2. **Drop cap** on the first paragraph of each scene (prototype styling).
3. **Coach tab**: add the missing **"This week's focus"** lesson block — title, explanation that quotes the writer's own text, three `→` action bullets, and a Drill line — above the canned prompts. Skill meters (K4) stay.
4. **Structure tab**: Part group headers (M2), POV chips (M2 field), keep K2/K5.
5. **Document tab strip** (row 1) full behaviour: multiple docs open as tabs (scenes, notes, boards, entity browser), drag to reorder, drag between panes (split), right-click menu: `Open to the side · Pop out · Close`. Middle-click closes.
6. Typography/spacing pass to the prototype's page: measure, paragraph spacing, heading scale — verified by side-by-side, not by eye.

**Acceptance criteria:**
- [ ] Comments visible + anchored at all four depths; count chip toggles gutter
- [ ] Coach shows a populated weekly-focus block (real data from the coach agent when enabled; designed empty state when not)
- [ ] Tab strip: reorder, cross-pane drag, context menu all pass E2E
- [ ] Full-editor side-by-side is pixel-close (fidelity pass judgment call by Ivy, criteria = a reviewer cannot instantly tell which is which at arm's length)

---

### M8 — Notes workspace: Obsidian behaviour, prototype look

**Spec:**
1. **Per-pane tab strips** (R2's headline): every pane owns a tab strip — tabs with `✕`, `+`, overflow `▾`, per-pane `⋮` menu, drag tabs between panes. Behaviour reference: Obsidian. Appearance reference: prototype row 1.
2. **Sidebar** to prototype inventory: vault picker (`Notes Vault ▾`), search, folder tree with **per-folder counts on every folder**, **drawn** folder/file icons (not emoji), `RECENT NOTES` (three entries, relative timestamps), footer `N notes · synced`. The `Drop here to move to vault root` strip appears only during a drag.
3. **Note editor surface** to prototype inventory: breadcrumb path + `Edited just now ✓` + Share; title + star; tag chips + `+`; toolbar (`Paragraph ▾ · B I U · code · link · table · list · quote · Read · Dictate` + `Rich Text / Source` toggle); callout blocks render styled (frontmatter never renders as body text — GAP P0 #2); `[[wikilinks]]` render as chips; `Linked Notes` section; footer `N words · N characters` + `Add tag…`.
4. **Fix vault seeding** (GAP P0 #1): seed the default layout **once** (marker file or DB flag); never recreate on boot; story-vault internals never appear in the Notes tree; existing user folders/notes are never shadowed by re-seeding. (This bug also blocked this audit's own test vault — fixture-based E2E must prove seeded external notes appear.)
5. **Emoji in names** (R3): note/folder names accept full Unicode including emoji; the only forbidden characters are the OS-reserved set (`\ / : * ? " < > |`). Root-cause the current name-sanitization (body works, names fail — so the bug is in the filename/slug path), fix it, and cover with **native Windows CI** tests: create, rename, open, wikilink-to, and display an emoji-named note and folder (tree, tabs, breadcrumbs, links). Guard against the known Windows path-separator regression class (SKY-8881) while in this code.
6. **Iconize-style icons** (R8): right-click note/folder → `Set icon…` → picker (drawn icon set + emoji). Stored in vault metadata (`.mythos/icons.json`, path-keyed, updated on rename/move) — **never** encoded into the filename. Shown left of the name in tree, tabs, and breadcrumbs. Removing the icon restores the default drawn icon.
7. Notes empty state gets the prototype pattern: glyph + one-line hint + primary action button.

**Acceptance criteria:**
- [ ] Obsidian-parity tab checks pass per pane: open/close/reorder/drag-across/overflow
- [ ] A vault seeded with external folders/notes shows them all; relaunch ×3 → no duplicates, no re-seed (DOM + disk assert)
- [ ] `🌊 Folder/🔥 Note.md` works end-to-end on native Windows CI
- [ ] Icon assignment survives rename, move, and app restart; filename on disk unchanged
- [ ] Frontmatter never renders in Rich view; callouts styled
- [ ] Side-by-sides: sidebar, note surface, tabs — attached

---

### M9 — Right-panel features (Story Writer)

**Spec:**
1. **References tab**: wiki-links in the manuscript auto-collect here with typed roles — `Location · pinned`, `Character · POV`, `System · unresolved link`, `Location · hub`. **Unresolved** = the link target doesn't exist in the vault; rendered as a flagged state. Clicking a reference opens it (existing note) or offers creation (unresolved).
2. **Notes tab**: SCENE NOTES pinned to the open scene; `Add`; drag a note onto the navigator to promote it to the vault (prototype copy: "Pinned to this scene — promote a note to the vault by dragging it onto the navigator.").
3. **Scenes tab**: canvas boards drafted in Scene Crafter appear here; empty state per prototype ("No canvas boards yet. Draft one in the Scene Crafter and it appears here.").
4. **Continuity flags**: rich cards with scope tag (`Story ↔ Vault` / `Vault internal` / `Timeline`), the conflicting detail spelled out, and three per-flag actions: `Edit notes to match · Suggest story change · Ignore`.
5. **Notes-side agent panel** gains its chat input (`Tell me about your world — I'll file it…`) per prototype.

**Acceptance criteria:**
- [ ] Typing `[[New Thing]]` in prose → appears in References as unresolved; creating the note resolves it live
- [ ] Scene note: add, persist, drag-promote to vault (real E2E to disk)
- [ ] Continuity flag actions each do what they say against a seeded conflict fixture
- [ ] Side-by-sides attached

---

### M10 — Remaining surfaces to prototype spec

Same rules, thinner detail here because the prototype captures in `e2e/fidelity/` are the spec — each item below names its authoritative capture.

1. **Brainstorm** (`rail-brainstorm` capture): IDEA COLLECTIONS rail with counts (All Ideas / Story Beats / Characters / World & Lore / Themes / Tropes / Loose Ideas); Agent Chat + Board tabs; chat extracts facts to the vault; "Ideas the agent captures land in your Notes Vault and appear here" flow; genre preset control appears once.
2. **Timeline** (`rail-timeline` capture): TIMELINE NAVIGATOR (books with chapter ranges + estimated days); named plotlines with counts; era bands (AGE OF ASH / THE VEIL / RECKONING); `you are here · Ch N` marker; POV track; `Today` jumps + toasts; View/Group/Show selects actually re-group; all five modes render from one event source. Keep K7 demo labelling.
3. **Scene Crafter** (`rail-scene-crafter` capture): SUGGESTED CARDS rail grouped CHARACTERS / LOCATIONS / ITEMS & SYSTEMS, initialed cards with hook lines, click-or-drag onto the board, agent keeps the list stocked from the vault.
4. **Brainstorm Clusters/Map, empty states, scrollbars app-wide** (GAP P1 #6, P2 #11–12): thin styled scrollbars globally; glyph+hint+action empty states everywhere.

Each ships with the standard fidelity gate. Decomposition into issues is the CEO's call within this scope.

---

### M11 — Manual mode (AI master toggle)  · R11

**Why this beta and not the next (Ivy's delegated call):** this plan already rebuilds every AI-bearing surface — editor chrome (M1/M7), both sidebars (M6), notes panels (M8/M9), Brainstorm/Timeline/Crafter (M10). Waiting a beta means touching every one of those files a second time to retrofit an off-state; building the state in while each surface is being written costs a fraction of that. And the prototype of record now *contains* the toggle — building "exactly to the prototype" while skipping a feature in it would reopen the interpretation gap this plan exists to close. Rendered and verified 2026-07-30: the prototype's manual mode works and is the spec below.

**M11a — plumbing (lands immediately after Phase 0, before or parallel with M4):**
1. One master setting `ai.enabled` (default **on**), stored with app settings, exposed through a single provider/hook every surface reads. It sits **above** the existing per-agent enables: master off beats everything; master on defers to per-agent settings.
2. Settings → AI Agents page: the toggle at the **top**, with the prototype's exact copy: *"Turn this off and every AI surface disappears — the Coach, the agent panels, Brainstorm chat, continuity flags, beta reads and AI suggestions. Nothing is sent anywhere. Every tool stays fully usable by hand."* Toggling shows the prototype's toast (*"AI features off — every tool is now manual"* / *"AI features back on"*) and a persistent *"Manual mode is on"* indicator on the page. The rest of the AI Agents page (provider, keys, models, per-agent pages) remains visible but inert while off.
3. Master off also **stops the machinery**, not just the chrome: no agent scans, no scheduled AI work, no network calls to providers ("Nothing is sent anywhere" is a testable claim).

**M11b — the manual-mode surface contract** (verified from the rendered prototype, toggle off — this table is the spec; the rendered prototype settles anything it doesn't cover):

| Surface | AI on | AI off |
|---|---|---|
| Editor sub-tabs | Editor · Coach · Structure · Book | Editor · **Structure · Book** (Coach gone) |
| Format toolbar right | Read · Dictate · Coach | **Read · Dictate** (they are accessibility/utility, not AI — they stay) |
| Right-panel tabs | Assistant · Scenes · Notes · References | **Scenes · Notes · References** (Assistant gone) |
| Agent cards / Suggestions / Scene Analysis | Present | **Gone** (right panel collapses cleanly, no dead bands) |
| Comments gutter | Agent + human comments | **Human comments only** (agent comments hidden, not deleted — they return when AI returns) |
| Notes right panel | Agent · Properties tabs, continuity flags, chat | Continuity flags, chat, agent panel **gone** |
| Brainstorm | Agent chat + Board | Board and idea collections remain manual; chat gone |
| Timeline | Suggest-with-AI affordances | Affordance gone; all manual editing remains |
| Data | — | Nothing AI-generated is deleted by toggling; hidden content reappears intact when re-enabled |

**M11c — completeness audit (closes at the end, after M10):** walk every flow with AI off and verify a manual path exists for everything a user could previously achieve (create/edit/organize/compile/export, notes, timeline, boards). Any flow achievable only through an AI feature is a defect — file and fix before the beta closes.

**Acceptance criteria:**
- [ ] Master toggle exists with the exact prototype copy, toast, and indicator; per-agent enables still work under it
- [ ] Toggle off: every row of the surface contract verified in the running app; layout identical minus AI elements (side-by-sides vs prototype-off attached, per surface)
- [ ] Network assert: with master off, zero requests to any AI provider across an E2E session that touches every workspace
- [ ] Toggle off → on: all AI content (agent comments, suggestions, flags) reappears intact
- [ ] M11c audit recorded: list of flows checked, each with its manual path

**Tests:** E2E both-state walkthrough per workspace; settings persistence across restart; network-silence assert; agent-comment hide/restore round-trip.

---

## §5 Sequencing

```
Phase 0  ──────────────────────────────  (all of it before any milestone merges)
Lane A (editor core):    M1 → M2 → M3 → M7
Lane B (shell):          M11a → M4 → M5 → M6
Lane C (notes):          M8 → M9
Lane D (rest):           M10 (after M5, else sub-tab churn)
Close-out:               M11c completeness audit (after M10)
```

- **M11a lands first in Lane B** so every subsequent milestone can read the master setting while building its surface (cross-cutting rule, §4 intro).

- **M4 is the quick win** — one CSS root cause; may merge the moment Phase 0 closes.
- **M1 merges before M5/M6 start.** All three rewrite `DesktopShell.tsx`; serializing them is cheaper than the merge conflicts (green-in-isolation ≠ green-together applies with force here).
- **M8 runs parallel to Lane A** (different files) but its per-pane tab strip lands *after* M1 defines the tab-strip component, which both reuse.
- **M2 cannot merge without the sign-off gate.** Plan the owner ping ahead so it doesn't stall the lane.
- Trunk rules apply throughout: small PRs, off-by-default flags for anything risky, flag removal is part of each milestone's done-criteria.

---

## §6 Premortem — how this plan fails, and the rule that prevents it

| # | Failure mode (it's 6 weeks later and…) | Standing prevention |
|---|----------------------------------------|---------------------|
| 1 | A "fix" added depth-specific chrome again; the editors diverged back | §2 standing rule: conditional-chrome PRs auto-rejected; Ivy audits every M1-area PR for new ternaries |
| 2 | An agent deleted the narration player / beat templates "to match the prototype" | Keep-list K1–K8 is law; keep-list deletion = automatic carve-out to Ivy |
| 3 | A milestone was built against a stale prototype copy | P0.1 deleted the copies; only one prototype exists and it renders |
| 4 | Everything is "done" and CI-green but looks wrong | P0.3: side-by-side screenshots per PR + Ivy fidelity pass per milestone; CI-green alone closes nothing |
| 5 | The Part migration ate someone's vault | M2 sign-off gate + lossless round-trip fixture E2E + idempotency + backup |
| 6 | Split-screen quietly broke during the panel-system removal | K1 E2E re-runs in M1, M6, M7, M8 acceptance |
| 7 | Emoji names worked on Linux CI, broke on Skyy's machine | M8.5 requires native Windows CI (the SKY-8881 lesson, already institutional) |
| 8 | VR flake storm from mass baseline churn stalled every PR | P0.4: dedicated baseline PRs, once per milestone |
| 9 | DesktopShell merge conflicts burned a week | §5 lane serialization: M1 before M5/M6 |
| 10 | An agent hit an uncovered case and invented something | §0 authority stack, rule: stop and ask Ivy; asking is free, inventing cost us three weeks |
| 11 | E2E selector anchors were deleted with the legacy code and CI collapsed | M1 explicitly keeps compat anchor classnames on the unified wrapper |
| 12 | Manual mode shipped half-tested — some surface still leaked AI chrome, or a flow was impossible by hand | Cross-cutting both-state rule per milestone + M11c completeness audit + network-silence assert |
| 13 | "AI off" hid the chrome but agents kept running and calling providers | M11a spec #3: master off stops scans, schedules, and network — asserted in E2E, not assumed |

---

## §7 False-findings ledger — do NOT re-investigate these

Verified during the audit; re-litigating them is wasted tokens.

- Chapter/Full Book depth **does** compose scenes correctly once a scene is selected — not a bug.
- A document tab strip **exists** (single, global). The gap is per-pane strips (M8), not absence.
- `Dialog.css`'s `rgba(0,0,0,.85)` overlay is `[data-contrast="high"]` only — intentional (K8).
- `MythosMigration.css`'s near-opaque background is a 560px card, not a full-bleed overlay — fine.
- Settings' opaque background is the **only** ambient-covering overlay in the codebase (full-CSS sweep done).
- The 10 prototype color sets mean palette differences are never findings (and palette is out of scope anyway).

---

## §8 Handover protocol (when Skyy says go)

1. Ivy commits this document to `plans/fidelity-rebuild/PLAN.md` and executes Phase 0's P0.1/P0.2 commits (docs + harness; no UI code).
2. Ivy un-parks **SKY-8951**, replaces its body with a pointer to this plan, and re-titles it `ROLLOUT: Fidelity Rebuild — see plans/fidelity-rebuild/PLAN.md`.
3. Ivy unpauses the team.
4. **CEO decomposes**: one epic issue per milestone; child issues per the 5-part task-brief standard, each quoting its spec section *verbatim* and carrying that section's acceptance checkboxes as its done-criteria. No issue may span milestones. No issue may cite any spec other than this plan and the rendered prototype.
5. Lane assignments: FableEngineer (ultracode) on M1, M2, M5, M6; other builders on M3/M4/M7+ per CEO's judgment; QA owns the fidelity-gate checks; native Windows CI required on M8 name-handling work.
6. Ivy retains: M2 sign-off, VR baseline PR approval, keep-list carve-outs, and the per-milestone fidelity pass.

---

## §9 Rulings Ivy made writing this plan

> **APPROVED by Skyy, 2026-07-30 — all seven, with Entity Browser explicitly confirmed as option A (openable tab).** These now carry the same rank as §1. They are not open questions; do not re-litigate them.

1. **Single-part stories render no part chrome** until a second part is created or the first is titled (keeps simple stories clean; `+ Part` turns it on).
2. **Appearance settings apply live** (as the prototype's own copy says); Save/Cancel remains only on tabs with credentials/destructive actions.
3. **Entity Browser survives as an openable tab** (from `+` and Insert menu) rather than a sidebar panel or mode — removal would delete a working feature; sidebar-panel form violates your R5.
4. **Iconize icons store in `.mythos/icons.json`**, never in filenames — survives sync/rename, keeps names clean.
5. **Default page width 1000px** (the prototype's own status-bar value), user-resizable as today.
6. **Book compile strips a leading "Chapter N:" from chapter titles** for display only — disk titles untouched.
7. **Manual mode ships in THIS beta** (the call you delegated). Rationale: every AI surface is being rebuilt in this plan anyway — building the off-state in while writing each surface is far cheaper than a second pass next beta, and the prototype of record now contains the toggle. Also per the rendered prototype: **Read and Dictate stay in manual mode** (utility, not AI), and **human comments stay while agent comments hide**. Veto any part of this to move M11 out.
