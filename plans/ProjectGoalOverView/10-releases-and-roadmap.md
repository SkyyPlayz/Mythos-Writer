# Releases and Roadmap

Mythos Writer is being built in stages so you get a solid, reliable writing experience first, and then more powerful tools as the system grows.

## Core features in the first release (MVP)

These are the features you get right away — the foundation of Mythos Writer.

### Clean, Word-like writing experience

- Smooth, continuous scrolling.
- Focus Mode for distraction-free writing.
- Header depth slider to switch between book, chapter, and scene views.

### Two-vault system with Obsidian compatibility

- A **Story Vault** for your chapters and scenes.
- A **Notes Vault** for characters, locations, items, and worldbuilding.
- Both vaults use standard markdown files.
- You can open them in Obsidian or open Obsidian vaults in Mythos Writer.
- A fast `manifest.json` keeps navigation instant.

### Core worldbuilding tools

- Create and edit Characters, Locations, Items, and Notes.
- Everything saved as normal markdown files in the Notes Vault.

### Brainstorm Agent (MVP version)

- Automatically creates notes from your conversations.
- Helps you build your world without touching your story text.
- Can create scene ideas and planning notes for the Scene Crafter.

### Writing Assistant (MVP version)

- Leaves suggestions in the sidebar.
- Never edits your story text.
- Helps with clarity, pacing, grammar, and style.

### Version history

- Per-scene snapshots.
- One-click restore.
- Safe, non-destructive editing.

### Basic planning tools

- A simple Scene Crafter board (Kanban-style) stored as a normal note.
- A basic timeline view showing confirmed scene times.

> These features give you a strong, safe, comfortable writing environment from day one.

---

## Planned later features

These features will arrive in future updates as the system grows more powerful.

### Liquid Glass Dark Neon visual identity (next milestone after current core work)

Per the board (MYT-516), the app's full visual identity — **Liquid Glass Dark Neon**, dark-only, applied uniformly across every surface, with a continuous Softness↔Contrast slider — is the **immediate next milestone once the current in-flight core work lands**. It is intentionally **not** an MVP-core item and does not block work already in progress. A dedicated UX designer owns the design-system spec; engineering implements. See [12-visual-design-system.md](12-visual-design-system.md).

### Full local-model and BYO-provider support (immediate post-MVP priority)

The first post-MVP milestone is full support for any model the user wants to attach — cloud APIs, locally running models (Ollama, LM Studio, llama.cpp), and custom agent providers like HermesAI. The MVP ships cloud-only for simplicity, but local-model support is the **highest-priority next task** after MVP launch.

This means:

- A model picker per agent (Brainstorm, Writing Assistant, Archive).
- An OpenAI-compatible endpoint adapter so any provider following that spec works out of the box.
- A local-model adapter for the major local runtimes.
- Sensible defaults and cost/perf guidance so users without a strong preference get something that "just works."

### Full smart linking and metadata extraction

- Automatic detection of characters, locations, and items in your scenes.
- Suggestions to link scenes to notes.
- Metadata suggestions (ages, relationships, tags, etc.).
- Always requires your approval.

### Archive Agent (full version)

- Advanced continuity checks.
- Automatic timeline inference.
- Conflict detection (ages, distances, overlapping events, etc.).
- Scene-to-note linking.
- Big-picture timeline built from your notes.

### Embeddings and semantic search

- Smarter searching across your notes.
- "Find everything related to this idea."
- "Show me all scenes where this theme appears."
- Better context for all agents.

### Plugin API and local model marketplace

- Add-on tools.
- Custom AI personalities.
- Local model options for privacy and offline use.

### Collaboration features

- Shared vaults.
- Commenting.
- Multi-writer workflows.

> These future features will expand Mythos Writer into a full creative studio while keeping your story safe and your notes organized.

---

## Final note

Mythos Writer is built so you can focus on telling your story while the app quietly handles the complex parts of worldbuilding, organization, and continuity. Your story stays safe, your notes stay organized, and every suggestion is reversible. You stay in control at every step — the AI helps, but you make the decisions.

**Mythos Writer's goal is simple:** Make writing easier, clearer, and more enjoyable, without ever getting in your way.
