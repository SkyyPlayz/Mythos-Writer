export interface ShortcutEntry {
  /** One or more key combinations (alternatives shown with "or"). */
  keys: string[];
  /** Human-readable description of what the shortcut does. */
  action: string;
}

export interface ShortcutGroup {
  label: string;
  entries: ShortcutEntry[];
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

/**
 * Single source of truth for all Mythos Writer keyboard shortcuts.
 * When you add a new shortcut handler, add an entry here too so the
 * in-app reference modal stays current automatically.
 */
export function buildShortcutGroups(mod: string): ShortcutGroup[] {
  return [
    {
      label: 'Global',
      entries: [
        { keys: [`${mod}+Shift+N`], action: 'Switch to Normal mode' },
        { keys: [`${mod}+Shift+F`], action: 'Switch to Focus mode' },
        { keys: [`${mod}+Shift+E`], action: 'Switch to Edit mode' },
        { keys: [`${mod}+Shift+P`], action: 'Toggle Project Switcher' },
        { keys: [`${mod}+,`], action: 'Open Settings' },
        { keys: ['?', `${mod}+/`], action: 'Open Keyboard Shortcuts help' },
        { keys: ['Escape'], action: 'Close modal / dismiss overlay' },
        { keys: [`${mod}+Shift+M`], action: 'Toggle voice input (hold for push-to-talk)' },
      ],
    },
    {
      label: 'Editor — Navigation',
      entries: [
        { keys: [`${mod}+Alt+↑`], action: 'Zoom view depth up (Scene → Chapter → Book)' },
        { keys: [`${mod}+Alt+↓`], action: 'Zoom view depth down' },
        { keys: [`${mod}+Alt+←`], action: 'Previous scene or chapter' },
        { keys: [`${mod}+Alt+→`], action: 'Next scene or chapter' },
      ],
    },
    {
      label: 'Editor — Text (Tiptap)',
      entries: [
        { keys: [`${mod}+B`], action: 'Bold' },
        { keys: [`${mod}+I`], action: 'Italic' },
        { keys: [`${mod}+Z`], action: 'Undo' },
        { keys: [`${mod}+Shift+Z`], action: 'Redo' },
      ],
    },
    {
      label: 'Story Navigator',
      entries: [
        { keys: ['Enter', 'Space'], action: 'Open selected scene' },
        { keys: ['↑'], action: 'Move scene up in chapter' },
        { keys: ['↓'], action: 'Move scene down in chapter' },
      ],
    },
    {
      label: 'Suggestion Review',
      entries: [
        { keys: ['Enter'], action: 'Accept suggestion' },
        { keys: ['Delete', 'Backspace'], action: 'Reject suggestion' },
        { keys: ['I'], action: 'Ignore suggestion' },
      ],
    },
    {
      label: 'Brainstorm & Writing Assistant',
      entries: [
        { keys: ['Enter'], action: 'Submit prompt' },
        { keys: ['Shift+Enter'], action: 'Insert newline in prompt' },
      ],
    },
    {
      label: 'Search Bar',
      entries: [
        { keys: ['↓', '↑'], action: 'Navigate results' },
        { keys: ['Enter'], action: 'Select highlighted result' },
        { keys: ['Escape'], action: 'Close results' },
      ],
    },
    {
      label: 'Right Sidebar',
      entries: [
        { keys: ['→'], action: 'Next sidebar tab' },
        { keys: ['←'], action: 'Previous sidebar tab' },
      ],
    },
    {
      label: 'Timeline',
      entries: [
        { keys: ['Tab'], action: 'Next scene (chronological order)' },
        { keys: ['Shift+Tab'], action: 'Previous scene (chronological order)' },
        { keys: ['Enter'], action: 'Open focused scene in editor' },
        { keys: ['Delete', 'Backspace'], action: 'Remove selected scenes from timeline' },
        { keys: [`${mod}+A`], action: 'Select all visible scenes' },
        { keys: [`${mod}+D`], action: 'Duplicate selected scenes' },
        { keys: [`${mod}+Z`], action: 'Undo timeline edit' },
        { keys: [`${mod}+Y`, `${mod}+Shift+Z`], action: 'Redo timeline edit' },
        { keys: ['↑', '↓', '←', '→'], action: 'Pan the timeline grid' },
        { keys: [`${mod}+Click`], action: 'Add/remove from selection' },
      ],
    },
  ];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = buildShortcutGroups(MOD);
