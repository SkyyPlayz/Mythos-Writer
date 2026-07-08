# Beta 3 — "Liquid Neon" Release Goal & End-to-End Build Plan

> **Status:** 🔨 building · **Spec of record:** [`design-handoff/prototype/Mythos Writer - Liquid Neon.dc.html`](../../design-handoff/prototype/) (approved interactive prototype) · **Map:** [`design-handoff/DESIGN-SPEC.md`](../../design-handoff/DESIGN-SPEC.md) · **Process:** [`design-handoff/PROCESS.md`](../../design-handoff/PROCESS.md) · **Source line-map:** [`LIQUID-NEON-PROTOTYPE-MAP.md`](LIQUID-NEON-PROTOTYPE-MAP.md)
>
> **Update this file as milestones land** — fill the PR column and flip the status. It is the single resume point if the build is interrupted mid-cycle.

## The release goal

Beta 3 turns Mythos Writer into the **Liquid Neon design**: a macOS-liquid-glass feel on Windows — neon-bordered glass panels floating over a user-changeable (or fully transparent) background, driven by a six-slot color engine with ten animated theme presets and an animated window frame ring. On top of that visual system, the app gains its full product shape:

- a **heading-zoom manuscript** (one continuous document; zoom Full Book → Part → Chapter → Scene; arrows and keys hop siblings) with Word-like toolbar, draggable paragraph blocks, margin comments, drafts with visual diff, and a Speechify-style **TTS Reader**;
- **Obsidian-parity notes** (multi-vault, template picker, hover-preview wiki links, tags/properties/backlinks, note splits) with an agent-first right panel;
- **Scene Crafter canvas boards** (Obsidian-canvas-style drag/resize/connect/pan/zoom) fed by suggested cards and vault Story Plans;
- a **Brainstorm center** (chat + board/map/clusters), an **Aeon-class per-story timeline** (Plan-vs-Progress, Structure, Spreadsheet, Relationships, Subway), and a **star-field vault graph**;
- **four named agents** — Writing Assistant, Brainstorm, Archive, and the new **Beta Reader** — each renameable, with editable identity files (`agent.md` / `instructions.md` / `learning.md` / `soul.md`), per-agent provider/model, and autonomy toggles;
- rebuilt **Settings** (Account, Appearance, Agents, Editor, Vault & Files with vault/story import, Sync & Backup, Shortcuts, About) and a new welcome wizard.

**The prototype is the spec.** Where current app behavior conflicts with the prototype, the prototype wins. Port exact values (hex, px, radii, shadows, animation timings) from the prototype source — never approximate. Do not revert or "clean up" unrelated existing code.

## How this plan is executed (rules of engagement)

- **Build first.** One PR per milestone (or smaller). Do not block on CI; fix CI only when it blocks a build. Local gate before every push: `npm run lint -w frontend`, `npm run typecheck`, scoped vitest for touched files.
- **Merging is Skyy-gated.** Only request a merge at the ⛔ **merge checkpoints** below (where later milestones literally build on the code) — ping Skyy in chat, then keep building anything not blocked.
- **Branches:** `claude/beta3-m<NN>-<slug>` off latest `main` (or off the checkpoint branch it depends on, noted in the PR).
- **Resume protocol** (for Opus / Paperclip picking this up): read this doc top to bottom, check the milestone table's live status, `git fetch` and look for `claude/beta3-m*` branches (work may exist un-PR'd), then continue with the first non-done milestone whose dependencies are merged.

## Milestone table (live status)

| # | Milestone | Phase | Depends on | Status | PR |
|---|-----------|-------|-----------|--------|----|
| M1 | Theme token engine (6 slots, computed vars) | A Theme | — | ✅ | #848 |
| M2 | Presets ×10 + wallpapers + ambience layers | A Theme | M1 | ✅ | #849 |
| M3 | Neon animation (Off/Cycle/Sparkle) + frame ring + transparent window | A Theme | M1 | ✅ | #851 |
| M4 | Appearance settings page (full §1 surface) | A Theme | M1–M3 | ✅ | #852 |
| — | ⛔ **Merge checkpoint 1** (M1–M4) | | | ✅ | |
| M5 | Title bar: menus, command palette, notifications, account | B Shell | CP1 | ✅ | #853 |
| M6 | Workspace tabs v2 (context menu, pop out, agents-idle) | B Shell | CP1 | ✅ | #855 |
| M7 | Nav rail v2 (modules, customize, slim, vault tiles, Stories popover) | B Shell | CP1 | ✅ | #856 |
| M8 | Panels restyle + live status bar | B Shell | CP1 | ✅ | #854 |
| — | ⛔ **Merge checkpoint 2** (M5–M8) | | | ✅ | |
| M9 | Heading-zoom manuscript (continuous doc, 4 zoom levels) | C Story | CP2 | ✅ | #857 |
| M10 | Toolbar v2 + page modes + draggable blocks + width drag | C Story | M9 | ✅ | #873 |
| M11 | Comments (selection bar, gutter, agent actions) | C Story | M9 | ✅ | #872 |
| M12 | Drafts & diff UI | C Story | M9 | ✅ | #859 |
| M13 | Reader (TTS moving highlight, voices, audiobook bar) | C Story | M9, M11 | ✅ | #874 |
| M14 | Structure view + Book preview + export modal | C Story | M9 | ✅ | #861 |
| M15 | Notes tree v2 + templates + multi-vault | D Notes | CP2 | ✅ | #860 |
| M16 | Wiki-link parity + tags/properties/backlinks + splits | D Notes | M15 | ✅ | #876 |
| M17 | Canvas board engine (shared) | E Crafter | CP2 | ✅ | #858 |
| — | ⛔ **Merge checkpoint 3** (M17 — canvas engine) | | | ✅ | |
| M18 | Scene Crafter (setup, cards, plan→board, mini canvas) | E Crafter | CP3 | ✅ | #864 |
| M19 | Brainstorm center (chat + board/map/clusters) | F Modules | CP3 | ✅ | #871 |
| M20 | Timeline v2 (5 views, eras, arcs, minimap, filters) | F Modules | CP2 | ✅ | #862 |
| M21 | Vault graph v2 (stars, pinning, category wheels, inspector) | F Modules | CP2 | ✅ | #863 |
| M22 | Agents: Beta Reader + identity files + autonomy | G Agents | CP2 | ✅ | #878 |
| M23 | Archive plumbing: flags→comments, auto-link, timeline build | G Agents | M11, M20, M22 | 🔀 | #880 |
| M24 | Settings remainder + vault/story import | H Final | CP2 | ✅ | #877 |
| M25 | Welcome wizard v2 | H Final | M2, M24 | ✅ | #875 |
| M26 | Release prep (v0.4.0-beta.1, changelog, installer) | H Final | all | 🔀 | this PR (`claude/beta3-m26-release`) |

Status legend: ⏳ not started · 🔨 in progress · 🔀 in PR (#) · ✅ merged

## Current state & pickup map (updated 2026-07-05, end of Claude Code session)

Phases A + B (M1–M8) are **merged to main** — the stacked M1–M7 PRs were
collapsed into #848 at merge time; M8 landed via #854. Everything below is the
exact state the next agent (Opus / Paperclip team) picks up from.

### 1) Merge queue (all validated green locally; CI re-running on final heads)

Merge in this order — #866 unblocks everything, #858→#864 stack, the rest are
independent (#857 M9 already merged):

| Order | PR | Milestone | Notes |
|---|---|---|---|
| 1 | #866 | main e2e fix | **Merge first** — greens main's own e2e (create-vault restore, Stories-popover trap, neon-frozen perf gates); every other PR re-runs on the fixed base |
| 2 | #858 | M17 canvas engine | Auto-merge armed |
| 3 | #864 | M18 Scene Crafter | **Stacked on #858 — merge #858 first**; diff then shrinks to the SceneCrafter module |
| any | #859 | M12 drafts & diff | Auto-merge armed |
| any | #860 | M15 notes tree | Auto-merge armed; branch carries its own regenerated VR baselines |
| any | #861 | M14 structure/book/export | Auto-merge armed |
| any | #862 | M20 timeline v2 | Auto-merge armed; carries the popover-guard port for its rewritten timeline spec |
| any | #863 | M21 vault graph v2 | Auto-merge armed |
| any | #865 | this handoff doc | Docs-only |

Known follow-up product bugs (referenced by #866, not CI-gating): the nav-rail
Stories popover's outside-click dismissal is broken (the rail's
`backdrop-filter` creates a containing block that clips the fixed backdrop);
consider whether the popover should open at all for zero-story vaults.

**After the last merge:** run the **VR Baselines** workflow on `main`
(Actions → "VR Baselines" → Run workflow, ref `main`) — the merged UI changes
shift the screenshots, and the workflow commits regenerated
`e2e/visual-baselines/` straight back to the ref it runs on. Note:
`GITHUB_TOKEN` pushes don't trigger CI; open PR branches needing fresh checks
after a baseline commit require an empty-commit push ("re-kick").

### 2) In-flight WIP (not a PR yet)

- **M19 Brainstorm center** — branch `claude/beta3-m19-brainstorm` holds ~1k
  lines of salvaged agent WIP (chat restyle + modes partially built), committed
  as `wip(beta3)` at a spend-limit cutoff. It has **not** been validated;
  finish per plan section "M19 · Brainstorm center", merge latest main, fix,
  test, then PR.

### 3) Remaining milestones (not started)

M10 (toolbar v2/page modes), M11 (comments), M13 (TTS reader), M16 (wiki
links/metadata), M22–M23 (agents — also wire the tab-strip `agentsActive`
chip and the notes-tree `onBetaRead`/`onContinuityCheck` props left disabled
in M6/M15), M24 (settings remainder/import), M25 (wizard), M26 (release).
Specs for each are below in this doc; the prototype +
`docs/releases/LIQUID-NEON-PROTOTYPE-MAP.md` are the visual source of truth.

### 4) Hard-won operational notes (read before building)

- **`.app-menu-bar` is now a compat class** carried by the new title bar
  (`.wc-bar`) for ~97 E2E readiness waits. The old App.test assertion that it
  is absent is invalid — it has been deleted on every branch; do not
  reintroduce it when resolving merges (a `merge -X theirs origin/main` can
  resurrect main-side test files — re-check after such merges).
- **tokensAudit ratchet:** no new bare hex in CSS — use `rgb()` literals with
  a `/* prototype #hex */` comment, or `var()`.
- **`--scrim` is the app's modal backdrop token**; the Liquid Neon engine's
  scrim variable is `--ln-scrim`. Don't collide them.
- **Spurious conflicts** in `DesktopShell.tsx` / `AppNavRail.tsx` /
  `WindowChrome.tsx` from the criss-cross merge history: if your branch does
  not touch those files, resolve with `git merge -X theirs origin/main` —
  then re-run the module tests.
- Electron binaries and Actions artifact downloads are proxy-blocked in the
  cloud session environment — E2E is CI-only there; the vr-baselines workflow
  therefore **commits** baselines instead of uploading artifacts.

---

## Phase A — Theme engine (everything else depends on this)

### M1 · Theme token engine
**Spec:** DESIGN-SPEC §1; prototype token block + theme JS (see PROTOTYPE-MAP §B).
**Repo files:** `frontend/src/tokens.css` (new Liquid-Neon-v2 layer + compat aliases so ~120 existing CSS files keep working), new `frontend/src/theme/liquidNeonEngine.ts` (slot state → computed CSS custom properties), `frontend/src/theme.ts` (wire into existing `applyLiquidNeonTokens` pipeline), `frontend/src/global.d.ts` (`AppSettings.liquidNeonV2` additive settings shape), `electron-main/src/ipc.ts` (settings type mirror).
**Build:** six slots A–F (roles: A left panel/primary, B center/wiki-links, C right/agents, D warm data, E cool data, F nav/timeline/frame). Compute and apply `--n1..--n6`, `--b1..--b6` (alpha scales with intensity), `--g1..--g6`, `--gs1..--gs6`, `--bw` (1–4px), `--gr` (8–160px), `--grad`, `--glass`/`--glass2`, `--txH/--txB/--txNH/--txNB`, `--ring`. Defaults exactly: intensity 50%, glass 20% (0–96), blur 1px, scrim 10%, border 1px, glow 60px, page width 1000px (520–3000).
**Accepts when:** panel borders/glows across the app are driven by `--bw`/`--gr`/`--b*` vars; changing a slot recolors its role surfaces live; old theme settings migrate without data loss; unit tests cover the computation (intensity rescale: old 100% == new 50%).

### M2 · Presets + wallpapers + ambience
**Spec:** §1 presets list; PROTOTYPE-MAP §C for exact hexes and animations.
**Repo files:** new `frontend/src/theme/presets.ts`, new `frontend/src/theme/AmbienceLayer.tsx` (+css), asset `frontend/src/assets/cosmic-bg.webp` (from handoff), existing bg-image IPC (`loadBgImage`/save) for custom wallpaper upload.
**Build:** 10 presets (Neon Classic, Aurora, Cyberpunk, Sunset Coast, Emberfall, Ice Mono, Verdant Reach, Royal Arcana, Noir Rose, Winterlight), each = 6 slot colors + background + its own animated ambience (stardust/motes/rain/embers/snow/spores/sparkles/rose dust/snowfall) + idle border animation. Wallpaper modes: Theme match / custom upload / No background.
**Accepts when:** selecting a preset swaps colors+background+ambience in one click and matches the prototype side-by-side; ambience respects `prefers-reduced-motion`; custom wallpaper survives restart.

### M3 · Neon animation + frame ring + transparent window
**Spec:** §1 animation setting; PROTOTYPE-MAP §D.
**Repo files:** `frontend/src/theme/neonAnimation.ts` (drives CSS var rotation), frame ring component in `frontend/src/components/ui/WindowChrome.tsx` region, `electron-main/src/main.ts` BrowserWindow options for `No background` (transparent window; requires relaunch — settings shows a "restart to apply" affordance).
**Build:** Off (per-theme idle shimmer) / Cycle (rotate colors) / Sparkle (palette fade), speed 0.25–30s; square window frame ring (conic `--ring`) togglable independent of animation; reduce-glow accessibility toggle.
**Accepts when:** animation drives BOTH the frame ring and every panel border; speeds match prototype; `No background` renders a fully transparent window on Windows/Linux dev.

### M4 · Appearance settings page
**Spec:** §1 + §10 Appearance; prototype settings template (PROTOTYPE-MAP §A).
**Repo files:** `frontend/src/components/SettingsPanel/sections/AppearanceSection.tsx` (rebuild), new `ColorWheel.tsx`, `frontend/src/settingsCategories.ts`.
**Build:** per-slot curated swatches + full color wheel; intensity/glass/blur/scrim/border/glow sliders; wallpaper picker + upload + none; animation mode/speed; frame ring toggle; reduce glow; text colors (story + optional notes split); manuscript page modes Neon / No glow / Scroll (parchment: tint, opacity, edge runes, glowing-symbols toggle) / Off.
**Accepts when:** every §1 control exists, persists, applies live, and round-trips restart.

### ⛔ Merge checkpoint 1 — ping Skyy
M5+ restyle shell surfaces against the new tokens; building them unmerged would fork the token layer.

## Phase B — Shell

### M5 · Title bar
**Repo files:** `frontend/src/AppMenuBar.tsx`, `frontend/src/components/ui/WindowChrome.tsx`, `frontend/src/GlobalSearchPanel.tsx`→command palette (Ctrl-K: commands/notes/scenes), new `NotificationCenter.tsx` (agent events deep-link to source), `AccountModal.tsx`→account settings page hook, project menu (switch/new/open vault/replay onboarding).
**Accepts when:** every File/Edit/View/Insert/Tools/Help item performs its prototype action; Ctrl-K palette matches; notifications deep-link.

### M6 · Workspace tabs v2
**Repo files:** `frontend/src/WorkspaceTabBar.tsx` (context menu: open to the side → split pane, pop out → FloatingPanelApp, close), agents-idle status chip, restyle to prototype.
**Accepts when:** right-click menu works on every tab; drag/reorder preserved; status chip reflects agent activity.

### M7 · Nav rail v2
**Repo files:** `frontend/src/AppNavRail.tsx` + `workspaceTabKinds.ts` (module set becomes Story Writer / Notes / Scene Crafter / Brainstorm / Timeline / Vault Graph + Settings), existing navConfig customize popover, new slim icon-only mode, vault tiles (per-universe) with minimized `+`, Stories popover on Story Writer (switch/new: name, genre, tone, POV → creates a Story Plan note in the vault; timeline is per-story).
**Accepts when:** all six modules navigate; Stories popover creates a story + plan note; vault tiles switch vaults.

### M8 · Panels + status bar
**Repo files:** `frontend/src/GlobalRightSidebar.tsx`, `LeftRail.tsx`, `BottomBar.tsx` (live word/char/read-time), glass restyle per slot roles.
**Accepts when:** left/right panels collapse + drag-resize; status bar counts update live while typing.

### ⛔ Merge checkpoint 2 — ping Skyy
All module rebuilds (C–H) render inside this shell.

## Phase C — Story Writer

### M9 · Heading-zoom manuscript
**Spec:** §3; PROTOTYPE-MAP §D heading-zoom. **The centerpiece.**
**Repo files:** evolves `frontend/src/lib/headingFocus.ts` + `HeadingFocusExtension.ts` + `DepthSlider.tsx` + `DesktopShell.tsx` depth views into a single continuous-document model (`frontend/src/story/ManuscriptView.tsx` new); scene files remain the storage unit (vault layer untouched — same backup contract as Beta 2, locked by tests); zoom levels Full Book / Part (H1) / Chapter (H2) / Scene (H3); breadcrumbs; collapsible headings; scene status dots (todo/draft/done) click-cycle; navigator `+`; drag scenes to restructure (navigator + Structure). Lazy-mount windowing per issue #843.
**Accepts when:** arrows (toolbar + floating page edges + ←/→) hop same-level siblings at every zoom; typing anywhere persists to the right scene file; version snapshots still carry full scene text; 1,000-scene story scrolls smoothly.

### M10 · Toolbar v2 + page modes + blocks
**Repo files:** `FormatToolbar.tsx` (style/font/size dropdowns per prototype + Read/Dictate/Assist buttons), `PageChromeToolbar.tsx`→page-width slider + drag page edges (520–3000, fulfills #842), paragraph drag blocks (grip in margin) in `RichTextEditor.tsx`/`BlockEditor.tsx`, page modes incl. Scroll parchment (from M4 tokens).
**Accepts when:** toolbar matches prototype control-for-control; paragraphs drag with drop indicator; page edges drag-resize.

### M11 · Comments
**Repo files:** new `frontend/src/story/CommentsGutter.tsx` + selection comment bar; extends BetaRead margin work (`BetaReadMargin.tsx`); agent comments carry Archive's 3 actions (edit notes to match / suggest story change / ignore); Focus mode hides with override.
**Accepts when:** select text → comment; comments dock in the margin gutter aligned to anchors; agent actions wired to suggestion IPC.

### M12 · Drafts & diff
**Repo files:** builds on `SceneHistory.tsx` / `versions.ts` / `snapshots.ts`; new drafts popover in the editor header (per-document list, snapshot frequency + keep-count settings), side-by-side previous draft with Highlight-changes ON (inline red/green), Full-diff view with draft selector.
**Accepts when:** diff matches prototype visuals; restore keeps working; settings persist.

### M13 · Reader (TTS)
**Repo files:** builds on `hooks/useTtsPlayer.ts` + `electron-main/src/voice.ts` (Piper already integrated; add per-heading/body chunked reading + word-window moving highlight, ±10s and ±scene skips, speed 50–200%, from-cursor/from-start/selection); voice list = system + Edge naturals (if available) + Piper/Kokoro models; docks under Comments in the gutter; audiobook bar in Book preview.
**Accepts when:** moving highlight tracks audio; skip controls work; voice picker lists available engines gracefully.

### M14 · Structure view + Book preview + export
**Repo files:** `ManuscriptStructureView.tsx` (grid/list scene cards, drag restructure, Save-the-Cat beat sheet right panel), `FullBookPreviewView` → compiled read-only Book preview with working comments + audiobook bar, `ExportDialog.tsx` modal (PDF new + DOCX/EPUB existing, scope, synopsis/separators toggles).
**Accepts when:** restructure via drag persists; export produces all three formats.

## Phase D — Notes Editor

### M15 · Tree v2 + templates + multi-vault
**Repo files:** `frontend/src/components/VaultBrowser/` (drag move/reorder, context menu: open in new tab / beta read / continuity check / rename / delete), `TemplatePicker.tsx` (Character/Location/Faction/Item·System/Event·History/Blank), vault switcher per universe (extends notes-vault IPC; imported vaults appear as second vault).
**Accepts when:** every context-menu action works; templates create correctly-frontmattered notes; two vaults switch cleanly and Brainstorm reads both.

### M16 · Wiki links parity + metadata panels + splits
**Repo files:** `WikiLinkExtension.ts`/`crossTabLinkResolver.ts` (hover preview card, unresolved dashed → click-would-create), new `NoteProperties.tsx`/`Backlinks.tsx` panels, tags inputs, right panel defaults to Brainstorm chat + continuity flags (3 actions), note splits + draft compare in `NotesTabPanel.tsx`/`SplitEditorPane.tsx`.
**Accepts when:** hover previews render note content; unresolved click creates the note; backlinks list is live; splits work.

## Phase E — Scene Crafter

### M17 · Canvas board engine ⛔ (checkpoint 3 after merge)
**Repo files:** new `frontend/src/canvas/CanvasBoard.tsx` (+ layout lib + tests): dotted grid, draggable corner-resizable cards with per-slot neon borders, ⚯ bezier connectors, pan (left-drag empty / right-drag anywhere), scroll zoom + buttons + Fit, add/delete cards, card-icon → open vault note. Persistence: `.canvas`-style JSON in the Notes Vault (Obsidian-canvas-compatible where practical).
**Accepts when:** all interactions match prototype physics; boards persist and reload; unit tests cover layout math.

### M18 · Scene Crafter module
**Repo files:** `frontend/src/pages/SceneCrafter/` rebuild: Scene Setup (title/POV/goal/conflict, beats, tone chips, length), suggested cards panel (searchable, grouped, click/drag to board), plan cards from vault Story Plans → Draft board button → canvas board under BOARDS; editor right-panel Scenes tab with live mini canvas (pan/zoom, Open full).
**Accepts when:** end-to-end: setup → suggested cards → draft board → canvas appears in BOARDS and mini canvas.

## Phase F — Brainstorm · Timeline · Graph

### M19 · Brainstorm center
**Repo files:** `BrainstormPage.tsx` becomes the Agent Chat page (activity feed right), plus Board / Map (idea mind-map clustered by collection) / Clusters (gravity bubbles) modes on the M17 canvas engine; canvas tools select/connect/frame/text.
**Accepts when:** chat still files notes (existing IPC); all three visual modes render vault ideas.

### M20 · Timeline v2 (Aeon-class)
**Repo files:** `TimelineRoot.tsx` grows to five views — keep Spreadsheet; new Plan-vs-Progress (written = color, planned-from-notes = greyscale, "you are here"), Structure, Relationships (presence dots per character), Subway (per-character colored lines through event stations — evolves `TrackTimeline`/`AeonLaneView`); eras ruler, arcs, chapters strip, key events, characters, world events, themes, mini-map scrubber; View/Group/Show filters + Today jump.
**Accepts when:** all five views render the same event data; Subway matches prototype; minimap scrubs.

### M21 · Vault graph v2
**Repo files:** `VaultGraphView.tsx`: star-glow nodes colored by category (incl. History/Lore), drag-to-pin, Re-layout re-runs force sim, per-category color wheels, separate note↔note vs story↔note line colors, Story cluster toggle, node inspector.
**Accepts when:** visuals match prototype; pin + re-layout behave; inspector lists connections.

## Phase G — Agents & data plumbing

### M22 · Four agents + identity files
**Repo files:** `electron-main/src/` agents infra + settings (`AgentsSection.tsx`, `ArchiveAgentSection.tsx`): add **Beta Reader** (reader-eye chapter reads → reactions as margin comments via M11); all agents renameable; per-agent `agent.md`/`instructions.md`/`learning.md`/`soul.md` files (app-dir, editable in Settings, injected into prompts); provider (Claude API/local) + per-agent model + autonomy auto-apply toggles (extends existing budgets/auto-apply).
**Accepts when:** Beta Reader produces margin comments on request; editing identity files changes agent behavior; renames propagate across UI.

### M23 · Archive plumbing
**Repo files:** continuity engine (`electron-main` archive modules) → flags surface as actionable manuscript comments (M11 actions), auto-`[[link]]`ing (exists — verify against new editor), timeline auto-build from vault plans + written scenes feeding M20 (incl. planned-vs-written classification + skip-backward flags).
**Accepts when:** a continuity flag appears as a margin comment with 3 working actions; timeline populates without manual entry.

## Phase H — Settings, import, onboarding, ship

### M24 · Settings remainder + import
**Repo files:** SettingsPanel categories per §10: Account & profile (avatar, plan, devices), Editor, Vault & Files (location, **Move vault** defaulting local, maintenance, **Import vault** [Obsidian/Notion/Scrivener/Markdown → current-as-second or new], **Import story** [docx/gdocs/md/scriv/epub → headings→structure + plan note], danger zone), Sync & Backup (existing backup/restore + runbook), Shortcuts, About.
**Accepts when:** every §10 page exists; Obsidian import reuses the Beta-2 wizard flow; story import produces correct chapter/scene splits.

### M25 · Welcome wizard v2
**Repo files:** `OnboardingWizard.tsx` restyle + genre + theme steps per prototype (4 entry paths preserved).

### M26 · Release prep
Version bump, curated changelog, Windows installer via `release.yml` dispatch (tag pushes are proxy-blocked from Claude Code's environment — see Beta-2 notes), publish handoff to Skyy.

---

## Known constraints carried from Beta 2

- Playwright E2E cannot run in the Claude Code container (Electron binary downloads blocked) — E2E is CI's job and CI is explicitly non-blocking this cycle.
- The self-hosted runners intermittently receive shutdown signals mid-job; red CI ≠ red code. Re-runs usually clear it.
- `release.yml` has a notes-quoting bug (workaround: paste CHANGELOG section at publish).
- Scene files + version snapshots are sacred: every manuscript milestone must keep the per-scene storage + backup contract locked by the existing contract tests.
