// SKY-2094 (Phase 2 #1): Two-tab app shell state management.
// Extracted as a pure reducer so it can be unit-tested independently of React.
// AppTab, StorySubView, NotesSubView, AppTabShellState are global ambient types from global.d.ts.

export interface TabbedShellState {
  activeTab: AppTab;
  storySubView: StorySubView;
  notesSubView: NotesSubView;
  storySidebarWidth: number;
  notesSidebarWidth: number;
  storySidebarCollapsed: boolean;
  notesSidebarCollapsed: boolean;
}

export type TabbedShellAction =
  | { type: 'SET_TAB'; tab: AppTab }
  | { type: 'SET_STORY_SUBVIEW'; subView: StorySubView }
  | { type: 'SET_NOTES_SUBVIEW'; subView: NotesSubView }
  | { type: 'SET_STORY_SIDEBAR_WIDTH'; width: number }
  | { type: 'SET_NOTES_SIDEBAR_WIDTH'; width: number }
  | { type: 'SET_STORY_SIDEBAR_COLLAPSED'; collapsed: boolean }
  | { type: 'SET_NOTES_SIDEBAR_COLLAPSED'; collapsed: boolean };

export const DEFAULT_TABBED_SHELL_STATE: TabbedShellState = {
  activeTab: 'story',
  storySubView: 'editor',
  notesSubView: 'editor',
  storySidebarWidth: 240,
  notesSidebarWidth: 240,
  storySidebarCollapsed: false,
  notesSidebarCollapsed: false,
};

export function tabbedShellReducer(
  state: TabbedShellState,
  action: TabbedShellAction,
): TabbedShellState {
  switch (action.type) {
    case 'SET_TAB':
      return { ...state, activeTab: action.tab };
    case 'SET_STORY_SUBVIEW':
      return { ...state, storySubView: action.subView };
    case 'SET_NOTES_SUBVIEW':
      return { ...state, notesSubView: action.subView };
    case 'SET_STORY_SIDEBAR_WIDTH':
      return { ...state, storySidebarWidth: action.width };
    case 'SET_NOTES_SIDEBAR_WIDTH':
      return { ...state, notesSidebarWidth: action.width };
    case 'SET_STORY_SIDEBAR_COLLAPSED':
      return { ...state, storySidebarCollapsed: action.collapsed };
    case 'SET_NOTES_SIDEBAR_COLLAPSED':
      return { ...state, notesSidebarCollapsed: action.collapsed };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/** Convert live state into the shape stored in AppSettings. */
export function serializeTabbedShellState(state: TabbedShellState): AppTabShellState {
  return {
    activeTab: state.activeTab,
    storySubView: state.storySubView,
    notesSubView: state.notesSubView,
    storySidebarWidth: state.storySidebarWidth,
    notesSidebarWidth: state.notesSidebarWidth,
    storySidebarCollapsed: state.storySidebarCollapsed,
    notesSidebarCollapsed: state.notesSidebarCollapsed,
  };
}

const VALID_APP_TABS: AppTab[] = ['story', 'notes', 'brainstorm'];
const VALID_STORY_SUBVIEWS: StorySubView[] = ['editor', 'kanban', 'structure', 'timeline'];
const VALID_NOTES_SUBVIEWS: NotesSubView[] = ['editor', 'graph', 'entities'];

/** Hydrate live state from persisted AppSettings, filling gaps with defaults. */
export function deserializeTabbedShellState(
  persisted: AppTabShellState | undefined | null,
): TabbedShellState {
  if (!persisted) return DEFAULT_TABBED_SHELL_STATE;
  const rawStory = persisted.storySubView as string;
  const storySubView: StorySubView = (VALID_STORY_SUBVIEWS as string[]).includes(rawStory)
    ? rawStory as StorySubView
    : DEFAULT_TABBED_SHELL_STATE.storySubView;
  // SKY-2096: migrate old 'notes-browser' placeholder value → 'editor'
  const rawNotes = persisted.notesSubView as string;
  const notesSubView: NotesSubView = (VALID_NOTES_SUBVIEWS as string[]).includes(rawNotes)
    ? rawNotes as NotesSubView
    : DEFAULT_TABBED_SHELL_STATE.notesSubView;
  const rawTab = persisted.activeTab as string;
  const activeTab: AppTab = (VALID_APP_TABS as string[]).includes(rawTab)
    ? rawTab as AppTab
    : DEFAULT_TABBED_SHELL_STATE.activeTab;
  return {
    activeTab,
    storySubView,
    notesSubView,
    storySidebarWidth: typeof persisted.storySidebarWidth === 'number'
      ? persisted.storySidebarWidth
      : DEFAULT_TABBED_SHELL_STATE.storySidebarWidth,
    notesSidebarWidth: typeof persisted.notesSidebarWidth === 'number'
      ? persisted.notesSidebarWidth
      : DEFAULT_TABBED_SHELL_STATE.notesSidebarWidth,
    storySidebarCollapsed: typeof persisted.storySidebarCollapsed === 'boolean'
      ? persisted.storySidebarCollapsed
      : DEFAULT_TABBED_SHELL_STATE.storySidebarCollapsed,
    notesSidebarCollapsed: typeof persisted.notesSidebarCollapsed === 'boolean'
      ? persisted.notesSidebarCollapsed
      : DEFAULT_TABBED_SHELL_STATE.notesSidebarCollapsed,
  };
}
