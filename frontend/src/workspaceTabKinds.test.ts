import { describe, it, expect } from 'vitest';
import {
  createOrFocusTab,
  tabKindForSection,
  PICKABLE_TAB_KINDS,
  TAB_KIND_META,
} from './workspaceTabKinds';

const baseTabs: WorkspaceTab[] = [
  { id: 'tab-story', kind: 'story-editor', title: 'Story', icon: '📖' },
  { id: 'tab-notes', kind: 'notes-editor', title: 'Notes', icon: '📁' },
];

describe('workspaceTabKinds (GH #643)', () => {
  it('maps every nav section to a tab kind', () => {
    expect(tabKindForSection('story')).toBe('story-editor');
    expect(tabKindForSection('notes')).toBe('notes-editor');
    expect(tabKindForSection('brainstorm')).toBe('brainstorm');
  });

  it('exposes metadata for every pickable kind', () => {
    for (const kind of PICKABLE_TAB_KINDS) {
      expect(TAB_KIND_META[kind].title).toBeTruthy();
      expect(TAB_KIND_META[kind].icon).toBeTruthy();
    }
  });

  describe('createOrFocusTab', () => {
    it('focuses the existing tab of the same kind without duplicating', () => {
      const result = createOrFocusTab(baseTabs, 'story-editor');
      expect(result.created).toBe(false);
      expect(result.activeId).toBe('tab-story');
      expect(result.tabs).toBe(baseTabs);
    });

    it('appends a new tab when no tab of that kind exists', () => {
      const result = createOrFocusTab(baseTabs, 'kanban', () => 'new-id');
      expect(result.created).toBe(true);
      expect(result.activeId).toBe('new-id');
      expect(result.tabs).toHaveLength(3);
      expect(result.tabs[2]).toEqual({
        id: 'new-id',
        kind: 'kanban',
        title: 'Scene Crafter',
        icon: TAB_KIND_META.kanban.icon,
      });
      // Original array untouched.
      expect(baseTabs).toHaveLength(2);
    });

    it('creates a brainstorm tab with its metadata', () => {
      const result = createOrFocusTab(baseTabs, 'brainstorm', () => 'b1');
      expect(result.created).toBe(true);
      expect(result.tabs[2].kind).toBe('brainstorm');
      expect(result.tabs[2].title).toBe('Brainstorm');
    });
  });
});
