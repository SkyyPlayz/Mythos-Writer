# Mythos Writer — User Guide

This guide covers the main feature surfaces of Mythos Writer. For installation and quickstart, see the [README](../README.md).

---

## Contents

1. [Vault management](#vault-management)
2. [Scene editor](#scene-editor)
3. [Brainstorm AI](#brainstorm-ai)
4. [Settings and appearance](#settings-and-appearance)
5. [Backup and portability](#backup-and-portability)

---

## Vault management

### What is a vault?

A vault is a folder on your machine that holds everything Mythos Writer saves for you. It contains two sections that appear as separate areas in the left rail:

| Section | Purpose |
|---------|---------|
| **Story Vault** | Your manuscript — Stories, Chapters, and Scenes |
| **Notes Vault** | Free-form Markdown notes, world-building, research |

Both sections live inside the same vault folder. You can open any file with an external editor and the changes are reflected in Mythos Writer.

### Choosing a vault location

The onboarding wizard runs once when you first open the app. It lets you:

- **Use the default path** (`~/Mythos`) — recommended for new projects
- **Pick a custom folder** — choose any writable directory
- **Import an Obsidian vault** — walks you through a dry-run check before importing

To switch vaults after setup, click the **project name** in the top bar (the Project Switcher) and choose or add a vault.

### Story Vault — Stories, Chapters, Scenes

Stories are organised as a three-level tree:

```
Story
  └── Chapter
        └── Scene  (one Markdown file per scene)
```

**Create items** by clicking **+** in the left rail:
- **+** next to *Story Vault* → new story
- **+** next to a story name → new chapter
- **+** next to a chapter name → new scene

**Rename a scene** — double-click the scene name in the left rail to edit it in place. Press Enter or click away to save.

**Reorder scenes** — drag scenes within a chapter to reorder them. The order is reflected in exports.

**Scene draft states** — each scene has a state that you can change from the toolbar at the bottom of the editor:

| State | Meaning |
|-------|---------|
| In Progress | Default — actively being written |
| Review | Ready for a second pass |
| Final | Locked / complete |

### Notes Vault

The Notes Vault tab (left rail → **Vault**) shows the full folder tree of your vault, excluding manuscript files and internal metadata. Click any `.md` file to open it. Click **+** in the section header to create a new note.

Notes support WikiLinks — type `[[Note name]]` to link to another file by title.

---

## Scene editor

### Writing

Click a scene in the left rail to open it in the editor. The editor uses rich text with Markdown storage: what you write is saved as standard Markdown files, so they remain readable outside the app.

Standard text formatting:

| Shortcut | Effect |
|----------|--------|
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |

### WikiLinks

Type `[[` to start a wiki-link. As you type, a hint tooltip suggests matching entities from your vault. Press Enter or click a suggestion to insert the link. WikiLinks appear highlighted in the editor and connect scenes in the Graph view.

### Word count

The editor toolbar shows a live word count and estimated reading time for the current scene. The bottom bar also shows cumulative word count.

### Draft state

The bottom bar shows the current scene's draft state as a badge (In Progress / Review / Final). Click the badge to cycle through states.

### Snapshot history

Mythos Writer automatically saves a snapshot every time you pause writing. To browse or restore a previous version:

1. Right-click anywhere in the editor → **History**
2. Choose a snapshot from the list
3. Click **Restore** to revert the scene to that snapshot

### Writing modes

Three writing modes are available from the mode buttons (`N / F / E`) in the top bar, or via keyboard shortcuts:

| Mode | Shortcut | Description |
|------|----------|-------------|
| Normal | `Ctrl+Shift+N` | Full layout — left rail, editor, right sidebar |
| Focus | `Ctrl+Shift+F` | Distraction-free — hides sidebars (configurable) |
| Edit | `Ctrl+Shift+E` | Review mode — opens the AI Writing Assistant in the right sidebar |

In Focus mode, click the ⚙ button next to the mode buttons to configure which panels remain visible.

### Keyboard shortcuts reference

Press **`?`** from the editor canvas (not inside a text input) to open the keyboard shortcuts dialog. Press **Escape** to close it.

### Exporting

To export a story to EPUB or DOCX:

1. Select any scene in the story (so the story is active)
2. Click **File** in the top menu bar
3. Choose **Export EPUB…** or **Export DOCX…**
4. Pick a save location

The export includes all scenes in order across all chapters.

---

## Brainstorm AI

### Opening brainstorm

Click **Brainstorm** in the top navigation bar. You need an Anthropic API key configured in Settings for AI features to work.

### Chatting

Type your message in the input box and press Enter. Mythos Writer sends your message to Claude and streams the response back. You can continue the conversation naturally — the session persists until you navigate away.

### Automatic entity extraction

When the AI response mentions a named character, location, item, or notable concept, it emits a structured tag that Mythos Writer picks up automatically. These extracted facts appear in the panel on the right side of the brainstorm view:

| Fact type | Example |
|-----------|---------|
| Character | A named person in your story |
| Location | A place that appears in your world |
| Item | An object of significance |
| Note | A general world-building observation |

Extracted facts are saved to your vault's entity database and become searchable in the **Entities** tab of the left rail.

### Continuity check

Mythos Writer's archive agent scans your scenes in the background and flags potential continuity issues (for example: a character's eye colour described differently in two scenes). These appear in the left rail → **Review** tab, where you can accept or reject each suggestion.

---

## Settings and appearance

Open Settings by clicking the **⚙** icon in the top-right corner of the menu bar, or via **File → Settings…**.

### API key

Paste your Anthropic API key in the **API Key** field. The key is stored locally in `userData/app-settings.json` on your machine — it is never sent anywhere except directly to the Anthropic API when you invoke an AI feature.

### Theme

Two themes are available:

| Theme | Description |
|-------|-------------|
| Dark (Liquid Glass) | Default dark theme with translucent glass styling |
| High contrast | Accessible theme with stronger contrast ratios |

In the Dark theme you can also customise:
- **Background gradient colours** — pick start and end hex colours for the gradient; the UI shows a live contrast ratio badge to ensure readability
- **Background position** — nine-position grid to pin the gradient anchor point
- **Accent and text colours** — fine-tune the palette with a contrast floor enforced automatically

### AI model

Each AI agent (Writing Assistant, Brainstorm, Archive) can be set to a different Claude model:

| Model | Speed / Cost | Best for |
|-------|-------------|---------|
| claude-haiku | Fastest, lowest cost | High-frequency suggestions |
| claude-sonnet | Balanced | General brainstorm and review |
| claude-opus | Most capable, highest cost | Deep story analysis |

### Agent settings

For each agent you can configure:
- **Enabled** — toggle the agent on or off
- **Scan interval** — how often the Writing Assistant or Archive agent checks your scene (in seconds)
- **Auto-apply** — whether accepted suggestions are applied automatically
- **Confidence threshold** — minimum confidence for a suggestion to appear
- **Token and suggestion budgets** — hourly and daily limits to control API spend

### Snapshot settings

Configure how many snapshots are kept per scene (default: 100) and how long old snapshots are retained (default: 30 days) before automatic pruning.

### Update channel

To receive beta releases before they reach stable:

1. Open Settings
2. Find **Update Channel** and select **Beta**

Beta releases are labelled `v*.*.*-beta*` on the Releases page. To opt back in to Stable, change the setting back.

---

## Backup and portability

### Your files are plain Markdown

Every scene you write is stored as a `.md` file inside your vault folder. The folder structure is:

```
~/Mythos/
  manifest.json          ← story/chapter/scene index
  Manuscript/
    <story-id>/
      <chapter-id>/
        <scene-id>.md    ← one file per scene
  (notes and other markdown files at top level)
```

You can open, edit, copy, or version-control these files with any tool. Deleting or renaming files outside the app may desync the manifest — use Mythos Writer's rename and delete actions when possible.

### Moving your vault

To move your vault to a new location:

1. Close Mythos Writer
2. Copy or move the vault folder to the new path
3. Reopen Mythos Writer — the Project Switcher will prompt for the new path, or you can click the project name and choose **Add vault…**

### Backup (.mwbackup)

Mythos Writer can create a `.mwbackup` archive via **File → Backup…** (if available in your version). The backup includes your app settings, vault manifest, and internal metadata. Your scene Markdown files are **not** included in the backup archive — back those up with your normal file-backup solution (Time Machine, rsync, cloud storage, etc.), since they are already plain files.

### Version control

Because scenes are Markdown files, you can `git init` inside your vault folder to track changes with Git. This gives you a full history independent of Mythos Writer's snapshot system.
