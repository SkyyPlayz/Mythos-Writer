# Mythos Writer — Project Plan

## Purpose

Mythos Writer is a desktop-first tool that helps authors, worldbuilders, and storytellers organize and develop their stories, characters, and lore. It is two apps in one shell:

1. **A Word-like writing app** where the author writes their story.
2. **An Obsidian-like notes app** (the "vault") where worldbuilding, characters, lore, and plans live as linked markdown notes. The vault is **backwards compatible with existing Obsidian vaults** — users can point Mythos Writer at an Obsidian vault and have it work.

Three named AI agents assist the author across these surfaces. None of them auto-edits the manuscript; the author stays in control of every word.

---

## Goals

### Short-Term (v0.1 – v0.3)
- Deliver a working Electron desktop app for Windows (and later macOS/Linux)
- Word-like writing surface for manuscript prose (rich text, block-based)
- Obsidian-like vault for notes, with backwards compatibility for existing Obsidian vaults (markdown files, `[[wiki-links]]`, folder layout)
- First cut of the **Writing Assistant** sidebar inside the writing page (advice only, on-demand)
- Establish CI/CD pipeline with lint, typecheck, test, and build gates

### Medium-Term (v0.4 – v0.9)
- Rich text editor with markdown round-trip for writing and editing stories
- Character and world-building management (entities, relationships, timelines) inside the Obsidian-like vault
- **Brainstorm agent**: separate chat surface where the author talks through story, world, ideas, goals, and plans; the agent turns that conversation into vault notes
- **Vault agent**: indexes the entire vault, checks the manuscript against it for inconsistencies, and manages `[[wiki-link]]`-style references from the writing page to vault pages
- Import/export support (markdown, plain text, EPUB)
- Autosave and local file sync via vault watcher

### Long-Term (v1.0+)
- Full-featured writing suite rivaling tools like Scrivener, but AI-native
- Multi-project workspace with tagging, search, and cross-reference
- Optional cloud sync and collaboration features
- Plugin or template system for genre-specific workflows (fantasy, sci-fi, mystery, etc.)
- macOS and Linux distribution

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

- [ ] Markdown editor component (e.g., CodeMirror or TipTap)
- [ ] Project/vault browser sidebar
- [ ] Save/load documents from vault
- [ ] Basic settings panel (API key management, theme)

### Phase 3 — AI-Augmented Authoring
**Status:** Planned

The three named agents:

- [ ] **Writing Assistant** — sidebar inside the writing page. Reads the current scene/chapter as context and offers advice on prose, pacing, characterization, and continuity. On-demand only; never edits the manuscript.
- [ ] **Brainstorm Agent** — separate chat surface. The author talks through their story, world, ideas, goals, and plans. The agent extracts structured information from the conversation and writes/updates vault notes (entities, locations, lore, plot beats).
- [ ] **Vault Agent** — indexes the entire vault. (1) Continuity-checks the manuscript against vault contents and surfaces inconsistencies in the writing UI; (2) suggests and inserts Obsidian-style `[[wiki-link]]` references that connect mentions in the manuscript to vault pages.

Supporting work: prompt history and generation log; user-facing settings for which agent is enabled and per-agent model selection.

### Phase 4 — Polish & Distribution
**Status:** Future

- [ ] Onboarding flow for new users
- [ ] Auto-updater (electron-updater)
- [ ] macOS build and notarization
- [ ] App signing for Windows
- [ ] Public release on GitHub Releases

---

## Tech Stack

| Layer       | Technology                                  |
|-------------|---------------------------------------------|
| Shell       | Electron 33 (desktop runtime)               |
| Frontend    | React 18, Vite, TypeScript                  |
| Main process| Node.js, TypeScript (electron-main package) |
| AI          | Anthropic Claude API (`@anthropic-ai/sdk`)  |
| Storage     | Local markdown vault (Obsidian-compatible)  |
| Build       | electron-vite, electron-builder             |
| Tooling     | ESLint, Prettier, Vitest, GitHub Actions    |

---

## Architecture Overview

```
Mythos-Writer/
├── electron-main/       # Main process: IPC handlers, vault, Claude API calls
│   └── src/
│       ├── main.ts          # App entry, window creation
│       ├── ipc/             # IPC channel handlers
│       └── vault/           # Markdown vault watcher and file ops
├── frontend/            # Renderer process: React UI
│   └── src/
│       ├── App.tsx
│       └── components/      # Editor, sidebar, AI panel
├── plans/               # Project planning documents (this folder)
├── .github/workflows/   # CI configuration
└── package.json         # Root workspace (frontend + electron-main)
```

IPC is the communication boundary: the renderer (frontend) never calls the Claude API or touches the filesystem directly — it sends IPC messages to the main process, which handles all privileged operations.

---

## Design Principles

1. **Local-first** — all data lives on the user's machine; no account required to use core features
2. **Markdown-native** — vault documents are plain `.md` files compatible with Obsidian and other editors; an existing Obsidian vault can be opened directly
3. **AI as a tool, not a replacement** — the author stays in control; AI assists and suggests
4. **Desktop-quality UX** — feels like a native app, not a web app wrapped in a frame
5. **Open and extensible** — clean architecture that can grow into plugins and templates
6. **AI Boundaries** — AI never modifies or generates manuscript prose. The Writing Assistant only offers advice. The Brainstorm Agent writes only to vault notes (never the manuscript). The Vault Agent only inserts `[[wiki-links]]` and surfaces inconsistencies; it does not rewrite prose.

---

## Product Surfaces (Reference)

| Surface          | What it is                                                                                          | Analogue   |
|------------------|-----------------------------------------------------------------------------------------------------|------------|
| Writing page     | The author's manuscript — Word-like rich text editor for stories, chapters, and scenes              | MS Word    |
| Vault            | Notes app for worldbuilding, characters, lore, plans; backwards compatible with Obsidian            | Obsidian   |
| Writing Assistant| Sidebar on the writing page; reads current scene; offers advice on demand                           | —          |
| Brainstorm Agent | Separate chat; author talks through story/world/ideas; agent fills vault notes from the conversation| —          |
| Vault Agent      | Background indexer; checks story against vault for inconsistencies; manages `[[wiki-links]]`        | —          |

---

## Open Questions / Decisions Needed

- Editor library choice: TipTap (rich-text, Word-like) is the leading candidate given the "a lot like Word" framing; CodeMirror would be a fallback if we keep the editor plain-markdown.
- Streaming UI for the Writing Assistant and Brainstorm Agent: stream tokens or wait for full response?
- Obsidian backwards-compat scope for v1: do we need to honor Obsidian's `.obsidian/` config (themes, plugin list) or just the file/folder layout and `[[wiki-link]]` syntax?
- Vault Agent: what triggers a continuity check — on save, on-demand, or continuous background scan? Where do flagged inconsistencies surface in the writing UI?
- Distribution: direct GitHub Releases only, or also consider Winget/Homebrew?
