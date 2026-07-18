// SKY-2094 (Phase 2 #1): Unit tests for the two-tab app shell state reducer.
import { describe, it, expect } from 'vitest';
import {
  tabbedShellReducer,
  DEFAULT_TABBED_SHELL_STATE,
  serializeTabbedShellState,
  deserializeTabbedShellState,
  type TabbedShellState,
} from './tabbedShellState';

describe('DEFAULT_TABBED_SHELL_STATE', () => {
  it('defaults to story tab', () => {
    expect(DEFAULT_TABBED_SHELL_STATE.activeTab).toBe('story');
  });

  it('defaults story sub-view to editor', () => {
    expect(DEFAULT_TABBED_SHELL_STATE.storySubView).toBe('editor');
  });

  it('defaults notes sub-view to editor', () => {
    expect(DEFAULT_TABBED_SHELL_STATE.notesSubView).toBe('editor');
  });
});

describe('tabbedShellReducer — SET_TAB', () => {
  it('switches to notes tab', () => {
    const next = tabbedShellReducer(DEFAULT_TABBED_SHELL_STATE, { type: 'SET_TAB', tab: 'notes' });
    expect(next.activeTab).toBe('notes');
  });

  it('switches back to story tab', () => {
    const withNotes = tabbedShellReducer(DEFAULT_TABBED_SHELL_STATE, { type: 'SET_TAB', tab: 'notes' });
    const back = tabbedShellReducer(withNotes, { type: 'SET_TAB', tab: 'story' });
    expect(back.activeTab).toBe('story');
  });

  it('is a no-op when tab is already active', () => {
    const next = tabbedShellReducer(DEFAULT_TABBED_SHELL_STATE, { type: 'SET_TAB', tab: 'story' });
    expect(next.activeTab).toBe('story');
  });
});

describe('tabbedShellReducer — sub-view independence', () => {
  it('SET_STORY_SUBVIEW updates story sub-view without touching tab or notes', () => {
    const next = tabbedShellReducer(DEFAULT_TABBED_SHELL_STATE, {
      type: 'SET_STORY_SUBVIEW',
      subView: 'structure',
    });
    expect(next.storySubView).toBe('structure');
    expect(next.activeTab).toBe('story');
    expect(next.notesSubView).toBe('editor');
  });

  it('story sub-view is preserved after round-trip to notes tab', () => {
    let state = tabbedShellReducer(DEFAULT_TABBED_SHELL_STATE, {
      type: 'SET_STORY_SUBVIEW',
      subView: 'kanban',
    });
    state = tabbedShellReducer(state, { type: 'SET_TAB', tab: 'notes' });
    state = tabbedShellReducer(state, { type: 'SET_TAB', tab: 'story' });
    expect(state.storySubView).toBe('kanban');
  });

  it('SET_NOTES_SUBVIEW updates notes sub-view independently', () => {
    const next = tabbedShellReducer(DEFAULT_TABBED_SHELL_STATE, {
      type: 'SET_NOTES_SUBVIEW',
      subView: 'graph',
    });
    expect(next.notesSubView).toBe('graph');
    expect(next.storySubView).toBe('editor');
  });
});

describe('tabbedShellReducer — sidebar state per tab', () => {
  it('SET_STORY_SIDEBAR_WIDTH updates story sidebar width only', () => {
    const next = tabbedShellReducer(DEFAULT_TABBED_SHELL_STATE, {
      type: 'SET_STORY_SIDEBAR_WIDTH',
      width: 320,
    });
    expect(next.storySidebarWidth).toBe(320);
    expect(next.notesSidebarWidth).toBe(240);
  });

  it('SET_NOTES_SIDEBAR_WIDTH updates notes sidebar width only', () => {
    const next = tabbedShellReducer(DEFAULT_TABBED_SHELL_STATE, {
      type: 'SET_NOTES_SIDEBAR_WIDTH',
      width: 280,
    });
    expect(next.notesSidebarWidth).toBe(280);
    expect(next.storySidebarWidth).toBe(240);
  });

  it('sidebar widths are independent per tab', () => {
    let state = tabbedShellReducer(DEFAULT_TABBED_SHELL_STATE, {
      type: 'SET_STORY_SIDEBAR_WIDTH',
      width: 360,
    });
    state = tabbedShellReducer(state, { type: 'SET_NOTES_SIDEBAR_WIDTH', width: 200 });
    expect(state.storySidebarWidth).toBe(360);
    expect(state.notesSidebarWidth).toBe(200);
  });

  it('SET_STORY_SIDEBAR_COLLAPSED toggles story collapse only', () => {
    const next = tabbedShellReducer(DEFAULT_TABBED_SHELL_STATE, {
      type: 'SET_STORY_SIDEBAR_COLLAPSED',
      collapsed: true,
    });
    expect(next.storySidebarCollapsed).toBe(true);
    expect(next.notesSidebarCollapsed).toBe(false);
  });

  it('SET_NOTES_SIDEBAR_COLLAPSED toggles notes collapse only', () => {
    const next = tabbedShellReducer(DEFAULT_TABBED_SHELL_STATE, {
      type: 'SET_NOTES_SIDEBAR_COLLAPSED',
      collapsed: true,
    });
    expect(next.notesSidebarCollapsed).toBe(true);
    expect(next.storySidebarCollapsed).toBe(false);
  });
});

describe('serializeTabbedShellState / deserializeTabbedShellState', () => {
  it('round-trips full state with no loss', () => {
    const original: TabbedShellState = {
      activeTab: 'notes',
      storySubView: 'timeline',
      notesSubView: 'entities',
      storySidebarWidth: 300,
      notesSidebarWidth: 260,
      storySidebarCollapsed: true,
      notesSidebarCollapsed: false,
    };
    const serialized = serializeTabbedShellState(original);
    const hydrated = deserializeTabbedShellState(serialized);
    expect(hydrated).toEqual(original);
  });

  it('deserialize from undefined returns defaults', () => {
    const state = deserializeTabbedShellState(undefined);
    expect(state).toEqual(DEFAULT_TABBED_SHELL_STATE);
  });

  it('deserialize from null returns defaults', () => {
    const state = deserializeTabbedShellState(null);
    expect(state).toEqual(DEFAULT_TABBED_SHELL_STATE);
  });

  it('deserialize fills missing fields with defaults', () => {
    const partial = { activeTab: 'notes' } as AppTabShellState;
    const state = deserializeTabbedShellState(partial);
    expect(state.activeTab).toBe('notes');
    expect(state.storySubView).toBe('editor');
    expect(state.storySidebarWidth).toBe(240);
  });

  it('SKY-2096: migrates legacy notes-browser sub-view to editor', () => {
    // Old persisted state used 'notes-browser' before Phase 2 #3
    const legacy = { activeTab: 'notes', notesSubView: 'notes-browser' } as unknown as AppTabShellState;
    const state = deserializeTabbedShellState(legacy);
    expect(state.notesSubView).toBe('editor');
  });

  it('SKY-2103: migrates legacy story-only sub-views to editor', () => {
    (['brainstorm', 'graph', 'entries'] as const).forEach((sv) => {
      const legacy = { activeTab: 'story', storySubView: sv } as unknown as AppTabShellState;
      const state = deserializeTabbedShellState(legacy);
      expect(state.storySubView).toBe('editor');
    });
  });

  it('SKY-2096: preserves valid notes sub-view on round-trip', () => {
    (['editor', 'graph', 'entities'] as NotesSubView[]).forEach((sv) => {
      const state = deserializeTabbedShellState({ notesSubView: sv } as AppTabShellState);
      expect(state.notesSubView).toBe(sv);
    });
  });

  it('SKY-3213: preserves book sub-view on round-trip', () => {
    const state = deserializeTabbedShellState({ storySubView: 'book' } as AppTabShellState);
    expect(state.storySubView).toBe('book');
  });

  it('SKY-3213: preserves all valid story sub-views on round-trip', () => {
    // M12 adds the `coach` sub-view (§5.2).
    (['editor', 'coach', 'kanban', 'structure', 'timeline', 'book'] as StorySubView[]).forEach((sv) => {
      const state = deserializeTabbedShellState({ storySubView: sv } as AppTabShellState);
      expect(state.storySubView).toBe(sv);
    });
  });
});
