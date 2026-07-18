// IPC Bridge — typed channels between main process and renderer
// All IPC calls go through this module for type safety.

import { ipcMain, ipcRenderer } from 'electron';
import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron';
import { sanitizeIpcError, withIpcLog, IPC_ERROR_CATEGORIES } from './ipcErrors.js';
import type { IpcEnvelope } from './ipcErrors.js';
import type { SceneCrafterBoard } from './sceneCrafterBoard.js';
import type { StoryTimeOfDay, ManifestTimelineEntry } from './vault/manifest/types.js';
export type { StoryTimeOfDay, ManifestTimelineEntry };
import type { OutlineNode, OutlineData } from './outline.js';
export type { OutlineNode, OutlineData };
import type {
  TimelinesStore,
  TimelineDefinition,
  TimelineKind,
  TimelineCalendar,
  TimelineEra,
  TimelineSpan,
  TimelineRow,
  TimelineEvent,
} from './timelines/model.js';
export type {
  TimelinesStore,
  TimelineDefinition,
  TimelineKind,
  TimelineCalendar,
  TimelineEra,
  TimelineSpan,
  TimelineRow,
  TimelineEvent,
};

// Re-export canonical payload/policy types from @mythos-writer/shared.
// SuggestionStatus and SuggestionCategory are also defined inline below (backward compat).
export type {
  SuggestionPayload,
  VaultContentPayload,
  TypedRelationPayload,
  ManuscriptInconsistencyPayload,
  AutoApplyPolicy,
  AgentBudgetUsage,
} from '@mythos-writer/shared/types/suggestion';

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
  // SKY-5790: reveal the current Story Vault root in the OS file manager
  // (distinct from VAULT_OPEN_FOLDER, which opens a picker to switch vaults).
  VAULT_REVEAL_FOLDER: 'vault:revealFolder',
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
  SUGGESTIONS_SEARCH: 'suggestions:search',
  SUGGESTIONS_IGNORE: 'suggestions:ignore',
  SUGGESTIONS_BATCH_ACTION: 'suggestions:batch-action',
  SUGGESTIONS_UNIFIED_LIST: 'suggestions:unified-list',

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
  // SKY-2969: uninstaller vault-cleanup choice
  APP_CLEAN_UNINSTALL: 'app:cleanUninstall',

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

  // Agent persona files (MYT-816; Beta 3 M22 adds write)
  AGENT_PERSONA_READ: 'agent:persona:read',
  AGENT_PERSONA_RESET: 'agent:persona:reset',
  AGENT_PERSONA_WRITE: 'agent:persona:write',

  // System
  SYSTEM_INFO: 'system:info',

  // Versioning — per-scene snapshots
  SNAPSHOT_SAVE: 'snapshot:save',
  SNAPSHOT_LIST: 'snapshot:list',
  SNAPSHOT_GET: 'snapshot:get',
  SNAPSHOT_RESTORE: 'snapshot:restore',
  SNAPSHOT_DELETE: 'snapshot:delete',
  SNAPSHOT_DELETE_ALL: 'snapshot:delete-all',

  // Versioned drafts — Phase 2 (MYT-198), SKY-10 upgrade
  VERSION_LIST: 'version:list',
  VERSION_GET: 'version:get',
  VERSION_ROLLBACK: 'version:rollback',
  // Beta 4 M10 — explicit snapshot into the SKY-10/M5 store
  VERSION_SAVE: 'version:save',

  // SKY-10 — Legacy single-file-per-chapter migration
  MIGRATION_DRY_RUN: 'migration:dryRun',
  MIGRATION_APPLY: 'migration:apply',

  // Beta 4 M5 — v0.4 twin-root → MythosVault (v2) migration wizard
  MYTHOS_MIGRATION_STATUS: 'mythosMigration:status',
  MYTHOS_MIGRATION_PLAN: 'mythosMigration:plan',
  MYTHOS_MIGRATION_RUN: 'mythosMigration:run',
  MYTHOS_MIGRATION_CONFIRM: 'mythosMigration:confirm',
  MYTHOS_MIGRATION_DISMISS: 'mythosMigration:dismiss',

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

  // Notes Vault graph — in-memory link index (SKY-1756 / SKY-1743)
  VAULT_GRAPH_NODES: 'vault:graph:nodes',
  VAULT_GRAPH_EDGES: 'vault:graph:edges',

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
  // SKY-1391: brainstorm→writing-panel bridge — appends to scene note field
  SCENE_APPEND_BRAINSTORM_NOTE: 'scene:appendBrainstormNote',

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
  WRITING_ASSISTANT_CADENCE_CHANGE: 'writing-assistant:cadence-change',
  WRITING_ASSISTANT_TIP_DECISION: 'writing-assistant:tip-decision',
  WRITING_ASSISTANT_SCAN_NOW: 'writing-assistant:scan-now',
  WRITING_ASSISTANT_SCAN_START: 'writing-assistant:scan-start',
  WRITING_ASSISTANT_SCAN_RESULT: 'writing-assistant:scan-result',
  WRITING_ASSISTANT_SCAN_ERROR: 'writing-assistant:scan-error',
  // Query persisted suggestions for a scene (SKY-2626)
  WRITING_ASSISTANT_SUGGESTION_LIST: 'writing-assistant:suggestion:list',
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

  // Beta 4 M14 — PDF export via Chromium printToPDF (FULL-SPEC §5.5)
  EXPORT_PDF: 'export:pdf',

  // Beta 4 M14 — reveal the last exported file in the OS file manager.
  // Path state lives in the main process only (never renderer-supplied).
  EXPORT_REVEAL_LAST: 'export:reveal-last',

  // Obsidian vault import wizard (MYT-244)
  VAULT_OBSIDIAN_DRY_RUN: 'vault:obsidian-dry-run',
  VAULT_OBSIDIAN_REGISTER: 'vault:obsidian-register',

  // Beta 3 M24 — Settings → Vault & Files: import another vault
  // (Obsidian / Notion / Scrivener / Markdown → second vault or its own folder)
  // and import a story (docx / gdocs export / md / scriv / epub →
  // headings→parts/chapters/scenes + Story Plan note).
  VAULT_IMPORT_SCAN: 'vault:import-scan',
  VAULT_IMPORT_RUN: 'vault:import-run',
  STORY_IMPORT_PICK: 'story:import-pick',
  STORY_IMPORT_RUN: 'story:import-run',
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
  // Beta 4 M2 — per-vault stats for the title-bar Mythos-vault switcher (§4)
  PROJECT_STATS: 'project:stats',

  // Archive confirmation dialog (MYT-376) — three-verb resolution for inconsistencies
  ARCHIVE_CONFIRM: 'archive:confirm',
  ARCHIVE_IGNORE_LIST: 'archive:ignore-list',

  // Wiki-link suggestion pipeline (SKY-1613)
  ARCHIVE_SCAN_LINKS: 'archive:scan-links',
  ARCHIVE_ACCEPT_LINK: 'archive:accept-link',
  ARCHIVE_REJECT_LINK: 'archive:reject-link',

  // Two-vault layout (MYT-608) — Story Vault + Notes Vault path management
  VAULT_GET_PATHS: 'vault:getPaths',
  VAULT_GET_SYSTEM_PATHS: 'vault:getSystemPaths',
  VAULT_DETECT_LEGACY: 'vault:detectLegacyVaults',
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
  // SKY-862: relocate the entire story vault to a cloud-synced folder.
  // Distinct from VAULT_MOVE (intra-vault file rename) — this moves the root
  // directory itself and updates persisted settings.
  VAULT_GUIDED_FOLDER_MOVE: 'vault:guidedFolderMove',
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

  // SKY-2638: Path 3 — import Obsidian vault dry-run + commit channels
  ONBOARDING_IMPORT_DRY_RUN: 'onboarding:import-vault:dry-run',
  ONBOARDING_IMPORT_COMMIT: 'onboarding:import-vault:commit',

  // SKY-12.4: debug reset (MYTHOS_DEV=1 only). Clears vaultRoot, notesVaultRoot,
  // and onboardingComplete so the wizard re-appears on next boot.
  ONBOARDING_RESET: 'onboarding:reset',

  // SKY-2971: Word (.docx) → Story Vault importer.
  ONBOARDING_IMPORT_DOCX: 'onboarding:importDocxToStoryVault',

  // SKY-2993: Obsidian vault import.
  ONBOARDING_IMPORT_OBSIDIAN: 'onboarding:importObsidianVault',
  ONBOARDING_DRY_RUN_OBSIDIAN: 'onboarding:dryRunObsidianImport',

  // SKY-2991: onboarding v2 path validation + vault discovery handlers
  ONBOARDING_VALIDATE_PATH: 'onboarding:validatePath',
  ONBOARDING_GET_SUGGESTED_PATHS: 'onboarding:getSuggestedPaths',
  ONBOARDING_OPEN_EXISTING_VAULT: 'onboarding:openExistingVault',
  ONBOARDING_DETECT_MYTHOS_VAULT: 'onboarding:detectMythosVault',

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

  // SKY-6306 M21: Multi-timeline store IPC
  TIMELINES_GET_STORE: 'timelines:getStore',
  TIMELINES_UPSERT: 'timelines:upsert',
  TIMELINES_SET_ACTIVE: 'timelines:setActive',
  // Beta 4 M22: Axis engine — era/span/event/row item persistence
  TIMELINES_UPSERT_ITEM: 'timelines:upsertItem',
  TIMELINES_DELETE_ITEM: 'timelines:deleteItem',

  // SKY-863: Cloud-sync conflict detection + lockfile
  VAULT_CHECK_CONFLICTS: 'vault:check-conflicts',
  VAULT_DISMISS_SYNC_WARNING: 'vault:dismiss-sync-warning',
  // SKY-1399: manage custom templates
  TEMPLATE_RENAME: 'template:rename',
  TEMPLATE_DELETE: 'template:delete',
  TEMPLATE_DUPLICATE: 'template:duplicate',
  // SKY-1403: export / import .mythostemplate files
  TEMPLATE_EXPORT: 'template:export',
  TEMPLATE_IMPORT: 'template:import',
  // SKY-1499/SKY-1501: list available models from a provider endpoint
  PROVIDER_LIST_MODELS: 'provider:listModels',

  // SKY-1483: Wave 3.4 — extraction side-call + NoteProposal IPC
  BRAINSTORM_EXTRACT_PROPOSALS: 'brainstorm:extractProposals',
  BRAINSTORM_PROPOSAL_QUEUED: 'brainstorm:proposalQueued',
  BRAINSTORM_GET_SESSION_REJECTIONS: 'brainstorm:getSessionRejections',
  BRAINSTORM_DISMISS_ALL: 'brainstorm:dismissAll',
  // SKY-1483 v2: confirm/reject handlers with day-one telemetry logging
  BRAINSTORM_PROPOSALS_CONFIRM: 'brainstorm:proposals:confirm',
  BRAINSTORM_PROPOSALS_REJECT: 'brainstorm:proposals:reject',

  // SKY-1611: SQLite-backed versioned draft snapshots
  DRAFTS_CREATE: 'drafts:create',
  DRAFTS_LIST: 'drafts:list',
  DRAFTS_PREVIEW: 'drafts:preview',
  DRAFTS_RESTORE: 'drafts:restore',
  DRAFTS_LABEL: 'drafts:label',
  DRAFTS_DELETE: 'drafts:delete',

  // SKY-1686: Global right-sidebar — panel popout window
  PANEL_POPOUT: 'panel:popout',
  PANEL_POPOUT_CLOSED: 'panel:popout-closed',

  // SKY-1697: Wave 2c — free-floating panel windows
  PANEL_FLOAT: 'panel:float',
  PANEL_FLOAT_CLOSED: 'panel:float-closed',
  PANEL_FLOAT_DOCK_BACK: 'panel:float-dock-back',
  PANEL_FLOAT_SET_PIN: 'panel:float-set-pin',
  PANEL_FLOAT_BOUNDS: 'panel:float-bounds',

  // SKY-2966: Story navigator popout cross-window sync
  NAVIGATOR_SELECT_SCENE: 'navigator:select-scene',
  NAVIGATOR_REPORT_SCENE: 'navigator:report-scene',
  NAVIGATOR_SCENE_CHANGED: 'navigator:scene-changed',
  NAVIGATOR_SCENE_SYNCED: 'navigator:scene-synced',
  NAVIGATOR_REPORT_MANIFEST: 'navigator:report-manifest',
  NAVIGATOR_MANIFEST_CHANGED: 'navigator:manifest-changed',

  // SKY-1684: Archive Agent v1 — continuity scan IPC
  ARCHIVE_SCAN_CONTINUITY: 'archive:scan-continuity',
  ARCHIVE_RESOLVE_CONTINUITY: 'archive:resolve-continuity',
  ARCHIVE_LIST_CONTINUITY: 'archive:list-continuity',
  // Push events (main → renderer)
  ARCHIVE_CONT_SCAN_START: 'archive:cont-scan-start',
  ARCHIVE_CONT_SCAN_RESULT: 'archive:cont-scan-result',
  ARCHIVE_CONT_SCAN_ERROR: 'archive:cont-scan-error',
  // Beta 3 M23: a continuity item was resolved/ignored (from the Continuity
  // panel or a manuscript comment's agent actions) — keeps both surfaces live.
  ARCHIVE_CONT_ITEM_RESOLVED: 'archive:cont-item-resolved',

  // SKY-1758: Scene Crafter board IPC
  SCENE_CRAFTER_GET_BOARD: 'scene-crafter:get-board',
  SCENE_CRAFTER_CREATE_BOARD: 'scene-crafter:create-board',
  SCENE_CRAFTER_ADD_CARD: 'scene-crafter:add-card',
  SCENE_CRAFTER_MOVE_CARD: 'scene-crafter:move-card',
  SCENE_CRAFTER_TOGGLE_CARD_DONE: 'scene-crafter:toggle-card-done',
  SCENE_CRAFTER_DELETE_CARD: 'scene-crafter:delete-card',
  SCENE_CRAFTER_ADD_LANE: 'scene-crafter:add-lane',
  SCENE_CRAFTER_RENAME_LANE: 'scene-crafter:rename-lane',
  SCENE_CRAFTER_DELETE_LANE: 'scene-crafter:delete-lane',
  SCENE_CRAFTER_REORDER_LANES: 'scene-crafter:reorder-lanes',
  SCENE_CRAFTER_SAVE_BOARD: 'scene-crafter:save-board',

  // SKY-1759: Scene Crafter file-watcher conflict detection
  SCENE_CRAFTER_CLOSE: 'scene-crafter:close',
  // Push event (main → renderer): external edit detected on board.md
  SCENE_CRAFTER_EXTERNAL_EDIT: 'scene-crafter:external-edit',

  // SKY-1764: Brainstorm → Scene Crafter suggestion accept/reject
  SCENE_CRAFTER_SUGGESTION_ACCEPT: 'scene-crafter:suggestion-accept',
  SCENE_CRAFTER_SUGGESTION_REJECT: 'scene-crafter:suggestion-reject',

  // SKY-2011: Continuity Peek — entity matching, search, and read
  CONTINUITY_MATCH_SELECTION: 'continuity:matchSelection',
  CONTINUITY_SEARCH: 'continuity:search',
  CONTINUITY_READ_ENTITY: 'continuity:readEntity',

  // SKY-2308: Vault manifest integrity check + orphan detection
  VAULT_CHECK_INTEGRITY: 'vault:check-integrity',
  VAULT_REBUILD_MANIFEST: 'vault:rebuild-manifest',

  // SKY-3026: Outline planning surface
  OUTLINE_LOAD: 'outline:load',
  OUTLINE_SAVE: 'outline:save',

  // SKY-3033: Window chrome controls (frameless main window)
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // SKY-6225: Built-in Auto Note Linker (deterministic, trie-based)
  AUTO_LINKER_GET_SETTINGS: 'auto-linker:get-settings',
  AUTO_LINKER_SET_SETTINGS: 'auto-linker:set-settings',
  AUTO_LINKER_FORMAT_VAULT_NOW: 'auto-linker:format-vault-now',
  AUTO_LINKER_REBUILD_INDEX: 'auto-linker:rebuild-index',

  // SKY-6228: M15 — agent chat sessions (vault-file backed, M5 format)
  AGENT_SESSION_LIST: 'agentSession:list',
  AGENT_SESSION_READ: 'agentSession:read',
  AGENT_SESSION_CREATE: 'agentSession:create',
  AGENT_SESSION_RENAME: 'agentSession:rename',
  AGENT_SESSION_DUPLICATE: 'agentSession:duplicate',
  AGENT_SESSION_DELETE: 'agentSession:delete',
  AGENT_SESSION_APPEND_TURNS: 'agentSession:appendTurns',
} as const;

// ─── Sender-frame guard (MYT-791) ───
// Defense-in-depth: reject IPC messages whose origin is not the top-level
// renderer frame. With contextIsolation on and nodeIntegration off the
// practical exposure today is low, but this blocks future preview iframes,
// embedded help panes, or third-party WebViews from invoking any IPC channel.

export interface IpcUntrustedFrameRejection {
  /** Generic user-facing message — never includes frame URLs or origins. */
  error: string;
  category: 'untrusted_frame';
}

export const UNTRUSTED_FRAME_REJECTION: IpcUntrustedFrameRejection = {
  error: 'IPC request rejected: not from the top-level renderer frame.',
  category: 'untrusted_frame',
};

/**
 * Returns true when `event.senderFrame` is the top-level frame. Designed for
 * both `ipcMain.handle` (IpcMainInvokeEvent) and `ipcMain.on` (IpcMainEvent),
 * which both expose `senderFrame`. Returns false when senderFrame is null
 * (frame already destroyed) or originates from a nested frame.
 */
export function isFromTopFrame(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = event.senderFrame;
  return !!frame && frame === frame.top;
}

const ENVELOPED_IPC_CHANNELS = new Set<string>([
  IPC_CHANNELS.SETTINGS_GET,
  IPC_CHANNELS.SETTINGS_SET,
  IPC_CHANNELS.SETTINGS_TEST_CONNECTION,
]);

function untrustedFrameEnvelope(): IpcEnvelope<never> {
  return {
    ok: false,
    code: IPC_ERROR_CATEGORIES.PERMISSION_DENIED,
    message: UNTRUSTED_FRAME_REJECTION.error,
  };
}

// ─── Main process handlers ───
// Each handler: receive request → process → send response via IPC

export function setupIpcMain(handlers: IpcHandlers) {
  for (const [channel, handler] of Object.entries(handlers)) {
    const returnsEnvelope = ENVELOPED_IPC_CHANNELS.has(channel);
    const loggedHandler = returnsEnvelope
      ? withIpcLog(channel, (payload: unknown) => handler(payload as never))
      : null;
    // `await` is required so async rejections are caught here and sanitized
    // before they reach the renderer. Previously thrown fs errors (ENOENT,
    // EACCES) leaked absolute paths via `(error as Error).message`. (MYT-790)
    ipcMain.handle(channel, async (event, payload) => {
      if (!isFromTopFrame(event)) return returnsEnvelope ? untrustedFrameEnvelope() : UNTRUSTED_FRAME_REJECTION;
      if (loggedHandler) return loggedHandler(payload);
      try {
        return await handler(payload);
      } catch (error) {
        return sanitizeIpcError(channel, error);
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
  [IPC_CHANNELS.VAULT_REVEAL_FOLDER]: (payload: never) => Promise<VaultRevealFolderResponse>;
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
  [IPC_CHANNELS.SNAPSHOT_DELETE]: (payload: SnapshotDeletePayload) => SnapshotDeleteResponse;
  [IPC_CHANNELS.SNAPSHOT_DELETE_ALL]: (payload: SnapshotDeleteAllPayload) => SnapshotDeleteAllResponse;
  [IPC_CHANNELS.VERSION_LIST]: (payload: VersionListPayload) => VersionListResponse;
  [IPC_CHANNELS.VERSION_GET]: (payload: VersionGetPayload) => VersionGetResponse;
  [IPC_CHANNELS.VERSION_ROLLBACK]: (payload: VersionRollbackPayload) => VersionRollbackResponse;
  [IPC_CHANNELS.VERSION_SAVE]: (payload: VersionSavePayload) => VersionSaveResponse;
  [IPC_CHANNELS.MIGRATION_DRY_RUN]: (payload: MigrationDryRunPayload) => MigrationDryRunResponse;
  [IPC_CHANNELS.MIGRATION_APPLY]: (payload: MigrationApplyPayload) => MigrationApplyResponse;
  [IPC_CHANNELS.MYTHOS_MIGRATION_STATUS]: (payload: never) => MythosMigrationStatusResponse;
  [IPC_CHANNELS.MYTHOS_MIGRATION_PLAN]: (payload: never) => MythosMigrationPlanResponse;
  [IPC_CHANNELS.MYTHOS_MIGRATION_RUN]: (payload: never) => MythosMigrationRunResponse;
  [IPC_CHANNELS.MYTHOS_MIGRATION_CONFIRM]: (payload: never) => Promise<MythosMigrationConfirmResponse>;
  [IPC_CHANNELS.MYTHOS_MIGRATION_DISMISS]: (payload: never) => MythosMigrationDismissResponse;
  [IPC_CHANNELS.ENTITY_CREATE]: (payload: EntityCreatePayload) => EntityEntry;
  [IPC_CHANNELS.ENTITY_READ]: (payload: EntityReadPayload) => EntityEntry | null;
  [IPC_CHANNELS.ENTITY_UPDATE]: (payload: EntityUpdatePayload) => EntityEntry;
  [IPC_CHANNELS.ENTITY_DELETE]: (payload: EntityDeletePayload) => EntityDeleteResponse;
  [IPC_CHANNELS.ENTITY_LIST]: (payload: EntityListPayload) => EntityListResponse;
  [IPC_CHANNELS.ENTITY_BACKLINKS]: (payload: EntityBacklinksPayload) => EntityBacklinksResponse;
  [IPC_CHANNELS.ENTITY_RELATIONSHIPS_LIST]: (payload: EntityRelationshipsListPayload) => EntityRelationshipsListResponse;
  [IPC_CHANNELS.ENTITY_RELATIONSHIPS_CREATE]: (payload: EntityRelationshipsCreatePayload) => EntityRelationshipsCreateResponse;
  [IPC_CHANNELS.ENTITY_RELATIONSHIPS_DELETE]: (payload: EntityRelationshipsDeletePayload) => { deleted: boolean };
  [IPC_CHANNELS.SETTINGS_GET]: (payload: never) => AppSettings;
  [IPC_CHANNELS.SETTINGS_SET]: (payload: SettingsSetPayload) => SettingsSetResponse;
  [IPC_CHANNELS.SETTINGS_TEST_CONNECTION]: (payload: SettingsTestConnectionPayload) => Promise<SettingsTestConnectionResponse>;
  [IPC_CHANNELS.SUGGESTIONS_LIST]: (payload: SuggestionsListPayload) => SuggestionsListResponse;
  [IPC_CHANNELS.SUGGESTIONS_GET]: (payload: SuggestionsGetPayload) => SuggestionsGetResponse;
  [IPC_CHANNELS.SUGGESTIONS_UPSERT]: (payload: SuggestionsUpsertPayload) => SuggestionsUpsertResponse;
  [IPC_CHANNELS.SUGGESTIONS_ACCEPT]: (payload: SuggestionsAcceptPayload) => SuggestionsAcceptResponse;
  [IPC_CHANNELS.SUGGESTIONS_APPLY]: (payload: SuggestionsApplyPayload) => SuggestionsApplyResponse;
  [IPC_CHANNELS.SUGGESTIONS_REJECT]: (payload: SuggestionsRejectPayload) => SuggestionsRejectResponse;
  [IPC_CHANNELS.SUGGESTIONS_ROLLBACK]: (payload: SuggestionsRollbackPayload) => SuggestionsRollbackResponse;
  [IPC_CHANNELS.SUGGESTIONS_SEARCH]: (payload: SuggestionsSearchPayload) => SuggestionsSearchResponse;
  [IPC_CHANNELS.SUGGESTIONS_IGNORE]: (payload: SuggestionsIgnorePayload) => SuggestionsIgnoreResponse;
  [IPC_CHANNELS.SUGGESTIONS_BATCH_ACTION]: (payload: SuggestionsBatchActionPayload) => SuggestionsBatchActionResponse;
  [IPC_CHANNELS.SUGGESTIONS_UNIFIED_LIST]: (payload: SuggestionsUnifiedListPayload) => SuggestionsUnifiedListResponse;
  [IPC_CHANNELS.AUDIT_LIST]: (payload: AuditListPayload) => AuditListResponse;
  [IPC_CHANNELS.PROVENANCE_UPSERT]: (payload: ProvenanceUpsertPayload) => ProvenanceUpsertResponse;
  [IPC_CHANNELS.TIMELINE_LIST]: (payload: TimelineListPayload) => TimelineListResponse;
  [IPC_CHANNELS.TIMELINE_UPSERT]: (payload: TimelineUpsertPayload) => TimelineUpsertResponse;
  [IPC_CHANNELS.GENERATION_LOG_RECENT]: (payload: GenerationLogRecentPayload) => GenerationLogRecentResponse;
  [IPC_CHANNELS.GENERATION_LOG_LIST]: (payload: GenerationLogListPayload) => GenerationLogListResponse;
  [IPC_CHANNELS.GENERATION_LOG_GET]: (payload: GenerationLogGetPayload) => GenerationLogGetResponse;
  [IPC_CHANNELS.WRITING_ASSISTANT_CADENCE_CHANGE]: (payload: WritingAssistantCadenceChangePayload) => WritingAssistantCadenceChangeResponse;
  [IPC_CHANNELS.WRITING_ASSISTANT_TIP_DECISION]: (payload: WritingAssistantTipDecisionPayload) => WritingAssistantTipDecisionResponse;
  [IPC_CHANNELS.WRITING_ASSISTANT_SUGGESTION_LIST]: (payload: WritingAssistantSuggestionListPayload) => WritingAssistantSuggestionListResponse;
  [IPC_CHANNELS.WRITING_ASSISTANT_SCAN_NOW]: (payload: WritingScanPayload) => Promise<WritingScanResponse>;
  [IPC_CHANNELS.ARCHIVE_SCAN]: (payload: ArchiveScanPayload) => ArchiveScanResponse;
  [IPC_CHANNELS.ARCHIVE_STATUS]: (payload: never) => ArchiveStatusResponse;
  [IPC_CHANNELS.VAULT_GRAPH_DATA]: (payload: never) => Promise<VaultGraphDataResponse>;
  // SKY-1756: Notes Vault graph — in-memory link index with degree + category
  [IPC_CHANNELS.VAULT_GRAPH_NODES]: (payload: VaultGraphScopePayload | VaultGraphScope | undefined) => VaultGraphNodesResponse;
  [IPC_CHANNELS.VAULT_GRAPH_EDGES]: (payload: VaultGraphScopePayload | VaultGraphScope | undefined) => VaultGraphEdgesResponse;
  [IPC_CHANNELS.CHAPTER_CREATE]: (payload: ChapterCreatePayload) => ChapterEntry;
  [IPC_CHANNELS.SCENE_CREATE]: (payload: SceneCreatePayload) => SceneEntry;
  [IPC_CHANNELS.CHAPTER_LIST]: (payload: ChapterListPayload) => ChapterListResponse;
  [IPC_CHANNELS.CHAPTER_GET]: (payload: ChapterGetPayload) => ChapterGetResponse;
  [IPC_CHANNELS.CHAPTER_SAVE]: (payload: ChapterSavePayload) => ChapterSaveResponse;
  [IPC_CHANNELS.SCENE_LIST]: (payload: SceneListPayload) => SceneListResponse;
  [IPC_CHANNELS.SCENE_GET]: (payload: SceneGetPayload) => SceneGetResponse;
  [IPC_CHANNELS.SCENE_SAVE]: (payload: SceneSavePayload) => SceneSaveResponse;
  [IPC_CHANNELS.SCENE_RENAME]: (payload: SceneRenamePayload) => SceneRenameResponse;
  [IPC_CHANNELS.SCENE_APPEND_BRAINSTORM_NOTE]: (payload: SceneAppendBrainstormNotePayload) => SceneAppendBrainstormNoteResponse;
  [IPC_CHANNELS.SEARCH_QUERY]: (payload: SearchQueryPayload) => SearchQueryResponse;
  [IPC_CHANNELS.BETA_READ_CREATE]: (payload: BetaReadCreatePayload) => BetaReadCreateResponse;
  [IPC_CHANNELS.BETA_READ_LIST]: (payload: BetaReadListPayload) => BetaReadListResponse;
  [IPC_CHANNELS.BETA_READ_DISMISS]: (payload: BetaReadDismissPayload) => BetaReadDismissResponse;
  // BETA_READ_SCAN is registered manually in main.ts (async LLM handler — not via setupIpcMain)
  [IPC_CHANNELS.EXPORT_EPUB]: (payload: ExportEpubPayload) => Promise<ExportEpubResponse>;
  [IPC_CHANNELS.EXPORT_DOCX]: (payload: ExportDocxPayload) => Promise<ExportDocxResponse>;
  [IPC_CHANNELS.EXPORT_MARKDOWN]: (payload: ExportMarkdownPayload) => Promise<ExportMarkdownResponse>;
  [IPC_CHANNELS.EXPORT_PLAINTEXT]: (payload: ExportPlaintextPayload) => Promise<ExportPlaintextResponse>;
  [IPC_CHANNELS.EXPORT_PDF]: (payload: ExportPdfPayload) => Promise<ExportPdfResponse>;
  [IPC_CHANNELS.EXPORT_REVEAL_LAST]: (payload: never) => Promise<ExportRevealLastResponse>;
  [IPC_CHANNELS.VAULT_OBSIDIAN_DRY_RUN]: (payload: VaultObsidianDryRunPayload) => Promise<VaultObsidianDryRunReport | RegistrationTokenError>;
  [IPC_CHANNELS.VAULT_OBSIDIAN_REGISTER]: (payload: VaultObsidianRegisterPayload) => Promise<VaultObsidianRegisterResponse | RegistrationTokenError>;
  // Beta 3 M24 — settings vault/story import
  [IPC_CHANNELS.VAULT_IMPORT_SCAN]: (payload: VaultImportScanPayload) => Promise<VaultImportScanResponse>;
  [IPC_CHANNELS.VAULT_IMPORT_RUN]: (payload: VaultImportRunPayload) => Promise<VaultImportRunResponse>;
  [IPC_CHANNELS.STORY_IMPORT_PICK]: (payload: StoryImportPickPayload) => Promise<StoryImportPickResponse>;
  [IPC_CHANNELS.STORY_IMPORT_RUN]: (payload: StoryImportRunPayload) => Promise<StoryImportRunResponse>;
  [IPC_CHANNELS.VAULT_PICK_FOLDER]: (payload: never) => Promise<VaultPickFolderResponse>;
  [IPC_CHANNELS.VOICE_PICK_BINARY]: (payload: VoicePickBinaryPayload) => Promise<VoicePickBinaryResponse>;
  [IPC_CHANNELS.VAULT_LOAD_SAMPLE]: (payload: VaultLoadSamplePayload) => Promise<VaultLoadSampleResponse | RegistrationTokenError>;
  [IPC_CHANNELS.VAULT_CREATE_BLANK]: (payload: VaultCreateBlankPayload) => Promise<VaultCreateBlankResponse | RegistrationTokenError>;
  [IPC_CHANNELS.VAULT_VALIDATE_PATH]: (payload: VaultValidatePathPayload) => Promise<VaultValidatePathResponse>;
  [IPC_CHANNELS.VAULT_PICK_FOLDER_BY_PATH]: (payload: VaultPickFolderByPathPayload) => Promise<VaultPickFolderResponse>;
  [IPC_CHANNELS.TIMELINE_INFER]: (payload: TimelineInferPayload) => TimelineInferResponse;
  // APP_CHECK_FOR_UPDATE and APP_INSTALL_UPDATE are registered directly in initAutoUpdater()
  // (async handlers — not routed through setupIpcMain)
  [IPC_CHANNELS.SETTINGS_GET_AGENT_CONFIG]: (payload: never) => AgentConfigMap;
  [IPC_CHANNELS.SETTINGS_SET_AGENT_CONFIG]: (payload: SetAgentConfigPayload) => SetAgentConfigResponse;
  [IPC_CHANNELS.TELEMETRY_REPORT]: (payload: TelemetryReportPayload) => TelemetryReportResponse;
  [IPC_CHANNELS.PROJECT_LIST]: (payload: never) => ProjectListResponse;
  [IPC_CHANNELS.PROJECT_SWITCH]: (payload: ProjectSwitchPayload) => Promise<ProjectSwitchResponse>;
  [IPC_CHANNELS.PROJECT_STATS]: (payload: never) => ProjectStatsResponse;
  [IPC_CHANNELS.ARCHIVE_CONFIRM]: (payload: ArchiveConfirmPayload) => ArchiveConfirmResponse;
  [IPC_CHANNELS.ARCHIVE_IGNORE_LIST]: (payload: never) => ArchiveIgnoreListResponse;
  [IPC_CHANNELS.ARCHIVE_SCAN_LINKS]: (payload: ArchiveScanLinksPayload) => ArchiveScanLinksResponse;
  [IPC_CHANNELS.ARCHIVE_ACCEPT_LINK]: (payload: ArchiveAcceptLinkPayload) => ArchiveAcceptLinkResponse;
  [IPC_CHANNELS.ARCHIVE_REJECT_LINK]: (payload: ArchiveRejectLinkPayload) => ArchiveRejectLinkResponse;
  [IPC_CHANNELS.BG_PICK]: (payload: never) => Promise<BgPickResponse>;
  [IPC_CHANNELS.BG_LOAD]: (payload: BgLoadPayload) => Promise<BgLoadResponse>;
  [IPC_CHANNELS.VAULT_GET_PATHS]: (payload: never) => VaultGetPathsResponse;
  [IPC_CHANNELS.VAULT_GET_SYSTEM_PATHS]: (payload: never) => VaultGetSystemPathsResponse;
  [IPC_CHANNELS.VAULT_DETECT_LEGACY]: (payload: never) => VaultDetectLegacyResponse;
  [IPC_CHANNELS.VAULT_SET_PATHS]: (payload: VaultSetPathsPayload) => VaultSetPathsResponse;
  [IPC_CHANNELS.NOTES_VAULT_READ]: (payload: VaultReadPayload) => VaultReadResponse;
  [IPC_CHANNELS.NOTES_VAULT_WRITE]: (payload: VaultWritePayload) => VaultWriteResponse;
  [IPC_CHANNELS.NOTES_VAULT_LIST]: (payload: VaultListPayload) => VaultListResponse;
  [IPC_CHANNELS.NOTES_VAULT_DELETE]: (payload: VaultDeletePayload) => VaultDeleteResponse;
  [IPC_CHANNELS.NOTES_VAULT_MOVE]: (payload: VaultMovePayload) => VaultMoveResponse;
  [IPC_CHANNELS.NOTES_VAULT_MKDIR]: (payload: VaultMkdirPayload) => VaultMkdirResponse;
  [IPC_CHANNELS.VAULT_MOVE]: (payload: VaultMovePayload) => VaultMoveResponse;
  [IPC_CHANNELS.VAULT_GUIDED_FOLDER_MOVE]: (payload: VaultGuidedMovePayload) => Promise<VaultGuidedMoveResponse | { error: string }>;
  [IPC_CHANNELS.VAULT_CHOOSE_FOLDER]: (payload: VaultChooseFolderPayload) => Promise<VaultChooseFolderResponse>;
  [IPC_CHANNELS.AGENT_BUDGET_USAGE]: (payload: never) => AgentBudgetUsageResponse;
  [IPC_CHANNELS.WRITING_MODE_GET]: (payload: never) => WritingModeState;
  [IPC_CHANNELS.WRITING_MODE_SET]: (payload: WritingModeSetPayload) => WritingModeState;
  [IPC_CHANNELS.APP_BACKUP_APP_DATA]: (payload: BackupAppDataPayload) => Promise<BackupAppDataResponse>;
  [IPC_CHANNELS.APP_RESTORE_APP_DATA]: (payload: RestoreAppDataPayload) => Promise<RestoreAppDataResponse>;
  // SKY-2969: uninstaller vault-cleanup choice
  [IPC_CHANNELS.APP_CLEAN_UNINSTALL]: (payload: never) => Promise<CleanUninstallResponse>;
  [IPC_CHANNELS.BRAINSTORM_GET_SETTINGS]: (payload: never) => BrainstormGetSettingsResponse;
  [IPC_CHANNELS.BRAINSTORM_WRITE_NOTE]: (payload: BrainstormWriteNotePayload) => BrainstormWriteNoteResponse;
  [IPC_CHANNELS.BRAINSTORM_RESOLVE_ROUTING]: (payload: BrainstormResolveRoutingPayload) => BrainstormResolveRoutingResponse;
  [IPC_CHANNELS.BRAINSTORM_RESET_CATEGORY_ROUTING]: (payload: BrainstormResetCategoryRoutingPayload) => BrainstormResetCategoryRoutingResponse;
  [IPC_CHANNELS.BRAINSTORM_LIST_NOTES_FOLDERS]: (payload: never) => BrainstormListNotesFoldersResponse;
  [IPC_CHANNELS.BRAINSTORM_SELECT_CONTEXT]: (payload: BrainstormSelectContextPayload) => BrainstormSelectContextResponse;
  // SKY-12 onboarding channels
  [IPC_CHANNELS.VAULT_LOAD_SAMPLE_TWO_VAULT]: (payload: VaultLoadSampleTwoVaultPayload) => Promise<VaultLoadSampleTwoVaultResponse>;
  // SKY-627: extended payload — orchestrates vault creation + first-scene setup
  [IPC_CHANNELS.ONBOARDING_COMPLETE]: (payload: OnboardingCompletePayload) => Promise<OnboardingCompleteResponse>;
  [IPC_CHANNELS.ONBOARDING_RESET]: (payload: never) => { ok: true };
  // SKY-2971: .docx importer
  [IPC_CHANNELS.ONBOARDING_IMPORT_DOCX]: (payload: OnboardingImportDocxPayload) => Promise<OnboardingImportDocxResponse>;
  // SKY-2993: Obsidian vault importer
  [IPC_CHANNELS.ONBOARDING_IMPORT_OBSIDIAN]: (payload: OnboardingImportObsidianPayload) => Promise<OnboardingImportObsidianResponse>;
  [IPC_CHANNELS.ONBOARDING_DRY_RUN_OBSIDIAN]: (payload: OnboardingDryRunObsidianPayload) => Promise<OnboardingDryRunObsidianResponse>;
  // SKY-2991: onboarding v2 path validation + vault discovery
  [IPC_CHANNELS.ONBOARDING_VALIDATE_PATH]: (payload: OnboardingValidatePathPayload) => OnboardingValidatePathResponse;
  [IPC_CHANNELS.ONBOARDING_GET_SUGGESTED_PATHS]: (payload: never) => OnboardingGetSuggestedPathsResponse;
  [IPC_CHANNELS.ONBOARDING_OPEN_EXISTING_VAULT]: (payload: OnboardingOpenExistingVaultPayload) => OnboardingOpenExistingVaultResponse;
  [IPC_CHANNELS.ONBOARDING_DETECT_MYTHOS_VAULT]: (payload: OnboardingDetectMythosVaultPayload) => OnboardingDetectMythosVaultResponse;
  // SKY-2638: Path 3 import channels
  [IPC_CHANNELS.ONBOARDING_IMPORT_DRY_RUN]: (payload: OnboardingImportDryRunPayload) => Promise<VaultObsidianDryRunReport>;
  [IPC_CHANNELS.ONBOARDING_IMPORT_COMMIT]: (payload: OnboardingImportCommitPayload) => Promise<OnboardingImportCommitResponse>;
  // SKY-130: session persistence
  [IPC_CHANNELS.SESSION_SCENE_SAVE]: (payload: SessionSaveScenePayload) => { saved: boolean };
  // SKY-156: Project Templates
  [IPC_CHANNELS.TEMPLATE_LIST]: (payload: never) => TemplateListResponse;
  [IPC_CHANNELS.TEMPLATE_SCAFFOLD]: (payload: TemplateScaffoldPayload) => Promise<TemplateScaffoldResponse | { error: string }>;
  [IPC_CHANNELS.TEMPLATE_SAVE_AS]: (payload: TemplateSaveAsPayload) => TemplateSaveAsResponse | { error: string };
  // SKY-190: Note Templates
  [IPC_CHANNELS.NOTE_TEMPLATE_LIST]: (payload: NoteTemplateListPayload) => NoteTemplateListResponse;
  // SKY-204: Daily Notes
  [IPC_CHANNELS.DAILY_NOTE_OPEN_TODAY]: (payload: never) => DailyNoteOpenTodayResponse;
  [IPC_CHANNELS.DAILY_NOTE_GET_STREAK]: (payload: never) => DailyNoteGetStreakResponse;
  // SKY-193: Tag Wrangler
  [IPC_CHANNELS.NOTES_TAG_LIST]: (payload: never) => NotesTagListResponse;
  [IPC_CHANNELS.NOTES_TAG_RENAME]: (payload: NotesTagRenamePayload) => NotesTagRenameResponse;
  [IPC_CHANNELS.NOTES_TAG_MERGE]: (payload: NotesTagMergePayload) => NotesTagMergeResponse;

  // SKY-55: per-scene notes
  [IPC_CHANNELS.NOTES_GET]: (payload: NotesGetPayload) => NotesGetResponse;
  [IPC_CHANNELS.NOTES_SET]: (payload: NotesSetPayload) => NotesSetResponse;

  // SKY-158: Tag & cross-reference system
  [IPC_CHANNELS.TAGS_LIST]: (payload: never) => TagsListResponse;
  [IPC_CHANNELS.TAGS_UPSERT]: (payload: TagsUpsertPayload) => TagsUpsertResponse;
  [IPC_CHANNELS.TAGS_DELETE]: (payload: TagsDeletePayload) => TagsDeleteResponse;
  [IPC_CHANNELS.TAGS_RENAME]: (payload: TagsRenamePayload) => TagsRenameResponse;
  [IPC_CHANNELS.TAGS_FOR_ITEM]: (payload: TagsForItemPayload) => TagsForItemResponse;
  [IPC_CHANNELS.TAGS_SET_FOR_ITEM]: (payload: TagsSetForItemPayload) => TagsSetForItemResponse;
  [IPC_CHANNELS.TAGS_ITEMS_FOR_TAG]: (payload: TagsItemsForTagPayload) => TagsItemsForTagResponse;
  [IPC_CHANNELS.TAGS_BULK_APPLY]: (payload: TagsBulkApplyPayload) => TagsBulkApplyResponse;
  [IPC_CHANNELS.SCENE_SET_TAGS]: (payload: SceneSetTagsPayload) => SceneSetTagsResponse;

  // SKY-154: Writing Goals
  [IPC_CHANNELS.GOALS_LOG_WORDS]: (payload: GoalsLogWordsPayload) => GoalsLogWordsResponse;
  [IPC_CHANNELS.GOALS_GET_STATS]: (payload: never) => GoalsGetStatsResponse;
  [IPC_CHANNELS.GOALS_SET_GOAL]: (payload: GoalsSetGoalPayload) => GoalsSetGoalResponse;
  [IPC_CHANNELS.GOALS_RESET_STREAK]: (payload: never) => GoalsResetStreakResponse;

  // SKY-170: Scene-to-entity links
  [IPC_CHANNELS.SCENE_ENTITY_LINKS_LIST]: (payload: SceneEntityLinksListPayload) => SceneEntityLinksListResponse;
  [IPC_CHANNELS.SCENE_ENTITY_LINKS_UPSERT]: (payload: SceneEntityLinksUpsertPayload) => SceneEntityLinksUpsertResponse;
  [IPC_CHANNELS.SCENE_ENTITY_LINKS_DELETE]: (payload: SceneEntityLinksDeletePayload) => void;
  [IPC_CHANNELS.ENTITY_LINKED_SCENES]: (payload: EntityLinkedScenesPayload) => EntityLinkedScenesResponse;

  // SKY-203: Note-level backlinks
  [IPC_CHANNELS.NOTE_BACKLINKS]: (payload: NoteBacklinksPayload) => NoteBacklinksResponse;

  // SKY-194: Iconize — per-node icon IPC
  [IPC_CHANNELS.NOTES_VAULT_READ_ICONS]: (payload: never) => Record<string, string>;
  [IPC_CHANNELS.VAULT_READ_ICONS]: (payload: never) => Record<string, string>;
  [IPC_CHANNELS.ICONS_LIST_USER_PACKS]: (payload: never) => { packName: string; icons: string[] }[];
  [IPC_CHANNELS.ICONS_READ_SVG]: (payload: { packName: string; iconName: string }) => { svg: string | null };

  // SKY-205: Smart Folders
  [IPC_CHANNELS.SMART_FOLDER_LIST]: (payload: never) => { smartFolders: SmartFolderEntry[] };
  [IPC_CHANNELS.SMART_FOLDER_CREATE]: (payload: { name: string; query: string }) => { smartFolder: SmartFolderEntry };
  [IPC_CHANNELS.SMART_FOLDER_UPDATE]: (payload: { id: string; name?: string; query?: string }) => { smartFolder: SmartFolderEntry };
  [IPC_CHANNELS.SMART_FOLDER_DELETE]: (payload: { id: string }) => { success: boolean };
  [IPC_CHANNELS.SMART_FOLDER_QUERY]: (payload: { query: string }) => { results: SmartFolderResult[] };

  // SKY-207: Per-scene custom frontmatter fields
  [IPC_CHANNELS.CUSTOM_FIELDS_LIST]: (payload: never) => { fields: CustomFieldDef[] };
  [IPC_CHANNELS.CUSTOM_FIELDS_SET]: (payload: { fields: CustomFieldDef[] }) => { fields: CustomFieldDef[] };
  [IPC_CHANNELS.SCENE_PROPS_GET]: (payload: { sceneId: string }) => { customFields: Record<string, unknown> };
  [IPC_CHANNELS.SCENE_PROPS_SET]: (payload: { sceneId: string; customFields: Record<string, unknown> }) => { ok: boolean };

  // SKY-320: one-click Mythos Vault create
  [IPC_CHANNELS.VAULT_CREATE_DEFAULT_MYTHOS]: (payload: CreateDefaultMythosVaultPayload) => Promise<CreateDefaultMythosVaultResponse>;

  // SKY-445/SKY-458: Continuity drift check
  [IPC_CHANNELS.CONTINUITY_CHECK]: (payload: ContinuityCheckPayload) => ContinuityCheckResponse;

  // SKY-791: Timeline data model + settings
  [IPC_CHANNELS.TIMELINE_GET_SETTINGS]: (payload: TimelineGetSettingsPayload) => TimelineGetSettingsResponse;
  [IPC_CHANNELS.TIMELINE_SAVE_SETTINGS]: (payload: TimelineSaveSettingsPayload) => TimelineSaveSettingsResponse;
  [IPC_CHANNELS.TIMELINE_GET_SCENES]: (payload: TimelineGetScenesPayload) => TimelineGetScenesResponse;
  [IPC_CHANNELS.TIMELINE_UPDATE_SCENE]: (payload: TimelineUpdateScenePayload) => TimelineUpdateSceneResponse;
  [IPC_CHANNELS.TIMELINE_UPDATE_ARC_COLOR]: (payload: TimelineUpdateArcColorPayload) => TimelineUpdateArcColorResponse;
  // SKY-794: Spreadsheet view — arc manifest listing
  [IPC_CHANNELS.TIMELINE_LIST_ARCS]: (payload: TimelineListArcsPayload) => TimelineListArcsResponse;
  // SKY-796: Timeline AI auto-population proposals
  [IPC_CHANNELS.TIMELINE_PROPOSALS_GENERATE]: (payload: TimelineProposalsGeneratePayload) => TimelineProposalsGenerateResponse;
  [IPC_CHANNELS.TIMELINE_PROPOSALS_LIST]: (payload: TimelineProposalsListPayload) => TimelineProposalsListResponse;
  [IPC_CHANNELS.TIMELINE_PROPOSAL_RESOLVE]: (payload: TimelineProposalResolvePayload) => TimelineProposalResolveResponse;

  // SKY-863: Cloud-sync conflict detection + lockfile
  [IPC_CHANNELS.VAULT_CHECK_CONFLICTS]: (payload: never) => Promise<VaultCheckConflictsResponse>;
  [IPC_CHANNELS.VAULT_DISMISS_SYNC_WARNING]: (payload: never) => { ok: true };
  // SKY-1399: manage custom templates
  [IPC_CHANNELS.TEMPLATE_RENAME]: (payload: TemplateRenamePayload) => TemplateRenameResponse | { error: string };
  [IPC_CHANNELS.TEMPLATE_DELETE]: (payload: TemplateDeletePayload) => TemplateDeleteResponse | { error: string };
  [IPC_CHANNELS.TEMPLATE_DUPLICATE]: (payload: TemplateDuplicatePayload) => TemplateDuplicateResponse | { error: string };
  // SKY-1403: export / import .mythostemplate files
  [IPC_CHANNELS.TEMPLATE_EXPORT]: (payload: TemplateExportPayload) => Promise<TemplateExportResponse>;
  // SKY-1405: payload.filePath allows drag-drop to bypass the open dialog
  [IPC_CHANNELS.TEMPLATE_IMPORT]: (payload: TemplateImportPayload | undefined) => Promise<TemplateImportResponse>;
  // SKY-1499/SKY-1501: provider model listing
  [IPC_CHANNELS.PROVIDER_LIST_MODELS]: (payload: ProviderListModelsPayload) => Promise<ProviderListModelsResult>;
  // SKY-1483: Wave 3.4 extraction side-call — registered via registerBrainstormExtractionHandlers(), not setupIpcMain
  [IPC_CHANNELS.BRAINSTORM_EXTRACT_PROPOSALS]?: (payload: BrainstormExtractProposalsPayload) => Promise<BrainstormExtractProposalsResponse>;
  [IPC_CHANNELS.BRAINSTORM_GET_SESSION_REJECTIONS]?: (payload: never) => BrainstormGetSessionRejectionsResponse;
  [IPC_CHANNELS.BRAINSTORM_DISMISS_ALL]?: (payload: never) => BrainstormDismissAllResponse;
  [IPC_CHANNELS.BRAINSTORM_PROPOSALS_CONFIRM]?: (payload: BrainstormProposalConfirmPayload) => { ok: true };
  [IPC_CHANNELS.BRAINSTORM_PROPOSALS_REJECT]?: (payload: BrainstormProposalRejectPayload) => { ok: true };
  // BRAINSTORM_PROPOSAL_QUEUED is a push channel (webContents.send) — no handler entry needed

  // SKY-1611: SQLite-backed versioned draft snapshots
  [IPC_CHANNELS.DRAFTS_CREATE]: (payload: DraftsCreatePayload) => DraftsCreateResponse;
  [IPC_CHANNELS.DRAFTS_LIST]: (payload: DraftsListPayload) => DraftsListResponse;
  [IPC_CHANNELS.DRAFTS_PREVIEW]: (payload: DraftsPreviewPayload) => DraftsPreviewResponse;
  [IPC_CHANNELS.DRAFTS_RESTORE]: (payload: DraftsRestorePayload) => DraftsRestoreResponse;
  [IPC_CHANNELS.DRAFTS_LABEL]: (payload: DraftsLabelPayload) => void;
  [IPC_CHANNELS.DRAFTS_DELETE]: (payload: DraftsDeletePayload) => void;

  // SKY-1758: Scene Crafter board IPC
  [IPC_CHANNELS.SCENE_CRAFTER_GET_BOARD]: (payload: SceneCrafterGetBoardPayload) => SceneCrafterBoard | null;
  [IPC_CHANNELS.SCENE_CRAFTER_CREATE_BOARD]: (payload: SceneCrafterCreateBoardPayload) => SceneCrafterBoard;
  [IPC_CHANNELS.SCENE_CRAFTER_ADD_CARD]: (payload: SceneCrafterAddCardPayload) => { ok: true };
  [IPC_CHANNELS.SCENE_CRAFTER_MOVE_CARD]: (payload: SceneCrafterMoveCardPayload) => { ok: true };
  [IPC_CHANNELS.SCENE_CRAFTER_TOGGLE_CARD_DONE]: (payload: SceneCrafterToggleCardDonePayload) => { ok: true };
  [IPC_CHANNELS.SCENE_CRAFTER_DELETE_CARD]: (payload: SceneCrafterDeleteCardPayload) => { ok: true };
  [IPC_CHANNELS.SCENE_CRAFTER_ADD_LANE]: (payload: SceneCrafterAddLanePayload) => { ok: true };
  [IPC_CHANNELS.SCENE_CRAFTER_RENAME_LANE]: (payload: SceneCrafterRenameLanePayload) => { ok: true };
  [IPC_CHANNELS.SCENE_CRAFTER_DELETE_LANE]: (payload: SceneCrafterDeleteLanePayload) => { ok: boolean; cardCount: number };
  [IPC_CHANNELS.SCENE_CRAFTER_REORDER_LANES]: (payload: SceneCrafterReorderLanesPayload) => { ok: true };
  [IPC_CHANNELS.SCENE_CRAFTER_SAVE_BOARD]: (payload: SceneCrafterSaveBoardPayload) => { ok: true };

  // SKY-1759: Scene Crafter file-watcher — SCENE_CRAFTER_EXTERNAL_EDIT is a push-only
  // channel (webContents.send), so no handler entry is needed for it here.
  [IPC_CHANNELS.SCENE_CRAFTER_CLOSE]: (payload: SceneCrafterClosePayload) => Promise<void>;

  // SKY-1764: Brainstorm → Scene Crafter suggestion accept/reject
  [IPC_CHANNELS.SCENE_CRAFTER_SUGGESTION_ACCEPT]: (payload: SceneCrafterSuggestionAcceptPayload) => SceneCrafterSuggestionAcceptResponse;
  [IPC_CHANNELS.SCENE_CRAFTER_SUGGESTION_REJECT]: (payload: SceneCrafterSuggestionRejectPayload) => SceneCrafterSuggestionRejectResponse;

  // SKY-2011: Continuity Peek
  [IPC_CHANNELS.CONTINUITY_MATCH_SELECTION]: (payload: ContinuityMatchSelectionPayload) => ContinuityMatchSelectionResponse;
  [IPC_CHANNELS.CONTINUITY_SEARCH]: (payload: ContinuitySearchPayload) => ContinuitySearchResponse;
  [IPC_CHANNELS.CONTINUITY_READ_ENTITY]: (payload: ContinuityReadEntityPayload) => ContinuityReadEntityResponse;

  // SKY-2308: Vault integrity check + manifest rebuild
  [IPC_CHANNELS.VAULT_CHECK_INTEGRITY]: (payload: never) => Promise<VaultIntegrityReport>;
  [IPC_CHANNELS.VAULT_REBUILD_MANIFEST]: (payload: never) => Promise<VaultRebuildManifestResponse>;

  // SKY-3026: Outline planning surface
  [IPC_CHANNELS.OUTLINE_LOAD]: (payload: OutlineLoadPayload) => OutlineData | null;
  [IPC_CHANNELS.OUTLINE_SAVE]: (payload: OutlineSavePayload) => OutlineSaveResponse;

  // SKY-3033: Window chrome controls (frameless main window)
  [IPC_CHANNELS.WINDOW_MINIMIZE]: (payload: never) => void;
  [IPC_CHANNELS.WINDOW_MAXIMIZE]: (payload: never) => void;
  [IPC_CHANNELS.WINDOW_CLOSE]: (payload: never) => void;

  // SKY-6225: Built-in Auto Note Linker
  [IPC_CHANNELS.AUTO_LINKER_GET_SETTINGS]: (payload: never) => Promise<import('./autoLinker/index.js').AutoLinkerSettings>;
  [IPC_CHANNELS.AUTO_LINKER_SET_SETTINGS]: (payload: import('./autoLinker/index.js').AutoLinkerSettings) => Promise<{ saved: boolean }>;
  [IPC_CHANNELS.AUTO_LINKER_FORMAT_VAULT_NOW]: (payload: never) => Promise<{ processed: number; linked: number; skipped: number }>;
  [IPC_CHANNELS.AUTO_LINKER_REBUILD_INDEX]: (payload: never) => Promise<{ count: number }>;
  // SKY-6306 M21: Multi-timeline store
  [IPC_CHANNELS.TIMELINES_GET_STORE]: (payload: TimelinesGetStorePayload) => TimelinesGetStoreResponse;
  [IPC_CHANNELS.TIMELINES_UPSERT]: (payload: TimelinesUpsertPayload) => TimelinesUpsertResponse;
  [IPC_CHANNELS.TIMELINES_SET_ACTIVE]: (payload: TimelinesSetActivePayload) => TimelinesSetActiveResponse;
  // Beta 4 M22: Axis engine item persistence
  [IPC_CHANNELS.TIMELINES_UPSERT_ITEM]: (payload: TimelinesUpsertItemPayload) => TimelinesUpsertItemResponse;
  [IPC_CHANNELS.TIMELINES_DELETE_ITEM]: (payload: TimelinesDeleteItemPayload) => TimelinesDeleteItemResponse;

  // SKY-6228: M15 — agent chat sessions
  [IPC_CHANNELS.AGENT_SESSION_LIST]: (payload: AgentSessionListPayload) => AgentSessionListResponse;
  [IPC_CHANNELS.AGENT_SESSION_READ]: (payload: AgentSessionReadPayload) => AgentSessionReadResponse;
  [IPC_CHANNELS.AGENT_SESSION_CREATE]: (payload: AgentSessionCreatePayload) => AgentSessionCreateResponse;
  [IPC_CHANNELS.AGENT_SESSION_RENAME]: (payload: AgentSessionRenamePayload) => AgentSessionRenameResponse;
  [IPC_CHANNELS.AGENT_SESSION_DUPLICATE]: (payload: AgentSessionDuplicatePayload) => AgentSessionDuplicateResponse;
  [IPC_CHANNELS.AGENT_SESSION_DELETE]: (payload: AgentSessionDeletePayload) => AgentSessionDeleteResponse;
  [IPC_CHANNELS.AGENT_SESSION_APPEND_TURNS]: (payload: AgentSessionAppendTurnsPayload) => AgentSessionAppendTurnsResponse;
  [IPC_CHANNELS.AGENT_SESSION_READ]: (payload: AgentSessionReadPayload) => AgentSessionReadResponse;
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

// ─── SKY-862: Guided-folder vault relocation (cloud sync) ───

/** Big-4 cloud-sync providers supported in Wave 2.B. */
export type CloudSyncProvider = 'icloud' | 'dropbox' | 'google-drive' | 'onedrive';

/**
 * Payload for VAULT_GUIDED_FOLDER_MOVE.
 * `sessionToken` must be a registration token issued by a main-process
 * vault:pick-folder dialog and bound to exactly `targetPath`.
 */
export interface VaultGuidedMovePayload {
  targetPath: string;
  syncProvider: CloudSyncProvider;
  sessionToken: string;
}

export interface VaultGuidedMoveResponse {
  moved: boolean;
  newVaultPath: string;
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
  /** SKY-2463: Per-scene timeline inference results. Absent on pre-timeline vaults. */
  timeline?: ManifestTimelineEntry[];
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
  /**
   * SKY-6596 (PR #932): length of this block's serialized segment within the
   * scene's `.md` body, recorded by `stripEmbeddedProseForPersist`
   * (manifest.ts) when `content` is blanked for the structure-only on-disk
   * manifest. Present only in the persisted manifest.json, and only for
   * blocks whose content serializes to a non-empty segment (see
   * sceneBody.ts). `readManifest` (vault.ts) consumes and deletes it during
   * block-aware hydration, so it never rides on IPC payloads.
   */
  bodySegLen?: number;
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

/** Response from VAULT_REVEAL_FOLDER (SKY-5790). `opened` is false when the
 * OS shell failed to open the vault root (e.g. it no longer exists). */
export interface VaultRevealFolderResponse {
  opened: boolean;
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
  /** Beta 4 M10: ISO save time when the store records one (v2 draft files). */
  savedAt?: string;
}

export interface VersionListPayload {
  sceneId: string;
}

// Beta 4 M10 — renderer-initiated snapshot into the SKY-10/M5 store (numbered
// draft files on v2 vaults, per-chapter versions/ tree on legacy vaults).
export interface VersionSavePayload {
  sceneId: string;
  content: string;
  /** Defaults to 'save'. */
  intent?: VersionIntent;
}

export interface VersionSaveResponse {
  version: SceneVersion;
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

// ─── Beta 4 M5 — MythosVault migration wizard IPC types ───
// All paths in these responses are computed MAIN-SIDE from the active vault
// settings; the renderer never supplies a path, so the wizard cannot be used
// to re-root the sandbox (contrast vault:setPaths' token gate).

export interface MythosMigrationStatusResponse {
  /** Format of the ACTIVE story vault root. */
  format: 'mythos-v2' | 'v0.4-twin-root' | 'empty';
  /** True when a v0.4 vault was detected on boot and not dismissed for it. */
  shouldPrompt: boolean;
  storyVaultRoot: string;
  notesVaultRoot: string;
  vaultName: string;
  /** Main-computed sibling folder the migration would build. */
  suggestedTarget: string;
}

export interface MythosMigrationPlanResponse {
  ok: boolean;
  error?: string;
  plan?: {
    targetRoot: string;
    vaultName: string;
    stories: number;
    chapters: number;
    scenes: number;
    noteFiles: number;
    commentFiles: number;
    betaCommentRows: number;
    versionSnapshots: number;
    fileSnapshots: number;
    dbSnapshotRows: number;
    timelineArcs: number;
    timelineSceneEntries: number;
    warnings: string[];
  };
}

export interface MythosMigrationRunResponse {
  ok: boolean;
  error?: string;
  targetRoot: string;
  counts: {
    stories: number;
    chapters: number;
    scenes: number;
    notes: number;
    comments: number;
    drafts: number;
    extras: number;
  };
  verified: {
    scenesChecked: number;
    notesChecked: number;
    mismatches: string[];
  };
}

export interface MythosMigrationConfirmResponse {
  switched: boolean;
  vaultRoot?: string;
  notesVaultRoot?: string;
  error?: string;
}

export interface MythosMigrationDismissResponse {
  dismissed: boolean;
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

export type SuggestionCategory =
  | 'punctuation'
  | 'spelling'
  | 'grammar'
  | 'sentence-structure'
  | 'style-tone'
  | 'other';

export interface AgentBudgetSettings {
  autoApply: boolean;
  confidenceThreshold: number;
  maxTokensPerHour: number;
  maxSuggestionsPerHour: number;
  heartbeatIntervalMinutes: number;
  maxTokensPerDay: number;
  /** SKY-908 — per-category auto-apply allow-list. Undefined ⇒ all enabled. */
  autoApplyCategories?: Partial<Record<SuggestionCategory, boolean>>;
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
  /**
   * @deprecated Use the active provider's apiKey via getVoiceProvider() in provider.ts.
   * Kept for backward compatibility — serves as fallback when no voice provider is configured.
   */
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
  /**
   * @deprecated Use the active provider's apiKey via getVoiceProvider() in provider.ts.
   * Kept for backward compatibility — serves as fallback when no voice provider is configured.
   */
  cloudApiKey?: string;
}

// ─── Provider settings (MYT-324) ───
// Mirrors provider.ts ProviderConfig — kept in sync manually.
export type ProviderKind = 'anthropic' | 'openai' | 'ollama' | 'lmstudio' | 'llamacpp' | 'custom';

export interface ProviderSettings {
  kind: ProviderKind;
  /** API key — required for anthropic / openai; ignored for local providers */
  apiKey?: string;
  /** Base URL override; uses provider default when omitted */
  baseUrl?: string;
  /** Default model used for all agents unless the agent overrides it */
  model: string;
  /** Optional STT/TTS capability hints — mirrors ProviderConfig.capabilities in provider.ts */
  capabilities?: { transcribe?: boolean; speak?: boolean };
}

// ─── Provider model listing (SKY-1499/SKY-1501) ───
export interface ProviderListModelsPayload {
  kind: ProviderKind;
  /** Base URL override; uses provider default when omitted. */
  baseUrl?: string;
  /** API key forwarded as Bearer token when present. Omit to use the persisted key. */
  apiKey?: string;
}

export type ProviderListModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

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

// ─── Page Appearance (SKY-2097) ───────────────────────────────────────────────

export type PageBackgroundPreset = 'liquid-neon' | 'minimal' | 'paper' | 'dark-slate';

/** Writing-surface panel appearance settings. Absent → Liquid Neon defaults (65/12/60). */
export interface PageBackgroundSettings {
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

export interface AppSettings {
  /** @deprecated Use provider.apiKey instead. Kept for backward compatibility. */
  apiKey: string;
  /** Active AI provider configuration. Defaults to Anthropic when absent. */
  provider?: ProviderSettings;
  /** Sidebar heartbeat cadence: seconds, on-save, or manual. Mirrors agents.writingAssistant.scanIntervalSeconds for numeric values. */
  waScanInterval?: number | 'on-save' | 'manual';
  /** SKY-2627: Writing Assistant enable/disable. When false, panel shows disabled state and no scans fire. */
  waEnabled?: boolean;
  /** SKY-2627: Writing Assistant model override. null = use global provider model. */
  waModel?: string | null;
  /** SKY-2627: Cadence trigger flat alias. Mirrors agents.writingAssistant.cadenceTrigger. */
  waCadenceTrigger?: 'on_save' | 'idle_heartbeat';
  /** SKY-2627: Whether idle heartbeat fires at a constant interval. Mirrors agents.writingAssistant.idleHeartbeatConstantInterval. */
  waIdleHeartbeatConstantInterval?: boolean;
  /** SKY-2627: Idle debounce seconds before triggering a scan. Mirrors agents.writingAssistant.idleDebounceSeconds. */
  waIdleDebounceSeconds?: number;
  agents: {
    /** Per-agent `provider` overrides the global provider for that agent (SKY-683). API key stored in SecretsStore under `provider.<agentName>.apiKey`. */
    writingAssistant: { enabled: boolean; model: string; scanIntervalSeconds: number; provider?: ProviderSettings; cadenceTrigger?: 'on_save' | 'idle_heartbeat'; idleHeartbeatConstantInterval?: boolean; idleDebounceSeconds?: number; } & AgentBudgetSettings;
    brainstorm: { enabled: boolean; model: string; provider?: ProviderSettings } & AgentBudgetSettings;
    archive: { enabled: boolean; model: string; continuityCheckIntervalSeconds: number; provider?: ProviderSettings; sceneCrafterSuggestions?: { enabled: boolean; cadence: number } } & AgentBudgetSettings;
    /** Beta 3 M22: the fourth named agent — reader-eye chapter reads → margin comments. Optional so pre-M22 settings files remain valid; loadAppSettings back-fills defaults. */
    betaReader?: { enabled: boolean; model: string; provider?: ProviderSettings } & AgentBudgetSettings;
  };
  /** Beta 3 M22: user renames for the four named agents (prototype `agentNames`, HTML 3245). Absent key = default display name. */
  agentNames?: Partial<Record<'writingAssistant' | 'brainstorm' | 'archive' | 'betaReader', string>>;
  theme: 'dark' | 'high-contrast';
  snapshots?: {
    maxPerScene: number;
    maxAgeDays: number;
  };
  /** SKY-1464: retention policy for per-scene versioned drafts (versions/ folders). */
  versions?: {
    maxPerScene: number;
    maxAgeDays: number;
  };
  onboardingComplete?: boolean;
  /** SKY-2220: first-upgrade legacy ~/Mythos vault recovery prompt state. */
  legacyVaultDetected?: boolean;
  legacyVaultDismissed?: boolean;
  legacyVaultPath?: string;
  /** SKY-1188: first-run path used to seed post-onboarding guidance. */
  onboardingStartMode?: 'blank' | 'sample' | 'template' | 'skip' | 'quick-start' | 'default-mythos-vault' | 'open-existing' | 'import-obsidian';
  /** Beta 3 M25: genre preset picked in the welcome wizard's guided setup (renderer-owned). */
  onboardingGenre?: string;
  /** SKY-2005: save-location recents shown by onboarding v2. Newest last, max 5. */
  recentVaultParentPaths?: string[];
  /** SKY-2005: last sample genre selected from the onboarding sample preview. */
  lastSampleGenre?: 'cozy-fantasy' | 'sci-fi-noir' | 'mystery';
  /** SKY-2553: one-time post-onboarding sample-project banner dismissal. */
  sampleProjectBannerDismissed?: boolean;
  /** SKY-1188: timestamp of first completed onboarding. */
  firstLaunchAt?: string;
  /** SKY-1188: persisted post-onboarding checklist state. */
  gettingStartedProgress?: {
    firstSeenAt?: string;
    onboardingStartMode?: 'blank' | 'sample' | 'template' | 'skip' | 'quick-start' | 'default-mythos-vault' | 'open-existing' | 'import-obsidian';
    dismissed: boolean;
    collapsed?: boolean;
    completedItems: Array<'write-scene' | 'add-character' | 'brainstorm' | 'notes-vault'>;
  };
  voice?: VoiceSettings;
  /** STT adapter config (MYT-338). Absent or enabled=false → transcription disabled. */
  stt?: SttSettings;
  /** TTS adapter config (MYT-339). Absent or enabled=false → synthesis disabled. */
  tts?: TtsSettings;
  /** SKY-818: Which provider to use for voice I/O (STT/TTS). 'global' = use global provider; agent name = use that agent's override provider. */
  voiceProviderId?: 'global' | 'writingAssistant' | 'brainstorm' | 'archive';
  /** Update channel: 'stable' = GitHub releases, 'beta' = GitHub pre-releases */
  updateChannel?: 'stable' | 'beta';
  /** Beta 3 M24 — Settings → Editor page (prototype §10). Additive; absent = defaults. */
  editorPrefs?: {
    /** Autosave snapshot cadence in seconds (5–120, default 30). */
    autosaveSeconds?: number;
    spellcheck?: boolean;
    smartQuotes?: boolean;
    /** Focus mode dims window chrome. */
    dimFocus?: boolean;
    /** Voice dictation (offline model). */
    dictation?: boolean;
  };
  /** Telemetry opt-in (MYT-344). Off by default. sessionId regenerated on disable. */
  telemetry?: {
    enabled: boolean;
    sessionId: string;
  };
  /** Liquid Neon customization overrides (MYT-613). Absent = all defaults. */
  liquidNeon?: LiquidNeonPrefs;
  /** Beta 3 Liquid Neon v2 slot engine — renderer-owned shape; main persists it opaquely. */
  liquidNeonV2?: Record<string, unknown>;
  /** Beta 4 M1: per-vault default theme — Story Vault root → preset key; renderer-owned. */
  vaultThemes?: Record<string, string>;
  /** SKY-2097 (Phase 2 #4): writing-surface panel appearance. Absent → Liquid Neon at 65/12/60. */
  pageBackground?: PageBackgroundSettings;
  /** SKY-130: last-opened scene for cross-restart restore. */
  lastOpenedScene?: LastOpenedScene;
  /** SKY-204: opt-in daily notes / journal mode. */
  journalMode?: JournalModeSettings;
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

  // SKY-6225: Built-in Auto Note Linker settings (separate from legacy autoLinker.mode)
  autoLinkerSettings?: import('./autoLinker/index.js').AutoLinkerSettings;
}

/** Archive Agent v1 — right sidebar panel descriptor (SKY-1683). */
export interface RightSidebarPanel {
  id: 'writing-assistant' | 'archive-continuity' | 'scene-preview';
  collapsed: boolean;
}

/** SKY-1697 (Wave 2c): persisted state for a floating panel window. */
export interface FloatingPanelEntry {
  panelId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  /** Sidebar to return to on dock-back. Defaults to right. */
  lastDockSidebar: 'left' | 'right';
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

/** SKY-627 / SKY-906: onboarding orchestration payload.
 *  `default-mythos-vault` (SKY-906) is the one-click first-run path: main
 *  creates `<defaultMythosVaultsParent>/<Mythos Vault>/{Story,Notes} Vault`
 *  with no user input, seeds a first scene, and marks onboarding complete in
 *  a single round-trip. */
export interface OnboardingCompletePayload {
  startMode: 'blank' | 'sample' | 'template' | 'skip' | 'quick-start' | 'default-mythos-vault' | 'open-existing' | 'import-obsidian';
  /** Required for blank / sample / template modes. Optional for default-mythos-vault
   *  (defaults to "My First Story" — a renamable seed). */
  storyTitle?: string;
  /** Optional; persisted to AppSettings.authorName. */
  authorName?: string;
  /** Parent directory for the new vault. Tilde-expanded server-side. Required for
   *  blank/sample/template; for default-mythos-vault the main side falls back to
   *  the OS-default Mythos vaults parent when this is absent. */
  vaultParentPath?: string;
  /** Required for template mode. */
  templateId?: string;
  /** Optional override for the Mythos Vault folder name (default-mythos-vault only).
   *  Rejected if it contains path separators or parent-traversal. */
  vaultName?: string;
  /** Required for sample mode (SKY-2008): identifies which bundled genre vault to
   *  install. Main-side validates against the allowlist and resolves the source dir. */
  sampleGenre?: 'cozy-fantasy' | 'sci-fi-noir' | 'mystery';
  /** SKY-2991: Custom Setup template choice. When startMode='blank', 'recommended'
   *  scaffolds the default quick-start bundle; 'blank' leaves the vault empty.
   *  Absent for all other startMode values. */
  customTemplate?: 'recommended' | 'blank';
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

/** SKY-2971: .docx → Story Vault importer IPC types. */
export interface OnboardingImportDocxPayload {
  filePaths: string[];
}

export interface ImportedDocxStory {
  filePath: string;
  storyId: string;
  storyTitle: string;
  sceneCount: number;
  firstScenePath?: string;
  firstSceneId?: string;
  warnings: string[];
}

export interface DocxImportError {
  filePath: string;
  error: string;
}

export interface OnboardingImportDocxResponse {
  ok: boolean;
  importedStories: ImportedDocxStory[];
  errors: DocxImportError[];
}

/** SKY-2993: Obsidian vault importer IPC types. */
export type ObsidianTargetVaultKind = 'notes' | 'story';

export interface OnboardingImportObsidianPayload {
  srcPath: string;
  targetVaultKind: ObsidianTargetVaultKind;
}

export interface OnboardingImportObsidianResponse {
  ok: boolean;
  targetPath?: string;
  error?: string;
}

export interface OnboardingDryRunObsidianPayload {
  srcPath: string;
  targetVaultKind: ObsidianTargetVaultKind;
}

export interface ObsidianImportPreview {
  markdownCount: number;
  attachmentCount: number;
  totalFiles: number;
  topLevelFolders: string[];
  sampleFiles: string[];
}

export interface OnboardingDryRunObsidianResponse {
  preview?: ObsidianImportPreview;
  error?: string;
  /** Number of collision files renamed with (Imported) suffix (SKY-2637) */
  renamedCount?: number;
  /** Number of notes with broken [[wiki-links]] (SKY-2637) */
  brokenLinkCount?: number;
}

// ─── SKY-2638: Path 3 import vault channels ───

export interface OnboardingImportDryRunPayload {
  sourcePath: string;
}

export interface OnboardingImportCommitPayload {
  sourcePath: string;
}

export interface OnboardingImportCommitResponse {
  ok: boolean;
  error?: string;
  /** Number of collision files renamed with (Imported) suffix (SKY-2637) */
  renamedCount?: number;
  /** Number of notes with broken [[wiki-links]] (SKY-2637) */
  brokenLinkCount?: number;
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

// Beta 4 M2 — vault-switcher popover stats (FULL-SPEC §4)

export interface ProjectStatsResponse {
  stats: Array<{
    vaultRoot: string;
    /** `.md` files under the Story Vault root. */
    storyFileCount: number;
    /** `.md` files under the paired Notes Vault root; null when unpaired. */
    noteCount: number | null;
  }>;
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

// ─── SQLite domain row types ───

export type { SuggestionStatus } from './shared/types/suggestion.js';
import type { SuggestionStatus } from './shared/types/suggestion.js';
export type SourceAgent = 'writing-assistant' | 'brainstorm' | 'archive';
export type AuditAction = 'accept' | 'apply' | 'reject' | 'rollback' | 'ignore';
export type UnifiedSuggestionKind = 'suggestion' | 'continuity-issue' | 'wiki-link';
export type UnifiedSuggestionStatus = 'proposed' | 'accepted' | 'applied' | 'rejected' | 'ignored' | 'rolled_back';
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
  /** SKY-908 — high-level category for granular auto-apply gating. */
  category: SuggestionCategory | null;
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

export interface UnifiedSuggestion {
  id: string;
  kind: UnifiedSuggestionKind;
  sourceAgent: SourceAgent | string;
  confidence: number;
  rationale: string;
  targetPath: string | null;
  targetAnchor: string | null;
  status: UnifiedSuggestionStatus;
  createdAt: string;
  appliedAt: string | null;
  budgetExceeded: boolean;
  category: string | null;
  payloadJson: string | null;
}

export interface SuggestionsListPayload {
  status?: SuggestionStatus;
  sourceAgent?: SourceAgent | string;
  confidenceMin?: number;
  confidenceMax?: number;
  limit?: number;
  offset?: number;
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

export interface SuggestionsSearchPayload {
  query: string;
  sourceAgent?: SourceAgent | string;
  status?: SuggestionStatus;
  confidenceMin?: number;
  confidenceMax?: number;
  limit?: number;
}

export interface SuggestionsSearchResponse {
  suggestions: SuggestionRow[];
  totalCount: number;
}

export interface SuggestionsIgnorePayload {
  id: string;
  actor?: string;
}

export interface SuggestionsIgnoreResponse {
  id: string;
  status: 'ignored';
}

export interface SuggestionsBatchActionPayload {
  ids: string[];
  action: 'accept' | 'reject' | 'ignore';
  actor?: string;
}

export interface SuggestionsBatchActionResponse {
  succeeded: string[];
  failed: Array<{ id: string; reason: string }>;
}

export interface SuggestionsUnifiedListPayload {
  status?: UnifiedSuggestionStatus;
  sourceAgent?: SourceAgent | string;
  kind?: UnifiedSuggestionKind;
  confidenceMin?: number;
  confidenceMax?: number;
  limit?: number;
  offset?: number;
}

export interface SuggestionsUnifiedListResponse {
  items: UnifiedSuggestion[];
  totalCount: number;
  countByAgent: Record<string, number>;
  countByKind: Record<string, number>;
}

// ─── Timeline IPC payload / response types ───

export interface TimelineListPayload {
  scenePath?: string;
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

// MYT-319: Archive Agent timeline inference
export interface TimelineInferPayload {
  /** Story ID to infer chronology for */
  storyId: string;
}

export interface TimelineInferredScene {
  sceneId: string;
  scenePath: string;
  sceneTitle: string;
  /** Story-relative day number (1–N). 0 = unresolved. */
  inferredDay: number;
  inferredTime: StoryTimeOfDay;
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

// ─── Wiki-link suggestion pipeline (SKY-1613) ───

export interface WikiLinkSuggestion {
  id: string;
  sceneId: string;
  position: number;
  entityName: string;
  entityId: string;
  proposedLink: string;
  confidence: number;
  status: 'proposed' | 'accepted' | 'rejected';
}

export interface ArchiveScanLinksPayload {
  sceneId: string;
  text: string;
}

export interface ArchiveScanLinksResponse {
  suggestions: WikiLinkSuggestion[];
}

export interface ArchiveAcceptLinkPayload {
  suggestionId: string;
}

export interface ArchiveAcceptLinkResponse {
  ok: boolean;
}

export interface ArchiveRejectLinkPayload {
  suggestionId: string;
  /** Current scene text — used to compute the suppression hash. */
  sceneText: string;
}

export interface ArchiveRejectLinkResponse {
  ok: boolean;
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

// ─── Notes Vault Graph v2 types (SKY-1756 / SKY-1743) ───
// Extends the Phase 5 story-vault graph with degree, category, and Notes Vault targeting.

export type VaultGraphCategory =
  | 'characters'
  | 'locations'
  | 'factions'
  | 'history'
  | 'systems'
  | 'items'
  | 'scenes'
  | 'misc'
  | 'default';

export type VaultGraphScope = 'notes' | 'story' | 'both';

export interface VaultGraphScopePayload {
  scope?: VaultGraphScope;
}

export interface VaultGraphNodeV2 {
  id: string;
  label: string;
  path: string;
  category: VaultGraphCategory;
  vault?: 'notes' | 'story';
  storyId?: string;
  chapterId?: string;
  sceneId?: string;
  /** Count of unique edges this node participates in (in + out, undirected). */
  degree: number;
}

export interface VaultGraphEdgeV2 {
  source: string;
  target: string;
  /** Number of [[...]] references from source to target in the source file. */
  weight: number;
  crossVault?: boolean;
}

export interface VaultGraphNodesResponse {
  nodes: VaultGraphNodeV2[];
}

export interface VaultGraphEdgesResponse {
  edges: VaultGraphEdgeV2[];
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

export type WritingAssistantCadence = number | 'on-save' | 'manual';
export type WritingAssistantTipDecision = 'accepted' | 'session_suppressed' | 'reported';

export interface WritingAssistantCadenceChangePayload {
  waScanInterval: WritingAssistantCadence;
}

export interface WritingAssistantCadenceChangeResponse {
  saved: boolean;
  waScanInterval: WritingAssistantCadence;
}

export interface WritingAssistantTipDecisionPayload {
  tipId: string;
  decision: WritingAssistantTipDecision;
  sceneId?: string;
  scenePath?: string;
  sceneUpdatedAt?: string;
}

export interface WritingAssistantTipDecisionResponse {
  saved: boolean;
}

export interface WritingAssistantSuggestionListPayload {
  sceneId?: string;
  scenePath?: string;
  status?: string;
}

export interface WritingAssistantSuggestionListResponse {
  suggestions: import('./db.js').DbSuggestion[];
}

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

/**
 * Beta 4 M14 — compile options shared by the DOCX / PDF / EPUB exporters
 * (prototype export modal toggles 3846–3851: "Include synopsis page" +
 * "Scene separators (◆ ◆ ◆)"). Omitted options preserve the pre-M14
 * behavior (no synopsis page, no separators).
 */
export interface ExportOptions {
  /** Insert a synopsis page after the title page (default false). */
  includeSynopsis?: boolean;
  /** Insert "◆ ◆ ◆" separators between scenes in a chapter (default false). */
  sceneSeparators?: boolean;
}

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
  /** Beta 4 M14 — synopsis / separator compile options. */
  options?: ExportOptions;
}

export interface ExportEpubResponse {
  path: string | null;
  cancelled: boolean;
  /** Beta 4 M14 — size of the written file (export modal Done-state chip). */
  bytes?: number;
}

// ─── DOCX export (MYT-252) ───

export interface ExportDocxPayload {
  // Legacy: whole-story by storyId. Kept for backward compat.
  storyId?: string;
  // SKY-153: full scope control; takes precedence over storyId when present.
  scope?: ExportScope;
  /** Beta 4 M14 — synopsis / separator compile options. */
  options?: ExportOptions;
}

export interface ExportDocxResponse {
  path: string | null;
  cancelled: boolean;
  /** Beta 4 M14 — size of the written file (export modal Done-state chip). */
  bytes?: number;
  /** SKY-7108 — scene ids where .md file was missing during export. */
  missingSceneIds?: string[];
}

// ─── PDF export (Beta 4 M14, FULL-SPEC §5.5) ───

export interface ExportPdfPayload {
  scope: ExportScope;
  options?: ExportOptions;
}

export interface ExportPdfResponse {
  path: string | null;
  cancelled: boolean;
  bytes?: number;
  /** SKY-7108 — scene ids where .md file was missing during export. */
  missingSceneIds?: string[];
}

export interface ExportRevealLastResponse {
  opened: boolean;
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
  /** Beta 4 M14 — size of the written file (export modal Done-state chip). */
  bytes?: number;
}

export interface ExportPlaintextPayload {
  scope: ExportScope;
}

export interface ExportPlaintextResponse {
  path: string | null;
  cancelled: boolean;
  /** Beta 4 M14 — size of the written file (export modal Done-state chip). */
  bytes?: number;
}

// ─── Budget enforcement push event (MYT-207) ───

/** Emitted on agent:budget-cap when an agent is blocked by a token or rate cap. */
export interface AgentBudgetCapEvent {
  agent: string;
  reason: 'hourly_token_cap' | 'daily_token_cap';
  /** Human-readable label, e.g. "Writing Assistant" */
  agentLabel: string;
}

// ─── Beta 3 M24: Settings vault/story import ───

export type SettingsVaultImportKind = 'obsidian' | 'notion' | 'scriv' | 'markdown';
export type SettingsVaultImportInto = 'second' | 'new';
export type SettingsStoryImportFormat = 'docx' | 'gdoc' | 'md' | 'scriv' | 'epub';

export interface VaultImportScanPayload {
  kind: SettingsVaultImportKind;
  srcPath: string;
}

export interface VaultImportScanResponse {
  ok: boolean;
  error?: string;
  noteCount?: number;
  attachmentCount?: number;
  totalFiles?: number;
  sampleFiles?: string[];
  warnings?: string[];
}

export interface VaultImportRunPayload {
  kind: SettingsVaultImportKind;
  srcPath: string;
  /** 'second' → Imported/<name> inside the current Notes Vault; 'new' → targetPath. */
  into: SettingsVaultImportInto;
  /** Destination folder for into:'new' (from the folder picker). */
  targetPath?: string;
}

export interface VaultImportRunResponse {
  ok: boolean;
  error?: string;
  targetPath?: string;
  imported?: number;
  skipped?: number;
  errors?: string[];
}

export interface StoryImportPickPayload {
  format: SettingsStoryImportFormat;
}

export interface StoryImportPickResponse {
  filePath: string | null;
  cancelled: boolean;
}

export interface StoryImportRunPayload {
  format: SettingsStoryImportFormat;
  filePath: string;
}

export interface StoryImportRunResponse {
  ok: boolean;
  error?: string;
  storyTitle?: string;
  chapterCount?: number;
  sceneCount?: number;
  partCount?: number;
  planNotePath?: string;
  firstSceneId?: string;
  firstScenePath?: string;
  warnings?: string[];
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

// ─── SKY-2991: onboarding v2 path/vault IPC types ───

export interface OnboardingValidatePathPayload {
  path: string;
}

export interface OnboardingValidatePathResponse {
  exists: boolean;
  isEmpty: boolean;
  writable: boolean;
  /** True when the path already contains a Mythos two-vault layout. */
  conflictMythos?: boolean;
  /** True on Windows when the resolved path exceeds 200 characters. */
  pathTooLong?: boolean;
}

export interface OnboardingGetSuggestedPathsResponse {
  homeDir: string;
  documentsDir: string;
  desktopDir: string;
  oneDriveDir: string | null;
  iCloudDir: string | null;
}

export interface OnboardingOpenExistingVaultPayload {
  path: string;
}

export interface OnboardingOpenExistingVaultResponse {
  ok: boolean;
  vaultRoot?: string;
  error?: string;
}

export interface OnboardingDetectMythosVaultPayload {
  path: string;
}

export interface OnboardingDetectMythosVaultResponse {
  isValid: boolean;
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

// ─── Agent persona IPC types (MYT-816; Beta 3 M22 adds archive/betaReader + LEARNING + write) ───

export type AgentPersonaName = 'writingAssistant' | 'brainstorm' | 'archive' | 'betaReader';
export type PersonaKey = 'AGENTS' | 'HEARTBEAT' | 'SOUL' | 'TOOLS' | 'LEARNING';

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

export interface AgentPersonaWritePayload {
  agentName: AgentPersonaName;
  key: PersonaKey;
  content: string;
}

export interface AgentPersonaWriteResponse {
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

// ─── Archive Agent v1 — continuity scan types (SKY-1684) ───────────────────

export type ArchiveScanScope = 'active_scene' | 'active_chapter' | 'full_manuscript';
export type ResolutionAction = 'match_archive_to_story' | 'suggest_story_change' | 'ignore';

export interface InconsistencyItem {
  id: string;
  category: 'character_attribute_drift' | 'location_attribute_mismatch' | 'factual_contradiction';
  severity: 'critical' | 'high' | 'medium' | 'low';
  manuscriptAnchor: {
    sceneId: string;
    offset: number;
    excerpt: string;
  };
  vaultAnchor: {
    notePath: string;
    line: number;
    excerpt: string;
  };
  rationale: string;
  proposedResolution: {
    matchArchiveToStory: string;
    suggestStoryChange: string;
  };
  status: 'open' | 'resolved' | 'ignored';
  resolvedAt: string | null;
  resolvedAction: ResolutionAction | null;
  createdAt: string;
}

export interface ArchiveScanContinuityPayload {
  sceneId: string;
  text: string;
  scope?: ArchiveScanScope;
}

export interface ArchiveResolveContinuityPayload {
  itemId: string;
  action: ResolutionAction;
  note?: string;
}

export interface ArchiveListContinuityPayload {
  /** When provided, results are scoped to this scene (AC-A-09). */
  sceneId?: string;
  filter?: { status?: string; category?: string };
}

export interface ArchiveContScanStartEvent {
  sceneId: string;
  scope: ArchiveScanScope;
}

export interface ArchiveContScanResultEvent {
  sceneId: string;
  items: InconsistencyItem[];
  tokenUsed: number;
  partial: boolean;
}

export interface ArchiveContScanErrorEvent {
  sceneId: string;
  error: string;
}

/** Beta 3 M23: broadcast after archive:resolve-continuity — or after an
 *  archive:confirm that resolved a continuity item via a manuscript comment's
 *  agent actions — so every surface (Continuity panel, comments gutter) can
 *  drop the flag without polling. */
export interface ArchiveContItemResolvedEvent {
  itemId: string;
  sceneId: string;
  status: 'resolved' | 'ignored';
  action: ResolutionAction;
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
  /** BCP-47 language hint, e.g. 'en-US' (settings.voice.inputLanguage). Absent = auto-detect. */
  language?: string;
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
  homeDir: string;
  pathSeparator: '/' | '\\';
}

export interface VaultGetSystemPathsResponse {
  homeDir: string;
  documentsDir: string;
  desktopDir: string;
  oneDriveDir: string | null;
  iCloudDir: string | null;
  suggestedSaveLocations: string[];
}

export type VaultDetectLegacyResponse =
  | { found: false }
  | { found: true; legacyRoot: string; storyVaultPath: string; notesVaultPath: string };

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

// SKY-2969: Uninstaller vault-cleanup choice
export interface CleanUninstallResponse {
  /** True when the user clicked the keep-vaults button (no deletion performed). */
  cancelled: boolean;
  /** Absolute paths that were successfully deleted. */
  deleted: string[];
  /** Paths that could not be deleted (message per path). */
  errors: string[];
  /** Vault paths outside the default location that were NOT auto-deleted. */
  customPathsWarning: string[];
}

// ─── Brainstorm Agent routing (SKY-20) ───

export type BrainstormFactType = 'character' | 'location' | 'item' | 'faction' | 'scene_card' | 'inbox';

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
  /** Wave 3.4 proposal path: confirm writes a prebuilt NoteProposal. */
  proposal?: NoteProposal;
  /** Renderer app-state selection used when proposal.destinationPath is not already resolved. */
  activeUniverse?: string | null;
  /** Renderer app-state selection used when proposal.destinationPath is not already resolved. */
  activeStory?: string | null;
}

export type BrainstormWriteNoteResponse =
  | {
      status: 'written';
      /** Vault-relative path of the written note. */
      path: string;
      suggestionId: string;
      /** How the destination was resolved — for telemetry/tests. */
      reason: 'default-layout' | 'remembered' | 'proposal';
    }
  | {
      status: 'needs_routing';
      /** Staged file path (vault-relative). Caller invokes RESOLVE_ROUTING
       *  with the user's chosen folder; main moves the file there. */
      stagedPath: string;
      category: BrainstormFactType;
      name: string;
    }
  | {
      status: 'disambiguation_needed';
      context: 'universe';
      options: string[];
    }
  | {
      /** AC-BST-06: a note with this name already exists; use proposeEdit instead. */
      status: 'existing_note_match';
      existingPath: string;
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


// ─── SKY-156: Project Templates ───────────────────────────────────────────────

export interface TemplateNode {
  name: string;
  children?: TemplateNode[];
  starterNote?: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  story: TemplateNode[];
  notes: TemplateNode[];
  isUserTemplate?: boolean;
  savedAt?: string;
}

export interface TemplateListResponse {
  templates: TemplateDefinition[];
}

export interface TemplateScaffoldPayload {
  templateId: string;
  // SKY-780: proof of user intent — registration token from a prior
  // vault:pick-folder dialog call. The handler derives story/notes vault
  // paths from the token; the renderer cannot supply arbitrary FS paths.
  parentToken: string;
}

export interface TemplateScaffoldResponse {
  ok: true;
  storyVaultPath: string;
  notesVaultPath: string;
  // One-shot tokens for the derived paths — pass to vault:setPaths as
  // storyVaultToken / notesVaultToken to authorize that call too.
  storyVaultToken: string;
  notesVaultToken: string;
}

export interface TemplateSaveAsPayload {
  name: string;
}

export type TemplateSaveAsResponse =
  | { ok: true; id: string }
  | { error: string };

// ─── SKY-190: Note Templates ──────────────────────────────────────────────────

export interface NoteTemplateField {
  key: string;
  kind: 'literal' | 'prompt' | 'pick';
  label: string;
  entityType?: 'character' | 'location' | 'item';
  defaultValue?: string;
}

export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  kind: 'scene' | 'chapter' | 'character' | 'location' | 'item' | 'note' | 'daily-note';
  body: string;
  fields: NoteTemplateField[];
}

export interface NoteTemplateListPayload {
  kind?: string;
}

export interface NoteTemplateListResponse {
  templates: NoteTemplate[];
}

// ─── SKY-204: Daily Notes ─────────────────────────────────────────────────────

/** Opens (or creates) today's daily note. Returns the relative path within the Notes Vault. */
export interface DailyNoteOpenTodayResponse {
  /** Relative path to today's note inside the Notes Vault (e.g. "Daily Notes/2025-01-15.md"). */
  path: string;
  /** True if the note was just created; false if it already existed. */
  created: boolean;
}

export interface DailyNoteGetStreakResponse {
  /** Number of consecutive calendar days with a daily note, ending today (or yesterday). */
  streakDays: number;
  /** True if today's note already exists on disk. */
  todayExists: boolean;
}

// ─── SKY-193: Tag Wrangler ───

export interface NotesTagEntry {
  name: string;
  fullName: string;
  count: number;
  paths: string[];
  children: NotesTagEntry[];
}

export interface NotesTagListResponse {
  tags: NotesTagEntry[];
}

export interface NotesTagRenamePayload {
  oldTag: string;
  newTag: string;
}

export interface NotesTagRenameResponse {
  affectedFiles: number;
}

export interface NotesTagMergePayload {
  sourceTag: string;
  targetTag: string;
}

export interface NotesTagMergeResponse {
  affectedFiles: number;
}
// ─── SKY-55: per-scene notes ───
export interface NotesGetPayload { sceneId: string }
export interface NotesGetResponse { content: string }
export interface NotesSetPayload { sceneId: string; content: string }
export interface NotesSetResponse { saved: boolean }

// ─── SKY-1391: brainstorm → writing-panel bridge ───
// Appends `content` to the scene's note field (stored in SQLite notes table).
// Empty content is a no-op success. Multiple appends are separated by "\n---\n".
// sceneId is the scene UUID from SceneEntry.id / the manifest.
export interface SceneAppendBrainstormNotePayload {
  sceneId: string;
  content: string;
}
export interface SceneAppendBrainstormNoteResponse {
  /** true when content was appended; false when content was empty (no-op). */
  appended: boolean;
}
// ─── Tag types (SKY-158) ───
export interface TagEntry {
  id: string;
  name: string;
  color?: string | null;
  createdAt: string;
}
export interface TagsListResponse { tags: TagEntry[] }
export interface TagsUpsertPayload { name: string; color?: string | null }
export interface TagsUpsertResponse { tag: TagEntry }
export interface TagsDeletePayload { id: string }
export interface TagsDeleteResponse { deleted: boolean }
export interface TagsRenamePayload { id: string; name: string }
export interface TagsRenameResponse { tag: TagEntry }
export interface TagsForItemPayload { itemId: string; itemKind: 'scene' | 'entity' }
export interface TagsForItemResponse { tags: string[] }
export interface TagsSetForItemPayload { itemId: string; itemKind: 'scene' | 'entity'; tags: string[] }
export interface TagsSetForItemResponse { tags: string[] }
export interface TagsItemsForTagPayload { tagName: string }
export interface TagsItemsForTagItem { itemId: string; itemKind: 'scene' | 'entity' }
export interface TagsItemsForTagResponse { items: TagsItemsForTagItem[] }
export interface TagsBulkApplyPayload {
  itemIds: string[];
  itemKind: 'scene' | 'entity';
  addTags?: string[];
  removeTags?: string[];
}
export interface TagsBulkApplyResponse { updated: number }
export interface SceneSetTagsPayload { sceneId: string; tags: string[] }
export interface SceneSetTagsResponse { scene: SceneEntry }
// ─── SKY-154: Writing Goals types ───
export interface GoalsLogWordsPayload { date: string; wordsAdded: number; }
export type GoalsLogWordsResponse = { ok: true };
export interface HeatmapEntry { date: string; words: number; }
export interface GoalsGetStatsResponse { todayWords: number; weekWords: number; dailyGoal: number; streakDays: number; heatmap: HeatmapEntry[]; }
export interface GoalsSetGoalPayload { dailyGoal: number; }
export type GoalsSetGoalResponse = { ok: true };
export type GoalsResetStreakResponse = { ok: true };
// ─── SKY-170: Scene-to-entity links ─────────────────────────────────────────
export interface SceneEntityLink {
  sceneId: string;
  entityId: string;
  linkKind: 'mention' | 'tag';
  createdAt: string;
}
export interface LinkedScene {
  sceneId: string;
  scenePath: string;
  sceneTitle: string;
  chapterId: string;
  chapterTitle: string;
  chapterOrder: number;
  storyId: string;
  linkKind: 'mention' | 'tag';
}
export interface SceneEntityLinksListPayload {
  sceneId: string;
}
export interface SceneEntityLinksListResponse {
  links: SceneEntityLink[];
}
export interface SceneEntityLinksUpsertPayload {
  sceneId: string;
  entityId: string;
  kind: 'mention' | 'tag';
}
export interface SceneEntityLinksUpsertResponse {
  link: SceneEntityLink;
}
export interface SceneEntityLinksDeletePayload {
  sceneId: string;
  entityId: string;
  kind: 'mention' | 'tag';
}
export interface EntityLinkedScenesPayload {
  entityId: string;
}
export interface EntityLinkedScenesResponse {
  scenes: LinkedScene[];
}

// ─── Timeline data model types (SKY-791) ───

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

// ─── Timeline IPC payload / response types (SKY-791) ───

export interface TimelineGetSettingsPayload {
  storyId?: string;
}

export interface TimelineGetSettingsResponse {
  settings: TimelineSettings;
}

export interface TimelineSaveSettingsPayload {
  settings: TimelineSettings;
  storyId?: string;
}

export interface TimelineSaveSettingsResponse {
  saved: boolean;
}

export interface TimelineGetScenesPayload {
  storyId: string;
}

export interface TimelineGetScenesResponse {
  scenes: SceneEntry[];
}

export interface TimelineUpdateScenePayload {
  sceneId: string;
  chronologicalTime?: ChronologicalTime;
  entityLinks?: SceneEntityLinks;
  timelineMetadata?: SceneTimelineMetadata;
}

export interface TimelineUpdateSceneResponse {
  scene: SceneEntry;
}

export interface TimelineUpdateArcColorPayload {
  arcId: string;
  color: string;
  colorIsCustom: boolean;
}

export interface TimelineUpdateArcColorResponse {
  arc: ArcEntry;
}

// SKY-794: arc manifest listing for spreadsheet view
export type TimelineListArcsPayload = Record<string, never>;

export interface TimelineListArcsResponse {
  arcs: ArcEntry[];
}

// ─── SKY-796: Timeline AI auto-population proposals ───
//
// AI-derived suggestions (date estimation, character mention, mood inference)
// surfaced as transparent, revokable badges on the spreadsheet. A proposal
// never silently overwrites a user-set field; the renderer renders a badge
// + accept/reject control and the main process only applies the value when
// the user clicks accept. Stored under <storyVault>/timeline-proposals.json
// keyed by scene id.

export type TimelineProposalKind = 'date' | 'characters' | 'mood';
export type TimelineProposalStatus = 'pending' | 'accepted' | 'rejected';

export interface TimelineAIProposal {
  /** Stable id (sceneId + kind + payloadHash) so re-runs are idempotent. */
  id: string;
  sceneId: string;
  kind: TimelineProposalKind;
  /**
   * For `date` proposals: ISO-ish date string ("Year 42", "2340-06-15", etc.).
   * For `characters`: comma-separated entity ids (POV/secondary).
   * For `mood`: short mood label (e.g. 'tense', 'revelatory').
   */
  value: string;
  /** Human-readable cue text shown in tooltip — e.g. the matched phrase. */
  reason: string;
  /** 0..1 confidence; the engine never proposes below 0.4. */
  confidence: number;
  /** Provenance — always `'ai'` for engine-derived proposals. */
  source: 'ai';
  /** Always true for proposals; cleared on accept. */
  isEstimated: true;
  status: TimelineProposalStatus;
  createdAt: string;
  /** Filled in when the user resolves the proposal. */
  resolvedAt?: string;
}

export interface TimelineProposalsGeneratePayload {
  storyId: string;
}

export interface TimelineProposalsGenerateResponse {
  /** All pending proposals for the story (post-merge with previously-resolved ones). */
  proposals: TimelineAIProposal[];
}

export interface TimelineProposalsListPayload {
  storyId: string;
}

export interface TimelineProposalsListResponse {
  proposals: TimelineAIProposal[];
}

export interface TimelineProposalResolvePayload {
  proposalId: string;
  decision: 'accept' | 'reject';
}

export interface TimelineProposalResolveResponse {
  proposal: TimelineAIProposal;
  /**
   * Populated when `decision === 'accept'` and the value was applied to the
   * scene — the renderer can refresh the row in-place.
   */
  scene?: SceneEntry;
  /**
   * True when accept was a no-op because the field already held a user-set
   * value (AI proposals never overwrite user-set dates / metadata).
   */
  skippedBecauseUserSet?: boolean;
}

// ─── SKY-863: Cloud-sync conflict detection + lockfile types ──────────────────

/** One conflict file that was detected and resolved during vault open. */
export interface ResolvedConflictInfo {
  conflictPath: string;
  originalPath: string;
  provider: 'dropbox' | 'icloud' | 'syncthing';
  keptPath: string;
  archivedPath: string;
  resolvedAt: string;
}

/** Metadata from an existing lockfile that belongs to a live concurrent session. */
export interface LockfileConflictInfo {
  hostname: string;
  pid: number;
  timestamp: string;
}

/** Response from `vault:check-conflicts`. */
export interface VaultCheckConflictsResponse {
  /** Conflicts detected and auto-resolved during this call. */
  resolved: ResolvedConflictInfo[];
  /** Non-null when another live Mythos session has this vault open. */
  lockfileConflict: LockfileConflictInfo | null;
  /** True when the user has previously dismissed warnings for this vault. */
  dismissed: boolean;
}

export interface TemplateRenamePayload {
  id: string;
  name: string;
}

export interface TemplateRenameResponse {
  ok: true;
}

export interface TemplateDeletePayload {
  id: string;
}

export interface TemplateDeleteResponse {
  ok: true;
}

export interface TemplateDuplicatePayload {
  id: string;
}

export interface TemplateDuplicateResponse {
  ok: true;
  id: string;
}

// SKY-1403: export / import .mythostemplate files
export interface TemplateExportPayload {
  id: string;
}

export type TemplateExportResponse =
  | { ok: true; cancelled?: boolean }
  | { error: string };

// SKY-1405: optional filePath lets drag-drop bypass the open-file dialog
export interface TemplateImportPayload {
  filePath?: string;
}

export type TemplateImportResponse =
  | { ok: true; template?: TemplateDefinition; cancelled?: boolean }
  | { error: string };

// ─── SKY-1483: Wave 3.4 — NoteProposal + extraction IPC types ───

export type NoteProposalStatus = 'pending' | 'confirmed' | 'rejected' | 'edited_and_confirmed';

export interface NoteProposal {
  id: string;
  kind: BrainstormFactType;
  title: string;
  destinationPath: string;
  body: string;
  frontmatter: Record<string, unknown>;
  sourceConversationTurnId: string;
  extractionConfidence: number;
  status: NoteProposalStatus;
}

export interface BrainstormExtractProposalsPayload {
  turnText: string;
  turnId: string;
  existingEntityNames?: string[];
}

export interface BrainstormExtractProposalsResponse {
  proposals: NoteProposal[];
}

export interface BrainstormGetSessionRejectionsResponse {
  rejectedNames: string[];
}

export interface BrainstormDismissAllResponse {
  rejectedCount: number;
}

export type ProposalDecision = 'confirm' | 'edit_and_confirm' | 'reject';

export interface BrainstormProposalConfirmPayload {
  /** Stable UUID of the NoteProposal being confirmed. */
  proposalId: string;
  /** The kind, used for telemetry. */
  kind: BrainstormFactType;
  /** Confidence at extraction time. */
  extractionConfidence: number;
  /** ms from card appearance to user action (measured by the renderer). */
  timeToDecideMs: number;
  /** 'confirm' for an unedited accept; 'edit_and_confirm' when body/title was changed. */
  decision: 'confirm' | 'edit_and_confirm';
}

export interface BrainstormProposalRejectPayload {
  /** Stable UUID of the NoteProposal being rejected. */
  proposalId: string;
  /** Entity title — added to the session rejection log to suppress re-extraction. */
  title: string;
  /** The kind, used for telemetry. */
  kind: BrainstormFactType;
  /** Confidence at extraction time. */
  extractionConfidence: number;
  /** ms from card appearance to user action (measured by the renderer). */
  timeToDecideMs: number;
}

// ─── SQLite-backed versioned draft snapshots (SKY-1611) ───

export interface DraftSnapshot {
  id: string;
  sceneId: string;
  createdAt: number;
  label: string | null;
}

export interface DraftsCreatePayload {
  sceneId: string;
  content: string;
  label?: string;
}

export interface DraftsCreateResponse {
  snapshot: DraftSnapshot;
}

export interface DraftsListPayload {
  sceneId: string;
}

export interface DraftsListResponse {
  snapshots: DraftSnapshot[];
}

export interface DraftsPreviewPayload {
  snapshotId: string;
}

export interface DraftsPreviewResponse {
  content: string;
}

export interface DraftsRestorePayload {
  snapshotId: string;
  sceneId: string;
  currentContent: string;
}

export interface DraftsRestoreResponse {
  content: string;
  preRestoreSnapshotId: string;
}

export interface DraftsLabelPayload {
  snapshotId: string;
  label: string;
}

export interface DraftsDeletePayload {
  snapshotId: string;
}

// ─── Scene Crafter IPC payload types (SKY-1758) ───

/** Minimal card fields required to create a new board card. */
export interface BoardCardInput {
  wikilink: string;
  title: string;
  done?: boolean;
  tags?: string[];
}

export interface SceneCrafterGetBoardPayload {
  storyId: string;
  storySlug: string;
}

export interface SceneCrafterCreateBoardPayload {
  storyId: string;
  storySlug: string;
}

export interface SceneCrafterAddCardPayload {
  storySlug: string;
  laneIndex: number;
  card: BoardCardInput;
}

export interface SceneCrafterMoveCardPayload {
  storySlug: string;
  fromLane: number;
  fromIndex: number;
  toLane: number;
  toIndex: number;
}

export interface SceneCrafterToggleCardDonePayload {
  storySlug: string;
  laneIndex: number;
  cardIndex: number;
}

export interface SceneCrafterDeleteCardPayload {
  storySlug: string;
  laneIndex: number;
  cardIndex: number;
}

export interface SceneCrafterAddLanePayload {
  storySlug: string;
  name: string;
}

export interface SceneCrafterRenameLanePayload {
  storySlug: string;
  laneIndex: number;
  name: string;
}

export interface SceneCrafterDeleteLanePayload {
  storySlug: string;
  laneIndex: number;
  /** When true, delete the lane even if it contains cards. */
  force?: boolean;
}

export interface SceneCrafterReorderLanesPayload {
  storySlug: string;
  fromIndex: number;
  toIndex: number;
}

export interface SceneCrafterSaveBoardPayload {
  storySlug: string;
  board: SceneCrafterBoard;
}

export interface SceneCrafterClosePayload {
  storySlug: string;
}

/** Payload emitted on the push channel `scene-crafter:external-edit`. */
export interface SceneCrafterExternalEditPayload {
  storySlug: string;
}

// ─── SKY-1764: Brainstorm → Scene Crafter suggestion accept/reject ───

export interface SceneCrafterSuggestionAcceptPayload {
  /** Suggestion ID (UUID from the suggestions table). */
  suggestionId: string;
  actor?: string;
}

export interface SceneCrafterSuggestionAcceptResponse {
  suggestionId: string;
  auditId: string;
  cardPath: string;
  laneUsed: string;
  laneIndex: number;
}

export interface SceneCrafterSuggestionRejectPayload {
  suggestionId: string;
  actor?: string;
}

export interface SceneCrafterSuggestionRejectResponse {
  suggestionId: string;
  auditId: string;
}

// Re-export SceneCrafterBoard so callers can import it from ipc.ts instead of sceneCrafterBoard.ts.
export type { SceneCrafterBoard };

// ─── Continuity Peek payload / response types (SKY-2011) ─────────────────────

export interface ContinuityMatchSelectionPayload {
  selectedText: string;
  notesVaultRoot: string;
}

export interface ContinuityEntityResult {
  name: string;
  aliases: string[];
  type: string | null;
  path: string;
  excerpt: string;
}

export interface ContinuityMatchSelectionResponse {
  match: ContinuityEntityResult | null;
}

export interface ContinuitySearchPayload {
  query: string;
  notesVaultRoot: string;
}

export interface ContinuitySearchResponse {
  results: ContinuityEntityResult[];
}

export interface ContinuityReadEntityPayload {
  path: string;
}

export interface ContinuityReadEntityResponse {
  name: string;
  aliases: string[];
  type: string | null;
  excerpt: string;
}

// ─── SKY-2308: Vault integrity check + manifest rebuild ───

export interface VaultIntegrityReport {
  /** Scene/entity IDs whose `.md` file is missing on disk. */
  orphanedManifestEntries: string[];
  /** Vault-relative `.md` file paths not referenced in the manifest. */
  unindexedFiles: string[];
  /** True when the manifest schemaVersion differs from the current build. */
  manifestSchemaMismatch: boolean;
  /** IDs whose file exists but has no parseable `id` in frontmatter (or is unreadable). */
  corruptedEntries: string[];
}

export interface VaultRebuildManifestResponse {
  rebuilt: true;
  scenesFound: number;
  entitiesFound: number;
}

// SKY-3026: Outline planning surface
export interface OutlineLoadPayload { storyVaultPath: string; }
export type OutlineLoadResponse = OutlineData | null;
export interface OutlineSavePayload { storyVaultPath: string; data: OutlineData; }
export interface OutlineSaveResponse { saved: boolean; }

// SKY-6306 M21: Multi-timeline store IPC
export interface TimelinesGetStorePayload { vaultRoot?: string; }
export interface TimelinesGetStoreResponse { store: TimelinesStore; }

export interface TimelinesUpsertPayload {
  id?: string;
  name: string;
  kind: TimelineKind;
  calendar?: Partial<TimelineCalendar>;
}
export interface TimelinesUpsertResponse { ok: boolean; id: string; store: TimelinesStore; }

export interface TimelinesSetActivePayload { timelineId: string; }
export interface TimelinesSetActiveResponse { ok: boolean; store: TimelinesStore; }

// Beta 4 M22: Axis engine — persist plotted items (eras, spans, events,
// custom rows) mutated by direct manipulation / the exact-time picker.
export type TimelinesItemType = 'era' | 'span' | 'event' | 'row';

export type TimelinesItem = TimelineEra | TimelineSpan | TimelineEvent | TimelineRow;

export interface TimelinesUpsertItemPayload {
  type: TimelinesItemType;
  /** Full item, id included — inserted when new, replaced when existing. */
  item: TimelinesItem;
}
export interface TimelinesUpsertItemResponse {
  ok: boolean;
  store: TimelinesStore;
  error?: string;
}

export interface TimelinesDeleteItemPayload {
  type: TimelinesItemType;
  id: string;
}
export interface TimelinesDeleteItemResponse {
  ok: boolean;
  store: TimelinesStore;
  error?: string;
}

// SKY-6228: M15 — agent chat session IPC types
export type { AgentSessionFile, AgentSessionSummary, SessionTurn, SessionAgent } from './mythosFormat/agentSessions.js';

export interface AgentSessionListPayload { agent?: string; }
export interface AgentSessionListResponse { sessions: import('./mythosFormat/agentSessions.js').AgentSessionSummary[]; }

// M20: read one session's full turn history (Brainstorm chat hydration on session switch)
export interface AgentSessionReadPayload { sessionId: string; }
export interface AgentSessionReadResponse {
  session: import('./mythosFormat/agentSessions.js').AgentSessionFile | null;
}

export interface AgentSessionCreatePayload {
  agent: string;
  title?: string;
  greeting?: string;
}
export interface AgentSessionCreateResponse {
  session: import('./mythosFormat/agentSessions.js').AgentSessionFile;
  relPath: string;
}

export interface AgentSessionRenamePayload { sessionId: string; title: string; }
export interface AgentSessionRenameResponse { ok: boolean; }

export interface AgentSessionDuplicatePayload { sessionId: string; }
export interface AgentSessionDuplicateResponse {
  session: import('./mythosFormat/agentSessions.js').AgentSessionFile;
  relPath: string;
}

export interface AgentSessionDeletePayload { sessionId: string; }
export interface AgentSessionDeleteResponse {
  ok: boolean;
  /** When the last session was deleted a fresh one is auto-created. */
  replacement?: import('./mythosFormat/agentSessions.js').AgentSessionFile;
  replacementRelPath?: string;
}

export interface AgentSessionAppendTurnsPayload {
  sessionId: string;
  turns: import('./mythosFormat/agentSessions.js').SessionTurn[];
}
export interface AgentSessionAppendTurnsResponse {
  session: import('./mythosFormat/agentSessions.js').AgentSessionFile | null;
}

// M12 — read one full session by id (null when it does not exist).
export interface AgentSessionReadPayload { sessionId: string; }
export interface AgentSessionReadResponse {
  session: import('./mythosFormat/agentSessions.js').AgentSessionFile | null;
}
