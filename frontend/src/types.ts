// Shared frontend types — mirrors ipc.ts structures for renderer use

export type BlockType = 'prose' | 'heading' | 'dialogue' | 'action' | 'description' | 'note';

export type EntityType = 'character' | 'location' | 'item' | 'concept' | 'other';

export interface EntityEntry {
  id: string;
  name: string;
  type: EntityType;
  path: string;
  aliases?: string[];
  tags?: string[];
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

export interface ChronologicalTime {
  date: string;
  isEstimated: boolean;
  confidence: number;
  source: string;
}

export interface SceneEntityLinks {
  characterIds: string[];
  locationId?: string;
  arcs: string[];
}

export interface SceneTimelineMetadata {
  wordCount?: number;
  mood?: string;
  pov?: string;
  locationId?: string;
}

export interface ArcEntry {
  id: string;
  title: string;
  color: string;
  colorIsCustom: boolean;
  scenes: string[];
  createdAt: string;
  updatedAt: string;
}

export type TimelinePrimaryGrouping = 'arc' | 'chapter' | 'character' | 'location';
export type TimelineSpacingMode = 'uniform' | 'proportional';
export type TimelineDefaultColorScheme = 'liquid-neon' | 'monochrome' | 'custom';

export interface TimelineViewportPreference {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface TimelineSettings {
  primaryGrouping: TimelinePrimaryGrouping;
  spacingMode: TimelineSpacingMode;
  showUndatedScenes: boolean;
  autoLayoutTracks: boolean;
  defaultColorScheme: TimelineDefaultColorScheme;
  visibleTrackFilters: string[];
  viewportPreference?: TimelineViewportPreference;
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
  chronologicalTime?: ChronologicalTime;
  entityLinks?: SceneEntityLinks;
  timelineMetadata?: SceneTimelineMetadata;
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
  rightTab: 'notes' | 'properties' | 'ai';
  leftTab: 'stories' | 'vault' | 'entities' | 'review';
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
