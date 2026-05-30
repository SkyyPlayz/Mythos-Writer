/// <reference types="vite/client" />

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

interface EntityEntry {
  id: string;
  name: string;
  type: 'character' | 'location' | 'item' | 'concept' | 'other';
  path: string;
  aliases?: string[];
  tags?: string[];
  properties?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface VaultIndexEntry {
  id: string;
  name: string;
  type: 'character' | 'location' | 'item' | 'concept' | 'other';
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
}

interface AgentBudgetSettings {
  autoApply: boolean;
  confidenceThreshold: number;
  maxTokensPerHour: number;
  maxSuggestionsPerHour: number;
  heartbeatIntervalMinutes: number;
  maxTokensPerDay: number;
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
  /** Neon border colour slot. Default 'cyan'. */
  neonBorderColor?: 'cyan' | 'violet' | 'magenta';

  // ── Neon color customization (SKY-127) ───────────────────────────────────
  /** Cyan neon color hex. Default '#00f0ff'. */
  neonColorCyan?: string;
  /** Violet neon color hex. Default '#9b5fff'. */
  neonColorViolet?: string;
  /** Magenta neon color hex. Default '#ff4dff'. */
  neonColorMagenta?: string;
}


interface AppSettings {
  /** @deprecated Use provider.apiKey instead. Kept for backward compatibility. */
  apiKey: string;
  /** Active AI provider configuration. Defaults to Anthropic when absent. */
  provider?: {
    kind: 'anthropic' | 'openai' | 'ollama' | 'lmstudio' | 'custom';
    apiKey?: string;
    baseUrl?: string;
    model: string;
  };
  agents: {
    writingAssistant: { enabled: boolean; model: string; scanIntervalSeconds: number } & AgentBudgetSettings;
    brainstorm: { enabled: boolean; model: string } & AgentBudgetSettings;
    archive: { enabled: boolean; model: string; continuityCheckIntervalSeconds: number } & AgentBudgetSettings;
  };
  /** Dark-only (MYT-517). 'high-contrast' is the WCAG accessibility overlay,
   *  not a separate palette. Legacy 'light'/'system' values normalize to 'dark'. */
  theme: 'dark' | 'high-contrast';
  snapshots?: {
    maxPerScene: number;
    maxAgeDays: number;
  };
  onboardingComplete?: boolean;
  /** Update channel: 'stable' = GitHub releases, 'beta' = GitHub pre-releases */
  updateChannel?: 'stable' | 'beta';
  /** Liquid Neon customization overrides (MYT-613). Absent = all defaults. */
  liquidNeon?: LiquidNeonPrefs;
  /** Voice IO settings (MYT-205). */
  voice?: {
    enabled: boolean;
    cloudFallback: boolean;
    micDeviceId?: string;
    openaiApiKey?: string;
  };
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
  /** SKY-152: per-pane contextual tip dismissal. Keys are tip IDs; true = dismissed. */
  seenTips?: Record<string, boolean>;
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
    pickFolder: () => Promise<{ vaultRoot: string | null; cancelled: boolean }>;
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
    entityUpdate: (payload: { id: string; name?: string; aliases?: string[]; tags?: string[]; prose?: string; properties?: Record<string, unknown> }) => Promise<EntityEntry>;
    entityDelete: (id: string) => Promise<{ id: string; deleted: boolean }>;
    entityList: (type?: string) => Promise<{ entities: EntityEntry[] }>;
    entityBacklinks: (entityId: string) => Promise<{ entityId: string; scenes: EntityBacklinkScene[] }>;

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
    writingScan: (sceneId: string, prose: string, scenePath: string) => Promise<{ tips: string[]; scannedAt: string }>;
    onWritingScanResult: (cb: (data: { sceneId: string; scenePath: string; tips: string[]; scannedAt: string }) => void) => () => void;

    // Archive continuity-check scheduled scan (MYT-234)
    archiveScan: (sceneText: string, scenePath: string) => Promise<{ suggestions: unknown[]; inconsistenciesFound: number; wikiLinksFound: number }>;

    // Beta-Read Mode (MYT-237) — anchored inline comments
    betaReadCreate: (sceneId: string, anchorText: string, commentText: string) => Promise<{ comment: BetaReadComment }>;
    betaReadList: (sceneId: string) => Promise<{ comments: BetaReadComment[] }>;
    betaReadDismiss: (id: string) => Promise<{ id: string; dismissed: boolean }>;

    // Liquid Neon background image (MYT-716)
    pickBgImage: () => Promise<{ filePath: string | null; cancelled: boolean }>;
    loadBgImage: (filePath: string) => Promise<{ dataUrl: string | null }>;

    // Budget cap notifications (MYT-207) — agent paused on hourly/daily token cap
    onBudgetCapHit: (cb: (event: { agent: string; agentLabel: string; reason: 'hourly_token_cap' | 'daily_token_cap' }) => void) => () => void;

    // Search (MYT-251)
    searchVault: (query: string, scope: 'story' | 'notes' | 'both', limit?: number) => Promise<unknown>;

    // EPUB export (MYT-342)
    exportEpub: (storyId: string, metadata?: { title?: string; author?: string; language?: string }, targetPath?: string) => Promise<unknown>;

    // DOCX export (MYT-252)
    exportDocx: (storyId: string) => Promise<unknown>;

    // Vault Graph View (MYT-249)
    vaultGraphData: () => Promise<unknown>;

    // Timeline (MYT-319) — Archive-inferred chronology
    timelineList: (scenePath?: string) => Promise<unknown>;
    timelineUpsert: (entry: unknown) => Promise<unknown>;
    timelineInfer: (storyId: string) => Promise<unknown>;

    // Telemetry (MYT-344) — opt-in, off by default
    telemetryReport: (type: string, meta?: Record<string, string | number | boolean>) => Promise<unknown>;

    // Multi-project switcher (MYT-374)
    projectList: () => Promise<unknown>;
    projectSwitch: (vaultRoot: string) => Promise<unknown>;
    onProjectSwitched: (cb: (data: { vaultRoot: string }) => void) => () => void;

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
    vaultGetPaths: () => Promise<{ storyVaultPath: string; notesVaultPath: string }>;
    // SKY-12.2: opts.seedMode controls scaffold ('default' = full SKY-15; 'blank' = bare roots only)
    vaultSetPaths: (storyVaultPath: string, notesVaultPath: string, opts?: { seedMode?: 'default' | 'blank' }) => Promise<{ storyVaultPath: string; notesVaultPath: string; saved: boolean }>;
    // SKY-12.2: pure filesystem path check for the onboarding wizard path-picker
    validatePath: (path: string) => Promise<{ exists: boolean; isEmpty: boolean; writable: boolean }>;
    // SKY-12.3: copy the bundled sample project into two-vault layout under parentPath
    loadSampleTwoVault: (parentPath: string) => Promise<{ storyVaultPath: string; notesVaultPath: string } | { error: string }>;
    // SKY-12.4: mark onboarding complete (persisted to main-process settings)
    onboardingComplete: () => Promise<{ ok: boolean }>;
    // SKY-12.4: debug reset (MYTHOS_DEV=1 only) — clears vault paths so wizard re-appears
    onboardingReset: () => Promise<{ ok: boolean }>;
    // SKY-9: full Notes-Vault-scoped CRUD. Mirrors the Story Vault
    // bridge — read/write/list/delete/move plus an intra-Story-Vault move for
    // symmetry. All paths resolve under the separately-configured notes vault
    // root via safeVaultIpcJoin on the main side.
    readNotesVault: (path: string) => Promise<{ content: string; path: string }>;
    writeNotesVault: (path: string, content: string) => Promise<{ path: string; bytes: number }>;
    listNotesVault: (root?: string) => Promise<{ items: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }> }>;
    deleteNotesVault: (path: string) => Promise<{ path: string; deleted: boolean }>;
    moveNotesVault: (fromPath: string, toPath: string) => Promise<{ fromPath: string; toPath: string; moved: boolean }>;
    moveVault: (fromPath: string, toPath: string) => Promise<{ fromPath: string; toPath: string; moved: boolean }>;
    mkdirNotesVault: (path: string) => Promise<{ path: string; created: boolean }>;
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
    brainstormWriteNote: (payload: { category: 'character' | 'location' | 'item' | 'note'; name: string; content: string }) => Promise<
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

    // SKY-130: persist last-opened scene + cursor for cross-restart restore
    sessionSaveScene: (payload: { sceneId: string; scenePath: string; scrollTop: number; cursorLine: number }) => Promise<{ saved: boolean }>;
    goalsGetStats: () => Promise<{ todayWords: number; weekWords: number; dailyGoal: number; streakDays: number; heatmap: Array<{ date: string; words: number }>; }>;
    goalsLogWords: (date: string, wordsAdded: number) => Promise<{ ok: boolean }>;
    goalsSetGoal: (dailyGoal: number) => Promise<{ ok: boolean }>;
    goalsResetStreak: () => Promise<{ ok: boolean }>;
  };

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
