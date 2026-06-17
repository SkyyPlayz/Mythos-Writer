/// <reference types="vite/client" />

interface SceneCrafterCard {
  wikilink: string;
  title: string;
  done: boolean;
  tags: string[];
  raw?: string;
}

interface SceneCrafterLane {
  name: string;
  cards: SceneCrafterCard[];
}

interface SceneCrafterBoard {
  storyId: string;
  lastModified: string;
  lanes: SceneCrafterLane[];
  extraFrontmatter?: Record<string, unknown>;
  kanbanSettings?: string;
}

interface SceneSnapshot {
  id: string;
  sceneId: string;
  content: string;
  contentHash: string;
  wordCount: number;
  createdAt: string;
  label?: string;
}

// SKY-10 — Per-scene versioned drafts
type VersionIntent =
  | 'save'
  | 'auto'
  | 'agent-suggestion-applied'
  | 'pre-rollback'
  | 'migration';

interface SceneVersion {
  sceneId: string;
  ts: string;
  content: string;
  intent: VersionIntent;
  contentHash: string;
}

// SKY-1611 — SQLite-backed versioned draft snapshots
interface DraftSnapshot {
  id: string;
  sceneId: string;
  createdAt: number;
  label: string | null;
}

// SKY-10 — Legacy migration plan
interface MigrationPlanChange {
  kind: 'create-dir' | 'write-file' | 'snapshot-legacy' | 'unlink-file';
  path: string;
  description: string;
}

interface MigrationPlan {
  planId: string;
  storyPath: string;
  detectedLegacyFiles: string[];
  changes: MigrationPlanChange[];
  createdAt: string;
}

interface MigrationApplyResult {
  planId: string;
  storyPath: string;
  appliedChanges: number;
  snapshotsWritten: string[];
}

interface EntityRelation {
  type: string;
  target: string; // entity id
}

interface EntityEntry {
  id: string;
  name: string;
  type: 'character' | 'location' | 'faction' | 'item' | 'event' | 'concept' | 'other';
  path: string;
  aliases?: string[];
  tags?: string[];
  relations?: EntityRelation[];
  properties?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface VaultIndexEntry {
  id: string;
  name: string;
  type: 'character' | 'location' | 'faction' | 'item' | 'event' | 'concept' | 'other';
  aliases?: string[];
  tags?: string[];
  keyFacts: string;
}

interface EntityBacklinkScene {
  sceneId: string;
  sceneTitle: string;
  scenePath: string;
  snippet: string;
}

interface LinkedScene {
  sceneId: string;
  scenePath: string;
  sceneTitle: string;
  chapterId: string;
  chapterTitle: string;
  chapterOrder: number;
  storyId: string;
  linkKind: 'mention' | 'tag';
}

interface EntityRelationshipRow {
  id: string;
  label: string;
  direction: 'outgoing' | 'incoming';
  otherEntityId: string;
  otherEntityName: string;
  otherEntityType: 'character' | 'location' | 'faction' | 'item' | 'event' | 'concept' | 'other';
  createdAt: string;
}

interface VaultCheckInconsistency {
  id: string;
  entityName: string;
  text: string;
  rationale: string;
  timestamp: string;
  source_agent: 'vault-agent';
  status: 'proposed' | 'dismissed';
}

interface Suggestion {
  id: string;
  source_agent: 'writing-assistant' | 'brainstorm' | 'archive';
  target: string;
  confidence: number;
  rationale: string;
  createdAt: string;
  status: 'proposed' | 'accepted' | 'rejected' | 'ignored';
  payload_json?: string | null;
  category?: SuggestionCategory | null;
}

type WritingTipCategory =
  | 'punctuation'
  | 'spelling'
  | 'grammar'
  | 'sentence-structure'
  | 'style-tone'
  | 'other';

type WritingAssistantHeartbeatCategory = 'grammar' | 'pacing' | 'clarity' | 'style' | 'tone';

interface WritingAssistantTip {
  id: string;
  text: string;
  category: WritingAssistantHeartbeatCategory;
  sceneAnchor?: string;
  sceneId?: string;
  scenePath?: string;
  sceneUpdatedAt?: string;
}

type WritingAssistantTipDecision = 'noted' | 'ignored' | 'reported';

type SuggestionCategory =
  | 'punctuation'
  | 'spelling'
  | 'grammar'
  | 'sentence-structure'
  | 'style-tone'
  | 'other';

interface AgentBudgetSettings {
  autoApply: boolean;
  confidenceThreshold: number;
  maxTokensPerHour: number;
  maxSuggestionsPerHour: number;
  heartbeatIntervalMinutes: number;
  maxTokensPerDay: number;
  /** SKY-908 — per-category auto-apply allow-list. Undefined ⇒ all enabled. */
  autoApplyCategories?: Partial<Record<SuggestionCategory, boolean>>;
}

interface AgentVoiceSettings {
  ttsEnabled?: boolean;
  sttEngine?: 'local' | 'cloud';
  micDeviceId?: string;
}

interface VoiceSettings {
  enabled: boolean;
  cloudFallback: boolean;
  micDeviceId?: string;
  openaiApiKey?: string;
  voiceMode?: 'toggle' | 'push-to-talk';
  toggleShortcut?: string;
  pttKey?: string;
  /** When true, Ctrl+Shift+M starts recording on keydown and stops on keyup (hold-to-talk). */
  pushToTalkMode?: boolean;
  /** STT input language code, e.g. 'en-US'. Absent = auto-detect. */
  inputLanguage?: string;
  /** TTS voice identifier (Piper model voice or OpenAI voice name, e.g. 'alloy'). */
  ttsVoiceId?: string;
  /** TTS output volume, 0–1. Default 1.0. */
  ttsVolume?: number;
  /** TTS speech rate, 0.5–2.0. Default 1.0. */
  ttsRate?: number;
  /** When true, microphone starts muted until explicitly unmuted. */
  persistentMute?: boolean;
}

// Web Speech API — not yet in the TypeScript DOM lib bundled with this project.
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((evt: SpeechRecognitionEvent) => void) | null;
  onerror: ((evt: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((evt: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface TelemetrySettings {
  enabled: boolean;
}

type WritingMode = 'normal' | 'focus' | 'edit';

interface FocusModeFlags {
  sidebar: boolean;
  toolbar: boolean;
  wordCount: boolean;
  minimap: boolean;
}

interface EditModeConfig {
  showWritingAssistant: boolean;
  showArchive: boolean;
  showBetaRead: boolean;
}

/** SKY-2097: Writing-surface panel appearance preset. */
type PageBackgroundPreset = 'liquid-neon' | 'minimal' | 'paper' | 'dark-slate';

/** SKY-2097 (Phase 2 #4): Writing-surface panel appearance settings. */
interface PageBackgroundSettings {
  preset: PageBackgroundPreset;
  /** Panel opacity 0–100. Default 65. */
  opacity: number;
  /** Panel blur 0–32 px. Default 12. Active only on glass presets (liquid-neon). */
  blur: number;
  /** Glow intensity 0–100. Default 60. Active only on liquid-neon preset. */
  glowIntensity: number;
  /** When true (default), story and notes tabs share the same appearance values. */
  applyToBothTabs: boolean;
}

/** Liquid Neon theme customization. All values optional; absent = LIQUID_NEON_DEFAULTS. */
interface LiquidNeonPrefs {
  /** 'default' = built-in CSS gradient; file path = background image (MYT-716). */
  background: 'default' | string;
  style: number;
  glass: number;
  blur: number;
  neon: number;
  neonAccent: 'cyan' | 'violet' | 'magenta';
  /** Softness↔Contrast axis (0 = soft/max-blur, 100 = sharp/min-blur). MYT-518 */
  softness?: number;
  textHeader?: string;
  textBody?: string;
  textMuted?: string;
  /** Legacy 0–1 alias for softness (MYT-613). Prefer softness (0–100) in new code. */
  softnessContrast?: number;
  /** Legacy 0–1 alias for neon (MYT-613). Prefer neon (0–100) in new code. */
  neonIntensity?: number;

  // ── Advanced overrides (MYT-716) ─────────────────────────────────────────
  /** True when B1–B3 have been manually decoupled from the main axis slider. */
  advancedDecoupled?: boolean;
  /** Text contrast boost 0–100; hard-clamped so body text stays ≥ 4.5:1. Default 50. */
  textContrast?: number;
  /** Neon frame width 0–100 → 0–2px rest / 1–4px hover. Default 50. */
  neonFrameWidth?: number;
  /** Border alpha strength 0–100 → 0.06–0.24. Default 50. */
  borderStrength?: number;
  /** Background mode: colour swatch or image wallpaper. Default 'color'. */
  bgMode?: 'color' | 'image';
  /** Image fit when bgMode='image'. Default 'cover'. */
  bgFit?: 'cover' | 'contain' | 'tile';
  /** Image anchor (CSS background-position). Default 'center'. */
  bgPosition?: string;
  /** Darkening scrim 0–100 → 0.20–0.85 alpha; auto-floors body text ≥ 4.5:1. Default 40. */
  bgScrim?: number;
  /** Vignette strength 0–100 → 0–0.9 alpha. Default 40. */
  bgVignette?: number;
  /** Base canvas hex colour (used when no image set). Default '#0e1116'. */
  bgBaseColor?: string;
  /** Accent / button hex colour. Default '#00f0ff'. */
  accentColor?: string;
  /** Neon border colour slot A (gradient start). Default 'cyan'. */
  neonBorderColor?: 'cyan' | 'violet' | 'magenta';
  /** Neon border colour slot B (gradient mid). Default 'violet'. (SKY-910) */
  neonBorderColor2?: 'cyan' | 'violet' | 'magenta';
  /** Neon border colour slot C (gradient end). Default 'magenta'. (SKY-910) */
  neonBorderColor3?: 'cyan' | 'violet' | 'magenta';

  // ── Neon color customization (SKY-127) ───────────────────────────────────
  /** Cyan neon color hex. Default '#00f0ff'. */
  neonColorCyan?: string;
  /** Violet neon color hex. Default '#9b5fff'. */
  neonColorViolet?: string;
  /** Magenta neon color hex. Default '#ff4dff'. */
  neonColorMagenta?: string;
}


/** Provider configuration shared by global and per-agent overrides (SKY-683). */
interface ProviderConfig {
  kind: 'anthropic' | 'openai' | 'ollama' | 'lmstudio' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  model: string;
  /** SKY-816: Optional STT/TTS capability hints for voice provider selection. */
  capabilities?: { transcribe?: boolean; speak?: boolean };
}

interface AppSettings {
  /** @deprecated Use provider.apiKey instead. Kept for backward compatibility. */
  apiKey: string;
  /** Active AI provider configuration. Defaults to Anthropic when absent. */
  provider?: ProviderConfig;
  /** Sidebar heartbeat cadence: seconds, on-save, or manual. */
  waScanInterval?: number | 'on-save' | 'manual';
  /** SKY-818: Selected voice-capable provider ID. Absent = use first voice-capable provider. */
  voiceProviderId?: string;
  agents: {
    /** Per-agent `provider` overrides the global provider for that agent (SKY-683). */
    writingAssistant: { enabled: boolean; model: string; scanIntervalSeconds: number; provider?: ProviderConfig; cadenceTrigger?: 'on_save' | 'idle_heartbeat'; idleHeartbeatConstantInterval?: boolean; idleDebounceSeconds?: number; } & AgentBudgetSettings;
    brainstorm: { enabled: boolean; model: string; provider?: ProviderConfig } & AgentBudgetSettings;
    archive: { enabled: boolean; model: string; continuityCheckIntervalSeconds: number; provider?: ProviderConfig } & AgentBudgetSettings;
  };
  /** Dark-only (MYT-517). 'high-contrast' is the WCAG accessibility overlay,
   *  not a separate palette. Legacy 'light'/'system' values normalize to 'dark'. */
  theme: 'dark' | 'high-contrast';
  snapshots?: {
    maxPerScene: number;
    maxAgeDays: number;
  };
  versions?: {
    maxPerScene: number;
    maxAgeDays: number;
  };
  onboardingComplete?: boolean;
  /** SKY-1188: post-onboarding checklist state. */
  gettingStartedProgress?: {
    completedItems?: Array<'write-scene' | 'add-character' | 'brainstorm' | 'notes-vault'>;
    dismissed?: boolean;
    /** Legacy pre-merge shape accepted for migration. */
    completed?: Partial<Record<'writeScene' | 'addCharacter' | 'brainstorm' | 'openNotes', boolean>>;
  };
  /** SKY-1188: onboarding mode captured when onboarding completed. */
  onboardingStartMode?: 'blank' | 'sample' | 'template' | 'skip' | 'default-mythos-vault' | 'open-existing';
  /** SKY-2005: save-location recents shown by onboarding v2. Newest last, max 5. */
  recentVaultParentPaths?: string[];
  /** SKY-2005: last sample genre selected from the onboarding sample preview. */
  lastSampleGenre?: 'cozy-fantasy' | 'sci-fi-noir' | 'mystery';
  /** SKY-1188: first post-onboarding timestamp, written once. */
  firstLaunchAt?: string;
  /** SKY-2098: one-time upgrade notice for existing users moved to the two-tab shell. */
  notesTabUpgradeToastShown?: boolean;
  /** Update channel: 'stable' = GitHub releases, 'beta' = GitHub pre-releases */
  updateChannel?: 'stable' | 'beta';
  /** Liquid Neon customization overrides (MYT-613). Absent = all defaults. */
  liquidNeon?: LiquidNeonPrefs;
  /** SKY-2097 (Phase 2 #4): writing-surface panel appearance. Absent → Liquid Neon at 65/12/60. */
  pageBackground?: PageBackgroundSettings;
  /** Voice IO settings (MYT-205 / SKY-1505). */
  voice?: VoiceSettings;
  /** STT adapter config (MYT-338). Absent or enabled=false → transcription disabled. */
  stt?: {
    enabled: boolean;
    provider: 'local' | 'cloud' | 'auto';
    localBinaryPath?: string;
    cloudEndpoint?: string;
    cloudApiKey?: string;
  };
  /** TTS adapter config (MYT-339). Absent or enabled=false → synthesis disabled. */
  tts?: {
    enabled: boolean;
    provider: 'local' | 'cloud' | 'auto';
    voiceId?: string;
    localBinaryPath?: string;
    localModelPath?: string;
    cloudEndpoint?: string;
    cloudApiKey?: string;
  };
  /** Telemetry opt-in (MYT-344). Off by default. sessionId regenerated on disable. */
  telemetry?: {
    enabled: boolean;
    sessionId: string;
  };
  /** SKY-130: last active scene + cursor position, restored on next launch. */
  lastOpenedScene?: {
    sceneId: string;
    scenePath: string;
    scrollTop: number;
    cursorLine: number;
  };
  /** SKY-192: automatic wikilink linker. Absent = suggest mode. */
  autoLinker?: {
    mode: 'off' | 'suggest' | 'auto';
  };
  /** SKY-152: per-pane contextual tip dismissal. Keys are tip IDs; true = dismissed. */
  seenTips?: Record<string, boolean>;
  /** SKY-204: opt-in daily notes / journal mode. */
  journalMode?: {
    enabled: boolean;
    noteFolder?: string;
    noteFormat?: string;
  };
  /** SKY-627: author name entered during onboarding (optional). */
  authorName?: string;

  // ── Archive Agent v1 continuity settings (SKY-1683 / PRD §8) ──
  archiveContinuityEnabled?: boolean;
  archiveScanOnSave?: boolean;
  archiveScanScope?: 'active_scene' | 'active_chapter' | 'full_manuscript';
  archiveScanInterval?: number | null;
  archiveMinSeverity?: 'low' | 'high' | 'critical';
  archiveCheckCharacterDrift?: boolean;
  archiveCheckLocationMismatch?: boolean;
  archiveCheckFactualContradict?: boolean;
  archiveScanBudget?: number;
  archiveStoryEditConsentGiven?: boolean;

  // ── Right sidebar persistence (SKY-1683 / PRD §8) ──
  rightSidebarVisible?: boolean;
  rightSidebarWidth?: number;
  rightSidebarPanels?: RightSidebarPanel[];

  /** SKY-1694 (Wave 2a): persisted layout customizations for the panel system. */
  activeLayout?: {
    leftSidebar: LeftSidebarLayout;
    /** SKY-1697 (Wave 2c): floating panel windows, restored on restart. */
    floatingPanels?: FloatingPanelEntry[];
    /** SKY-1698 (Wave 2d): custom docked tabs in the main tab bar. */
    dockedTabs?: DockedTab[];
    /** SKY-1699 (Wave 2e): split window state. */
    splitWindow?: {
      /** Pane 1 width as percentage (0–100). Default 50. */
      splitRatio: number;
    };
    /** SKY-1700 (Wave 2f): right sidebar state snapshot. */
    rightSidebar?: {
      visible: boolean;
      width: number;
      panels: RightSidebarPanel[];
    };
    /** SKY-2094 (Phase 2 #1): two-tab app shell state. */
    tabShell?: AppTabShellState;
  };

  // ── SKY-1700 (Wave 2f): Named workspace layout library ──
  /** Named saved layouts. Built-in layouts have isBuiltIn=true and cannot be deleted. */
  workspaceLayouts?: WorkspaceLayout[];
  /** Which named layout is currently active. null = unsaved/custom state. */
  activeLayoutId?: string | null;
  /** Migration flag: true once v1→v2 layout migration has run. */
  layoutMigrationDone?: boolean;
}

/** SKY-2094 (Phase 2 #1): The two top-level app sections. */
type AppTab = 'story' | 'notes';

/** SKY-2094: Sub-view within the Story tab. */
type StorySubView = 'editor' | 'kanban' | 'structure' | 'timeline';

/** SKY-2096 (Phase 2 #3): Sub-view within the Notes tab. */
type NotesSubView = 'editor' | 'graph' | 'entities';

/** SKY-2094: Persisted two-tab app shell state. */
interface AppTabShellState {
  activeTab: AppTab;
  storySubView: StorySubView;
  notesSubView: NotesSubView;
  storySidebarWidth: number;
  notesSidebarWidth: number;
  storySidebarCollapsed: boolean;
  notesSidebarCollapsed: boolean;
}

/** SKY-1697 (Wave 2c): persisted floating panel window state. */
interface FloatingPanelEntry {
  panelId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  lastDockSidebar: 'left' | 'right';
}

/** SKY-1698 (Wave 2d): A custom panel tab docked in the main tab bar. */
interface DockedTab {
  /** Stable UUID for this tab slot. */
  id: string;
  /** Ordered list of panel IDs shown in this tab (max 5). */
  panels: SidebarPanelId[];
}

/** SKY-1700 (Wave 2f): A saved named workspace layout. */
interface WorkspaceLayout {
  /** Stable UUID. */
  id: string;
  /** 1–64 chars. */
  name: string;
  /** Exactly one layout may be default; loads on app start. */
  isDefault: boolean;
  /** Unix timestamp ms. */
  createdAt: number;
  /** When true this is a built-in layout; cannot be deleted. */
  isBuiltIn?: boolean;
  leftSidebar: { visible: boolean; width: number; panels: LeftPanelConfig[] };
  rightSidebar: { visible: boolean; width: number; panels: RightSidebarPanel[] };
  floatingPanels: FloatingPanelEntry[];
  dockedTabs: DockedTab[];
  splitWindow: { enabled: boolean; splitRatio: number };
}

/** SKY-1695 (Wave 2b): Panel IDs for the right sidebar panel zone. */
type RightPanelId = 'writing-assistant' | 'archive-continuity' | 'scene-preview';

interface RightSidebarPanel {
  id: SidebarPanelId;
  collapsed: boolean;
}

/** SKY-1694: Panel IDs available in the left sidebar panel zone. */
type LeftPanelId = 'stories' | 'entities' | 'vault' | 'vault-graph' | 'review' | 'progress';

/** SKY-1695 (Wave 2b): Unified panel ID — any panel in either sidebar. */
type SidebarPanelId = LeftPanelId | RightPanelId;

/** SKY-1695 (Wave 2b): Generic panel config entry usable in either sidebar. */
interface SidebarPanelConfig {
  id: SidebarPanelId;
  collapsed: boolean;
}

/** SKY-1694: Per-panel config entry in the left sidebar panel zone. */
interface LeftPanelConfig {
  id: SidebarPanelId;
  collapsed: boolean;
}

/** SKY-1694: Persisted state for the left sidebar panel zone. */
interface LeftSidebarLayout {
  panels: LeftPanelConfig[];
  /** When true the sidebar collapses to an icon-only nav rail. */
  sidebarCollapsed: boolean;
}

interface GenerationLogRow {
  id: string;
  agent: string;
  model: string;
  endpoint: string;
  request_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number;
  error: string | null;
  created_at: string;
  payload_digest: string | null;
  prompt_text: string | null;
  response_text: string | null;
  entity_count: number | null;
  context_chars: number | null;
  truncated: number | null;
}

interface BetaReadComment {
  id: string;
  scene_id: string;
  anchor_text: string;
  comment_text: string;
  created_at: string;
  dismissed_at: string | null;
}

interface BrainstormExtractedEntity {
  path: string;
  name: string;
  type: 'character' | 'location' | 'item' | 'note';
  suggestionId: string;
}

// SKY-193: Tag Wrangler
interface NotesTagEntry {
  name: string;
  fullName: string;
  count: number;
  paths: string[];
  children: NotesTagEntry[];
}

// SKY-190: Note Templates
interface NoteTemplateField {
  key: string;
  kind: 'literal' | 'prompt' | 'pick';
  label: string;
  entityType?: 'character' | 'location' | 'item';
  defaultValue?: string;
}

interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  kind: 'scene' | 'chapter' | 'character' | 'location' | 'item' | 'note';
  body: string;
  fields: NoteTemplateField[];
}

interface Window {
  /** Primary IPC bridge — use this in new code. */
  api: {
    readVault: (path: string) => Promise<{ content: string; path: string }>;
    writeVault: (path: string, content: string) => Promise<{ path: string; bytes: number }>;
    listVault: (root?: string) => Promise<{ items: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }> }>;
    deleteVault: (path: string) => Promise<{ path: string; deleted: boolean }>;
    readManifest: () => Promise<unknown>;
    writeManifest: (manifest: unknown) => Promise<unknown>;
    openVaultFolder: () => Promise<{ vaultRoot: string | null; cancelled: boolean }>;
    getVaultRoot: () => Promise<{ vaultRoot: string }>;
    importVault: (sourcePath: string, registrationToken: string) => Promise<{ imported: number; skipped: number; errors: string[] }>;
    reindexVault: () => Promise<{ scanned: number; updated: number }>;
    pickFolder: () => Promise<{ vaultRoot: string | null; cancelled: boolean; registrationToken: string | null }>;
    obsidianDryRun: (sourcePath: string, registrationToken: string) => Promise<unknown>;
    obsidianRegister: (sourcePath: string, registrationToken: string) => Promise<unknown>;
    loadSampleProject: () => Promise<unknown>;
    startVaultWatch: () => Promise<{ watching: boolean }>;
    stopVaultWatch: () => Promise<{ watching: boolean }>;
    brainstormer: (topic: string, context?: string) => Promise<unknown>;
    writingAssistant: (manuscript: string, scenePath: string) => Promise<unknown>;
    archive: (manuscript: string, vaultPath: string) => Promise<unknown>;
    agentWritingAssistant: (prompt: string, context?: string) => Promise<{ text: string }>;
    onWritingAssistantChunk: (cb: (chunk: string) => void) => () => void;
    agentBrainstorm: (prompt: string, history?: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<{ text: string }>;
    onBrainstormChunk: (cb: (chunk: string) => void) => () => void;
    agentVaultIndex: () => Promise<{ entities: VaultIndexEntry[] }>;
    agentVaultCheck: (sceneContent: string) => Promise<{ text: string; inconsistencies: VaultCheckInconsistency[] }>;
    onVaultCheckChunk: (cb: (chunk: string) => void) => () => void;
    getAppInfo: () => Promise<{ platform: string; electronVersion: string; appVersion: string }>;
    getSystemInfo: () => Promise<{ platform: string; electronVersion: string; nodeVersion: string }>;
    onVaultFileChanged: (cb: (event: unknown, data: { path: string }) => void) => () => void;

    // Versioning — per-scene snapshots
    snapshotSave: (sceneId: string, content: string, label?: string) => Promise<SceneSnapshot>;
    snapshotSaveSync: (sceneId: string, content: string) => void;
    snapshotList: (sceneId: string) => Promise<{ snapshots: SceneSnapshot[] }>;
    snapshotGet: (sceneId: string, snapshotId: string) => Promise<{ snapshot: SceneSnapshot | null }>;
    snapshotRestore: (sceneId: string, snapshotId: string, scenePath: string) => Promise<{ restored: SceneSnapshot; preRestoreSnapshot: SceneSnapshot }>;
    snapshotDelete: (sceneId: string, snapshotId: string) => Promise<{ deleted: boolean }>;
    snapshotDeleteAll: (sceneId?: string) => Promise<{ deleted: number }>;

    // SKY-1611 — SQLite-backed versioned draft snapshots
    draftsCreate: (sceneId: string, content: string, label?: string) => Promise<{ snapshot: DraftSnapshot }>;
    draftsList: (sceneId: string) => Promise<{ snapshots: DraftSnapshot[] }>;
    draftsPreview: (snapshotId: string) => Promise<{ content: string }>;
    draftsRestore: (snapshotId: string, sceneId: string, currentContent: string) => Promise<{ content: string; preRestoreSnapshotId: string }>;
    draftsLabel: (snapshotId: string, label: string) => Promise<void>;
    draftsDelete: (snapshotId: string) => Promise<void>;

    // SKY-10 — Per-scene versioned drafts
    versionList: (sceneId: string) => Promise<{ versions: SceneVersion[] }>;
    versionGet: (sceneId: string, ts: string) => Promise<{ version: SceneVersion | null }>;
    versionRollback: (sceneId: string, ts: string) => Promise<{ restoredVersion: SceneVersion; preRollbackVersion: SceneVersion }>;

    // SKY-10 — Legacy single-file-per-chapter migration
    migrationDryRun: (storyPath?: string) => Promise<{ plans: MigrationPlan[] }>;
    migrationApply: (planId: string, storyPath: string) => Promise<{ result: MigrationApplyResult }>;

    // Entity CRUD
    entityCreate: (payload: { name: string; type: string; aliases?: string[]; tags?: string[]; prose?: string; properties?: Record<string, unknown> }) => Promise<EntityEntry>;
    entityRead: (id: string) => Promise<EntityEntry | null>;
    entityUpdate: (payload: { id: string; name?: string; aliases?: string[]; tags?: string[]; relations?: EntityRelation[]; prose?: string; properties?: Record<string, unknown> }) => Promise<EntityEntry>;
    entityDelete: (id: string) => Promise<{ id: string; deleted: boolean }>;
    entityList: (type?: string) => Promise<{ entities: EntityEntry[] }>;
    entityBacklinks: (entityId: string) => Promise<{ entityId: string; scenes: EntityBacklinkScene[] }>;
    entityLinkedScenes: (entityId: string) => Promise<{ scenes: LinkedScene[] }>;
    entityRelationshipsList: (entityId: string) => Promise<{ entityId: string; relationships: EntityRelationshipRow[]; allLabels: string[] }>;
    entityRelationshipsCreate: (fromEntityId: string, toEntityId: string, label: string) => Promise<{ relationship: EntityRelationshipRow }>;
    entityRelationshipsDelete: (relationshipId: string) => Promise<{ deleted: boolean }>;

    // Suggestion lifecycle
    suggestionsList: (status?: string, sourceAgent?: string) => Promise<{ suggestions: Suggestion[] }>;
    suggestionsGet: (id: string) => Promise<{ suggestion: Suggestion | null }>;
    suggestionsUpsert: (suggestion: unknown) => Promise<unknown>;
    suggestionsAccept: (id: string, actor?: string) => Promise<{ id: string; status: 'accepted' }>;
    suggestionsReject: (id: string, reason?: string, actor?: string) => Promise<{ id: string; status: 'rejected' }>;
    suggestionsRollback: (id: string, actor?: string) => Promise<unknown>;
    auditList: (suggestionId?: string) => Promise<unknown>;
    provenanceUpsert: (entityId: string, entityKind: string, agentId: string, agentType: string, runId?: string | null) => Promise<{ id: string }>;

    // Generation log
    generationLogList: (page?: number, pageSize?: number, agent?: string) => Promise<{ entries: GenerationLogRow[]; total: number; page: number; pageSize: number }>;
    generationLogGet: (id: string) => Promise<{ entry: GenerationLogRow | null }>;

    // App settings
    settingsGet: () => Promise<AppSettings>;
    /**
     * MYT-788: optional `tokens` carries one-shot registration tokens from
     * voicePickBinary, required when changing stt.localBinaryPath,
     * tts.localBinaryPath, or tts.localModelPath.
     */
    settingsSet: (
      settings: AppSettings,
      tokens?: { sttBinaryToken?: string; ttsBinaryToken?: string; ttsModelToken?: string },
    ) => Promise<{ saved: boolean; error?: string }>;
    /** Test connection to an AI provider (MYT-779). */
    settingsTestConnection: (provider: { kind: string; apiKey?: string; baseUrl?: string; model: string }) => Promise<{ ok: boolean; latencyMs: number; error?: string }>;
    /** List available models from a provider endpoint (SKY-1499/SKY-1501). */
    providerListModels: (payload: { kind: string; baseUrl?: string }) => Promise<{ ok: true; models: string[] } | { ok: false; error: string }>;
    /** Main-process file picker for local voice binary / model selection (MYT-788). */
    voicePickBinary: (
      kind: 'stt-binary' | 'tts-binary' | 'tts-model',
    ) => Promise<{ path: string | null; cancelled: boolean; registrationToken: string | null }>;
    getAgentConfig: () => Promise<unknown>;
    setAgentConfig: (agent: string, config: unknown) => Promise<unknown>;
    agentBudgetUsage: () => Promise<{
      writingAssistant: { tokensLastHour: number; suggestionsLastHour: number };
      brainstorm: { tokensLastHour: number; suggestionsLastHour: number };
      archive: { tokensLastHour: number; suggestionsLastHour: number };
    }>;

    // Generation log (prompt history viewer)
    generationLogRecent: (payload: {
      limit?: number;
      offset?: number;
      agent?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
    }) => Promise<{ entries: GenerationLogRow[]; total: number }>;

    // Generalized token streaming — stream:* channels
    streamStart: (payload: {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      system?: string;
      model?: string;
      maxTokens?: number;
    }) => Promise<{ streamId: string }>;
    streamCancel: (streamId: string) => Promise<{ cancelled: boolean }>;
    streamAck: (streamId: string, count: number) => void;
    onStreamToken: (cb: (data: { streamId: string; token: string }) => void) => () => void;
    onStreamEnd: (cb: (data: { streamId: string }) => void) => () => void;
    onStreamError: (cb: (data: { streamId: string; category: string; error: string }) => void) => () => void;

    // STT (MYT-156)
    sttStart: () => void;
    sttStop: () => void;
    onSttResult: (cb: (text: string) => void) => () => void;

    // Vault notes updated push event (MYT-156)
    onVaultNotesUpdated: (cb: (data: { count: number }) => void) => () => void;

    // Agent budget cap toast (feature-flagged)
    onBudgetCapHit?: (cb: (data: { agentLabel: string; reason: 'daily_token_cap' | 'hourly_token_cap' }) => void) => () => void;

    // Chapter / scene creation — enforces Manuscript/<book>/<chapter>/<scene>.md layout
    chapterCreate: (payload: { storyId: string; title: string; order?: number }) => Promise<import('./types').Chapter>;
    sceneCreate: (payload: { storyId: string; chapterId: string; title: string; order?: number }) => Promise<import('./types').Scene>;
    // SKY-115: inline scene rename (title-only, manifest update)
    sceneRename: (payload: { sceneId: string; title: string }) => Promise<{ scene: import('./types').Scene } | { error: string }>;

    // Auto-updater (MYT-245) — feature-flagged; safe no-ops in dev
    onUpdateStatus: (cb: (data: { state: 'checking' | 'available' | 'not-available' | 'downloading' | 'ready'; version?: string; releaseNotes?: string | null }) => void) => () => void;
    checkForUpdate: () => Promise<{ queued: boolean; reason?: string }>;
    getUpdateInfo: () => Promise<{ version: string; releaseNotes: string | null } | null>;
    installUpdate: (quit?: boolean) => Promise<{ ok: boolean; reason?: string }>;
    /** MYT-337: stable/beta channel update check; returns { available, version, releaseNotes } */
    appCheckForUpdate: () => Promise<unknown>;
    /** MYT-337: schedule install on next quit; does not trigger immediate restart */
    appInstallUpdate: () => Promise<unknown>;

    // Writing Assistant scheduled scan (MYT-233) + push subscription (MYT-236)
    writingScan: (sceneId: string, prose: string, scenePath: string) => Promise<{ tips: Array<string | WritingAssistantTip>; scannedAt: string }>;
    onWritingScanResult: (cb: (data: { sceneId: string; scenePath: string; tips: Array<string | WritingAssistantTip>; scannedAt: string }) => void) => () => void;
    writingAssistantCadenceChange: (payload: { waScanInterval: number | 'on-save' | 'manual' }) => Promise<{ saved: boolean; waScanInterval: number | 'on-save' | 'manual' }>;
    writingAssistantTipDecision: (payload: {
      tipId: string;
      decision: WritingAssistantTipDecision;
      sceneId?: string;
      scenePath?: string;
      sceneUpdatedAt?: string;
    }) => Promise<{ saved: boolean }>;
    writingAssistantScanNow: (payload: { sceneId: string; prose: string; scenePath: string }) => Promise<{ tips: Array<string | WritingAssistantTip>; scannedAt: string }>;
    onWritingAssistantScanStart: (cb: (data: { sceneId?: string; scenePath?: string; startedAt: string }) => void) => () => void;
    onWritingAssistantScanResult: (cb: (data: { sceneId: string; scenePath: string; tips: Array<string | WritingAssistantTip>; scannedAt: string }) => void) => () => void;
    onWritingAssistantScanError: (cb: (data: { sceneId?: string; scenePath?: string; error: string; occurredAt: string }) => void) => () => void;

    // Archive continuity-check scheduled scan (MYT-234)
    archiveScan: (sceneText: string, scenePath: string) => Promise<{ suggestions: unknown[]; inconsistenciesFound: number; wikiLinksFound: number }>;

    // Beta-Read Mode (MYT-237) — anchored inline comments
    betaReadCreate: (sceneId: string, anchorText: string, commentText: string) => Promise<{ comment: BetaReadComment }>;
    betaReadList: (sceneId: string) => Promise<{ comments: BetaReadComment[] }>;
    betaReadDismiss: (id: string) => Promise<{ id: string; dismissed: boolean }>;
    betaReadScan: (sceneId: string, prose: string, scenePath: string) => Promise<{ comments: BetaReadComment[]; scannedAt: string }>;

    // Liquid Neon background image (MYT-716)
    pickBgImage: () => Promise<{ filePath: string | null; cancelled: boolean }>;
    loadBgImage: (filePath: string) => Promise<{ dataUrl: string | null }>;

    // Budget cap notifications (MYT-207) — agent paused on hourly/daily token cap
    onBudgetCapHit: (cb: (event: { agent: string; agentLabel: string; reason: 'hourly_token_cap' | 'daily_token_cap' }) => void) => () => void;

    // Search (MYT-251)
    searchVault: (query: string, scope: 'story' | 'notes' | 'both', limit?: number, filterTags?: string[]) => Promise<{ results: Array<{ docId: string; vault: 'story' | 'notes'; kind: string; title: string; snippet: string; rank: number }> }>;

    // EPUB export (MYT-342)
    exportEpub: (storyId: string, metadata?: { title?: string; author?: string; language?: string }, targetPath?: string) => Promise<{ path: string | null; cancelled: boolean }>;

    // DOCX export (MYT-252)
    exportDocx: (storyId?: string, scope?: unknown) => Promise<{ path: string | null; cancelled: boolean }>;

    // Markdown / plaintext export
    exportMarkdown: (scope?: unknown) => Promise<{ path: string | null; cancelled: boolean }>;
    exportPlaintext: (scope?: unknown) => Promise<{ path: string | null; cancelled: boolean }>;

    // Scene Crafter Kanban board (SKY-1758/SKY-1763)
    sceneCrafterGetBoard: (storyId: string, storySlug: string) => Promise<SceneCrafterBoard | null>;
    sceneCrafterCreateBoard: (storyId: string, storySlug: string) => Promise<SceneCrafterBoard>;
    sceneCrafterAddCard: (payload: {
      storySlug: string;
      laneIndex: number;
      card: { wikilink: string; title: string; done?: boolean; tags?: string[]; raw?: string };
    }) => Promise<{ ok: true }>;
    sceneCrafterMoveCard: (payload: { storySlug: string; fromLane: number; fromIndex: number; toLane: number; toIndex: number }) => Promise<{ ok: true }>;
    sceneCrafterToggleCardDone: (payload: { storySlug: string; laneIndex: number; cardIndex: number }) => Promise<{ ok: true }>;
    sceneCrafterDeleteCard: (payload: { storySlug: string; laneIndex: number; cardIndex: number }) => Promise<{ ok: true }>;
    sceneCrafterAddLane: (storySlug: string, name: string) => Promise<{ ok: true }>;
    sceneCrafterRenameLane: (payload: { storySlug: string; laneIndex: number; name: string }) => Promise<{ ok: true }>;
    sceneCrafterDeleteLane: (payload: { storySlug: string; laneIndex: number; force?: boolean }) => Promise<{ ok: boolean; cardCount: number }>;
    sceneCrafterReorderLanes: (payload: { storySlug: string; fromIndex: number; toIndex: number }) => Promise<{ ok: true }>;
    sceneCrafterClose?: (storySlug: string) => Promise<void>;
    onSceneCrafterExternalEdit?: (cb: (storySlug: string) => void) => () => void;

    // Vault Graph View (MYT-249)
    vaultGraphData: () => Promise<unknown>;

    // Notes Vault graph — in-memory link index with degree + category (SKY-1756 / SKY-1743)
    vaultGraphNodes: () => Promise<{
      nodes: Array<{
        id: string;
        label: string;
        path: string;
        category: 'characters' | 'locations' | 'factions' | 'history' | 'systems' | 'items' | 'misc' | 'default';
        degree: number;
      }>;
    }>;
    vaultGraphEdges: () => Promise<{
      edges: Array<{
        source: string;
        target: string;
        weight: number;
      }>;
    }>;

    // Timeline (MYT-319) — Archive-inferred chronology
    timelineList: (scenePath?: string) => Promise<unknown>;
    timelineUpsert: (entry: unknown) => Promise<unknown>;
    timelineInfer: (storyId: string) => Promise<unknown>;

    // SKY-791/SKY-794: Timeline data model + spreadsheet view
    timelineGetSettings: (storyId?: string) => Promise<{ settings: TimelineSettings }>;
    timelineSaveSettings: (settings: TimelineSettings, storyId?: string) => Promise<{ saved: boolean }>;
    timelineGetScenes: (storyId: string) => Promise<{ scenes: SceneEntry[] }>;
    timelineUpdateScene: (payload: {
      sceneId: string;
      chronologicalTime?: ChronologicalTime;
      entityLinks?: SceneEntityLinks;
      timelineMetadata?: SceneTimelineMetadata;
    }) => Promise<{ scene: SceneEntry }>;
    timelineUpdateArcColor: (arcId: string, color: string, colorIsCustom: boolean) => Promise<{ arc: ArcEntry }>;
    timelineListArcs: () => Promise<{ arcs: ArcEntry[] }>;

    // SKY-796: Timeline AI auto-population proposals
    timelineProposalsGenerate: (storyId: string) => Promise<{ proposals: TimelineAIProposal[] }>;
    timelineProposalsList: (storyId: string) => Promise<{ proposals: TimelineAIProposal[] }>;
    timelineProposalResolve: (proposalId: string, decision: 'accept' | 'reject') => Promise<{
      proposal: TimelineAIProposal;
      scene?: SceneEntry;
      skippedBecauseUserSet?: boolean;
    }>;

    // Telemetry (MYT-344) — opt-in, off by default
    telemetryReport: (type: string, meta?: Record<string, string | number | boolean>) => Promise<unknown>;

    // Multi-project switcher (MYT-374; SKY-320 paired-vault switching)
    projectList: () => Promise<{ projects: Array<{ vaultRoot: string; notesVaultRoot?: string; name: string; openedAt: string }>; activeNotesVaultRoot?: string }>;
    projectSwitch: (vaultRoot: string, notesVaultRoot?: string) => Promise<{ switched: boolean; notesVaultRoot?: string; error?: string }>;
    onProjectSwitched: (cb: (data: { vaultRoot: string; notesVaultRoot?: string }) => void) => () => void;

    // One-click Mythos Vault create (SKY-320). Omitting parentPath puts the
    // new bundle under ~/Mythos/Vaults/<auto-name>/; the renderer can supply
    // a custom parent (e.g. a OneDrive folder) for Obsidian-style placement.
    vaultCreateDefaultMythos: (opts?: {
      parentPath?: string;
      vaultName?: string;
      seedMode?: 'default' | 'blank';
    }) => Promise<{
      mythosVaultRoot: string;
      vaultRoot: string;
      notesVaultRoot: string;
      name: string;
      created: boolean;
      error?: string;
    }>;

    // Archive confirmation dialog (MYT-376)
    archiveConfirm: (suggestionId: string, action: 'match_archive' | 'suggest_story_change' | 'ignore') => Promise<unknown>;
    archiveIgnoreList: () => Promise<unknown>;

    // Writing modes (MYT-347) — Normal / Focus / Edit backend state + IPC
    writingModeGet: () => Promise<{ mode: WritingMode; focusFlags: FocusModeFlags; editConfig: EditModeConfig }>;
    writingModeSet: (payload: { mode?: WritingMode; focusFlags?: Partial<FocusModeFlags>; editConfig?: Partial<EditModeConfig> }) => Promise<{ mode: WritingMode; focusFlags: FocusModeFlags; editConfig: EditModeConfig }>;
    onWritingModeChanged: (cb: (data: { mode: WritingMode; focusFlags: FocusModeFlags; editConfig: EditModeConfig }) => void) => () => void;

    // Two-vault path management (MYT-608 / SKY-9) — Story Vault + Notes Vault
    // MYT-789: setPaths now requires a per-path registrationToken from
    // vault:pick-folder, or the path must already be in recent-projects.
    vaultGetPaths: () => Promise<{ storyVaultPath: string; notesVaultPath: string; homeDir?: string; pathSeparator?: '/' | '\\' }>;
    vaultGetSystemPaths: () => Promise<{
      homeDir: string;
      documentsDir: string;
      desktopDir: string;
      oneDriveDir: string | null;
      iCloudDir: string | null;
    }>;
    // SKY-12.2: opts.seedMode controls scaffold ('default' = full SKY-15; 'blank' = bare roots only)
    // SKY-270 / MYT-789: storyVaultToken / notesVaultToken from vault:pick-folder satisfy the gate.
    vaultSetPaths: (storyVaultPath: string, notesVaultPath: string, opts?: { seedMode?: 'default' | 'blank'; storyVaultToken?: string; notesVaultToken?: string }) => Promise<{ storyVaultPath: string; notesVaultPath: string; saved: boolean }>;
    // SKY-156: Project Templates — list, scaffold from template, save-as
    templateList: () => Promise<{ templates: Array<{ id: string; name: string; description: string; isUserTemplate?: boolean }> }>;
    // SKY-780: parentToken must come from vault:pick-folder; handler derives story/notes paths from it
    templateScaffold: (templateId: string, parentToken: string) => Promise<{ ok: true; storyVaultPath: string; notesVaultPath: string; storyVaultToken: string; notesVaultToken: string } | { error: string }>;
    templateSaveAs: (name: string) => Promise<{ ok: true; id: string } | { error: string }>;
    // SKY-1304: delete user template (AC-6)
    templateDelete: (templateId: string) => Promise<{ ok: true } | { error: string }>;
    // SKY-1403: export / import .mythostemplate files
    templateExport: (id: string) => Promise<{ cancelled: boolean } | { error: string }>;
    templateImport: () => Promise<{ cancelled: boolean; template?: { id: string; name: string } } | { error: string }>;
    // SKY-1405: drag-drop import — passes filePath to bypass the open-file dialog
    templateImportFromPath: (filePath: string) => Promise<{ cancelled: boolean; template?: { id: string; name: string } } | { error: string }>;
    // SKY-12.2: pure filesystem path check for the onboarding wizard path-picker
    validatePath: (path: string) => Promise<{ valid?: boolean; exists: boolean; isEmpty: boolean; writable: boolean; error?: string }>;
    appQuit?: () => Promise<void>;
    // SKY-12.3: copy the bundled sample project into two-vault layout under parentPath
    loadSampleTwoVault: (parentPath: string) => Promise<{ storyVaultPath: string; notesVaultPath: string } | { error: string }>;
    // SKY-627: orchestrates vault creation + first-scene setup during onboarding
    onboardingComplete: (payload?: {
      startMode: 'blank' | 'sample' | 'template' | 'skip' | 'default-mythos-vault' | 'open-existing';
      storyTitle?: string;
      authorName?: string;
      vaultParentPath?: string;
      templateId?: string;
      vaultName?: string;
      sampleGenre?: 'cozy-fantasy' | 'sci-fi-noir' | 'mystery';
    }) => Promise<{ ok: boolean; firstSceneId?: string; firstScenePath?: string; error?: string }>;
    // SKY-12.4: debug reset (MYTHOS_DEV=1 only) — clears vault paths so wizard re-appears
    onboardingReset: () => Promise<{ ok: boolean }>;
    // SKY-9: full Notes-Vault-scoped CRUD. Mirrors the Story Vault
    // bridge — read/write/list/delete/move plus an intra-Story-Vault move for
    // symmetry. All paths resolve under the separately-configured notes vault
    // root via safeVaultIpcJoin on the main side.
    readNotesVault: (path: string) => Promise<{ content: string; path: string } | { error: string }>;
    writeNotesVault: (path: string, content: string) => Promise<{ path: string; bytes: number } | { error: string }>;
    listNotesVault: (root?: string) => Promise<{ items: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }> } | { error: string }>;
    deleteNotesVault: (path: string) => Promise<{ path: string; deleted: boolean } | { error: string }>;
    moveNotesVault: (fromPath: string, toPath: string) => Promise<{ fromPath: string; toPath: string; moved: boolean } | { error: string }>;
    moveVault: (fromPath: string, toPath: string) => Promise<{ fromPath: string; toPath: string; moved: boolean } | { error: string }>;
    mkdirNotesVault: (path: string) => Promise<{ path: string; created: boolean } | { error: string }>;
    chooseVaultFolder: (title?: string, defaultPath?: string) => Promise<{ path: string | null; cancelled: boolean }>;

    // Per-chapter/per-scene file layout (MYT-609)
    vaultCreateChapter: (projectPath: string, chapterName: string) => Promise<unknown>;
    vaultCreateScene: (chapterPath: string, sceneName: string) => Promise<unknown>;
    vaultListChapters: (projectPath: string) => Promise<unknown>;
    vaultListScenes: (chapterPath: string) => Promise<unknown>;

    // Document-level IPC with typed errors, soft-delete, and per-file watching (MYT-610)
    readDocument: (filePath: string) => Promise<unknown>;
    writeDocument: (filePath: string, content: string) => Promise<unknown>;
    deleteDocument: (filePath: string) => Promise<unknown>;
    watchDocument: (filePath: string) => Promise<unknown>;
    unwatchDocument: (filePath: string) => Promise<unknown>;
    onDocumentChanged: (cb: (event: { filePath: string }) => void) => () => void;

    // Versioned drafts (MYT-611)
    listHistory: (filePath: string) => Promise<unknown>;
    restoreSnapshot: (filePath: string, snapshotPath: string) => Promise<unknown>;

    // Stream-start push events
    onWritingAssistantStreamStart: (cb: (requestId: string) => void) => () => void;
    onBrainstormStreamStart: (cb: (requestId: string) => void) => () => void;
    onVaultCheckStreamStart: (cb: (requestId: string) => void) => () => void;

    // Agent error push events
    onBrainstormError: (cb: (data: { requestId: string; category: string; message: string }) => void) => () => void;
    onWritingAssistantError: (cb: (data: { requestId: string; category: string; message: string }) => void) => () => void;
    onVaultCheckError: (cb: (data: { requestId: string; category: string; message: string }) => void) => () => void;

    // Cancel channels
    cancelWritingAssistant: (requestId: string) => void;
    cancelBrainstorm: (requestId: string) => void;
    cancelVaultCheck: (requestId: string) => void;

    // Voice IO (MYT-205)
    voiceStart: (micDeviceId?: string) => Promise<unknown>;
    voiceStop: (sessionId: string) => Promise<unknown>;
    voiceLocalTranscript: (sessionId: string, text: string, isFinal: boolean) => void;
    voiceAudioChunk: (sessionId: string, chunk: ArrayBuffer) => void;
    onVoiceTranscript: (cb: (event: { sessionId: string; text: string; isFinal: boolean }) => void) => () => void;
    onVoiceError: (cb: (event: { sessionId: string; error: string }) => void) => () => void;
    /** MYT-338: single-shot transcription; returns { text, confidence } or { error } */
    voiceTranscribe: (audio: ArrayBuffer, mimeType?: string) => Promise<unknown>;

    // TTS (MYT-339)
    voiceSpeak: (text: string, voiceId?: string) => Promise<unknown>;
    voiceSpeakCancel: (speakId: string) => void;
    onVoiceSpeakChunk: (cb: (event: { speakId: string; chunk: Uint8Array }) => void) => () => void;
    onVoiceSpeakDone: (cb: (event: { speakId: string }) => void) => () => void;
    onVoiceSpeakError: (cb: (event: { speakId: string; error: string }) => void) => () => void;

    // Brainstorm Agent routing (SKY-20) — layoutMode-aware destination resolution
    brainstormGetSettings: () => Promise<{
      layoutMode: 'default' | 'blank' | 'imported';
      notesRouting: Partial<Record<'character' | 'location' | 'item' | 'note', string>>;
    }>;
    brainstormWriteNote: (payload: { category: 'character' | 'location' | 'item' | 'note' | 'faction' | 'scene_card' | 'inbox'; name: string; content: string }) => Promise<
      | { status: 'written'; path: string; suggestionId: string; reason: 'default-layout' | 'remembered' }
      | { status: 'needs_routing'; stagedPath: string; category: 'character' | 'location' | 'item' | 'note'; name: string }
    >;
    brainstormResolveRouting: (payload: { stagedPath: string; category: 'character' | 'location' | 'item' | 'note'; destination: string; remember: boolean }) => Promise<{
      status: 'written';
      path: string;
      notesRouting: Partial<Record<'character' | 'location' | 'item' | 'note', string>>;
    }>;
    brainstormResetCategoryRouting: (category: 'character' | 'location' | 'item' | 'note') => Promise<{
      notesRouting: Partial<Record<'character' | 'location' | 'item' | 'note', string>>;
    }>;
    brainstormListNotesFolders: () => Promise<{
      folders: Array<{ path: string; label: string }>;
      notesVaultRoot: string;
    }>;
    // SKY-196: token-budgeted vault context selection
    brainstormSelectContext?: (payload: { userMessage: string; conversationText: string; tokenBudget?: number }) => Promise<{
      included: Array<{ path: string; name: string; type: 'character' | 'location' | 'item' | 'note'; content: string; estimatedTokens: number; whyIncluded: string }>;
      excluded: Array<{ path: string; name: string; type: 'character' | 'location' | 'item' | 'note'; content: string; estimatedTokens: number; whyIncluded: string }>;
      usedTokens: number;
      budgetTokens: number;
    }>;
    // SKY-324: one-shot entry enrichment — routes a new entity to the brainstorm
    // agent which generates a description and writes it to the Notes Vault.
    brainstormEnrichEntry: (payload: { name: string; type: string }) => Promise<
      | { status: 'ok'; path: string; content: string }
      | { status: 'skipped'; reason: string }
    >;
    // SKY-1485: Wave 3.4 proposal queue
    brainstormProposalConfirm: (payload: {
      proposalId: string;
      kind: string;
      extractionConfidence: number;
      timeToDecideMs: number;
      decision: 'confirm' | 'edit_and_confirm';
    }) => Promise<{ ok: true }>;
    brainstormProposalReject: (payload: {
      proposalId: string;
      title: string;
      kind: string;
      extractionConfidence: number;
      timeToDecideMs: number;
    }) => Promise<{ ok: true }>;
    brainstormExtractProposals: (payload: {
      turnText: string;
      turnId: string;
      existingEntityNames?: string[];
    }) => Promise<{ proposals: unknown[] }>;
    onBrainstormProposalQueued: (cb: (data: { proposals: unknown[] }) => void) => () => void;

    // SKY-130: persist last-opened scene + cursor for cross-restart restore
    sessionSaveScene: (payload: { sceneId: string; scenePath: string; scrollTop: number; cursorLine: number }) => Promise<{ saved: boolean }>;

    // SKY-190: Note Templates
    noteTemplateList: (kind?: string) => Promise<{ templates: NoteTemplate[] }>;
    // SKY-204: Daily Notes
    dailyNoteOpenToday: () => Promise<{ path: string; created: boolean }>;
    dailyNoteGetStreak: () => Promise<{ streakDays: number; todayExists: boolean }>;
    // SKY-193: Tag Wrangler
    notesTagList: () => Promise<{ tags: NotesTagEntry[] }>;
    notesTagRename: (oldTag: string, newTag: string) => Promise<{ affectedFiles: number }>;
    notesTagMerge: (sourceTag: string, targetTag: string) => Promise<{ affectedFiles: number }>;
    // SKY-55: per-scene notes
    notesGet?: (sceneId: string) => Promise<{ content: string }>;
    notesSet?: (sceneId: string, content: string) => Promise<{ saved: boolean }>;
    // SKY-1391: brainstorm → writing-panel bridge
    sceneAppendBrainstormNote?: (sceneId: string, content: string) => Promise<{ appended: boolean }>;

    // SKY-158: Tags
    tagsList?: () => Promise<{ tags: Array<{ id: string; name: string; color?: string | null; createdAt: string }> }>;
    tagsUpsert?: (name: string, color?: string | null) => Promise<{ tag: { id: string; name: string; color?: string | null; createdAt: string } }>;
    tagsDelete?: (id: string) => Promise<{ deleted: boolean }>;
    tagsRename?: (id: string, name: string) => Promise<{ tag: { id: string; name: string; color?: string | null; createdAt: string } }>;
    tagsForItem?: (itemId: string, itemKind: 'scene' | 'entity') => Promise<{ tags: string[] }>;
    tagsSetForItem?: (itemId: string, itemKind: 'scene' | 'entity', tags: string[]) => Promise<{ tags: string[] }>;
    tagsItemsForTag?: (tagName: string) => Promise<{ items: Array<{ itemId: string; itemKind: 'scene' | 'entity' }> }>;
    tagsBulkApply?: (itemIds: string[], itemKind: 'scene' | 'entity', addTags?: string[], removeTags?: string[]) => Promise<{ updated: number }>;
    sceneSetTags?: (payload: { sceneId: string; tags: string[] }) => Promise<{ scene: unknown }>;

    // SKY-154: Writing Goals
    goalsGetStats: () => Promise<{ todayWords: number; weekWords: number; dailyGoal: number; streakDays: number; heatmap: Array<{ date: string; words: number }>; }>;
    goalsLogWords: (date: string, wordsAdded: number) => Promise<{ ok: boolean }>;
    goalsSetGoal: (dailyGoal: number) => Promise<{ ok: boolean }>;
    goalsResetStreak: () => Promise<{ ok: boolean }>;

    // SKY-203: Note-level backlinks
    noteBacklinks: (notePath: string) => Promise<{
      notePath: string;
      backlinks: Array<{ path: string; name: string; snippet: string }>;
    }>;

    // SKY-194: Iconize — per-node icon IPC
    notesVaultReadIcons: () => Promise<Record<string, string>>;
    vaultReadIcons: () => Promise<Record<string, string>>;
    iconListUserPacks: () => Promise<{ packName: string; icons: string[] }[]>;
    iconReadSvg: (packName: string, iconName: string) => Promise<{ svg: string | null }>;

    // SKY-205: Smart Folders — frontmatter-backed persistent queries
    smartFolderList?: () => Promise<{ smartFolders: Array<{ id: string; name: string; query: string; createdAt: string; updatedAt: string }> }>;
    smartFolderCreate?: (name: string, query: string) => Promise<{ smartFolder: { id: string; name: string; query: string; createdAt: string; updatedAt: string } }>;
    smartFolderUpdate?: (id: string, updates: { name?: string; query?: string }) => Promise<{ smartFolder: { id: string; name: string; query: string; createdAt: string; updatedAt: string } }>;
    smartFolderDelete?: (id: string) => Promise<{ success: boolean }>;
    smartFolderQuery?: (query: string) => Promise<{ results: Array<{ path: string; title: string }> }>;

    // SKY-232: Entity-to-entity relationships
    entityLinkedScenes: (entityId: string) => Promise<{ scenes: LinkedScene[] }>;
    entityRelationshipsList: (entityId: string) => Promise<{ entityId: string; relationships: EntityRelationshipRow[]; allLabels: string[] }>;
    entityRelationshipsCreate: (fromEntityId: string, toEntityId: string, label: string) => Promise<{ relationship: EntityRelationshipRow }>;
    entityRelationshipsDelete: (relationshipId: string) => Promise<{ deleted: boolean }>;

    // SKY-861: Move vault root to a cloud-sync folder.
    vaultGuidedFolderMove: (payload: {
      targetPath: string;
      syncProvider: 'icloud' | 'dropbox' | 'google-drive' | 'onedrive';
      sessionToken: string;
    }) => Promise<{ moved: boolean; newVaultPath: string } | { error: string }>;

    // SKY-863: Conflict detection + lockfile.
    checkVaultConflicts: () => Promise<{
      resolved: Array<{
        conflictPath: string;
        originalPath: string;
        provider: 'dropbox' | 'icloud' | 'syncthing';
        keptPath: string;
        archivedPath: string;
        resolvedAt: string;
      }>;
      lockfileConflict: { hostname: string; pid: number; timestamp: string } | null;
      dismissed: boolean;
    }>;
    dismissSyncWarning: () => Promise<{ ok: true }>;

    // SKY-207: Per-scene custom frontmatter fields (typed here to avoid renderer-side any-casts)
    customFieldsList: () => Promise<{ fields: Array<{ id: string; name: string; type: 'text' | 'number' | 'select'; options?: string[] }> }>;
    customFieldsSet: (fields: Array<{ id: string; name: string; type: 'text' | 'number' | 'select'; options?: string[] }>) => Promise<{ fields: Array<{ id: string; name: string; type: 'text' | 'number' | 'select'; options?: string[] }> }>;
    scenePropsGet: (sceneId: string) => Promise<{ customFields: Record<string, unknown> }>;
    scenePropsSet: (sceneId: string, customFields: Record<string, unknown>) => Promise<unknown>;

    // Agent persona files (typed here to avoid renderer-side any-casts)
    agentPersonaRead: (agentName: string, key: string) => Promise<{ content: string; isCustom: boolean }>;
    agentPersonaReset: (agentName: string, key: string) => Promise<unknown>;

    // SKY-1684 / SKY-1685: Archive Agent v1 — continuity scan
    archiveScanContinuity: (sceneId: string, text: string, scope?: string) => Promise<void>;
    archiveResolveContinuity: (itemId: string, action: 'match_archive_to_story' | 'suggest_story_change' | 'ignore', note?: string) => Promise<{ ok: boolean }>;
    archiveListContinuity: (filter?: { status?: string; category?: string }) => Promise<{
      items: Array<{
        id: string;
        category: 'character_attribute_drift' | 'location_attribute_mismatch' | 'factual_contradiction';
        severity: 'critical' | 'high' | 'medium' | 'low';
        manuscriptAnchor: { sceneId: string; offset: number; excerpt: string };
        vaultAnchor: { notePath: string; line: number; excerpt: string };
        rationale: string;
        proposedResolution: { matchArchiveToStory: string; suggestStoryChange: string };
        status: 'open' | 'resolved' | 'ignored';
        resolvedAt: string | null;
        resolvedAction: 'match_archive_to_story' | 'suggest_story_change' | 'ignore' | null;
        createdAt: string;
      }>;
    }>;
    onArchiveContScanStart: (cb: (data: { sceneId: string; scope: string }) => void) => () => void;
    onArchiveContScanResult: (cb: (data: {
      sceneId: string;
      items: Array<{
        id: string;
        category: 'character_attribute_drift' | 'location_attribute_mismatch' | 'factual_contradiction';
        severity: 'critical' | 'high' | 'medium' | 'low';
        manuscriptAnchor: { sceneId: string; offset: number; excerpt: string };
        vaultAnchor: { notePath: string; line: number; excerpt: string };
        rationale: string;
        proposedResolution: { matchArchiveToStory: string; suggestStoryChange: string };
        status: 'open' | 'resolved' | 'ignored';
        resolvedAt: string | null;
        resolvedAction: 'match_archive_to_story' | 'suggest_story_change' | 'ignore' | null;
        createdAt: string;
      }>;
      tokenUsed: number;
      partial: boolean;
    }) => void) => () => void;
    onArchiveContScanError: (cb: (data: { sceneId: string; error: string }) => void) => () => void;

    // SKY-1686: Global right-sidebar panel popout window
    panelPopout?: (panelId: string, sceneId: string | null) => Promise<void>;
    onPanelPopoutClosed?: (callback: (panelId: string) => void) => () => void;

    // SKY-1697: Wave 2c — free-floating panel windows
    panelFloat?: (panelId: string, opts?: { sourceSidebar?: 'left' | 'right'; x?: number; y?: number; width?: number; height?: number }) => Promise<void>;
    panelFloatDockBack?: (panelId: string) => Promise<void>;
    panelFloatSetPin?: (panelId: string, alwaysOnTop: boolean) => Promise<void>;
    onPanelFloatClosed?: (callback: (data: { panelId: string; docked: boolean; bounds: { x: number; y: number; width: number; height: number } }) => void) => () => void;
    onPanelFloatBoundsChanged?: (callback: (data: { panelId: string; x: number; y: number; width: number; height: number }) => void) => () => void;

    // Optional / feature-gated entry points (may not be registered in all builds)
    newStory?: () => Promise<void>;
    openVault?: () => Promise<void>;

  };

  // Non-standard browser speech recognition (Chromium only)
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;

  /** Legacy IPC bridge — kept for backward compat, prefer window.api. */
  mythosIPC: {
    readVaultFile: (path: string) => Promise<unknown>;
    writeVaultFile: (path: string, content: string) => Promise<unknown>;
    listVaultFiles: (root?: string) => Promise<unknown>;
    deleteVaultFile: (path: string) => Promise<unknown>;
    readManifest: () => Promise<unknown>;
    writeManifest: (manifest: unknown) => Promise<unknown>;
    getAppInfo: () => Promise<unknown>;
    getSystemInfo: () => Promise<unknown>;
  };
}
