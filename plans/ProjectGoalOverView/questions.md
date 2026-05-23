# Open Questions

These are questions raised by the project vision document that need decisions or clarification before — or during — implementation. Each question is grouped by area, with the relevant section linked.

## 1. Overview / Product positioning

1. Is the **target audience** strictly individual authors at launch, or do we include "teams" in MVP scope at all? (The overview lists teams but the roadmap puts collaboration in *later*.)
2. What's the **one-sentence pitch** we use externally — "AI-native Scrivener," "Obsidian for novelists," or something else?
3. What does "safe" formally mean for the Story Vault? Read-only for agents, or also protected from accidental user-side overwrites?

## 2. Storage and organization

1. What is the **canonical layout** of the "main folder" — is it `MainFolder/StoryVault/` and `MainFolder/NotesVault/`, or do users pick each independently? Can they live on different drives?
2. Are the two vaults **two independent Obsidian vaults**, or one Obsidian vault with a special folder structure?
3. How do we handle a user who points us at an **existing Obsidian vault** that already mixes story files and notes?
4. What goes into the **manifest** exactly, and how do we handle drift between manifest and disk (e.g. user adds a file in Obsidian)?
5. What is the **file naming scheme** for chapters and scenes? (`01-chapter.md`, `chapter-01/scene-03.md`, frontmatter-driven order?)
6. How are **"drafts"** of a scene stored on disk? Side-by-side files, a `.drafts/` subfolder, or a separate snapshots database?
7. Does the **graph view** include story scenes as nodes, only notes, or both with different colors?
8. How do scene ↔ note links survive a **rename** in either Obsidian or Mythos Writer?

## 3. Writing experience and modes

1. What rich-text engine backs the **block-based editor**? (PROJECT_PLAN.md mentions TipTap — is that decided?)
2. Do blocks round-trip cleanly to Obsidian markdown? What happens to a block-level concept (drag/move/history) when the file is opened in Obsidian?
3. What exactly does the **header depth slider** do under the hood — filter the rendered view, or load only that file? How does it interact with the manifest?
4. How does **Edit Mode** differ visually from Normal Mode beyond showing suggestion sidebars?
5. In **Focus Mode**, what UI elements does the user pick from? Is this a per-session preference or persistent?
6. When a block is **moved across chapters**, what does the confirmation prompt say, and is the move snapshot-able as a single revertible event?
7. Are there **keyboard shortcuts** standardised across modes? Where do we document them?

## 4. Brainstorm Agent

1. Which **AI provider/models** does the Brainstorm Agent use by default? Cloud (Anthropic/OpenAI), local (Ollama), or both?
2. How does the agent **categorize** a new note (character vs location vs lore vs scene idea)? Heuristics, structured output schema, or a confirmation step?
3. What is the **conversation memory** model — does each session start fresh, or does the agent recall prior chats?
4. When the agent creates a note **without confirmation**, how is provenance recorded and how does the user discover/review what was auto-created?
5. What is the **frontmatter schema** for each note type (character, location, item, lore, scene idea)?
6. How does the agent **avoid duplicates** when the user mentions "Eira" across many sessions?
7. Is there a **chat history** stored on disk? If so, where, and is it part of either vault?
8. How does the agent **prompt** look — is it a single system prompt, or does it switch modes (recall vs create vs reorganize)?

## 5. Writing Assistant

1. What does **"heartbeat you choose"** mean precisely — interval ticks, debounced on idle, on save, or all three configurable?
2. Where exactly do **inline suggestions** render — overlayed in the editor, only in the sidebar, both?
3. How do suggestions **persist** between sessions — in the manifest, in a SQLite database (per PROJECT_PLAN.md), or alongside the scene file?
4. What's the user-visible **dismissal model**? Are dismissed suggestions remembered so the same one doesn't reappear?
5. Does the **chat bar on the side** share context with the Brainstorm Agent's chat, or are they isolated?
6. What **cost ceilings** apply per heartbeat tick to avoid runaway spend on cloud models?
7. Should the assistant ever **proactively** open the sidebar/draw attention, or stay passive?

## 6. Archive Agent

1. How does the agent **detect entity references** in prose — name matching, embedding similarity, LLM extraction, or a combination?
2. What is the **schema** for a continuity issue (fields like type, severity, scene reference, vault reference, suggested action)?
3. When the user picks **"Match the archive to the story"**, which fields get auto-updated, and which still require confirmation?
4. How are **implicit links** ("the shadowy figure is Kalen") stored — as Obsidian wiki-links, as manifest-only metadata, or both?
5. What's the **trigger model** — every save, periodic heartbeat, manual run, or all three? What's the default?
6. How does the agent handle **partial knowledge** (a character page that doesn't specify an age)? Silent skip, or flag as "needs detail"?
7. How are **continuity flags** kept stable across edits so the same issue doesn't reappear after a no-op edit?

## 7. Scene Crafter

1. Is the file format **compatible with the Obsidian Kanban plugin** so users can edit the same board in Obsidian, or is it a Mythos-Writer-only format?
2. Where is the **board file** stored — Notes Vault root, a `boards/` subfolder, or user-chosen?
3. Can a user have **multiple boards** (one per book, one per arc)?
4. What happens to a **card linked to a scene** if the underlying scene file is deleted?
5. Are board **columns** stored as headings inside the markdown file, or in frontmatter?
6. Do cards carry their **own metadata** (tags, color, due dates), or are they purely references to vault notes?

## 8. Timeline Builder

1. How does the agent extract **dates** from prose with no calendar system? Does it assign abstract "Day 1, Day 2" markers?
2. Does the user need to **define a calendar** for the world (Earth, custom fantasy calendar) up front, or is it inferred?
3. How are **planned events** in the Notes Vault marked so the timeline can find them — frontmatter, tags, dedicated note type?
4. What is the **confidence threshold** above which the agent auto-places a scene vs. asks for confirmation?
5. How are **timeline edits** persisted — in the manifest, in scene frontmatter, in a separate timeline file?
6. If the user **drags** a timeline block, does that update prose ("two days later"), or just the metadata?
7. How does the **filter / character-arc highlight** UI work — popover, dropdown, dedicated panel?

## 9. Safety, versioning, sync, Obsidian compatibility

1. Where do **snapshots** live? Inside the vault (visible in Obsidian) or in app-private storage?
2. What's the **retention policy** for snapshots — every save, every N saves, or until disk pressure?
3. How is **history** modelled per-block when blocks split, merge, or move between scenes?
4. What's the **conflict resolution** strategy when the user edits a scene in Obsidian while Mythos Writer is open?
5. For optional **cloud sync** later, which providers (Dropbox, iCloud, S3, custom) are we considering?
6. How does **"see when cloud actions will cost money"** surface — a pre-flight estimate, a running counter, a hard cap?
7. How is the **API key** stored — OS keychain, encrypted on disk, plaintext settings file? (Note: MYT-143 already masks it on display; storage at rest is a separate question.)
8. What's the **import path** for an existing Obsidian vault that doesn't follow Mythos conventions — wizard, dry-run report, or auto-restructure with rollback?

## 10. Releases and roadmap

1. What is the **target ship date** for the MVP, and which platforms (Windows-only at first per PROJECT_PLAN.md)?
2. Which features are **firmly MVP** vs which are stretch goals if scope slips? (E.g., is the basic timeline view truly MVP, or is it the first "later" feature?)
3. What is the **monetization** model — paid app, freemium, BYO-key only, subscription? This affects how we surface cost controls.
4. Will MVP ship with **at least one local model** option, or is cloud-only acceptable for v1?
5. What is our **support model** for early users (Discord, GitHub Issues, email)?
6. How do we measure **success** for MVP — DAU, retained users, words written, paid conversions?

## 11. Cross-cutting / not covered in the vision doc

1. **Onboarding**: what does the first-run experience look like? Empty vault, sample project, or import wizard?
2. **Export**: which formats are required for MVP — markdown, EPUB, DOCX, PDF?
3. **Search**: full-text search across both vaults? Indexed? Fuzzy?
4. **Accessibility**: screen-reader support, high-contrast, keyboard-only navigation?
5. **Internationalization**: is the UI English-only at launch, or do we plan for translations?
6. **Telemetry**: do we collect any usage data, and if so, what's opt-in vs opt-out?
7. **Updates**: how does the app update itself (electron-updater per PROJECT_PLAN.md), and what's the channel model (stable / beta)?
8. **Data export at deletion**: if a user uninstalls, what happens to manifests, snapshots, suggestion DB?
9. **Multi-project**: does MVP support multiple stories/vaults, or just one at a time?
10. **Performance budget**: what vault size (file count, total MB) do we commit to supporting fluidly?
