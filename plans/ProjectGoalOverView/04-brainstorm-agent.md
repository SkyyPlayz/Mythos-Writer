> **⚠️ OUTDATED (2026-07-10).** Superseded by [`14-beta4-refine-overview.md`](14-beta4-refine-overview.md) and the design package in [`plans/design-handoff/v2/`](../design-handoff/v2/) (FULL-SPEC v1.1 + prototype — the prototype wins every disagreement). Commitments from this doc that remain binding are recorded in [`15-beta4-comparison-and-carryovers.md`](15-beta4-comparison-and-carryovers.md). Kept for historical context.

# Brainstorm Agent

> All AI actions are **suggestions** by default. The app records who suggested what and when. You must confirm changes unless you turn on a careful auto-apply setting.

The Brainstorm Agent is your direct interface to your notes and worldbuilding. You don't have to dig through folders, create files, or search for anything. You just talk to it, and it handles the rest.

## What it does by default

It **automatically creates notes** based on your conversation.

- It does not wait for confirmation to create new notes.
- It listens to what you say — ideas, characters, locations, plot points — and turns them into organized notes in your vault.
- It keeps everything tidy, linked, and easy to find.

This means you can build your entire world just by talking.

## If it gets something wrong

You simply tell it:

> "That's not correct — here's what I meant…"

It will:

1. Draft a fix.
2. Show you the corrected version.
3. Wait for you to confirm the fix before updating the note.

You can also edit the note manually if you prefer.

## Why this agent exists

The Brainstorm Agent is designed so you never have to manually manage your notes unless you want to.

You can:

- Ask it questions about your world.
- Ask it to recall details.
- Ask it to expand ideas.
- Ask it to update or reorganize information.
- Ask it to create new characters, locations, items, or concepts.
- Ask it to explain your own world back to you.

All without ever opening the notes yourself.

## How it fits into your workflow

- You **talk** → it builds the vault.
- You **ask** → it retrieves and explains your notes.
- You **correct** → it fixes and updates your notes.
- You **brainstorm** → it expands your world.

It becomes your second brain, keeping track of everything so you can focus on writing.

## How it interacts with the rest of the app

- It can create entities (characters, locations, items, notes).
- It keeps your vault organized so the Archive Agent can check continuity.
- It feeds the Writing Assistant with context so suggestions stay accurate.
- It hosts the **continuity todo list** in its sidebar — every continuity issue the Archive Agent finds shows up as a checkbox item the user can click to read, answer, and resolve directly inside the Brainstorm sidebar. Answers are routed straight back into the Brainstorm Agent's context so it can update notes if needed.

## Model choice — bring your own

The Brainstorm Agent is **model-agnostic**. You choose which model powers it:

- **Cloud models** (Anthropic Claude, OpenAI, others) via API key.
- **Local models** running on your machine (Ollama, LM Studio, llama.cpp, etc.).
- **Custom agents and providers** like HermesAI or any OpenAI-compatible endpoint.

The setting lives in the app's preferences. You can swap models at any time. The same flexibility applies to the Writing Assistant and Archive Agent — you can use the same model everywhere or pair a cheap/local model for one agent and a stronger cloud model for another.

This is a first-class design decision: no Mythos Writer feature should ever be locked to a single AI provider.

## Vault structure the agent builds against

The Brainstorm Agent builds notes inside the SKY-15 default layout described in [Storage and Organization](02-storage-and-organization.md#default-folder-layout-inside-the-notes-vault) (authoritative spec at [SKY-15 #document-plan](/SKY/issues/SKY-15#document-plan)).

- **Worldbuilding notes** (characters, locations, factions, history, systems, items) live under `Universes/<World>/<Category>/`. If the user has only one universe, the agent uses it without prompting; if multiple, it asks which one (or infers from the active story).
- **Story-specific notes** (beats, themes, scene cards, planning notes) live under `Stories/<Active Story>/`. Active story comes from app state, not from a prompt.
- **Unclear notes** land in `Inbox/` with a frontmatter `suggested_destination:` field. The user triages from a sidebar list and confirms — the agent then moves the note to its accepted destination.
- **Real-world references** go in `Research/`; spoken-brainstorm transcripts go in `Daily Notes/`; retired material goes in `Archive/` (still searchable, still linked, de-prioritized).
- When a note doesn't naturally fit any of these buckets, the agent falls back to the default frontmatter schemas so it remains typed and findable.

The agent extends this structure as needed (new sub-folders per world, new note types), but always preserves the user's existing layout. When in doubt, it asks the user to clarify rather than guessing.

### Blank-mode behavior

If the user picked **Blank** at first-run (only the top-level Notes Vault and Story Vault folders exist, no `Universes/` or `Stories/` scaffolding), the Brainstorm Agent **never** auto-creates `Universes/` behind the user's back. Instead, on the first note in each category it asks once — "Where should I put this kind of note?" — and remembers the answer per category for the rest of the session. The user's pattern becomes the agent's pattern. (See [SKY-15 #document-plan](/SKY/issues/SKY-15#document-plan) for the full Blank-mode rules; the asks-once-per-category UX is delivered as a child issue of SKY-9.)

## In short

The Brainstorm Agent is your worldbuilding partner. It listens, organizes, remembers, and builds — automatically. You stay in control, but you never have to manage the vault yourself.
