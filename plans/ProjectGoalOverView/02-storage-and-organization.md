# Storage and Organization

Mythos Writer keeps your writing and your worldbuilding separate but connected, so your story stays safe and untouched while your notes stay organized and up to date.

## Two vaults, side by side

You have two vaults sitting side-by-side inside a parent folder on your computer. The default parent is `~/Mythos/`, but each vault can be relocated independently (e.g. Story Vault on iCloud Drive, Notes Vault local-only). The layout below is the **default ("Recommended") onboarding mode**; see [SKY-15 #document-plan](/SKY/issues/SKY-15#document-plan) for the full board-accepted spec including the **Blank**, **Import Obsidian vault**, and **Sample project** onboarding paths.

```
~/Mythos/
├── Story Vault/      ← manuscripts (Story Writer reads/writes; AI agents never write here directly)
└── Notes Vault/      ← worldbuilding, lore, planning (AI workspace)
```

### 1. Story Vault

Contains only your story files. Each story is a self-contained folder; you can have many stories side-by-side without spinning up separate vaults.

- Per-story `Manuscript/` with chapter folders and scene files
- A seeded `Outline.md` and `Synopsis.md` at the story root (first-run only — rename or delete what you don't want)
- App-managed `manifest.json` index

```
Story Vault/
├── My First Story/
│   ├── Manuscript/
│   │   ├── 01 - Opening/
│   │   │   ├── 01 - Scene One.md
│   │   │   └── 02 - Scene Two.md
│   │   └── 02 - Rising Action/
│   │       └── 01 - Scene One.md
│   ├── Outline.md
│   ├── Synopsis.md
│   └── manifest.json
└── (additional stories live as sibling folders)
```

This is what the Story Writer part of the app reads and writes to.

### 2. Notes Vault

Contains all your worldbuilding and reference material:

- Characters, Locations, Factions, History, Systems, Items (per universe)
- Per-story planning notes
- Inbox for unsorted ideas
- Research, daily-notes journals, archived material
- Scene Crafter boards
- Anything the Brainstorm Agent creates

This is what your AI agents work inside.

### Why two vaults?

- Your agents never edit your story text.
- Your story is easy to export or share.
- Your notes can grow freely without affecting your manuscript.

You can change the folder locations for either vault at any time.

## Default folder layout inside the Notes Vault

The Notes Vault is organized around **universes** so worldbuilding scales cleanly across multiple stories and shared worlds. Per-story planning lives under `Stories/` so it mirrors the Story Vault sibling — one mental model in both vaults.

```
Notes Vault/
├── Universes/
│   └── My First Universe/
│       ├── Characters/
│       ├── Locations/
│       ├── Factions/
│       ├── History/
│       ├── Systems/                     ← magic, technology, religion — whatever the world runs on
│       └── Items/
├── Stories/                             ← mirrors Story Vault: one folder per story
│   └── My First Story/
├── Inbox/                               ← Brainstorm's drop zone for un-classified ideas
├── Research/                            ← reference material, real-world sources, inspirations
├── Daily Notes/                         ← optional brainstorm/journal stream (Obsidian convention)
└── Archive/                             ← stale or rejected — kept, not deleted
```

What each top-level folder is for, in plain language:

- **Universes/** — one folder per world. The six per-universe subfolders cover what most stories actually need; `Systems/` generalises magic, tech, religion, and economy so you don't pick a genre on day one.
- **Stories/** — story-specific planning notes (beats, themes, scene cards, notes). Mirrors the Story Vault layout so the same name appears on both sides.
- **Inbox/** — Brainstorm Agent's drop zone. When an idea doesn't clearly fit a universe or a story, it lands here with a suggested destination in frontmatter, and you triage it from the sidebar.
- **Research/** — real-world references, inspirations, anything you didn't write yourself.
- **Daily Notes/** — Obsidian-convention daily journal stream; the natural surface for spoken brainstorm dumps that the agent later classifies.
- **Archive/** — retired notes. Still searchable, still linked, but de-prioritized in the graph and continuity checks.

### When the structure doesn't fit

The Brainstorm Agent builds on this layout by default. If a note doesn't fit cleanly (for example, a piece of cross-universe lore, or a real-world reference), the agent falls back to the **default frontmatter schemas** (see the [Q&A Explainer document](#) — section "Default frontmatter schemas") so the note is still typed and searchable even outside the folder hierarchy.

You can rename or restructure folders at any time. The manifest tracks notes by stable IDs, so links survive renames in either Mythos Writer or Obsidian.

### Blank-mode onboarding

If you pick **Blank** at first-run, the Notes Vault and Story Vault are created at the chosen paths with **only the top-level vault folders** — no `Universes/`, no `Stories/`, no scaffolding. You organise from scratch and the Brainstorm Agent learns your pattern (and will not auto-create `Universes/` behind your back). See [SKY-15 #document-plan](/SKY/issues/SKY-15#document-plan) for the full Blank-mode rules.

## Chapters and scenes are separate files

Even though the editor can show your whole book as one continuous document, each chapter and scene is saved as its own file inside the Story Vault — with drafts.

This makes it easy to:

- Edit one scene at a time
- Rearrange scenes
- Track versions
- Instantly roll back scenes or chapters to previous versions
- Export your story cleanly

## The manifest keeps everything fast and connected

Inside your Story Vault, Mythos Writer maintains a small index called the **manifest**.

The manifest keeps track of:

- Chapters
- Scenes
- Timeline entries
- Links to notes
- Scene-to-note connections
- Your workspace layout

This lets the app jump instantly to any part of your story.

## The Notes Vault builds a graph of your world

Inside your Notes Vault, Mythos Writer builds a graph that shows how everything in your world connects — like the graph in Obsidian.

You can see:

- Which scenes a character appears in
- Where locations are used
- How items, events, and lore relate
- How your world fits together

The graph updates automatically as you write and as the Brainstorm Agent creates or updates notes.

## How the two vaults work together

Even though your story and notes are stored separately, the app links them together:

- When you write a scene mentioning **Eira**, the Archive Agent links that scene to Eira's character note in the Notes Vault.
- When you describe the **Glass Market**, it links the scene to the Glass Market location note.
- When you create a new idea in the Brainstorm Agent, it becomes a note in the Notes Vault — and you can link it to a scene in the Story Vault whenever you want.

This gives you the best of both worlds:

- Your story stays safe and untouched.
- Your notes stay organized and automatically updated.

## Example

You write:

> "Eira stepped into the Glass Market."

Here's what Mythos Writer does:

1. Saves the scene in your Story Vault.
2. Recognizes "Eira" and "Glass Market".
3. Links the scene to the Eira note and Glass Market note in your Notes Vault.
4. Updates the graph so you can see the connection.
5. Updates the manifest so navigation stays instant.

Your story stays clean. Your notes stay organized. You stay focused on writing.
