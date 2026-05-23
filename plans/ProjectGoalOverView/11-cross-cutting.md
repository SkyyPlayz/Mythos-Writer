# Cross-Cutting Decisions

This document captures product-wide decisions that don't fit neatly inside the agent or surface-specific docs (`01-` through `10-`). All entries are MVP defaults unless noted otherwise.

## First-run onboarding

When the user opens Mythos Writer for the first time, they pick one of three paths:

1. **Start blank** — a fresh, empty Mythos Vault is created at a default path.
2. **Import an existing Obsidian vault** — wizard with a dry-run report (see [02-storage-and-organization.md](02-storage-and-organization.md)).
3. **Open the sample project** — a small, pre-built worldbuilding example that demonstrates the Universes / Story ideas layout, the three agents, and the Scene Crafter board.

The sample project is the recommended path for new users so they can see the whole system before committing their own work.

## Export

The MVP supports three export formats:

- **Markdown** — direct, lossless export of the Story Vault.
- **DOCX** — for sharing with editors, beta readers, or anyone outside the markdown ecosystem.
- **EPUB** — for distributing finished work or testing on e-readers.

PDF export is post-MVP (it brings heavier dependencies and a much larger styling surface).

## Search

A single search bar searches **both vaults** with a scope toggle (Story / Notes / Both).

- Indexed using **SQLite FTS5** for fast, low-memory full-text search.
- **Fuzzy matching** for character names, location names, and partial matches.
- Filters by note type, universe, character, location, and date range.

## Accessibility

Targeting **WCAG 2.1 AA** at MVP:

- Full keyboard navigation (no mouse required for any core action).
- Screen-reader-friendly markup throughout the editor and sidebars.
- A high-contrast theme.
- Configurable font size and line spacing.

## Internationalization

The UI ships **English-only at MVP**. All UI strings are externalised from the start so future translations can land without code changes.

## Telemetry

**Opt-in only**, off by default.

- Anonymized crash reports and feature-usage counts.
- **Never** the contents of any vault, scene, note, or chat.
- A clear toggle in settings with a list of exactly what is sent.

## Updates

Auto-updates via **electron-updater**, with two channels:

- **Stable** — the default for everyone.
- **Beta** — opt-in for users who want early access to features.

The app checks for updates on launch and prompts the user before installing.

## Data on uninstall

The user's **vaults always stay** — they are user files at user-chosen paths and Mythos Writer never removes them.

App-private data (manifests, snapshots, suggestion DB, chat history) is removed by the uninstaller, but a **"back up app data"** button in settings exports everything to a single archive first so users can move to another machine or reinstall without losing app state.

## Multi-project

MVP supports **one project at a time** with a fast project switcher in the title bar. The data model is multi-project-ready, but the MVP UI keeps the surface area small. Multi-project workspaces (multiple projects open side-by-side, cross-project search) land post-MVP.

## Performance budget

Mythos Writer targets a smooth UX for projects up to:

- **1,000 scenes** in the Story Vault.
- **5,000 notes** in the Notes Vault.
- **500 MB** total vault size.

Larger projects are supported but may slow down certain views (graph, timeline, full-text indexing). Performance regressions below these thresholds are treated as bugs.
