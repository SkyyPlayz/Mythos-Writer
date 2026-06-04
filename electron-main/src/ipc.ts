// IPC Bridge — typed channels between main process and renderer
// All IPC calls go through this module for type safety.

import { ipcMain, ipcRenderer } from 'electron';
import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron';
import { sanitizeIpcError } from './ipcErrors.js';

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
  SUGGESTIONS_GET: 'suggestions:get',
  SUGGESTIONS_UPSERT: 'suggestions:upsert',
  SUGGESTIONS_ACCEPT: 'suggestions:accept',
  SUGGESTIONS_APPLY: 'suggestions:apply',
  SUGGESTIONS_REJECT: 'suggestions:reject',
  SUGGESTIONS_ROLLBACK: 'suggestions:rollback',

  // Audit log
  AUDIT_LIST: 'audit:list',

  // Provenance
  PROVENANCE_UPSERT: 'provenance:upsert',

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

  // Agent persona files (MYT-816)
  AGENT_PERSONA_READ: 'agent:persona:read',
  AGENT_PERSONA_RESET: 'agent:persona:reset',

  // System
  SYSTEM_INFO: 'system:info',

  // Versioning — per-scene snapshots
  SNAPSHOT_SAVE: 'snapshot:save',
  SNAPSHOT_SAVE_SYNC: 'snapshot:save-sync',
  SNAPSHOT_LIST: 'snapshot:list',
  SNAPSHOT_GET: 'snapshot:get',
  SNAPSHOT_RESTORE: 'snapshot:restore',
  SNAPSHOT_DELETE: 'snapshot:delete',
  SNAPSHOT_DELETE_ALL: 'snapshot:delete-all',

  // Versioned drafts — Phase 2 (MYT-198), SKY-10 upgrade
  VERSION_LIST: 'version:list',
  VERSION_GET: 'version:get',
  VERSION_ROLLBACK: 'version:rollback',

  // SKY-10 — Legacy single-file-per-chapter migration
  MIGRATION_DRY_RUN: 'migration:dryRun',
  MIGRATION_APPLY: 'migration:apply',

  // Entity CRUD
  ENTITY_CREATE: 'entity:create',
  ENTITY_READ: 'entity:read',
  ENTITY_UPDATE: 'entity:update',
  ENTITY_DELETE: 'entity:delete',
  ENTITY_LIST: 'entity:list',
  ENTITY_BACKLINKS: 'entity:backlinks',

  // Entity Relationships (SKY-232)
  ENTITY_RELATIONSHIPS_LIST: 'entity:relationships:list',
  ENTITY_RELATIONSHIPS_CREATE: 'entity:relationships:create',
  ENTITY_RELATIONSHIPS_DELETE: 'entity:relationships:delete',

  // App settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_TEST_CONNECTION: 'settings:testConnection',

  // Liquid Neon background image (MYT-613)
  BG_PICK: 'bg:pick',
  BG_LOAD: 'bg:load',

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
  // Inline rename (SKY-115) — title-only update, does not touch prose
  SCENE_RENAME: 'scene:rename',

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
  // Beta-Read on-demand LLM scan (MYT-711) — auto-generates anchored comments
  BETA_READ_SCAN: 'betaRead:scan',

  // EPUB export (MYT-253)
  EXPORT_EPUB: 'export:epub',

  // DOCX export (MYT-252)
  EXPORT_DOCX: 'export:docx',

  // Multi-scope Markdown export (SKY-153)
  EXPORT_MARKDOWN: 'export:markdown',

  // Multi-scope plain text export (SKY-153)
  EXPORT_PLAINTEXT: 'export:plaintext',

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

  // Main-process file picker for local STT/TTS binary or model selection (MYT-788).
  // Returns a one-shot registration token bound to the chosen path; the
  // renderer must echo it back in settings:set to change the corresponding
  // localBinaryPath / localModelPath field.
  VOICE_PICK_BINARY: 'voice:pickBinary',

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

  // Two-vault layout (MYT-608) — Story Vault + Notes Vault path management
  VAULT_GET_PATHS: 'vault:getPaths',
  VAULT_SET_PATHS: 'vault:setPaths',
  // SKY-9: Notes-Vault-scoped file IO. The existing VAULT_* channels stay
  // bound to the Story Vault root; this is the symmetric set rooted at the
  // separately-configured Notes Vault. Used by VaultBrowser to render the
  // AI workspace without leaking from the Story Vault, and by Brainstorm /
  // Writing-Assistant downstream work that needs to read or persist notes
  // independent of the manuscript.
  NOTES_VAULT_READ: 'notesVault:read',
  NOTES_VAULT_WRITE: 'notesVault:write',
  NOTES_VAULT_LIST: 'notesVault:list',
  NOTES_VAULT_DELETE: 'notesVault:delete',
  NOTES_VAULT_MOVE: 'notesVault:move',
  // SKY-95: dedicated mkdir avoids the dotfile block on .gitkeep placeholders.
  NOTES_VAULT_MKDIR: 'notesVault:mkdir',
  NOTES_VAULT_WATCH_START: 'notesVault:watchStart',
  NOTES_VAULT_WATCH_STOP: 'notesVault:watchStop',
  // SKY-9: intra-Story-Vault rename, symmetric with NOTES_VAULT_MOVE so the
  // renderer has one move channel per vault root.
  VAULT_MOVE: 'vault:move',
  // SKY-9: generic folder picker for the Settings UI. Distinct from
  // VAULT_PICK_FOLDER (Obsidian import wizard — issues a registration token)
  // and from BG_PICK (image picker). Returns the chosen absolute path with
  // no side effects; the Settings panel persists via vaultSetPaths.
  VAULT_CHOOSE_FOLDER: 'vault:chooseFolder',

  // Per-agent budget usage (MYT-722) — rolling 1-hour token + suggestion totals
  AGENT_BUDGET_USAGE: 'agent:budgetUsage',

  // Writing modes (MYT-347) — Normal / Focus / Edit per-project state
  WRITING_MODE_GET: 'writingMode:get',
  WRITING_MODE_SET: 'writingMode:set',

  // App data backup / restore (MYT-346)
  APP_BACKUP_APP_DATA: 'app:backupAppData',
  APP_RESTORE_APP_DATA: 'app:restoreAppData',

  // First-run onboarding (MYT-820)
  VAULT_CREATE_BLANK: 'vault:create-blank',
  VAULT_VALIDATE_PATH: 'vault:validate-path',
  VAULT_PICK_FOLDER_BY_PATH: 'vault:pick-folder-by-path',

  // SKY-20: Brainstorm Agent routing — Blank-mode vaults ask-once-per-category
  // and remember the choice. The renderer calls WRITE_NOTE for every extracted
  // fact; main resolves the destination from layoutMode + persisted memory.
  // When memory is missing, the file is staged and the renderer prompts; the
  // user's pick is then committed via RESOLVE_ROUTING.
  BRAINSTORM_GET_SETTINGS: 'brainstorm:getSettings',
  BRAINSTORM_WRITE_NOTE: 'brainstorm:writeNote',
  BRAINSTORM_RESOLVE_ROUTING: 'brainstorm:resolveRouting',
  BRAINSTORM_RESET_CATEGORY_ROUTING: 'brainstorm:resetCategoryRouting',
  BRAINSTORM_LIST_NOTES_FOLDERS: 'brainstorm:listNotesFolders',
  // SKY-196: token-budgeted context selection for Brainstorm AI requests
  BRAINSTORM_SELECT_CONTEXT: 'brainstorm:selectContext',
  // SKY-324: one-shot entry enrichment — generate a description for a newly
  // created entity and write it to the Notes Vault via the existing routing logic.
  BRAINSTORM_ENRICH_ENTRY: 'brainstorm:enrichEntry',

  // SKY-12.3: two-vault sample project loader. Copies the bundled sample
  // from resources/sample-project/ into <parentPath>/Story Vault/ and
  // <parentPath>/Notes Vault/, reindexes both, and calls setPaths.
  VAULT_LOAD_SAMPLE_TWO_VAULT: 'vault:load-sample-twovault',

  // SKY-12.4: first-run onboarding completion flag. Called by the wizard's
  // onComplete handler to persist onboardingComplete=true. Thin channel so
  // the wizard never needs to send the full settings object back.
  ONBOARDING_COMPLETE: 'onboarding:complete',

  // SKY-12.4: debug reset (MYTHOS_DEV=1 only). Clears vaultRoot, notesVaultRoot,
  // and onboardingComplete so the wizard re-appears on next boot.
  ONBOARDING_RESET: 'onboarding:reset',

  // SKY-130: persist last-opened scene + editor cursor so it can be restored on next launch.
  SESSION_SCENE_SAVE: 'session:saveScene',

  // SKY-156: Project Templates — bundled + user-saved vault structures
  TEMPLATE_LIST: 'template:list',
  TEMPLATE_SCAFFOLD: 'template:scaffold',
  TEMPLATE_SAVE_AS: 'template:saveAs',
  // SKY-190: Note Templates — per-note variable/prompt/pick templates
  NOTE_TEMPLATE_LIST: 'note-template:list',

  // SKY-193: Tag Wrangler — list / rename / merge notes-vault tags
  NOTES_TAG_LIST: 'notesVault:tag:list',
  NOTES_TAG_RENAME: 'notesVault:tag:rename',
  NOTES_TAG_MERGE: 'notesVault:tag:merge',
  // SKY-55: per-scene notes
  NOTES_GET: 'notes:get',
  NOTES_SET: 'notes:set',
  // SKY-158: Tag & cross-reference system
  TAGS_LIST: 'tags:list',
  TAGS_UPSERT: 'tags:upsert',
  TAGS_DELETE: 'tags:delete',
  TAGS_RENAME: 'tags:rename',
  TAGS_FOR_ITEM: 'tags:forItem',
  TAGS_SET_FOR_ITEM: 'tags:setForItem',
  TAGS_ITEMS_FOR_TAG: 'tags:itemsForTag',
  TAGS_BULK_APPLY: 'tags:bulkApply',
  SCENE_SET_TAGS: 'scene:setTags',
  // SKY-154: Writing Goals & Progress Dashboard
  GOALS_LOG_WORDS: 'goals:logWords',
  GOALS_GET_STATS: 'goals:getStats',
  GOALS_SET_GOAL: 'goals:setGoal',
  GOALS_RESET_STREAK: 'goals:resetStreak',
  // SKY-170: Scene-to-entity links
  SCENE_ENTITY_LINKS_LIST: 'sceneEntityLinks:list',
  SCENE_ENTITY_LINKS_UPSERT: 'sceneEntityLinks:upsert',
  SCENE_ENTITY_LINKS_DELETE: 'sceneEntityLinks:delete',
  ENTITY_LINKED_SCENES: 'entity:linkedScenes',

  // SKY-203: Note-level backlinks — which notes link to a given note
  NOTE_BACKLINKS: 'notesVault:backlinks',

  // SKY-194: Iconize — per-node icons with bundled + user icon packs
  NOTES_VAULT_READ_ICONS: 'notesVault:readIcons',
  VAULT_READ_ICONS: 'vault:readIcons',
  ICONS_LIST_USER_PACKS: 'icons:listUserPacks',
  ICONS_READ_SVG: 'icons:readSvg',

  // SKY-205: Smart Folders — frontmatter-backed persistent queries
  SMART_FOLDER_LIST: 'smartFolder:list',
  SMART_FOLDER_CREATE: 'smartFolder:create',
  SMART_FOLDER_UPDATE: 'smartFolder:update',
  SMART_FOLDER_DELETE: 'smartFolder:delete',
  SMART_FOLDER_QUERY: 'smartFolder:query',
  // SKY-204: Daily Notes — opt-in journal mode
  DAILY_NOTE_OPEN_TODAY: 'dailyNote:openToday',
  DAILY_NOTE_GET_STREAK: 'dailyNote:getStreak',
  // SKY-207: Per-scene custom frontmatter fields
  CUSTOM_FIELDS_LIST: 'customFields:list',
  CUSTOM_FIELDS_SET: 'customFields:set',
  SCENE_PROPS_GET: 'scene:propsGet',
  SCENE_PROPS_SET: 'scene:propsSet',

  // SKY-320: one-click Mythos Vault create (Vaults/<name>/{Story Vault, Notes Vault}).
  // Skips the folder picker; renderer either accepts the default parent
  // (~/Mythos/Vaults) or supplies one it already validated.
  VAULT_CREATE_DEFAULT_MYTHOS: 'vault:createDefaultMythos',

  // SKY-445/SKY-458: Continuity drift detection — cross-chapter lore consistency check
  CONTINUITY_CHECK: 'continuity:check',

  // SKY-791: Timeline data model + settings IPC
  TIMELINE_GET_SETTINGS: 'timeline:getSettings',
  TIMELINE_SAVE_SETTINGS: 'timeline:saveSettings',
  TIMELINE_GET_SCENES: 'timeline:getScenes',
  TIMELINE_UPDATE_SCENE: 'timeline:updateScene',
  TIMELINE_UPDATE_ARC_COLOR: 'timeline:updateArcColor',
  TIMELINE_LIST_ARCS: 'timeline:listArcs',

  // SKY-796: Timeline AI auto-population proposals
  TIMELINE_PROPOSALS_GENERATE: 'timeline:proposals:generate',
  TIMELINE_PROPOSALS_LIST: 'timeline:proposals:list',
  TIMELINE_PROPOSAL_RESOLVE: 'timeline:proposal:resolve',
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

export interface VaultMovePayload {
  fromPath: string;
  toPath: string;
}

export interface VaultMoveResponse {
  fromPath: string;
  toPath: string;
  moved: boolean;
}

export interface VaultMkdirPayload {
  path: string;
}

export interface VaultMkdirResponse {
  path: string;
  created: boolean;
}

export interface VaultChooseFolderPayload {
  title?: string;
  defaultPath?: string;
}

export interface VaultChooseFolderResponse {
  path: string | null;
  cancelled: boolean;
}

// ─── Full manifest schema ───

export interface SmartFolderEntry {
  id: string;
  name: string;
  /** Serialized query string, e.g. "pov: Lyra AND status: draft" */
  query: string;
  createdAt: string;
  updatedAt: string;
}

// SKY-207: Per-scene custom frontmatter field schema
export type FieldType = 'text' | 'number' | 'select';

export interface CustomFieldDef {
  id: string;
  /** The frontmatter key (e.g. "mood", "tension"). Lowercase, no spaces. */
  name: string;
  type: FieldType;
  /** Only for type "select". */
  options?: string[];
}

export interface SmartFolderResult {
  /** Vault-relative path */
  path: string;
  title: string;
}

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
  /** SKY-205: Named smart folders with frontmatter-backed queries */
  smartFolders?: SmartFolderEntry[];
  /** Entity-to-entity relationships (SKY-232). */
  relationships?: EntityRelationship[];
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
  // SKY-791: timeline metadata
  chronologicalTime?: ChronologicalTime;
  entityLinks?: SceneEntityLinks;
  timelineMetadata?: SceneTimelineMetadata;
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

export interface EntityRelation {
  type: string;
  target: string; // entity id
}

export interface EntityEntry {
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

/**
 * Payload for VOICE_PICK_BINARY (MYT-788). `kind` controls which file extensions
 * the dialog suggests (executable vs. piper .onnx model); the dialog itself
 * never restricts to those filters — the user can pick any file.
 */
export interface VoicePickBinaryPayload {
  kind: 'stt-binary' | 'tts-binary' | 'tts-model';
}

/**
 * Response from VOICE_PICK_BINARY. `registrationToken` is a one-shot, 60s-TTL
 * token bound to the chosen path; settings:set requires it when changing the
 * corresponding localBinaryPath / localModelPath field. `cancelled` is true
 * when the user dismissed the dialog without selecting a file.
 */
export interface VoicePickBinaryResponse {
  path: string | null;
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
  /** Human-readable name set on manual saves or special triggers (e.g. "Pre-export snapshot"). */
  label?: string;
}

export interface SnapshotSavePayload {
  sceneId: string;
  content: string;
  /** Optional label for the snapshot; auto-saves leave this unset. */
  label?: string;
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

export interface SnapshotDeletePayload {
  sceneId: string;
  snapshotId: string;
}

export interface SnapshotDeleteResponse {
  deleted: boolean;
}

export interface SnapshotDeleteAllPayload {
  /** When provided, deletes all for that scene. Omit to delete all across the vault. */
  sceneId?: string;
}

export interface SnapshotDeleteAllResponse {
  deleted: number;
}

// ─── Versioned drafts types (SKY-10 upgrade of MYT-198) ───

export type VersionIntent =
  | 'save'
  | 'auto'
  | 'agent-suggestion-applied'
  | 'pre-rollback'
  | 'migration';

export interface SceneVersion {
  sceneId: string;
  /** Sanitized ISO timestamp + 8-char content hash — sortable filename stem. */
  ts: string;
  content: string;
  intent: VersionIntent;
  /** Full sha256(content) hex. */
  contentHash: string;
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

// ─── SKY-10: Legacy-layout migration ───

export interface MigrationPlanChange {
  kind: 'create-dir' | 'write-file' | 'snapshot-legacy' | 'unlink-file';
  /** Vault-relative path the change targets. */
  path: string;
  /** Human-readable description for the dry-run modal. */
  description: string;
}

export interface MigrationPlan {
  planId: string;
  storyPath: string;
  detectedLegacyFiles: string[];
  changes: MigrationPlanChange[];
  createdAt: string;
}

export interface MigrationDryRunPayload {
  /** Optional — when omitted, scans every story under Manuscript/. */
  storyPath?: string;
}

export interface MigrationDryRunResponse {
  plans: MigrationPlan[];
}

export interface MigrationApplyPayload {
  planId: string;
  storyPath: string;
}

export interface MigrationApplyResult {
  planId: string;
  storyPath: string;
  appliedChanges: number;
  snapshotsWritten: string[];
}

export interface MigrationApplyResponse {
  result: MigrationApplyResult;
}

// ─── Entity IPC payload / response types ───

export interface EntityCreatePayload {
  name: string;
  type: EntityEntry['type'];
  aliases?: string[];
  tags?: string[];
  relations?: EntityRelation[];
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
  relations?: EntityRelation[];
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

// ─── Note backlinks (SKY-203) ───

export interface NoteBacklinksPayload {
  /** Vault-relative path of the note to find backlinks for (e.g. "my-note.md"). */
  notePath: string;
}

export interface NoteBacklinkEntry {
  /** Vault-relative path of the linking note. */
  path: string;
  /** Display name (filename without .md extension). */
  name: string;
  /** Short excerpt around the [[wikilink]] hit. */
  snippet: string;
}

export interface NoteBacklinksResponse {
  notePath: string;
  backlinks: NoteBacklinkEntry[];
}

// ─── Entity Relationship types (SKY-232) ───

export interface EntityRelationship {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  label: string;
  createdAt: string;
}

export interface EntityRelationshipRow {
  id: string;
  label: string;
  direction: 'outgoing' | 'incoming';
  otherEntityId: string;
  otherEntityName: string;
  otherEntityType: EntityEntry['type'];
  createdAt: string;
}

export interface EntityRelationshipsListPayload {
  entityId: string;
}

export interface EntityRelationshipsListResponse {
  entityId: string;
  relationships: EntityRelationshipRow[];
  allLabels: string[];
}

export interface EntityRelationshipsCreatePayload {
  fromEntityId: string;
  toEntityId: string;
  label: string;
}

export interface EntityRelationshipsCreateResponse {
  relationship: EntityRelationshipRow;
}

export interface EntityRelationshipsDeletePayload {
  relationshipId: string;
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

// ─── Continuity check types (SKY-445/SKY-458) ───

export interface ContinuityCheckPayload {
  chapters: Array<{ text: string; scenePath: string }>;
}

export interface ContinuityCheckMismatch {
  entityName: string;
  propKey: string;
  canonicalValue: string;
  contradictingPhrase: string;
  snippet: string;
}

export interface ContinuityCheckChapterResult {
  scenePath: string;
  entitiesReferenced: string[];
  checkedCount: number;
  mismatchCount: number;
  mismatches: ContinuityCheckMismatch[];
}

export interface ContinuityCheckResponse {
  chapters: ContinuityCheckChapterResult[];
  totalCheckedCount: number;
  totalMismatchCount: number;
  /** Ratio of mismatches to checks; 0 when no checks were performed. */
  driftScore: number;
  sessionId: string;
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
  /** Per-category auto-apply toggles (writing-assistant only). All default to true. */
  autoApplyCategories?: Record<SuggestionCategory, boolean>;
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
  /** 'toggle' = shortcut key toggles capture on/off; 'push-to-talk' = hold key while speaking. Default: 'toggle'. */
  voiceMode?: 'toggle' | 'push-to-talk';
  /** Keyboard shortcut for toggle mode. Format: modifier+modifier+key (e.g. 'ctrl+shift+v'). Default: 'ctrl+shift+v'. */
  toggleShortcut?: string;
  /** Hold key for push-to-talk mode (e.g. 'alt+v'). Default: 'alt+v'. */
  pttKey?: string;
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

/** Liquid Neon advanced theme customization (MYT-613 / MYT-716). All values optional;
 *  absent fields fall back to LIQUID_NEON_DEFAULTS in theme.ts. */
export interface LiquidNeonPrefs {
  softnessContrast: number;
  glass: number;
  blur: number;
  neonIntensity: number;
  neonAccent: 'cyan' | 'violet' | 'magenta';
  textHeader: string;
  textBody: string;
  textMuted: string;
  background: 'default' | string;

  // Advanced overrides (MYT-716)
  advancedDecoupled?: boolean;
  textContrast?: number;
  neonFrameWidth?: number;
  borderStrength?: number;
  bgMode?: 'color' | 'image';
  bgFit?: 'cover' | 'contain' | 'tile';
  bgPosition?: string;
  bgScrim?: number;
  bgVignette?: number;
  bgBaseColor?: string;
  accentColor?: string;
  neonBorderColor?: 'cyan' | 'violet' | 'magenta';
}

export interface AppSettings {
  /** @deprecated Use provider.apiKey instead. Kept for backward compatibility. */
  apiKey: string;
  /** Active AI provider configuration. Defaults to Anthropic when absent. */
  provider?: ProviderSettings;
  agents: {
    /** Per-agent `provider` overrides the global provider for that agent (SKY-683). API key stored in SecretsStore under `provider.<agentName>.apiKey`. */
    writingAssistant: { enabled: boolean; model: string; scanIntervalSeconds: number; provider?: ProviderSettings } & AgentBudgetSettings;
    brainstorm: { enabled: boolean; model: string; provider?: ProviderSettings } & AgentBudgetSettings;
    archive: { enabled: boolean; model: string; continuityCheckIntervalSeconds: number; provider?: ProviderSettings } & AgentBudgetSettings;
  };
  theme: 'dark' | 'high-contrast';
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
  /** Liquid Neon customization overrides (MYT-613). Absent = all defaults. */
  liquidNeon?: LiquidNeonPrefs;
  /** SKY-130: last-opened scene for cross-restart restore. */
  lastOpenedScene?: LastOpenedScene;
  /** SKY-204: opt-in daily notes / journal mode. */
  journalMode?: JournalModeSettings;
  /** SKY-627: author name entered during onboarding (optional). */
  authorName?: string;
}

/** SKY-204: daily notes journal mode configuration. */
export interface JournalModeSettings {
  /** Whether journal mode is active. Defaults to false. */
  enabled: boolean;
  /** Subfolder inside the Notes Vault for daily notes. Defaults to "Daily Notes". */
  noteFolder?: string;
  /** Date format for note filenames. Currently only "YYYY-MM-DD" is supported. */
  noteFormat?: string;
}

/** SKY-130: persisted cross-restart scene + cursor position. */
export interface LastOpenedScene {
  sceneId: string;
  scenePath: string;
  scrollTop: number;
  cursorLine: number;
}

/** SKY-627: 3-step onboarding orchestration payload. */
export interface OnboardingCompletePayload {
  /** 'blank' | 'sample' | 'template' | 'skip' (skip = bypass without creating a story). */
  startMode: 'blank' | 'sample' | 'template' | 'skip';
  /** Required for blank / sample / template modes. */
  storyTitle?: string;
  /** Optional; persisted to AppSettings.authorName. */
  authorName?: string;
  /** Parent directory for the new vault. Tilde-expanded server-side. Required for blank/sample/template. */
  vaultParentPath?: string;
  /** Required for template mode. */
  templateId?: string;
}

/** SKY-627: response from the extended onboarding:complete handler. */
export interface OnboardingCompleteResponse {
  ok: boolean;
  /** Scene ID of the first scene (blank/template/sample starts). */
  firstSceneId?: string;
  /** Relative path of the first scene within the story vault. */
  firstScenePath?: string;
  error?: string;
}

export interface SessionSaveScenePayload {
  sceneId: string;
  scenePath: string;
  scrollTop: number;
  cursorLine: number;
}

export interface SettingsSetPayload {
  settings: AppSettings;
  /**
   * MYT-788: registration tokens proving the renderer-supplied voice binary
   * and model paths came from a main-process file picker (voice:pickBinary).
   * Required only when the corresponding path field actually changes — echoes
   * of the existing value, and clearing the field, are accepted without a
   * token.
   */
  sttBinaryToken?: string;
  ttsBinaryToken?: string;
  ttsModelToken?: string;
}

export interface SettingsSetResponse {
  saved: boolean;
  /** Present when settings:set failed the voice-spawn gate (MYT-788). */
  error?: string;
}

export interface SettingsTestConnectionPayload {
  provider: ProviderSettings;
}

export interface SettingsTestConnectionResponse {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

// ─── Multi-project types (MYT-374) ───────────────────────────────────────────

export interface ProjectEntry {
  name: string;
  vaultRoot: string;
  // SKY-320: paired Notes Vault path so switching a Mythos Vault swaps both
  // halves atomically. Optional for back-compat with entries written before
  // pairing landed; resolved to the legacy default at switch time.
  notesVaultRoot?: string;
  openedAt: string;
}

export interface ProjectListResponse {
  projects: ProjectEntry[];
  activeVaultRoot: string;
  /** SKY-320: paired Notes Vault for the currently-active project. */
  activeNotesVaultRoot?: string;
}

export interface ProjectSwitchPayload {
  vaultRoot: string;
  /** SKY-320: optional Notes Vault to switch to atomically with the Story Vault. */
  notesVaultRoot?: string;
}

export interface ProjectSwitchResponse {
  vaultRoot: string;
  /** SKY-320: present when the switch also moved the Notes Vault. */
  notesVaultRoot?: string;
  switched: boolean;
  error?: string;
}

// ─── One-click Mythos Vault (SKY-320) ──────────────────────────────────────

export interface CreateDefaultMythosVaultPayload {
  /**
   * Optional parent folder for the Mythos Vault. When absent, the bundle is
   * created under `~/Mythos/Vaults/`. Allowed to point anywhere the user
   * already trusts (e.g. a OneDrive directory).
   */
  parentPath?: string;
  /** Optional display name for the new Mythos Vault. */
  vaultName?: string;
  /** Default 'default' (full scaffold); 'blank' suppresses seed content. */
  seedMode?: 'default' | 'blank';
}

export interface CreateDefaultMythosVaultResponse {
  mythosVaultRoot: string;
  vaultRoot: string;
  notesVaultRoot: string;
  name: string;
  /** False when the bundle already existed; we still re-persisted settings. */
  created: boolean;
  error?: string;
}

// ─── Telemetry types (MYT-344) ───────────────────────────────────────────────
export interface TelemetryReportPayload {
  type: string;
  meta?: Record<string, string | number | boolean>;
}

export interface TelemetryReportResponse {
  queued: boolean;
  /** Set when validation rejects the payload (MYT-794). */
  error?: string;
}

// ─── SQLite domain row types (mirrors db.ts — kept in sync manually) ───

export type SuggestionStatus = 'proposed' | 'accepted' | 'rejected' | 'applied' | 'rolled_back';
export type SourceAgent = 'writing-assistant' | 'brainstorm' | 'archive';
export type AuditAction = 'accept' | 'apply' | 'reject' | 'rollback';
export type TimelineSource = 'explicit_marker' | 'prose';
export type SuggestionCategory = 'punctuation' | 'spelling' | 'grammar' | 'sentence-structure' | 'style';

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
  /** Writing-assistant suggestion category; null/absent for other agents or legacy rows */
  category?: SuggestionCategory | null;
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

export interface SuggestionsGetPayload {
  id: string;
}

export interface SuggestionsGetResponse {
  suggestion: SuggestionRow | null;
}

// ─── Provenance IPC payload / response types ───

export interface ProvenanceRow {
  id: string;
  entity_id: string;
  entity_kind: string;
  agent_id: string;
  agent_type: string;
  run_id: string | null;
  created_at: string;
}

export interface ProvenanceUpsertPayload {
  entityId: string;
  entityKind: string;
  agentId: string;
  agentType: string;
  runId?: string | null;
}

export interface ProvenanceUpsertResponse {
  id: string;
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
  entity_count: number | null;
  context_chars: number | null;
  truncated: number | null;
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
  /** SKY-10: classifies the save so snapshots can dedupe autosaves. Defaults to 'save'. */
  intent?: VersionIntent;
  /** SKY-207: custom frontmatter field values to persist alongside prose. */
  customFields?: Record<string, unknown>;
}

export interface SceneSaveResponse {
  scene: SceneEntry;
}

// SKY-115: inline scene rename (title-only, manifest update)
export interface SceneRenamePayload {
  sceneId: string;
  title: string;
}

export interface SceneRenameResponse {
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
  filterTags?: string[];
}

export interface SearchResultItem {
  resultType: 'scene' | 'entity';
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

export interface BetaReadScanPayload {
  sceneId: string;
  prose: string;
  scenePath: string;
}

export interface BetaReadScanResponse {
  comments: BetaReadComment[];
  scannedAt: string;
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
  /**
   * Headless export escape hatch: write directly here instead of showing a save
   * dialog. MYT-675: constrained to a vault-relative `.epub` path — absolute
   * paths, `../` traversal, and symlink escapes are rejected.
   */
  targetPath?: string;
}

export interface ExportEpubResponse {
  path: string | null;
  cancelled: boolean;
}

// ─── DOCX export (MYT-252) ───

export interface ExportDocxPayload {
  // Legacy: whole-story by storyId. Kept for backward compat.
  storyId?: string;
  // SKY-153: full scope control; takes precedence over storyId when present.
  scope?: ExportScope;
}

export interface ExportDocxResponse {
  path: string | null;
  cancelled: boolean;
}

// ─── Multi-scope export (SKY-153) ───

/** What to include in a Markdown / plain-text / DOCX export. */
export type ExportScope =
  | { kind: 'scene'; sceneId: string }
  | { kind: 'chapter'; chapterId: string; storyId: string }
  | { kind: 'story'; storyId: string }
  | { kind: 'vault' };

export interface ExportMarkdownPayload {
  scope: ExportScope;
}

export interface ExportMarkdownResponse {
  path: string | null;
  cancelled: boolean;
}

export interface ExportPlaintextPayload {
  scope: ExportScope;
}

export interface ExportPlaintextResponse {
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

export interface ObsidianRestructuredEntry {
  from: string;
  to: string;
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
  /** Notes that will be moved to match the Notes Vault layout (MYT-820) */
  restructured?: ObsidianRestructuredEntry[];
  /** Notes that keep their current path unchanged (MYT-820) */
  leftAsIs?: string[];
}

export interface VaultObsidianRegisterPayload {
  sourcePath: string;
  registrationToken: string;
}

export interface VaultObsidianRegisterResponse {
  vaultRoot: string;
  notesIndexed: number;
}

export interface VaultLoadSamplePayload {
  /** Optional custom destination; defaults to ~/Documents/Mythos Sample if omitted */
  targetPath?: string;
}

export interface VaultLoadSampleResponse {
  vaultRoot: string;
}

// ─── SKY-12.3: two-vault sample project loader ───

export interface VaultLoadSampleTwoVaultPayload {
  parentPath: string;
}

export interface VaultLoadSampleTwoVaultResponse {
  storyVaultPath: string;
  notesVaultPath: string;
  error?: string;
}

// ─── First-run onboarding (MYT-820) ───

export interface VaultCreateBlankPayload {
  targetPath: string;
  /** Registration token from vault:pick-folder, required when targetPath is not in the recent-projects allowlist */
  registrationToken?: string;
}

export interface VaultCreateBlankResponse {
  vaultRoot: string;
}

export interface VaultValidatePathPayload {
  path: string;
}

export interface VaultValidatePathResponse {
  exists: boolean;
  isEmpty: boolean;
  writable: boolean;
}

export interface VaultPickFolderByPathPayload {
  sourcePath: string;
}

// SKY-12.3: two-vault sample project loader.
export interface VaultLoadSampleTwoVaultPayload {
  /** Parent directory under which Story Vault/ and Notes Vault/ will be created. */
  parentPath: string;
}

export interface VaultLoadSampleTwoVaultResponse {
  storyVaultPath: string;
  notesVaultPath: string;
  error?: string;
}

// ─── Per-agent config IPC types (MYT-343) ───

export interface SetAgentConfigPayload {
  agent: AgentName;
  config: Partial<AgentConfig>;
}

export interface SetAgentConfigResponse {
  saved: boolean;
}

// ─── Agent persona IPC types (MYT-816) ───

export type AgentPersonaName = 'writingAssistant' | 'brainstorm';
export type PersonaKey = 'AGENTS' | 'HEARTBEAT' | 'SOUL' | 'TOOLS';

export interface AgentPersonaReadPayload {
  agentName: AgentPersonaName;
  key: PersonaKey;
}

export interface AgentPersonaReadResponse {
  content: string;
  isCustom: boolean;
}

export interface AgentPersonaResetPayload {
  agentName: AgentPersonaName;
  key: PersonaKey;
}

export interface AgentPersonaResetResponse {
  success: boolean;
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

// ─── Liquid Neon background image (MYT-613) ────

export interface BgPickResponse {
  filePath: string | null;
  cancelled: boolean;
}

export interface BgLoadPayload {
  filePath: string;
}

export interface BgLoadResponse {
  dataUrl: string | null;
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

// ─── Per-agent budget usage (MYT-722) ───

export interface AgentBudgetWindowUsage {
  tokensLastHour: number;
  suggestionsLastHour: number;
}

export interface AgentBudgetUsageResponse {
  writingAssistant: AgentBudgetWindowUsage;
  brainstorm: AgentBudgetWindowUsage;
  archive: AgentBudgetWindowUsage;
}

// ─── Two-vault layout (MYT-608) ───

export interface VaultGetPathsResponse {
  storyVaultPath: string;
  notesVaultPath: string;
}

export type VaultSeedMode = 'default' | 'blank';

export interface VaultSetPathsPayload {
  storyVaultPath: string;
  notesVaultPath: string;
  // MYT-789: at least one proof of user intent is required per path. The
  // tokens come from vault:pick-folder; alternatively the path may already be
  // in the recent-projects allowlist.
  storyVaultToken?: string;
  notesVaultToken?: string;
  /** SKY-12.2: controls whether the new vaults are scaffolded with the full
   *  SKY-15 folder layout ('default', the prior behavior) or created as empty
   *  roots with only a manifest.json ('blank'). Defaults to 'default' when
   *  absent for backwards compatibility with SKY-9 callers. */
  seedMode?: VaultSeedMode;
}

export interface VaultSetPathsResponse {
  storyVaultPath: string;
  notesVaultPath: string;
  saved: boolean;
  error?: string;
}

// ─── Writing modes (MYT-347) ───

export type WritingMode = 'normal' | 'focus' | 'edit';

export interface FocusModeFlags {
  /** Show the entity/notes sidebar. */
  sidebar: boolean;
  /** Show the formatting toolbar. */
  toolbar: boolean;
  /** Show the word count bar. */
  wordCount: boolean;
  /** Show the document minimap. */
  minimap: boolean;
}

export interface EditModeConfig {
  /** Surface Writing Assistant suggestion layer. */
  showWritingAssistant: boolean;
  /** Surface Archive Agent continuity notes. */
  showArchive: boolean;
  /** Surface Beta-Read inline comments. */
  showBetaRead: boolean;
}

export interface WritingModeState {
  mode: WritingMode;
  focusFlags: FocusModeFlags;
  editConfig: EditModeConfig;
}

export interface WritingModeSetPayload {
  mode?: WritingMode;
  focusFlags?: Partial<FocusModeFlags>;
  editConfig?: Partial<EditModeConfig>;
}

// ─── App data backup / restore (MYT-346) ───

// SKY-699: outputPath removed — renderer must not supply a write destination;
// the handler always calls dialog.showSaveDialog to obtain it (CWE-73 fix).
export interface BackupAppDataPayload {}

export interface BackupAppDataResponse {
  /** Absolute path to the created archive; null when cancelled. */
  path: string | null;
  bytes: number;
  cancelled: boolean;
}

export interface RestoreAppDataPayload {
  /** Must be true when app data already exists; absent/false → reject with requiresConfirmation. */
  confirmed?: boolean;
}

export interface RestoreAppDataResponse {
  restored: boolean;
  details: string[];
  /** True when the caller must re-call with confirmed: true to proceed. */
  requiresConfirmation?: boolean;
  cancelled?: boolean;
}

// ─── Brainstorm Agent routing (SKY-20) ───

export type BrainstormFactType = 'character' | 'location' | 'item' | 'note';

export interface BrainstormGetSettingsResponse {
  /** Vault layout mode the user picked at onboarding. */
  layoutMode: 'default' | 'blank' | 'imported';
  /** Per-category folder choices for Blank-mode vaults. Keys are FactType. */
  notesRouting: Partial<Record<BrainstormFactType, string>>;
}

export interface BrainstormWriteNotePayload {
  category: BrainstormFactType;
  name: string;
  content: string;
}

export type BrainstormWriteNoteResponse =
  | {
      status: 'written';
      /** Vault-relative path of the written note. */
      path: string;
      suggestionId: string;
      /** How the destination was resolved — for telemetry/tests. */
      reason: 'default-layout' | 'remembered';
    }
  | {
      status: 'needs_routing';
      /** Staged file path (vault-relative). Caller invokes RESOLVE_ROUTING
       *  with the user's chosen folder; main moves the file there. */
      stagedPath: string;
      category: BrainstormFactType;
      name: string;
    };

export interface BrainstormResolveRoutingPayload {
  /** Path returned by WRITE_NOTE when status was needs_routing. */
  stagedPath: string;
  category: BrainstormFactType;
  /** User-picked destination folder, vault-relative POSIX path. */
  destination: string;
  /** When true, persist the destination as the new default for `category`.
   *  When false, this is a one-off route — memory is not updated. */
  remember: boolean;
}

export interface BrainstormResolveRoutingResponse {
  status: 'written';
  /** Final vault-relative path after the move. */
  path: string;
  /** Echoed back so the renderer can update its memory cache. */
  notesRouting: Partial<Record<BrainstormFactType, string>>;
}

export interface BrainstormResetCategoryRoutingPayload {
  category: BrainstormFactType;
}

export interface BrainstormResetCategoryRoutingResponse {
  notesRouting: Partial<Record<BrainstormFactType, string>>;
}

export interface BrainstormFolderEntry {
  /** Vault-relative POSIX path (no leading slash). */
  path: string;
  /** Display label for the folder picker. */
  label: string;
}

export interface BrainstormListNotesFoldersResponse {
  /** Existing folders inside the Notes Vault, suitable for the picker.
   *  Sorted alphabetically; depth-limited so the picker stays usable. */
  folders: BrainstormFolderEntry[];
  notesVaultRoot: string;
}

// ─── SKY-196: Brainstorm context selection ────────────────────────────────────

/** A vault note that was scored for context inclusion. */
export interface BrainstormContextItem {
  path: string;
  name: string;
  type: BrainstormFactType;
  content: string;
  /** Approximate token cost used for budget accounting. */
  estimatedTokens: number;
  /** Human-readable reason this item was included or excluded. */
  whyIncluded: string;
}

export interface BrainstormSelectContextPayload {
  /** The user's current message (highest-priority for name matching). */
  userMessage: string;
  /** Concatenated prior conversation text (lower-priority name matching). */
  conversationText: string;
  /** Token ceiling for included items. Defaults to 4 000. */
  tokenBudget?: number;
}

export interface BrainstormSelectContextResponse {
  /** Items included in the context within the budget. */
  included: BrainstormContextItem[];
  /** Items that were candidates but would have exceeded the budget. */
  excluded: BrainstormContextItem[];
  /** Total tokens consumed by included items. */
  usedTokens: number;
  /** The budget that was applied. */
  budgetTokens: number;
}

// ─── SKY-324: Entry quick-enrich ─────────────────────────────────────────────

export interface BrainstormEnrichEntryPayload {
  /** The entity name as entered by the user. */
  name: string;
  /** EntityType value ('character' | 'location' | 'item' | 'concept' | 'other').
   *  Mapped to FactType in the handler: concept/other → 'note'. */
  type: string;
}

export type BrainstormEnrichEntryResponse =
  | { status: 'ok'; path: string; content: string }
  | { status: 'skipped'; reason: string };

export interface TemplateScaffoldResponse {
  ok: true;
  storyVaultPath: string;
  notesVaultPath: string;
  // One-shot tokens for the derived paths — pass to vault:setPaths as
  // storyVaultToken / notesVaultToken to authorize that call too.
  storyVaultToken: string;
  notesVaultToken: string;
}
