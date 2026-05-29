# Keyboard Shortcuts

> **Generated from** `frontend/src/shortcuts/manifest.ts`.
> To update: edit the manifest, then run `npm run docs:shortcuts`.

---

## Writing Modes

| Keys | Scope | Action | Notes |
|------|-------|--------|-------|
| `⌘/Ctrl+Shift+F` | global | Focus mode |  |
| `⌘/Ctrl+Shift+E` | global | Edit mode |  |
| `⌘/Ctrl+Shift+N` | global | Normal mode |  |

## Navigation

| Keys | Scope | Action | Notes |
|------|-------|--------|-------|
| `⌘/Ctrl+Shift+P` | global | Open project switcher |  |
| `ArrowDown` | list | Next search result |  |
| `ArrowUp` | list | Previous search result |  |
| `Enter` | list | Open selected search result |  |
| `Escape` | list | Close search |  |
| `⌘/Ctrl+Alt/⌥+ArrowUp` | global | Go up one depth level (Scene → Chapter → Book) |  |
| `⌘/Ctrl+Alt/⌥+ArrowDown` | global | Go down one depth level (Book → Chapter → Scene) |  |
| `⌘/Ctrl+Alt/⌥+ArrowLeft` | global | Previous sibling at current depth |  |
| `⌘/Ctrl+Alt/⌥+ArrowRight` | global | Next sibling at current depth |  |
| `Shift+ArrowUp` | list | Move scene up in list |  |
| `Shift+ArrowDown` | list | Move scene down in list |  |
| `Enter or  ` | list | Open scene / confirm selection |  |
| `ArrowUp` | list | Previous version in scene history | Only active when Scene History panel is focused |
| `ArrowDown` | list | Next version in scene history | Only active when Scene History panel is focused |
| `Shift+Enter` | list | Restore selected history version | Only active when Scene History panel is focused |
| `ArrowRight` | list | Next right-sidebar tab | Only active when right sidebar tab bar is focused |
| `ArrowLeft` | list | Previous right-sidebar tab | Only active when right sidebar tab bar is focused |
| `ArrowLeft` | list | Shrink panel 8 px (panel resize handle focused) | Only active when a panel resize handle is focused |
| `ArrowRight` | list | Grow panel 8 px (panel resize handle focused) | Only active when a panel resize handle is focused |
| `Home` | list | Snap panel to minimum width | Only active when a panel resize handle is focused |
| `End` | list | Snap panel to maximum width | Only active when a panel resize handle is focused |

## Vault & Tree

| Keys | Scope | Action | Notes |
|------|-------|--------|-------|
| `Enter` | tree | Open file or toggle directory |  |
| `ArrowRight` | tree | Expand directory |  |
| `ArrowLeft` | tree | Collapse directory |  |
| `Escape` | tree | Close context menu |  |

## Editor (native shortcuts)

| Keys | Scope | Action | Notes |
|------|-------|--------|-------|
| `⌘/Ctrl+B` | editor | Bold | Native contenteditable / ProseMirror shortcut — not in app keydown handlers |
| `⌘/Ctrl+I` | editor | Italic | Native contenteditable / ProseMirror shortcut — not in app keydown handlers |
| `⌘/Ctrl+Z` | editor | Undo | Native contenteditable / ProseMirror shortcut — not in app keydown handlers |
| `⌘/Ctrl+Shift+Z` | editor | Redo | Native contenteditable / ProseMirror shortcut — not in app keydown handlers |

## Brainstorm & Writing Assistant

| Keys | Scope | Action | Notes |
|------|-------|--------|-------|
| `Enter` | dialog | Send message / submit prompt | Only active when Brainstorm or Writing Assistant prompt textarea is focused |
| `Shift+Enter` | dialog | Insert newline in prompt | Only active when Brainstorm or Writing Assistant prompt textarea is focused |

## Dialogs & Inline Actions

| Keys | Scope | Action | Notes |
|------|-------|--------|-------|
| `Enter` | list | Accept suggestion | Only active when Suggestion Review panel is focused |
| `Backspace or Delete` | list | Reject suggestion | Only active when Suggestion Review panel is focused |
| `i` | list | Ignore suggestion | Only active when Suggestion Review panel is focused |
| `Escape` | dialog | Close dialog / cancel |  |
| `Enter` | dialog | Confirm / submit | Depends on dialog type; may submit a form or accept a prompt |
| `Tab` | dialog | Next focusable element (focus trap) |  |
| `Shift+Tab` | dialog | Previous focusable element (focus trap) |  |
| `Enter` | dialog | Commit inline rename (Kanban / path edit) | Only active when an inline rename field is focused |
| `Escape` | dialog | Cancel inline rename (Kanban / path edit) | Only active when an inline rename field is focused |

## Help

| Keys | Scope | Action | Notes |
|------|-------|--------|-------|
| `?` | global | Open keyboard shortcuts cheat-sheet | Ignored when an editable element (input, textarea, contenteditable) is focused |

---

## Collision Notes

No collisions found in audit. Scope-isolated shortcuts (e.g. `Enter` in a list vs. a dialog) fire only within their focus scope — no ambiguity.

### Intentionally absent
- `⌘/Ctrl+S` — autosave is always on; no explicit shortcut needed.
- `⌘/Ctrl+N` — new note available only from toolbar.
- `⌘/Ctrl+F` — global find relies on SearchBar focus affordance.
