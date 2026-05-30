// Shared frontend types — mirrors ipc.ts structures for renderer use

export type BlockType = 'prose' | 'heading' | 'dialogue' | 'action' | 'description' | 'note';

export type EntityType = 'character' | 'location' | 'item' | 'concept' | 'other';

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
