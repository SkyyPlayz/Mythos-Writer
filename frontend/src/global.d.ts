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

/** Liquid Glass advanced theme customization (MYT-613). All values are optional;
 *  absent fields fall back to LIQUID_GLASS_DEFAULTS in theme.ts. */
interface LiquidGlassPrefs {
  /** Master softness↔contrast (0=soft/glassy, 1=contrast/opaque). Default 0.4. */
  softnessContrast: number;
  /** Glass fill lightness (0=lighter/transparent, 1=darker/opaque). Default 0.4. */
  glass: number;
  /** Backdrop blur amount (0=more blur, 1=less blur). Default 0.4. */
  blur: number;
  /** Neon glow intensity (0=strong, 1=soft). Default 0.4. */
  neonIntensity: number;
  /** Primary neon accent colour. Default 'cyan'. */
  neonAccent: 'cyan' | 'violet' | 'magenta';
  /** Header text hex colour. Default '#edecf6'. */
  textHeader: string;
  /** Body text hex colour. Default '#bfd6e8'. */
  textBody: string;
  /** Muted text hex colour (must be ≥ 4.5:1 on panel). Default '#8a9bb0'. */
  textMuted: string;
  /** 'default' = built-in CSS gradient; any other string = file path for bg image. */
  background: 'default' | string;
}

interface AppSettings {
  apiKey: string;
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
  /** Liquid Glass customization overrides (MYT-613). Absent = all defaults. */
  liquidGlass?: LiquidGlassPrefs;
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
    importVault: (sourcePath: string) => Promise<{ imported: number; skipped: number; errors: string[] }>;
    reindexVault: () => Promise<{ scanned: number; updated: number }>;
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

    // Suggestion lifecycle — wired once the Suggestion API contract issue is merged
    suggestionsList?: () => Promise<{ suggestions: Suggestion[] }>;
    suggestionsAccept?: (id: string) => Promise<{ id: string; status: 'accepted' }>;
    suggestionsReject?: (id: string) => Promise<{ id: string; status: 'rejected' }>;
    suggestionsIgnore?: (id: string) => Promise<{ id: string; status: 'ignored' }>;

    // Generation log
    generationLogList: (page?: number, pageSize?: number, agent?: string) => Promise<{ entries: GenerationLogRow[]; total: number; page: number; pageSize: number }>;
    generationLogGet: (id: string) => Promise<{ entry: GenerationLogRow | null }>;

    // App settings
    settingsGet: () => Promise<AppSettings>;
    settingsSet: (settings: AppSettings) => Promise<{ saved: boolean }>;

    // Generation log (prompt history viewer)
    generationLogRecent: (payload: {
      limit?: number;
      offset?: number;
      agent?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
    }) => Promise<{ entries: GenerationLogRow[]; total: number }>;

    // Brainstorm Chat (MYT-150) — streaming with entity extraction
    brainstormChat: (
      message: string,
      history?: Array<{ role: 'user' | 'assistant'; content: string }>,
      vaultPath?: string,
    ) => Promise<{ text: string; entities: BrainstormExtractedEntity[] }>;
    onBrainstormChatChunk: (cb: (chunk: string) => void) => () => void;

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
    onStreamError: (cb: (data: { streamId: string; error: string }) => void) => () => void;

    // STT (MYT-156)
    sttStart?: () => void;
    sttStop?: () => void;
    onSttResult?: (cb: (text: string) => void) => () => void;

    // Vault notes updated push event (MYT-156)
    onVaultNotesUpdated?: (cb: (data: { count: number }) => void) => () => void;

    // Chapter / scene creation — enforces Manuscript/<book>/<chapter>/<scene>.md layout
    chapterCreate: (payload: { storyId: string; title: string; order?: number }) => Promise<import('./types').Chapter>;
    sceneCreate: (payload: { storyId: string; chapterId: string; title: string; order?: number }) => Promise<import('./types').Scene>;

    // Auto-updater (MYT-245) — feature-flagged; safe no-ops in dev
    onUpdateStatus: (cb: (data: { state: 'checking' | 'available' | 'not-available' | 'downloading' | 'ready'; version?: string; releaseNotes?: string | null }) => void) => () => void;
    checkForUpdate: () => Promise<{ queued: boolean; reason?: string }>;
    getUpdateInfo: () => Promise<{ version: string; releaseNotes: string | null } | null>;
    installUpdate: (quit?: boolean) => Promise<{ ok: boolean; reason?: string }>;

    // Writing Assistant scheduled scan (MYT-233) + push subscription (MYT-236)
    writingScan: (sceneId: string, prose: string, scenePath: string) => Promise<{ tips: string[]; scannedAt: string }>;
    onWritingScanResult: (cb: (data: { sceneId: string; scenePath: string; tips: string[]; scannedAt: string }) => void) => () => void;

    // Archive continuity-check scheduled scan (MYT-234)
    archiveScan: (sceneText: string, scenePath: string) => Promise<{ suggestions: unknown[]; inconsistenciesFound: number; wikiLinksFound: number }>;

    // Beta-Read Mode (MYT-237) — anchored inline comments
    betaReadCreate: (sceneId: string, anchorText: string, commentText: string) => Promise<{ comment: BetaReadComment }>;
    betaReadList: (sceneId: string) => Promise<{ comments: BetaReadComment[] }>;
    betaReadDismiss: (id: string) => Promise<{ id: string; dismissed: boolean }>;

    // Liquid Glass background image (MYT-613)
    pickBgImage: () => Promise<{ filePath: string | null; cancelled: boolean }>;
    loadBgImage: (filePath: string) => Promise<{ dataUrl: string | null }>;
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
