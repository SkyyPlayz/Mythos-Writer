/// <reference types="vite/client" />

interface SceneSnapshot {
  id: string;
  sceneId: string;
  content: string;
  contentHash: string;
  wordCount: number;
  createdAt: string;
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

interface LiquidGlassPrefs {
  background: 'default' | 'none';
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
    snapshotSave: (sceneId: string, content: string) => Promise<SceneSnapshot>;
    snapshotList: (sceneId: string) => Promise<{ snapshots: SceneSnapshot[] }>;
    snapshotGet: (sceneId: string, snapshotId: string) => Promise<{ snapshot: SceneSnapshot | null }>;
    snapshotRestore: (sceneId: string, snapshotId: string, scenePath: string) => Promise<{ restored: SceneSnapshot; preRestoreSnapshot: SceneSnapshot }>;

    // Entity CRUD
    entityCreate: (payload: { name: string; type: string; aliases?: string[]; tags?: string[]; prose?: string; properties?: Record<string, unknown> }) => Promise<EntityEntry>;
    entityRead: (id: string) => Promise<EntityEntry | null>;
    entityUpdate: (payload: { id: string; name?: string; aliases?: string[]; tags?: string[]; prose?: string; properties?: Record<string, unknown> }) => Promise<EntityEntry>;
    entityDelete: (id: string) => Promise<{ id: string; deleted: boolean }>;
    entityList: (type?: string) => Promise<{ entities: EntityEntry[] }>;
    entityBacklinks: (entityId: string) => Promise<{ entityId: string; scenes: EntityBacklinkScene[] }>;

    // Suggestion lifecycle
    suggestionsList: (status?: string, sourceAgent?: string) => Promise<{ suggestions: Suggestion[] }>;
    suggestionsUpsert: (suggestion: unknown) => Promise<unknown>;
    suggestionsAccept: (id: string, actor?: string) => Promise<{ id: string; status: 'accepted' }>;
    suggestionsReject: (id: string, reason?: string, actor?: string) => Promise<{ id: string; status: 'rejected' }>;
    suggestionsRollback: (id: string, actor?: string) => Promise<unknown>;
    auditList: (suggestionId?: string) => Promise<unknown>;

    // Generation log
    generationLogList: (page?: number, pageSize?: number, agent?: string) => Promise<{ entries: GenerationLogRow[]; total: number; page: number; pageSize: number }>;
    generationLogGet: (id: string) => Promise<{ entry: GenerationLogRow | null }>;

    // App settings
    settingsGet: () => Promise<AppSettings>;
    settingsSet: (settings: AppSettings) => Promise<{ saved: boolean }>;
    getAgentConfig: () => Promise<unknown>;
    setAgentConfig: (agent: string, config: unknown) => Promise<unknown>;

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
    onStreamError: (cb: (data: { streamId: string; category: string; message: string }) => void) => () => void;

    // STT (MYT-156)
    sttStart: () => void;
    sttStop: () => void;
    onSttResult: (cb: (text: string) => void) => () => void;

    // Vault notes updated push event (MYT-156)
    onVaultNotesUpdated: (cb: (data: { count: number }) => void) => () => void;

    // Chapter / scene creation — enforces Manuscript/<book>/<chapter>/<scene>.md layout
    chapterCreate: (payload: { storyId: string; title: string; order?: number }) => Promise<import('./types').Chapter>;
    sceneCreate: (payload: { storyId: string; chapterId: string; title: string; order?: number }) => Promise<import('./types').Scene>;

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

    // Two-vault path management (MYT-608) — Story Vault + Notes Vault
    vaultGetPaths: () => Promise<{ storyVaultPath: string; notesVaultPath: string }>;
    vaultSetPaths: (storyVaultPath: string, notesVaultPath: string) => Promise<{ storyVaultPath: string; notesVaultPath: string; saved: boolean }>;

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
