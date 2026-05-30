# Keyboard Shortcuts — Mythos Writer

> Audit date: 2026-05-29. Generated from SKY-83.
> All shortcuts were verified by grepping `keydown`, `addEventListener`, and `onKeyDown` handlers across the renderer source.

`Mod` = `Ctrl` on Windows/Linux, `⌘` on macOS.

---

## Global

| Shortcut | Action | Source |
|---|---|---|
| `Mod+Shift+N` | Switch to Normal mode | `DesktopShell.tsx` |
| `Mod+Shift+F` | Switch to Focus mode | `DesktopShell.tsx` |
| `Mod+Shift+E` | Switch to Edit mode | `DesktopShell.tsx` |
| `Mod+Shift+P` | Toggle Project Switcher | `ProjectSwitcher.tsx` |
| `?` | Open Keyboard Shortcuts help (this dialog) | `DesktopShell.tsx` |
| `Escape` | Close modal / dismiss overlay | Various |

---

## Editor — Navigation (DepthSlider)

| Shortcut | Action | Source |
|---|---|---|
| `Mod+Alt+↑` | Zoom view depth up (Scene → Chapter → Book) | `DepthSlider.tsx` |
| `Mod+Alt+↓` | Zoom view depth down | `DepthSlider.tsx` |
| `Mod+Alt+←` | Previous scene or chapter | `DepthSlider.tsx` |
| `Mod+Alt+→` | Next scene or chapter | `DepthSlider.tsx` |

---

## Editor — Text (Tiptap defaults)

These are standard Tiptap / ProseMirror bindings wired via `@tiptap/starter-kit` in `BlockEditor.tsx`.

| Shortcut | Action |
|---|---|
| `Mod+B` | Bold |
| `Mod+I` | Italic |
| `Mod+Z` | Undo |
| `Mod+Shift+Z` | Redo |

---

## Story Navigator

| Shortcut | Action | Source |
|---|---|---|
| `Enter` / `Space` | Open selected scene | `StoryNavigator.tsx` |
| `↑` | Move scene up in chapter | `StoryNavigator.tsx` |
| `↓` | Move scene down in chapter | `StoryNavigator.tsx` |

---

## Suggestion Review

| Shortcut | Action | Source |
|---|---|---|
| `Enter` | Accept suggestion | `SuggestionReview.tsx` |
| `Delete` / `Backspace` | Reject suggestion | `SuggestionReview.tsx` |
| `I` | Ignore suggestion | `SuggestionReview.tsx` |

---

## Brainstorm & Writing Assistant

| Shortcut | Action | Source |
|---|---|---|
| `Enter` | Submit prompt | `BrainstormPage.tsx`, `WritingAssistantPanel.tsx` |
| `Shift+Enter` | Insert newline in prompt | `BrainstormPage.tsx`, `WritingAssistantPanel.tsx` |

---

## Search Bar

| Shortcut | Action | Source |
|---|---|---|
| `↓` / `↑` | Navigate search results | `SearchBar.tsx` |
| `Enter` | Select highlighted result | `SearchBar.tsx` |
| `Escape` | Close search results | `SearchBar.tsx` |

---

## Right Sidebar Tabs

| Shortcut | Action | Source |
|---|---|---|
| `→` | Next sidebar tab | `RightSidebar.tsx` |
| `←` | Previous sidebar tab | `RightSidebar.tsx` |

---

## Panel Resize Handles

| Shortcut | Action | Source |
|---|---|---|
| `←` / `→` | Resize left/right panel by 8px | `DesktopShell.tsx` |
| `Home` | Reset panel to minimum width | `DesktopShell.tsx` |
| `End` | Reset panel to maximum width | `DesktopShell.tsx` |

---

## Modal Focus Traps

These are accessibility-only bindings, not user-facing shortcuts.

| Shortcut | Context | Source |
|---|---|---|
| `Tab` / `Shift+Tab` | Navigate focusable elements | `EntityBrowser.tsx`, `SettingsPanel.tsx`, `useTextPrompt.tsx` |
| `Enter` | Submit text input modal | `useTextPrompt.tsx` |
| `Escape` | Cancel text input modal | `useTextPrompt.tsx` |

---

## Grep Audit

Shortcuts were sourced by searching:

```
grep -rn "keydown\|addEventListener.*key\|onKeyDown\|key === " frontend/src/
```

Files containing keyboard handlers:

- `DesktopShell.tsx` — global writing mode + `?` shortcut
- `DepthSlider.tsx` — Mod+Alt+Arrow navigation
- `ProjectSwitcher.tsx` — Mod+Shift+P
- `StoryNavigator.tsx` — arrow reorder, Enter/Space open
- `SuggestionReview.tsx` — Enter/Delete/Backspace/I
- `BrainstormPage.tsx` — Enter submit, Shift+Enter newline
- `WritingAssistantPanel.tsx` — Enter submit, Shift+Enter newline
- `SearchBar.tsx` — arrow navigation, Enter select, Escape close
- `RightSidebar.tsx` — arrow tab switch
- `EntityBrowser.tsx` — Tab focus trap, Escape close
- `SettingsPanel.tsx` — Tab focus trap
- `useTextPrompt.tsx` — Enter submit, Escape cancel
