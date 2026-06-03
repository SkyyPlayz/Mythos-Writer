// Shared frontend types — mirrors ipc.ts structures for renderer use

export type BlockType = 'prose' | 'heading' | 'dialogue' | 'action' | 'description' | 'note';

/** Human-readable labels for suggestion categories. Used in both Settings and Review panels
 *  to guarantee AC 5 (labels must match). */
export const SUGGESTION_CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  punctuation: 'Punctuation',
  spelling: 'Spelling',
  grammar: 'Grammar',
  'sentence-structure': 'Sentence Structure',
  style: 'Style / Word Choice',
};

/** Ordered list of all five suggestion categories. */
export const SUGGESTION_CATEGORIES: SuggestionCategory[] = [
  'punctuation',
  'spelling',
  'grammar',
  'sentence-structure',
  'style',
];

export type EntityType = 'character' | 'location' | 'faction' | 'item' | 'event' | 'concept' | 'other';

export interface EntityRelation {
  type: string;
  target: string; // entity id
}

export interface EntityEntry {
  id: string;
  name: string;
  type: EntityType;
  path: string;
  aliases?: string[];
  tags?: string[];
  relations?: EntityRelation[];
  properties?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type DraftState = 'in-progress' | 'review' | 'final';

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  order: number;
  updatedAt: string;
}

export interface Scene {
  id: string;
  title: string;
  path: string;
  order: number;
  chapterId?: string;
  storyId?: string;
  blocks: Block[];
  draftState?: DraftState;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  title: string;
  path: string;
  order: number;
  scenes: Scene[];
  createdAt: string;
  updatedAt: string;
}

export interface Story {
  id: string;
  title: string;
  synopsis?: string;
  path: string;
  chapters: Chapter[];
  createdAt: string;
  updatedAt: string;
}

export type WritingMode = 'normal' | 'focus' | 'edit';

export interface FocusPrefs {
  showLeftSidebar: boolean;
  showRightSidebar: boolean;
  showBottomBar: boolean;
  // SKY-325: customizable Focus Mode toggles — all default to true (keep UI visible)
  showTitleBar: boolean;
  showStatusBar: boolean;
  showTabBar: boolean;
  showSidebarButtons: boolean;
  showScrollbars: boolean;
  showFileTreeArrows: boolean;
}

export interface LayoutPrefs {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  rightTab: 'notes' | 'properties' | 'ai' | 'outline';
  leftTab: 'stories' | 'vault' | 'entities' | 'review' | 'progress';
  writingMode?: WritingMode;
  focusPrefs?: FocusPrefs;
}

export interface Manifest {
  version: string;
  vaultRoot: string;
  stories: Story[];
  entities: unknown[];
  suggestions: unknown[];
  scenes: Scene[];
  chapters: Chapter[];
  layout?: LayoutPrefs;
  lastOpenedSceneId?: string;
}
