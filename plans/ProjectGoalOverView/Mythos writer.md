> **⚠️ OUTDATED (2026-07-10).** Superseded by [`14-beta4-refine-overview.md`](14-beta4-refine-overview.md) and the design package in [`plans/design-handoff/v2/`](../design-handoff/v2/) (FULL-SPEC v1.1 + prototype — the prototype wins every disagreement). Commitments from this doc that remain binding are recorded in [`15-beta4-comparison-and-carryovers.md`](15-beta4-comparison-and-carryovers.md). Kept for historical context.

⭐ Overview

Mythos Writer is a writing app designed to feel as comfortable as a word processor while quietly managing all the complex parts of worldbuilding for you. You write in a clean, familiar editor, and the app takes care of organizing your ideas, notes, characters, locations, and timelines in the background.



Your story stays safe in its own vault, untouched by AI.

Your notes live in a separate vault, where the AI can help you build and maintain your world.



Three AI helpers work alongside you:



One helps you brainstorm and build your notes automatically



One helps you improve your writing



One helps you keep your world consistent



They organize, suggest, and guide — but they never change your story text without your approval.



Mythos Writer is built so anyone can use it: new writers, hobbyists, experienced authors, and even teams. You focus on telling your story. The app handles the rest.

\---



\### How your work is stored and organized

Mythos Writer keeps your writing and your worldbuilding separate but connected, so your story stays safe and untouched while your notes stay organized and up to date.



⭐ Two vaults, side by side

You have two vaults inside one main folder on your computer:



1\. Story Vault

This vault contains only your story files:



Chapters



Scenes



The main manuscript



Story‑specific metadata



This vault is what the Story Writer part of the app reads and writes to.



2\. Notes Vault

This vault contains all your worldbuilding and reference material:



Characters



Locations



Items



Lore notes



Research



Scene Crafter boards



Anything the Brainstorm Agent creates



This vault is what your AI agents work inside.



Keeping these vaults separate ensures:



Your agents never edit your story text



Your story is easy to export or share



Your notes can grow freely without affecting your manuscript



You can change the folder locations for either vault at any time.



⭐ Chapters and scenes are separate files

Even though the editor can show your whole book as one continuous document, each chapter and scene is saved as its own file inside the Story Vault with drafts.



This makes it easy to:



Edit one scene at a time



Rearrange scenes



Track versions


instantly rollback scenes or chapters to previous versions


Export your story cleanly





⭐ The manifest keeps everything fast and connected

Inside your Story Vault, Mythos Writer maintains a small index called the manifest.



The manifest keeps track of:



Chapters



Scenes



Timeline entries



Links to notes



Scene‑to‑note connections



Your workspace layout



This lets the app jump instantly to any part of your story.



⭐ Your notes vault builds a graph of your world

Inside your Notes Vault, Mythos Writer builds a graph that shows how everything in your world connects. like the graph in obsidian. 



You can see:



Which scenes a character appears in



Where locations are used



How items, events, and lore relate



How your world fits together



The graph updates automatically as you write and as the Brainstorm Agent creates or updates notes.



⭐ How the two vaults work together

Even though your story and notes are stored separately, the app links them together:



When you write a scene mentioning Eira, the Archive Agent links that scene to Eira’s character note in the Notes Vault.



When you describe the Glass Market, it links the scene to the Glass Market location note.



When you create a new idea in the Brainstorm Agent, it becomes a note in the Notes Vault, but you can link it to a scene in the Story Vault whenever you want.



This gives you the best of both worlds:



Your story stays safe and untouched



Your notes stay organized and automatically updated



⭐ Example

You write:



“Eira stepped into the Glass Market.”



Here’s what Mythos Writer does:



Saves the scene in your Story Vault



Recognizes “Eira” and “Glass Market”



Links the scene to the Eira note and Glass Market note in your Notes Vault



Updates the graph so you can see the connection



Updates the manifest so navigation stays instant



Your story stays clean.

Your notes stay organized.

You stay focused on writing.











\---



⭐ The writing experience and modes

Mythos Writer is designed to feel natural, clean, and comfortable — like writing in Word — but with powerful tools quietly working in the background to keep your story organized.



⭐ A smooth, Word‑like writing experience

You write in a clean editor with:



Continuous scrolling



Simple formatting



A hideable table of contents for quick navigation



Instant jumping between chapters and scenes



It feels familiar, so you can focus on your story instead of learning a new system.



⭐ Header depth slider

At the top of the editor is a single slider that controls how much of your story you see at once.



You can slide between:



Full Book View — see everything in one long scroll



Chapter View — see one chapter at a time



Scene View — see one scene at a time



When you’re in Chapter View or Scene View, you can use left and right arrows to move forward or backward without leaving the editor.



This makes navigation effortless.



⭐ Three writing modes

Mythos Writer gives you three modes so you can choose how you want to work.



Normal Mode

Your everyday writing mode.

You have access to sidebars, notes, and tools while still keeping the editor front and center.



Focus Mode

A distraction‑free, full‑screen writing space.

You choose which UI elements stay visible — everything else fades away.



Perfect for drafting or deep writing sessions.



Edit Mode

A review mode that shows:



Writing Assistant suggestions



Archive Agent notes



Comments from collaborators (if you share your story)



This mode is designed for revising, polishing, and fixing continuity issues.



⭐ Block‑based editing

Your writing is made of blocks — usually one paragraph per block.



This gives you powerful control:



Press Enter → creates a new block



Double‑click a block → opens it in full‑screen focus



Drag blocks to reorder them inside a scene



Move blocks between scenes (with a confirmation if it crosses chapters)



Blocks make editing cleaner, faster, and safer.



⭐ Example

You slide the header depth slider to Scene View.

You edit a single scene in a focused space.

When you’re done, you press the right arrow to jump straight to the next scene — no menus, no searching, no scrolling.



It feels natural and keeps you in the flow.

\---



\### The three AI assistants and how they behave

All AI actions are \*\*suggestions\*\* by default. The app records who suggested what and when. You must confirm changes unless you turn on a careful auto‑apply setting.



\- \*\*Brainstorm Agent\*\*  

&#x20;The Brainstorm Agent is your direct interface to your notes and worldbuilding.

You don’t have to dig through folders, create files, or search for anything.

You just talk to it, and it handles the rest.



What the Brainstorm Agent does by default

It automatically creates notes based on your conversation.



It does not wait for confirmation to create new notes.



It listens to what you say — ideas, characters, locations, plot points — and turns them into organized notes in your vault.



It keeps everything tidy, linked, and easy to find.



This means you can build your entire world just by talking.



If the Brainstorm Agent gets something wrong

You simply tell it:



“That’s not correct — here’s what I meant…”



It will:



Draft a fix



Show you the corrected version



Wait for you to confirm the fix before updating the note



You can also edit the note manually if you prefer.



Why this agent exists

The Brainstorm Agent is designed so you never have to manually manage your notes unless you want to.



You can:



Ask it questions about your world



Ask it to recall details



Ask it to expand ideas



Ask it to update or reorganize information



Ask it to create new characters, locations, items, or concepts



Ask it to explain your own world back to you



All without ever opening the notes yourself.



How it fits into your workflow

You talk → it builds the vault.

You ask → it retrieves and explains your notes.

You correct → it fixes and updates your notes.

You brainstorm → it expands your world.



It becomes your second brain, keeping track of everything so you can focus on writing.



How it interacts with the rest of the app



It can create entities (characters, locations, items, notes).



It keeps your vault organized so the Archive Agent can check continuity.



It feeds the Writing Assistant with context so suggestions stay accurate.



In short

The Brainstorm Agent is your worldbuilding partner.

It listens, organizes, remembers, and builds — automatically.

You stay in control, but you never have to manage the vault yourself.





\- \*\*Writing Assistant\*\*  

Your gentle editor who gives advice but never touches your words.

The Writing Assistant is like a friendly editor who reads over your shoulder and gives helpful suggestions — but never changes anything in your document. You stay fully in control of every word.



How it works

It scans your writing on a heartbeat you choose (for example: every few minutes, on save, or only when you ask).



It leaves notes, tips, and suggestions, linked to the document like notes in Word. it can also chat with you and go more into depth in the chat bar on the side.



It can point out:



Grammar issues



Awkward sentences



Pacing problems



Repetition



Tone inconsistencies



Clarity issues



Opportunities to strengthen emotion or description



What it never does

It never edits your text directly.



It never rewrites anything automatically.



It never applies changes without your approval.



How you interact with it

You read its suggestions in the sidebar or in Edit Mode.

If you like a suggestion, you apply it manually or click “accept.”

If you don’t like it, you ignore it.



Why it exists

The Writing Assistant helps you improve your craft without taking over your writing.

It’s supportive, not intrusive — a second pair of eyes that respects your voice.









\- \*\*Archive Agent\*\*  

Your continuity guardian and world‑logic expert.

The Archive Agent is the part of Mythos Writer that keeps your story world consistent.

It reads your story and compares it to your notes, your characters, your timeline, and your worldbuilding.



What it does

Checks for inconsistencies in your story



Suggests links between your story and your notes



Helps place scenes on the timeline



Tracks where characters appear



Watches for contradictions in:



Ages



Locations



Abilities



Timelines



Relationships



World rules



How it handles inconsistencies

When it finds something that doesn’t match, it asks what you want to do:



Match the archive to the story  

(update your notes to match what you wrote)



Suggest a story change  

(update your writing to match your notes)



Ignore  

(you decide the inconsistency is intentional or not important)



Implicit linking

If your story says:



“A shadowy figure watched from the alley.”



You can tell the Archive Agent:



“That’s actually Kalen.”



It will:



Link the figure to Kalen



Update Kalen’s timeline



Add the appearance to the scene in timeline. 



Keep everything consistent



But it always waits for your confirmation before applying changes.



Why it exists

The Archive Agent makes sure your world stays believable and organized, even as it grows more complex.

It’s your continuity editor, your timeline manager, and your logic checker — all in one.





\*\*Example workflow\*\*:

1\. You start by talking to the Brainstorm Agent

You open the Brainstorm tab and say:



“I want to create an opening market scene. Eira arrives in the Glass Market and notices something strange.”



The Brainstorm Agent listens and automatically creates notes:



A Scene Idea note



A Glass Market location note (if it doesn’t already exist)



A Beat list describing the moment



Updates Eira’s character page with a new appearance



It does all of this without asking for confirmation, because that’s its job.



If it misunderstands something, you correct it, and it drafts a fix for you to approve.



2\. You open the Scene Crafter board

You switch to your Scene Crafter (your Kanban board stored as a normal vault note).



You see the new Scene Idea card the Brainstorm Agent created under the “Ideas” column.



You drag:



Eira’s character note



The Glass Market location note



The beat list note



onto the card to visually group everything you need for this scene.


search vault, in sidebar of Kanban for notes to add to. or just ask brainstorm to add them in the chat window on the same sidebar. 



This helps you keep the idea clear in your mind while writing.



3\. You link the Scene Crafter card to a real scene

When you’re ready to write, you click:



“Link to Story Scene”



Mythos Writer creates a new scene file in your story’s chapter list and links it to the card for easy jumping back and forth.



Now you can write the actual scene in the editor.



4\. You write the scene

You write:



“Eira stepped into the Glass Market just as the sun dipped behind the towers…”



The Writing Assistant quietly reads along and leaves helpful notes in the sidebar:



“This sentence is a bit long.”



“You could add a sensory detail here.”



“Consider clarifying what she notices.”



It never changes your text — it only suggests.



5\. Archive Agent checks for continuity

Later, when you run a continuity check (or when the heartbeat triggers one), the Archive Agent reads the scene and compares it to your notes.



It might say:



“Eira’s age in this scene doesn’t match her character page.”



“The Glass Market is described as underground in your notes, but here it’s open to the sky.”



“This event overlaps with another scene on the timeline.”



For each issue, it asks:



Update notes to match the story



Suggest a story change



Ignore



You choose what makes sense.



6\. Everything stays organized automatically

The Brainstorm Agent keeps building and updating your notes as you talk.



The Scene Crafter helps you visually plan without affecting your real scenes.



The Writing Assistant helps you improve your prose.



The Archive Agent keeps your world consistent and your timeline clean.



You stay focused on writing — the system handles the rest.









\---



\### Planning tools: Scene Crafter and Automatic Timeline Builder

\- \*\*Scene Crafter (Kanban board)\*\*  

Scene Crafter is a completely separate planning tool inside your vault. It works like a Kanban board, similar to the Obsidian Kanban plugin, and it is stored as a regular markdown note in your vault. This means you can open and edit it in Obsidian just like any other note.



Scene Crafter is not tied to your actual story scenes. Instead, it is a visual workspace where you can drag notes from your vault onto the board to help you plan, brainstorm, and keep ideas straight while writing.



You can use it to organize:



Scene ideas



Character notes



Location notes



Plot threads



Research notes



Anything else in your vault



The board uses columns such as:



Ideas



Drafting



Writing



Revised



Cut



You can rename or add columns to match your personal workflow.



Because Scene Crafter is separate from your story structure, it gives you a freeform space to experiment and rearrange ideas without affecting your actual chapters or scenes.



You can also link a card on the board to a real scene in your story. This makes it easy to jump back and forth between your planning board and the scene you’re editing.



* Everything is saved as a normal markdown file, so:



It syncs like any other note



It stays simple and future‑proof





In short: Scene Crafter is your visual idea board, not your story structure. It helps you think clearly, organize your ideas, and keep track of characters and plot threads while you write.









⭐ Automatic Timeline Builder

The Automatic Timeline Builder helps you understand when everything in your story happens. It combines information from your story scenes and your notes vault to give you a clear picture of your plot, your character arcs, and the order of events.



⭐ How the Archive Agent builds your timeline from your story

As you write scenes, the Archive Agent looks for anything that hints at time, such as:



“Two days later”



“At dawn”



“During the festival”



“That night”



“A week passed”



Whenever it finds a clue, it creates a timeline suggestion.

You can confirm it, adjust it, or ignore it.



This keeps your timeline accurate without you having to track every detail.



⭐ How the Archive Agent builds a “big‑picture” timeline from your notes

The Archive Agent can also scan your Notes Vault to find:



Planned events



Future scene ideas



Character arcs



World events



Plot goals



Backstory moments



Beats you brainstormed earlier



It uses these to build a vague, high‑level timeline that shows the shape of your story — even before you’ve written the scenes.



This “planned timeline” is shown in greyscale

Grey blocks = ideas or planned events from your notes



Color blocks = scenes you’ve actually written



This lets you instantly see:



What you’ve written



What you still need to write



Where gaps exist



Whether your planned order still makes sense



It’s like having a map of your story’s future.



⭐ A visual timeline you can interact with

The timeline shows your scenes and planned events as blocks arranged in story‑time order.



You can:



Move blocks to adjust timing



Zoom in/out to see details or the whole story



Filter by character, chapter, or plot thread



Highlight a single character’s arc



Compare planned events (grey) to written scenes (color)



It’s a simple, visual way to understand your story’s flow.



⭐ Spotting overlaps and continuity issues

If something doesn’t make sense, the timeline will highlight it.



For example:



Two scenes happen at the same time when they shouldn’t



A character appears in two places at once



A planned event contradicts something you’ve written



A travel time doesn’t match the distance



A scene breaks your world’s rules or calendar



The Archive Agent will point out the issue and offer options to fix it.



⭐ Example

You have a note in your Notes Vault that says:



“Festival of Lights — happens at dusk on Day 3.”



This appears on the timeline as a grey block (a planned event).



Later, you write a scene:



“Eira arrived at dusk on Day 3.”



The Archive Agent:



Recognizes the match



Links the scene to the planned event



Turns the grey block into a colored block



Updates the timeline



Checks for overlaps or conflicts



If another scene also claims to happen at dusk on Day 3, the timeline highlights the overlap and the Archive Agent asks how you want to resolve it.















\---



⭐ Safety, versioning, sync, and Obsidian compatibility

Mythos Writer is built to keep your story safe, your notes organized, and your data fully under your control. Everything is designed to be non‑destructive, local‑first, and easy to restore.



⭐ Non‑destructive by default

Mythos Writer never overwrites your work without your permission.



AI suggestions are proposals, not changes.



Accepting a suggestion always creates a snapshot you can restore later.



Your Story Vault is protected — agents never edit your story files directly.



Only your Notes Vault is editable by agents, and even then, fixes require confirmation.



This means you can experiment freely without fear of losing anything.



⭐ Per‑scene and per‑block version history

Every chapter, scene, and block has its own history.



You can:



Right‑click a scene or block



Open History



See all past versions



Compare differences



Restore any version with one click



This makes revisions safe, simple, and reversible.



⭐ Local‑first with optional cloud sync

Your vaults live on your computer by default.



You own your files.



You can open them in any editor.



You can back them up however you like.



If you want cloud sync, you can turn it on later — but it’s never required.



⭐ Full Obsidian compatibility

Both your Story Vault and Notes Vault use standard markdown files and frontmatter, so:



You can open your vaults in Obsidian



You can open Obsidian vaults in Mythos Writer



Nothing is locked behind a proprietary format



Your data stays future‑proof



Mythos Writer also includes a graph view similar to Obsidian’s, so you can visualize how your characters, locations, items, and scenes connect.



⭐ Privacy and cost controls

You decide how much AI you want to use and how much it costs.



You can:



Choose local models or cloud models



Set per‑agent compute budgets



See when cloud actions will cost money



Disable cloud AI entirely if you prefer



Your data stays private, and you stay in control.



⭐ Example

You accept a suggestion from the Writing Assistant to improve a sentence.

Mythos Writer:



Saves a snapshot of the scene before the change



Applies the suggestion



Lets you continue writing



Later, if you decide you liked the original version better, you open the scene’s history and restore the previous snapshot with one click.



Your story stays safe, clean, and fully reversible.











\---









⭐ What you get in the first release and what comes later

Mythos Writer is being built in stages so you get a solid, reliable writing experience first, and then more powerful tools as the system grows. Here’s what you can expect.



⭐ Core features in the first release (MVP)

These are the features you get right away — the foundation of Mythos Writer.



A clean, Word‑like writing experience

Smooth, continuous scrolling



Focus Mode for distraction‑free writing



Header depth slider to switch between book, chapter, and scene views



Two‑vault system with Obsidian compatibility

A Story Vault for your chapters and scenes



A Notes Vault for characters, locations, items, and worldbuilding



Both vaults use standard markdown files



You can open them in Obsidian or open Obsidian vaults in Mythos Writer



A fast manifest.json keeps navigation instant



Core worldbuilding tools

Create and edit Characters, Locations, Items, and Notes



Everything saved as normal markdown files in the Notes Vault



Brainstorm Agent (MVP version)

Automatically creates notes from your conversations



Helps you build your world without touching your story text



Can create scene ideas and planning notes for the Scene Crafter



Writing Assistant (MVP version)

Leaves suggestions in the sidebar



Never edits your story text



Helps with clarity, pacing, grammar, and style



Version history

Per‑scene snapshots



One‑click restore



Safe, non‑destructive editing



Basic planning tools

A simple Scene Crafter board (Kanban‑style) stored as a normal note



A basic timeline view showing confirmed scene times



These features give you a strong, safe, comfortable writing environment from day one.



⭐ Planned later features

These features will arrive in future updates as the system grows more powerful.



Full smart linking and metadata extraction

Automatic detection of characters, locations, and items in your scenes



Suggestions to link scenes to notes



Metadata suggestions (ages, relationships, tags, etc.)



Always requires your approval



Archive Agent (full version)

Advanced continuity checks



Automatic timeline inference



Conflict detection (ages, distances, overlapping events, etc.)



Scene‑to‑note linking



Big‑picture timeline built from your notes



Embeddings and semantic search

Smarter searching across your notes



“Find everything related to this idea”



“Show me all scenes where this theme appears”



Better context for all agents



Plugin API and local model marketplace

Add‑on tools



Custom AI personalities



Local model options for privacy and offline use



Collaboration features

Shared vaults



Commenting



Multi‑writer workflows



These future features will expand Mythos Writer into a full creative studio while keeping your story safe and your notes organized.







\---



⭐ Final note

Mythos Writer is built so you can focus on telling your story while the app quietly handles the complex parts of worldbuilding, organization, and continuity. Your story stays safe, your notes stay organized, and every suggestion is reversible. You stay in control at every step — the AI helps, but you make the decisions.



Mythos Writer’s goal is simple:

Make writing easier, clearer, and more enjoyable, without ever getting in your way.

