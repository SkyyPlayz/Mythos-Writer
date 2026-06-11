# Changelog

All notable changes to Mythos Writer are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Mythos Writer uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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

[Unreleased]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SkyyPlayz/Mythos-Writer/releases/tag/v0.1.0
