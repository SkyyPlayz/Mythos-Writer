# Mythos Writer — Project Plan

## Purpose

Mythos Writer is a **standalone, local-first, desktop-first** writing application that helps authors, worldbuilders, and storytellers organize and develop their stories, characters, and lore. It is two apps in one shell:

1. **A Word-like writing app** with a block engine. The author writes their story here. Chapters and scenes are stored as **per-chapter / per-scene files** with **versioned drafts** inside the **Story Vault**.
2. **An Obsidian-like notes app** (the **Notes Vault**) where worldbuilding, characters, lore, scene cards, and plans live as linked markdown notes. The Notes Vault is **backwards compatible with existing Obsidian vaults** — users can point Mythos Writer at an existing Obsidian vault and it works, including a **graph view** of vault links.

**Two vaults, one purpose.** The Story Vault holds the manuscript (chapters, scenes, story-specific metadata); agents never edit story files directly. The Notes Vault holds everything the AI agents build and maintain (characters, locations, lore, Scene Crafter boards). Both use standard markdown files and are Obsidian-compatible.

The product is **Option B**: standalone app with Obsidian vault compatibility. **Not** an Obsidian plugin. We read and write Obsidian-style markdown but implement all editor, layout, AI, versioning, timeline, and metadata systems ourselves.

Three named AI agents assist the author across these surfaces. None of them auto-edits the manuscript; the author stays in control of every word. All agent actions are **proposed as suggestions by default** — see *AI Suggestion & Provenance Governance* below.

---

## Goals

### Short-Term (v0.1 – v0.3)
- Working Electron desktop app for Windows first; macOS and Linux follow.
- Word-like writing surface with a **block engine** (block-based rich text).
- Per-chapter and per-scene files saved into the vault as markdown.
- **Story Vault** (chapters, scenes, drafts) and **Notes Vault** (worldbuilding, characters, lore, Scene Crafter boards), both using standard markdown files — **backwards compatible** with existing Obsidian vaults (markdown files, `[[wiki-links]]`, folder layout, graph view).
- **Manifest-backed fast UI** — a `manifest.json` indexes scenes, scene cards, timestamps, suggestions, and provenance for fast load and search; markdown remains the source of truth.
- First cut of the **Writing Assistant** sidebar inside the writing page (advice only; user-configurable scan heartbeat).
- Establish CI/CD pipeline with lint, typecheck, test, and build gates.

### Medium-Term (v0.4 – v0.9)
- Block-based rich text editor with markdown round-trip for manuscript writing.
- **Versioned drafts** of chapters and scenes (snapshots + history, one-click rollback).
- Character and world-building management (entities, relationships, locations) inside the vault.
- **Brainstorm Agent**: chat surface where the author talks through story, world, ideas, goals, and plans (typed or **spoken**); the agent **automatically creates Notes Vault entries** from the conversation (characters, locations, lore — no confirmation required for new notes; confirmation required for edits to existing notes), with provenance recorded for every creation. Can also create **scene ideas and planning notes** usable with the Scene Crafter. Streams responses token-by-token. Hosts the **continuity todo list** in its sidebar (see Archive Agent below).
- **Writing Assistant**: scans manuscript on a user-configurable heartbeat; posts tips, inline comments, and suggestions to the sidebar; **never edits manuscript text automatically**. Has a **Beta-Read Mode** (on demand) that writes Word-style inline comments anchored to highlighted spans, visible in Edit Mode.
- **Archive Agent**: indexes the entire vault and (1) surfaces inconsistencies against the manuscript — flagged issues appear as a **checkbox todo list in the Brainstorm Agent's sidebar** (click to expand, answer inline, route to Brainstorm for resolution), (2) suggests and inserts Obsidian-style `[[wiki-link]]` references from the writing page to vault pages, and (3) builds & maintains the Story Timeline (Phase 5). Single agent for both vault-linking/continuity and timeline duties.
- **Vault Graph View** — Obsidian-style graph of Notes Vault notes and their links (distinct from the Story Timeline).
- **Suggestion governance**: all agent actions create suggestion objects (source, confidence, rationale, timestamp); proposed by default; auto-apply opt-in with thresholds and per-agent budgets; snapshots + audit entries on apply; one-click rollback. *Exception: Brainstorm Agent creates brand-new Notes Vault entries automatically without a confirmation step; proposals only apply to edits of existing notes.*
- Import/export support: **Markdown** (lossless), **DOCX** (for editors/beta readers), **EPUB** (for distribution). PDF is post-MVP.
- Effortless **Obsidian vault import** with conflict resolution and manifest ↔ markdown reconciliation rules.
- Autosave and local file sync via vault watcher.

### Long-Term (v1.0+)
- Full-featured writing suite rivaling tools like Scrivener, but AI-native.
- Multi-project workspace with tagging, search, and cross-reference.
- **Scene Crafter** — first-class Kanban planning board (per story), modeled after the **Obsidian Kanban plugin**. Author drags existing vault notes from the vault browser onto the board to build scenes/beats; cards are vault notes (not a separate store). Columns model status (e.g. Idea → Drafted → Written → Cut). Board itself is a markdown file in the vault so it stays Obsidian-compatible. *Goal-defined first-class feature; targeted later for delivery sequencing only.*
- **Automatic Timeline Builder (Story Timeline)** — first-class **Archive Agent**-driven timeline per story. Archive infers scene timestamps from explicit and implicit time cues with a confidence score, places scenes on a visual timeline, detects overlaps, and surfaces continuity suggestions. Planned-but-unwritten beats appear greyed-out so the author can see the whole arc at a glance. All placements are suggestions until the user confirms (or enables auto-apply).
- **Archive Agent (full scope)** — the third agent owns vault linking/continuity *and* the Story Timeline. Compares manuscript to vault, proposes `[[wiki-links]]` and timeline placements, detects inconsistencies, and offers the explicit action verbs: **Match Archive to Story**, **Suggest Story Change**, or **Ignore**. Can link implicit references after user confirmation. Read-only with respect to the manuscript.
- Optional cloud sync and collaboration features.
- Plugin or template system for genre-specific workflows (fantasy, sci-fi, mystery, etc.).
- Full **macOS and Linux** distribution (signing, notarization).

---

## Development Phases

### Phase 1 — Foundation (Current)
**Status:** In progress

- [x] Electron app scaffolding with electron-vite
- [x] React + TypeScript frontend
- [x] IPC bridge between renderer and main process
- [x] AI agent stubs wired via IPC (full impl in Epic 5)
- [x] Obsidian-compatible markdown vault with file watcher
- [x] Windows packaging (ZIP and NSIS installer)
- [x] GitHub Actions CI (lint → typecheck → test → build)

### Phase 2 — Core Writing Experience
**Status:** Planned

- [ ] Block-based editor component built on **TipTap**, with markdown round-trip
- [ ] **Two-vault layout**: Story Vault (chapters/scenes) + Notes Vault (worldbuilding/lore), each a separate folder path; default Notes Vault structure: `Mythos Vault/Universes/<World>/...` and `Mythos Vault/Story ideas/<Story>/...`
- [ ] Per-chapter / per-scene file layout in the Story Vault
- [ ] Project/vault browser sidebar
- [ ] Save/load documents from vault
- [ ] **Manifest.json schema (v1)** — indexes scenes, entities, suggestions, provenance, and board references. Top-level `"schemaVersion": 1`; older manifests trigger a migration script on app start.
- [ ] Versioned drafts: snapshot on save, history view, one-click rollback
- [ ] Basic settings panel (API key management, theme, per-agent enable/disable, Writing Assistant heartbeat interval, **Archive continuity-check heartbeat** interval)

### Phase 3 — AI-Augmented Authoring
**Status:** Planned

The three named agents:

- [ ] **Writing Assistant** — sidebar inside the writing page. Reads current scene/chapter context and posts tips, inline comments, and suggestions on a user-configurable heartbeat. Supports **voice input** so the author can speak to it instead of typing. Streams responses token-by-token. Never edits the manuscript. Has a **Beta-Read Mode** (on demand) that writes Word-style inline comments anchored to highlighted spans, visible in Edit Mode; comments survive sessions and don't reappear after dismissal.
- [ ] **Brainstorm Agent** — separate chat surface. The author talks through their story, world, ideas, goals, and plans (typed or **spoken**); the agent **automatically creates Notes Vault entries** from the conversation (no confirmation for new notes; confirmation required for edits to existing notes), recording provenance. Can create scene ideas and planning notes usable with the Scene Crafter. Streams responses token-by-token. Hosts the continuity todo list (see Archive Agent).
- [ ] **Archive Agent** — indexes the entire vault. (1) Continuity-checks the manuscript against vault contents and surfaces inconsistencies — runs on save by default, with a configurable heartbeat for periodic re-scans; flagged issues appear as a **checkbox todo list in the Brainstorm Agent's sidebar** (click to expand and resolve inline). (2) Suggests and inserts `[[wiki-link]]` references from manuscript to vault pages. (3) In Phase 5, owns the Story Timeline (infers chronology from both prose and explicit vault markers with a confidence score; marks unwritten beats; detects overlaps). Read-only on the manuscript.
- [ ] **Voice IO subsystem** for Brainstorm + Writing Assistant: speech-to-text (and optional text-to-speech for replies). Local-first where possible; allow opt-in cloud STT if local quality is insufficient.

Supporting work:
- [ ] **Suggestion store + audit log** in **SQLite** (tables for suggestions, audits, provenance, and timeline entries).
- [ ] **Agent API contract** — suggestion payload schema, apply/reject endpoints, auto-apply policy controls, per-agent budget controls.
- [ ] Token-streaming infrastructure (IPC stream channel + cancellation).
- [ ] Prompt history and generation log.
- [ ] User-facing settings: per-agent enable, per-agent model selection, per-agent auto-apply thresholds and budgets, voice on/off + mic selection.

### Phase 4 — Polish & Distribution
**Status:** Future

- [ ] **First-run onboarding**: three paths — (1) Start blank, (2) Import existing Obsidian vault (wizard + dry-run report), (3) Open sample project (recommended for new users — pre-built worldbuilding example showing all three agents and Scene Crafter)
- [ ] Auto-updater (electron-updater) with **Stable** (default) and **Beta** (opt-in) channels
- [ ] macOS build and notarization
- [ ] App signing for Windows
- [ ] Linux packaging (AppImage / deb / rpm — TBD)
- [ ] Public release on GitHub Releases

### Phase 5 — Story Planning Surfaces
**Status:** Future (goal-classified *first-class*; sequenced later for delivery)

- [ ] **Scene Crafter (Kanban)** — per-story visual planning board, Obsidian-Kanban-plugin style. Author drags Notes Vault notes onto columns as a planning workspace (board is not tied to actual story scenes). Cards can be linked to a real story scene via "Link to Story Scene". Board persisted as a markdown file in the vault so Obsidian users can open it natively. Default columns: Ideas → Drafting → Writing → Revised → Cut (configurable).
- [ ] **Vault Graph View** — Obsidian-compatible graph of vault notes and links.
- [ ] **Story Timeline (Automatic Timeline Builder)** — per-story graph/timeline view built on **React Flow**. Archive-driven scene-time inference with confidence (uses both explicit vault markers and prose-derived cues); visual placement; overlap detection; greyed-out planned beats. Target: confirmed placement within 5s.
- [ ] Archive confirmation dialog with the three action verbs: **Match Archive to Story**, **Suggest Story Change**, **Ignore**.

---

## AI Suggestion & Provenance Governance

This applies to all agents that can modify vault content or propose changes.

- **Suggestion objects** carry: `source` (which agent), `confidence`, `rationale`, `timestamp`, `target` (vault path or manuscript anchor), `payload` (proposed change), and `status` (proposed / accepted / rejected).
- **Proposed by default.** Users review and accept in a suggestion review panel — one click to jump to the source of the change.
- **Auto-apply is opt-in**, with configurable confidence thresholds and per-agent budgets (token and rate caps).
- **Provenance** is written for every AI-created or AI-modified vault entry (frontmatter fields linking back to the originating suggestion + run).
- **Snapshots + audit log** on every applied suggestion. **One-click rollback** restores the previous state.
- **Writing Assistant** never writes — only proposes inline comments in the sidebar (heartbeat scans) or Word-style anchored comments in Beta-Read Mode.
- **Brainstorm Agent exception**: new Notes Vault entries are created **automatically** without a confirmation step (creation is the core UX). Edits to *existing* notes always go through the suggestion/confirmation flow.

---

## Tech Stack

| Layer        | Technology                                  |
|--------------|---------------------------------------------|
| Shell        | Electron 33 (desktop runtime)               |
| Frontend     | React 18, Vite, TypeScript                  |
| Main process | Node.js, TypeScript (electron-main package) |
| Editor       | **TipTap** (Word-like block engine, markdown round-trip) |
| AI           | **Model-agnostic / BYO**: cloud APIs (Anthropic Claude, OpenAI, others), local runtimes (Ollama, LM Studio, llama.cpp), or custom OpenAI-compatible endpoints (e.g. HermesAI). MVP ships with Anthropic (`@anthropic-ai/sdk`); full BYO-provider support is the immediate post-MVP milestone. Streaming responses. |
| Voice IO     | Speech-to-text (local-first; opt-in cloud STT fallback); optional TTS for replies |
| Search       | **SQLite FTS5** full-text search across both vaults; fuzzy matching for names; scope toggle (Story / Notes / Both) |
| Timeline UI  | **React Flow** (graph layout for Story Timeline) |
| Storage      | Local markdown vault (Obsidian-compatible, light scope) + `manifest.json` index (versioned via `schemaVersion`) |
| Persistence  | **SQLite** — suggestion / audit / timeline tables |
| Distribution | GitHub Releases (v1); Winget/Homebrew/Linux repos post-v1 if there's demand |
| Build        | electron-vite, electron-builder             |
| Tooling      | ESLint, Prettier, Vitest, GitHub Actions    |

---

## Architecture Overview

```
Mythos-Writer/
├── electron-main/       # Main process: IPC handlers, vault, Claude API calls
│   └── src/
│       ├── main.ts          # App entry, window creation
│       ├── ipc/             # IPC channel handlers
│       └── vault/           # Markdown vault watcher, manifest writer, file ops
├── frontend/            # Renderer process: React UI
│   └── src/
│       ├── App.tsx
│       └── components/      # Editor, sidebar, AI panel, suggestion review, scene board, timeline, graph
├── plans/               # Project planning documents (this folder)
├── .github/workflows/   # CI configuration
└── package.json         # Root workspace (frontend + electron-main)
```

IPC is the communication boundary: the renderer (frontend) never calls the Claude API or touches the filesystem directly — it sends IPC messages to the main process, which handles all privileged operations. The manifest is written by main; renderer reads it for fast UI.

---

## Design Principles

1. **Local-first** — all data lives on the user's machine; no account required to use core features.
2. **Markdown-native** — vault documents are plain `.md` files compatible with Obsidian; existing Obsidian vaults open directly; `manifest.json` is an index, not a source of truth.
3. **Standalone, not a plugin** — Option B. We do not depend on Obsidian's runtime or UI.
4. **AI as a tool, not a replacement** — the author stays in control; AI assists and suggests.
5. **Desktop-quality UX** — feels like a native app, not a web app in a frame.
6. **Open and extensible** — clean architecture that can grow into plugins and templates.
7. **AI Boundaries** — AI never modifies or generates manuscript prose. Writing Assistant only advises. Brainstorm Agent writes to vault notes (with provenance). Archive Agent inserts `[[wiki-links]]`, surfaces inconsistencies, and builds the timeline; it never edits the manuscript.
8. **Suggestion-first** — agent actions are suggestions by default; auto-apply is opt-in; every change is auditable and reversible.

---

## Product Surfaces (Reference)

| Surface              | What it is                                                                                                  | Analogue   |
|----------------------|-------------------------------------------------------------------------------------------------------------|------------|
| Writing page         | The author's manuscript — Word-like block editor for stories, chapters, scenes; per-scene files + versioning| MS Word    |
| Vault                | Notes app for worldbuilding, characters, lore, scene cards, plans; Obsidian-compatible                      | Obsidian   |
| Vault Graph View     | Obsidian-style graph of vault notes and links                                                               | Obsidian   |
| Writing Assistant    | Sidebar on the writing page; scans on heartbeat; tips & inline comments; voice input + streaming replies    | —          |
| Brainstorm Agent     | Separate chat; talk through story/world/ideas (typed or spoken); agent fills vault notes; streaming replies | —          |
| Archive Agent        | Indexer & timeline: checks story against vault, manages `[[wiki-links]]`, builds Story Timeline             | —          |
| Scene Crafter        | Per-story Kanban (Obsidian-Kanban-plugin style); drag vault notes onto columns; board is a vault markdown   | Obsidian Kanban |
| Story Timeline       | Per-story timeline/graph view; greyed-out planned beats; overlap detection                                  | —          |
| Suggestion Review    | Inbox of pending suggestions with accept/reject/ignore; per-agent filters; audit trail and rollback         | —          |

---

## Decisions Log

### MYT-107 review (2026-05-22)

1. **Editor library:** TipTap — Word-like block engine, markdown round-trip.
2. **Obsidian compatibility scope:** Light. We honor `.md` files, folder layout, `[[wiki-links]]`, and graph view. We ignore `.obsidian/` (themes, plugin config).
3. **Archive continuity-check trigger:** On save by default, with a user-configurable heartbeat interval for periodic re-scans. Issues surface in the Brainstorm Agent sidebar (see #10 below).
4. **Persistence engine:** SQLite for suggestions, audit log, and timeline entries.
5. **Manifest versioning:** `"schemaVersion"` field at the top of `manifest.json`; older manifests trigger a migration script on app start.
6. **AI response delivery:** Streaming (token-by-token) for Writing Assistant and Brainstorm Agent. Voice input for both agents — author can speak instead of typing. Optional text-to-speech for replies.
7. **Story Timeline:** React Flow for the graph view. Archive infers scene chronology from **both** explicit vault markers (e.g. frontmatter `date:`) and prose-derived cues, with a confidence score on each placement.
8. **Distribution:** GitHub Releases for v1. Winget / Homebrew / Linux package repos are post-v1 if there's demand.

### MYT-183 Q&A review (2026-05-23)

9. **Obsidian compatibility (CEO decision 0.1):** Keep full backwards-compatibility. Compat is low-cost and doesn't constrain UX innovation. Users can open Mythos Writer vaults in Obsidian and vice versa.
10. **Continuity-issue UI (Q6.6):** Archive Agent continuity issues surface as a **checkbox todo list in the Brainstorm Agent's sidebar** — not a separate Archive sidebar. Click an issue to expand, answer inline (fix note / suggest story change / free-text), the answer routes back to the Brainstorm Agent. Resolved issues are checked off and don't reappear.
11. **AI model / BYO provider (Q4.1 — board override):** The app is **model-agnostic** by design. Any cloud API (Claude, OpenAI, others), local runtime (Ollama, LM Studio, llama.cpp), or custom OpenAI-compatible endpoint (e.g. HermesAI) works. MVP ships Anthropic for simplicity; full BYO-provider support is the immediate post-MVP priority (see #14).
12. **Default Notes Vault folder layout (Q4.5):** `Mythos Vault/Universes/<World>/...` for worldbuilding; `Mythos Vault/Story ideas/<Story>/...` for story-specific notes. Agent falls back to default frontmatter schemas when content doesn't fit the folder hierarchy.
13. **Writing Assistant scan modes (Q5.2 — board override):** Two modes. (a) **Heartbeat scans** (default): background scan on user-set interval; results land in sidebar. (b) **Beta-Read Mode** (on demand): deeper review pass writing Word-style inline comments anchored to highlighted spans, visible in Edit Mode; comments survive sessions and don't reappear after dismissal.
14. **Local-model support at MVP (Q10.4 — board override):** Cloud-only at MVP is acceptable. Full local-model + BYO-provider support is the **highest-priority post-MVP milestone** after launch.

## Open Questions / Decisions Needed

*None currently. New questions will accumulate here as they come up.*

---

## Cross-Cutting Decisions

Applies product-wide; all MVP defaults unless noted.

### Writing Modes

Three editor modes:

| Mode | Description |
|------|-------------|
| **Normal Mode** | Default. Full editor with sidebars, notes, and tools visible. |
| **Focus Mode** | Distraction-free full-screen. User chooses which UI elements stay visible. |
| **Edit Mode** | Review mode showing Writing Assistant suggestions, Archive Agent notes, and Beta-Read comments. |

Header depth slider at the top of the editor (Full Book / Chapter / Scene view) with left/right arrows to step through chapters or scenes without leaving the editor.

### Export (MVP)

Three formats: **Markdown** (lossless, direct), **DOCX** (for editors and beta readers), **EPUB** (for distribution). PDF is post-MVP.

### Search

Single search bar across both vaults with scope toggle (Story / Notes / Both). Indexed with **SQLite FTS5** for fast full-text search; fuzzy matching for character and location names.

### Accessibility

Targeting **WCAG 2.1 AA** at MVP: full keyboard navigation, screen-reader-friendly markup, high-contrast theme, configurable font size and line spacing.

### Telemetry

**Opt-in only**, off by default. Anonymized crash reports and feature-usage counts only — never vault content, scenes, notes, or chat. A clear toggle in settings lists exactly what is sent.

### Multi-Project

MVP supports **one project at a time** with a fast project switcher in the title bar. The data model is multi-project-ready from day one. Multi-project workspaces (side-by-side, cross-project search) are post-MVP.

### Performance Budget

Target smooth UX for: **1,000 scenes** in the Story Vault, **5,000 notes** in the Notes Vault, **500 MB** total vault size. Larger projects are supported but may show slower views. Regressions below these thresholds are treated as bugs.

### Data on Uninstall

User vaults always stay — they are user files at user-chosen paths. App-private data (manifests, snapshots, suggestion DB, chat history) is removed by the uninstaller. A **"back up app data"** button in settings exports everything to a single archive before uninstall.

### Update Channels

Auto-updates via **electron-updater** with two channels: **Stable** (default) and **Beta** (opt-in for early access). The app checks on launch and prompts before installing.
