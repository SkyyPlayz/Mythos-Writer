// Shared frontend types — mirrors ipc.ts structures for renderer use

export type BlockType = 'prose' | 'heading' | 'dialogue' | 'action' | 'description' | 'note';

/** Human-readable labels for suggestion categories. Used in both Settings and Review panels
 *  to guarantee AC 5 (labels must match). */
export const SUGGESTION_CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  punctuation: 'Punctuation',
  spelling: 'Spelling',
  grammar: 'Grammar',
  'sentence-structure': 'Sentence Structure',
  'style-tone': 'Style / Tone',
  other: 'Other',
};

/** Ordered list of all suggestion categories. */
export const SUGGESTION_CATEGORIES: SuggestionCategory[] = [
  'punctuation',
  'spelling',
  'grammar',
  'sentence-structure',
  'style-tone',
  'other',
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
  rightTab: 'notes' | 'properties' | 'ai' | 'outline' | 'continuity';
  leftTab: 'stories' | 'vault' | 'entities' | 'review' | 'progress';
  writingMode?: WritingMode;
  focusPrefs?: FocusPrefs;
}

// SKY-796: Timeline AI auto-population proposals (mirrors electron-main/ipc.ts)
export type TimelineProposalKind = 'date' | 'characters' | 'mood';
export type TimelineProposalStatus = 'pending' | 'accepted' | 'rejected';

export interface TimelineAIProposal {
  id: string;
  sceneId: string;
  kind: TimelineProposalKind;
  value: string;
  reason: string;
  confidence: number;
  source: 'ai';
  isEstimated: true;
  status: TimelineProposalStatus;
  createdAt: string;
  resolvedAt?: string;
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

// ─── Timeline v0 types (SKY-2438 / SKY-2463) ────────────────────────────────
// Mirrors electron-main/src/vault/manifest/types.ts — kept in sync manually.

export type StoryTimeOfDay =
  | 'midnight' | 'dawn' | 'morning' | 'noon'
  | 'afternoon' | 'dusk' | 'night' | 'unspecified';

export interface ManifestTimelineEntry {
  sceneId: string;
  inferredDay: number;
  inferredTime: StoryTimeOfDay;
  confidence: number;
  rawCue: string;
  userOverride?: {
    day: number;
    time: StoryTimeOfDay;
    setAt: string;
  };
}

export interface TimelineListResponse {
  entries: ManifestTimelineEntry[];
  sceneCount: number;
  maxDay: number;
}

export interface TimelineUpsertPayload {
  sceneId: string;
  day: number;
  time: StoryTimeOfDay;
}

export interface TimelineUpsertResponse {
  ok: boolean;
  entry?: ManifestTimelineEntry;
  error?: string;
}

/** Display-ready representation of one scene on the visual timeline. */
export interface TimelineDisplayItem {
  sceneId: string;
  sceneTitle: string;
  chapterLabel: string;
  isWritten: boolean;
  accentColor: string;
  /** userOverride.day ?? inferredDay; 0 = unspecified */
  day: number;
  time: StoryTimeOfDay;
  confidence: number;
  rawCue: string | null;
  hasUserOverride: boolean;
}
