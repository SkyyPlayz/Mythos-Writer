// IPC Bridge — typed channels between main process and renderer
// All IPC calls go through this module for type safety.

import { ipcMain, ipcRenderer } from 'electron';

// ─── Channel names ───
export const IPC_CHANNELS = {
  // Vault / filesystem operations
  VAULT_READ: 'vault:read',
  VAULT_WRITE: 'vault:write',
  VAULT_LIST: 'vault:list',
  VAULT_DELETE: 'vault:delete',
  VAULT_MANIFEST_READ: 'vault:manifest:read',
  VAULT_MANIFEST_WRITE: 'vault:manifest:write',

  // Vault folder management
  VAULT_OPEN_FOLDER: 'vault:open-folder',
  VAULT_GET_ROOT: 'vault:get-root',
  VAULT_IMPORT: 'vault:import',
  VAULT_REINDEX: 'vault:reindex',
  VAULT_WATCH_START: 'vault:watch-start',
  VAULT_WATCH_STOP: 'vault:watch-stop',

  // Suggestions
  SUGGESTIONS_LIST: 'suggestions:list',
  SUGGESTIONS_UPSERT: 'suggestions:upsert',
  SUGGESTIONS_ACCEPT: 'suggestions:accept',
  SUGGESTIONS_APPLY: 'suggestions:apply',
  SUGGESTIONS_REJECT: 'suggestions:reject',
  SUGGESTIONS_ROLLBACK: 'suggestions:rollback',

  // Audit log
  AUDIT_LIST: 'audit:list',

  // Timeline
  TIMELINE_LIST: 'timeline:list',
  TIMELINE_UPSERT: 'timeline:upsert',

  // App lifecycle
  APP_READY: 'app:ready',
  APP_QUIT: 'app:quit',

  // AI agents
  AI_BRAINSTORMER: 'ai:brainstormer',
  AI_WRITING_ASSISTANT: 'ai:writing-assistant',
  AI_ARCHIVE: 'ai:archive',

  // Agent channels (Epic 5)
  AGENT_WRITING_ASSISTANT: 'agent:writing-assistant',
  AGENT_BRAINSTORM: 'agent:brainstorm',
  AGENT_VAULT_INDEX: 'agent:vault-index',
  AGENT_VAULT_CHECK: 'agent:vault-check',
  AGENT_ARCHIVE: 'agent:archive',

  // System
  SYSTEM_INFO: 'system:info',

  // Versioning — per-scene snapshots
  SNAPSHOT_SAVE: 'snapshot:save',
  SNAPSHOT_LIST: 'snapshot:list',
  SNAPSHOT_GET: 'snapshot:get',
  SNAPSHOT_RESTORE: 'snapshot:restore',

  // Versioned drafts — Phase 2 (MYT-198)
  VERSION_LIST: 'version:list',
  VERSION_GET: 'version:get',
  VERSION_ROLLBACK: 'version:rollback',

  // Entity CRUD
  ENTITY_CREATE: 'entity:create',
  ENTITY_READ: 'entity:read',
  ENTITY_UPDATE: 'entity:update',
  ENTITY_DELETE: 'entity:delete',
  ENTITY_LIST: 'entity:list',
  ENTITY_BACKLINKS: 'entity:backlinks',

  // App settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // Generation log
  GENERATION_LOG_RECENT: 'generationLog:recent',
  GENERATION_LOG_LIST: 'generationLog:list',
  GENERATION_LOG_GET: 'generationLog:get',

  // Archive Agent (Phase 3)
  ARCHIVE_SCAN: 'archive:scan',
  ARCHIVE_STATUS: 'archive:status',

  // Vault graph (Phase 5 — MYT-163)
  VAULT_GRAPH_DATA: 'vault:graph-data',

  // Structured chapter / scene creation (Phase 2 — MYT-195)
  CHAPTER_CREATE: 'chapter:create',
  SCENE_CREATE: 'scene:create',

  // Structured chapter / scene save+load (Phase 2 — MYT-196)
  CHAPTER_LIST: 'chapter:list',
  CHAPTER_GET: 'chapter:get',
  CHAPTER_SAVE: 'chapter:save',
  SCENE_LIST: 'scene:list',
  SCENE_GET: 'scene:get',
  SCENE_SAVE: 'scene:save',

  // Auto-updater (MYT-245) — feature-flagged; only active when MYTHOS_AUTO_UPDATE=1
  UPDATE_CHECK: 'update:check',
  UPDATE_INSTALL: 'update:install',
  UPDATE_GET_INFO: 'update:get-info',

  // Auto-updater Phase 4 (MYT-337) — primary check/install channels with stable/beta support
  APP_CHECK_FOR_UPDATE: 'app:checkForUpdate',
  APP_INSTALL_UPDATE: 'app:installUpdate',

  // Voice IO (MYT-205) — local-first STT + IPC channel
  VOICE_START: 'voice:start',
  VOICE_STOP: 'voice:stop',
  VOICE_TRANSCRIPT_STREAM: 'voice:transcript',

  // Full-text search (MYT-251)
  SEARCH_QUERY: 'search:query',

  // Writing Assistant scheduled scan (MYT-233)
  WRITING_SCAN: 'writing:scan',
  // Push channel: backend scheduler → renderer (MYT-236)
  WRITING_SCAN_RESULT: 'writing:scan:result',

  // Budget enforcement (MYT-207) — main pushes this when an agent hits a token/rate cap
  AGENT_BUDGET_CAP: 'agent:budget-cap',

  // Beta-Read Mode (MYT-237) — anchored inline comments
  BETA_READ_CREATE: 'betaRead:create',
  BETA_READ_LIST: 'betaRead:list',
  BETA_READ_DISMISS: 'betaRead:dismiss',

  // EPUB export (MYT-253)
  EXPORT_EPUB: 'export:epub',

  // DOCX export (MYT-252)
  EXPORT_DOCX: 'export:docx',

  // Obsidian vault import wizard (MYT-244)
  VAULT_OBSIDIAN_DRY_RUN: 'vault:obsidian-dry-run',
  VAULT_OBSIDIAN_REGISTER: 'vault:obsidian-register',
  // Opens folder picker but does NOT save vault settings (used by wizard before dry-run)
  VAULT_PICK_FOLDER: 'vault:pick-folder',
  // First-run onboarding: load bundled sample project (MYT-242)
  VAULT_LOAD_SAMPLE: 'vault:load-sample',

  // Timeline chronology inference (MYT-319) — Archive Agent infers scene timestamps
  TIMELINE_INFER: 'timeline:infer',

  // Voice transcription (MYT-338) — single-shot STT; local-first, cloud fallback
  VOICE_TRANSCRIBE: 'voice:transcribe',

  // Text-to-speech (MYT-339) — streams audio chunks to renderer; cancellable mid-stream
  VOICE_SPEAK: 'voice:speak',

  // Per-agent config (MYT-343) — enable/model/threshold/budget per agent
  SETTINGS_GET_AGENT_CONFIG: 'settings:getAgentConfig',
  SETTINGS_SET_AGENT_CONFIG: 'settings:setAgentConfig',

  // Telemetry (MYT-344) — opt-in, off by default
  TELEMETRY_REPORT: 'telemetry:report',

  // Multi-project switcher (MYT-374)
  PROJECT_LIST: 'project:list',
  PROJECT_SWITCH: 'project:switch',

  // Archive confirmation dialog (MYT-376) — three-verb resolution for inconsistencies
  ARCHIVE_CONFIRM: 'archive:confirm',
  ARCHIVE_IGNORE_LIST: 'archive:ignore-list',
} as const;

// ─── Main process handlers ───
// Each handler: receive request → process → send response via IPC

export function setupIpcMain(handlers: IpcHandlers) {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, payload) => {
      try {
        return handler(payload);
      } catch (error) {
        return { error: (error as Error).message };
      }
    });
  }
}

// ─── Renderer-side IPC helper ───
// Call a channel and get the response

export async function ipcCall<TChannel extends keyof IpcHandlers, TPayload, TResponse>(
  channel: TChannel,
  payload: TPayload
): Promise<TResponse | { error: string }> {
  return ipcRenderer.invoke(channel, payload) as Promise<TResponse | { error: string }>;
}

// ─── Type definitions ───

export interface IpcHandlers {
  [IPC_CHANNELS.VAULT_READ]: (payload: VaultReadPayload) => VaultReadResponse;
  [IPC_CHANNELS.VAULT_WRITE]: (payload: VaultWritePayload) => VaultWriteResponse;
  [IPC_CHANNELS.VAULT_LIST]: (payload: VaultListPayload) => VaultListResponse;
  [IPC_CHANNELS.VAULT_DELETE]: (payload: VaultDeletePayload) => VaultDeleteResponse;
  [IPC_CHANNELS.VAULT_MANIFEST_READ]: (payload: never) => Manifest;
  [IPC_CHANNELS.VAULT_MANIFEST_WRITE]: (payload: ManifestWritePayload) => ManifestWriteResponse;
  [IPC_CHANNELS.VAULT_OPEN_FOLDER]: (payload: never) => Promise<VaultOpenFolderResponse>;
  [IPC_CHANNELS.VAULT_GET_ROOT]: (payload: never) => VaultGetRootResponse;
  [IPC_CHANNELS.VAULT_IMPORT]: (payload: VaultImportPayload) => Promise<VaultImportResponse | RegistrationTokenError>;
  [IPC_CHANNELS.VAULT_REINDEX]: (payload: never) => VaultReindexResponse;
  [IPC_CHANNELS.VAULT_WATCH_START]: (payload: never) => Promise<{ watching: boolean }>;
  [IPC_CHANNELS.VAULT_WATCH_STOP]: (payload: never) => Promise<{ watching: boolean }>;
  [IPC_CHANNELS.APP_READY]: (payload: never) => AppReadyResponse;
  [IPC_CHANNELS.APP_QUIT]: (payload: never) => void;
  [IPC_CHANNELS.AI_BRAINSTORMER]: (payload: BrainstormerPayload) => BrainstormerResponse;
  [IPC_CHANNELS.AI_WRITING_ASSISTANT]: (payload: WritingAssistantPayload) => WritingAssistantResponse;
  [IPC_CHANNELS.AI_ARCHIVE]: (payload: ArchivePayload) => ArchiveResponse;
  // AGENT_WRITING_ASSISTANT is registered manually in main.ts (streaming handler — not via setupIpcMain)
  [IPC_CHANNELS.SYSTEM_INFO]: (payload: never) => SystemInfo;
  [IPC_CHANNELS.SNAPSHOT_SAVE]: (payload: SnapshotSavePayload) => SceneSnapshot;
  [IPC_CHANNELS.SNAPSHOT_LIST]: (payload: SnapshotListPayload) => SnapshotListResponse;
  [IPC_CHANNELS.SNAPSHOT_GET]: (payload: SnapshotGetPayload) => SnapshotGetResponse;
  [IPC_CHANNELS.SNAPSHOT_RESTORE]: (payload: SnapshotRestorePayload) => SnapshotRestoreResponse;
  [IPC_CHANNELS.VERSION_LIST]: (payload: VersionListPayload) => VersionListResponse;
  [IPC_CHANNELS.VERSION_GET]: (payload: VersionGetPayload) => VersionGetResponse;
  [IPC_CHANNELS.VERSION_ROLLBACK]: (payload: VersionRollbackPayload) => VersionRollbackResponse;
  [IPC_CHANNELS.ENTITY_CREATE]: (payload: EntityCreatePayload) => EntityEntry;
  [IPC_CHANNELS.ENTITY_READ]: (payload: EntityReadPayload) => EntityEntry | null;
  [IPC_CHANNELS.ENTITY_UPDATE]: (payload: EntityUpdatePayload) => EntityEntry;
  [IPC_CHANNELS.ENTITY_DELETE]: (payload: EntityDeletePayload) => EntityDeleteResponse;
  [IPC_CHANNELS.ENTITY_LIST]: (payload: EntityListPayload) => EntityListResponse;
  [IPC_CHANNELS.ENTITY_BACKLINKS]: (payload: EntityBacklinksPayload) => EntityBacklinksResponse;
  [IPC_CHANNELS.SETTINGS_GET]: (payload: never) => AppSettings;
  [IPC_CHANNELS.SETTINGS_SET]: (payload: SettingsSetPayload) => SettingsSetResponse;
  [IPC_CHANNELS.SUGGESTIONS_LIST]: (payload: SuggestionsListPayload) => SuggestionsListResponse;
  [IPC_CHANNELS.SUGGESTIONS_UPSERT]: (payload: SuggestionsUpsertPayload) => SuggestionsUpsertResponse;
  [IPC_CHANNELS.SUGGESTIONS_ACCEPT]: (payload: SuggestionsAcceptPayload) => SuggestionsAcceptResponse;
  [IPC_CHANNELS.SUGGESTIONS_APPLY]: (payload: SuggestionsApplyPayload) => SuggestionsApplyResponse;
  [IPC_CHANNELS.SUGGESTIONS_REJECT]: (payload: SuggestionsRejectPayload) => SuggestionsRejectResponse;
  [IPC_CHANNELS.SUGGESTIONS_ROLLBACK]: (payload: SuggestionsRollbackPayload) => SuggestionsRollbackResponse;
  [IPC_CHANNELS.AUDIT_LIST]: (payload: AuditListPayload) => AuditListResponse;
  [IPC_CHANNELS.TIMELINE_LIST]: (payload: TimelineListPayload) => TimelineListResponse;
  [IPC_CHANNELS.TIMELINE_UPSERT]: (payload: TimelineUpsertPayload) => TimelineUpsertResponse;
  [IPC_CHANNELS.GENERATION_LOG_RECENT]: (payload: GenerationLogRecentPayload) => GenerationLogRecentResponse;
  [IPC_CHANNELS.GENERATION_LOG_LIST]: (payload: GenerationLogListPayload) => GenerationLogListResponse;
  [IPC_CHANNELS.GENERATION_LOG_GET]: (payload: GenerationLogGetPayload) => GenerationLogGetResponse;
  [IPC_CHANNELS.ARCHIVE_SCAN]: (payload: ArchiveScanPayload) => ArchiveScanResponse;
  [IPC_CHANNELS.ARCHIVE_STATUS]: (payload: never) => ArchiveStatusResponse;
  [IPC_CHANNELS.VAULT_GRAPH_DATA]: (payload: never) => Promise<VaultGraphDataResponse>;
  [IPC_CHANNELS.CHAPTER_CREATE]: (payload: ChapterCreatePayload) => ChapterEntry;
  [IPC_CHANNELS.SCENE_CREATE]: (payload: SceneCreatePayload) => SceneEntry;
  [IPC_CHANNELS.CHAPTER_LIST]: (payload: ChapterListPayload) => ChapterListResponse;
  [IPC_CHANNELS.CHAPTER_GET]: (payload: ChapterGetPayload) => ChapterGetResponse;
  [IPC_CHANNELS.CHAPTER_SAVE]: (payload: ChapterSavePayload) => ChapterSaveResponse;
  [IPC_CHANNELS.SCENE_LIST]: (payload: SceneListPayload) => SceneListResponse;
  [IPC_CHANNELS.SCENE_GET]: (payload: SceneGetPayload) => SceneGetResponse;
  [IPC_CHANNELS.SCENE_SAVE]: (payload: SceneSavePayload) => SceneSaveResponse;
  [IPC_CHANNELS.SEARCH_QUERY]: (payload: SearchQueryPayload) => SearchQueryResponse;
  [IPC_CHANNELS.BETA_READ_CREATE]: (payload: BetaReadCreatePayload) => BetaReadCreateResponse;
  [IPC_CHANNELS.BETA_READ_LIST]: (payload: BetaReadListPayload) => BetaReadListResponse;
  [IPC_CHANNELS.BETA_READ_DISMISS]: (payload: BetaReadDismissPayload) => BetaReadDismissResponse;
  [IPC_CHANNELS.EXPORT_EPUB]: (payload: ExportEpubPayload) => Promise<ExportEpubResponse>;
  [IPC_CHANNELS.EXPORT_DOCX]: (payload: ExportDocxPayload) => Promise<ExportDocxResponse>;
  [IPC_CHANNELS.VAULT_OBSIDIAN_DRY_RUN]: (payload: VaultObsidianDryRunPayload) => Promise<VaultObsidianDryRunReport | RegistrationTokenError>;
  [IPC_CHANNELS.VAULT_OBSIDIAN_REGISTER]: (payload: VaultObsidianRegisterPayload) => Promise<VaultObsidianRegisterResponse | RegistrationTokenError>;
  [IPC_CHANNELS.VAULT_PICK_FOLDER]: (payload: never) => Promise<VaultPickFolderResponse>;
  [IPC_CHANNELS.VAULT_LOAD_SAMPLE]: (payload: never) => Promise<VaultLoadSampleResponse>;
  [IPC_CHANNELS.TIMELINE_INFER]: (payload: TimelineInferPayload) => TimelineInferResponse;
  // APP_CHECK_FOR_UPDATE and APP_INSTALL_UPDATE are registered directly in initAutoUpdater()
  // (async handlers — not routed through setupIpcMain)
  [IPC_CHANNELS.SETTINGS_GET_AGENT_CONFIG]: (payload: never) => AgentConfigMap;
  [IPC_CHANNELS.SETTINGS_SET_AGENT_CONFIG]: (payload: SetAgentConfigPayload) => SetAgentConfigResponse;
  [IPC_CHANNELS.TELEMETRY_REPORT]: (payload: TelemetryReportPayload) => TelemetryReportResponse;
  [IPC_CHANNELS.PROJECT_LIST]: (payload: never) => ProjectListResponse;
  [IPC_CHANNELS.PROJECT_SWITCH]: (payload: ProjectSwitchPayload) => Promise<ProjectSwitchResponse>;
  [IPC_CHANNELS.ARCHIVE_CONFIRM]: (payload: ArchiveConfirmPayload) => ArchiveConfirmResponse;
  [IPC_CHANNELS.ARCHIVE_IGNORE_LIST]: (payload: never) => ArchiveIgnoreListResponse;
}

// ─── Payload / Response types ───

export interface VaultReadPayload {
  path: string;
}

export interface VaultReadResponse {
  content: string;
  path: string;
}

export interface VaultWritePayload {
  path: string;
  content: string;
}

export interface VaultWriteResponse {
  path: string;
  bytes: number;
}

export interface VaultListPayload {
  root?: string;
}

export interface VaultListItem {
  path: string;
  name: string;
  isDirectory: boolean;
  modifiedAt: string;
}

export interface VaultListResponse {
  items: VaultListItem[];
}

export interface VaultDeletePayload {
  path: string;
}

export interface VaultDeleteResponse {
  path: string;
  deleted: boolean;
}

// ─── Full manifest schema ───

export interface Manifest {
  schemaVersion: number;
  version: string;
  vaultRoot: string;
  stories: StoryEntry[];
  entities: EntityEntry[];
  suggestions: SuggestionEntry[];
  // Legacy flat lists kept for backward compat — prefer stories[].chapters[].scenes[]
  scenes: SceneEntry[];
  chapters: ChapterEntry[];
  /** suggestion id → vault path (provenance index) */
  provenance: Record<string, string>;
  /** Scene Crafter board file paths */
  boardReferences: string[];
}

export interface StoryEntry {
  id: string;
  title: string;
  synopsis?: string;
  path: string;
  chapters: ChapterEntry[];
  createdAt: string;
  updatedAt: string;
  provenance?: AgentProvenance;
}

export interface ChapterEntry {
  id: string;
  title: string;
  path: string;
  order: number;
  scenes: SceneEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface SceneEntry {
  id: string;
  title: string;
  path: string;
  order: number;
  chapterId?: string;
  storyId?: string;
  currentDraftId?: string;
  blocks: BlockEntry[];
  draftState?: 'in-progress' | 'review' | 'final';
  card?: SceneCard;
  timestamp?: SceneTimestamp;
  createdAt: string;
  updatedAt: string;
  provenance?: AgentProvenance;
}

export interface BlockEntry {
  id: string;
  type: 'prose' | 'heading' | 'dialogue' | 'action' | 'description' | 'note';
  order: number;
  content: string;
  updatedAt: string;
}

export interface SceneCard {
  goal?: string;
  conflict?: string;
  outcome?: string;
  pov?: string;
  tags?: string[];
}

export interface SceneTimestamp {
  storyTime?: string;
  realTime?: string;
  duration?: string;
}

export interface EntityEntry {
  id: string;
  name: string;
  type: 'character' | 'location' | 'item' | 'concept' | 'other';
  path: string;
  aliases?: string[];
  tags?: string[];
  properties?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  provenance?: AgentProvenance;
}

export interface SuggestionEntry {
  id: string;
  source: string;
  status: 'proposed' | 'accepted' | 'dismissed';
  confidence: number;
  rationale: string;
  timestamp: string;
  targetPath?: string;
  targetId?: string;
  payload?: unknown;
  provenance?: AgentProvenance;
}

export interface AgentProvenance {
  agentId: string;
  agentType: string;
  runId?: string;
  timestamp: string;
}

export interface ManifestWritePayload {
  manifest: Manifest;
}

export interface ManifestWriteResponse {
  path: string;
  bytes: number;
}

export interface AppReadyResponse {
  platform: string;
  electronVersion: string;
  appVersion: string;
}

export interface BrainstormerPayload {
  topic: string;
  context?: string;
}

export interface BrainstormerResponse {
  suggestions: string[];
  confidence: number;
  provenance: string;
}

export interface WritingAssistantPayload {
  manuscript: string;
  scenePath: string;
}

export interface WritingAssistantResponse {
  tips: string[];
  suggestions: string[];
}

export interface ArchivePayload {
  manuscript: string;
  vaultPath: string;
}

export interface ArchiveResponse {
  links: string[];
  timelinePlacements: string[];
  inconsistencies: string[];
}

export interface SystemInfo {
  platform: string;
  electronVersion: string;
  nodeVersion: string;
}

export interface VaultOpenFolderResponse {
  vaultRoot: string | null;
  cancelled: boolean;
}

/**
 * Response from VAULT_PICK_FOLDER. `registrationToken` is the one-shot,
 * 60s-TTL token issued together with the user-chosen path; subsequent
 * register/import calls must echo it back so the main process can prove
 * the path came from a real dialog and not a renderer-fabricated string.
 */
export interface VaultPickFolderResponse {
  vaultRoot: string | null;
  cancelled: boolean;
  registrationToken: string | null;
}

export interface VaultGetRootResponse {
  vaultRoot: string;
}

export interface VaultImportPayload {
  sourcePath: string;
  registrationToken: string;
}

/**
 * Returned from any handler that requires a valid registrationToken (MYT-360 /
 * MYT-367) when the token is missing, wrong, or expired. The presence of `error`
 * lets callers distinguish "rejected at the gate" from a successful response.
 */
export interface RegistrationTokenError {
  error: string;
}

export interface VaultImportResponse {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface VaultReindexResponse {
  scanned: number;
  updated: number;
}

// ─── Snapshot types ───

export interface SceneSnapshot {
  id: string;
  sceneId: string;
  content: string;
  contentHash: string;
  wordCount: number;
  createdAt: string;
}

export interface SnapshotSavePayload {
  sceneId: string;
  content: string;
}

export interface SnapshotListPayload {
  sceneId: string;
}

export interface SnapshotListResponse {
  snapshots: SceneSnapshot[];
}

export interface SnapshotGetPayload {
  sceneId: string;
  snapshotId: string;
}

export interface SnapshotGetResponse {
  snapshot: SceneSnapshot | null;
}

export interface SnapshotRestorePayload {
  sceneId: string;
  snapshotId: string;
  scenePath: string;
}

export interface SnapshotRestoreResponse {
  restored: SceneSnapshot;
  preRestoreSnapshot: SceneSnapshot;
}

// ─── Versioned drafts types (Phase 2 — MYT-198) ───

export interface SceneVersion {
  sceneId: string;
  /** Sanitized ISO timestamp — the filename stem under .versions/<sceneId>/. */
  ts: string;
  content: string;
}

export interface VersionListPayload {
  sceneId: string;
}

export interface VersionListResponse {
  versions: SceneVersion[];
}

export interface VersionGetPayload {
  sceneId: string;
  ts: string;
}

export interface VersionGetResponse {
  version: SceneVersion | null;
}

export interface VersionRollbackPayload {
  sceneId: string;
  ts: string;
}

export interface VersionRollbackResponse {
  restoredVersion: SceneVersion;
  preRollbackVersion: SceneVersion;
}

// ─── Entity IPC payload / response types ───

export interface EntityCreatePayload {
  name: string;
  type: EntityEntry['type'];
  aliases?: string[];
  tags?: string[];
  prose?: string;
  properties?: Record<string, unknown>;
}

export interface EntityReadPayload {
  id: string;
}

export interface EntityUpdatePayload {
  id: string;
  name?: string;
  aliases?: string[];
  tags?: string[];
  prose?: string;
  properties?: Record<string, unknown>;
}

export interface EntityDeletePayload {
  id: string;
}

export interface EntityDeleteResponse {
  id: string;
  deleted: boolean;
}

export interface EntityListPayload {
  type?: EntityEntry['type'];
}

export interface EntityListResponse {
  entities: EntityEntry[];
}

export interface EntityBacklinksPayload {
  entityId: string;
}

export interface EntityBacklinkScene {
  sceneId: string;
  sceneTitle: string;
  scenePath: string;
  snippet: string;
}

export interface EntityBacklinksResponse {
  entityId: string;
  scenes: EntityBacklinkScene[];
}

// ─── Brainstorm Agent types (Epic 5 — separate chat page, writes to vault) ───

export interface AgentBrainstormPayload {
  prompt: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AgentBrainstormResponse {
  text: string;
}

// ─── Writing Assistant agent types (Epic 5) ───

export interface AgentWritingAssistantPayload {
  prompt: string;
  context?: string;
}

export interface AgentWritingAssistantResponse {
  text: string;
}

// ─── Vault Agent types (Epic 5 — MYT-110) ───

export interface VaultIndexEntry {
  id: string;
  name: string;
  type: EntityEntry['type'];
  aliases?: string[];
  tags?: string[];
  keyFacts: string;
}

export interface VaultIndexResponse {
  entities: VaultIndexEntry[];
}

export interface VaultCheckPayload {
  sceneContent: string;
}

export interface VaultCheckInconsistency {
  id: string;
  entityName: string;
  text: string;
  rationale: string;
  timestamp: string;
  source_agent: 'vault-agent';
  status: 'proposed' | 'dismissed';
}

export interface VaultCheckResponse {
  text: string;
  inconsistencies: VaultCheckInconsistency[];
}

// ─── Archive Agent streaming types (Phase 3 — MYT-180) ───

export interface AgentArchivePayload {
  prompt: string;
  context?: string;
}

export interface AgentArchiveTimelinePlacement {
  scenePath: string;
  inferredTime: string;
  confidence: string;
}

export interface AgentArchiveLink {
  scenePath: string;
  entityName: string;
}

export interface AgentArchiveResponse {
  text: string;
  timelinePlacements: AgentArchiveTimelinePlacement[];
  links: AgentArchiveLink[];
  inconsistencies: string[];
  requestId: string;
}

// ─── App settings types ───

export interface AgentBudgetSettings {
  autoApply: boolean;
  confidenceThreshold: number;
  maxTokensPerHour: number;
  maxSuggestionsPerHour: number;
  heartbeatIntervalMinutes: number;
  maxTokensPerDay: number;
}

// ─── Per-agent config (MYT-343) ───
// Clean normalized view of per-agent user-facing controls.

export interface AgentBudget {
  /** Maximum tokens consumed per calendar day. */
  tokensPerDay: number;
  /** Maximum Anthropic API calls per minute. */
  requestsPerMinute: number;
}

export interface AgentConfig {
  /** Whether the agent is allowed to run at all. */
  enabled: boolean;
  /** Provider+model string, e.g. "anthropic/claude-sonnet-4-6". */
  model: string;
  /** Confidence threshold [0,1] above which suggestions are auto-applied. */
  autoApplyThreshold: number;
  budget: AgentBudget;
}

export type AgentName = 'writingAssistant' | 'brainstorm' | 'archive';

export interface AgentConfigMap {
  writingAssistant: AgentConfig;
  brainstorm: AgentConfig;
  archive: AgentConfig;
}

export interface VoiceSettings {
  enabled: boolean;
  cloudFallback: boolean;
  micDeviceId?: string;
  openaiApiKey?: string;
}

// ─── STT adapter settings (MYT-338) ───
// Off by default — no transcription unless stt.enabled = true.
export interface SttSettings {
  enabled: boolean;
  /** 'local' = whisper.cpp only; 'cloud' = cloud only; 'auto' = local first, cloud fallback */
  provider: 'local' | 'cloud' | 'auto';
  /** Absolute path to local whisper.cpp binary */
  localBinaryPath?: string;
  /** OpenAI-compatible audio transcription endpoint */
  cloudEndpoint?: string;
  /** API key for cloud endpoint; falls back to OPENAI_API_KEY env var */
  cloudApiKey?: string;
}

// ─── TTS adapter settings (MYT-339) ───
// Off by default — no synthesis unless tts.enabled = true.
export interface TtsSettings {
  enabled: boolean;
  /** 'local' = Piper only; 'cloud' = cloud only; 'auto' = local first, cloud fallback */
  provider: 'local' | 'cloud' | 'auto';
  /** Default voice identifier (Piper model voice or OpenAI voice name, e.g. 'alloy') */
  voiceId?: string;
  /** Absolute path to local Piper binary */
  localBinaryPath?: string;
  /** Absolute path to Piper .onnx voice model */
  localModelPath?: string;
  /** OpenAI-compatible TTS endpoint; defaults to https://api.openai.com/v1/audio/speech */
  cloudEndpoint?: string;
  /** API key for cloud endpoint; falls back to OPENAI_API_KEY env var */
  cloudApiKey?: string;
}

// ─── Provider settings (MYT-324) ───
// Mirrors provider.ts ProviderConfig — kept in sync manually.
export type ProviderKind = 'anthropic' | 'openai' | 'ollama' | 'lmstudio' | 'custom';

export interface ProviderSettings {
  kind: ProviderKind;
  /** API key — required for anthropic / openai; ignored for local providers */
  apiKey?: string;
  /** Base URL override; uses provider default when omitted */
  baseUrl?: string;
  /** Default model used for all agents unless the agent overrides it */
  model: string;
}

export interface AppSettings {
  /** @deprecated Use provider.apiKey instead. Kept for backward compatibility. */
  apiKey: string;
  /** Active AI provider configuration. Defaults to Anthropic when absent. */
  provider?: ProviderSettings;
  agents: {
    writingAssistant: { enabled: boolean; model: string; scanIntervalSeconds: number } & AgentBudgetSettings;
    brainstorm: { enabled: boolean; model: string } & AgentBudgetSettings;
    archive: { enabled: boolean; model: string; continuityCheckIntervalSeconds: number } & AgentBudgetSettings;
  };
  theme: 'dark' | 'high-contrast';
  /** Softness↔Contrast slider position, 0 (softer) … 1 (sharper). MYT-518. */
  themeAxis?: number;
  snapshots?: {
    maxPerScene: number;
    maxAgeDays: number;
  };
  onboardingComplete?: boolean;
  voice?: VoiceSettings;
  /** STT adapter config (MYT-338). Absent or enabled=false → transcription disabled. */
  stt?: SttSettings;
  /** TTS adapter config (MYT-339). Absent or enabled=false → synthesis disabled. */
  tts?: TtsSettings;
  /** Update channel: 'stable' = GitHub releases, 'beta' = GitHub pre-releases */
  updateChannel?: 'stable' | 'beta';
  /** Telemetry opt-in (MYT-344). Off by default. sessionId regenerated on disable. */
  telemetry?: {
    enabled: boolean;
    sessionId: string;
  };
}

export interface SettingsSetPayload {
  settings: AppSettings;
}

export interface SettingsSetResponse {
  saved: boolean;
}

// ─── Multi-project types (MYT-374) ───────────────────────────────────────────

export interface ProjectEntry {
  name: string;
  vaultRoot: string;
  openedAt: string;
}

export interface ProjectListResponse {
  projects: ProjectEntry[];
  activeVaultRoot: string;
}

export interface ProjectSwitchPayload {
  vaultRoot: string;
}

export interface ProjectSwitchResponse {
  vaultRoot: string;
  switched: boolean;
  error?: string;
}

// ─── Telemetry types (MYT-344) ───────────────────────────────────────────────
export interface TelemetryReportPayload {
  type: string;
  meta?: Record<string, string | number | boolean>;
}

export interface TelemetryReportResponse {
  queued: boolean;
}

// ─── SQLite domain row types (mirrors db.ts — kept in sync manually) ───

export type SuggestionStatus = 'proposed' | 'accepted' | 'rejected' | 'applied' | 'rolled_back';
export type SourceAgent = 'writing-assistant' | 'brainstorm' | 'archive';
export type AuditAction = 'accept' | 'apply' | 'reject' | 'rollback';
export type TimelineSource = 'explicit_marker' | 'prose';

export interface SuggestionRow {
  id: string;
  source_agent: SourceAgent | string;
  confidence: number;
  rationale: string;
  target_kind: 'vault' | 'manuscript' | null;
  target_path: string | null;
  target_anchor: string | null;
  payload_json: string | null;
  status: SuggestionStatus;
  created_at: string;
  applied_at: string | null;
  applied_run_id: string | null;
  /** 1 if this suggestion was blocked by a budget cap, 0 otherwise */
  budget_exceeded: number;
}

export interface AuditLogRow {
  id: string;
  suggestion_id: string;
  action: AuditAction;
  snapshot_path: string | null;
  actor: string;
  created_at: string;
}

export interface TimelineEntryRow {
  id: string;
  scene_path: string;
  inferred_time: string;
  confidence: number;
  source: TimelineSource;
  notes_json: string | null;
  created_at: string;
}

// ─── Suggestions IPC payload / response types ───

export interface SuggestionsListPayload {
  status?: SuggestionStatus;
  sourceAgent?: SourceAgent | string;
}

export interface SuggestionsListResponse {
  suggestions: SuggestionRow[];
}

export interface SuggestionsUpsertPayload {
  suggestion: SuggestionRow;
}

export interface SuggestionsUpsertResponse {
  id: string;
}

export interface SuggestionsAcceptPayload {
  id: string;
  actor?: string;
}

export interface SuggestionsAcceptResponse {
  id: string;
  status: SuggestionStatus;
  auditId: string;
}

export interface SuggestionsApplyPayload {
  id: string;
  snapshotPath?: string;
  actor?: string;
  appliedRunId?: string;
}

export interface SuggestionsApplyResponse {
  id: string;
  auditId: string;
}

export interface SuggestionsRejectPayload {
  id: string;
  reason?: string;
  actor?: string;
}

export interface SuggestionsRejectResponse {
  id: string;
  auditId: string;
}

export interface SuggestionsRollbackPayload {
  id: string;
  actor?: string;
}

export interface SuggestionsRollbackResponse {
  id: string;
  auditId: string;
  restoredPath: string | null;
}

// ─── Audit IPC payload / response types ───

export interface AuditListPayload {
  suggestionId?: string;
}

export interface AuditListResponse {
  entries: AuditLogRow[];
}

// ─── Timeline IPC payload / response types ───

export interface TimelineListPayload {
  scenePath?: string;
}

export interface TimelineListResponse {
  entries: TimelineEntryRow[];
}

export interface TimelineUpsertPayload {
  entry: TimelineEntryRow;
}

export interface TimelineUpsertResponse {
  id: string;
}

// MYT-319: Archive Agent timeline inference
export interface TimelineInferPayload {
  /** Story ID to infer chronology for */
  storyId: string;
}

export interface TimelineInferredScene {
  sceneId: string;
  scenePath: string;
  sceneTitle: string;
  inferredTime: string | null;
  confidence: number;
  source: TimelineSource | null;
  cue: string | null;
}

export interface TimelineInferResponse {
  placements: TimelineInferredScene[];
}

// ─── Generation log IPC types ───

export interface GenerationLogRow {
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

export interface GenerationLogRecentPayload {
  limit?: number;
  offset?: number;
  agent?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface GenerationLogRecentResponse {
  entries: GenerationLogRow[];
  total: number;
}

export interface GenerationLogListPayload {
  page?: number;
  pageSize?: number;
  agent?: string;
}

export interface GenerationLogListResponse {
  entries: GenerationLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface GenerationLogGetPayload {
  id: string;
}

export interface GenerationLogGetResponse {
  entry: GenerationLogRow | null;
}

// ─── Archive Agent IPC types (Phase 3) ───

export interface ArchiveScanPayload {
  sceneText: string;
  scenePath: string;
}

export interface ArchiveScanResponse {
  suggestions: SuggestionRow[];
  inconsistenciesFound: number;
  wikiLinksFound: number;
}

export interface ArchiveStatusResponse {
  status: 'idle' | 'indexing' | 'ready';
  count: number;
  total: number;
  builtAt: string | null;
}

// ─── Chapter / Scene creation (Phase 2 — MYT-195) ───

export interface ChapterCreatePayload {
  storyId: string;
  title: string;
  order?: number;
}

export interface SceneCreatePayload {
  storyId: string;
  chapterId: string;
  title: string;
  order?: number;
}

// ─── Chapter / Scene save+load (Phase 2 — MYT-196) ───

export interface ChapterListPayload {
  storyId: string;
}

export interface ChapterListResponse {
  chapters: ChapterEntry[];
}

export interface ChapterGetPayload {
  chapterId: string;
}

export interface ChapterGetResponse {
  chapter: ChapterEntry | null;
}

export interface ChapterSavePayload {
  chapterId: string;
  title?: string;
  order?: number;
}

export interface ChapterSaveResponse {
  chapter: ChapterEntry;
}

export interface SceneListPayload {
  chapterId: string;
}

export interface SceneListResponse {
  scenes: SceneEntry[];
}

export interface SceneGetPayload {
  sceneId: string;
}

export interface SceneGetResponse {
  scene: SceneEntry | null;
  prose: string;
}

export interface SceneSavePayload {
  sceneId: string;
  prose: string;
  title?: string;
  order?: number;
}

export interface SceneSaveResponse {
  scene: SceneEntry;
}

// ─── Vault Graph types (Phase 5 — MYT-163) ───

export interface VaultGraphNode {
  id: string;
  label: string;
  path: string;
  folder?: string;
  tags?: string[];
}

export interface VaultGraphEdge {
  source: string;
  target: string;
}

export interface VaultGraphDataResponse {
  nodes: VaultGraphNode[];
  edges: VaultGraphEdge[];
}

// ─── Search (MYT-251) ───

export type SearchScope = 'story' | 'notes' | 'both';

export interface SearchQueryPayload {
  query: string;
  scope: SearchScope;
  limit?: number;
}

export interface SearchResultItem {
  docId: string;
  vault: 'story' | 'notes';
  kind: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface SearchQueryResponse {
  results: SearchResultItem[];
  elapsed_ms: number;
}

// ─── Writing Assistant scheduled scan (MYT-233) ───

export interface WritingScanPayload {
  sceneId: string;
  prose: string;
  scenePath: string;
}

export interface WritingScanResponse {
  tips: string[];
  scannedAt: string;
}

// Push payload emitted by the backend scheduler on writing:scan:result (MYT-236)
export interface WritingScanResultPayload {
  sceneId: string;
  scenePath: string;
  tips: string[];
  scannedAt: string;
}

// ─── Beta-Read Mode (MYT-237) ───

export interface BetaReadComment {
  id: string;
  scene_id: string;
  anchor_text: string;
  comment_text: string;
  created_at: string;
  dismissed_at: string | null;
}

export interface BetaReadCreatePayload {
  sceneId: string;
  anchorText: string;
  commentText: string;
}

export interface BetaReadCreateResponse {
  comment: BetaReadComment;
}

export interface BetaReadListPayload {
  sceneId: string;
}

export interface BetaReadListResponse {
  comments: BetaReadComment[];
}

export interface BetaReadDismissPayload {
  id: string;
}

export interface BetaReadDismissResponse {
  id: string;
  dismissed: boolean;
}

// ─── EPUB export (MYT-253 / MYT-342) ───

export interface ExportEpubMetadata {
  title?: string;
  author?: string;
  language?: string;
}

export interface ExportEpubPayload {
  storyId: string;
  /** Override title/author/language embedded in the EPUB metadata block. */
  metadata?: ExportEpubMetadata;
  /** Write directly to this path instead of showing a save dialog. */
  targetPath?: string;
}

export interface ExportEpubResponse {
  path: string | null;
  cancelled: boolean;
}

// ─── DOCX export (MYT-252) ───

export interface ExportDocxPayload {
  storyId: string;
}

export interface ExportDocxResponse {
  path: string | null;
  cancelled: boolean;
}

// ─── Budget enforcement push event (MYT-207) ───

/** Emitted on agent:budget-cap when an agent is blocked by a token or rate cap. */
export interface AgentBudgetCapEvent {
  agent: string;
  reason: 'hourly_token_cap' | 'daily_token_cap';
  /** Human-readable label, e.g. "Writing Assistant" */
  agentLabel: string;
}

// ─── Obsidian vault import wizard (MYT-244) ───

export interface VaultObsidianDryRunPayload {
  sourcePath: string;
  registrationToken: string;
}

export interface ObsidianBrokenLink {
  /** Vault-relative file path that contains the broken link */
  file: string;
  /** The raw [[target]] text */
  target: string;
}

export interface ObsidianNameCollision {
  /** Note stem (filename without .md) that collides with a manifest entity name */
  name: string;
  /** Vault-relative file path of the colliding note */
  file: string;
}

export interface VaultObsidianDryRunReport {
  /** Total .md files found */
  notesCount: number;
  /** [[links]] whose target file does not exist */
  brokenLinks: ObsidianBrokenLink[];
  /** Note names that already exist as manifest entity names */
  nameCollisions: ObsidianNameCollision[];
  /** Files missing any YAML frontmatter block */
  missingFrontmatter: string[];
  /** Non-null when the folder is unreadable (e.g. permissions) */
  fatalError: string | null;
}

export interface VaultObsidianRegisterPayload {
  sourcePath: string;
  registrationToken: string;
}

export interface VaultObsidianRegisterResponse {
  vaultRoot: string;
  notesIndexed: number;
}

export interface VaultLoadSampleResponse {
  vaultRoot: string;
}

// ─── Per-agent config IPC types (MYT-343) ───

export interface SetAgentConfigPayload {
  agent: AgentName;
  config: Partial<AgentConfig>;
}

export interface SetAgentConfigResponse {
  saved: boolean;
}

// ─── Archive confirmation dialog (MYT-376) ───

/** The three resolution verbs the user can pick for an inconsistency finding. */
export type ArchiveConfirmAction = 'match_archive' | 'suggest_story_change' | 'ignore';

export interface ArchiveConfirmPayload {
  /** ID of the inconsistency suggestion being resolved. */
  suggestionId: string;
  action: ArchiveConfirmAction;
}

export interface ArchiveConfirmResponse {
  ok: boolean;
  auditId: string;
  /** Set when action='suggest_story_change': the id of the newly created counter-suggestion. */
  newSuggestionId?: string;
}

export interface ArchiveIgnoreEntry {
  id: string;
  entityId: string;
  propKey: string;
  scenePath: string;
  createdAt: string;
}

export interface ArchiveIgnoreListResponse {
  entries: ArchiveIgnoreEntry[];
}

// ─── Auto-updater Phase 4 (MYT-337) ───

export interface CheckForUpdateResponse {
  available: boolean;
  version: string | null;
  releaseNotes: string | null;
}

export interface InstallUpdateResponse {
  scheduled: boolean;
}

// ─── Voice transcription (MYT-338) ───

export interface VoiceTranscribePayload {
  /** Raw audio bytes — any format whisper.cpp or cloud endpoint accepts (wav/webm/mp3) */
  audio: Buffer | ArrayBuffer;
  /** MIME type hint, e.g. 'audio/wav'. Defaults to 'audio/webm' when absent. */
  mimeType?: string;
}

export interface VoiceTranscribeResponse {
  text: string;
  /** Approximate confidence [0, 1]. Local path returns 0.9; cloud path returns 0.95. */
  confidence: number;
}

// ─── Text-to-speech (MYT-339) ───

export interface VoiceSpeakPayload {
  text: string;
  /** Override the default voice from tts.voiceId setting. */
  voiceId?: string;
}

export interface VoiceSpeakResponse {
  /** Unique id for this synthesis; correlates voice:speak:chunk / done / error push events. */
  speakId: string;
}
