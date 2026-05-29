export type KeyCombo = {
  mod?: 'cmd-or-ctrl' | 'shift' | 'alt' | ('cmd-or-ctrl' | 'shift' | 'alt')[];
  key: string;
};

export type ShortcutEntry = {
  id: string;
  group: 'modes' | 'vault' | 'editor' | 'brainstorm' | 'navigation' | 'dialogs' | 'help';
  label: string;
  keys: KeyCombo[];
  scope: 'global' | 'editor' | 'list' | 'dialog' | 'tree';
  whenDisabled?: string;
};

const MANIFEST: ShortcutEntry[] = [
  // ─── Writing modes (global) ───
  {
    id: 'mode-focus',
    group: 'modes',
    label: 'Focus mode',
    keys: [{ mod: ['cmd-or-ctrl', 'shift'], key: 'F' }],
    scope: 'global',
  },
  {
    id: 'mode-edit',
    group: 'modes',
    label: 'Edit mode',
    keys: [{ mod: ['cmd-or-ctrl', 'shift'], key: 'E' }],
    scope: 'global',
  },
  {
    id: 'mode-normal',
    group: 'modes',
    label: 'Normal mode',
    keys: [{ mod: ['cmd-or-ctrl', 'shift'], key: 'N' }],
    scope: 'global',
  },

  // ─── Navigation ───
  {
    id: 'nav-project-switcher',
    group: 'navigation',
    label: 'Open project switcher',
    keys: [{ mod: ['cmd-or-ctrl', 'shift'], key: 'P' }],
    scope: 'global',
  },
  {
    id: 'nav-search-next',
    group: 'navigation',
    label: 'Next search result',
    keys: [{ key: 'ArrowDown' }],
    scope: 'list',
  },
  {
    id: 'nav-search-prev',
    group: 'navigation',
    label: 'Previous search result',
    keys: [{ key: 'ArrowUp' }],
    scope: 'list',
  },
  {
    id: 'nav-search-select',
    group: 'navigation',
    label: 'Open selected search result',
    keys: [{ key: 'Enter' }],
    scope: 'list',
  },
  {
    id: 'nav-search-close',
    group: 'navigation',
    label: 'Close search',
    keys: [{ key: 'Escape' }],
    scope: 'list',
  },
  {
    id: 'nav-depth-up',
    group: 'navigation',
    label: 'Go up one depth level (Scene → Chapter → Book)',
    keys: [{ mod: ['cmd-or-ctrl', 'alt'], key: 'ArrowUp' }],
    scope: 'global',
  },
  {
    id: 'nav-depth-down',
    group: 'navigation',
    label: 'Go down one depth level (Book → Chapter → Scene)',
    keys: [{ mod: ['cmd-or-ctrl', 'alt'], key: 'ArrowDown' }],
    scope: 'global',
  },
  {
    id: 'nav-depth-prev-sibling',
    group: 'navigation',
    label: 'Previous sibling at current depth',
    keys: [{ mod: ['cmd-or-ctrl', 'alt'], key: 'ArrowLeft' }],
    scope: 'global',
  },
  {
    id: 'nav-depth-next-sibling',
    group: 'navigation',
    label: 'Next sibling at current depth',
    keys: [{ mod: ['cmd-or-ctrl', 'alt'], key: 'ArrowRight' }],
    scope: 'global',
  },
  {
    id: 'nav-scene-up',
    group: 'navigation',
    label: 'Move scene up in list',
    keys: [{ mod: 'shift', key: 'ArrowUp' }],
    scope: 'list',
  },
  {
    id: 'nav-scene-down',
    group: 'navigation',
    label: 'Move scene down in list',
    keys: [{ mod: 'shift', key: 'ArrowDown' }],
    scope: 'list',
  },
  {
    id: 'nav-scene-select',
    group: 'navigation',
    label: 'Open scene / confirm selection',
    keys: [{ key: 'Enter' }, { key: ' ' }],
    scope: 'list',
  },
  {
    id: 'nav-scene-history-prev',
    group: 'navigation',
    label: 'Previous version in scene history',
    keys: [{ key: 'ArrowUp' }],
    scope: 'list',
    whenDisabled: 'Only active when Scene History panel is focused',
  },
  {
    id: 'nav-scene-history-next',
    group: 'navigation',
    label: 'Next version in scene history',
    keys: [{ key: 'ArrowDown' }],
    scope: 'list',
    whenDisabled: 'Only active when Scene History panel is focused',
  },
  {
    id: 'nav-scene-history-restore',
    group: 'navigation',
    label: 'Restore selected history version',
    keys: [{ mod: 'shift', key: 'Enter' }],
    scope: 'list',
    whenDisabled: 'Only active when Scene History panel is focused',
  },
  {
    id: 'nav-right-sidebar-next-tab',
    group: 'navigation',
    label: 'Next right-sidebar tab',
    keys: [{ key: 'ArrowRight' }],
    scope: 'list',
    whenDisabled: 'Only active when right sidebar tab bar is focused',
  },
  {
    id: 'nav-right-sidebar-prev-tab',
    group: 'navigation',
    label: 'Previous right-sidebar tab',
    keys: [{ key: 'ArrowLeft' }],
    scope: 'list',
    whenDisabled: 'Only active when right sidebar tab bar is focused',
  },
  {
    id: 'nav-panel-resize-left',
    group: 'navigation',
    label: 'Shrink panel 8 px (panel resize handle focused)',
    keys: [{ key: 'ArrowLeft' }],
    scope: 'list',
    whenDisabled: 'Only active when a panel resize handle is focused',
  },
  {
    id: 'nav-panel-resize-right',
    group: 'navigation',
    label: 'Grow panel 8 px (panel resize handle focused)',
    keys: [{ key: 'ArrowRight' }],
    scope: 'list',
    whenDisabled: 'Only active when a panel resize handle is focused',
  },
  {
    id: 'nav-panel-resize-min',
    group: 'navigation',
    label: 'Snap panel to minimum width',
    keys: [{ key: 'Home' }],
    scope: 'list',
    whenDisabled: 'Only active when a panel resize handle is focused',
  },
  {
    id: 'nav-panel-resize-max',
    group: 'navigation',
    label: 'Snap panel to maximum width',
    keys: [{ key: 'End' }],
    scope: 'list',
    whenDisabled: 'Only active when a panel resize handle is focused',
  },

  // ─── Vault / tree ───
  {
    id: 'vault-open',
    group: 'vault',
    label: 'Open file or toggle directory',
    keys: [{ key: 'Enter' }],
    scope: 'tree',
  },
  {
    id: 'vault-expand',
    group: 'vault',
    label: 'Expand directory',
    keys: [{ key: 'ArrowRight' }],
    scope: 'tree',
  },
  {
    id: 'vault-collapse',
    group: 'vault',
    label: 'Collapse directory',
    keys: [{ key: 'ArrowLeft' }],
    scope: 'tree',
  },
  {
    id: 'vault-context-menu-close',
    group: 'vault',
    label: 'Close context menu',
    keys: [{ key: 'Escape' }],
    scope: 'tree',
  },

  // ─── Editor (ProseMirror / contenteditable native shortcuts) ───
  {
    id: 'editor-bold',
    group: 'editor',
    label: 'Bold',
    keys: [{ mod: 'cmd-or-ctrl', key: 'B' }],
    scope: 'editor',
    whenDisabled: 'Native contenteditable / ProseMirror shortcut — not in app keydown handlers',
  },
  {
    id: 'editor-italic',
    group: 'editor',
    label: 'Italic',
    keys: [{ mod: 'cmd-or-ctrl', key: 'I' }],
    scope: 'editor',
    whenDisabled: 'Native contenteditable / ProseMirror shortcut — not in app keydown handlers',
  },
  {
    id: 'editor-undo',
    group: 'editor',
    label: 'Undo',
    keys: [{ mod: 'cmd-or-ctrl', key: 'Z' }],
    scope: 'editor',
    whenDisabled: 'Native contenteditable / ProseMirror shortcut — not in app keydown handlers',
  },
  {
    id: 'editor-redo',
    group: 'editor',
    label: 'Redo',
    keys: [{ mod: ['cmd-or-ctrl', 'shift'], key: 'Z' }],
    scope: 'editor',
    whenDisabled: 'Native contenteditable / ProseMirror shortcut — not in app keydown handlers',
  },

  // ─── Brainstorm ───
  {
    id: 'brainstorm-send',
    group: 'brainstorm',
    label: 'Send message / submit prompt',
    keys: [{ key: 'Enter' }],
    scope: 'dialog',
    whenDisabled: 'Only active when Brainstorm or Writing Assistant prompt textarea is focused',
  },
  {
    id: 'brainstorm-newline',
    group: 'brainstorm',
    label: 'Insert newline in prompt',
    keys: [{ mod: 'shift', key: 'Enter' }],
    scope: 'dialog',
    whenDisabled: 'Only active when Brainstorm or Writing Assistant prompt textarea is focused',
  },

  // ─── Suggestion review ───
  {
    id: 'review-accept',
    group: 'dialogs',
    label: 'Accept suggestion',
    keys: [{ key: 'Enter' }],
    scope: 'list',
    whenDisabled: 'Only active when Suggestion Review panel is focused',
  },
  {
    id: 'review-reject',
    group: 'dialogs',
    label: 'Reject suggestion',
    keys: [{ key: 'Backspace' }, { key: 'Delete' }],
    scope: 'list',
    whenDisabled: 'Only active when Suggestion Review panel is focused',
  },
  {
    id: 'review-ignore',
    group: 'dialogs',
    label: 'Ignore suggestion',
    keys: [{ key: 'i' }],
    scope: 'list',
    whenDisabled: 'Only active when Suggestion Review panel is focused',
  },

  // ─── Dialogs (universal) ───
  {
    id: 'dialog-close',
    group: 'dialogs',
    label: 'Close dialog / cancel',
    keys: [{ key: 'Escape' }],
    scope: 'dialog',
  },
  {
    id: 'dialog-confirm',
    group: 'dialogs',
    label: 'Confirm / submit',
    keys: [{ key: 'Enter' }],
    scope: 'dialog',
    whenDisabled: 'Depends on dialog type; may submit a form or accept a prompt',
  },
  {
    id: 'dialog-tab-forward',
    group: 'dialogs',
    label: 'Next focusable element (focus trap)',
    keys: [{ key: 'Tab' }],
    scope: 'dialog',
  },
  {
    id: 'dialog-tab-back',
    group: 'dialogs',
    label: 'Previous focusable element (focus trap)',
    keys: [{ mod: 'shift', key: 'Tab' }],
    scope: 'dialog',
  },
  {
    id: 'kanban-commit',
    group: 'dialogs',
    label: 'Commit inline rename (Kanban / path edit)',
    keys: [{ key: 'Enter' }],
    scope: 'dialog',
    whenDisabled: 'Only active when an inline rename field is focused',
  },
  {
    id: 'kanban-cancel',
    group: 'dialogs',
    label: 'Cancel inline rename (Kanban / path edit)',
    keys: [{ key: 'Escape' }],
    scope: 'dialog',
    whenDisabled: 'Only active when an inline rename field is focused',
  },

  // ─── Help ───
  {
    id: 'help-shortcuts',
    group: 'help',
    label: 'Open keyboard shortcuts cheat-sheet',
    keys: [{ key: '?' }],
    scope: 'global',
    whenDisabled: 'Ignored when an editable element (input, textarea, contenteditable) is focused',
  },
];

export default MANIFEST;
