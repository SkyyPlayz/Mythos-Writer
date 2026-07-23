# v0.5.0-beta.1 — "Liquid Neon · Refined" — Release Goal & End-to-End Build Plan

> **Source of truth:** [`plans/design-handoff/v2/FULL-SPEC.md`](../../plans/design-handoff/v2/FULL-SPEC.md)
> and the interactive prototype [`plans/design-handoff/v2/prototype/Mythos Writer - Liquid Neon.dc.html`](../../plans/design-handoff/v2/prototype/)
> (**the prototype wins every disagreement**). Companions: `GAP-REPORT-v2.md`
> (what the shipped v0.4.0-beta.1 gets wrong), [`plans/design-handoff/v2/PERFORMANCE.md`](../../plans/design-handoff/v2/PERFORMANCE.md) (why it's slow and
> the fix order — measured baselines and the packaged-trace procedure are in
> [`PERFORMANCE.md`](../../PERFORMANCE.md) at repo root). Owner decisions B4-1…B4-7 in
> [`plans/ProjectGoalOverView/00-decisions-log.md`](../../plans/ProjectGoalOverView/00-decisions-log.md).
> Product overview: [`plans/ProjectGoalOverView/14-beta4-refine-overview.md`](../../plans/ProjectGoalOverView/14-beta4-refine-overview.md).

> **Round-2 rulings (B4-8…B4-11, 2026-07-10):** Suggestion Inbox kept alongside
> autonomy toggles (all OFF + per-category certainty sliders) · Crafter drafts go
> to the scene board, never the manuscript · full BYO providers + multi-provider
> OAuth (connect-later) · monetization roadmap re-included as a parked
> post-Beta-4 track.

## Release goal

Ship the app the approved prototype shows — not approximately, exactly. The gap
between v0.4.0-beta.1 and the prototype has three layers, and this release closes
all of them:

1. **Integrity & speed** — the shipped beta re-seeds the vault every boot, leaks
   scene-UUID folders into the notes tree, renders YAML frontmatter as giant
   headings, duplicates the editor chrome, and pays Chromium taxes (transparency,
   stacked backdrop-filters, paint-storm animations) that make a powerful PC drop
   frames. These are fixed **first**, and verified on a packaged build, before any
   feature work (owner decision B4-7).
2. **Fidelity** — surfaces that exist but diverge from the prototype (editor
   chrome, tabs-as-documents, settings-as-view, status bar, scrollbars, empty
   states) are brought to pixel parity.
3. **The new design** — everything FULL-SPEC v1.1 adds or re-architects: the
   Writing Coach (teaching contract + Coach page + Scene Analysis), the
   deterministic Auto Note Linker, the single-folder MythosVault with files-first
   storage, the multi-timeline system with calendars and embedding, the unified
   Brainstorm board, the Beta Reader view, split panes, sessions-everywhere, the
   demo-seeded vault, and the refreshed Settings workspace.

**Definition of done** = FULL-SPEC §14's 10-point acceptance checklist +
[`PERFORMANCE.md`](../../PERFORMANCE.md)'s acceptance targets (keystroke→paint <16ms with panels open, idle
≈0% CPU, 60fps ambients, no dropped frames typing with agents live) + all three
required CI checks green on every merged PR (owner decision B4-5).

## What gets deleted (owner decision B4-1/B4-2/B4-4)

| Deleted | Replaced by | Data migration |
|---|---|---|
| Neon window frame ring (M3-era `FrameRing`, its Appearance controls, `--ring` plumbing) | Nothing — panels only | none needed |
| Transparent-window mode (`transparent: true` path, "desktop shows through") | Opaque window; `No background` = plain dark backdrop | none needed |
| Brainstorm **Map** + **Clusters** modes | One Board canvas (§7.2) | card positions/collections → new board model |
| Old 5-mode timeline implementation (M20-era) | Wholesale rebuild (§8) | events/eras/arcs → `timelines.json` |
| Settings modal | Settings workspace view (§13) | settings values carry over 1:1 |
| Per-app-installed twin vault roots (story/notes as unrelated paths) | Single `MythosVault/` folder | migration wizard (M5) |
| "Writing Assistant" naming + ghost-write-capable surfaces in manuscript | **Writing Coach** contract (§5.2) | sessions/history migrate to files |

---

# The plan — waves in dependency order

Notation per milestone: **What** · **Why** · **How/files** · **Spec** (FULL-SPEC §
/ prototype line ranges in the `.dc.html`) · **Accept** (acceptance criteria).
One PR per milestone unless noted. Prototype line index: template — title bar 62,
left panel 205, center 486 (tab strip 490, Scene Crafter 533+1325, plotline grid
1961, spreadsheet 2016, settings pages 2377–2800), right panel 2806, status bar
3621, wizard 3887; logic — state 3968, TTS 4959, notes 5910, settings 5927,
brainstorm 5969, timeline 6034, graph 6159, agent hub 6252, menus 6814,
coach 7268, beta 7366.

## Wave 0 — Integrity & performance (GAP P0s + [`PERFORMANCE.md`](../../PERFORMANCE.md); ship before anything else)

**W0.1 — Seed-once vaults + notes-tree hygiene** *(GAP #1)*
What: seeding runs exactly once (marker in vault metadata); kill the duplicate
`Archive ×4 / Universes ×9` growth; story-internal scene-UUID folders never
appear in the Notes tree; UUID folders display-map to story/scene titles.
Why: data corruption a user hits on second boot; also multiplies DOM (perf).
How: `electron-main/src/main.ts` scaffold paths (`ensureVaultDir`/
`scaffoldNotesVault` call sites), seed marker persisted next to the vault;
notes-tree listing filters story-vault internals (`electron-main/src/vault.ts`
listing + `frontend/src/VaultBrowser`/notes tree). Regression test: boot twice →
identical tree; e2e asserts no UUID-pattern folders in the tree.
Accept: two consecutive boots produce byte-identical notes trees; prototype-named
folders only.

**W0.2 — Frontmatter never renders in Rich view** *(GAP #2)*
What: strip YAML frontmatter (and `%% kanban:settings %%` blocks) from Rich/
preview rendering everywhere (notes, chapter interludes, previews); Source view
still shows raw.
Why: `board.md` renders its plugin frontmatter as a giant bold heading — first-
minute embarrassment; FULL-SPEC §6 makes it a hard rule.
How: single shared `stripFrontmatter` used by every Rich renderer
(`frontend/src/notes/*`, note preview, wiki hover preview). Unit tests incl.
kanban file fixture.
Accept: FULL-SPEC §14.10 clause; kanban file renders as board-or-hidden, never
as heading.

**W0.3 — Right-panel layout collisions** *(GAP #3)*
What: agent panel header rows become flex+gap layouts (no absolute overlap of
Back button/dropdowns); heartbeat row gets its gap; long titles wrap cleanly at
280–320px widths.
How: `frontend/src/WritingAssistantPanel.tsx`, notes agent panel components —
follow prototype right-panel spacing (12px padding, 8px gaps).
Accept: screenshots at 280/300/320px widths show zero overlaps.

**W0.4 — Single editor chrome** *(GAP #4, prep for M7)*
What: ONE breadcrumb/zoom header row and ONE formatting toolbar; delete the
duplicated zoom row, duplicate Read button, and the floating second
Dictate/Assist row.
Why: prototype has exactly one of each; the duplication also doubles per-render
cost.
How: `frontend/src/DesktopShell.tsx` editor header region +
`frontend/src/story/ManuscriptView.tsx` zoombar — consolidate into the spec's
doc-header + toolbar pair (full parity finished in M7; W0.4 only de-duplicates).
Accept: exactly one zoom seg, one Read, one Dictate, one Assist in the DOM.

**W0.5 — Performance to targets** *([`plans/design-handoff/v2/PERFORMANCE.md`](../../plans/design-handoff/v2/PERFORMANCE.md) §1–6; builds on the July-10 audit PRs #889–#895)*
What/how, in fix order:
- **Opaque window** (B4-2): remove `transparent: true` path in
  `electron-main/src/main.ts` window creation; delete the transparency setting.
- **Frame ring removal** (B4-1): delete `FrameRing` component + `--ring` tokens +
  Appearance controls + conic/hue animations (also a §3 paint offender).
- **Backdrop-filter consolidation:** at most ONE live `backdrop-filter` surface
  (popovers); panels get faked glass — semi-opaque `--glass` fill over a
  **pre-blurred wallpaper copy** generated once per wallpaper change (offscreen
  canvas → blob URL) — kills the 122-declaration re-blur cascade.
- **Transform/opacity-only animations:** wallpaper drift → `transform` on an
  oversized layer (prototype `lnDrift` pattern, line 40); breathing borders → a
  dedicated glow overlay whose **opacity** animates (`lnBreathe`), static
  box-shadow; ambient snow/embers → `translate3d` layers with `will-change`
  (prototype `lnSnowT`/`lnRiseT`); all pause on `document.hidden` (shipped in
  #891) and under reduce-motion.
- **Typing path:** counts become per-scene incremental (never re-walk the book on
  input — extend #894's row memoization with a scene-level count cache);
  shell subtrees (rail/sidebars/tabs/status) memoized so editor updates can't
  re-render them; autosave already debounced/echo-suppressed (#889).
- **Virtualization:** notes tree, story navigator, timeline spreadsheet,
  brainstorm feeds; `content-visibility: auto` + `contain: layout paint` on
  offscreen panels/cards; only the visible scene mounted at Full Book zoom with
  lazy neighbors.
- **Electron hygiene:** verify no hidden renderer doing agent work;
  `backgroundThrottling` stays on; production builds without dev source maps.
Accept: [`PERFORMANCE.md`](../../PERFORMANCE.md) targets measured in the packaged app (DevTools perf
recording: keystroke main-thread <16ms; idle ≈0; React Profiler shows no shell
re-render on keystroke). The session's profiling harness
(Playwright-vs-packaged-runtime) re-runs as the regression gate.

**W0.6 — Packaged smoke pass (GATE)** *(owner decision B4-7)*
What: cut a packaged Windows build from Wave 0, hand to Skyy; verify with real
use that P0s + perf actually landed (boot twice, type in a big scene, open every
module). No Wave 1+ merges until Skyy confirms.
Accept: Skyy's sign-off in chat.

## Wave 1 — Theme & shell fidelity

**M1 — Theme engine refresh** *(§3; GAP P2 #11)*
What: remove ring/transparency controls; add **preset import/export** (JSON
`{slots,setKey,wp,ambMode,frameAnim}`, clipboard/file, invalid → toast);
**per-vault default theme** (dropdown on vault cards, applies on switch +
toast); Appearance card order per §3 (Color theme → Neon border colors → Glow &
glass → Background → Background animation → Neon animation → Interface);
Interface card: density seg (Comfortable/Cozy/Compact), nav-rail labels toggle,
reduce motion, app text + button text color wheels; global styled scrollbars
(8–9px translucent, prototype head CSS lines 29–33).
Why: §3 exactly; scrollbars are GAP P2 #11 app-wide.
Files: `frontend/src/theme/liquidNeonEngine.ts`, `liquidNeon.css`, `tokens.css`,
`components/SettingsPanel/sections/LiquidNeonAppearanceSection.tsx`, global CSS.
Spec: §3; prototype 3968–4010 (sets/themeAnim/slotRoles/swatches), settings
template 2377–2558 region for Appearance.
Accept: §14.9 (export→import round-trips; per-vault theme applies on switch;
reduce-motion single-switch); density seg changes paddings live.

**M2 — Title bar & status bar parity** *(§4; GAP #9 partial, #10)*
What: logo click = **Mythos-vault switcher popover** (every vault, location,
stats, quick-switch, `New Mythos vault…`); real menus with the §4 actions incl.
Tools → `Run continuity scan` and `Beta read this chapter` (prototype 6814);
center `Search vault…` field + Ctrl hint; bell feed rows deep-link; ONE status
bar (`‹ ›` nav · words · chars · read time · page-width hint · status chip ·
goal chip · `Saved Xm ago` + pulse) — delete the second stat row.
Files: `frontend/src/components/ui/WindowChrome.tsx`, `BottomBar.tsx`,
`DesktopShell.tsx` menu wiring.
Spec: §4; prototype 62–138 (title bar), 3621–3700 (status bar), 6814 (menus).
Accept: every menu item acts or explains (§1.2); one status bar in DOM; bell
rows navigate to their source.

**M3 — Nav rail & stories switcher** *(§4; GAP #9)*
What: labels always visible (slim = user toggle only, 72→44px); modules order =
Story Writer, Notes Editor, Scene Crafter, Brainstorm, Timeline, Vault Graph;
edit popover (drag-reorder + hide/show); Story Writer re-click opens **stories
switcher** scoped to the current vault + **New Story wizard** (name, genre voice
preset "tunes the Writing Coach", link existing note folders).
Files: `frontend/src/AppNavRail.tsx`, stories popover, new-story flow in
`DesktopShell.tsx`.
Spec: §4; prototype 139–205, 5681 (navItems logic).
Accept: labels consistent across all views; wizard creates story + Story Plan
note; rail order/hide persists.

**M4 — Workspace tabs = documents + split panes** *(§4; GAP #9; §1.5)*
What: tabs are documents (scenes/notes/boards), not module mirrors; status dot +
label + ×; `+` = provisional scene (persists on type/rename, silently discards
with toast otherwise); drag reorder; drag DOWN (lower 45%) or RIGHT (right 44%)
shows highlight zone → opens **split pane** (second fully editable editor, own
scroll; notes tab splits notes); right-click → Open to the side / Pop out /
Close; strip hidden on Brainstorm/Timeline/Graph/Settings/Beta.
Files: `frontend/src/WorkspaceTabBar.tsx` (rework), split-pane host in
`DesktopShell.tsx` (extend the GH#643 pane work), provisional-scene lifecycle.
Spec: §4, §1.5; prototype 490–533.
Accept: §14.3 verbatim (provisional + split + context menu).

## Wave 2 — Data foundation

**M5 — MythosVault format + files-first storage + migration wizard** *(§2; B4-3)*
What: single `MythosVault/` folder = `mythos.json` (id, name, default theme,
story list, seed marker) + `settings.json` (per-vault) + `timelines.json` +
`Story Vault/` + `Notes Vault/`; scene files under
`<Story>/Part N/Chapter NN/Scene NN.md` with frontmatter
`{title,status,pov,when}`; **drafts as numbered files**
(`drafts/Scene 01.draft-6.md`); **comments as sidecar files in the vault**;
**agent chat sessions as files in the vault**; SQLite reduced to regenerable
state (continuity flags, budgets, caches, FTS). App-global prefs stay in
AppData. **Migration wizard**: detects v0.4 twin-root vaults on boot, walks the
user through conversion (copy-based, original untouched until confirmed),
migrates SQLite comments/snapshots/sessions into files, maps old manifest →
`mythos.json` + frontmatter. New-vault seeding: "The Last City of Veynn" demo
(prototype's `_book0` content, 3-part manuscript + sample notes + starter idea
library) — **once**, marker-guarded (W0.1 rule).
Why: §2 exactly; B4-3's survival rule (vault copy/Dropbox carries all user
work).
Files: `electron-main/src/vault.ts`, `manifest.ts` (→ `mythos.json` codec),
`snapshots.ts`/`versions.ts` (→ draft files), `frontend/src/comments/persistence`
(→ sidecar), agent session stores, new `migration/mythosVaultMigrator.ts`, seed
content module from prototype 3990–4040 + 4085–4120.
Spec: §2; prototype `_book0`/`_vault0`/`bsPool` state.
Accept: fresh vault seeds once and demos every screen; migrated vault opens with
all stories/notes/comments/drafts intact; copying the folder to a second machine
preserves everything; §14.10 seeding clause.
*Note: lands behind a version gate in one PR with heavy migration tests; every
subsequent milestone builds on this format.*

**M6 — Auto Note Linker (built-in, deterministic)** *(§12)*
What: trie-based matcher over note titles+aliases → `[[wiki links]]`; toggles
(format on save, include aliases, proximity preference, ignore case, prevent
self-link, ignore dates); format delay; excluded folders (seeds `Templates/`,
`Archive/`); `Format vault now` (progress toast w/ counts) + `Rebuild index`;
respects `automatic-linker-off/-exclude/-scoped` frontmatter; never touches
existing links. Settings → Vault & Files FIRST card, badge `BUILT-IN · NO AI`;
green callout on the AI Agents page pointing here.
Why: §0 — linking is deterministic, not an agent job; replaces the M23-era
agent-adjacent auto-link surface (which becomes this engine's consumer).
Files: new `electron-main/src/autoLinker/` (trie, formatter, scanner),
`frontend/src/story/autoLinkText.ts` consumers rewired, Settings card.
Spec: §12; behavioral reference `kdnk/obsidian-automatic-linker`.
Accept: §14.8 verbatim.

## Wave 3 — Story Writer

**M7 — Editor chrome & page** *(§5.1; GAP #5)*
Doc header row (zoom seg · breadcrumb · editable title + star · Draft dropdown ·
word count · comments chip · Drafts · Focus · ⋯ menu) + single format toolbar
(style/font/size/**line-spacing dropdown**/B I U S/align/lists/
`+ Part + Chapter + Scene`/Read/Dictate/**Coach**) + **margin ruler** (ticks,
end stops, glowing span, slot-B diamond handles dragging page width
symmetrically, live px readout, gutter-aware centering) + page styles
(Neon/No glow/Scroll/**Custom texture upload**/Off) + page-setup as compact
popover (not a strip) + snapshots/History into ⋯ menu.
Files: `ManuscriptView.tsx` + css, `FormatToolbar`, new `MarginRuler`,
`PageChrome` popover.
Spec: §5.1; prototype 560–800 region.
Accept: GAP #4/#5 closed; ruler drag + edge drag + slider all resize (520–3000).

**M8 — Editing model hardening** *(§5.1, §1)*
Enter splits at caret / Backspace-at-start merges / empty-para removal (min 1);
inline heading renames persist provisional scenes; drop cap on first scene
paragraph; status dot click-cycles everywhere; paragraph grip drag per spec
(selection suppressed, 38% dim, gradient insert line, state always clears);
Alt+←/→ hops scenes (chapters at chapter zoom).
Files: `ManuscriptView.tsx` (extends #894's `ParagraphRow`), `manuscriptModel`.
Accept: §14.1 + §14.2 verbatim.

**M9 — Comments v2** *(§5.1)*
Selection composer (+ Read-aloud), kinds/colors (user gold `#ffd319`, Coach
slot-A, Archive pink `#ff5f8f`), gutter cards (author/quote/body; Resolve /
Update note / Suggest edit), `Show in focus` toggle; storage → vault sidecar
files (M5).
Files: `frontend/src/comments/*`, gutter components.
Accept: agent + user comments round-trip through vault copy; actions wired.

**M10 — Drafts v2** *(§5.1 drafts; B4-3)*
File-based numbered snapshots; compare split (scope = open scene/chapter, draft
select, Highlight changes default ON, **current draft always left/green**);
Full diff view; Load draft → yellow Undo chip; snapshot frequency + keep-count
settings in the popover.
Files: draft store on M5 files, `DraftsCompare` components, diff renderer.
Accept: load-draft undo restores exactly; diff labels correct on both sides.

**M11 — Reader (TTS) refinements** *(§5.1 Read)*
Reader card in right gutter (docks under comments, centers when hidden):
play/pause, ±10s, prev/next scene, from-cursor/from-start/selection, speed
50–200%, voice select (system + Edge naturals + offline Piper/Kokoro), sentence
highlight; audiobook bar in Book preview.
Files: `story/ReaderBar.tsx`, `useManuscriptReader.ts`, `readerVoices.ts`.
Accept: highlight tracks sentences; gutter dock behavior matches prototype.

**M12 — Coach page + suggestions rail** *(§5.2; agent contract)*
Rename Writing Assistant → **Writing Coach** everywhere; Coach sub-tab page:
header (icon tile, sub `…never ghost-writes`, session pill, 3 skill chips),
760px chat feed (user/coach bubbles, **lesson cards** with drill footers,
analysis cards), typing dots, chips row, input; right rail SUGGESTIONS
(collapsible General + per-chapter groups, current marked, click → `Teach me:`);
**one conversation store shared with the panel chat** (lesson messages collapse
in mini view).
Files: new `frontend/src/coach/` page components, agent rename sweep
(`agentIdentity`, settings, prompts), session store (M5 files).
Spec: §5.2; prototype 7268 (coachSugGroups) + coach feed template.
Accept: §14.6 Coach clause; no manuscript-prose generation path from Coach
surfaces.

**M13 — Scene Analysis (computed + AI split)** *(§5.4)*
Right-panel card (Purpose/Tension/Pacing/POV/Words/Read time + note) + `View
Full Analysis` → analysis card in Coach page: `COMPUTED · LOCAL · FREE` (words,
read time, avg sentence length, dialogue/description/action %, filter words w/
locations, adverb dialogue tags — pure text analysis, always available) +
`COACH'S READ · AI` (purpose/tension/pacing/POV with teaching clauses) +
takeaway + drill.
Files: new `frontend/src/analysis/computedSceneMetrics.ts` (+tests), Coach card
components, agent prompt.
Accept: §14.7 (Full Analysis opens in Coach with both sections); computed
section renders with AI disabled.

**M14 — Structure & Book/Export** *(§5.3, §5.5)*
Structure grid/list parity (drag scenes, beat-sheet templates right panel);
Book: compiled read-only + comments + page width follows editor; Export modal
(DOCX/PDF/EPUB cards, scope seg, synopsis/separators, progress, Done).
Files: existing M14-era components refreshed to prototype values.
Accept: export produces files for all three formats on Linux CI (smoke).

**M15 — Right panel agent hub + Suggestion Inbox + sessions everywhere** *(§5.6, §11; B4-8)*
AGENTS card (compact rows: 30px tile, status dot; hover tooltip desc; click →
in-panel chat with back button, session pill, issue/note cards, chips, input);
Beta Reader row routes to the Beta view; Suggestions card (badge + 3 rows +
`See All Suggestions`); Scene Analysis card; Scenes/Notes/References tabs.
**Session dropdowns on every chat surface** (§11: rename inline, duplicate,
delete-last recreates, per-agent greetings), stores = vault files (M5).
**Suggestion Inbox (B4-8):** a review surface in the agent hub listing every
below-threshold suggestion (source agent, confidence, rationale, target,
accept/dismiss; accepted → snapshot-first apply; dismissed → never reappears,
CF-10).
Files: `WritingAssistantPanel.tsx` → agent hub rework, shared
`AgentSessionPicker`, session file store.
Spec: §5.6/§11; prototype 2806–3080 (right panel), 6252 (agent defs).
Accept: §14.6 verbatim across all four agents.

## Wave 4 — Notes Editor

**M16 — Explorer toolbar + tree parity** *(§6)*
Vault switcher dropdown (main/imports/`Import a vault…`); search; 5-button
toolbar (New note → template picker popover w/ Brainstorm pre-fill; New folder;
Sort cycle manual→A–Z→Z–A; **Auto-reveal current file** toggle; Collapse/expand
all); tree chevrons/counts, drag-drop with dashed target, context menu (Open in
new tab / Beta read / Continuity check / Rename / Delete); RECENT list.
Files: notes tree components (`VaultBrowser`/notes sidebar), template picker.
Spec: §6; prototype 205–486.
Accept: every toolbar button functional; auto-reveal follows note switches.

**M17 — Note body + wiki links parity** *(§6)*
Editable Lora title, tag chips + add input, gear → Rich/Markdown/Source seg
(+ always-open-rich toggle); body blocks contentEditable (paragraphs, H2s,
purple callout cards, bullet lists, links block); backlinks footer; wiki links
slot-B styled, hover preview, resolve to notes AND scenes, unresolved → dashed +
create-on-click offer; frontmatter hidden in Rich (W0.2 engine).
Files: notes editor components, wiki-link resolver (`wikiLinks.ts` consumers).
Accept: hover previews render; creating from unresolved link works; Rich view
never shows YAML.

**M18 — Notes right panel** *(§6)*
Agent tab: Brainstorm chat (`Curator of this vault…`) + **CONTINUITY FLAGS**
section (`ARCHIVE AGENT` badge; flag cards: title, Story↔Vault source, body, 3
actions). Properties tab: frontmatter table. No layout collisions (W0.3 rules).
Accept: flags actions fire the same handlers as manuscript comment actions.

## Wave 5 — Crafter & Brainstorm

**M19 — Scene Crafter refresh** *(§7.1)*
Setup form (title, POV select, GOAL/CONFLICT textareas, BEATS add/drag/delete,
tone chips, length seg); SUGGESTED CARDS panel (searchable, grouped, click/drag
to canvas, title-case display-mapping — GAP P2 #13); canvas (2200×1500 world,
pan/zoom 40–240%, colored card headers, avatar chip → opens note, link tool);
gradient generate → **draft card** (`— first pass`, word count, preview;
**Add to scene board** (B4-9 — the draft lands on the scene's canvas board;
generated prose NEVER enters the manuscript; the writer lifts it by hand) /
Retry / Discard; Coach-framed copy: "…annotates why it made each choice, so the
rewrite teaches you"); right kanban (beats/cast/places); editor right-panel
Scenes tab mini canvas (Open full).
Files: `pages/SceneCrafter/*`, `canvas/*` engine reuse.
Spec: §7.1; prototype 533+1325 regions.
Accept: no code path writes generated prose into the manuscript; Add to scene
board places the draft card on the board; board mini canvas pans/zooms.

**M20 — Brainstorm unification** *(§7.2; B4-4)*
Agent Chat default page + **ONE Board** (delete Map/Clusters; migrate card
positions/collections into the board model); floating category region labels;
216px idea cards (drag anywhere persisted, wheel zoom, pan, Connect tool,
double-click inline edit, vault-note titles underlined → open); dock
Select/Connect/Frame + zoom; status line; left IDEA COLLECTIONS (search
auto-expand, groups incl. **Tropes**, `+`/`✓` placement, **starter library**:
3 structure beats, 12 tropes, 6 themes, 4 sparks); right panel (LIVE badge,
stats, BEHIND THE SCENES, QUESTIONS FOR YOU → click sends to chat, NOTES THAT
NEED WORK w/ MISSING/NEEDS WORK chips, explore/saved/quick-generate); Chat page
Board toggle (canvas stacked under chat, drag-bar height) + `Extracting facts…`
chip; genre preset appears once (header) — GAP P2 #14.
Files: `BrainstormPage.tsx` rework, board model on M5 storage, starter library
seed (prototype `bsPool` 4085–4160).
Accept: one canvas; starter chips present; positions survive restart; migration
preserves existing user cards.

## Wave 6 — Timeline (flagship rebuild; B4-4 wholesale)

**M21 — Timeline data model + multi-timeline + calendars** *(§8.1, §8.2)*
`timelines.json`: timelines (name, kind, axis, calendar {months/yr, days/mo,
hours/day; default 12·30·24; presets}, eras, spans, custom rows, events);
`when` = year×10 float codec through the ACTIVE calendar (NaN-guarded — §8.2's
"never again"); picker card (dropdown: all timelines, `+ New timeline`,
`Edit calendar…`); seeds (story/world/universe examples on demo vaults);
**embedding**: span `open`→ other timeline, dashed border, mini preview strips
(embedded spans scaled to its axis), click opens; inspector attach/detach.
Migration: current M20-era events/eras/arcs → this schema.
Files: new `electron-main/src/timelines/` store + codec (+tests), picker UI.
Accept: 13×28×18h calendar round-trips exact times; embedded span previews
render; old data migrated.

**M22 — Axis engine** *(§8.3)*
ERAS bar (named spans, `ERAS +`), adaptive tick labels (year→month→day→hour),
zoom seg + Ctrl+scroll (×0.55–×44), min-width growth + bottom scrollbar;
**universal direct manipulation** (3px drag threshold moves-in-time + toast;
7px edge handles ew-resize on all span-likes; point items move only; click
selects → Inspector); **exact-time picker modal** (4 mono inputs in active
calendar + `change` → calendar editor modal); **auto-stacking** (first-fit
lanes, ε 0.15%, touching edges don't stack, characters one lane each).
Files: new `frontend/src/timeline2/axis/*` (pure lane/tick/codec logic unit-
tested heavily).
Accept: §14.4 verbatim (the 9-step timeline drill).

**M23 — Lane rows + Progress/Structure** *(§8.4)*
Rows top→bottom: ERAS · BOOKS/SPANS & STORIES (`PLOTTED BY DATE`, `+`) · ARCS ·
CHAPTERS (date-positioned minis, tooltip, you-are-here ring) · PLOTLINES (thin
lanes, scene-card chips, click→inspector) · KEY EVENTS (215px cards, FLASHBACK
badge) · CHARACTERS (lifespan lines) · WORLD (chips) · THEMES · **CUSTOM ROWS**
(`+ Custom row`, inline rename, per-row `+` spans). Progress mode extras
(planned greyscale, legend, position marker, book-focus cards); toolbar (mode
seg ×7, View/Group/Show filters — functional, Templates ▾ → dashed beat
plotline + toast, `+ Plotline`, zoom seg, Today jump).
Spec: §8.4; prototype 6034+ (timeline logic), tlEvents/tlTpls state.
Accept: all rows plot from `timelines.json`; filters regroup live; Today
selects current.

**M24 — Remaining modes** *(§8.5)*
Plotlines (Plottr grid: sticky plotline column, 12 chapter columns, YOU ARE
HERE, cards drag between cells, `+` per cell, zoom-scaled min-width);
Spreadsheet (EVENT/CH/DATE·ERA/POV/LOCATION/IMPACT + Narrative⇄Chronological
seg + FLASHBACK badges + Group-By headers); Tension (SVG draggable per-chapter
points vs dashed classic arc, ACT separators, legend); Relationships (presence
dots); Subway (colored character lines through stations).
Spec: §8.5; prototype 1961 (grid), 2016 (sheet).
Accept: all seven modes render the same data; chronological re-sort surfaces
flashbacks.

**M25 — Timeline right panel + Archive auto-build** *(§8.6)*
Inspector (event editor w/ DATE/TIME → picker; lane-item editor w/ exact-time,
EMBEDS select, color row; plotline-card editor; §1.4 draft-commit numerics);
Brainstorm tab (blurb, `Structure timeline into notes`, NEEDS FILLING OUT list →
click jumps, mini chat on shared session); Archive tab (blurb, quick-add input →
agent dates & plots, RECENTLY AUTO-ADDED, mini chat). Archive Agent auto-build
wired to the new model (replaces `timelinePlanBuild` consumer).
Accept: §14.5 (any click surfaces Inspector; both mini chats work); quick-add
plots a dated event.

## Wave 7 — Graph, Beta, Settings, Wizard, Release

**M26 — Vault Graph refinements** *(§9)*
Category eye-toggles + recolor wheels + counts; note↔note vs story↔note line
colors (user-recolorable); story-cluster toggle (gold); physics sliders
(center/repel/link/distance); hover dims non-neighbors; node card (blurb,
clickable CONNECTIONS, Open note); Re-layout; Fit.
Files: `VaultGraphView.tsx` (keep the settled-sim architecture from the audit).
Accept: all left-panel controls affect the sim live.

**M27 — Beta Reader view** *(§10)*
`beta` view (entered from agent hub row / Tools menu): header seg Reports|Chat;
Reports feed (score chips w/ verdict colors, overall, REACTIONS list
LOVED/STUMBLED/CONFUSED + quote + where + note); right column Run-a-Beta-Read
(scope select, 4 focus toggles, Run → pulsing `Reading…` → report + **margin
comments** + toast) + how-it-works; Chat page (session pill, reaction cards,
chips, input); left BETA READS history; right General feedback card. One empty
state (GAP P2 #15).
Files: new `frontend/src/beta/` view, wire to beta-read pipeline + comments v2.
Accept: §14.7 (Run produces report AND margin comments).

**M28 — Settings workspace** *(§13; GAP #8)*
Full view (not modal), left rail: Account & profile · Appearance · AI Agents ·
Editor · Vault & Files · Sync & Backup · Shortcuts · About (prototype
`settingsMeta`, 6458). AI Agents page (B4-10): **full BYO providers** — Claude API, any
OpenAI-compatible endpoint (keep the existing adapter), local runtimes
(Ollama/LM Studio/llama.cpp) — masked key + Test each, plus **OAuth login
buttons for every provider that supports it, all in connect-later state**
(B4-6/B4-10); models ×4; **Autonomy card: every auto-apply toggle OFF by
default + a per-category certainty slider (B4-8)** — at/above threshold
auto-applies snapshot-first, below routes to the M15 Suggestion Inbox; green
linker callout; identity & files (rename, duties chips,
agent/instructions/learning/soul editors). Editor page:
text colors (story/notes split, wiki links), manuscript page modes incl. Custom,
autosave slider, defaults, behavior toggles. Vault & Files: linker card first
(M6), vault cards (click switches, per-vault theme, stats, new), import
(Obsidian/Notion/Scrivener/Markdown w/ mapping), **Import story**
(docx/gdocs/md/scriv/epub → headings map to structure + plan note), actions,
danger zone. Sync & Backup, Shortcuts table, About. Right panel = live theme
preview + reset.
Files: `SettingsPanel.tsx` → routed workspace view, per-page components.
Accept: GAP #8 closed; every section reachable; OAuth button explains itself.

**M29 — Welcome wizard + onboarding** *(§13/§2; prototype 3887)*
4 entry paths, genre, theme cards; seeds templates/beat sheet/personas note;
runs once; replay via project menu.
Accept: fresh install → wizard → demo vault → every screen self-demos.

**M30 — Release prep + acceptance run**
Version 0.5.0-beta.1; changelog; **run FULL-SPEC §14 checklist 1–10 end-to-end
on a packaged build** + PERFORMANCE targets re-measured; VR baseline refresh;
release workflow artifacts.
Accept: every §14 item checked off in the PR description with evidence.

---

## Milestone status table

**Reconciled 2026-07-23 (SKY-8271)** against `origin/main` — every row below was checked with
`git merge-base --is-ancestor <sha> origin/main`, not by trusting a PR number alone (several old
PR numbers below #1000 were previously left in "🔀 in PR" rows after they had actually merged).

| # | Milestone | Wave | Depends on | Status | Merge commit (PR) |
|---|-----------|------|-----------|--------|----|
| W0.1 | Seed-once + tree hygiene | 0 | — | ✅ merged | `490cd4c5` (#903) |
| W0.2 | Frontmatter stripping | 0 | — | ✅ merged | `bd26de6b` (#901) |
| W0.3 | Right-panel layout fixes | 0 | — | ✅ merged | `8f5922ee` (#902) |
| W0.4 | Editor chrome dedup | 0 | — | ✅ merged | `8f5922ee` (#902) |
| W0.5 | Performance to targets | 0 | — | ✅ merged | `a338aa6f` (#905) |
| W0.6 | Packaged smoke pass (GATE) | 0 | W0.1–W0.5 | ✅ PASSED — Skyy sign-off 2026-07-11 on v0.5.0-beta.0 ("not really lagging at all") | |
| M1 | Theme engine refresh | 1 | W0.6 | ✅ merged | `d98cb135` (#909) |
| M2 | Title/status bar parity | 1 | W0.6 | ✅ merged | `69854ca2` (#908) |
| M3 | Nav rail + stories switcher | 1 | W0.6 | ✅ merged | `470384fb` (#911) |
| M4 | Tabs = documents + splits | 1 | W0.6 | ✅ merged | `6b2e7d59` (#910) |
| M5 | MythosVault + migration | 2 | W0.6 | ✅ merged | `5219ac73` (#912) |
| M6 | Auto Note Linker | 2 | M5 | ✅ merged | `b19703ff` (#916) |
| M7 | Editor chrome & page | 3 | W0.4, M1 | ✅ merged (+ margin ruler/page-texture polish) | `49218a76` (#915), `be7d7f23` (#937) |
| M8 | Editing model hardening | 3 | M7 | ✅ merged | `8b3c2fc3` (#941) |
| M9 | Comments v2 | 3 | M5, M7 | ✅ merged | `82fdd2f2` (#953) |
| M10 | Drafts v2 | 3 | M5, M7 | ✅ merged | `d7202785` (#945) |
| M11 | Reader refinements | 3 | M7 | ✅ merged | `79ccb509` (#938) |
| M12 | Coach page | 3 | M5, M15 | ✅ merged | `2335d507` (#952) |
| M13 | Scene Analysis | 3 | M12 | ✅ merged | `02a96be0` (#956) |
| M14 | Structure & Book/Export | 3 | M7 | ✅ merged | `0af0ec92` (#939) |
| M15 | Agent hub + sessions | 3 | M5 | ✅ merged base (#917); **gap-closure spec landed, gaps NOT yet closed** — see note below | `4acc9b52` (#917); gap spec `eb341e7a` (#1078, SKY-8134) |
| M16 | Notes explorer parity | 4 | M5 | ✅ merged | `1d953114` (#920) |
| M17 | Note body + wiki links | 4 | M6, M16 | ✅ merged | `d14560a8` (#940) |
| M18 | Notes right panel | 4 | M15, M16 | ✅ merged (SKY-6978) — **duplicate build ticket in flight, see note below** | `f61c89ce` (#963) |
| M19 | Scene Crafter refresh | 5 | M5, M12 | ✅ merged (SKY-6979) — **duplicate build ticket in flight, real E2E gap is genuine, see note below** | `7d28654a` (#973) |
| M20 | Brainstorm unification | 5 | M5, M15 | ✅ merged | `981e8cec` (#958) |
| M21 | Timeline model + calendars | 6 | M5 | ✅ merged | `fe2404bb` (#914) |
| M22 | Axis engine | 6 | M21 | ✅ merged | `b3f8f564` (#951) |
| M23 | Lane rows + Progress | 6 | M22 | ✅ merged | `94e400d4` (#957) |
| M24 | Remaining modes | 6 | M23 | ✅ merged | `92f0d92e` (#1040), a11y depth `926b419f` (#1077) |
| M25 | Timeline panel + Archive | 6 | M23, M15 | ✅ merged (SKY-6981) — **duplicate build ticket in flight, see note below** | `dedf2e77` (#1010) |
| M26 | Vault Graph refinements | 7 | M5 | ✅ merged | `39b5ceb0` (#955) |
| M27 | Beta Reader view | 7 | M9, M15 | ✅ merged | `103676f6` (#965) |
| M28 | Settings workspace | 7 | M1, M5, M6 | ✅ merged | `afcba01f` (#959) |
| M29 | Welcome wizard | 7 | M5, M28 | ✅ merged (base #998, restore fix #1031, + optional AI-provider step #1101) | `7f21835d` (#998), `32e2c126` (#1101) |
| M30 | Release prep + acceptance | 7 | all | 🔨 in progress — version bump + changelog done, **packaged-build §14 acceptance run not yet done** | version `0.5.0-beta.1` in `package.json`; `CHANGELOG.md` §0.5.0-beta.1 present |

Status legend: ⏳ not started · 🔨 in progress · 🔀 in PR (#) · ✅ merged

### Reconciliation notes (SKY-8271, 2026-07-23)

**Every M-numbered milestone (M1–M29) is merged to `main`.** The only milestone that is not fully
closed is **M30 (release prep + acceptance)** — everything else in the old table's `⏳`/`🔀 in PR`
rows had already landed by the time this reconciliation ran; the table just hadn't been updated
since ~2026-07-15 (`docs(beta4): status table refresh...` #947/#954 were the last passes).

**Three build tickets dispatched this fire are very likely duplicate work against already-merged
milestones — flagging back per the issue's "materially incomplete" clause, but this is the
opposite case: materially *complete*, not incomplete:**

- **SKY-8264** (ProductEngineer, M18 "Notes right panel") — M18 merged 2026-07-18 as PR #963
  ("Closes SKY-6978"). Current `frontend/src/NotesTabPanel.tsx` already has the Curator greeting,
  the `CONTINUITY FLAGS` section wired to the same `handleResolve`/comment-action handlers, and a
  `Properties` tab rendering `NoteProperties` keyed on `activeNotePath` (remounts on note switch).
  SKY-8264's own description says "M15 (#1078) and M16 (#920) are merged, so this is unblocked
  now" — reading `#1078` as the M15 delivery PR when #1078 is actually the M15 *gap-check spec*
  (see M15 row above); the real M15 delivery (#917) merged 2026-07-18, so this ticket's premise
  ("unblocked now") doesn't establish M18 was ever unbuilt.
- **SKY-8265** (FableEngineer, M19 "Scene Crafter refresh") — M19 merged 2026-07-18 as PR #973
  ("Addresses SKY-6979 acceptance criteria 1-9"). `frontend/src/pages/SceneCrafter/SceneCrafterPage.tsx`
  already has the draft-card `Add to scene board` / `Retry` / `Discard` actions, and
  `crafterState.ts` already carries the "never the manuscript" invariant in its prompt/generation
  path. **However — the E2E gap here is real**, not stale-table noise: no `e2e/*.spec.ts` file
  exercises the Scene Crafter draft flow or asserts the no-manuscript-write invariant end-to-end
  (unit tests only). SKY-8267's plan to write that test first is correct and should proceed.
- **SKY-8266** (FoundingEngineer, M25 "Timeline right panel + Archive auto-build") — M25 merged
  2026-07-22 as PR #1010 ("Implements FULL-SPEC §8.6... Tracker: SKY-6981"), 34 files, Inspector +
  Brainstorm + Archive tabs all present (`ArchivePanel.tsx`, `TimelineRightPanel.css`,
  `TimelineRoot.tsx`). SKY-8266's AC #3 asks to remove "the old `timelinePlanBuild` consumer" as if
  it's dead legacy code blocking the rewrite — it is not dead; `TimelineRoot.tsx` is its live,
  current consumer, already on the M21 `timelines.json` model per #1010's own PR description.

Active branches/worktrees already exist for this in-flight (possibly duplicate) work:
`feature/sky-8264-notes-agent-properties-tabs`, `.worktrees/sky8264-notes-agent-tab`,
`.worktrees/worktree-sky8266-archive-quickadd-e2e`, plus a companion a11y/dyslexia design-ahead
spec **SKY-8268** (#1108, in review) that frames all three milestones as "actively in progress."
**Recommend the CEO redirect SKY-8264/65/66 before more code lands**: re-scope from "build the
milestone" to "close the specific residual gap" (SKY-8268's a11y/dyslexia findings + SKY-8267's
real-E2E-invariant tests), rather than risk two independent implementations of the same panels
landing in parallel and conflicting. SKY-8267 (independent spec-only acceptance-test verifier) and
SKY-8268 (a11y/dyslexia gap spec) both still carry real, non-duplicate value and should continue.

**M15's own gap-closure is a genuine open item**, same shape as M18/M19/M25 but correctly scoped:
`docs/AGENT-HUB-SUGGESTION-INBOX-GAP-SPEC.md` (landed via #1078, SKY-8134) documents real
interaction-state gaps in the agent hub / Suggestion Inbox (empty/loading/error states, keyboard
nav + focus order, reduced-motion, 280px-floor narrow width, accept/dismiss confirm+undo, status-dot
states, session-list overflow, bell-vs-inbox badge relationship) that the spec identified but that
no follow-up build ticket has yet closed. This is real remaining work, not stale-table noise.

**E2E depth spot-check (COMPANY-STANDARDS §4a):** 14 `e2e/*.spec.ts` files still carry
`test.skip`/`describe.skip`. Recent PRs (#1056 move-vault, #1054 brainstorm scene-append, #1089
epub import) show an active, ongoing push to replace mocked-IPC E2E with real electron-launched
coverage — that effort is not finished. The Scene Crafter gap above (M19) is the most consequential
find: it is a **hard product invariant** (no generated prose reaches the manuscript) with zero E2E
coverage of the boundary it's supposed to guard.

## Remaining work for v0.5.0-beta.1

With M1–M29 confirmed merged, the **only genuinely outstanding milestone is M30**. Everything
else below is either the M30 acceptance gate itself, cleanup of the SKY-8264/65/66/67/68 fire's
scope (already dispatched, needs re-aiming not net-new dispatch), or pre-existing gap-closure specs
that never got build follow-up (M15's Suggestion Inbox).

**Gates M30 (must close before release):**
1. **M30's own deliverable** — run FULL-SPEC §14 acceptance checklist (10 items) end-to-end on a
   packaged build, re-measure PERFORMANCE.md targets on the packaged app, refresh VR baselines
   (last `vr-baselines.yml` run succeeded 2026-07-23T14:36Z — good sign, but a full green run isn't
   the same as the §14 walkthrough itself), assemble release workflow artifacts. Nobody owns this
   yet as an active build ticket — it's the true remaining-work item and should be the next thing
   the CEO dispatches once the items below are resolved (the acceptance run should exercise the
   real deliverables, not ones that got re-implemented mid-run).
2. **SKY-8267's real-E2E invariant test for M19** (Scene Crafter no-manuscript-write) — genuine gap,
   already correctly scoped, in progress. Low risk, keep running.
3. **SKY-8268's a11y/dyslexia gap-spec for M18/M19/M25** (#1108, in review) — legitimate follow-up
   spec, independent of the duplicate-build concern above. Let it land, then size its findings into
   real build tickets (same pattern as M15/SKY-8134 already needs — see next item).

**Does NOT gate M30, but is real outstanding scope (no ticket currently covers it):**
4. **M15 Suggestion Inbox interaction-state gaps** (`docs/AGENT-HUB-SUGGESTION-INBOX-GAP-SPEC.md`,
   SKY-8134/#1078) — spec landed, no build ticket exists yet to close it. Same shape as item 3
   above; the CEO should size and dispatch both gap-specs' findings as one or two follow-up tickets
   once SKY-8268 lands, rather than as three separate near-duplicate "rebuild the milestone" tickets.
5. **14 skipped/pending E2E specs** — pre-existing debt, being worked down incrementally (#1056,
   #1054, #1089 landed this week). Continue at current pace; not new scope.

**Needs an explicit CEO call, not a silent redirect (per this issue's bounds):**
6. **SKY-8264/65/66** — recommend re-scoping to "close SKY-8268's + this doc's named gaps for
   M18/M19/M25" instead of "build the milestone," to avoid parallel/conflicting reimplementation of
   already-shipped panels. This is a scope/sequencing call for the CEO, not something to silently
   redirect on the executing agents.

**Sequencing (foundations-first, no-backtrack, ≤~6 concurrent slices / ≤~2 per agent):**
- Wave A (now, already running, keep): SKY-8267 (QA, M19 E2E invariant), SKY-8268 (a11y/dyslexia
  spec review → merge).
- Wave B (CEO decision needed first): SKY-8264/65/66 — re-aim to gap-closure scope per item 6, or
  explicitly confirm "build was already done, cancel/close as duplicate" if the CEO's own triage
  disagrees with this reconciliation.
- Wave C (after Wave B lands or is cancelled): size SKY-8134's M15 Suggestion Inbox gaps + SKY-8268's
  M18/M19/M25 a11y/dyslexia gaps into build tickets; dispatch across PE/FableEngineer/FoundingEngineer
  once Wave B frees them up.
- Wave D (M30 gate): once Wave C's findings are closed (or explicitly deferred by the CEO as
  post-beta polish), dispatch the M30 acceptance-run ticket — packaged build, §14 checklist,
  PERFORMANCE.md re-measure, VR baseline refresh, release artifacts. This is the last milestone
  and should not start until the panels it's acceptance-testing have stopped moving.

## Working rules for this release

- One PR per milestone; every PR links its plan section and includes
  screenshots/GIFs vs the prototype (GAP-REPORT-v2's closing note: "the P0 list
  is exactly what a screenshot diff would have caught").
- CI green before merge — all three required checks (B4-5).
- Port exact values (hex, px, radii, shadows, animation timings) from the
  prototype source; never approximate.
- Preserve unrelated repo code; migrations before deletions (B4-4).
- W0.6 is a hard gate: no Wave 1+ merges until Skyy confirms the packaged build.
  (Gate PASSED 2026-07-11; owner then authorized building all remaining waves and
  cutting v0.5.0-beta.1 when the full handoff is implemented.)
- **Perf re-runs at every wave boundary** (added 2026-07-22, SKY-7936
  premortem): the [`PERFORMANCE.md`](../../PERFORMANCE.md) packaged-build
  procedure re-runs once each wave merges to `main`, not only at the final
  W0.6/M30 sign-off — append the result to `PERFORMANCE.md`'s wave-boundary
  log. A >25% regression on any metric without a documented reason blocks the
  next wave's merge, same policy as `plans/PERF_BUDGET.md`.
