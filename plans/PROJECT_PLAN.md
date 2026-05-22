# Mythos Writer — Project Plan

## Purpose

Mythos Writer is a desktop-first tool that helps authors, worldbuilders, and storytellers organize and develop their stories, characters, and lore. It pairs a rich writing editor with optional AI assistance — auto-generated vault notes and on-demand writing-assistant suggestions — while keeping the author fully in control of every word in their manuscript.

---

## Goals

### Short-Term (v0.1 – v0.3)
- Deliver a working Electron desktop app for Windows (and later macOS/Linux)
- Auto-generate structured vault notes (scene cards, entity summaries) from manuscript prose
- On-demand writing-assistant suggestions invoked explicitly by the author
- Support basic vault/project management (Obsidian-compatible markdown files)
- Establish CI/CD pipeline with lint, typecheck, test, and build gates

### Medium-Term (v0.4 – v0.9)
- Rich text editor with markdown support for writing and editing stories
- Character and world-building management (entities, relationships, timelines)
- Contextual AI assistance: on-demand suggestions and summaries that the author explicitly invokes; AI never auto-edits or auto-generates story content
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

- [ ] In-editor AI commands (continue, rewrite, summarize, expand)
- [ ] Character sheet templates with AI-fill
- [ ] World-building note system with cross-reference links
- [ ] Scene outliner with AI-generated scene beats
- [ ] Prompt history and generation log

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
2. **Markdown-native** — documents are plain `.md` files compatible with Obsidian and other editors
3. **AI as a tool, not a replacement** — the author stays in control; AI assists and suggests
4. **Desktop-quality UX** — feels like a native app, not a web app wrapped in a frame
5. **Open and extensible** — clean architecture that can grow into plugins and templates
6. **AI Boundaries** — AI never modifies or generates story content unless the author explicitly invokes it; the only auto-generated content is vault notes and on-demand writing-assistant suggestions

---

## Open Questions / Decisions Needed

- Editor library choice: CodeMirror (lightweight, markdown-focused) vs TipTap (rich-text, extensible)?
- Streaming UI: show Claude output word-by-word or wait for full response?
- Vault format: single folder per project or multi-folder workspace?
- Distribution: direct GitHub Releases only, or also consider Winget/Homebrew?
