# Scene Crafter Board Format Spec

Version: 1.0  
Status: Canonical

## Overview

The Scene Crafter board is a Kanban-style markdown file that is **natively openable** by the [Obsidian Kanban plugin](https://github.com/mgmeyers/obsidian-kanban). It stores scene planning state alongside vault notes so writers can track draft flow without leaving Obsidian.

## File Location

```
<vault-root>/scenes/<story-slug>/board.md
```

## File Structure

```markdown
---
kanban-plugin: board
mythos-board-version: 1
story-id: <uuid>
last-modified: <ISO-8601>
---

## Lane Name

- [ ] [[scenes/story-slug/scene-slug|Scene Title]] #tag1 #tag2

## Another Lane

- [ ] [[scenes/story-slug/scene-slug-2|Scene 2 Title]]
- [x] [[scenes/story-slug/done-scene|Done Scene Title]]

%% kanban:settings
{"kanban-plugin":"board"}
%%
```

## Frontmatter Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `kanban-plugin` | `"board"` | Yes | Tells Obsidian Kanban this is a board file |
| `mythos-board-version` | integer | Yes | Format version; currently `1` |
| `story-id` | UUID string | Yes | Links board to a Mythos story |
| `last-modified` | ISO-8601 | Yes | Updated on every write |

Additional frontmatter keys are allowed and preserved verbatim on round-trip. Mythos never removes keys it does not recognise.

## Lanes (Column Schema)

Each lane is a **level-2 heading** (`## Lane Name`). The heading text is the lane label displayed in Obsidian Kanban.

### Standard Lanes

Standard lanes must appear in this canonical order:

| Position | Lane | Meaning |
|---|---|---|
| 1 | `Idea` | Brainstormed but not drafted |
| 2 | `Outline` | Outline written |
| 3 | `Draft` | In active writing |
| 4 | `Revision` | Drafted, needs revision |
| 5 | `Done` | Final |

### Lane Ordering Rules

- `createBoard()` produces the five standard lanes in the canonical order above.
- The parser preserves whatever lane order it finds in the file (first heading wins, duplicates are coalesced under the first occurrence).
- The serializer writes lanes in the order they appear in the `SceneCrafterBoard.lanes` array — it does not re-sort.
- Custom lanes are allowed anywhere in the array; the parser preserves unknown lane names without modification.
- An empty lane (no cards) serializes as just the `## Lane Name` heading with a blank line before the next section.

## Cards

### Card Schema

Each card is a **list item** under a lane heading. The canonical Mythos format is:

```
- <checkbox> [[<path>|<title>]] [<tags>]
```

Where:

| Part | Definition |
|---|---|
| `<checkbox>` | `[ ]` (open) or `[x]` (done) |
| `<path>` | Vault-relative path to the scene note, no `.md` extension |
| `<title>` | Human-readable display title; the `\|` separator is **required** in Mythos-generated cards |
| `<tags>` | Zero or more space-separated `#tag` tokens (optional) |

**Formal grammar (EBNF):**

```
card        ::= "- [" checkbox "] [[" path "|" title "]]" tags?
checkbox    ::= " " | "x"
path        ::= vault-relative-path          (* no .md extension *)
title       ::= display-text
tags        ::= (" " "#" tag-name)+
tag-name    ::= [a-zA-Z0-9_-]+
```

### Card Status Mapping

| Markdown checkbox | `BoardCard.done` |
|---|---|
| `- [ ]` | `false` |
| `- [x]` | `true` |

### Tag Representation

Tags appear after the wikilink, space-separated, each prefixed with `#`. The Obsidian Kanban plugin renders them as colored chips. Tag names are restricted to `[a-zA-Z0-9_-]`.

## Drag-Source Link Representation

When a user drags a card in Obsidian's Kanban UI, the plugin moves the card's raw markdown line from one lane section to another without modifying its content. The wikilink and tags are preserved verbatim.

**Expected invariants on drag:**

- The checkbox state is NOT changed by a lane move — only by explicit check/uncheck in the UI.
- The `[[path|title]]` form is preserved verbatim; Obsidian does not rewrite wikilinks on drag.
- Tags are preserved in their original order.

**Graceful degradation — cards without `|title`:**

If a user manually types `- [ ] [[scenes/foo/bar]]` (no `|` alias) or another tool writes a bare wikilink, Mythos parsers MUST degrade gracefully:

- Treat the path basename (last path segment) as the display title.
- Preserve the `raw` line for round-trip fidelity.
- Do NOT silently drop the card.

> ⚠️ The current parser (`CARD_RE`) requires the `|title` separator and will silently drop bare-wikilink cards. This is tracked as a follow-up delta — see **Parser Deltas** below.

## Footer Block

The trailing `%% kanban:settings … %%` comment is required by the Obsidian Kanban plugin to store its UI settings. Mythos writes a minimal version:

```
%% kanban:settings
{"kanban-plugin":"board"}
%%
```

- Mythos preserves any keys in the settings JSON object that it does not recognise on round-trip.
- The block must be the last element in the file (after all lane sections).
- The opening `%%` line must be exactly `%% kanban:settings` with no trailing content.

## Obsidian Kanban Compatibility

The file is designed so that a user can open it directly in Obsidian with the Kanban plugin installed:

1. `kanban-plugin: board` frontmatter key activates the board view.
2. Level-2 headings become swimlane columns.
3. Checkbox list items become cards; `[x]` items appear as completed.
4. Wikilinks inside cards are clickable and navigate to the scene note.
5. The `%% kanban:settings %%` block is read by the plugin for board configuration (lane colours, card widths, etc.).

No extra Obsidian configuration is required — the file is self-describing.

## Round-Trip Guarantee

The parser (`parseBoardMarkdown`) and serializer (`serializeBoardMarkdown`) are inverse operations for all **canonically-formatted** files:

```
serializeBoardMarkdown(parseBoardMarkdown(src)) ≡ src
```

Normalization applied on write:

- A single blank line between the heading and cards within each lane.
- A single blank line between lane sections.
- The footer block always appears last, separated by a blank line.

Files with non-canonical whitespace (e.g., extra blank lines, trailing spaces) may be normalized on the first round-trip write.

## Migration Story

### v1 (current — `mythos-board-version: 1`)

All files written by Mythos since the initial release carry `mythos-board-version: 1`.

### Upgrading pre-v1 files (no `mythos-board-version` key)

Older board files created before this spec was formalized may lack the `mythos-board-version` frontmatter key.

**Parser behaviour:**

- Parse as v1 (best-effort). All other fields are read normally.
- On the next write, `mythos-board-version: 1` is automatically inserted.
- If `story-id` is absent, it defaults to the parent directory segment of the file path converted to a UUID via a deterministic name-hash (SHA-1 namespace UUID). The caller is responsible for resolving the story before writing.
- If `kanban-plugin` is absent from frontmatter, it is inserted as `board` on write.

**Migration is transparent** — no manual step is required. Opening the file and saving any change upgrades it in-place.

### Future versions

- Increment `mythos-board-version` for any breaking changes to the card grammar, frontmatter schema, or serialization rules.
- Document the delta in a versioned section below this one (e.g., `### v2 → v1 downgrade path`).
- The parser dispatches on the version number; the v1 parser is always available as a fallback for unknown versions (with a warning).
- Backwards-incompatible changes that break Obsidian Kanban compatibility require a `kanban-plugin` version gate.

## Parser Deltas (Filed Follow-Ups)

The following gaps between this spec and the current implementation (`electron-main/src/sceneCrafterBoard.ts`) are known and tracked as follow-up issues:

| Delta | Spec requirement | Current behaviour | Follow-up |
|---|---|---|---|
| Bare wikilink cards | Parse `[[path]]` (no `|title`) gracefully, using basename as title | `CARD_RE` silently drops the card — the regex requires `\|title` | MYT-357 |
| Pre-v1 migration | Insert `mythos-board-version: 1` on write if absent | No migration path implemented | MYT-357 |

## Example

See `electron-main/fixtures/scene-crafter-sample.md` for a complete sample board that exercises all five standard lanes, tags, done/open cards, and the kanban:settings footer.
