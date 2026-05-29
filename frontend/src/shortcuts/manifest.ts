/**
 * Single source of truth for every keyboard shortcut in Mythos Writer.
 * The KeyboardShortcutsModal imports this directly; docs/shortcuts.md is generated
 * from it via `npm run docs:shortcuts`.
 *
 * Audited against: DesktopShell, BlockEditor (Tiptap StarterKit), BrainstormPage,
 * WritingAssistantPanel, ProjectSwitcher, SearchBar, StoryNavigator, VaultSidebar,
 * VirtualTree, ContextMenu, KanbanBoard, OnboardingWizard, EntityBrowser,
 * SettingsPanel, SuggestionReview, useTextPrompt.
 */

export type KeyCombo = {
  ctrlOrCmd?: true;
  shift?: true;
  alt?: true;
  /** Bare key string: 'F', 'Escape', 'Enter', 'ArrowUp', 'Tab', etc. */
  key: string;
};

export type ShortcutGroup =
  | 'modes'
  | 'vault'
  | 'editor'
  | 'brainstorm'
  | 'navigation'
  | 'dialogs'
  | 'help';

export type ShortcutScope =
  | 'global'
  | 'editor'
  | 'list'
  | 'dialog'
  | 'tree';

export type ShortcutEntry = {
  id: string;
  group: ShortcutGroup;
  label: string;
  keys: KeyCombo[];
  scope: ShortcutScope;
  /** Human-readable note about when this shortcut is unavailable. */
  whenDisabled?: string;
};

const MANIFEST: ShortcutEntry[] = [
  // ─── Writing Modes ────────────────────────────────────────────────────────
  {
    id: 'mode-focus',
    group: 'modes',
    label: 'Switch to Focus mode',
    keys: [{ ctrlOrCmd: true, shift: true, key: 'F' }],
    scope: 'global',
  },
  {
    id: 'mode-edit',
    group: 'modes',
    label: 'Switch to Edit mode',
    keys: [{ ctrlOrCmd: true, shift: true, key: 'E' }],
    scope: 'global',
  },
  {
    id: 'mode-normal',
    group: 'modes',
    label: 'Switch to Normal mode',
    keys: [{ ctrlOrCmd: true, shift: true, key: 'N' }],
    scope: 'global',
  },

  // ─── Navigation ───────────────────────────────────────────────────────────
  {
    id: 'project-switcher-open',
    group: 'navigation',
    label: 'Open project switcher',
    keys: [{ ctrlOrCmd: true, shift: true, key: 'P' }],
    scope: 'global',
  },
  {
    id: 'project-switcher-close',
    group: 'navigation',
    label: 'Close project switcher',
    keys: [{ key: 'Escape' }],
    scope: 'dialog',
    whenDisabled: 'Only active while the project switcher is open',
  },
  {
    id: 'panel-left-expand',
    group: 'navigation',
    label: 'Expand left panel (+8 px)',
    keys: [{ key: 'ArrowRight' }],
    scope: 'list',
    whenDisabled: 'Only active when the left panel divider has focus',
  },
  {
    id: 'panel-left-shrink',
    group: 'navigation',
    label: 'Shrink left panel (−8 px)',
    keys: [{ key: 'ArrowLeft' }],
    scope: 'list',
    whenDisabled: 'Only active when the left panel divider has focus',
  },
  {
    id: 'panel-left-min',
    group: 'navigation',
    label: 'Snap left panel to minimum width',
    keys: [{ key: 'Home' }],
    scope: 'list',
    whenDisabled: 'Only active when the left panel divider has focus',
  },
  {
    id: 'panel-left-max',
    group: 'navigation',
    label: 'Snap left panel to maximum width',
    keys: [{ key: 'End' }],
    scope: 'list',
    whenDisabled: 'Only active when the left panel divider has focus',
  },
  {
    id: 'panel-right-expand',
    group: 'navigation',
    label: 'Expand right panel (+8 px)',
    // ArrowLeft expands the right panel (right edge moves left → wider)
    keys: [{ key: 'ArrowLeft' }],
    scope: 'list',
    whenDisabled: 'Only active when the right panel divider has focus',
  },
  {
    id: 'panel-right-shrink',
    group: 'navigation',
    label: 'Shrink right panel (−8 px)',
    keys: [{ key: 'ArrowRight' }],
    scope: 'list',
    whenDisabled: 'Only active when the right panel divider has focus',
  },
  {
    id: 'panel-right-min',
    group: 'navigation',
    label: 'Snap right panel to minimum width',
    keys: [{ key: 'Home' }],
    scope: 'list',
    whenDisabled: 'Only active when the right panel divider has focus',
  },
  {
    id: 'panel-right-max',
    group: 'navigation',
    label: 'Snap right panel to maximum width',
    keys: [{ key: 'End' }],
    scope: 'list',
    whenDisabled: 'Only active when the right panel divider has focus',
  },
  {
    id: 'search-up',
    group: 'navigation',
    label: 'Navigate to previous search result',
    keys: [{ key: 'ArrowUp' }],
    scope: 'list',
    whenDisabled: 'Only active while the search results dropdown is open',
  },
  {
    id: 'search-down',
    group: 'navigation',
    label: 'Navigate to next search result',
    keys: [{ key: 'ArrowDown' }],
    scope: 'list',
    whenDisabled: 'Only active while the search results dropdown is open',
  },
  {
    id: 'search-select',
    group: 'navigation',
    label: 'Select highlighted search result',
    keys: [{ key: 'Enter' }],
    scope: 'list',
    whenDisabled: 'Only active while the search results dropdown is open',
  },
  {
    id: 'search-close',
    group: 'navigation',
    label: 'Close search results',
    keys: [{ key: 'Escape' }],
    scope: 'list',
    whenDisabled: 'Only active while the search results dropdown is open',
  },

  // ─── Vault / File Tree ────────────────────────────────────────────────────
  {
    id: 'tree-open-node',
    group: 'vault',
    label: 'Open selected file or scene',
    keys: [{ key: 'Enter' }],
    scope: 'tree',
  },
  {
    id: 'tree-expand-dir',
    group: 'vault',
    label: 'Expand selected folder',
    keys: [{ key: 'ArrowRight' }],
    scope: 'tree',
    whenDisabled: 'Only available on a collapsed folder node',
  },
  {
    id: 'tree-collapse-dir',
    group: 'vault',
    label: 'Collapse selected folder',
    keys: [{ key: 'ArrowLeft' }],
    scope: 'tree',
    whenDisabled: 'Only available on an expanded folder node',
  },
  {
    id: 'tree-toggle-dir',
    group: 'vault',
    label: 'Toggle folder expand / collapse',
    keys: [{ key: 'Enter' }, { key: ' ' }],
    scope: 'tree',
    whenDisabled: 'Only available on a folder node in the Notes Vault tree',
  },
  {
    id: 'context-menu-close',
    group: 'vault',
    label: 'Close context menu',
    keys: [{ key: 'Escape' }],
    scope: 'tree',
    whenDisabled: 'Only active while a context menu is open',
  },
  {
    id: 'story-scene-activate',
    group: 'vault',
    label: 'Open selected scene',
    keys: [{ key: 'Enter' }, { key: ' ' }],
    scope: 'list',
    whenDisabled: 'Only active in the StoryNavigator scene list',
  },
  {
    id: 'story-scene-up',
    group: 'vault',
    label: 'Move scene up in chapter',
    keys: [{ key: 'ArrowUp' }],
    scope: 'list',
    whenDisabled: 'Only active in the StoryNavigator scene list',
  },
  {
    id: 'story-scene-down',
    group: 'vault',
    label: 'Move scene down in chapter',
    keys: [{ key: 'ArrowDown' }],
    scope: 'list',
    whenDisabled: 'Only active in the StoryNavigator scene list',
  },

  // ─── Editor ───────────────────────────────────────────────────────────────
  // ProseMirror/Tiptap StarterKit native shortcuts — not in our keydown handlers
  // but documented here so writers can discover them.
  {
    id: 'editor-bold',
    group: 'editor',
    label: 'Bold',
    keys: [{ ctrlOrCmd: true, key: 'B' }],
    scope: 'editor',
  },
  {
    id: 'editor-italic',
    group: 'editor',
    label: 'Italic',
    keys: [{ ctrlOrCmd: true, key: 'I' }],
    scope: 'editor',
  },
  {
    id: 'editor-code',
    group: 'editor',
    label: 'Inline code',
    keys: [{ ctrlOrCmd: true, key: 'E' }],
    scope: 'editor',
  },
  {
    id: 'editor-strike',
    group: 'editor',
    label: 'Strikethrough',
    keys: [{ ctrlOrCmd: true, shift: true, key: 'S' }],
    scope: 'editor',
  },
  {
    id: 'editor-undo',
    group: 'editor',
    label: 'Undo',
    keys: [{ ctrlOrCmd: true, key: 'Z' }],
    scope: 'editor',
  },
  {
    id: 'editor-redo',
    group: 'editor',
    label: 'Redo',
    keys: [{ ctrlOrCmd: true, shift: true, key: 'Z' }],
    scope: 'editor',
  },
  {
    id: 'editor-hard-break',
    group: 'editor',
    label: 'Insert line break (no new paragraph)',
    keys: [{ shift: true, key: 'Enter' }],
    scope: 'editor',
  },
  {
    id: 'editor-list-indent',
    group: 'editor',
    label: 'Indent list item',
    keys: [{ key: 'Tab' }],
    scope: 'editor',
    whenDisabled: 'Only active when cursor is inside a list',
  },
  {
    id: 'editor-list-outdent',
    group: 'editor',
    label: 'Outdent list item',
    keys: [{ shift: true, key: 'Tab' }],
    scope: 'editor',
    whenDisabled: 'Only active when cursor is inside a list',
  },

  // ─── Suggestion Review ─────────────────────────────────────────────────────
  {
    id: 'suggestion-accept',
    group: 'editor',
    label: 'Accept suggestion',
    keys: [{ key: 'Enter' }],
    scope: 'list',
    whenDisabled: 'Only active when a suggestion row has focus in the Suggestion Review panel',
  },
  {
    id: 'suggestion-reject',
    group: 'editor',
    label: 'Reject suggestion',
    keys: [{ key: 'Backspace' }, { key: 'Delete' }],
    scope: 'list',
    whenDisabled: 'Only active when a suggestion row has focus in the Suggestion Review panel',
  },
  {
    id: 'suggestion-ignore',
    group: 'editor',
    label: 'Ignore suggestion',
    keys: [{ key: 'i' }],
    scope: 'list',
    whenDisabled: 'Only active when a suggestion row has focus in the Suggestion Review panel',
  },

  // ─── Brainstorm ───────────────────────────────────────────────────────────
  {
    id: 'brainstorm-send',
    group: 'brainstorm',
    label: 'Send message',
    keys: [{ key: 'Enter' }],
    scope: 'editor',
    whenDisabled: 'Only active in the Brainstorm chat input',
  },
  {
    id: 'brainstorm-newline',
    group: 'brainstorm',
    label: 'Insert newline in message',
    keys: [{ shift: true, key: 'Enter' }],
    scope: 'editor',
    whenDisabled: 'Only active in the Brainstorm chat input',
  },
  {
    id: 'writing-assistant-send',
    group: 'brainstorm',
    label: 'Send writing assistant prompt',
    keys: [{ key: 'Enter' }],
    scope: 'editor',
    whenDisabled: 'Only active in the Writing Assistant prompt input',
  },

  // ─── Dialogs ──────────────────────────────────────────────────────────────
  {
    id: 'dialog-confirm',
    group: 'dialogs',
    label: 'Confirm / submit dialog',
    keys: [{ key: 'Enter' }],
    scope: 'dialog',
  },
  {
    id: 'dialog-cancel',
    group: 'dialogs',
    label: 'Cancel / close dialog',
    keys: [{ key: 'Escape' }],
    scope: 'dialog',
  },
  {
    id: 'dialog-focus-next',
    group: 'dialogs',
    label: 'Focus next element in dialog',
    keys: [{ key: 'Tab' }],
    scope: 'dialog',
  },
  {
    id: 'dialog-focus-prev',
    group: 'dialogs',
    label: 'Focus previous element in dialog',
    keys: [{ shift: true, key: 'Tab' }],
    scope: 'dialog',
  },
  {
    id: 'kanban-card-open',
    group: 'dialogs',
    label: 'Open Kanban card',
    keys: [{ key: 'Enter' }, { key: ' ' }],
    scope: 'list',
    whenDisabled: 'Only active on a focused Kanban card',
  },
  {
    id: 'onboarding-activate',
    group: 'dialogs',
    label: 'Activate onboarding path tile',
    keys: [{ key: 'Enter' }, { key: ' ' }],
    scope: 'dialog',
    whenDisabled: 'Only active during the onboarding wizard',
  },
];

export default MANIFEST;
