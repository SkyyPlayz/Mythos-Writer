// Shared frontend types — mirrors ipc.ts structures for renderer use

export type BlockType = 'prose' | 'heading' | 'dialogue' | 'action' | 'description' | 'note';

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

export interface LayoutPrefs {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  rightTab: 'notes' | 'properties' | 'ai';
  leftTab: 'stories' | 'vault';
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
}
