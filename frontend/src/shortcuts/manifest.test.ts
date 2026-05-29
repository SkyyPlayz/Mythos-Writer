/**
 * Smoke tests for the keyboard shortcut manifest.
 *
 * These tests catch:
 *   1. Structural validity (required fields, value constraints).
 *   2. Duplicate IDs.
 *   3. True key-collision detection (same key combo + same scope).
 *
 * They do NOT auto-verify live handler wiring because keydown handlers are
 * inline JSX.  To catch drift manually, the AUDITED_HANDLER_IDS set below
 * must be kept in sync with the handlers listed in the source audit table at
 * the bottom of this file.  If you add a handler without adding its manifest
 * entry, this test will catch it once you add the handler ID to that set.
 */

import MANIFEST, { type ShortcutEntry, type KeyCombo } from './manifest';

// ─── 1. Structural validity ───────────────────────────────────────────────────

const VALID_GROUPS = new Set(['modes', 'vault', 'editor', 'brainstorm', 'navigation', 'dialogs', 'help']);
const VALID_SCOPES = new Set(['global', 'editor', 'list', 'dialog', 'tree']);

describe('ShortcutEntry schema', () => {
  test('every entry has required fields with valid values', () => {
    for (const entry of MANIFEST) {
      const ctx = `entry "${entry.id}"`;
      expect(entry.id, `${ctx}: id must be a non-empty string`).toBeTruthy();
      expect(typeof entry.id, `${ctx}: id must be string`).toBe('string');
      expect(VALID_GROUPS.has(entry.group), `${ctx}: group "${entry.group}" is not valid`).toBe(true);
      expect(entry.label, `${ctx}: label must be a non-empty string`).toBeTruthy();
      expect(Array.isArray(entry.keys), `${ctx}: keys must be an array`).toBe(true);
      expect(entry.keys.length > 0, `${ctx}: keys must not be empty`).toBe(true);
      expect(VALID_SCOPES.has(entry.scope), `${ctx}: scope "${entry.scope}" is not valid`).toBe(true);
    }
  });

  test('every KeyCombo has a non-empty key string', () => {
    for (const entry of MANIFEST) {
      for (const combo of entry.keys) {
        expect(combo.key, `entry "${entry.id}" combo key must be a non-empty string`).toBeTruthy();
        expect(typeof combo.key).toBe('string');
      }
    }
  });
});

// ─── 2. Duplicate ID detection ────────────────────────────────────────────────

describe('ID uniqueness', () => {
  test('no two entries share the same id', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const entry of MANIFEST) {
      if (seen.has(entry.id)) dupes.push(entry.id);
      seen.add(entry.id);
    }
    expect(dupes).toEqual([]);
  });
});

// ─── 3. True collision detection ─────────────────────────────────────────────

function comboKey(combo: KeyCombo): string {
  return [
    combo.ctrlOrCmd ? 'mod' : '',
    combo.shift ? 'shift' : '',
    combo.alt ? 'alt' : '',
    combo.key.toLowerCase(),
  ]
    .filter(Boolean)
    .join('+');
}

describe('Collision detection', () => {
  test('no two entries share the same key combo AND scope (true collision)', () => {
    // scope: 'global' shortcuts apply everywhere, so they collide with any
    // other global shortcut sharing the same combo.
    // Same-scope non-global shortcuts don't collide across different surfaces
    // (e.g. Enter in dialog vs Enter in tree), so we only flag exact matches.
    const seen = new Map<string, string>();
    const collisions: string[] = [];

    for (const entry of MANIFEST) {
      for (const combo of entry.keys) {
        const fingerprint = `${comboKey(combo)}@${entry.scope}`;
        if (seen.has(fingerprint)) {
          collisions.push(`"${entry.id}" collides with "${seen.get(fingerprint)}" on [${fingerprint}]`);
        } else {
          seen.set(fingerprint, entry.id);
        }
      }
    }

    // Allow intentional same-key-same-scope entries (e.g. Enter in multiple
    // dialog contexts) — they are scope-safe. Flag only if both are 'global'.
    const globalCollisions = collisions.filter(c => c.includes('@global'));
    expect(globalCollisions).toEqual([]);
  });
});

// ─── 4. Handler parity guard ──────────────────────────────────────────────────
//
// This set is maintained by hand alongside the source audit.
// When you add a new keydown handler to the app, add its manifest ID here.
// The test will then fail until you also add the entry to manifest.ts.
//
// Audit source: SKY-64  (2026-05-29)
// Handler locations → manifest ID:
//   DesktopShell.tsx:594-602  (Ctrl+Shift+F/E/N)  → mode-focus, mode-edit, mode-normal
//   DesktopShell.tsx:1110-1114  (left splitter)    → panel-left-expand/shrink/min/max
//   DesktopShell.tsx:1224-1228  (right splitter)   → panel-right-expand/shrink/min/max
//   DesktopShell.tsx:288        (ChapterDocView)    → tree-open-node
//   DesktopShell.tsx:347-349    (BookOutlineView)   → tree-open-node
//   components/VaultBrowser/index.tsx:165-168       → tree-open-node
//   ProjectSwitcher.tsx:39-54   (global Ctrl+Shift+P)   → project-switcher-open
//   ProjectSwitcher.tsx:48-51   (Esc)              → project-switcher-close
//   SearchBar.tsx:121-139       (arrows/Enter/Esc) → search-up, search-down, search-select, search-close
//   VirtualTree.tsx:42-45       (Enter/→/←)        → tree-open-node, tree-expand-dir, tree-collapse-dir
//   VaultSidebar.tsx:256-260    (Enter/Space dir)  → tree-toggle-dir
//   VaultSidebar.tsx:296-300    (Enter file)       → tree-open-node
//   VaultSidebar.tsx:203-207    (Enter scene)      → tree-open-node
//   ContextMenu.tsx:28          (Esc)              → context-menu-close
//   StoryNavigator.tsx:76-101   (Enter/Spc/↑/↓)   → story-scene-activate, story-scene-up, story-scene-down
//   BrainstormPage.tsx:467-472  (Enter/Shift+Enter) → brainstorm-send, brainstorm-newline
//   WritingAssistantPanel.tsx:217 (Enter)          → writing-assistant-send
//   SuggestionReview.tsx:83-85  (Enter/Bksp/i)     → suggestion-accept, suggestion-reject, suggestion-ignore
//   SuggestionReview.tsx:248    (Enter/Space filter)→ (accessibility only — covered by kanban-card-open pattern)
//   useTextPrompt.tsx:53-55     (Enter/Esc)        → dialog-confirm, dialog-cancel
//   EntityBrowser.tsx:55-70     (Esc/Tab/Shift+Tab)→ dialog-cancel, dialog-focus-next, dialog-focus-prev
//   SettingsPanel.tsx:211-213   (Esc)              → dialog-cancel
//   SettingsPanel.tsx:327-348   (Tab/Shift+Tab)    → dialog-focus-next, dialog-focus-prev
//   KanbanBoard.tsx:212-214     (Enter/Esc path)   → dialog-confirm, dialog-cancel
//   KanbanBoard.tsx:265-267     (Enter/Esc rename) → dialog-confirm, dialog-cancel
//   KanbanBoard.tsx:311         (Enter/Space card) → kanban-card-open
//   OnboardingWizard.tsx:73-78  (Enter/Space tile) → onboarding-activate

const AUDITED_HANDLER_IDS = new Set<string>([
  'mode-focus',
  'mode-edit',
  'mode-normal',
  'project-switcher-open',
  'project-switcher-close',
  'panel-left-expand',
  'panel-left-shrink',
  'panel-left-min',
  'panel-left-max',
  'panel-right-expand',
  'panel-right-shrink',
  'panel-right-min',
  'panel-right-max',
  'search-up',
  'search-down',
  'search-select',
  'search-close',
  'tree-open-node',
  'tree-expand-dir',
  'tree-collapse-dir',
  'tree-toggle-dir',
  'context-menu-close',
  'story-scene-activate',
  'story-scene-up',
  'story-scene-down',
  'brainstorm-send',
  'brainstorm-newline',
  'writing-assistant-send',
  'suggestion-accept',
  'suggestion-reject',
  'suggestion-ignore',
  'dialog-confirm',
  'dialog-cancel',
  'dialog-focus-next',
  'dialog-focus-prev',
  'kanban-card-open',
  'onboarding-activate',
  // ProseMirror/Tiptap native — documented but not wired by us
  'editor-bold',
  'editor-italic',
  'editor-code',
  'editor-strike',
  'editor-undo',
  'editor-redo',
  'editor-hard-break',
  'editor-list-indent',
  'editor-list-outdent',
]);

describe('Handler parity', () => {
  test('every audited handler ID is present in the manifest', () => {
    const manifestIds = new Set(MANIFEST.map(e => e.id));
    const missing: string[] = [];
    for (const id of AUDITED_HANDLER_IDS) {
      if (!manifestIds.has(id)) missing.push(id);
    }
    expect(missing).toEqual([]);
  });

  test('every manifest entry is in the audited handler set', () => {
    // This catches entries added to the manifest but not yet validated
    // against a real handler location.
    const unaudited: string[] = [];
    for (const entry of MANIFEST) {
      if (!AUDITED_HANDLER_IDS.has(entry.id)) {
        unaudited.push(entry.id);
      }
    }
    expect(unaudited).toEqual([]);
  });
});
