# Changelog

All notable changes to Mythos Writer are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Mythos Writer uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.3.0-beta.2] — 2026-07-03

### Added

- **Split panes** — Drag a workspace tab to the right edge of the window (or Shift+click / Shift+Enter a tab) to open Scene Crafter, Timeline, Entities, Graph, or Brainstorm in a right-hand split pane beside your editor. The pane persists across restarts. ([PR #844](https://github.com/SkyyPlayz/Mythos-Writer/pull/844))
- **Timeline view switcher** — One timeline home with a Spreadsheet | AEON | AEON Track toggle and a group-by control (arc/chapter/character/location); your view choice and grouping persist across restarts. ([PR #838](https://github.com/SkyyPlayz/Mythos-Writer/pull/838))
- **Hear replies in Brainstorm** — Per-reply Hear/Stop buttons and a session mute toggle, matching the Writing Assistant's voice controls. ([PR #841](https://github.com/SkyyPlayz/Mythos-Writer/pull/841))
- **Back up & restore app data** — Buttons in Settings → Vaults export all app-private data (manifests, snapshots, suggestion DB) to a single archive and restore it, with a native file picker and a confirm step. ([PR #839](https://github.com/SkyyPlayz/Mythos-Writer/pull/839))
- **Obsidian vault import** — Onboarding Path 3 now really imports: a dry-run report (file counts, folders, samples) before anything is touched, then import with inline, retryable errors. ([PR #831](https://github.com/SkyyPlayz/Mythos-Writer/pull/831))
- **Text alignment buttons** — Left/center/right/justify in the format toolbar for both Story and Notes editors; unaligned documents stay byte-identical on disk. ([PR #837](https://github.com/SkyyPlayz/Mythos-Writer/pull/837))
- **Chapter interlude text** — Chapter-owned prose (an epigraph or interlude that belongs to no scene) is editable in Chapter view. ([PR #830](https://github.com/SkyyPlayz/Mythos-Writer/pull/830))
- **Heading focus (H1–H6 views)** — Narrow the scene editor to a single heading section, Word-outline style, and step between same-level headings; scene version backups always keep the full text. ([PR #830](https://github.com/SkyyPlayz/Mythos-Writer/pull/830))
- **Nav rail customization that works** — The Settings nav-bar section (items, order, labels/icons, start collapsed) now actually drives the rail; Brainstorm joins the rail; the "+" tab button opens a content picker; on-canvas edge arrows step scenes/chapters from the page edges. ([PR #829](https://github.com/SkyyPlayz/Mythos-Writer/pull/829))
- **Graph quality-of-life** — The Notes/Story/Both scope filter persists across sessions, and scene nodes in the pop-out graph window open in the main window. ([PR #835](https://github.com/SkyyPlayz/Mythos-Writer/pull/835))

### Changed

- **Settings internals re-modularized** — SettingsPanel is a thin orchestrator over extracted section components again (no visible change). ([PR #836](https://github.com/SkyyPlayz/Mythos-Writer/pull/836))
- **Design polish (Part H)** — Low-contrast text fixed to meet the 4.5:1 floor, the worst bare-color CSS migrated to Liquid Neon tokens with a regression ratchet, and reduced-motion now also covers smooth scrolling. ([PR #834](https://github.com/SkyyPlayz/Mythos-Writer/pull/834))

### Fixed

- **Auto-update now works in shipped builds** — Packaged binaries previously had the updater silently disabled by a build-shell-only environment flag; it is now on by default when packaged (`MYTHOS_AUTO_UPDATE=0` remains a kill switch). This is the first release whose binaries can self-update to the next one. ([PR #833](https://github.com/SkyyPlayz/Mythos-Writer/pull/833))
- **Voice is audible and obeys your settings** — Locally- and cloud-synthesized speech is actually played (previously only the OS fallback voice made sound), and volume, rate, voice, persistent mute, microphone device, and input language all take effect; the Writing Assistant mic is reachable in the real app. ([PR #832](https://github.com/SkyyPlayz/Mythos-Writer/pull/832), [#829](https://github.com/SkyyPlayz/Mythos-Writer/pull/829))
- **Notes tab wiki links** — The `[[` autocomplete popup was permanently empty and every link rendered as unresolved in the primary Notes tab. ([PR #829](https://github.com/SkyyPlayz/Mythos-Writer/pull/829))

## [0.3.0-beta.1] — 2026-07-02

### Added

- **App shell overhaul (v0.3 UX)** — An always-mounted navigation rail on the left edge, Settings reorganized into categories, and first-class workspace tabs: reorder tabs with the keyboard, scroll overflowing tab strips, open any panel as a tab, and pick new tabs from a dedicated picker. The nav rail itself is customizable. ([PR #768](https://github.com/SkyyPlayz/Mythos-Writer/pull/768), [#674](https://github.com/SkyyPlayz/Mythos-Writer/pull/674), [#817](https://github.com/SkyyPlayz/Mythos-Writer/pull/817))
- **Wiki links in the editor** — Type `[[` for entity autocomplete with alias support; unresolved links get distinct styling, wiki-link candidates surface in the Notes tab, and links feed the vault graph view. ([PR #821](https://github.com/SkyyPlayz/Mythos-Writer/pull/821), [#814](https://github.com/SkyyPlayz/Mythos-Writer/pull/814))
- **Chapter continuous view** — Read a whole chapter as one flow with per-scene editable bands, a heading-driven (H1–H6) view model, and depth navigation that crosses chapter boundaries. ([PR #664](https://github.com/SkyyPlayz/Mythos-Writer/pull/664), [#684](https://github.com/SkyyPlayz/Mythos-Writer/pull/684), [#790](https://github.com/SkyyPlayz/Mythos-Writer/pull/790))
- **Richer text formatting** — H4–H6 headings, a line-spacing control, and paragraph/heading text alignment that persists across sessions. Notes and Manuscript now share a single rich-text editor core with a formalized mark schema. ([PR #823](https://github.com/SkyyPlayz/Mythos-Writer/pull/823), [#825](https://github.com/SkyyPlayz/Mythos-Writer/pull/825), [#820](https://github.com/SkyyPlayz/Mythos-Writer/pull/820), [#808](https://github.com/SkyyPlayz/Mythos-Writer/pull/808))
- **AEON timeline track interactions** — Hover tooltips, detail popovers, per-track context menus, and full keyboard navigation on timeline tracks; scene markers render only in the visible viewport for smooth scrolling on long timelines. ([PR #816](https://github.com/SkyyPlayz/Mythos-Writer/pull/816), [#824](https://github.com/SkyyPlayz/Mythos-Writer/pull/824))
- **Archive → Scene Crafter suggestions** — The Archive agent can emit scene suggestions directly onto the Scene Crafter board, gated behind a settings toggle. ([PR #822](https://github.com/SkyyPlayz/Mythos-Writer/pull/822))
- **Account modal** — Shows your local profile and app info (version, vault locations) with a reveal-in-file-manager shortcut. ([PR #827](https://github.com/SkyyPlayz/Mythos-Writer/pull/827))
- **Multi-vault graph scope selector** — Choose which vaults feed the graph view. ([PR #778](https://github.com/SkyyPlayz/Mythos-Writer/pull/778))
- **In-app "Clear All Data" control** — Reset the app to a fresh state without hunting for files on disk. ([PR #788](https://github.com/SkyyPlayz/Mythos-Writer/pull/788))
- **Responsive layout clamping** — Sidebars clamp so the editor always retains a usable minimum width on narrow windows. ([PR #704](https://github.com/SkyyPlayz/Mythos-Writer/pull/704))

### Changed

- **Panel homes** — The Brainstorm panel moved into the global right sidebar; Writing Assistant, Continuity, and Preview panels moved to the left sidebar, with pop-out behavior fixed along the way. ([PR #761](https://github.com/SkyyPlayz/Mythos-Writer/pull/761), [#807](https://github.com/SkyyPlayz/Mythos-Writer/pull/807), [#803](https://github.com/SkyyPlayz/Mythos-Writer/pull/803))
- **Sample-project banner** — Now dismissible instead of permanent. ([PR #787](https://github.com/SkyyPlayz/Mythos-Writer/pull/787))

### Fixed

- **Auto-update was silently disabled in every shipped build** — The updater required a runtime environment flag (`MYTHOS_AUTO_UPDATE=1`) that the release pipeline only set in the CI build shell, so no packaged binary ever checked for updates. Packaged builds now auto-update by default; `MYTHOS_AUTO_UPDATE=0` remains as an explicit kill switch, and dev/test builds stay inert.
- **Numeric input validation** — Daily-goal, Timeline word-count, and timestamp day-entry fields no longer accept or mangle partial/invalid numeric input. ([PR #800](https://github.com/SkyyPlayz/Mythos-Writer/pull/800), [#796](https://github.com/SkyyPlayz/Mythos-Writer/pull/796), [#793](https://github.com/SkyyPlayz/Mythos-Writer/pull/793), [#804](https://github.com/SkyyPlayz/Mythos-Writer/pull/804))
- **Errors surfaced instead of swallowed** — NoteViewer saves, draft history, Progress Dashboard streak resets, archive loads, and beta-read scans now report failures to the user instead of silently pretending success. ([PR #792](https://github.com/SkyyPlayz/Mythos-Writer/pull/792), [#795](https://github.com/SkyyPlayz/Mythos-Writer/pull/795), [#791](https://github.com/SkyyPlayz/Mythos-Writer/pull/791), [#786](https://github.com/SkyyPlayz/Mythos-Writer/pull/786), [#785](https://github.com/SkyyPlayz/Mythos-Writer/pull/785))
- **Vault-read resilience** — Unreadable directories are skipped and vault metadata is honored instead of failing the whole vault scan. ([PR #780](https://github.com/SkyyPlayz/Mythos-Writer/pull/780))
- **Write-order safety in floating panels** — Scene files are written before the manifest, preventing manifest/file skew if the app is interrupted mid-save. ([PR #801](https://github.com/SkyyPlayz/Mythos-Writer/pull/801))
- **Quick-entry persistence** — Blank quick-entry saves are rejected, and scene/quick-entry persistence is guarded against partial writes. ([PR #782](https://github.com/SkyyPlayz/Mythos-Writer/pull/782), [#781](https://github.com/SkyyPlayz/Mythos-Writer/pull/781))
- **Frontmatter escaping** — Inline-array frontmatter values containing commas are quoted correctly. ([PR #799](https://github.com/SkyyPlayz/Mythos-Writer/pull/799))
- **Sidebar layout regressions** — No more doubled right sidebar in Notes mode; the global right sidebar persists across Notes and Brainstorm modes. ([PR #812](https://github.com/SkyyPlayz/Mythos-Writer/pull/812), [#811](https://github.com/SkyyPlayz/Mythos-Writer/pull/811))
- **Settings tab keyboard navigation** — Category tabs regained full ARIA APG arrow-key navigation after a regression. ([PR #815](https://github.com/SkyyPlayz/Mythos-Writer/pull/815))

### Security

- **Path-containment guards** — Snapshots, journal, and vault-integrity IPC handlers now resolve and contain paths before touching disk. ([PR #774](https://github.com/SkyyPlayz/Mythos-Writer/pull/774))
- **Backup hardening** — Backup archives redact secrets, and restore is protected against zip-slip extraction attacks. ([PR #773](https://github.com/SkyyPlayz/Mythos-Writer/pull/773))
- **Floating-panel IPC guards** — Dock-back and pin IPC channels now verify the sender frame. ([PR #770](https://github.com/SkyyPlayz/Mythos-Writer/pull/770))

## [0.2.0-beta.2] — 2026-06-17

### Added

- **App UX overhaul — moveable, dockable, floatable panels** — Every panel is now a first-class workspace citizen. Drag panels across sidebars with ghost preview and drop zones (Wave 2b), detach any panel as a free-floating window (Wave 2c), dock panels as top-level tabs in the main shell (Wave 2d), split the manuscript view to edit two scenes side by side (Wave 2e), and save any arrangement as a named layout for instant recall (Wave 2f). Cross-tab links and tab-aware keyboard shortcuts keep every view connected. ([PR #478](https://github.com/SkyyPlayz/Mythos-Writer/pull/478), [#493](https://github.com/SkyyPlayz/Mythos-Writer/pull/493), [#497](https://github.com/SkyyPlayz/Mythos-Writer/pull/497), [#505](https://github.com/SkyyPlayz/Mythos-Writer/pull/505), [#535](https://github.com/SkyyPlayz/Mythos-Writer/pull/535))

- **Vault Graph** — Interactive visualization of every entity connection in your story vault. Filter by folder, adjust link depth, search and highlight nodes, and navigate to any scene or entity in one click. Includes empty-vault, loading, and large-vault states plus full keyboard accessibility. ([SKY-1760](https://github.com/SkyyPlayz/Mythos-Writer/issues/1760)–[SKY-1765](https://github.com/SkyyPlayz/Mythos-Writer/issues/1765))

- **Scene Crafter** — Full Kanban board for scene planning with drag-and-drop scene cards, keyboard-accessible drag-drop, file-watcher conflict detection, and complete IPC board-mutation channels. ([PR #492](https://github.com/SkyyPlayz/Mythos-Writer/pull/492), [#499](https://github.com/SkyyPlayz/Mythos-Writer/pull/499), [#527](https://github.com/SkyyPlayz/Mythos-Writer/pull/527))

- **Continuity Peek** — A sidebar tab that surfaces entity matches in the active scene in real time, letting you spot unintended repetition without leaving the manuscript. ([PR #515](https://github.com/SkyyPlayz/Mythos-Writer/pull/515))

- **Notes tab layout** — Dedicated Notes view with a vault file tree, embedded editor, Brainstorm sidebar, and toggleable sub-views. The Notes vault is now a fully first-class workspace surface. ([SKY-2096](https://github.com/SkyyPlayz/Mythos-Writer/issues/2096))

- **Onboarding v2.1 — genre picker + sample vaults** — The first-run wizard now opens with a genre picker (Cozy Fantasy, Sci-Fi Noir, Mystery). Selecting a genre loads a pre-seeded sample vault with era-appropriate characters, locations, and scenes. ([PR #517](https://github.com/SkyyPlayz/Mythos-Writer/pull/517), [#521](https://github.com/SkyyPlayz/Mythos-Writer/pull/521))

- **Liquid Neon Companion — four new plugin skins** — Dataview (LN-51, launch-blocker), Calendar (LN-54), Kanban, and Advanced Tables (LN-55) now render natively in the Liquid Neon palette, completing first-pass coverage of the most-used Obsidian community plugins. ([PR #523](https://github.com/SkyyPlayz/Mythos-Writer/pull/523), [#524](https://github.com/SkyyPlayz/Mythos-Writer/pull/524), [#526](https://github.com/SkyyPlayz/Mythos-Writer/pull/526), [#532](https://github.com/SkyyPlayz/Mythos-Writer/pull/532))

- **Vault browser sort + filter controls** — Sort entries by name, date modified, or type; filter by entity category. ([SKY-1982](https://github.com/SkyyPlayz/Mythos-Writer/issues/1982))

- **Vault picker polish** — Editable path input with inline validation, recent-vault suggestions, and a conflict dialog when two vaults share overlapping directories. ([PR #530](https://github.com/SkyyPlayz/Mythos-Writer/pull/530))

- **New app icon** — Fantasy-book artwork replaces the placeholder icon across all surfaces. ([SKY-2081](https://github.com/SkyyPlayz/Mythos-Writer/issues/2081))

### Changed

- **Settings dialog a11y** — ARIA labels, visible focus rings, and full keyboard navigation across all settings panels. ([PR #511](https://github.com/SkyyPlayz/Mythos-Writer/pull/511))
- **Standardized IPC error shape + breadcrumb logging** — All IPC handlers now emit a consistent `{ code, message, breadcrumbs }` error envelope. ([SKY-1970](https://github.com/SkyyPlayz/Mythos-Writer/issues/1970))
- **Shared Toast notification component** — A unified `useToast` hook and `Toast` component replace four divergent call sites. ([PR #512](https://github.com/SkyyPlayz/Mythos-Writer/pull/512))
- **Incremental vault-index rebuild** — The vault index skips unchanged files by mtime+size, reducing startup time on large vaults. ([SKY-1981](https://github.com/SkyyPlayz/Mythos-Writer/issues/1981))
- **Empty-state copy refresh** — Vault Browser and Entries Panel show friendlier guidance when empty. ([SKY-1997](https://github.com/SkyyPlayz/Mythos-Writer/issues/1997))

### Fixed

- **Scene Crafter watcher leak** — File-watcher handles are cleaned up when the panel unmounts. ([SKY-1805](https://github.com/SkyyPlayz/Mythos-Writer/issues/1805))
- **Settings dialog focus** — The Settings dialog recaptures focus correctly after an async load. ([SKY-1902](https://github.com/SkyyPlayz/Mythos-Writer/issues/1902))
- **Vault routing edge cases** — Missing-vault recovery screen appears only when both vaults are absent; a missing story-vault alone shows the story-vault recovery path. ([SKY-2095](https://github.com/SkyyPlayz/Mythos-Writer/issues/2095), [SKY-2097](https://github.com/SkyyPlayz/Mythos-Writer/issues/2097))
- **Stray vault directory creation** — The app no longer creates blank vault directories on launch; defaults now live in `userData`. ([SKY-2157](https://github.com/SkyyPlayz/Mythos-Writer/issues/2157))
- **Liquid Neon panel preset** — Default panel color preset corrected to dark glass. ([SKY-2097](https://github.com/SkyyPlayz/Mythos-Writer/issues/2097))

### Security

- **`markdown-it` 14.1.0 → 14.2.0** — Patches [GHSA-6v5v-wf23-fmfq](https://github.com/advisories/GHSA-6v5v-wf23-fmfq) (ReDoS via malformed HTML). ([PR #522](https://github.com/SkyyPlayz/Mythos-Writer/pull/522))

---

---

## [0.2.0] — 2026-06-10

### Added

- **Cloud-sync vault placement** — Move your Story Vault into a cloud-synced folder (Dropbox, iCloud, OneDrive, or any provider with a guided local sync folder) via a new Move Vault wizard. Includes conflict detection before the move, a last-modified-time-wins conflict resolver for concurrent two-machine edits, and a lockfile guard that prevents partial syncs from corrupting your vault. ([PR #357](https://github.com/SkyyPlayz/Mythos-Writer/pull/357))
- **Voice provider unification + device selector** — All speech features now share a single provider panel. Select your microphone once; pick your STT and TTS provider in one place. Supports all previously-separate voice provider integrations. ([PR #336](https://github.com/SkyyPlayz/Mythos-Writer/pull/336))
- **Granular per-category auto-apply** — Every suggestion category now has its own auto-apply toggle. Apply dialogue corrections automatically while keeping manual review for prose rewrites or chapter titles.
- **Liquid Neon third accent border** — The Liquid Neon theme adds a third accent-color variant for border styling, expanding visual customization options.
- **Global search FTS seed** — Full-text search index is seeded correctly on first launch and in E2E test runs, so search results are complete from day one. ([PR #312](https://github.com/SkyyPlayz/Mythos-Writer/pull/312))
- **Two-vault workspace** — Story Vault and Notes Vault are now distinct on-disk locations with independent default folder structures, each initialised on first use. ([SKY-9](https://github.com/SkyyPlayz/Mythos-Writer/issues/9))
- **First-run onboarding wizard** — three-path welcome flow: start a blank project, import an existing vault, or open the bundled sample project. Wizard is skipped on subsequent launches; can be re-triggered from Settings. ([SKY-12](https://github.com/SkyyPlayz/Mythos-Writer/issues/12))
- **Manuscript Structure View** — card-based scene board grouped by chapter with drag-and-drop reorder (Ctrl+Z undo), a Save the Cat 3-Act beat-sheet sidebar, and a List/Card view toggle; includes SceneCard, SceneGrid, BeatSheetSidebar, and ListView components. ([SKY-565](https://github.com/SkyyPlayz/Mythos-Writer/issues/565))
- **Entity aliases** — entities support a `aliases` frontmatter field; the editor UI and Brainstorm extraction both resolve alternative names to the canonical entity. ([SKY-191](https://github.com/SkyyPlayz/Mythos-Writer/issues/191))
- **Automatic Linker** — background agent auto-wraps entity mentions in `[[wiki-links]]` as you write, keeping the Notes Vault graph connected without manual linking. ([SKY-192](https://github.com/SkyyPlayz/Mythos-Writer/issues/192))
- **Templater (Mythos edition)** — variable, prompt, and entity-pick template types for inserting structured snippets into scenes and notes. ([SKY-190](https://github.com/SkyyPlayz/Mythos-Writer/issues/190))
- **One-click default vault setup + multi-vault switcher** — first launch pre-creates the default vault at `~/Mythos` with a starter structure; the Project Switcher supports adding, removing, and switching between multiple vaults. ([SKY-320](https://github.com/SkyyPlayz/Mythos-Writer/issues/320))

### Changed

- **Onboarding wizard polish** — Step alignment corrected across screen sizes; the bundled sample novel project now loads correctly on the "open sample project" path. ([PR #344](https://github.com/SkyyPlayz/Mythos-Writer/pull/344))
- **`@anthropic-ai/sdk` 0.24.3 → 0.100.1** — major SDK version bump; picks up streaming improvements, model-alias updates, and official tool-use helpers. ([SKY-49](https://github.com/SkyyPlayz/Mythos-Writer/issues/49))
- **Electron + builder chain upgrade** — upgraded Electron and the packaging toolchain to clear all high-severity audit advisories flagged against prior versions. ([SKY-453](https://github.com/SkyyPlayz/Mythos-Writer/issues/453))
- **`docx` 8.5.0 → 9.7.1** — minor breaking API changes handled; no user-visible export regressions. ([SKY-52](https://github.com/SkyyPlayz/Mythos-Writer/issues/52))
- **Merged backlog of 11 upstream PRs** — maintenance cycle that kept the working branch current with `main`. ([SKY-21](https://github.com/SkyyPlayz/Mythos-Writer/issues/21))
- **PR and bug-triage cleanup** — stale branches closed, duplicate issues resolved, and CI skew corrected. ([SKY-22](https://github.com/SkyyPlayz/Mythos-Writer/issues/22), [SKY-23](https://github.com/SkyyPlayz/Mythos-Writer/issues/23))

### Fixed

- **Typed-relation suggestion frontmatter persistence** — Entity typed-relation suggestions are now correctly written to frontmatter and survive restarts. Previously the auto-apply step silently reported success even when both manifest lookups missed, dropping the relation without warning.
- **Focus restoration on blank scene entry** — Opening a blank scene now places the cursor in the editor automatically; a second click is no longer required to activate the editor. ([PR #320](https://github.com/SkyyPlayz/Mythos-Writer/pull/320))
- **NotesPanel silent data-loss** — notes written in the Notes panel now persist to the Notes Vault SQLite database; previously all content was discarded on window close. ([SKY-55](https://github.com/SkyyPlayz/Mythos-Writer/issues/55))
- **`better-sqlite3` ABI boot crash** — the dev `start` script now rebuilds the native module against the running Electron ABI before launch, eliminating the crash on first run after an Electron upgrade. ([SKY-67](https://github.com/SkyyPlayz/Mythos-Writer/issues/67))
- **Snapshot toolbar restored** — the "Save snapshot now" button is back in the BlockEditor toolbar after it was dropped during a toolbar refactor. ([SKY-68](https://github.com/SkyyPlayz/Mythos-Writer/issues/68))
- **Vault-missing recovery dialog** — if the configured Story Vault directory has been moved or deleted, the app now displays a recovery dialog instead of crashing silently or showing a blank screen. ([SKY-69](https://github.com/SkyyPlayz/Mythos-Writer/issues/69))
- **Notes Vault creation routing** — note and folder creation calls in the Notes panel were incorrectly routed to the Story Vault writer; they now target the Notes Vault writer. ([SKY-75](https://github.com/SkyyPlayz/Mythos-Writer/issues/75))

### Security

- **Electron 39.8.10 → 42.3.0** — pulls in three Chromium milestone security patches (M122, M123, M124). Renderer sandbox and context-isolation settings are unchanged. ([SKY-54](https://github.com/SkyyPlayz/Mythos-Writer/issues/54))
- **persona:read enum guard (SEC-5)** — IPC handler now validates the `persona` argument against an explicit allowlist before any file access, closing an unauthenticated enumeration vector. ([SKY-102](https://github.com/SkyyPlayz/Mythos-Writer/issues/102))
- **PERSIST_PROMPTS CI guard (SEC-9)** — CI pipeline now asserts that no prompt strings are persisted to disk outside the designated settings path, enforced as a required check on every PR. ([SKY-103](https://github.com/SkyyPlayz/Mythos-Writer/issues/103))
- **persona:reset path-traversal fix (SEC-10)** — added `path.resolve` containment guard to the `agent:persona:reset` IPC handler to block directory-traversal attacks that could delete arbitrary files outside the vault root. ([SKY-575](https://github.com/SkyyPlayz/Mythos-Writer/issues/575))

---

## [0.1.0] — 2025-01-01

Initial internal release.

[Unreleased]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.3.0-beta.1...HEAD
[0.3.0-beta.1]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.2.0-beta.2...v0.3.0-beta.1
[0.2.0-beta.2]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.2.0...v0.2.0-beta.2
[0.2.0]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SkyyPlayz/Mythos-Writer/releases/tag/v0.1.0
